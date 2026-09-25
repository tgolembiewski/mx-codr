#!/usr/bin/env bash
# lib.sh -- shared helpers for browser tests. A test sources it after its `# covers:` line:
#   source "$(dirname "$0")/lib.sh"
# Rule: ONE scenario per test -- each playwright-cli process costs ~0.6s to start; oql is ~0.03s.
# Exit codes: pass 0, fail() 1, SCRIPT_TIMEOUT 124.
#
# Shell helpers:
#   scenario '<js body>'                 run one browser journey; print its return value as JSON
#   field "$result" <key>                print one value (true/false/null spelled as JSON)
#   fields "$result" <key>...            print several values, one per line
#   oql "<OQL>"                          query the app's database; rows as JSON
#   oql_count <Entity> ["<where>"]       count matching rows of $MODULE.<Entity>
#   oql_value <Entity> <Attr> "<where>"  first match's value ('empty' / 'no-such-row')
#   await_row <Entity> "<where>" [s]     wait up to s seconds (default 8) for a row; 1 if none
#   fail "<message>"                     "FAIL: <message>" on stderr, exit 1
#   release_session                      sign the browser out (gate.sh, end of run)
#
# JS helpers a scenario body can call (open_app, menu, fill, row_action, ...): listed at the
# top of tests/scenario-helpers.js.
#
# Env (all optional):
#   BASE_URL                               app address (default http://localhost:8081)
#   APP_DIR, MPR                           project folder and .mpr (default: folder above tests/)
#   MXCLI, PY                              mxcli and Python (default: tests/portable.sh)
#   TEST_USER, TEST_PASSWORD, CREDENTIALS  sign-in (default: tests/credentials.env)
#   MODULE                                 module for oql_count/oql_value (default: the
#                                          test's `# covers:` module, then MDL_DEFAULT_MODULE)
#   RUNTIME_LOG                            read for licence refusals (default .mxcli/runtime.log)
#   SCRIPT_TIMEOUT                         per-script limit, "90" or "90s"
#   ACTION_TIMEOUT_MS                      wait per browser step (default 8000)
#   KEEP_SESSION, MDL_SESSION_REUSE, FRESH_SESSION  session reuse (section 6)
#   ADMIN_HOST, ADMIN_PORT                 admin API for oql (default localhost:8090)
#
# Sections: 1 Paths  2 Credentials  3 Module  4 fail  5 Time limit  6 Sessions
#           7 scenario  8 field/fields  9 Data assertions

# --- 1. Paths and tools ---
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8081}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
_MDL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MPR="${MPR:-$(cd "$APP_DIR" && ls -1 *.mpr | head -1)}"
# MXCLI and PY come from portable.sh unless already set.
PORTABLE_APP_DIR="$APP_DIR"
. "$(dirname "${BASH_SOURCE[0]}")/portable.sh"

# --- 2. Credentials ---
# From the environment, else tests/credentials.env (TEST_USER=, TEST_PASSWORD=,
# TEST_PASSWORD_<user>=), else none (Security Level: Off).
CREDENTIALS="${CREDENTIALS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/credentials.env}"
if [ -z "${TEST_USER:-}" ] && [ -f "$CREDENTIALS" ]; then
  _user_line="$(grep -E '^TEST_USER=' "$CREDENTIALS" 2>/dev/null | tail -1 || true)"
  TEST_USER="${_user_line#*=}"
fi
TEST_USER="${TEST_USER:-demo_administrator}"
if [ -z "${TEST_PASSWORD:-}" ] && [ -f "$CREDENTIALS" ]; then
  # Read as data, never sourced. -F: TEST_USER is a literal, not a pattern.
  _per_user="$(grep -F -- "TEST_PASSWORD_${TEST_USER}=" "$CREDENTIALS" 2>/dev/null \
    | grep -F -v -e '#' | tail -1 || true)"
  _shared="$(grep -E '^TEST_PASSWORD=' "$CREDENTIALS" 2>/dev/null | tail -1 || true)"
  TEST_PASSWORD="${_per_user#*=}"
  [ -n "$TEST_PASSWORD" ] || TEST_PASSWORD="${_shared#*=}"
  TEST_PASSWORD="${TEST_PASSWORD%\"}"; TEST_PASSWORD="${TEST_PASSWORD#\"}"
