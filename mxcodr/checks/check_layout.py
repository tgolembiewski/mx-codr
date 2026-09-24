#!/usr/bin/env python3
"""Check that page widgets are spaced with Atlas Spacing design properties.

Input: `describe page` dumps (.mdl files or directories), normally from tests/gate.sh;
optionally `DESCRIBE NAVIGATION` output (--navigation), snippet dumps (--sign-out-sources) and
`describe layout` dumps of the project's own layouts (--layouts).
Usage: check_layout.py <file.mdl|dir> ... [--navigation nav.mdl] [--sign-out-sources dir]
                       [--layouts dir] [--users-sign-in] [--json]
--json keys: verdict, pages, sources, failures, warnings.
Exit: 0 no errors (warnings allowed), 1 errors or no MDL found, 2 bad arguments.
"""

# Rule codes:
#   SPACE01  FAIL  inline sibling (not last) without margin-right, or H1-H3 heading with a sibling below and no margin-bottom
#   SPACE02  FAIL  margin/padding value other than None, S, M, L (mxcli check accepts it; mx check fails with CE6083)
#   SPACE03  FAIL  inline widgets on one line with different top/bottom margins, or none with margin-bottom
#   HEAD01   WARN  page with no H1-H3 text, no header widget and no header/title/masthead snippet
#   NAV01    FAIL  users sign in (--users-sign-in), but a navigation menu has no sign_out item
#                  and no page or snippet has a sign-out button
#   NAV02    WARN  the sign_out item is not the last item of its menu
#   NAV03    FAIL  users sign in, and a role's home page (`home page X for Role`) is not in that
#                  profile's menu
#   NAV04    FAIL  one of the project's own layouts opens two or more pages from buttons: a menu
#                  built by hand, with no hamburger, no active item and no phone view

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Spacing values Atlas Core's design-properties.json defines.
SPACING_VALUES = {"None", "S", "M", "L"}

# Layout containers never take a margin of their own.
STRUCTURAL = {"row", "column", "region", "placeholder", "controlbar", "header", "footer"}

# Rendered on one line, so they touch unless spaced; block-level widgets are spaced by the theme.
INLINE = {"actionbutton", "linkbutton", "dynamictext", "text", "image", "staticimage",
          "dynamicimage", "checkbox", "radiobuttons"}

# A heading renders as a block, so it never joins a line run; it only needs margin-bottom.
HEADING_MODE = re.compile(r"RenderMode:\s*(H1|H2|H3)", re.IGNORECASE)


def is_heading(widget) -> bool:
    return widget.type in ("dynamictext", "text") and bool(HEADING_MODE.search(widget.text))


def runs_of(group: list) -> list[list]:
    """Split siblings into the runs of inline widgets that share one line."""
    runs, current = [], []
    for widget in group:
        if widget.type not in INLINE or widget.type in STRUCTURAL or is_heading(widget):
            if current:
                runs.append(current)
            current = []
            continue
        current.append(widget)
    if current:
        runs.append(current)
    return runs

# `<indent><type> <name> (` or `{`; name may be "double-quoted".
WIDGET_RE = re.compile(r"^(?P<indent>\s*)(?P<type>[a-z][a-z0-9_]*)\s+(?P<name>\"[^\"]+\"|[A-Za-z_][\w/]*)\s*[({]")
# Unnamed widget: `<type> (` or `{`.
ANON_RE = re.compile(r"^(?P<indent>\s*)(?P<type>[a-z][a-z0-9_]*)\s*[({]")
PAGE_RE = re.compile(r"^create (?:or (?:replace|modify) )?page\s+(?P<name>[\w.\"]+)", re.IGNORECASE)
# Group "body": the inside of `'Spacing': [ ... ]`.
SPACING_RE = re.compile(r"'Spacing'\s*:\s*\[(?P<body>[^\]]*)\]")
# One `'margin-right': 'S'` pair.
PAIR_RE = re.compile(r"'(?P<key>margin|padding)-(?P<side>top|right|bottom|left)'\s*:\s*'(?P<value>[^']*)'")


class Widget:
    __slots__ = ("type", "name", "line", "indent", "text", "page")

    def __init__(self, wtype: str, name: str, line: int, indent: int, page: str):
        self.type = wtype
        self.name = name.strip('"')
        self.line = line
        self.indent = indent
        self.text = ""
        self.page = page


