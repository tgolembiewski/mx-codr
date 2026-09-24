#!/usr/bin/env python3
"""Check that page widgets are spaced with Atlas Spacing design properties.

Input: `describe page` dumps (.mdl files or directories), normally from tests/gate.sh;
optionally `DESCRIBE NAVIGATION` output (--navigation), snippet dumps (--sign-out-sources),
`describe layout` dumps of the project's own layouts (--layouts) and microflow/nanoflow dumps
whose `show page` also opens pages (--opened-from).
Usage: check_layout.py <file.mdl|dir> ... [--navigation nav.mdl] [--sign-out-sources dir]
                       [--layouts dir] [--opened-from dir] [--users-sign-in] [--json]
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
#   GRID01   FAIL  a grid filter in a column with no Attribute (and none of its own): it renders
#                  "Unable to get filter store" and filters nothing
#   LAYOUT01 FAIL  the app's pages (pop-ups, login and phone/tablet pages aside) use more than one
#                  layout: the menu and its open/closed state change from page to page
#   ICON01   FAIL  a button (actionbutton, linkbutton) without an icon; the message suggests one
#                  from its action and caption
#   USER01   FAIL  users sign in, and a page (pop-ups and the login page aside) does not open with
#                  the "who is signed in" snippet, <Module>.SNIPPET_CurrentUser, on the right of its top
#                  row -- first, or right after the Back button in the same container
#   BACK01   FAIL  a page another page or a flow opens (show_page) does not start with a Back
#                  button: close_page, icon chevron-left, top left. Pop-ups are exempt (they have X)
#   ACCOUNT01 FAIL users sign in, the Administration module is there, and the menu has no item for
#                  Administration.Account_Overview (user management; only administrators see it)
#   ACCOUNT02 FAIL ... and no item for microflow Administration.ManageMyAccount (every user's own
#                  account and password; it opens Administration.MyAccount, which needs an account)
#   ACCOUNT03 FAIL a user role that signs in lacks Administration.User, or no role has
#                  Administration.Administrator
#   MODULE01 FAIL  the app has its own module with pages, and the template's MyFirstModule is still
#                  there; lists everything that still uses it and how to remove it
#   HOME01   FAIL  the administrators' role does not open on a page of the app's own modules
#   NAV05    FAIL  a menu item or sub-menu with no icon (the message suggests one for its caption)
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


COLUMN_RE = re.compile(r"^\s*column\s+(?P<name>\"[^\"]*\"|[\w/.]+)", re.IGNORECASE)
FILTER_RE = re.compile(r"^\s*(?P<type>textfilter|numberfilter|datefilter|dropdownfilter)\s+(?P<name>\w+)(?P<rest>.*)$",
                       re.IGNORECASE)
# A filter's own target: `Attribute:`, `attributes: [...]` or `Association:`.
FILTER_TARGET_RE = re.compile(r"\b(attributes?|association)\s*:", re.IGNORECASE)
PAGE_RE = re.compile(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?page\s+(?P<name>[\w.]+)", re.IGNORECASE)


def column_filter_findings(lines: list[str]) -> list[dict]:
    """GRID01: a filter only works on the column's attribute; with none, Data Grid 2 shows an error box."""
    failures = []
    page = ""
    index = 0
    while index < len(lines):
        line = lines[index]
        found = PAGE_RE.match(line)
        if found:
            page = found.group("name")
        column = COLUMN_RE.match(line)
        if not column:
            index += 1
            continue
        # The header runs to the line that opens the body (`{`) or closes without one.
        header, start = [], index
        while index < len(lines):
            header.append(lines[index])
            if lines[index].rstrip().endswith("{") or lines[index].rstrip().endswith(")"):
                break
            index += 1
        opens_body = header[-1].rstrip().endswith("{")
        index += 1
        if not opens_body:
            continue
        has_attribute = bool(re.search(r"\bAttribute\s*:", " ".join(header), re.IGNORECASE))
        # Scan the body for the column's own filters, then resume right after the header: a
        # layoutgrid column holds whole datagrids whose columns need checking too.
        body_start, depth = index, 1
        while index < len(lines) and depth > 0:
            body = lines[index]
            flt = FILTER_RE.match(body)
            if flt and depth == 1 and not has_attribute:
                own = flt.group("rest")
                # A filter's properties may continue on the lines below `name (`.
                look = index + 1
                if own.rstrip().endswith("("):
                    while look < len(lines) and not lines[look].strip().startswith(")"):
                        own += " " + lines[look]
                        look += 1
                if not FILTER_TARGET_RE.search(own):
                    failures.append({
                        "check": "GRID01",
                        "line": start + 1,
                        "message": (f"{page}: column {column.group('name')} has a {flt.group('type').lower()}"
                                    f" {flt.group('name')} but no Attribute -- the filter filters on the column's"
                                    f" attribute, so it renders \"Unable to get filter store\" and filters nothing."
                                    f" Add the attribute it should filter to the column, e.g. `column colCreated"
                                    f" (Attribute: DateCreated, Caption: 'Created', ShowContentAs: dynamicText, ...)`;"
                                    f" the column still shows its Content"),
                    })
            depth += body.count("{") - body.count("}")
            index += 1
        index = body_start
    return failures