fi
TEST_PASSWORD="${TEST_PASSWORD:-}"

# --- 3. Module ---
# MODULE if set; else the module on the test's `# covers:` line (so an app with several modules
# works, and a red-first test runs before the module exists); else the gate's MDL_DEFAULT_MODULE;
# else the project's first own module.
if [ -z "${MODULE:-}" ] && [ -f "${BASH_SOURCE[1]:-}" ]; then
  MODULE="$(sed -nE 's/^#[[:space:]]*covers:[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)\..*/\1/p' \
    "${BASH_SOURCE[1]}" 2>/dev/null | head -1)"
fi
MODULE="${MODULE:-${MDL_DEFAULT_MODULE:-}}"
if [ -z "${MODULE:-}" ]; then
  # `|| true`: under set -e an unreadable module list must not end the test here; oql_count
  # then fails with "needs a module", which says what is missing.
  MODULE="$(mdl_user_modules "$APP_DIR/$MPR" | sed -n 1p)" || true
fi

# --- 4. fail and the runtime log ---
RUNTIME_LOG="${RUNTIME_LOG:-$APP_DIR/.mxcli/runtime.log}"

# Inside $(...) fail ends only that subshell; callers add `|| exit 1`.
fail() { echo "FAIL: $*" >&2; exit 1; }

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
  # The scenario file holds the password.
  [ -n "${_MDL_SCENARIO_FILE:-}" ] && rm -f "$_MDL_SCENARIO_FILE"
  # Only a timed-out scenario skipped its sign-out; bounded because that browser hung.
  if [ "$_MDL_TIMED_OUT" = "1" ] && [ "$_MDL_RELEASE" = "1" ] && [ -n "$TEST_PASSWORD" ]; then
    _mdl_bounded 5 playwright-cli run-code \
      "async () => { try { await page.evaluate(() => { if (window.mx && mx.logout) mx.logout(); }); } catch (e) {} return true; }" || true
  fi
  return $status
}
trap _release_session EXIT

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

# --- 7. scenario ---
# scenario '<js body>' -- run the body in one playwright-cli process; print its return as JSON, fail() on error.
# Steps: write the JavaScript to a file, run it, fail on an error, print the result.
scenario() {
  local body="$1"
  local code_file output
  code_file="$(mdl_tmpfile mdl-scenario)"
  # Written to a file: bodies contain double quotes.
  _mdl_scenario_js "$body" > "$code_file"

  # So the EXIT trap can delete it (it holds the password) after a timeout.
  _MDL_SCENARIO_FILE="$code_file"
  _MDL_SCENARIO_START="$(date '+%Y-%m-%d %H:%M:%S')"
  output="$(playwright-cli run-code "$(cat "$code_file")" 2>&1)"
  rm -f "$code_file"; _MDL_SCENARIO_FILE=""

  # Called directly, not in $(...): fail() must end the script, not a subshell.
  _mdl_fail_on_scenario_error "$output"
  _mdl_scenario_result "$output"
}

# _mdl_scenario_js <body> -- the whole async function: settings, helpers, then the body in try/catch.
_mdl_scenario_js() {
  local body="$1"
  printf 'async () => {\n'
  _mdl_js_settings
  _mdl_js_helpers
  # verify shows only the last stderr line, so the catch adds url and user to the error.
  printf '  try {\n'
  printf '%s\n' "$body"
  _mdl_js_catch_and_sign_out
  printf '}\n'
}

