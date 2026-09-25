#!/usr/bin/env python3
"""The Python that tests/gate.sh needs, one subcommand per job.

    gate_helpers.py qualified-names               names from a SHOW ... --json listing on stdin
    gate_helpers.py fingerprint <path>...         one digest over files, meta:<path> and env:NAME=value
    gate_helpers.py secret                        a random 32-hex-digit cache secret
    gate_helpers.py signed-in-users               user names from an M2EE get_logged_in_user_names answer on stdin
    gate_helpers.py recent-refusal [seconds]      timestamp of a session-cap refusal line on stdin, if recent (120)
    gate_helpers.py deployment-age <mpr> <built>  warn when the model is newer than the built deployment
    gate_helpers.py runtime-age <mpr> <lstart>    warn when the model changed after the runtime started
    gate_helpers.py missing-browser <config>      the executablePath a Playwright config names, if it is missing
    gate_helpers.py duplicate-definitions <mdl>... documents these scripts create that another script
                                                  in the same folder creates too (SCRIPT01)
    gate_helpers.py watch-state <boot-log>        where a --watch boot is: ready, building, applied or
                                                  failed; after failed, one line per build error
    gate_helpers.py visual-report <findings.jsonl> [<scripts-dir>] [--review <dir>]
                                                  one warning line per page problem look() measured;
                                                  with --review, the screenshots still to be judged

Exit 0 unless noted: qualified-names exits 1 when stdin is not a JSON list.
Warnings are printed to stdout, ready to show under the gate's output.
"""
import datetime
import hashlib
import json
import os
import re
import secrets
import sys


def qualified_names():
    rows = json.load(sys.stdin)
    if not isinstance(rows, list):
        return 1
    for row in rows:
        name = row.get("Qualified Name") or row.get("QualifiedName")
        if name:
            print(name)
    return 0


def fingerprint(paths):
    """Content of each file (size + mtime for meta:<path>), walked in sorted order."""
    digest = hashlib.sha256()

    def add(path, content):
        try:
            st = os.stat(path)
        except OSError:
            digest.update(("missing %s\n" % path).encode())
            return
        if os.path.isdir(path):
            for root, dirs, files in os.walk(path):
                dirs.sort()
                for name in sorted(files):
                    add(os.path.join(root, name), content)
            return
        if not content:
            digest.update(("%s %d %d\n" % (path, st.st_size, st.st_mtime_ns)).encode())
            return
        digest.update(("%s %d\n" % (path, st.st_size)).encode())
        try:
            with open(path, "rb") as handle:
                for chunk in iter(lambda: handle.read(1 << 20), b""):
                    digest.update(chunk)
        except OSError:
            digest.update(("unreadable %s\n" % path).encode())

    for arg in paths:
        if arg.startswith("env:"):
            # A setting read from the environment rather than a file; the caller expands the
            # value, so it counts whether or not it was exported.
            digest.update(("%s\n" % arg).encode())
        elif arg.startswith("meta:"):
            add(arg[5:], False)
        else:
            add(arg, True)
    print(digest.hexdigest()[:24])
    return 0


def secret():
    print(secrets.token_hex(16))
    return 0


def signed_in_users():
    try:
        feedback = json.load(sys.stdin).get("feedback", {})
    except Exception:
        return 0
    users = feedback.get("users") or []
    if users:
        print(",".join(users))
    return 0


def recent_refusal(seconds):
    line = sys.stdin.read().strip()
    stamp = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", line) if line else None
    if not stamp:
        return 0
    when = datetime.datetime.strptime(stamp.group(1), "%Y-%m-%d %H:%M:%S")
    if (datetime.datetime.now() - when).total_seconds() <= seconds:
        print(stamp.group(1))
    return 0