# ICON01 -------------------------------------------------------------------------------------
BUTTON_TYPES = ("actionbutton", "linkbutton")
DOCUMENT_RE = re.compile(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:page|snippet)\s+(?P<name>[\w.]+)",
                         re.IGNORECASE)
CAPTION_RE = re.compile(r"\bCaption:\s*'(?P<caption>[^']*)'", re.IGNORECASE)
ACTION_RE = re.compile(r"\bAction:\s*(?P<action>[a-z_]+(?:\s+close_page)?)", re.IGNORECASE)
BUTTON_ICON_RE = re.compile(r"\bIcon:", re.IGNORECASE)
# What the button does -> an Atlas_Filled icon that shows it. The action decides first (a Back
# button is close_page whatever its caption), then words in the caption; first match wins.
ACTION_ICONS = (
    ("delete", "trash-can"),
    ("save_changes", "floppy-disk"),
    ("cancel_changes", "remove"),
    ("sign_out", "logout"),
    ("close_page", "chevron-left"),
)
CAPTION_ICONS = (
    (("back",), "chevron-left"),
    (("advance", "next", "move to", "forward", "proceed", "start"), "arrow-right"),
    (("discard",), "trash-can"),
    (("reset", "restore"), "refresh"),
    (("new", "add", "create"), "add"),
    (("edit", "change", "modify", "update"), "pencil"),
    (("delete", "remove"), "trash-can"),
    (("save",), "floppy-disk"),
    (("cancel", "close"), "remove"),
    (("search", "find"), "search"),
    (("pdf",), "file-pdf"),
    (("invoice", "bill"), "cash-payment-bill"),
    (("download", "export"), "download-bottom"),
    (("upload", "import"), "upload-bottom"),
    (("print",), "print"),
    (("send", "email", "mail", "remind", "notify"), "email"),
    (("refresh", "reload", "sync"), "refresh"),
    (("copy", "duplicate"), "copy"),
    (("approve", "confirm", "accept", "submit", "complete", "done"), "checkmark"),
    (("reject", "decline", "deny"), "thumbs-down"),
    (("filter",), "filter"),
    (("pay",), "credit-card"),
    (("ship", "deliver"), "shipment-box"),
    (("order", "cart"), "shopping-cart"),
    (("setting", "setup", "config"), "cog"),
    (("view", "open", "detail", "show"), "view"),
    (("log out", "logout", "sign out"), "logout"),
)


def button_icon(action: str, caption: str) -> str:
    action, caption = action.lower(), caption.lower()
    for key, icon in ACTION_ICONS:
        if key in action and not (key == "close_page" and ("save" in action or "cancel" in action)):
            return icon
    for words, icon in CAPTION_ICONS:
        if any(re.search(r"\b" + re.escape(word), caption) for word in words):
            return icon
    return ""


