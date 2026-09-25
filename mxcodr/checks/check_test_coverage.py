#!/usr/bin/env python3
"""Check that every page and ACT_ microflow of a module is named by a `# covers:` line in tests/verify-*.test.sh.

Also fails on covers: names not in the model (not built yet, or renamed). Run by tests/gate.sh, tests/orient.sh and the exec hook.
Usage: check_test_coverage.py <app-dir> <Module> [<Module>...] [--tests-dir tests] [--json]
--json keys: verdict, module, elements, tests, untested, stale_covers (several modules: modules, stale_covers).
Exit: 0 all covered, 1 something uncovered or stale, 2 the model could not be read.
"""

from __future__ import annotations

import argparse
import json
import re
import os
import subprocess
import sys
from pathlib import Path

# `# covers: A, B, C`, and the `#` lines right under it that hold only more names: a long list
# wrapped over three lines counted its first line only, and the rest showed as untested.
# Group 1 is the comma list, continuation lines included.
QUALIFIED_LIST = r"[\w.]+\.\w+(?:\s*,\s*[\w.]+\.\w+)*\s*,?"
COVERS_RE = re.compile(r"^\s*#\s*covers\s*:\s*(.+(?:\n\s*#\s*" + QUALIFIED_LIST + r"\s*$)*)",
                       re.IGNORECASE | re.MULTILINE)


def mxcli_binary(app_dir: Path) -> str:
    if (app_dir / "mxcli").exists():
        return "./mxcli"
    if (app_dir / "mxcli.exe").exists():
        return "./mxcli.exe"
    return "./mxcli"


class ModelReadError(RuntimeError):
    """The model could not be read (distinct from an empty module)."""


def mxcli_json(app_dir: Path, mpr: str, command: str) -> list[dict]:
    """Rows of one MDL command's --json output; raises ModelReadError rather than returning []."""
    try:
        result = subprocess.run(
            [mxcli_binary(app_dir), "-p", mpr, "--json", "-c", command],
            cwd=app_dir,
            capture_output=True,
            text=True,
            # Runs after every command via the exec hook; a hung mxcli must not block the turn.
            timeout=float(os.environ.get("MDL_MXCLI_TIMEOUT", "120")),
        )
    except subprocess.TimeoutExpired as exc:
        raise ModelReadError(f"`{command}` did not finish within {exc.timeout:.0f}s") from exc
    except OSError as exc:
        raise ModelReadError(f"could not start mxcli: {exc}") from exc
    if result.returncode != 0:
        why = (result.stderr or result.stdout).strip().splitlines()
        raise ModelReadError(f"`{command}` exited {result.returncode}: {why[-1] if why else 'no output'}")
    try:
        rows = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ModelReadError(f"`{command}` did not return JSON") from exc
    if not isinstance(rows, list):
        raise ModelReadError(f"`{command}` did not return a list")
    return rows


def project_modules(app_dir: Path, mpr: str) -> tuple[set[str], list[str]]:
    """(all module names, the project's own modules)."""
    rows = mxcli_json(app_dir, mpr, "SHOW MODULES")
    every = {row.get("Module") for row in rows if row.get("Module")}
    own = sorted(
        row["Module"]
        for row in rows
        if row.get("Module")
        and not (row.get("Source") or "").strip()
        and row["Module"] not in ("System", "MyFirstModule")
    )
    return every, own


def qualified_names(rows: list[dict]) -> list[str]:
    names = []
    for row in rows:
        name = row.get("Qualified Name") or row.get("QualifiedName")
        if name:
            names.append(name)
    return names


