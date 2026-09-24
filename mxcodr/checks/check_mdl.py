#!/usr/bin/env python3
"""Check flow MDL against the naming-and-captions rules (captions, variable names, positions).

Input: .mdl files or directories (searched recursively), normally the `describe` dump from tests/gate.sh.
Usage: check_mdl.py <file.mdl|dir> ... --skill naming [--json]
--json keys: verdict, warnings, skills, sources, lines, failures.
Exit: 0 no failures (warnings allowed), 1 failures or no MDL found, 2 bad arguments.
"""

# Rule codes (FAIL counts against the run, WARN does not):
#   decision-caption             FAIL  if/case without @caption
#   caption-restates-expression  FAIL  decision caption contains $, <, >, != or " = "
#   caption-not-a-question       FAIL  decision caption does not end in "?"
#   case-caption-dropped         WARN  case caption equals its expression (mxcli overwrote it)
#   caption-on-loop              FAIL  loop/while with @caption (dropped: MDL042 on a loop, silently on a while)
#   loop-annotation              FAIL  loop/while without @annotation
#   action-caption               FAIL  retrieve/create/change/commit/delete/set/show page/call without @caption
#   action-caption-is-default    FAIL  caption is the Mendix default ("Retrieve Invoice", "Commit object")
#   placeholder-variable         FAIL  $Int1, $List2, $tmp, $x ...
#   type-echo-variable           FAIL  name ends in _List, _Object or _Obj

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Any `@word rest`; group 1 is the word (caption, annotation, position).
ANNOTATION_RE = re.compile(r"^\s*@(\w+)\s*(.*)$")
CAPTION_RE = re.compile(r"^\s*@caption\s+'(.*)'\s*$", re.IGNORECASE)
DECISION_RE = re.compile(r"^\s*(if|case)\b", re.IGNORECASE)
# A `while` is a loop, not a decision: mxcli writes no caption for it -- `@caption` passes
# `check` and `exec` and is gone from `describe`, with no MDL042 to say so -- while
# `@annotation` survives. Treated as a decision, it failed decision-caption with no way to pass:
# a Pi session spent 45 minutes on three such findings.
LOOP_RE = re.compile(r"^\s*(loop|while)\b", re.IGNORECASE)
# Activity lines; `create` needs a qualified entity so `create microflow` is not matched.
ACTION_RE = re.compile(
    r"^\s*(?:"
    r"retrieve\b|"
    r"change\s+\$|"
    r"commit\s+\$|"
    r"delete\s+\$|"
    r"(?:\$\w+\s*=\s*)?create\s+\w+\.|"
    r"show\s+page\b|"
    r"set\s+\$|"
    r"(?:\$\w+\s*=\s*)?call\s+(?:microflow|nanoflow)\b"
    r")",
    re.IGNORECASE,
)
# Mendix default captions: verb + one name ("Retrieve Invoice") or a fixed phrase ("Commit object").
DEFAULT_ACTION_CAPTION_RE = re.compile(
    r"^(?:"
    r"(?:Retrieve|Change|Commit|Delete|Create)\s+[A-Z][\w.]*|"
    r"Change variable|"
    r"Commit object|"
    r"Delete object|"
    r"Show page(?:\s+\S+)?|"
    r"Call (?:microflow|nanoflow)(?:\s+\S+)?"
    r")$",
    re.IGNORECASE,
)
# `create [or modify|replace] microflow|nanoflow Mod.Name`; group 1 is the name.
# Type word plus digits: $Int1, $List2, $Var10.
PLACEHOLDER_VAR_RE = re.compile(
    r"\$(?:int|bool|boolean|str|string|dec|decimal|date|datetime|list|obj|object|var|num|item)\d+\b",
    re.IGNORECASE,
)
THROWAWAY_VAR_RE = re.compile(r"\$(?:tmp|temp|foo|bar|x|y|z|aa)\b", re.IGNORECASE)
TYPE_ECHO_VAR_RE = re.compile(r"\$\w+_(?:list|object|obj)\b", re.IGNORECASE)
# A comparison in a caption: <, >, <=, >=, != or " = ".
COMPARISON_RE = re.compile(r"[<>]=?|!=|\s=\s")

