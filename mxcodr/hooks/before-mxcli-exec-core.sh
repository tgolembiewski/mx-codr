#!/usr/bin/env bash
# hooks/before-mxcli-exec-core.sh -- the part of the before-exec hook every host shares. Sourced by
# before-mxcli-exec.sh (Claude Code) and before-mxcli-exec-cursor.sh (Cursor); never run on
# its own. The two hooks differed only in how they read the call and answer it, and three changes
# in one day were made twice each. Provides: NODE, HOOK_TOOL, hook_sleep_message, inline_mdl,
# steps_before_exec, hook_scripts, script_written_before_exec, hook_marketplace_wait, HOOK_VARIABLE_MESSAGE, HOOK_BLOCKED_HEAD, hook_precheck.

# NODE and HOOK_TOOL (hook_tool.cjs, the small jobs: read a field, wrap a message).
. "$(dirname "${BASH_SOURCE[0]}")/hook-env.sh"

# hook_sleep_message <command> -- prints the block message when the command sleeps before the gate
# or a log wait (`...; sleep 12; bash tests/gate.sh`): the gate waits for the runtime itself.
hook_sleep_message() {
  if printf '%s' "$1" | grep -qE '(^|[^[:alnum:]_])sleep[[:space:]]+[0-9]' \
     && printf '%s' "$1" | grep -qE 'tests/gate\.sh|gate-boot\.log|runtime\.log'; then
    echo "Blocked: drop the \`sleep\` -- tests/gate.sh waits for the runtime and for --watch to apply the latest change itself, and says so; a hand-rolled wait only adds seconds. Run the same command without it."
  fi
}

# MDL given to mxcli with -c that changes the model (CREATE, ALTER, DROP, GRANT, REVOKE, MOVE,
# RENAME), NUL-separated. It went round the precheck: one broken access rule written that way
# blocked every later exec with an error that was not in its script.
inline_mdl() {
  printf '%s' "$1" | "$NODE" "$HOOK_TOOL" inline-mdl 2>/dev/null
}
# steps_before_exec <command> -- prints a note when the command does more than set variables or cd
# before its `mxcli exec`: a blocked command runs none of it. GLM sent `python3 <edit> ... ; ./mxcli
# exec` seven times, was blocked before the edit ran, and debugged an edit that was never applied.
steps_before_exec() {
  printf '%s' "$1" | "$NODE" "$HOOK_TOOL" steps-before-exec 2>/dev/null
}

# hook_scripts <command> -- the .mdl words of the command, one per line, split like a shell (shlex,
# no execution; globs expanded, bounded like after-mxcli-exec.sh).
hook_scripts() {
  printf '%s' "$1" | "$NODE" "$HOOK_TOOL" scripts 2>/dev/null
}

# script_written_before_exec <command> <script>... -- prints the block message when a step before
# the exec writes one of its scripts (an edit, a move, a new file). The precheck runs before the
# command, so it checked the old file -- or found none and let the exec through: a DeepSeek session
# ran `mv 05b.mdl 04c.mdl && mxcli exec 04c.mdl`, and a python edit followed by the exec put four
# build errors into the model. A step that only reads the script (grep, cat) is fine. Same rule as
# scriptWrittenBeforeExec in checks/plugins/harness-core.cjs.
script_written_before_exec() {
  local command="$1"; shift
  printf '%s' "$command" | "$NODE" "$HOOK_TOOL" script-written "$@" 2>/dev/null
}

# hook_marketplace_wait <command> -- prints the login message, and returns 3, while the app needs a
# Marketplace module and mxcli is not logged in (tests/marketplace-login.sh decides); 0 otherwise.
hook_marketplace_wait() {
  [ -f tests/marketplace-login.sh ] || return 0
  HOOK_MARKETPLACE_OUT="$(bash tests/marketplace-login.sh before "$1" 2>/dev/null)"
}

HOOK_VARIABLE_MESSAGE="Blocked: that exec names its script through a variable (\`\$f.mdl\` in a loop), so the precheck cannot see which script runs and the model would change unchecked. Exec each script by its own path, one command per script: ./mxcli exec mdlsource/41_pages.mdl -p App.mpr"
# One head for every precheck refusal: a build error found by mx check on a copy, a document created
# twice (SCRIPT01), a page with no test yet (TEST01). "would break the build" read wrong on the last two.
HOOK_BLOCKED_HEAD="Blocked by the precheck (nothing changed in the model). Do what it says below, then exec again:"

# hook_precheck <script>... [--inline <mdl>]... -- runs tests/precheck.sh; HOOK_OUT holds its output,
# HOOK_STATUS its exit code.
hook_precheck() {
  HOOK_OUT="$(bash tests/precheck.sh --for-exec "$@" 2>&1)"
  HOOK_STATUS=$?
}
