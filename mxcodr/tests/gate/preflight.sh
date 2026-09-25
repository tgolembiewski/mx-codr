# tests/gate/preflight.sh -- checks run right before the tests: sessions, a stale model, the environment.
# Sourced by tests/gate.sh; defines functions only.

# Warnings before the tests; preflight_session stops the gate (exit 2) on a trial-licence session
# refusal in the runtime log within the last two minutes, preflight_debugger on a debugger left on.
preflight_session() {
  local log="${RUNTIME_LOG:-$APP_DIR/.mxcli/runtime.log}"
  local users
  users="$(curl -s -m 5 -X POST "http://localhost:${ADMIN_PORT:-8090}/" \
      -H "X-M2EE-Authentication: $(printf '%s' "${ADMIN_PASSWORD:-mxcli-local-dev}" | base64)" \
      -H 'Content-Type: application/json' -d '{"action":"get_logged_in_user_names"}' 2>/dev/null \
    | gate_py signed-in-users 2>/dev/null)"
  [ -n "$users" ] && echo "   already signed in: $users"

  local refusal=""
  if [ -f "$log" ]; then
    refusal="$(tail -400 "$log" 2>/dev/null | grep 'Maximum number of sessions exceeded' | tail -1 \
      | gate_py recent-refusal 120 2>/dev/null)"
  fi
  [ -n "$refusal" ] || return 0
  if [ "${ALLOW_BUSY_SESSION:-0}" = "1" ]; then
    echo "   the runtime refused a session at $refusal -- running anyway (ALLOW_BUSY_SESSION=1)"
    return 0
  fi
  cat >&2 <<MSG
the runtime refused a session at $refusal:
  "Maximum number of sessions exceeded! (You are currently using a trial license)"
Every test that signs in will fail the same way, and the failure looks like a broken
feature. Close leftover browsers and developer tabs, wait for the sessions to time
out, or restart the runtime -- then run this again. ALLOW_BUSY_SESSION=1 runs anyway.
MSG
  exit 2
}

# Warns when the runtime serves an older model: security and entity changes do not hot-apply.
# The warning also goes to $WORK/stale.note, so record_red_first ignores this run.
preflight_stale_model() {
  watch_applied_latest_change && return 0
  warn_if_deployment_older
  warn_if_runtime_older
}

# A --watch boot rebuilds and applies every model change itself -- pages by reload, entities
# and security by an in-place restart. Waits for that instead of warning in the middle of it;
# true when the boot serves the latest model: it just started on it, or the last rebuild was
# applied. A failed rebuild stops the gate: the runtime still runs the previous model.
watch_applied_latest_change() {
  local boot_log="$APP_DIR/.mxcli/gate-boot.log" waited=0 state
  [ -f "$boot_log" ] && grep -q 'Watching model' "$boot_log" 2>/dev/null || return 1
  # The watcher notices a change a moment after the exec: give it a few seconds to start.
  while [ "$MPR" -nt "$boot_log" ] && [ "$waited" -lt "${MDL_WATCH_SETTLE_SECONDS:-5}" ]; do
    sleep 1; waited=$((waited + 1))
  done
  # Done means the boot serves the model AND the log has been quiet for a few seconds: three
  # execs in a row rebuild three times, and the gap between two builds looked like the end --
  # the suite then ran into a restart and a web client being re-bundled (404 on dist/index.js).
  waited=0
  local quiet="${MDL_WATCH_QUIET_SECONDS:-3}"
  while [ "$waited" -lt 120 ]; do
    state="$(gate_py watch-state "$boot_log" | head -1)"
    [ "$state" = "failed" ] && report_watch_build_failure "$boot_log"
    if { [ "$state" = "ready" ] || [ "$state" = "applied" ]; } \
       && [ "$(log_age "$boot_log")" -ge "$quiet" ] && [ ! "$MPR" -nt "$boot_log" ]; then
      break
    fi
    [ "$waited" = "0" ] && echo "   (waiting for --watch to apply the latest model change)"
    sleep 1; waited=$((waited + 1))
  done
  case "$(gate_py watch-state "$boot_log" | head -1)" in ready|applied) ;; *) return 1 ;; esac
  client_served
}

# The last --watch rebuild failed, so the app still runs the model from before it: tests would
# fail on a fix that never reached the app. Names the error and stops the gate.
report_watch_build_failure() {   # report_watch_build_failure <boot-log>
  {
    echo "--watch could not rebuild the app, so it still runs the model from before your last exec:"
    gate_py watch-state "$1" | tail -n +2 | head -8 | sed 's/^/   /'
    if debugger_enabled; then
      # A session read this CE0116 as a hiccup of the build; it was its own `mxcli debug enable`.
      echo "   The microflow debugger is on, and every rebuild fails while it is (CE0116 \"Could not"
      echo "   check expression\" on whichever widget is checked). Run: ./mxcli debug disable"
      echo "   then: bash tests/gate.sh --restart"
    else
      echo "   Fix the script and exec it again. \"Checking will resume after the next change\" is a"
      echo "   hiccup of the incremental build: bash tests/gate.sh --restart rebuilds from scratch."
    fi
    echo "   full log: $1"
  } >&2
  exit 2
}

