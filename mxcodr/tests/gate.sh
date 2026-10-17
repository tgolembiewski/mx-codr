#!/usr/bin/env bash
# tests/gate.sh -- the done gate: everything "finished" means, in one command.
#
#   bash tests/gate.sh                    # the suite and every model check (listed below)
#   bash tests/gate.sh --only crud        # one script by name fragment, warm browser
#   bash tests/gate.sh --changed          # the tests a model change touched since they last ran
#   bash tests/gate.sh --tests-only       # the suite alone
#   bash tests/gate.sh --boot-if-needed   # start the app first if nothing answers
#   bash tests/gate.sh --restart          # stop this project's runtime and boot it again (add --only to test)
#   bash tests/gate.sh --stop             # stop this project's app (and its mxbuild), then exit
#   bash tests/gate.sh --no-cache | --force # re-run cached checks | the full gate after a red --only
#   bash tests/gate.sh --reset-data       # with any of the above: tests start on the snapshot's data
#
# Eleven verdicts: the suite (tests/verify-*.test.sh) and ten model checks that need no app -- mx check,
# catalog, coverage, naming, layout, security, scope, paths, folders, unused. Each runs; a pass replays while its inputs hold.
#   DONE — every check passed               exit 0 (--only/--tests-only print PASSED, never DONE)
#   NOT DONE — failed: <checks>             exit 1
#   NOT DONE — could not run: <checks>      exit 2 (also: no .mpr, no app, a failed boot, sessions refused)
# Env: BASE_URL (else 8081 then 8080), APP_PORT (8081), SCRIPT_TIMEOUT (90s),
#      BOOT_TIMEOUT (180s), RUNTIME_LOG, ADMIN_PORT, ADMIN_PASSWORD, SERVE_PORT,
#      ALLOW_BUSY_SESSION=1, MDL_GATE_CACHE=0, MDL_BOOT_COMMAND (replaces mxcli run),
#      MDL_MXBUILD_PATH, MDL_DB_*, MDL_PSQL, MDL_VISUAL_REVIEW=agent, MDL_CLOSE_BROWSER=1,
#      MDL_DB_RESET=done|session|off -- also in tests/harness.env. A rule's level and exceptions: its card
#      in tests/rulebook/ (bash tests/rules.sh lists them).
# Lines 2-24 are printed by --help; keep them 23 lines.

# How to read this file: main() at the bottom is the whole gate, step by step. The steps
# live in tests/gate/ -- app.sh (find, boot, stop the app), checks.sh (how the ten model
# checks run, and their cache), steps.sh, layout.sh and security.sh (the checks), preflight.sh (sessions, stale model, environment),
# tests.sh (the suite), mftest.sh (the microflow tests) and verdict.sh (the verdict, its warnings and
# blockers, .mxcli/last-gate.txt). tools/mdl-checks/gate_helpers.cjs holds the Node they call.
# No -e: a failing step must not end the gate.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
cd "$APP_DIR"
. "$HARNESS_DIR/portable.sh"
for part in hints app checks steps layout security preflight tests mftest verdict; do
  if [ ! -f "$HARNESS_DIR/gate/$part.sh" ]; then
    echo "tests/gate/$part.sh is missing -- re-run the installer" >&2
    exit 2
  fi
  . "$HARNESS_DIR/gate/$part.sh"
done
# MDL_DB_RESET (done by default): dbsnap_take before the tests, dbsnap_restore after each DONE.
[ -f "$HARNESS_DIR/db-snapshot.sh" ] && . "$HARNESS_DIR/db-snapshot.sh"

# The gate's helpers (digests, JSON, timestamps) live in tools/mdl-checks/gate_helpers.cjs.
gate_helper() {
  "$NODE" tools/mdl-checks/gate_helpers.cjs "$@"
}

# Sets ONLY, TESTS_ONLY, BOOT, RESTART, STOP, USE_CACHE and RESET_DATA; --help prints lines 2-24 and exits.
parse_arguments() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --only) ONLY="$2"; shift 2 ;;
      --changed) CHANGED=1; TESTS_ONLY=1; shift ;;
      --tests-only) TESTS_ONLY=1; shift ;;
      --boot-if-needed) BOOT=1; shift ;;
      --restart) RESTART=1; BOOT=1; shift ;;
      --stop) STOP=1; shift ;;
      --no-cache) USE_CACHE=0; shift ;;
      --force) FORCE=1; shift ;;
      --reset-data) RESET_DATA=1; shift ;;
      -h|--help) sed -n '2,24p' "$HARNESS_DIR/gate.sh"; exit 0 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
}

# Sets MPR (MPR= or the .mpr here). Its name ends up in a pgrep pattern whose matches get
# killed: safe characters only.
find_project() {
  mdl_find_mpr || exit 2
  case "$MPR" in
    *[!A-Za-z0-9._-]*|-*|.*)
      echo "refusing to run: the .mpr name must be letters, digits, dot, dash or underscore: $MPR" >&2
      exit 2 ;;
  esac
}

# On exit, end model checks still running in the background (an early exit -- no app, a failed
# boot -- leaves them), so they do not write into the removed scratch directory.
cleanup_work() {
  local pid pids
  pids="$(jobs -p)"
  if [ -n "$pids" ]; then
    for pid in $pids; do
      if command -v pgrep >/dev/null 2>&1 && declare -F descendants >/dev/null; then
        # shellcheck disable=SC2046
        kill -TERM $(descendants "$pid") 2>/dev/null
      elif [ -r "/proc/$pid/winpid" ] && command -v taskkill >/dev/null 2>&1; then
        # Git Bash has no pgrep, and `kill` stops the bash subshell but not the Windows programs
        # under it: mx.exe went on writing into $WORK/mxcheck after an early exit, and the
        # removal below failed with "Directory not empty". taskkill /T stops the whole tree.
        taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1
      fi
      kill -TERM "$pid" 2>/dev/null
    done
    wait 2>/dev/null
  fi
  # A program that is still closing its files can hold the directory for a moment (Windows).
  local tries=0
  while ! rm -rf "$WORK" 2>/dev/null && [ "$tries" -lt 5 ]; do
    sleep 1; tries=$((tries + 1))
  done
  [ ! -e "$WORK" ] || echo "   (the gate's scratch directory $WORK could not be removed; it is temporary and can be deleted by hand)" >&2
}