# The JS constants: BASE, USER, PASSWORD, ACTION_TIMEOUT, RELEASE, REUSE.
_mdl_js_settings() {
  # JSON-encoded: these values are data, and an apostrophe must not end the JS string.
  printf '  const MDL_CFG = JSON.parse(%s);\n' "$(mdl_json_string \
    "$(mdl_json_object BASE "$BASE_URL" USER "$TEST_USER" PASSWORD "$TEST_PASSWORD")")"
  printf '  const BASE = MDL_CFG.BASE;\n'
  printf '  const USER = MDL_CFG.USER;\n'
  printf '  const PASSWORD = MDL_CFG.PASSWORD;\n'
  printf '  const ACTION_TIMEOUT = %s;\n' "$(mdl_json_number "${ACTION_TIMEOUT_MS:-8000}" 8000)"
  printf '  const RELEASE = %s;\n' "$_MDL_RELEASE"
  printf '  const REUSE = %s;\n' "$_MDL_REUSE"
}

# The JS helpers a body calls, from tests/scenario-helpers.js.
_mdl_js_helpers() {
  [ -f "$_MDL_LIB_DIR/scenario-helpers.js" ] \
    || fail "tests/scenario-helpers.js is missing -- re-run the installer"
  sed '1,/^\/\/ ---- helpers (lib.sh copies from the next line on) ----$/d' "$_MDL_LIB_DIR/scenario-helpers.js"
}

# The end of the try: the catch adds url, user and login message; the finally signs out.
_mdl_js_catch_and_sign_out() {
  cat <<'CATCH'
  } catch (e) {
    const url = page.url();  // synchronous in Playwright; do not await or .catch it
    // mx is absent on login.html, so asking for the user there throws. Neither
    // getUserName() nor getUserAttribute() exists on mx.session in 11.12 -- the
    // name sits in sessionData, as {value: 'demo_administrator'}. Measured.
    const who = await current_user();
    let why = String((e && e.message) || e).split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).join(' | ');
    // An open dialog is usually the cause ("Password has an issue: ...") and sits behind
    // the page text a timeout quotes, so it goes first.
    const dialog = await page.locator('.modal-dialog:visible, .mx-dialog:visible').allInnerTexts()
      .then(ts => ts.map(t => t.replace(/[\s×]+/g, ' ').replace(/ OK$/, '').trim()).filter(Boolean).join(' / '))
      .catch(() => '');
    if (dialog) why = 'open dialog: "' + dialog.slice(0, 300) + '" | ' + why;
    if (/selectOption/.test(why)) why += ' | a Mendix combo box is not a <select>: use pick_combo(widget, option)';
    // A refused sign-in leaves a message on the login page; without it the failure
    // reads as a plain selector timeout and says nothing about the cause.
    let note = '';
    if (/login/.test(url)) {
      note = await page.locator('.login-message, .alert, #loginMessage, .mx-validation-message').first()
        .innerText({timeout: 500}).then(t => t.replace(/\s+/g, ' ').trim()).catch(() => '');
    }
    throw new Error(why + ' [on ' + url + (who ? ', signed in as ' + who : '') + (note ? ', page says: ' + note : '') + ']');
  } finally {
    // Release the session here, in-process, on success and on failure alike. Only
    // where there was a sign-in: with Security Level: Off there is no session to
    // end and no login page to wait for. The short wait lets the logout request
    // reach the runtime before the process ends -- a navigation right after
    // mx.logout() would cancel it and leave the session counted.
    if (RELEASE && PASSWORD) {
      try {
        await page.evaluate(() => { if (window.mx && window.mx.logout) window.mx.logout(); });
        await page.waitForSelector(LOGIN_FIELD, {timeout: 5000});
      } catch (e) {}
    }
    // The goto guard is this scenario's, not the page's: left in place it refused
    // the next hand-run `playwright-cli run-code` probe as a "mid-journey reload".
    page.goto = page.__mdl_raw_goto;
  }
CATCH
}