def button_icon_findings(lines: list[str]) -> list[dict]:
    """ICON01: every button carries an icon that shows what it does."""
    failures, document = [], ""
    for index, line in enumerate(lines):
        found = DOCUMENT_RE.match(line)
        if found:
            document = found.group("name")
            continue
        widget = WIDGET_LINE_RE.match(line)
        if not widget or widget.group("type").lower() not in BUTTON_TYPES:
            continue
        props = line
        if line.rstrip().endswith("("):
            look = index + 1
            while look < len(lines) and not lines[look].strip().startswith(")"):
                props += " " + lines[look].strip()
                look += 1
        if BUTTON_ICON_RE.search(props):
            continue
        caption = CAPTION_RE.search(props)
        action = ACTION_RE.search(props)
        icon = button_icon(action.group("action") if action else "", caption.group("caption") if caption else "")
        fix = ("an icon that shows what it does, e.g. " + f"`Icon: 'Atlas_Core.Atlas_Filled.{icon}'`" if icon else
               "an icon that shows what it does, from `DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled`")
        failures.append({
            "check": "ICON01",
            "line": index + 1,
            "message": (f"{document}: {widget.group('type').lower()} {widget.group('name')}"
                        f"{' (' + repr(caption.group('caption')) + ')' if caption else ''} has no icon -- add {fix}"
                        f" to its properties; every button shows what it does with an icon"),
        })
    return failures


