#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher Bash). Before an `mxcli exec <script>.mdl` runs
# tests/precheck.sh on the scripts it names: the build's own checker on a scratch copy of the
# model. Errors block the exec (exit 2, the reason on stderr reaches the model); anything else
# -- another command, inline MDL, no precheck.sh, mx missing -- lets it through (exit 0).

# Cheap substring test first: almost no Bash call is an `mxcli exec`.
input="$(cat)"
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac
[ -f tests/precheck.sh ] || exit 0

# Prints the first Python that actually runs (Windows may have only a Store stub); inlined so the hook is self-contained.
mdl_find_python() {
  local candidate
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  local local_app="${LOCALAPPDATA:-}"
  local_app="${local_app//\\//}"
  for candidate in \
      "$local_app/Programs/Python"/Python3*/python.exe \
      "$local_app/Programs/Python/Launcher/py.exe" \
      "/c/Program Files"/Python3*/python.exe \
      "/c/Program Files (x86)"/Python3*/python.exe; do
    [ -x "$candidate" ] || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}
PY="$(mdl_find_python || true)"
PY="${PY:-python3}"

command="$(printf '%s' "$input" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null)"
case "$command" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac

# The .mdl words of the command, split like a shell (shlex, no execution; globs expanded,
# bounded like after-mxcli-exec.sh). Inline MDL has no script to check: let it through.
scripts="$(printf '%s' "$command" | "$PY" -c 'import glob, shlex, sys
text = sys.stdin.read()
try:
    words = shlex.split(text)
except ValueError:
    words = text.split()
LIMIT = 200
seen = set()
for word in words:
    if not word.endswith(".mdl") or word in seen:
        continue
    seen.add(word)
    matches = []
    if any(c in word for c in "*?[") and word.count("*") <= 4:
        for i, match in enumerate(sorted(glob.iglob(word))):
            if i >= LIMIT:
                matches = []
                break
            matches.append(match)
    print("\n".join(matches) if matches else word)' 2>/dev/null)"
[ -n "$scripts" ] || exit 0

args=()
while IFS= read -r script; do
  [ -n "$script" ] && args+=("$script")
done <<HOOK_SCRIPTS
$scripts
HOOK_SCRIPTS

out="$(bash tests/precheck.sh "${args[@]}" 2>&1)"
status=$?
if [ "$status" -ne 0 ]; then
  {
    echo "Blocked: that exec would break the build (mx check on a copy of the model, nothing changed). Fix the script and exec again:"
    printf '%s\n' "$out"
  } >&2
  exit 2
fi
# Tell the model the check happened, so it does not run precheck.sh a second time by hand
# (plain stdout of a PreToolUse hook reaches the transcript only, additionalContext the model).
printf '%s\n' "$out" | head -1 | "$PY" -c 'import json,sys
line = sys.stdin.read().strip()
if line:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": line}}))' 2>/dev/null
exit 0