def parse(lines: list[str]) -> list[Widget]:
    """Widgets in the dump with their property text; indentation gives the nesting."""
    widgets: list[Widget] = []
    page = ""
    open_widget: Widget | None = None
    for number, raw in enumerate(lines, 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("--"):
            continue
        page_match = PAGE_RE.match(line.strip())
        if page_match:
            page = page_match.group("name").replace('"', "")
            open_widget = None
            continue
        match = WIDGET_RE.match(line) or ANON_RE.match(line)
        if match and match.group("type") not in ("create", "grant", "layouttype", "class"):
            widget = Widget(match.group("type"), match.groupdict().get("name") or "", number,
                            len(match.group("indent")), page)
            widget.text = line.strip()
            widgets.append(widget)
            open_widget = widget
            continue
        # Deeper lines (e.g. multi-line DesignProperties) belong to the open widget.
        if open_widget is not None and len(line) - len(line.lstrip()) > open_widget.indent:
            open_widget.text += " " + line.strip()
    return widgets


def siblings(widgets: list[Widget]) -> dict[tuple[str, int, int], list[Widget]]:
    """Group widgets by (page, parent line, indent)."""
    groups: dict[tuple[str, int, int], list[Widget]] = {}
    for index, widget in enumerate(widgets):
        parent_line = 0
        for earlier in reversed(widgets[:index]):
            if earlier.page == widget.page and earlier.indent < widget.indent:
                parent_line = earlier.line
                break
        groups.setdefault((widget.page, parent_line, widget.indent), []).append(widget)
    return groups


def spacing_of(widget: Widget) -> dict[str, str]:
    """Spacing as {"margin-right": "S", ...}; unset sides are absent."""
    found = SPACING_RE.search(widget.text)
    if not found:
        return {}
    return {f"{m.group('key')}-{m.group('side')}": m.group("value")
            for m in PAIR_RE.finditer(found.group("body"))}


def invalid_value_findings(widgets: list[Widget]) -> list[dict]:
    """SPACE02: a spacing value Atlas does not define."""
    failures = []
    for widget in widgets:
        for key, value in spacing_of(widget).items():
            if value not in SPACING_VALUES:
                failures.append({
                    "check": "SPACE02",
                    "line": widget.line,
                    "message": (f"{widget.page}: {widget.type} '{widget.name}' sets {key}: '{value}',"
                                f" which Atlas does not define -- use one of"
                                f" {', '.join(sorted(SPACING_VALUES))}"),
                })
    return failures


def heading_findings(page: str, group: list[Widget]) -> list[dict]:
    """SPACE01: heading with a sibling below."""
    failures = []
    for index, widget in enumerate(group[:-1]):
        if not is_heading(widget):
            continue
        if spacing_of(widget).get("margin-bottom", "None") != "None":
            continue
        failures.append({
            "check": "SPACE01",
            "line": widget.line,
            "message": (f"{page}: heading '{widget.name}' has nothing under it but"
                        f" {group[index + 1].type} '{group[index + 1].name}' --"
                        f" add DesignProperties: ['Spacing': ['margin-bottom': 'S']]"),
        })
    return failures


def run_gap_findings(page: str, run: list[Widget]) -> list[dict]:
    """SPACE01: the last widget in a run has nothing to collide with."""
    failures = []
    for widget in run[:-1]:
        if spacing_of(widget).get("margin-right", "None") != "None":
            continue
        following = run[run.index(widget) + 1]
        failures.append({
            "check": "SPACE01",
            "line": widget.line,
            "message": (f"{page}: {widget.type} '{widget.name}' sits on one line with"
                        f" {following.type} '{following.name}' and no gap between them"
                        f" -- add DesignProperties: ['Spacing': ['margin-right': 'S']]"),
        })
    return failures


def run_alignment_findings(page: str, run: list[Widget]) -> list[dict]:
    """SPACE03: unequal vertical margins misalign the run; no margin-bottom makes wrapped rows touch."""
    vertical = {w.name: (spacing_of(w).get("margin-top", "None"),
                         spacing_of(w).get("margin-bottom", "None")) for w in run}
    shown = ", ".join(f"{name} {top}/{bottom}" for name, (top, bottom) in vertical.items())
    names = " and ".join(w.name for w in run)
    if len(set(vertical.values())) > 1:
        return [{
            "check": "SPACE03",
            "line": run[0].line,
            "message": (f"{page}: {names} sit on one line with"
                        f" different vertical spacing, so they render at different heights"
                        f" (margin-top/bottom: {shown}). Make those equal, and use"
                        f" margin-right for the gap between them"),
        }]
    if all(bottom == "None" for _top, bottom in vertical.values()):
        return [{
            "check": "SPACE03",
            "line": run[0].line,
            "message": (f"{page}: {names} share a line and none"
                        f" carries margin-bottom, so on a narrow window the line wraps and"
                        f" the second row sits against the first -- add"
                        f" ['margin-right': 'S', 'margin-bottom': 'S'] to each"
                        f" (the last one needs the bottom margin only)"),
        }]
    return []


def headed_pages(widgets: list[Widget]) -> dict[str, bool]:
    """{page: has a heading}; parsed widgets, since text "page <name>" also matches `grant view on page`."""
    headed: dict[str, bool] = {}
    for widget in widgets:
        if not widget.page:
            continue
        headed.setdefault(widget.page, False)
        # A shared header snippet counts as a heading.
        if (
            widget.type == "header"
            or is_heading(widget)
            or (widget.type == "snippetcall"
                and re.search(r"Snippet:\s*[\w.]*(header|title|masthead)", widget.text, re.I))
        ):
            headed[widget.page] = True
    return headed


def missing_heading_warnings(headed: dict[str, bool]) -> list[dict]:
    """HEAD01: a page with no heading."""
    warnings = []
    for page in sorted(headed):
        if not headed[page]:
            warnings.append({
                "check": "HEAD01",
                "line": 0,
                "message": (f"{page} renders no heading widget. Stock Atlas layouts show the app"
                            f" brand, not the page title, so a page with no heading opens"
                            f" unlabelled -- unless this app puts headings in a shared snippet"),
            })
    return warnings


# `create or replace navigation <Profile>` starts a profile's block in DESCRIBE NAVIGATION output.
PROFILE_RE = re.compile(r"^\s*create\s+(?:or\s+replace\s+)?navigation\s+(?P<name>\w+)", re.IGNORECASE)
# One `menu item '<caption>' ...;` line.
MENU_ITEM_RE = re.compile(r"^\s*menu\s+item\s+'(?P<caption>[^']*)'(?P<rest>.*)$", re.IGNORECASE)
SIGN_OUT_RE = re.compile(r"\bsign_out\b", re.IGNORECASE)


def menu_items(navigation: str) -> dict[str, list[tuple[str, bool]]]:
    """{profile: [(caption, is sign_out), ...]} in menu order; profiles without a menu are absent."""
    menus: dict[str, list[tuple[str, bool]]] = {}
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        item = MENU_ITEM_RE.match(line)
        if item and profile:
            menus.setdefault(profile, []).append(
                (item.group("caption"), bool(SIGN_OUT_RE.search(item.group("rest")))))
    return menus


def sign_out_findings(navigation: str, other_mdl: str) -> tuple[list[dict], list[dict]]:
    """NAV01 / NAV02: an app whose users sign in needs a way to log out."""
    failures, warnings = [], []
    button_elsewhere = bool(SIGN_OUT_RE.search(other_mdl))
    for profile, items in sorted(menu_items(navigation).items()):
        signs_out = [index for index, (_caption, is_sign_out) in enumerate(items) if is_sign_out]
        if not signs_out:
            if not button_elsewhere:
                failures.append({
                    "check": "NAV01",
                    "line": 0,
                    "message": (f"navigation profile {profile}: users sign in, but its menu has no way to log"
                                f" out -- add `menu item 'Log out' sign_out icon Atlas_Core.Atlas_Filled.logout;`"
                                f" as the last menu item (DESCRIBE NAVIGATION {profile} first and keep the other items)"),
                })
        elif signs_out[-1] != len(items) - 1:
            warnings.append({
                "check": "NAV02",
                "line": 0,
                "message": f"navigation profile {profile}: the Log out item is not the last item of the menu",
            })
    return failures, warnings



# `home page Module.Page for Role` in DESCRIBE NAVIGATION output; the default home page has no `for`.
ROLE_HOME_RE = re.compile(r"^\s*home\s+page\s+(?P<page>[\w.]+)\s+for\s+(?P<role>[\w.]+)", re.IGNORECASE)
MENU_PAGE_RE = re.compile(r"^\s*menu\s+item\s+'[^']*'\s+page\s+(?P<page>[\w.]+)", re.IGNORECASE)

# The one-menu-for-every-role fact the NAV03/NAV04 messages carry, so the fix needs no lookup.
ONE_MENU = ("one menu serves every role: Mendix hides a menu item from a user who cannot open its page, so"
            " give each role its pages with `grant view on page` and list them all in the menu")


def role_home_findings(navigation: str) -> list[dict]:
    """NAV03: a role opens on a page its menu does not offer, so it cannot get back there."""
    failures = []
    homes: dict[str, list[tuple[str, str]]] = {}
    menu_pages: dict[str, set[str]] = {}
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        home = ROLE_HOME_RE.match(line)
        if home and profile:
            homes.setdefault(profile, []).append((home.group("page"), home.group("role")))
        item = MENU_PAGE_RE.match(line)
        if item and profile:
            menu_pages.setdefault(profile, set()).add(item.group("page").lower())
    for profile, pairs in sorted(homes.items()):
        for page, role in pairs:
            if page.lower() in menu_pages.get(profile, set()):
                continue
            failures.append({
                "check": "NAV03",
                "line": 0,
                "message": (f"navigation profile {profile}: role {role} opens on {page}, which is not in the menu"
                            f" -- add `menu item '<caption>' page {page} icon <icon>;` before Log out"
                            f" (DESCRIBE NAVIGATION {profile} first and keep the other items); {ONE_MENU}"),
            })
    return failures


LAYOUT_RE = re.compile(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?layout\s+(?P<name>[\w.]+)", re.IGNORECASE)
SHOW_PAGE_RE = re.compile(r"\bshow_page\s+(?P<page>[\w.]+)", re.IGNORECASE)


def layout_menu_findings(layouts: str) -> list[dict]:
    """NAV04: a project layout that navigates with buttons instead of the navigation menu."""
    targets: dict[str, list[str]] = {}
    layout = ""
    for line in layouts.splitlines():
        found = LAYOUT_RE.match(line)
        if found:
            layout = found.group("name")
            continue
        if not layout:
            continue
        for hit in SHOW_PAGE_RE.finditer(line):
            pages = targets.setdefault(layout, [])
            if hit.group("page") not in pages:
                pages.append(hit.group("page"))
    failures = []
    for layout, pages in sorted(targets.items()):
        if len(pages) < 2:
            continue  # one link, a logo to the home page say, is not a menu
        failures.append({
            "check": "NAV04",
            "line": 0,
            "message": (f"layout {layout} is a hand-built menu (buttons to {', '.join(pages[:4])}) -- it has no"
                        f" hamburger, no active item and no phone view. Put those pages in the navigation"
                        f" menu (`create or replace navigation`), move the pages to Atlas_Core.Atlas_Default"
                        f" and drop the layout; {ONE_MENU}"),
        })
    return failures

def check(lines: list[str]) -> tuple[list[dict], list[dict], int]:
    """Return (failures, warnings, page count)."""
    widgets = parse(lines)
    failures = invalid_value_findings(widgets)

    for (page, _parent, _indent), group in siblings(widgets).items():
        if len(group) < 2:
            continue
        failures.extend(heading_findings(page, group))
        for run in runs_of(group):
            if len(run) < 2:
                continue
            failures.extend(run_gap_findings(page, run))
            failures.extend(run_alignment_findings(page, run))

    headed = headed_pages(widgets)
    return failures, missing_heading_warnings(headed), len(headed)


def collect(sources: list[Path]) -> tuple[str, list[Path]]:
    """Joined text of every .mdl under sources, and the files read."""
    chunks, used = [], []
    for source in sources:
        files = sorted(source.rglob("*.mdl")) if source.is_dir() else ([source] if source.exists() else [])
        for file in files:
            chunks.append(file.read_text(encoding="utf-8", errors="replace"))
            used.append(file)
    return "\n".join(chunks), used


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path, help="describe-page dumps, or a directory of them")
    parser.add_argument("--navigation", type=Path, help="DESCRIBE NAVIGATION output")
    parser.add_argument("--sign-out-sources", type=Path, action="append", default=[],
                        help="more dumps (snippets) where a sign-out button counts")
    parser.add_argument("--layouts", type=Path, action="append", default=[],
                        help="describe-layout dumps of the project's own layouts")
    parser.add_argument("--users-sign-in", action="store_true",
                        help="project security is on, so the menu needs a Log out item")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    text, used = collect(args.sources)
    if not text.strip():
        print(f"FAIL  no MDL found in {[str(s) for s in args.sources]}", file=sys.stderr)
        return 1

    failures, warnings, pages = check(text.splitlines())
    if args.users_sign_in and args.navigation and args.navigation.exists():
        extra, _ = collect(args.sign_out_sources)
        nav_failures, nav_warnings = sign_out_findings(
            args.navigation.read_text(encoding="utf-8", errors="replace"), text + "\n" + extra)
        failures += nav_failures
        warnings += nav_warnings
        failures += role_home_findings(args.navigation.read_text(encoding="utf-8", errors="replace"))
    if args.layouts:
        layouts, _ = collect(args.layouts)
        failures += layout_menu_findings(layouts)
    report = {
        "verdict": "PASS" if not failures else "FAIL",
        "pages": pages,
        "sources": [str(p) for p in used],
        "failures": failures,
        "warnings": warnings,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"{report['verdict']}  {len(failures)} failure(s) over {pages} page(s)")
        for failure in failures:
            print(f"  - [{failure['check']}] line {failure['line']}: {failure['message']}")
        for warning in warnings:
            print(f"  ! [{warning['check']}] {warning['message']}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
