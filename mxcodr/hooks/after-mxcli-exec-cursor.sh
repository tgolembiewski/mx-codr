#!/usr/bin/env bash
# Cursor postToolUse hook (no matcher, so it filters for `mxcli exec` itself): marks the conversation
# for stop-gate-cursor.sh and prints {"additional_context": "<after-mxcli-exec.sh output>"}, or {}. Exit 0.
set -uo pipefail

# Cheap substring test first: almost no event is an `mxcli exec`.
input="$(cat)"
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) printf '{}\n'; exit 0 ;; esac

# NODE and HOOK_TOOL (hook_tool.cjs, the small jobs: read a field, wrap a message).
. "$(dirname "${BASH_SOURCE[0]}")/hook-env.sh"

# A top-level value of the event payload, or "" when absent or unparsable.
payload_field() {
  printf '%s' "$input" | "$NODE" "$HOOK_TOOL" get "$1" 2>/dev/null
}

# Resolve before cd: BASH_SOURCE may be relative.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

emit() {  # emit "<text>" -- or nothing at all when there is nothing to say
  [ -n "${1:-}" ] || { printf '{}\n'; exit 0; }
  printf '%s' "$1" | "$NODE" "$HOOK_TOOL" wrap additional_context
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
_payload="$(printf '%s' "$input" | "$NODE" "$HOOK_TOOL" cursor-payload 2>/dev/null)"
[ -n "$_payload" ] || _payload='{"tool_input":{"command":"mxcli exec"}}'
feedback="$(printf '%s' "$_payload" | bash "$script_dir/after-mxcli-exec.sh" 2>/dev/null)"
emit "$feedback"