# True when the runtime's microflow debugger is on (`mxcli debug enable`), or breakpoints set
# through mxcli are still recorded.
debugger_enabled() {
  [ -f "$APP_DIR/.mxcli/debug-breakpoints.json" ] && return 0
  debugger_on
}

# True when the running app answers that its microflow debugger is on.
debugger_on() {
  [ -n "${BASE_URL:-}" ] || return 1
  "$MXCLI" debug status -p "$MPR" --app-url "$BASE_URL" 2>/dev/null | grep -q 'Debugger: enabled'
}

# Stops the gate while the microflow debugger is on: a test that reaches a breakpoint waits there
# until its timeout and fails on something that looks like the feature, and every --watch rebuild
# fails while it is on. A session left it on after looking at one microflow.
preflight_debugger() {
  debugger_on || return 0
  cat >&2 <<'MSG'
the app's microflow debugger is on (`mxcli debug enable`): a test that reaches a breakpoint
hangs there until its timeout, and every --watch rebuild fails with CE0116 while it is on.
Run: ./mxcli debug disable   -- then run the gate again.
MSG
  exit 2
}

# Seconds since <file> last changed.
log_age() {
  "$PY" -c 'import os, sys, time; print(int(time.time() - os.path.getmtime(sys.argv[1])))' "$1" 2>/dev/null || echo 999
}

# The app answers with the web client it names in index.html: after a restart that re-bundles
# the client, index.html is back before dist/index.js is, and every test in that window fails.
client_served() {
  [ -n "${BASE_URL:-}" ] || return 0
  local script code waited=0
  script="$(curl -s --max-time 5 "$BASE_URL/index.html" 2>/dev/null | grep -oE 'src="[^"]+\.js' | head -1 | sed 's/^src="//')"
  [ -n "$script" ] || return 0
  while [ "$waited" -lt "${MDL_CLIENT_WAIT_SECONDS:-60}" ]; do
    code="$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$BASE_URL/$script" 2>/dev/null)"
    [ "$code" = "200" ] && return 0
    [ "$waited" = "0" ] && echo "   (waiting for the app to serve its web client, $script)"
    sleep 1; waited=$((waited + 1))
  done
  echo "   !! the app still does not serve $script -- run bash tests/gate.sh --restart" | tee -a "$WORK/stale.note"
  return 1
}

# Primary signal, needs no pgrep (Git Bash): .mpr newer than the built deployment.
warn_if_deployment_older() {
  local built
  for built in deployment/model/model.mdp deployment/model/metadata.json; do
    [ -f "$built" ] || continue
    gate_py deployment-age "$MPR" "$built" | tee -a "$WORK/stale.note"
    break
  done
}

# Secondary signal: .mpr newer than this project's oldest runtime process.
warn_if_runtime_older() {
  local oldest started
  command -v pgrep >/dev/null 2>&1 || return 0
  oldest="$(project_pids | head -1)"
  [ -n "$oldest" ] || return 0
  started="$(ps -o lstart= -p "$oldest" 2>/dev/null)"
  [ -n "$started" ] || return 0
  gate_py runtime-age "$MPR" "$started" | tee -a "$WORK/stale.note"
}

# Warns about a missing browser binary, a broken local database, and missing credentials.
preflight_environment() {
  local config="$APP_DIR/.playwright/cli.config.json"
  if [ -f "$config" ]; then
    local browser
    browser="$(gate_py missing-browser "$config" 2>/dev/null)"
    if [ -n "$browser" ]; then
      echo "   !! the browser binary in .playwright/cli.config.json does not exist: $browser"
      echo "      every test will fail with 'opening browser: exit status 1' -- re-run the"
      echo "      skillpack installer, which repoints it at an installed headless shell"
    fi
  fi

  mdl_check_local_database

  if [ -z "${TEST_PASSWORD:-}" ] && [ ! -f "$APP_DIR/tests/credentials.env" ]; then
    local level
    level="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | grep -i 'Security Level' | head -1)"
    case "$level" in
      *Off*|"") ;;
      *) echo "   !! $level, but tests/credentials.env is missing -- tests that sign in will"
         echo "      fail on the login page. Create it: TEST_USER=... and TEST_PASSWORD=..." ;;
    esac
  fi
}
