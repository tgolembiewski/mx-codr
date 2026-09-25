#!/usr/bin/env bash
# tests/gate.sh -- the done gate: everything "finished" means, in one command.
#
#   bash tests/gate.sh                    # suite + mx check + lint + coverage + naming + layout + security
#   bash tests/gate.sh --only crud        # one script by name fragment, warm browser
#   bash tests/gate.sh --tests-only       # the suite alone
#   bash tests/gate.sh --boot-if-needed   # start the app first if nothing answers
#   bash tests/gate.sh --restart          # stop this project's runtime, boot it again, then gate
#   bash tests/gate.sh --stop             # stop this project's app (and its mxbuild), then exit
#   bash tests/gate.sh --no-cache         # re-run the five model checks even if nothing changed
#
# Six verdicts: the browser suite (tests/verify-*.test.sh) and five model checks that
# need no app -- mx check, lint, coverage, naming, layout, security. Every step runs even if
# another fails; a passing model check is replayed while its inputs are unchanged.
#   DONE — every check passed               exit 0 (--only/--tests-only print PASSED, never DONE)
#   NOT DONE — failed: <checks>             exit 1
#   NOT DONE — could not run: <checks>      exit 2
# Exit 2 also means the gate stopped early: no .mpr, bad argument, no app answering,
# a boot that failed, or the runtime refusing sessions. Visual findings are warnings.
# Env: BASE_URL (else 8081 then 8080), APP_PORT (8081), SCRIPT_TIMEOUT (90s),
#      BOOT_TIMEOUT (180s), RUNTIME_LOG, ADMIN_PORT, ADMIN_PASSWORD, SERVE_PORT,
#      ALLOW_BUSY_SESSION=1, MDL_GATE_CACHE=0, MDL_BOOT_COMMAND (replaces mxcli run),
#      MDL_MXBUILD_PATH, MDL_DB_*, MDL_PSQL, MDL_VISUAL=warn|error|0, MDL_VISUAL_REVIEW=agent
#      -- MDL_* may also be set in tests/harness.env.
# Lines 2-24 are printed by --help; keep them 23 lines.

# How to read this file: main() at the bottom is the whole gate, step by step. The steps
# live in tests/gate/ -- app.sh (find, boot, stop the app), checks.sh (the five model
# checks and their cache), preflight.sh (sessions, stale model, environment) and tests.sh
# (the suite). tools/mdl-checks/gate_helpers.py holds the Python they call.
# No -e: a failing step must not end the gate.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
cd "$APP_DIR"
. "$HARNESS_DIR/portable.sh"
for part in hints app checks preflight tests; do
  if [ ! -f "$HARNESS_DIR/gate/$part.sh" ]; then
    echo "tests/gate/$part.sh is missing -- re-run the installer" >&2
    exit 2
  fi
  . "$HARNESS_DIR/gate/$part.sh"
done

# The gate's Python (digests, JSON, timestamps) lives in tools/mdl-checks/gate_helpers.py.
gate_py() {
  "$PY" tools/mdl-checks/gate_helpers.py "$@"
}

# Sets ONLY, TESTS_ONLY, BOOT, RESTART, STOP and USE_CACHE; --help prints lines 2-24 and exits.
parse_arguments() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --only) ONLY="$2"; shift 2 ;;
      --tests-only) TESTS_ONLY=1; shift ;;
      --boot-if-needed) BOOT=1; shift ;;
      --restart) RESTART=1; BOOT=1; shift ;;
      --stop) STOP=1; shift ;;
      --no-cache) USE_CACHE=0; shift ;;
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
      fi
      kill -TERM "$pid" 2>/dev/null
    done
    wait 2>/dev/null
  fi
  rm -rf "$WORK"
}

# Merges the notes a background step left in files into the summary.
add_red_first_notes() {
  local line
  if [ -s "$WORK/redfirst.note" ]; then
    while IFS= read -r line; do summary+=("$line"); done < "$WORK/redfirst.note"
  fi
}