main() {
  ONLY=""; CHANGED=0; TESTS_ONLY=0; BOOT=0; RESTART=0; STOP=0; RESET_DATA=0; FORCE=0; USE_CACHE="${MDL_GATE_CACHE:-1}"; targets_ran=()
  parse_arguments "$@"
  if [ "$CHANGED" = "1" ] && [ -n "$ONLY" ]; then
    echo "--changed picks the tests itself; it cannot be combined with --only" >&2; exit 2
  fi
  find_project
  SCRIPT_TIMEOUT="${SCRIPT_TIMEOUT:-90s}"
  APP_PORT="${APP_PORT:-8081}"
  BOOT_TIMEOUT="${BOOT_TIMEOUT:-180}"
  CACHE_DIR="$APP_DIR/.mxcli/gate-cache"
  # The gate writes its cache there. A link (a repository can ship one) would send those writes
  # elsewhere, so the gate stops and says so; the person removes the link.
  if [ -L "$APP_DIR/.mxcli" ] || [ -L "$CACHE_DIR" ]; then
    echo "   !! .mxcli or .mxcli/gate-cache is a symbolic link; the gate does not write through one -- remove it" >&2
    exit 2
  fi
  # Scratch directory for this run's result files; removed on exit.
  WORK="$(mdl_tmpdir mdl-gate)"
  trap cleanup_work EXIT
  GATE_START=$SECONDS

  # USER_MODULES_READ=0 tells a failed SHOW MODULES apart from a project with no module.
  USER_MODULES=""; USER_MODULES_READ=1
  if [ "$TESTS_ONLY" = "0" ]; then
    USER_MODULES="$(mdl_user_modules "$MPR")" || USER_MODULES_READ=0
  fi

  if [ "$STOP" = "0" ] && [ ! -f tools/mdl-checks/gate_helpers.cjs ]; then
    echo "tools/mdl-checks/gate_helpers.cjs is missing -- re-run the installer" >&2
    exit 2
  fi
  if [ "$STOP" = "1" ]; then
    echo "== stopping this project's app"
    stop_project_app
    close_browser_if_asked
    exit 0
  fi

  preflight_films
  # Keys of tests/harness.env that once set a rule's level: no longer read (portable.sh).
  if [ -n "${MDL_RETIRED_KEYS:-}" ]; then
    { echo "   - tests/harness.env: $MDL_RETIRED_KEYS no longer read -- a rule's level and exceptions are in its"
      echo "     card in tests/rulebook/ (## Local); re-running the installer moves them there"
    } > "$WORK/harness-env.warnings"
  fi
  declare -F dbsnap_take >/dev/null && dbsnap_take
  # 1. The model checks need no app: start them now, they run while the suite does.
  # `--restart` on its own restarts and stops: sessions ran `gate.sh --restart; gate.sh`, and the
  # restart's own full gate ran the suite a second time, a minute or two per pair (2026-10-14).
  RESTART_ALONE=0
  [ "$RESTART" = "1" ] && [ -z "$ONLY" ] && [ "$TESTS_ONLY" = "0" ] && RESTART_ALONE=1
  refuse_after_red_only
  if [ "$RESTART_ALONE" = "1" ]; then
    :
  elif [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ]; then
    start_model_checks
  elif [ "$TESTS_ONLY" = "0" ]; then
    # shellcheck disable=SC2086
    start_model_checks $EARLY_CHECKS
  fi
  # 2. The app: restart it if asked, then find it or boot it.
  [ "$RESTART" = "1" ] && restart_app
  # Rows an earlier run that did not end in DONE left behind: a full gate starts its tests on the
  # snapshot's data (a stop and boot); a partial run only with --reset-data.
  if declare -F dbsnap_refresh >/dev/null; then
    if [ "$RESET_DATA" = "1" ]; then dbsnap_refresh force
    elif [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ] && [ "$RESTART_ALONE" = "0" ]; then dbsnap_refresh
    fi
  fi
  # Warn about drifted checkers before any verdict, and before the no-app exit.
  mdl_check_install_freshness
  ensure_app
  keep_offline_caching
  # A new app's database appears with its first boot: the snapshot is taken now, before any test writes.
  declare -F dbsnap_take >/dev/null && dbsnap_take
  if [ "$RESTART_ALONE" = "1" ]; then
    echo "== restarted: the app runs the current model. --restart on its own stops here -- next:"
    echo "   bash tests/gate.sh --only <feature>   or the full gate: bash tests/gate.sh"
    exit 0
  fi
  # 3. Preflights, then the suite.
  failures=(); cannot_run=(); summary=(); details=()
  preflight_session
  preflight_debugger
  preflight_environment
  preflight_studio_pro
  preflight_stale_model
  step_tests
  step_visual
  step_runtime_errors
  close_browser_if_asked
  add_red_first_notes
  note_never_red_tests
  # 4. Wait for the model checks and collect their verdicts.
  if [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ]; then
    wait
    collect_model_checks
    step_microflow_tests
  fi
  [ -n "$ONLY" ] && wait
  print_verdict_and_exit
}

main "$@"
