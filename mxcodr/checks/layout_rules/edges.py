"""EDGE01 (a widget outside a layout grid, at the top of a page, touches the edge of the window).

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re

from .pages import PAGE_LAYOUT_RE, parse, spacing_of


# The Atlas_Core layouts give the page no side margin: a heading or a button placed straight on
# the page sits against the menu on the left and the window on the right. A layoutgrid adds the
# gutter. A session built every page with its title and its Back / signed-in row outside the grid.
DOCUMENT_RE = re.compile(r"^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?P<kind>page|snippet)\s+(?P<name>[\w.]+)",
                         re.IGNORECASE)
SNIPPET_CALL_RE = re.compile(r"\bSnippet:\s*(?P<name>[\w.]+)")
LOGIN_PAGE_RE = re.compile(r"^\s*login\s+page\s+(?P<page>[\w.]+)", re.IGNORECASE)
# Pages whose layout frames them already: a pop-up has its own padding, a login page no menu.
FRAMED_LAYOUT_RE = re.compile(r"popup|login", re.IGNORECASE)
# Widgets that only hold others: safe when everything inside them is.
WRAPPERS = {"container", "dataview", "scrollcontainer", "groupbox"}
GRID_WRAPPER = ("layoutgrid pageGrid { row row1 { column col1 (DesktopWidth: 12) { ... } } }")


def documents(lines: list[str]) -> dict[tuple[str, str], tuple[int, list[str]]]:
    """{(kind, name): (line number of its first line, its lines)} for every page and snippet."""
    found: dict[tuple[str, str], tuple[int, list[str]]] = {}
    key = None
    for number, line in enumerate(lines, 1):
        head = DOCUMENT_RE.match(line)
        if head:
            key = (head.group("kind").lower(), head.group("name"))
            found[key] = (number, [])
        if key:
            found[key][1].append(line)
    return found


def top_level(widgets: list) -> list:
    """The widgets at the smallest indent: what sits straight on the page or snippet."""
    if not widgets:
        return []
    indent = min(widget.indent for widget in widgets)
    return [widget for widget in widgets if widget.indent == indent]


def children(widgets: list, parent) -> list:
    """The direct children of parent, from the flat widget list parse() returns."""
    start = widgets.index(parent) + 1
    inside = []
    for widget in widgets[start:]:
        if widget.indent <= parent.indent:
            break
        inside.append(widget)
    return top_level(inside)


def edge_safe(widget, widgets: list, snippets: dict[str, list], depth: int = 0) -> bool:
    """True when the widget keeps its content off the window's edge."""
    if widget.type == "layoutgrid":
        return True
    spacing = spacing_of(widget)
    if spacing.get("padding-left", "None") != "None" and spacing.get("padding-right", "None") != "None":
        return True
    if widget.type == "snippetcall":
        called = SNIPPET_CALL_RE.search(widget.text)
        inner = snippets.get(called.group("name")) if called else None
        if inner is None or depth > 3:
            return True   # a snippet this run could not read (Atlas_Core's, say) is not judged
        return all(edge_safe(top, inner, snippets, depth + 1) for top in top_level(inner))
    if widget.type in WRAPPERS:
        return all(edge_safe(child, widgets, snippets, depth) for child in children(widgets, widget))
    return False


def edge_findings(lines: list[str], snippet_text: str, navigation: str) -> list[dict]:
    """EDGE01: a page on an Atlas_Core layout with a widget outside a layoutgrid at its top."""
    login_pages = {m.group("page") for m in map(LOGIN_PAGE_RE.match, navigation.splitlines()) if m}
    snippets = {name: parse(block) for (kind, name), (_, block) in documents(snippet_text.splitlines()).items()
                if kind == "snippet"}
    snippets.update({name: parse(block) for (kind, name), (_, block) in documents(lines).items()
                     if kind == "snippet"})
    failures = []
    for (kind, page), (start, block) in documents(lines).items():
        if kind != "page" or page in login_pages:
            continue
        layout = PAGE_LAYOUT_RE.search(" ".join(block[:12]))
        if not layout or not layout.group("layout").startswith("Atlas_Core.") \
                or FRAMED_LAYOUT_RE.search(layout.group("layout")):
            continue
        widgets = parse(block)
        loose = [widget for widget in top_level(widgets) if not edge_safe(widget, widgets, snippets)]
        if not loose:
            continue
        names = ", ".join(f"{widget.type} {widget.name}" for widget in loose)
        failures.append({
            "check": "EDGE01",
            "line": start + loose[0].line - 1,
            "message": (f"{page}: {names} sit outside a layout grid, so they touch the edge of the window"
                        f" (Atlas layouts add no side margin; a layoutgrid does) -- put the page's widgets,"
                        f" the Back / signed-in row and the heading too, inside {GRID_WRAPPER}"
                        f" (skill spacing-and-layout, 'Structure')"),
        })
    return failures
