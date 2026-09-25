#!/usr/bin/env bash
# Codex PostToolUse hook (matcher ^Bash$): after an `mxcli exec`, marks the session for stop-gate-codex.sh
# and runs after-mxcli-exec.sh. Its output goes to stderr with exit 2 (Codex feeds it back to the model);
# exit 0 silently otherwise, since Codex ignores plain PostToolUse stdout.
set -uo pipefail

# Cheap substring test first: almost no event is an `mxcli exec`.
input="$(cat)"
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac

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

command="$(printf '%s' "$input" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null)"
case "$command" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Marker: the stop hook runs the gate only for sessions that changed the model.
session_id="$(printf '%s' "$input" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null)"
if [ -n "$session_id" ]; then
  state_dir="${TMPDIR:-/tmp}/mendix-mdl-codex-hooks"
  safe_session="$(printf '%s' "$session_id" | tr -cd 'A-Za-z0-9._-')"
  if [ -n "$safe_session" ] && mkdir -p "$state_dir" 2>/dev/null; then
    printf '%s\n' "$repo_root" > "$state_dir/$safe_session.gate-required"
  fi
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
feedback="$(printf '%s' "$input" | (cd "$repo_root" && bash "$script_dir/after-mxcli-exec.sh"))"
if [ -n "$feedback" ]; then
  printf '%s\n' "$feedback" >&2
  exit 2
fi
exit 0
