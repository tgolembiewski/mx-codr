#!/usr/bin/env bash
# Cursor `beforeShellExecution` hook. Cursor sends {"command": ..., "cwd": ..., ...} and reads
# back {"permission": "allow"|"deny", "userMessage": ..., "agentMessage": ...}. Before an
# `mxcli exec <script>.mdl` this runs tests/precheck.sh (the build's own checker on a scratch
# copy of the model) and denies the exec when it fails, with the errors as the agent's message.
# Everything else is allowed, including when the check cannot run.

input="$(cat)"
allow() { printf '{"permission":"allow"}\n'; exit 0; }
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) allow ;; esac

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

# Cursor puts the command at the top level; a Claude-shaped payload has it under tool_input.
command="$(printf '%s' "$input" | "$PY" -c 'import json,sys
d = json.load(sys.stdin)
print(d.get("command") or d.get("tool_input", {}).get("command", ""))' 2>/dev/null)"
cwd="$(printf '%s' "$input" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("cwd") or "")' 2>/dev/null)"
case "$command" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) allow ;; esac
[ -z "$cwd" ] || cd "$cwd" 2>/dev/null || allow
[ -f tests/precheck.sh ] || allow

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
[ -n "$scripts" ] || allow

args=()
while IFS= read -r script; do
  [ -n "$script" ] && args+=("$script")
done <<HOOK_SCRIPTS
$scripts
HOOK_SCRIPTS

out="$(bash tests/precheck.sh "${args[@]}" 2>&1)"
if [ $? -ne 0 ]; then
  printf '%s' "$out" | "$PY" -c 'import json,sys
out = sys.stdin.read()
print(json.dumps({"permission": "deny",
    "userMessage": "mxcli exec blocked: the script would break the build (see the agent message).",
    "agentMessage": "Blocked: that exec would break the build (mx check on a copy of the model, nothing changed). Fix the script and exec again:\n" + out}))'
  exit 0
fi
allow
