# tests/lib/timeout.sh -- part of tests/lib.sh, which sources it; never run it on its own.
# The per-script time limit (SCRIPT_TIMEOUT): a watchdog that kills a test's process tree
# before playwright verify gives up on it, so the failure says what timed out. Runs at source time.

# --- 5. Time limit ---
# The runner's SIGKILL leaves playwright-cli running, so each script kills its own tree 5s earlier.
_MDL_LIMIT="${SCRIPT_TIMEOUT:-90}"; _MDL_LIMIT="${_MDL_LIMIT%s}"
case "$_MDL_LIMIT" in ''|*[!0-9]*) _MDL_LIMIT=90 ;; esac
if [ "$_MDL_LIMIT" -gt 15 ]; then _MDL_LIMIT=$((_MDL_LIMIT - 5)); fi

# Print every process under <pid>, deepest first (pgrep, or ps -ef on Git Bash).
_mdl_descendants() {
  local child
  # Skip $BASHPID: the watchdog subshell must not kill itself.
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$1" 2>/dev/null); do
      [ "$child" = "$BASHPID" ] && continue
      _mdl_descendants "$child"; echo "$child"
    done
  else
    for child in $(ps -ef 2>/dev/null | awk -v p="$1" 'NR > 1 && $2 == p {print $1}'); do
      [ "$child" = "$BASHPID" ] && continue
      _mdl_descendants "$child"; echo "$child"
    done
  fi
}
_mdl_kill_tree() {   # _mdl_kill_tree <pid>
  local victims
  victims="$(_mdl_descendants "$1")"
  [ -n "$victims" ] || return 0
  # shellcheck disable=SC2086
  kill -TERM $victims 2>/dev/null || true
  sleep 1
  # shellcheck disable=SC2086
  kill -KILL $victims 2>/dev/null || true
}

# Bash defers a trapped TERM until the foreground command ends, so the watchdog also kills the children.
# The flag file appearing tells the EXIT trap the watchdog fired.
_MDL_TIMEOUT_FLAG="$(mdl_tmpfile mdl-watchdog)"; rm -f "$_MDL_TIMEOUT_FLAG"
_MDL_TIMED_OUT=0
# The timeout report, on stderr; both the TERM and the EXIT handler print it.
_mdl_timeout_message() {
  echo "FAIL: test exceeded ${_MDL_LIMIT}s (SCRIPT_TIMEOUT): a browser call or a polling loop never returned." \
       "If the next test hangs too, the browser is stuck: playwright-cli close && playwright-cli open" >&2
}
# TERM handler: report, kill the children, exit 124.
_mdl_timed_out() {
  _MDL_TIMED_OUT=1
  _mdl_timeout_message
  _mdl_kill_tree $$
  exit 124
}
trap _mdl_timed_out TERM
# Watchdog: sleep, set the flag, TERM the script, kill its process tree.
( trap 'kill $! 2>/dev/null; exit 0' TERM
  sleep "$_MDL_LIMIT" & wait $!
  : > "$_MDL_TIMEOUT_FLAG"
  kill -TERM $$ 2>/dev/null
  _mdl_kill_tree $$ ) 2>/dev/null &
_MDL_WATCHDOG=$!

# _mdl_bounded <seconds> <command...> -- run it, give up after <seconds> (the browser may be hung).
_mdl_bounded() {
  local limit="$1" pid waited=0; shift
  "$@" >/dev/null 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge $((limit * 4)) ]; then kill "$pid" 2>/dev/null; return 1; fi
    perl -e 'select undef, undef, undef, 0.25' 2>/dev/null || sleep 1
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null
}