def deployment_age(mpr, built):
    try:
        gap = int(os.path.getmtime(mpr) - os.path.getmtime(built))
    except OSError:
        return 0
    if gap > 5:
        print("   !! the model is %ds newer than the built deployment -- this run measures"
              " the OLD app" % gap)
        print("      rebuild before trusting anything green here")
    return 0


def runtime_age(mpr, started):
    try:
        boot = datetime.datetime.strptime(" ".join(started.split()), "%a %b %d %H:%M:%S %Y")
    except ValueError:
        return 0
    changed = datetime.datetime.fromtimestamp(os.path.getmtime(mpr))
    gap = (changed - boot).total_seconds()
    if gap > 5:
        print("   !! the model changed %ds after the runtime started and nothing applied it"
              " (no --watch reload or restart logged) -- this run measures the old app:" % gap)
        print("      bash tests/gate.sh --restart")
    return 0


def missing_browser(config):
    try:
        options = json.load(open(config))["browser"]["launchOptions"]
    except Exception:
        return 0
    path = options.get("executablePath")
    if path and not os.path.exists(path):
        print(path)
    return 0


# `create [or modify|or replace] [persistent|...] <kind> Module.Name` at the start of a line.
DEFINITION_RE = re.compile(
    r"^[ \t]*create\s+(?:or\s+(?:modify|replace)\s+)?(?:(?:persistent|non-persistent|view|external)\s+)?"
    r"(?P<kind>page|snippet|layout|microflow|nanoflow|entity|enumeration|workflow|menu|constant)\s+"
    r"(?P<name>[\w\"]+\.[\w\"]+)", re.IGNORECASE | re.MULTILINE)


def definitions(path):
    """{(kind, Module.Name)} a script creates."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        return set()
    return {(m.group("kind").lower(), m.group("name").replace('"', ""))
            for m in DEFINITION_RE.finditer(text)}


def duplicate_definitions(scripts):
    """SCRIPT01: a document two scripts create is whatever the last one run says. Order_Detail was
    created in two scripts; re-running the earlier one put back a page without its PDF button, and
    a session spent 25 steps looking for the cause in the runtime."""
    reported = set()
    for script in scripts:
        own = definitions(script)
        if not own:
            continue
        folder = os.path.dirname(script) or "."
        for other in sorted(os.listdir(folder)):
            path = os.path.join(folder, other)
            if not other.endswith(".mdl") or os.path.abspath(path) == os.path.abspath(script):
                continue
            for kind, name in sorted(own & definitions(path)):
                pair = (kind, name, frozenset((os.path.abspath(script), os.path.abspath(path))))
                if pair in reported:
                    continue
                reported.add(pair)
                print("  - %s %s is created in %s and in %s: whichever runs last decides what the %s is, and "
                      "re-running the other silently undoes it. Keep ONE `create` of it, in one script, and "
                      "change it there (or with `alter %s`)." % (kind, name, script, path, kind, kind))
    return 0


# The lines a --watch boot writes, in the order they can follow one another.
WATCH_EVENTS = (("Watching model", "ready"), ("Change detected, rebuilding", "building"),
                ("applied via", "applied"), ("build failed", "failed"))


def watch_state(path):
    """The last thing a --watch boot did. A failed rebuild leaves the runtime on the previous
    model, so a gate that waited for "applied" sat out its whole wait and then tested the old
    app: the session saw its fix fail and went looking for a bug in the fix."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return 0
    state, at = "", 0
    for index, line in enumerate(lines):
        for marker, name in WATCH_EVENTS:
            if marker in line:
                state, at = name, index
    print(state)
    if state == "failed":
        for error in watch_build_errors(lines[at:]):
            print(error)
    return 0