# What a check found that does not block DONE (yet): <check>.warnings, as `   - [CODE] ...` lines.
print_warnings() {
  local file shown=0
  for file in "$WORK"/*.warnings; do
    [ -s "$file" ] || continue
    [ "$shown" = "0" ] && { echo; echo "== warnings (they do not block DONE; fix them anyway -- MDL_VISUAL=error makes them block)"; }
    shown=1
    head -12 "$file"
  done
}

# Prints the verdict lines and exits: 1 on a failure, 2 when a check could not run, else 0.
print_verdict_and_exit() {
  local line name timing=""
  print_warnings
  echo
  echo "== gate"
  for line in "${summary[@]}"; do echo "   $line"; done
  for name in tests mx lint coverage naming layout security visual; do
    [ -f "$WORK/$name.secs" ] && timing="$timing $name $(cat "$WORK/$name.secs")s,"
  done
  echo "   timing:${timing} wall $((SECONDS - GATE_START))s"
  if [ ${#failures[@]} -gt 0 ]; then
    echo "   NOT DONE — failed: ${failures[*]}"
    [ ${#cannot_run[@]} -eq 0 ] || echo "   and could not run: ${cannot_run[*]}"
    print_failure_details
    print_blockers
    exit 1
  fi
  if [ ${#cannot_run[@]} -gt 0 ]; then
    echo "   NOT DONE — could not run: ${cannot_run[*]}"
    echo "   A check that did not run has not passed. Fix what stopped it, then run the gate again."
    print_failure_details
    exit 2
  fi
  # A partial run passing is not the gate passing: `--only 000` once ended in the same DONE line
  # as the full gate, and a session took it for DONE with a red suite behind it.
  if [ -n "${ONLY:-}" ] || [ "${TESTS_ONLY:-0}" = "1" ]; then
    local scope="tests only"
    [ -n "${ONLY:-}" ] && scope="--only $ONLY"
    echo "   PASSED — $scope -- not DONE: the full gate has not run; run \`bash tests/gate.sh\`"
    exit 0
  fi
  echo "   DONE — every check passed"
  exit 0
}

# The last lines of every red run: one line per failed check -- how many findings, and the first
# of them -- then the verdict again. Sessions read the gate through `tail -3`, `tail -25` or
# `sed -n '/== naming/,$p' | head`, so the verdict above the details, or the details above the
# end, were each cut off by one of them; after a compaction the model had neither and spent an
# hour rediscovering what still blocked DONE. Whatever tail it takes now ends with that list.
# Findings listed per check under "still blocking DONE".
BLOCKERS_SHOWN=5

print_blockers() {
  local entry name label detail count shown pattern
  pattern='^[[:space:]]*- \[|\[error\]|^[[:space:]]*FAIL[[:space:]:]|^[[:space:]]+- '
  echo "== still blocking DONE"
  # details holds name|label for every failed or unrunnable check, in the order they printed.
  # Every finding up to BLOCKERS_SHOWN, each with its fix: a session that saw only the first one
  # (through `| tail -16`) opened check_layout.py to learn what the other six wanted.
  for entry in ${details[@]+"${details[@]}"}; do
    name="${entry%%|*}"; label="${entry#*|}"
    detail="$WORK/$name.detail"
    count=0
    [ -s "$detail" ] && count="$(grep -cE "$pattern" "$detail")"
    if [ "$count" = "0" ]; then
      echo "   $label: see == $label above"
      continue
    fi
    echo "   $label: $count"
    grep -E "$pattern" "$detail" | head -"$BLOCKERS_SHOWN" \
      | sed -E 's/^[[:space:]]*(- )?//' | cut -c1-260 | sed 's/^/     - /'
    shown=$(( count < BLOCKERS_SHOWN ? count : BLOCKERS_SHOWN ))
    [ "$count" -gt "$shown" ] && echo "     ... $((count - shown)) more under == $label above"
  done
  echo "   NOT DONE — failed: ${failures[*]}"
}

# The cause of every failure, under the verdict: a session that reads only the last lines of
# the output still sees why, instead of running the gate again to find out.
print_failure_details() {
  local entry name label
  for entry in ${details[@]+"${details[@]}"}; do
    name="${entry%%|*}"; label="${entry#*|}"
    case "$label" in
      *"(could not run)") echo "== $label" ;;
      *) [ -s "$WORK/$name.detail" ] || continue; echo "== $label" ;;
    esac
    [ -s "$WORK/$name.detail" ] && cat "$WORK/$name.detail"
  done
}

main() {
  ONLY=""; TESTS_ONLY=0; BOOT=0; RESTART=0; STOP=0; USE_CACHE="${MDL_GATE_CACHE:-1}"
  parse_arguments "$@"
  find_project
  SCRIPT_TIMEOUT="${SCRIPT_TIMEOUT:-90s}"
  APP_PORT="${APP_PORT:-8081}"
  BOOT_TIMEOUT="${BOOT_TIMEOUT:-180}"
  CACHE_DIR="$APP_DIR/.mxcli/gate-cache"
  # Scratch directory for this run's result files; removed on exit.
  WORK="$(mdl_tmpdir mdl-gate)"
  trap cleanup_work EXIT
  GATE_START=$SECONDS

  # USER_MODULES_READ=0 tells a failed SHOW MODULES apart from a project with no module.
  USER_MODULES=""; USER_MODULES_READ=1
  if [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ]; then
    USER_MODULES="$(mdl_user_modules "$MPR")" || USER_MODULES_READ=0
  fi

  if [ "$STOP" = "0" ] && [ ! -f tools/mdl-checks/gate_helpers.py ]; then
    echo "tools/mdl-checks/gate_helpers.py is missing -- re-run the installer" >&2
    exit 2
  fi
  if [ "$STOP" = "1" ]; then
    echo "== stopping this project's app"
    stop_project_app
    exit 0
  fi

  # 1. The model checks need no app: start them now, they run while the suite does.
  if [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ]; then
    start_model_checks
  fi
  # 2. The app: restart it if asked, then find it or boot it.
  [ "$RESTART" = "1" ] && restart_app
  # Warn about drifted checkers before any verdict, and before the no-app exit.
  mdl_check_install_freshness
  ensure_app
  # 3. Preflights, then the suite.
  failures=(); cannot_run=(); summary=(); details=()
  preflight_session
  preflight_debugger
  preflight_environment
  preflight_stale_model
  step_tests
  step_visual
  add_red_first_notes
  note_never_red_tests
  # 4. Wait for the model checks and collect their verdicts.
  if [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ]; then
    wait
    collect_model_checks
  fi
  print_verdict_and_exit
}

main "$@"