# USER01 -------------------------------------------------------------------------------------
SNIPPET_DEF_RE = re.compile(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?snippet\s+(?P<name>[\w.]+)", re.IGNORECASE)


def row_pushes_right(block: list[str]) -> bool:
    """The container around the current-user snippet lays out as a row that puts it at the right edge."""
    lines = block
    at = next((i for i, line in enumerate(lines)
               if "snippetcall" in line and CURRENT_USER_SNIPPET in line), None)
    if at is None:
        return False
    indent = len(lines[at]) - len(lines[at].lstrip())
    for i in range(at - 1, -1, -1):
        line = lines[i]
        own = len(line) - len(line.lstrip())
        if own < indent and re.match(r"^\s*container\s", line):
            head = line
            j = i + 1
            while not head.rstrip().endswith("{") and j < at:
                head += " " + lines[j].strip()
                j += 1
            return "Flex container" in head and re.search(r"Align items X'\s*:\s*'(Right|Space between)", head) is not None
        if own < indent and WIDGET_LINE_RE.match(line):
            return False  # directly in a column or data view: nothing aligns it
    return False


def current_user_findings(lines: list[str], snippets: str, navigation: str, layouts: str) -> list[dict]:
    """USER01: every page shows who is signed in, in the same place -- its first widget, top right."""
    defined = [m.group("name") for m in map(SNIPPET_DEF_RE.match, snippets.splitlines())
               if m and m.group("name").endswith("." + CURRENT_USER_SNIPPET)]
    types = layout_types(layouts)
    login_pages = {m.group("page") for m in map(LOGIN_PAGE_RE.match, navigation.splitlines()) if m}
    missing, unaligned, failures = [], [], []
    for page, block in page_blocks(lines).items():
        layout = PAGE_LAYOUT_RE.search("\n".join(block[:8]))
        name = layout.group("layout") if layout else ""
        if page in login_pages or re.search(r"popup|login", name + " " + types.get(name, ""), re.IGNORECASE):
            continue
        lead = leading_widgets(block)
        is_user = lambda w: w[0] == "snippetcall" and CURRENT_USER_SNIPPET in w[1]
        # First on the page, or right after the Back button in the same row.
        if lead and (is_user(lead[0]) or (len(lead) == 2 and is_back_button(lead[0][0], lead[0][1])
                                          and is_user(lead[1]) and lead[0][2] == lead[1][2])):
            if not row_pushes_right(block):
                unaligned.append(page)
            continue
        missing.append(page)
    if unaligned:
        failures.append({"check": "USER01", "line": 0, "message": (
            f"{len(unaligned)} page(s) show who is signed in on the left: {', '.join(unaligned[:6])} -- the row"
            f" holding the snippet needs DesignProperties ['Flex container': 'Horizontal (row)', 'Align items X':"
            f" 'Space between (only for horizontal containers)'] when the Back button is in it, or ['Flex container': 'Horizontal (row)', 'Align"
            f" items X': 'Right'] when it is not; 'Align items X' does nothing without 'Flex container'")})
    if not missing:
        return failures
    module = missing[0].split(".")[0]
    snippet = defined[0] if defined else f"{module}.{CURRENT_USER_SNIPPET}"
    how = ("" if defined else
           f" {snippet} does not exist yet: create it as the spacing-and-layout skill shows -- a non-persistent"
           f" {module}.SignedInUser with a Label, a microflow DS_SignedInUser filling it with the account's e-mail"
           f" or user name, and the snippet: a data view on"
           f" that microflow with `linkbutton lnkCurrentUser (Caption: '{{1}}', CaptionParams: [{{1}} = Label],"
           f" Icon: 'Atlas_Core.Atlas_Filled.user', Action: microflow Administration.ManageMyAccount)`.")
    shown = ", ".join(missing[:6]) + (f" and {len(missing) - 6} more" if len(missing) > 6 else "")
    return failures + [{"check": "USER01", "line": 0, "message": (
        f"{len(missing)} page(s) do not start with who is signed in: {shown} -- open each page with one row"
        f" above the heading: with a Back button, `container ctPageTop (DesignProperties: ['Flex container':"
        f" 'Horizontal (row)', 'Align items X': 'Space between (only for horizontal containers)', 'Align items Y': 'Center']) {{ <the Back"
        f" button> snippetcall scCurrentUser (Snippet: {snippet}) }}`; without one, the same container with"
        f" 'Align items X': 'Right' and only the snippet call. Back stays on the left, the user's icon and"
        f" e-mail sit on the right, just under the language selector, on every page.{how}")}]


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


# BACK01 -------------------------------------------------------------------------------------
SHOW_PAGE_ANY_RE = re.compile(r"\bshow[_ ]page\s+(?P<page>[A-Za-z_]\w*\.[A-Za-z_]\w*)", re.IGNORECASE)
PAGE_LAYOUT_RE = re.compile(r"\bLayout:\s*(?P<layout>[\w.]+)", re.IGNORECASE)
WIDGET_LINE_RE = re.compile(r"^\s*(?P<type>[a-z]+)\s+(?P<name>\"[^\"]*\"|[\w.]+)\s*(?P<rest>[({].*)?$", re.IGNORECASE)
# Containers a Back button may sit inside and still be the first thing on the page.
BACK_WRAPPERS = {"layoutgrid", "row", "column", "container", "dataview", "scrollcontainer", "region", "header"}
BACK_ICON = 'Atlas_Core.Atlas_Filled.chevron-left'
BACK_BUTTON = (f"actionbutton btnBack (Caption: 'Back', Action: CLOSE_PAGE, Icon: '{BACK_ICON}',"
               f" DesignProperties: ['Spacing': ['margin-bottom': 'M']])")


def page_blocks(lines: list[str]) -> dict[str, list[str]]:
    """{page: its describe lines}, in dump order."""
    blocks: dict[str, list[str]] = {}
    page = ""
    for line in lines:
        found = PAGE_RE.match(line)
        if found:
            page = found.group("name")
            blocks[page] = []
        if page:
            blocks[page].append(line)
    return blocks


# The "who is signed in" snippet sits above everything, the Back button included (USER01).
CURRENT_USER_SNIPPET = "SNIPPET_CurrentUser"


def first_widget(block: list[str]) -> tuple[str, str]:
    """(type, full property text) of the first widget that is not a container."""
    # The page header (`create page X (` ... `) {`) ends at its first line ending in `{`.
    body = next((i + 1 for i, line in enumerate(block) if line.rstrip().endswith("{")), len(block))
    for index in range(body, len(block)):
        line = block[index]
        if line.strip().startswith("--"):
            continue
        found = WIDGET_LINE_RE.match(line)
        if not found or found.group("type").lower() in BACK_WRAPPERS:
            continue
        props = line
        if line.rstrip().endswith("("):
            look = index + 1
            while look < len(block) and not block[look].strip().startswith(")"):
                props += " " + block[look].strip()
                look += 1
        return found.group("type").lower(), props
    return "", ""


def leading_widgets(block: list[str], count: int = 2) -> list[tuple[str, str, int]]:
    """(type, property text, indent) of the first <count> widgets that are not containers."""
    body = next((i + 1 for i, line in enumerate(block) if line.rstrip().endswith("{")), len(block))
    found = []
    for index in range(body, len(block)):
        line = block[index]
        widget = WIDGET_LINE_RE.match(line)
        if line.strip().startswith("--") or not widget or widget.group("type").lower() in BACK_WRAPPERS:
            continue
        props = line
        if line.rstrip().endswith("("):
            look = index + 1
            while look < len(block) and not block[look].strip().startswith(")"):
                props += " " + block[look].strip()
                look += 1
        found.append((widget.group("type").lower(), props, len(line) - len(line.lstrip())))
        if len(found) == count:
            break
    return found


def is_back_button(wtype: str, props: str) -> bool:
    return (wtype in ("actionbutton", "linkbutton") and re.search(r"close_page", props, re.IGNORECASE) is not None
            and "chevron-left" in props)


def back_button_findings(lines: list[str], opened_from: str) -> list[dict]:
    """BACK01: every page reached from another page or a flow starts with a way back."""
    blocks = page_blocks(lines)
    openers: dict[str, list[str]] = {}
    for page, block in blocks.items():
        for hit in SHOW_PAGE_ANY_RE.finditer("\n".join(block[1:])):
            if hit.group("page") != page:
                openers.setdefault(hit.group("page"), []).append(page)
    flow = ""
    for line in opened_from.splitlines():
        head = re.match(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:microflow|nanoflow)\s+(?P<name>[\w.]+)",
                        line, re.IGNORECASE)
        if head:
            flow = head.group("name")
        for hit in SHOW_PAGE_ANY_RE.finditer(line):
            openers.setdefault(hit.group("page"), []).append(flow or "a flow")
    failures = []
    for page, sources in sorted(openers.items()):
        block = blocks.get(page)
        if not block:
            continue  # not one of this project's pages
        layout = PAGE_LAYOUT_RE.search("\n".join(block[:8]))
        if layout and "popup" in layout.group("layout").lower():
            continue  # a pop-up closes with its own X
        wtype, props = first_widget(block)
        if is_back_button(wtype, props):
            continue
        has_close = re.search(r"close_page", "\n".join(block), re.IGNORECASE) is not None
        where = ", ".join(dict.fromkeys(sources))
        if not has_close:
            problem = "has no way back"
        elif wtype not in ("actionbutton", "linkbutton") or not re.search(r"close_page", props, re.IGNORECASE):
            problem = "has a close button, but not as its first widget (top left)"
        else:
            problem = "starts with its close button, but without the chevron-left icon"
        failures.append({
            "check": "BACK01",
            "line": 0,
            "message": (f"{page} is opened from {where} and {problem} -- make the first widget of the page,"
                        f" before its heading, `{BACK_BUTTON}`: CLOSE_PAGE returns to the page it came from"),
        })
    return failures


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