def watch_build_errors(lines):
    """"CE0116 <message> (Page 'X', Action button 'y')" per error in the problems JSON under a
    "build failed" line; the "build failed" line itself when there is no JSON to read."""
    text = "\n".join(lines)
    start = text.find("{")
    try:
        report, _ = json.JSONDecoder().raw_decode(text[start:]) if start >= 0 else (None, 0)
    except ValueError:
        report = None
    problems = (report or {}).get("problems", {})
    errors = []
    for problem in problems.get("problems", []) if isinstance(problems, dict) else []:
        if problem.get("severity") != "Error":
            continue
        where = "; ".join("%s, %s" % (place.get("document", ""), place.get("element", ""))
                          for place in problem.get("locations", [])[:1])
        errors.append("%s %s%s" % (problem.get("errorCode") or "", problem.get("message", "").strip(),
                                   " (%s)" % where if where else ""))
    return errors or [lines[0].strip()]


# The widget names a script declares, per page: `create ... page Module.Name` up to the next create.
PAGE_START_RE = re.compile(r"^\s*create\s+(?:or\s+(?:modify|replace)\s+)?page\s+(?P<name>[\w.\"]+)",
                           re.IGNORECASE | re.MULTILINE)
WIDGET_NAME_RE = re.compile(r"^\s*[a-z][a-z0-9_]*\s+(?P<name>[A-Za-z_]\w*)\s*[({]", re.MULTILINE)

VISUAL_FIX = {
    "VIS01": "a box class on inline text (alert, card) or a negative margin is the usual cause",
    "VIS02": "a fixed width or a long unbroken value is the usual cause; check the page at phone width",
    "VIS03": "the text needs room: a wider column, wrapping, or an ellipsis on purpose",
}

RUBRIC = [
    "Does anything overlap or sit on top of something else?",
    "Is everything aligned to the grid: left edges, columns, the top row (Back and the user)?",
    "Is the spacing between blocks even, with no cramped or oversized gaps?",
    "Is any text, button or value cut off, wrapped badly or truncated?",
    "Do badges, alerts and buttons sit where a user expects them, in the right size?",
    "Does the heading hierarchy read right (page title, section headings)?",
    "Are empty, zero or odd states shown sensibly (empty grids, 0.00, missing values)?",
    "Is all text readable (contrast, size) against its background?",
]


