#!/usr/bin/env bash
# Cursor postToolUse hook (no matcher, so it filters for `mxcli exec` itself): marks the conversation
# for stop-gate-cursor.sh and prints {"additional_context": "<after-mxcli-exec.sh output>"}, or {}. Exit 0.
set -uo pipefail

# Cheap substring test first: almost no event is an `mxcli exec`.
input="$(cat)"
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) printf '{}\n'; exit 0 ;; esac

# Prints the first Python that actually runs (Windows may have only a Store stub); inlined so the hook is self-contained.
mdl_find_python() {
  local candidate
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  # The python.org installer (also via winget) does not add Python to PATH; search its install dirs too.
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

# A top-level value of the event payload, or "" when absent or unparsable.
payload_field() {
  printf '%s' "$input" | "$PY" -c 'import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1]) or "")
except Exception: print("")' "$1" 2>/dev/null
}

# Resolve before cd: BASH_SOURCE may be relative.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

emit() {  # emit "<text>" -- or nothing at all when there is nothing to say
  [ -n "${1:-}" ] || { printf '{}\n'; exit 0; }
  printf '%s' "$1" | "$PY" -c 'import json,sys; print(json.dumps({"additional_context": sys.stdin.read().strip()}))'
  exit 0
}

# Move to the project the event is about: the reported cwd, then its git root.
cwd="$(payload_field cwd)"
[ -n "$cwd" ] && [ -d "$cwd" ] && cd "$cwd" 2>/dev/null || true
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" 2>/dev/null || true

# Marker per conversation, recording the project, so the stop hook knows the gate is owed.
conversation="$(payload_field conversation_id)"
if [ -n "$conversation" ]; then
  state_dir="${TMPDIR:-/tmp}/mendix-mdl-cursor-hooks"
  safe="$(printf '%s' "$conversation" | tr -cd 'A-Za-z0-9._-')"
  if [ -n "$safe" ] && mkdir -p "$state_dir" 2>/dev/null; then
    printf '%s\n' "$repo_root" > "$state_dir/$safe.gate-required"
  fi
fi

[ -f "$script_dir/after-mxcli-exec.sh" ] || emit ""

# Build a Claude-shaped payload for the shared hook; the command is found anywhere in the event
# because tool_input's shape varies across Cursor versions.
_payload="$(printf '%s' "$input" | "$PY" -c 'import json, sys
def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
try:
    data = json.load(sys.stdin)
except Exception:
    data = None
command = next((s for s in strings(data) if "mxcli exec" in s or "mxcli.exe exec" in s), "mxcli exec")
print(json.dumps({"tool_input": {"command": command.replace("\\", "/")}}))' 2>/dev/null)"
[ -n "$_payload" ] || _payload='{"tool_input":{"command":"mxcli exec"}}'
feedback="$(printf '%s' "$_payload" | bash "$script_dir/after-mxcli-exec.sh" 2>/dev/null)"
emit "$feedback"
