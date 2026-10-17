# tests/gate/mftest.sh -- the microflow tests (*.test.mdl, *.test.md under tests/), MFTEST01: run by
# `mxcli test --local` on a copy of the project, with its own runtime on free ports.
# Sourced by tests/gate.sh; defines functions only. Entry point: step_microflow_tests.

# free_port <first> -- the first port from <first> up that nothing listens on and that is not this
# app's own (APP_PORT, ADMIN_PORT, SERVE_PORT): a fixed port collided with a Studio Pro (2026-10-15).
free_port() {
  local port="$1"
  while [ "$port" -lt $(( $1 + 100 )) ]; do
    case " ${APP_PORT:-8081} ${ADMIN_PORT:-} ${SERVE_PORT:-6543} " in
      *" $port "*) ;;
      *) [ -z "$(port_owner_command "$port")" ] && { echo "$port"; return 0; } ;;
    esac
    port=$(( port + 1 ))
  done
  return 1
}

# Microflow tests (*.test.mdl, *.test.md under tests/), MFTEST01. Only on the run that can end in
# DONE: a full gate with nothing else red, so a red suite never sends the session to them, and the
# 30-40 s they cost (21 tests, b2b, 2026-10-16) is paid once, then replayed from the cache until
# the model or a test file changes. `mxcli test --local` injects module MxTest into the model and
# rewrites javasource while it runs, so it runs on a copy, with its own runtime on free ports and
# its own scratch database: the app and its data are not touched.
step_microflow_tests() {
  local mode files how
  files="$(find tests -name '*.test.mdl' -o -name '*.test.md' 2>/dev/null | sort)"
  [ -n "$files" ] || return 0
  [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ] || return 0
  [ -z "${failures[*]:-}" ] && [ -z "${cannot_run[*]:-}" ] || return 0
  mode="$(mdl_rule_mode MFTEST01)"
  [ "$mode" = "0" ] && return 0
  if [ -n "${MDL_BOOT_COMMAND:-}" ] || [ "${MDL_RUN_MODE:-}" = "docker" ]; then
    # This project boots without `mxcli run --local` (Windows, Docker); `mxcli test --local` boots that way.
    how="run them with mxcli test (skill test-microflows): --local does not boot where mxcli run --local cannot"
    summary+=("microflow tests: under tests/, NOT run by the gate -- after changing logic $how")
    return 0
  fi
  # Read whole, then matched: `| grep -q` stops reading, mxcli gets SIGPIPE, and pipefail makes the
  # pipe false although the flag is there (measured on B2B027, 2026-10-16).
  local help; help="$("$MXCLI" test --help 2>/dev/null)"
  if ! grep -q -- '--app-port' <<< "$help"; then
    # Before mxcli 0.27 `test --local` always took 8081/8091, the app's own ports.
    how="run them: bash tests/gate.sh --stop && $MXCLI test tests/ -p $MPR --local; bash tests/gate.sh --boot-if-needed"
    summary+=("microflow tests: under tests/, NOT run by the gate -- after changing logic $how")
    return 0
  fi
  run_cached mftest run_microflow_tests $files meta:userlib meta:vendorlib meta:javasource \
    "env:MXCLI=$("$MXCLI" version 2>/dev/null | head -1)" "env:MFTEST01=$mode"
  if [ "$(cat "$WORK/mftest.status" 2>/dev/null)" = "1" ] && [ "$mode" = "warn" ]; then
    # warn in ## Local: the failures are listed, DONE is not held.
    cat "$WORK/mftest.detail" >> "$WORK/mftest.warnings" 2>/dev/null
    summary+=("$(cat "$WORK/mftest.summary") -- see == warnings (MFTEST01 at warn)")
    return 0
  fi
  collect mftest "microflow tests"
}

# run_microflow_tests -- the body of step_microflow_tests: 0 all passed, 1 a test failed, 2 could not run.
run_microflow_tests() {
  local copy="$WORK/mftest" app_port admin_port serve_port out status item
  project_copy "$copy" mftest || return 2
  for item in javascriptsource userlib vendorlib resources; do
    [ -e "$item" ] && { cp -Rc "$item" "$copy/" 2>/dev/null || cp -R "$item" "$copy/" 2>/dev/null; }
  done
  app_port="$(free_port 8097)" && admin_port="$(free_port 8107)" && serve_port="$(free_port 6557)" || {
    echo "microflow tests: could not run -- no free port from 8097, 8107 or 6557 up" > "$WORK/mftest.summary"
    return 2
  }
  # --require-assertions: a test that asserts nothing is an error, not a pass.
  out="$("$MXCLI" test "$APP_DIR/tests/" -p "$copy/$MPR" --local --require-assertions \
    --app-port "$app_port" --admin-port "$admin_port" --serve-port "$serve_port" 2>&1)"; status=$?
  { mkdir -p "$APP_DIR/.mxcli" && printf '%s\n' "$out" > "$APP_DIR/.mxcli/microflow-tests.txt"; } 2>/dev/null
  local totals; totals="$(grep -E '^Total: ' <<< "$out" | tail -1)"
  if [ "$status" = "0" ] && [ -n "$totals" ]; then
    echo "microflow tests: passed -- $totals (on a copy, ports $app_port/$admin_port)" > "$WORK/mftest.summary"
    return 0
  fi
  if [ -z "$totals" ]; then
    echo "microflow tests: could not run -- mxcli test ended before the tests ran: $(grep -v '^ *$' <<< "$out" | tail -1); the whole output: .mxcli/microflow-tests.txt" > "$WORK/mftest.summary"
    return 2
  fi
  echo "microflow tests: FAILED -- $totals; the whole output: .mxcli/microflow-tests.txt" > "$WORK/mftest.summary"
  # The FAIL or ERROR line names the test; the line under it, the expected and actual values.
  grep -A1 -E '^ *(FAIL|ERROR) ' <<< "$out" | grep -v '^--$' | head -40 | sed 's/^ */   /' > "$WORK/mftest.detail"
  echo "   fix the flow (or the test, when the requirement changed): bash tests/gate.sh --only <feature>, then the full gate" >> "$WORK/mftest.detail"
  return 1
}