def inventory(app_dir: Path, mpr: str, module: str) -> tuple[list[str], set[str]]:
    """(required: pages and ACT_ microflows, known: any page, microflow or snippet a test may name)."""
    pages = qualified_names(mxcli_json(app_dir, mpr, f"SHOW PAGES IN {module}"))
    flows = qualified_names(mxcli_json(app_dir, mpr, f"SHOW MICROFLOWS IN {module}"))
    snippets = qualified_names(mxcli_json(app_dir, mpr, f"SHOW SNIPPETS IN {module}"))
    required = sorted(set(pages + [f for f in flows if f.split(".")[-1].startswith("ACT_")]))
    known = set(pages) | set(flows) | set(snippets)
    return required, known


def covered(tests_dir: Path) -> dict[str, list[str]]:
    claims: dict[str, list[str]] = {}
    if not tests_dir.is_dir():
        return claims
    for script in sorted(tests_dir.glob("verify-*.test.sh")):
        text = script.read_text(encoding="utf-8", errors="replace")
        for match in COVERS_RE.finditer(text):
            for element in re.sub(r"\n\s*#", ",", match.group(1)).split(","):
                element = element.strip()
                if element:
                    claims.setdefault(element, []).append(script.name)
    return claims


def module_report(module: str, required: list[str], claims: dict[str, list[str]],
                  stale: list[str], single: bool) -> dict:
    """One module's verdict; with a single module every stale claim is reported under it."""
    untested = [element for element in required if element not in claims]
    prefix = module + "."
    mine = stale if single else [name for name in stale if name.startswith(prefix)]
    return {
        "verdict": "PASS" if not untested and not mine else "FAIL",
        "module": module,
        "elements": len(required),
        "tests": sorted({script for name, scripts in claims.items()
                         if name.startswith(prefix) for script in scripts}),
        "untested": untested,
        "stale_covers": mine,
    }


def print_text(reports: list[dict], orphans: list[str]) -> None:
    for report in reports:
        total, missing = report["elements"], len(report["untested"])
        if total == 0 and not report["stale_covers"]:
            print(f"PASS  {report['module']}: nothing a user can reach (no page, no ACT_ microflow)")
            continue
        print(f"{report['verdict']}  {report['module']}: {total - missing}/{total} "
              f"elements covered by {len(report['tests'])} test script(s)")
        for element in report["untested"]:
            print(f"  - no test covers {element}")
        for name in report["stale_covers"]:
            print(f"  - covers: names {name}, which is not in the model (not built yet, or renamed)")
    if orphans:
        print("FAIL  covers: lines name elements in no module of this project")
        for name in orphans:
            print(f"  - covers: names {name}, which is not in the model (not built yet, or renamed)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_dir", type=Path)
    parser.add_argument("modules", nargs="+", metavar="Module")
    parser.add_argument("--tests-dir", default="tests")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    app_dir = args.app_dir
    mprs = sorted(app_dir.glob("*.mpr"))
    if not mprs:
        print(f"ERROR  no .mpr in {app_dir}")
        return 2
    mpr = mprs[0].name

    try:
        every, own = project_modules(app_dir, mpr)
        unknown = [module for module in args.modules if module not in every]
        if unknown:
            print(f"ERROR  no module named {', '.join(unknown)} in {mpr}")
            return 2
        inventories = {module: inventory(app_dir, mpr, module)
                       for module in sorted(set(own) | set(args.modules))}
    except ModelReadError as exc:
        print(f"ERROR  could not read the model: {exc}")
        return 2

    known: set[str] = set()
    for _required, names in inventories.values():
        known |= names

    claims = covered(app_dir / args.tests_dir)
    stale = sorted(name for name in claims if name not in known)
    single = len(args.modules) == 1

    reports = [module_report(module, inventories[module][0], claims, stale, single)
               for module in args.modules]
    # With several modules, stale names outside all of them are reported once, separately.
    checked = set(args.modules)
    orphans = [] if single else [name for name in stale if name.split(".")[0] not in checked]

    if args.json:
        payload = reports[0] if single else {"modules": reports, "stale_covers": orphans}
        print(json.dumps(payload, indent=2))
    else:
        print_text(reports, orphans)

    failed = orphans or any(report["verdict"] == "FAIL" for report in reports)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
