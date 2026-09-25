"""LAYOUT01 (every page on the same layout, pop-ups and login aside) and NAV04 (a layout of
the project's own that builds a menu out of buttons).

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re

from .navigation import ONE_MENU
from .pages import PAGE_LAYOUT_RE, page_blocks


# LAYOUT01 -----------------------------------------------------------------------------------
# Layouts that are rightly different from the app's main one: a pop-up closes with its own X, a
# login page has no menu, and phone/tablet profiles have layouts of their own.
OWN_KIND_LAYOUT_RE = re.compile(r"popup|login|phone|tablet", re.IGNORECASE)
LAYOUT_TYPE_RE = re.compile(r"layouttype:\s*'(?P<type>\w+)'", re.IGNORECASE)
LOGIN_PAGE_RE = re.compile(r"^\s*login\s+page\s+(?P<page>[\w.]+)", re.IGNORECASE)


def layout_types(layouts: str) -> dict[str, str]:
    """{Module.Layout: layouttype} for the project's own layouts."""
    types, layout = {}, ""
    for line in layouts.splitlines():
        found = LAYOUT_RE.match(line)
        if found:
            layout = found.group("name")
        kind = LAYOUT_TYPE_RE.search(line)
        if kind and layout:
            types.setdefault(layout, kind.group("type"))
    return types


def one_layout_findings(lines: list[str], navigation: str, layouts: str) -> list[dict]:
    """LAYOUT01: every page of the app is framed by the same layout."""
    types = layout_types(layouts)
    login_pages = {m.group("page") for m in map(LOGIN_PAGE_RE.match, navigation.splitlines()) if m}
    by_layout: dict[str, list[str]] = {}
    for page, block in page_blocks(lines).items():
        found = PAGE_LAYOUT_RE.search("\n".join(block[:8]))
        if not found or page in login_pages:
            continue
        layout = found.group("layout")
        if OWN_KIND_LAYOUT_RE.search(layout) or OWN_KIND_LAYOUT_RE.search(types.get(layout, "")):
            continue
        by_layout.setdefault(layout, []).append(page)
    if len(by_layout) < 2:
        return []
    ranked = sorted(by_layout.items(), key=lambda item: (-len(item[1]), item[0]))
    main = ranked[0][0]
    summary = "; ".join(f"{layout} ({len(pages)}: {', '.join(pages[:4])}{', ...' if len(pages) > 4 else ''})"
                        for layout, pages in ranked)
    # One statement per module and layout: ALTER PAGES takes a single module.
    moves = " ".join(
        f"`alter pages in {module} set layout = {main} where layout = {layout};`"
        for layout, pages in ranked[1:]
        for module in dict.fromkeys(page.split(".")[0] for page in pages))
    return [{
        "check": "LAYOUT01",
        "line": 0,
        "message": (f"the app's pages use {len(ranked)} layouts, so the menu and whether it is open change from"
                    f" page to page: {summary} -- pick ONE for every page that is not a pop-up, e.g. the most used,"
                    f" {main}: {moves} Then set the same `Layout:` in the scripts that create those pages,"
                    f" or re-running them moves the pages back"),
    }]


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
