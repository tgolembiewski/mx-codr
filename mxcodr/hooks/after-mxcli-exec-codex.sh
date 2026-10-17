#!/usr/bin/env bash
# Codex PostToolUse hook (matcher ^Bash$): after an `mxcli exec`, marks the session for stop-gate-codex.sh
# and runs after-mxcli-exec.sh. Its output goes to stderr with exit 2 (Codex feeds it back to the model);
# exit 0 silently otherwise, since Codex ignores plain PostToolUse stdout.
set -uo pipefail

# Cheap substring test first: almost no event is an `mxcli exec`.
input="$(cat)"
# A new tests/verify-*.test.sh written from the shell: run it now (after-test-written.sh).
case "$input" in *verify-*.test.sh*)
  printf '%s' "$input" | bash "$(dirname "${BASH_SOURCE[0]}")/after-test-written.sh" codex && : || exit 2 ;;
esac
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac

# NODE and HOOK_TOOL (hook_tool.cjs, the small jobs: read a field, wrap a message).
. "$(dirname "${BASH_SOURCE[0]}")/hook-env.sh"

command="$(printf '%s' "$input" | "$NODE" "$HOOK_TOOL" command 2>/dev/null)"
case "$command" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Marker: the stop hook runs the gate only for sessions that changed the model.
session_id="$(printf '%s' "$input" | "$NODE" "$HOOK_TOOL" get-default session_id 2>/dev/null)"
if marker="$(gate_marker codex "$session_id")" && mkdir -p "${marker%/*}" 2>/dev/null; then
  printf '%s\n' "$repo_root" > "$marker"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
feedback="$(printf '%s' "$input" | (cd "$repo_root" && bash "$script_dir/after-mxcli-exec.sh"))"
if [ -n "$feedback" ]; then
  printf '%s\n' "$feedback" >&2
  exit 2
fi
exit 0