# _mdl_fail_on_scenario_error <output> -- fail() when playwright-cli reported an error or no result.
# playwright-cli prints its answer in sections headed "### Result" or "### Error".
_mdl_fail_on_scenario_error() {
  local output="$1"
  if printf '%s' "$output" | grep -q '^### Error'; then
    # Full block to stderr; a one-line summary in fail(), the only line verify reprints.
    printf '%s\n' "$output" | sed -n '/^### Error/,/^###/p' | head -8 >&2
    local why
    why="$(_mdl_error_summary "$output")"
    local refusal logged
    refusal="$(_licence_refusal || true)"
    logged="$(_runtime_errors_since "${_MDL_SCENARIO_START:-}")"
    fail "browser scenario failed: ${logged:+runtime logged during this test: $logged | }${why:-no error text}${refusal:+ -- $refusal}"
  fi
  # Neither marker. "### Ran Playwright code" means the code did run and simply returned nothing:
  # a session read the old "needs: playwright-cli open" hint for that case and went looking at
  # the browser instead of the missing `return` at the end of its scenario.
  if ! printf '%s' "$output" | grep -q '^### Result'; then
    if printf '%s' "$output" | grep -q '^### Ran Playwright code'; then
      fail "browser scenario returned nothing -- end the scenario body with a return, e.g. \`return {ok: true};\` (the checks above it ran; a scenario must return a value)"
    fi
    fail "browser scenario produced no result: $(printf '%s' "$output" | tr '\n' ' ' | tr -s ' ' | cut -c1-200) (running a test outside the runner needs: playwright-cli open)"
  fi
}

# _mdl_error_summary <output> -- the "### Error" text on one line, colours removed, at most 400 chars.
_mdl_error_summary() {
  printf '%s\n' "$1" \
    | sed -n '/^### Error/,/^### [A-Z]/p' | sed '1d;/^### /d' \
    | sed $'s/\033\[[0-9;]*m//g' | tr '\n' ' ' | tr -s ' ' | sed 's/^ //;s/ $//' | cut -c1-400
}

# _mdl_scenario_result <output> -- print the "### Result" section without blank lines.
_mdl_scenario_result() {
  printf '%s' "$1" | awk '/^### Result/{flag=1; next} /^### /{flag=0} flag' | sed '/^$/d'
}

# --- 8. Reading the result ---
# field <json> <key> -- booleans and null as JSON spells them; plain strings unquoted.
field() {
  local json="$1" key="$2"
  printf '%s' "$json" | "$PY" -c "
import json, sys
raw = sys.stdin.read().strip()
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print('')
    sys.exit()
if isinstance(data, str):
    data = json.loads(data)
value = data.get(sys.argv[1], '')
print(value if isinstance(value, str) else json.dumps(value))
" "$key"
}

# fields <json> <key...> -- one line per key, as field(), in one Python start:
#   { read -r opened; read -r count; } <<< "$(fields "$result" opened count)"
fields() {
  local json="$1"; shift
  printf '%s' "$json" | "$PY" -c "
import json, sys
raw = sys.stdin.read().strip()
keys = sys.argv[1:]
try:
    data = json.loads(raw)
    if isinstance(data, str):
        data = json.loads(data)
except json.JSONDecodeError:
    data = {}
for key in keys:
    value = data.get(key, '')
    print(value if isinstance(value, str) else json.dumps(value))
" "$@"
}

