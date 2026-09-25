"""GRID01 (a grid column filter with nothing to filter on) and ICON01 (a button without an
icon, with one suggested from its action and caption).

Part of check_layout.py; see its docstring for inputs and the full rule table.
"""

from __future__ import annotations

import re

from .pages import PAGE_RE, WIDGET_LINE_RE


COLUMN_RE = re.compile(r"^\s*column\s+(?P<name>\"[^\"]*\"|[\w/.]+)", re.IGNORECASE)
FILTER_RE = re.compile(r"^\s*(?P<type>textfilter|numberfilter|datefilter|dropdownfilter)\s+(?P<name>\w+)(?P<rest>.*)$",
                       re.IGNORECASE)
# A filter's own target: `Attribute:`, `attributes: [...]` or `Association:`.
FILTER_TARGET_RE = re.compile(r"\b(attributes?|association)\s*:", re.IGNORECASE)


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