# A sub-menu line: `menu '<caption>' [icon ...] (`.
SUB_MENU_RE = re.compile(r"^\s*menu\s+'(?P<caption>[^']*)'(?P<rest>.*)$", re.IGNORECASE)
ICON_RE = re.compile(r"\bicon\b", re.IGNORECASE)
# Caption words -> an Atlas_Filled icon that shows the same thing; first match wins.
ICON_HINTS = (
    (("log out", "logout", "sign out"), "logout"),
    (("home", "start"), "home"),
    (("dashboard", "overview", "kpi"), "dashboard"),
    (("report", "analytic", "statistic", "chart"), "analytics-bars"),
    (("invoice", "bill"), "cash-payment-bill"),
    (("payment", "credit"), "credit-card"),
    (("order", "cart", "purchase"), "shopping-cart"),
    (("shipment", "delivery", "product", "stock"), "shipment-box"),
    (("customer", "client", "contact", "user", "people", "employee", "account"), "user-neutral-group"),
    (("task", "todo", "approval", "inbox"), "task-list-multiple"),
    (("document", "file", "contract"), "document"),
    (("calendar", "schedule", "planning"), "calendar"),
    (("mail", "message", "email"), "email"),
    (("setup", "setting", "config", "admin"), "cog"),
    (("search", "find"), "search"),
)