# (regex, rule code, message label) for variable names.
VARIABLE_RULES = (
    (PLACEHOLDER_VAR_RE, "placeholder-variable", "placeholder variable name"),
    (THROWAWAY_VAR_RE, "placeholder-variable", "throwaway variable name"),
    (TYPE_ECHO_VAR_RE, "type-echo-variable", "variable name only restates its type"),
)


class Failure(dict):
    def __init__(self, check: str, message: str, line: int | None = None):
        super().__init__(check=check, message=message, line=line)


class Warning_(dict):
    """A finding the author cannot fix; reported but does not fail the run."""

    def __init__(self, check: str, message: str, line: int | None = None):
        super().__init__(check=check, message=message, line=line)


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    # Authored scripts quote identifiers, describe output does not; MDL strings use single quotes.
    text = text.replace('"', "")
    kept = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return "\n".join(kept)


def preceding_annotations(lines: list[str], index: int) -> list[tuple[str, str]]:
    """(kind, raw line) of the @-annotations directly above lines[index]."""
    found = []
    cursor = index - 1
    while cursor >= 0:
        line = lines[cursor]
        if not line.strip():
            cursor -= 1
            continue
        match = ANNOTATION_RE.match(line)
        if not match:
            break
        found.append((match.group(1).lower(), line))
        cursor -= 1
    return found


def caption_text(annotation_lines: list[tuple[str, str]]) -> str:
    """Text of the parsable @caption, else ""."""
    for kind, raw in annotation_lines:
        if kind == "caption":
            match = CAPTION_RE.match(raw)
            if match:
                return match.group(1)
    return ""  # no @caption, or one that does not parse


def annotation_kinds(annotations: list[tuple[str, str]]) -> list[str]:
    return [kind for kind, _ in annotations]


def decision_findings(lines: list[str], index: int) -> tuple[list[Failure], list[Warning_], bool]:
    """Caption rules for an if/case/while; the bool is False when it has no @caption."""
    line = lines[index]
    annotations = preceding_annotations(lines, index)
    if "caption" not in annotation_kinds(annotations):
        failure = Failure(
            "decision-caption",
            f"decision without @caption: {line.strip()[:70]}",
            index + 1,
        )
        return [failure], [], False

    text = caption_text(annotations)
    if not text:
        return [], [], True
    expression = line.strip()[len(line.strip().split()[0]):].strip()
    is_enum_split = line.strip().lower().startswith("case")
    if is_enum_split and text.strip() == expression:
        # mxcli overwrites an enum case's @caption with its expression.
        warning = Warning_(
            "case-caption-dropped",
            "mxcli wrote this split's own expression as its caption "
            f"('{text}'); measured on 11.13.0 it discards both @caption "
            "and @annotation on a split, so this is not the author's doing",
            index + 1,
        )
        return [], [warning], True
    if "$" in text or COMPARISON_RE.search(text):
        failure = Failure(
            "caption-restates-expression",
            f"caption restates the expression: '{text}'",
            index + 1,
        )
        return [failure], [], True
    if not text.rstrip().endswith("?"):
        failure = Failure(
            "caption-not-a-question",
            f"decision caption is not phrased as a question: '{text}'",
            index + 1,
        )
        return [failure], [], True
    return [], [], True


def loop_findings(lines: list[str], index: int) -> list[Failure]:
    """A loop or while loop needs @annotation and must not carry @caption."""
    line = lines[index]
    kinds = annotation_kinds(preceding_annotations(lines, index))
    failures = []
    if "caption" in kinds:
        failures.append(
            Failure(
                "caption-on-loop",
                "loop carries @caption, which is dropped (MDL042 on a loop, silently on a while) -- write @annotation '<why it repeats>' above it instead",
                index + 1,
            )
        )
    if "annotation" not in kinds:
        failures.append(
            Failure(
                "loop-annotation",
                f"loop without @annotation -- put @annotation '<why it repeats>' on the line above: {line.strip()[:70]}",
                index + 1,
            )
        )
    return failures


