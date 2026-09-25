"""SPACE01-03 (Atlas spacing between widgets on a line and under headings), HEAD01 (a page
with no heading), ALERT01 (a box class on inline text). check() runs them over every page.

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re

from .controls import column_filter_findings
from .pages import SPACING_VALUES, Widget, is_heading, parse, runs_of, siblings, spacing_of


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

# Atlas classes that draw a box around their content: they need a block element to hold it.
BLOCK_CLASS_RE = re.compile(r"Class:\s*'(?P<classes>[^']*\b(?:alert(?:-[\w-]+)?|card|well)\b[^']*)'")


def block_class_findings(widgets: list[Widget]) -> list[dict]:
    """ALERT01: a box class on an inline text widget. A cancellation notice written as
    `dynamictext (Class: 'alert alert-danger')` drew its red box over the line below it and
    the status badge beside it; the gate saw nothing, because the MDL was valid."""
    warnings = []
    for widget in widgets:
        if widget.type not in ("dynamictext", "text"):
            continue
        found = BLOCK_CLASS_RE.search(widget.text)
        if not found:
            continue
        warnings.append({
            "check": "ALERT01",
            "line": widget.line,
            "message": (f"{widget.page}: {widget.name} carries '{found.group('classes')}' on a {widget.type},"
                        f" which renders inline, so the box overlaps what is around it -- put the class on a"
                        f" container and the text inside it: container ctNotice (Class: '{found.group('classes')}')"
                        f" {{ {widget.type} {widget.name} (...) }} (skill spacing-and-layout, 'Alerts and notices')"),
        })
    return warnings


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
    return failures, missing_heading_warnings(headed) + block_class_findings(widgets), len(headed)