def suggested_icon(caption: str) -> str:
    low = caption.lower()
    for words, icon in ICON_HINTS:
        if any(word in low for word in words):
            return f'Atlas_Core.Atlas_Filled.{icon}' if "-" not in icon else f'Atlas_Core.Atlas_Filled."{icon}"'
    return ""


def menu_icon_findings(navigation: str) -> list[dict]:
    """NAV05: every menu entry carries an icon that shows what it opens."""
    failures = []
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        entry = MENU_ITEM_RE.match(line) or SUB_MENU_RE.match(line)
        if not entry or not profile or ICON_RE.search(entry.group("rest")):
            continue
        caption = entry.group("caption")
        icon = suggested_icon(caption)
        fix = (f"`icon {icon}`" if icon else
               "an icon that shows what it opens, from `DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled`")
        failures.append({
            "check": "NAV05",
            "line": 0,
            "message": (f"navigation profile {profile}: menu entry '{caption}' has no icon -- add {fix} at the end"
                        f" of its line; with the sidebar collapsed the icon is all a user sees"),
        })
    return failures


# ACCOUNT01-03 ---------------------------------------------------------------------------------
ADMIN_PAGE = "Administration.Account_Overview"
MY_ACCOUNT_FLOW = "Administration.ManageMyAccount"
ADMIN_ITEM = f"menu item 'Users' page {ADMIN_PAGE} icon Atlas_Core.Atlas_Filled.\"user-neutral-group\";"
MY_ACCOUNT_ITEM = f"menu item 'My account' microflow {MY_ACCOUNT_FLOW} icon Atlas_Core.Atlas_Filled.user;"
USER_ROLE_RE = re.compile(r"^\s*create\s+user\s+role\s+(?P<name>[\w.]+)\s*\((?P<roles>[^)]*)\)", re.IGNORECASE)


def account_findings(navigation: str, user_roles: str, guest_role: str) -> list[dict]:
    """ACCOUNT01-03: user management for administrators, own account and password for everyone."""
    failures = []
    targets: dict[str, str] = {}
    profile = ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            targets.setdefault(profile, "")
            continue
        if profile and MENU_ITEM_RE.match(line):
            targets[profile] += line + "\n"
    for profile, menu in sorted(targets.items()):
        if not menu:
            continue  # a profile without a menu is not where users navigate
        if not re.search(r"\bpage\s+" + re.escape(ADMIN_PAGE) + r"\b", menu, re.IGNORECASE):
            failures.append({"check": "ACCOUNT01", "line": 0, "message": (
                f"navigation profile {profile}: no menu item for user management -- add `{ADMIN_ITEM}` before"
                f" Log out. It is the Administration module's own page; only Administration.Administrator can"
                f" open it, so everyone else never sees the item")})
        if not re.search(r"\bmicroflow\s+" + re.escape(MY_ACCOUNT_FLOW) + r"\b", menu, re.IGNORECASE):
            failures.append({"check": "ACCOUNT02", "line": 0, "message": (
                f"navigation profile {profile}: no menu item for the user's own account and password -- add"
                f" `{MY_ACCOUNT_ITEM}` before Log out. It opens Administration.MyAccount (view the account,"
                f" change the password) for whoever is signed in; a menu item cannot open MyAccount itself,"
                f" because the page needs the account as its parameter")})
    roles = {m.group("name"): {r.strip() for r in m.group("roles").split(",")}
             for m in map(USER_ROLE_RE.match, user_roles.splitlines()) if m}
    for name, module_roles in sorted(roles.items()):
        if name == guest_role or "Administration.User" in module_roles:
            continue
        failures.append({"check": "ACCOUNT03", "line": 0, "message": (
            f"user role {name} signs in but lacks Administration.User, so 'My account' is hidden from it and"
            f" its users cannot change their password -- `alter user role {name} add module roles"
            f" (Administration.User);`")})
    if roles and not any("Administration.Administrator" in r for r in roles.values()):
        failures.append({"check": "ACCOUNT03", "line": 0, "message": (
            "no user role has Administration.Administrator, so nobody can manage users -- add it to the"
            " administrators' role: `alter user role Administrator add module roles (Administration.Administrator);`")})
    return failures


