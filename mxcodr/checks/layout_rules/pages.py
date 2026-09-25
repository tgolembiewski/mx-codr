"""Reading `describe page` dumps: widgets, their nesting, spacing, and the page blocks the
other rule modules look at. Rules live in the sibling modules; this one has none of its own.

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re


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
PAGE_RE = re.compile(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?page\s+(?P<name>[\w.]+)", re.IGNORECASE)


# BACK01 -------------------------------------------------------------------------------------
SHOW_PAGE_ANY_RE = re.compile(r"\bshow[_ ]page\s+(?P<page>[A-Za-z_]\w*\.[A-Za-z_]\w*)", re.IGNORECASE)
PAGE_LAYOUT_RE = re.compile(r"\bLayout:\s*(?P<layout>[\w.]+)", re.IGNORECASE)
WIDGET_LINE_RE = re.compile(r"^\s*(?P<type>[a-z]+)\s+(?P<name>\"[^\"]*\"|[\w.]+)\s*(?P<rest>[({].*)?$", re.IGNORECASE)
# Containers a Back button may sit inside and still be the first thing on the page.
BACK_WRAPPERS = {"layoutgrid", "row", "column", "container", "dataview", "scrollcontainer", "region", "header"}


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