# --- 9. Data assertions (~0.03s each) ---
# oql "<query>" -- rows as JSON, or fail with mxcli's own error. An entity after FROM or JOIN
# is written Module."Entity"; one written without its module gets $MODULE.
oql() {
  local query output
  query="$(oql_qualified "$1")"
  # `if !` keeps the output and stops set -e exiting before the error is reported.
  if ! output="$("$MXCLI" oql -p "$APP_DIR/$MPR" --host "${ADMIN_HOST:-localhost}" \
                 --port "${ADMIN_PORT:-8090}" --json "$query" 2>&1)"; then
    fail "OQL failed: $(printf '%s' "$output" | grep -v '^$' | grep -v 'vibe-coded PoC' | head -2 | tr '\n' ' ')
   (write an entity as Module.\"Entity\", e.g. ${MODULE:-MyModule}.\"Order\"; reach an association with
   JOIN o/Module.Assoc/Module.Entity AS x; or count with oql_count <Entity> \"<where>\")"
  fi
  # mxcli appends a "(n rows)" line, so decode only the first JSON value.
  local json
  json="$(printf '%s' "$output" | "$PY" -c "
import json, sys
text = sys.stdin.read()
start = text.find('[')
if start < 0:
    sys.exit(1)
try:
    value, _ = json.JSONDecoder().raw_decode(text[start:])
except ValueError:
    sys.exit(1)
print(json.dumps(value))
")" || fail "OQL returned nothing to parse: $(printf '%s' "$output" | grep -v '^$' | head -2 | tr '\n' ' ')"
  printf '%s' "$json"
}

# The query with each entity after FROM or JOIN written Module."Entity": `"Order"` and `Order`
# take $MODULE, `"Sales.Order"` and `Sales.Order` become Sales."Order". A session spent five
# queries on "'Order' is not a valid entity path". Association paths (o/...) and subqueries pass.
oql_qualified() {   # oql_qualified <query>
  MODULE="${MODULE:-}" "$PY" -c '
import os, re, sys
module = os.environ["MODULE"]
def entity(found):
    keyword, name = found.group(1), found.group(2).replace("\"", "")
    if "." in name:
        owner, name = name.rsplit(".", 1)
    elif module:
        owner = module
    else:
        return found.group(0)
    return "%s %s.\"%s\"" % (keyword, owner, name)
query = sys.argv[1]
print(re.sub(r"\b(FROM|JOIN)\s+(\"[\w.]+\"|[A-Za-z_][\w.]*(?![\w.\"/]))", entity, query, flags=re.IGNORECASE))
' "$1"
}

# The entity as OQL reads it: quoted, so one named Order (or another reserved word) parses.
oql_entity() {   # oql_entity <Entity>
  printf '%s."%s"' "$MODULE" "${1//\"/}"
}

# oql_count <Entity> ["<where>"] -- WHERE is OQL: reach associations with JOIN, not paths.
oql_count() {
  local entity="$1" where="${2:-}"
  [ -n "${MODULE:-}" ] || fail "oql_count needs a module: set MODULE=<YourModule> or run through tests/gate.sh"
  local query="SELECT COUNT(*) AS Total FROM $(oql_entity "$entity")"
  # Not `[ -n "$where" ] && ...`: with set -e, the false test ends the function.
  if [ -n "$where" ]; then
    query="$query WHERE $where"
  fi
  # Captured, not piped: a failing oql must stop here, not feed python empty input.
  local json
  json="$(oql "$query")" || exit 1
  printf '%s' "$json" | "$PY" -c "
import json, sys
rows = json.load(sys.stdin)
print(rows[0].get('Total', 0) if rows else 0)
"
}

# await_row <Entity> "<where>" [seconds] -- 0 once a row matches, 1 after <seconds> (default 8)
# or when the query itself fails.
await_row() {
  local entity="$1" where="$2" limit="${3:-8}" waited=0 count
  while :; do
    count="$(oql_count "$entity" "$where")" || return 1
    [ "$count" = "0" ] || return 0
    waited=$((waited + 1))
    [ "$waited" -ge "$((limit * 4))" ] && return 1
    perl -e 'select undef, undef, undef, 0.25'
  done
  return 0
}

# oql_value <Entity> <Attr> "<where>" -- 'no-such-row' if none; 'empty' for null or "";
# booleans print true/false, numbers as they are (0 stays 0).
oql_value() {
  local entity="$1" attribute="$2" where="$3"
  local json
  [ -n "${MODULE:-}" ] || fail "oql_value needs a module: set MODULE=<YourModule> or run through tests/gate.sh"
  json="$(oql "SELECT $attribute FROM $(oql_entity "$entity") WHERE $where")" || exit 1
  printf '%s' "$json" | "$PY" -c "
import json, sys
rows = json.load(sys.stdin)
if not rows:
    print('no-such-row')
else:
    value = rows[0].get(sys.argv[1])
    if value is None or value == '':
        print('empty')
    elif isinstance(value, bool):
        print('true' if value else 'false')
    else:
        print(value)
" "$attribute"
}