# MODULE01 / HOME01 ---------------------------------------------------------------------------
TEMPLATE_MODULE = "MyFirstModule"
TEMPLATE_USE_RE = re.compile(TEMPLATE_MODULE + r"[.][\w.]+")
HOME_RE = re.compile(r"^\s*home\s+page\s+(?P<page>[\w.]+)(?:\s+for\s+(?P<role>[\w.]+))?", re.IGNORECASE)


def admin_roles(user_roles: str) -> list[str]:
    """User roles that administer the app: Administration.Administrator, or `manage all roles`."""
    found = []
    for line in user_roles.splitlines():
        role = USER_ROLE_RE.match(line)
        if role and ("Administration.Administrator" in role.group("roles") or "manage all roles" in line.lower()):
            found.append(role.group("name"))
    return found


def template_module_findings(own_modules: list[str], has_pages: bool, navigation: str, user_roles: str,
                             own_mdl: str) -> list[dict]:
    """MODULE01: once the app has a module of its own, the template's MyFirstModule is dead weight."""
    if not own_modules or not has_pages:
        return []
    uses = []
    for line in navigation.splitlines():
        if TEMPLATE_MODULE + "." in line and ("home page" in line.lower() or "menu item" in line.lower()):
            uses.append("navigation: " + line.strip().rstrip(";"))
    for line in user_roles.splitlines():
        role = USER_ROLE_RE.match(line)
        if role and TEMPLATE_MODULE + "." in role.group("roles"):
            uses.append(f"user role {role.group('name')} has {TEMPLATE_MODULE}.User")
    document = ""
    for line in own_mdl.splitlines():
        head = re.match(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:page|snippet|microflow|nanoflow)\s+([\w.]+)",
                        line, re.IGNORECASE)
        if head:
            document = head.group(1)
        used = TEMPLATE_USE_RE.search(line)
        if used and document:
            uses.append(f"{document} uses {used.group(0)}")
    uses = list(dict.fromkeys(uses))
    main = own_modules[0]
    steps = []
    if any(use.startswith("navigation:") for use in uses):
        steps.append(f"point every `home page`/`menu item` at pages of {main} -- the administrators get their own"
                     f" home page there (e.g. {main}.Admin_Home), and the profile keeps a default `home page"
                     f" {main}.<Page>` without `for` (without one mx check fails CE0527)")
    if any(" uses " in use for use in uses):
        steps.append(f"move what your pages or flows use from {TEMPLATE_MODULE} (an image, a flow) into {main}")
    if any(use.startswith("user role") for use in uses):
        steps.append(f"`alter user role <Role> remove module roles ({TEMPLATE_MODULE}.User);` for each role listed")
    steps.append(f"`drop module {TEMPLATE_MODULE};`, and remove {TEMPLATE_MODULE} from the scripts in mdlsource/"
                 f" so a re-run does not bring it back")
    steps = "; ".join(f"{n}. {step}" for n, step in enumerate(steps, 1))
    found = "; ".join(uses[:8]) + (f"; ... {len(uses) - 8} more" if len(uses) > 8 else "") if uses else "nothing"
    return [{"check": "MODULE01", "line": 0, "message": (
        f"{TEMPLATE_MODULE} is the empty template's module and this app has its own ({', '.join(own_modules)})"
        f" -- remove it. Still using it: {found}. Steps: {steps}")}]