def pages_by_widgets(folder):
    """{page: set(widget names)} from the .mdl scripts in folder."""
    found = {}
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return found
    for name in names:
        if not name.endswith(".mdl"):
            continue
        try:
            with open(os.path.join(folder, name), encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        starts = list(PAGE_START_RE.finditer(text))
        for index, start in enumerate(starts):
            end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
            block = text[start.end():end]
            nxt = re.search(r"^\s*(?:create|grant|alter)\b", block, re.IGNORECASE | re.MULTILINE)
            block = block[:nxt.start()] if nxt else block
            page = start.group("name").replace('"', "")
            found[page] = {m.group("name") for m in WIDGET_NAME_RE.finditer(block)}
    return found


def page_of(look, pages):
    """The page whose widgets best match what look() saw, else the browser title."""
    seen = set(look.get("widgets") or [])
    ranked = sorted(((len(seen & widgets), page) for page, widgets in pages.items()), reverse=True)
    # The page with the most of the measured widget names, when no other page ties with it.
    if ranked and ranked[0][0] >= 2 and (len(ranked) == 1 or ranked[1][0] < ranked[0][0]):
        return ranked[0][1]
    return 'page "%s"' % (look.get("title") or "?").replace("Mendix - ", "")


def file_sha(path):
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return ""


def visual_report(findings_path, scripts_dir="", review_dir=""):
    """One line per distinct page problem; with review_dir, writes review.md and reports the
    screenshots without an approving verdict for their current bytes."""
    looks = []
    try:
        with open(findings_path, encoding="utf-8") as f:
            for line in f:
                try:
                    looks.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    pages = pages_by_widgets(scripts_dir) if scripts_dir else {}
    seen = set()
    for look in looks:
        where = page_of(look, pages)
        for finding in look.get("findings") or []:
            key = (where, finding.get("code"), tuple(sorted(finding.get("widgets") or [])))
            if key in seen:
                continue
            seen.add(key)
            code = finding.get("code", "VIS")
            print("   - [%s] %s (%s): %s -- %s" % (code, where, look.get("test", "?"), finding.get("message", ""),
                                                 VISUAL_FIX.get(code, "")))
    if review_dir:
        review_screenshots(looks, pages, review_dir)
    return 0


def review_screenshots(looks, pages, folder):
    """Writes <folder>/review.md; prints a line per screenshot not approved in verdicts.json."""
    shots, listed = [], set()
    for look in looks:
        shot = look.get("shot") or ""
        if shot and shot not in listed and os.path.exists(shot):
            listed.add(shot)
            shots.append((shot, file_sha(shot), page_of(look, pages), look))
    if not shots:
        return
    verdicts_path = os.path.join(folder, "verdicts.json")
    try:
        with open(verdicts_path, encoding="utf-8") as f:
            verdicts = json.load(f)
    except (OSError, ValueError):
        verdicts = {}
    lines = ["# Screenshots to review", "",
             "Open each PNG (Read it), answer every question for it, then write verdicts.json in this",
             "folder: {\"<sha256>\": {\"verdict\": \"approve\" | \"reject\", \"answers\": {\"1\": \"...\", ...},",
             "\"fix\": \"what to change, if rejected\"}}. A changed page has a new sha256 and is asked again.",
             "", "Questions:"] + ["%d. %s" % (i, q) for i, q in enumerate(RUBRIC, 1)] + [""]
    pending = 0
    for shot, sha, where, look in shots:
        verdict = verdicts.get(sha) if isinstance(verdicts, dict) else None
        measured = "; ".join(f.get("message", "") for f in look.get("findings") or []) or "nothing measured"
        lines += ["## %s (%s)" % (where, look.get("test", "?")), "", "- file: %s" % shot, "- sha256: %s" % sha,
                  "- measured: %s" % measured, ""]
        answers = verdict.get("answers") if isinstance(verdict, dict) else None
        complete = isinstance(answers, dict) and all(str(answers.get(str(i), "")).strip()
                                                     for i in range(1, len(RUBRIC) + 1))
        if not isinstance(verdict, dict) or verdict.get("verdict") not in ("approve", "reject") or not complete:
            pending += 1
        elif verdict.get("verdict") == "reject":
            print("   - [LOOK02] %s (%s): rejected in review -- %s" % (where, look.get("test", "?"),
                                                                     str(verdict.get("fix") or "no fix given")[:200]))
    try:
        with open(os.path.join(folder, "review.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except OSError:
        pass
    if pending:
        print("   - [LOOK01] %d screenshot(s) not reviewed yet: open %s, read each PNG, answer every"
              " question and write verdicts.json there" % (pending, os.path.join(folder, "review.md")))


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    command, args = argv[1], argv[2:]
    if command == "qualified-names":
        return qualified_names()
    if command == "fingerprint":
        return fingerprint(args)
    if command == "secret":
        return secret()
    if command == "signed-in-users":
        return signed_in_users()
    if command == "recent-refusal":
        return recent_refusal(int(args[0]) if args else 120)
    if command == "deployment-age" and len(args) == 2:
        return deployment_age(*args)
    if command == "runtime-age" and len(args) == 2:
        return runtime_age(*args)
    if command == "duplicate-definitions":
        return duplicate_definitions(args)
    if command == "visual-report" and args:
        review = ""
        if "--review" in args:
            at = args.index("--review")
            review = args[at + 1] if at + 1 < len(args) else ""
            args = args[:at] + args[at + 2:]
        return visual_report(args[0], args[1] if len(args) > 1 else "", review)
    if command == "watch-state" and len(args) == 1:
        return watch_state(args[0])
    if command == "missing-browser" and len(args) == 1:
        return missing_browser(args[0])
    print("unknown or incomplete command: %s" % " ".join(argv[1:]), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
