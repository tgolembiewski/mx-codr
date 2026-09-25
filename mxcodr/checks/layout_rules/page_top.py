"""The top row of a page: BACK01 (a page you navigate to opens with a Back button) and USER01
(who is signed in, on the right of that row).

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re

from .accounts import HOME_RE
from .layouts import LOGIN_PAGE_RE, layout_types
from .navigation import MENU_PAGE_RE
from .pages import PAGE_LAYOUT_RE, SHOW_PAGE_ANY_RE, WIDGET_LINE_RE, first_widget, leading_widgets, page_blocks


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
            f"{len(unaligned)} page(s) show the signed-in user on the left: {', '.join(unaligned[:6])} -- the"
            f" row around it needs {ROW_RIGHT_PROPS}, or 'Space between (only for horizontal containers)'"
            f" instead of 'Right' when the Back button is in it")})
    if not missing:
        return failures
    module = missing[0].split(".")[0]
    snippet = defined[0] if defined else f"{module}.{CURRENT_USER_SNIPPET}"
    shown = ", ".join(missing[:6]) + (f" and {len(missing) - 6} more" if len(missing) > 6 else "")
    missing_snippet = "" if defined else f" ({snippet} does not exist yet: the skill has it)"
    return failures + [{"check": "USER01", "line": 0, "message": (
        f"{len(missing)} page(s) lack the signed-in user top right: {shown} -- start each with `container"
        f" ctPageTop (DesignProperties: {ROW_RIGHT_PROPS}) {{ snippetcall scCurrentUser (Snippet: {snippet}) }}`;"
        f" on a page with Back, Back goes first in that row and 'Right' becomes 'Space between (only for"
        f" horizontal containers)'{missing_snippet}. Skill spacing-and-layout, 'Who is signed in'")}]
BACK_ICON = 'Atlas_Core.Atlas_Filled.chevron-left'
BACK_BUTTON = (f"actionbutton btnBack (Caption: 'Back', Action: CLOSE_PAGE, Icon: '{BACK_ICON}',"
               f" DesignProperties: ['Spacing': ['margin-bottom': 'M']])")


# The "who is signed in" snippet, on the right of every page's top row (USER01).
CURRENT_USER_SNIPPET = "SNIPPET_CurrentUser"
ROW_RIGHT_PROPS = "['Flex container': 'Horizontal (row)', 'Align items X': 'Right']"


def is_back_button(wtype: str, props: str) -> bool:
    return (wtype in ("actionbutton", "linkbutton") and re.search(r"close_page", props, re.IGNORECASE) is not None
            and "chevron-left" in props)


def back_button_findings(lines: list[str], opened_from: str, navigation: str = "") -> list[dict]:
    """BACK01: every page reached from another page or a flow starts with a way back. A menu item
    or home page is a top-level page even when a flow shows it again (back to My Orders after
    placing an order): a Back there leads nowhere, and a session deleted the flow's `show page`
    to quiet the rule."""
    blocks = page_blocks(lines)
    top_level = {found.group("page").lower() for line in navigation.splitlines()
                 for found in (MENU_PAGE_RE.match(line), HOME_RE.match(line)) if found}
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
        if page.lower() in top_level:
            continue  # reached from the menu: the menu is the way back
        layout = PAGE_LAYOUT_RE.search("\n".join(block[:8]))
        if layout and "popup" in layout.group("layout").lower():
            continue  # a pop-up closes with its own X
        wtype, props = first_widget(block)
        if is_back_button(wtype, props):
            continue
        has_close = re.search(r"close_page", "\n".join(block), re.IGNORECASE) is not None
        where = ", ".join(dict.fromkeys(sources))
        if not has_close:
            problem = "has no Back button"
        elif wtype not in ("actionbutton", "linkbutton") or not re.search(r"close_page", props, re.IGNORECASE):
            problem = "has a close button, but not as its first widget"
        else:
            problem = "starts with a Back button without the chevron-left icon"
        failures.append({
            "check": "BACK01",
            "line": 0,
            "message": (f"{page} (opened from {where}) {problem} -- its first widget must be `{BACK_BUTTON}`"
                        f" (skill spacing-and-layout, 'Back, top left')"),
        })
    return failures
