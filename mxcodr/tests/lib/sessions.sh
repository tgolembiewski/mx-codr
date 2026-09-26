# tests/lib/sessions.sh -- part of tests/lib.sh, which sources it; never run it on its own.
# Browser sessions: sign out after each test or keep the session between runs (KEEP_SESSION,
# MDL_SESSION_REUSE, FRESH_SESSION), and spot a trial-licence session refusal. Sets an EXIT trap.

# --- 6. Sessions ---
# The licence caps concurrent sessions, so a scenario signs out in its own `finally`.
# KEEP_SESSION=1 / MDL_SESSION_REUSE=1: stay signed in, reused for the same TEST_USER. FRESH_SESSION=1: never reuse.
# Both flags are 1 or 0: they are written into the scenario's JavaScript as numbers.
if [ "${KEEP_SESSION:-0}" = "1" ] || [ "${MDL_SESSION_REUSE:-0}" = "1" ]; then
  _MDL_RELEASE=0   # stay signed in after the scenario
  _MDL_REUSE=1     # and pick that session up in the next one
else
  _MDL_RELEASE=1
  _MDL_REUSE=0
fi
if [ "${FRESH_SESSION:-0}" = "1" ]; then _MDL_REUSE=0; fi
# EXIT handler: stop the watchdog, report a timeout set -e hid, remove temp files, sign out after a timeout.
_release_session() {
  local status=$?
  kill "$_MDL_WATCHDOG" 2>/dev/null || true
  if [ "$_MDL_TIMED_OUT" = "0" ] && [ -f "$_MDL_TIMEOUT_FLAG" ]; then
    _mdl_timeout_message
    _MDL_TIMED_OUT=1
    status=124
  fi
  rm -f "$_MDL_TIMEOUT_FLAG"
  # set -e ended the script on a command that printed no reason: the runner showed a bare FAIL.
  if [ "$status" != "0" ] && [ "$_MDL_TIMED_OUT" = "0" ] && [ "${_MDL_FAIL_SAID:-0}" = "0" ] \
     && [ -n "${_MDL_ERR_LINE:-}" ]; then
    if [ -s "$_MDL_FAIL_NOTE" ]; then
      # A fail inside $(...): its own message, which the subshell's stderr may have lost.
      echo "$(head -1 "$_MDL_FAIL_NOTE") (line $_MDL_ERR_LINE)" >&2
    else
      echo "FAIL: $(basename "$0") stopped at line $_MDL_ERR_LINE, \`${_MDL_ERR_CMD:0:120}\` (exit $status), with no message." \
        "A function that calls exit inside \$(...) ends the whole \$(...), so an '|| fallback' in it never runs;" \
        "call it on its own line, or drop the 2>/dev/null to see why it failed" >&2
    fi
  fi
  rm -f "$_MDL_FAIL_NOTE"
  # The scenario file holds the password.
  [ -n "${_MDL_SCENARIO_FILE:-}" ] && rm -f "$_MDL_SCENARIO_FILE"
  # Only a timed-out scenario skipped its sign-out; bounded because that browser hung.
  if [ "$_MDL_TIMED_OUT" = "1" ] && [ "$_MDL_RELEASE" = "1" ] && [ -n "$TEST_PASSWORD" ]; then
    _mdl_bounded 5 playwright-cli run-code \
      "async () => { try { await page.evaluate(() => { if (window.mx && mx.logout) mx.logout(); }); } catch (e) {} return true; }" || true
  fi
  return $status
}
_MDL_FAIL_NOTE="$(mdl_tmpfile mdl-fail)"
trap _release_session EXIT
# Where set -e stopped the script; the EXIT trap names it when nothing else said why.
trap '_MDL_ERR_LINE=$LINENO; _MDL_ERR_CMD=$BASH_COMMAND' ERR

# release_session -- sign out within 10s, never fails; gate.sh calls it after a reuse run.
release_session() {
  _mdl_bounded 10 playwright-cli run-code \
    "async () => { try { await page.evaluate(() => { if (window.mx && mx.logout) mx.logout(); }); await page.waitForSelector('#usernameInput, input[name=username]', {timeout: 5000}); } catch (e) {} return true; }" || true
}

# Print a session refusal logged in the last 2 minutes; return 1 if none.
_licence_refusal() {
  [ -f "$RUNTIME_LOG" ] || return 1
  tail -400 "$RUNTIME_LOG" 2>/dev/null | grep "Maximum number of sessions exceeded" | tail -1 \
    | "$PY" -c "
import datetime, re, sys
line = sys.stdin.read().strip()
if not line:
    sys.exit(1)
stamp = re.match(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
if not stamp:
    sys.exit(1)
when = datetime.datetime.strptime(stamp.group(1), '%Y-%m-%d %H:%M:%S')
if (datetime.datetime.now() - when).total_seconds() > 120:
    sys.exit(1)
print('the runtime refused a session: Maximum number of sessions exceeded (developer/trial licence caps concurrent sessions). Close leftover test browsers and developer tabs, or restart the runtime')
"
}

# _runtime_errors_since <YYYY-MM-DD HH:MM:SS> -- the runtime's ERROR lines logged since then, each
# with the exception message on the line after it, on one line (at most 2, 300 characters).
_runtime_errors_since() {
  [ -n "${1:-}" ] && [ -f "$RUNTIME_LOG" ] || return 0
  tail -3000 "$RUNTIME_LOG" 2>/dev/null | awk -v since="$1" '
    /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] / { stamped = 1; if (substr($0, 1, 19) < since) { keep = 0; next } }
    / ERROR - / { if (keep) print line; line = substr($0, 25); keep = 1; next }
    stamped && keep == 1 && /^[^\t ]/ && !/^[0-9][0-9][0-9][0-9]-/ { line = line ": " $0; keep = 2; next }
    /^[0-9][0-9][0-9][0-9]-/ { if (keep) print line; keep = 0 }
    END { if (keep) print line }' \
    | awk '!seen[$0]++' | tail -2 | tr '\n' ' ' | cut -c1-300 | sed 's/ *$//'
}
