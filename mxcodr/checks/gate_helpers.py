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
    if command == "watch-state" and len(args) == 1:
        return watch_state(args[0])
    if command == "missing-browser" and len(args) == 1:
        return missing_browser(args[0])
    print("unknown or incomplete command: %s" % " ".join(argv[1:]), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