def admin_home_findings(navigation: str, user_roles: str, own_modules: list[str]) -> list[dict]:
    """HOME01: administrators open on a page of the app itself, not the template's Home_Web."""
    failures = []
    default, by_role, profile = {}, {}, ""
    for line in navigation.splitlines():
        found = PROFILE_RE.match(line)
        if found:
            profile = found.group("name")
            continue
        home = HOME_RE.match(line)
        if home and profile:
            if home.group("role"):
                by_role.setdefault(profile, {})[home.group("role")] = home.group("page")
            else:
                default.setdefault(profile, home.group("page"))
    main = own_modules[0] if own_modules else "<YourModule>"
    for role in admin_roles(user_roles):
        for profile in sorted(set(default) | set(by_role)):
            page = by_role.get(profile, {}).get(role, default.get(profile, ""))
            if page and page.split(".")[0] in own_modules:
                continue
            failures.append({"check": "HOME01", "line": 0, "message": (
                f"navigation profile {profile}: role {role} opens on {page or 'no page'}, which is not a page of"
                f" the app's own modules -- create an administrators' home page in {main} (e.g. {main}.Admin_Home:"
                f" what an administrator starts the day with, and links to Users) and add"
                f" `home page {main}.Admin_Home for {role}` to the profile")})
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

    failures.extend(column_filter_findings(lines))

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
    parser.add_argument("--admin-module", action="store_true",
                        help="the Administration module (Account_Overview, ManageMyAccount) is in the project")
    parser.add_argument("--user-roles", type=Path, help="DESCRIBE USER ROLE output for every user role")
    parser.add_argument("--guest-role", default="", help="the anonymous user role, which does not sign in")
    parser.add_argument("--own-modules", default="",
                        help="the app's own modules, space-separated (not System, Marketplace or MyFirstModule)")
    parser.add_argument("--template-module", action="store_true", help="MyFirstModule is in the project")
    parser.add_argument("--opened-from", type=Path, action="append", default=[],
                        help="microflow/nanoflow dumps whose `show page` opens pages (BACK01)")
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
    own_modules = args.own_modules.split()
    nav_text = args.navigation.read_text(encoding="utf-8", errors="replace") if args.navigation and args.navigation.exists() else ""
    roles_all = args.user_roles.read_text(encoding="utf-8", errors="replace") if args.user_roles and args.user_roles.exists() else ""
    if args.template_module:
        flows_text, _ = collect(args.opened_from) if args.opened_from else ("", [])
        failures += template_module_findings(own_modules, bool(page_blocks(text.splitlines())), nav_text,
                                             roles_all, text + "\n" + flows_text)
    if args.users_sign_in and own_modules and nav_text:
        failures += admin_home_findings(nav_text, roles_all, own_modules)
    if args.users_sign_in:
        snippets_all, _ = collect(args.sign_out_sources) if args.sign_out_sources else ("", [])
        layouts_all, _ = collect(args.layouts) if args.layouts else ("", [])
        failures += current_user_findings(text.splitlines(), snippets_all, nav_text, layouts_all)
    if args.users_sign_in and args.admin_module and args.navigation and args.navigation.exists():
        roles_text = (args.user_roles.read_text(encoding="utf-8", errors="replace")
                      if args.user_roles and args.user_roles.exists() else "")
        failures += account_findings(args.navigation.read_text(encoding="utf-8", errors="replace"),
                                     roles_text, args.guest_role)
    if args.navigation and args.navigation.exists():
        failures += menu_icon_findings(args.navigation.read_text(encoding="utf-8", errors="replace"))
    navigation_text = (args.navigation.read_text(encoding="utf-8", errors="replace")
                       if args.navigation and args.navigation.exists() else "")
    layouts_text, _ = collect(args.layouts) if args.layouts else ("", [])
    failures += one_layout_findings(text.splitlines(), navigation_text, layouts_text)
    snippets_text, _ = collect(args.sign_out_sources) if args.sign_out_sources else ("", [])
    failures += button_icon_findings(text.splitlines() + snippets_text.splitlines())
    opened, _ = collect(args.opened_from) if args.opened_from else ("", [])
    failures += back_button_findings(text.splitlines(), opened)
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