def action_findings(lines: list[str], index: int) -> list[Failure]:
    """An action needs a @caption that is not the Mendix default."""
    line = lines[index]
    annotations = preceding_annotations(lines, index)
    if "caption" not in annotation_kinds(annotations):
        return [
            Failure(
                "action-caption",
                f"action without business-operation @caption: {line.strip()[:70]}",
                index + 1,
            )
        ]
    text = caption_text(annotations)
    if text and DEFAULT_ACTION_CAPTION_RE.match(text.strip()):
        return [
            Failure(
                "action-caption-is-default",
                f"action caption restates the Mendix default: '{text}'",
                index + 1,
            )
        ]
    return []


def variable_findings(line: str, line_number: int) -> list[Failure]:
    failures = []
    for regex, check, label in VARIABLE_RULES:
        for hit in regex.findall(line):
            failures.append(Failure(check, f"{label}: {hit}", line_number))
    return failures


def check_naming(lines: list[str]) -> tuple[list[Failure], list[Warning_]]:
    """Return (failures, warnings) for all naming rules."""
    failures: list[Failure] = []
    warnings: list[Warning_] = []

    for index, line in enumerate(lines):
        line_number = index + 1
        stripped = line.strip().lower()
        if stripped.startswith("end ") or stripped == "end":
            continue

        if DECISION_RE.match(line):
            found, warned, has_caption = decision_findings(lines, index)
            failures.extend(found)
            warnings.extend(warned)
            if not has_caption:
                continue  # skips the variable-name rules for this line
        elif LOOP_RE.match(line):
            failures.extend(loop_findings(lines, index))
        elif ACTION_RE.match(line):
            failures.extend(action_findings(lines, index))

        failures.extend(variable_findings(line, line_number))

    return failures, warnings


CHECKS = {"naming": check_naming}


def collect_text(sources: list[Path]) -> tuple[str, list[Path]]:
    """Joined text of every .mdl under sources, and the files read; missing paths are skipped."""
    chunks, used = [], []
    for source in sources:
        if source.is_dir():
            files = sorted(source.rglob("*.mdl"))
        else:
            files = [source] if source.exists() else []
        for file in files:
            chunks.append(file.read_text(encoding="utf-8", errors="replace"))
            used.append(file)
    return "\n".join(chunks), used


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path, help="MDL files or directories")
    parser.add_argument(
        "--skill",
        action="append",
        choices=sorted(CHECKS),
        required=True,
        help="which skill's rules to enforce (repeatable)",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    text, used = collect_text(args.sources)
    if not text.strip():
        print(f"FAIL  no MDL found in {[str(s) for s in args.sources]}", file=sys.stderr)
        return 1

    lines = strip_comments(text).splitlines()

    failures: list[Failure] = []
    warnings: list[Warning_] = []
    for skill in args.skill:
        skill_failures, skill_warnings = CHECKS[skill](lines)
        failures.extend(skill_failures)
        warnings.extend(skill_warnings)

    report = {
        "verdict": "PASS" if not failures else "FAIL",
        "warnings": warnings,
        "skills": args.skill,
        "sources": [str(path) for path in used],
        "lines": len(lines),
        "failures": failures,
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"{report['verdict']}  {len(failures)} failure(s) over {len(lines)} lines")
        for failure in failures:
            location = f"line {failure['line']}" if failure["line"] else "-"
            print(f"  - [{failure['check']}] {location}: {failure['message']}")
        for warning in warnings:
            location = f"line {warning['line']}" if warning["line"] else "-"
            print(f"  ! [{warning['check']}] {location}: {warning['message']}")

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
