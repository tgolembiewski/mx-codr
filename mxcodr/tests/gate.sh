#!/usr/bin/env bash
# tests/gate.sh -- the done gate: everything "finished" means, in one command.
#
#   bash tests/gate.sh                    # the suite and every model check (listed below)
#   bash tests/gate.sh --only crud        # one script by name fragment, warm browser
#   bash tests/gate.sh --changed          # the tests a model change touched since they last ran
#   bash tests/gate.sh --tests-only       # the suite alone
#   bash tests/gate.sh --boot-if-needed   # start the app first if nothing answers
#   bash tests/gate.sh --restart          # stop this project's runtime, boot it again, then gate
#   bash tests/gate.sh --stop             # stop this project's app (and its mxbuild), then exit
#   bash tests/gate.sh --no-cache         # re-run the model checks even if nothing changed
#
# Eleven verdicts: the suite (tests/verify-*.test.sh) and ten model checks that need no app -- mx check,
# catalog, coverage, naming, layout, security, scope, paths, folders, unused. Each runs; a pass replays while its inputs hold.
#   DONE — every check passed               exit 0 (--only/--tests-only print PASSED, never DONE)
#   NOT DONE — failed: <checks>             exit 1
#   NOT DONE — could not run: <checks>      exit 2
# Exit 2 also: stopped early (no .mpr, bad argument, no app, a failed boot, sessions refused).
# Env: BASE_URL (else 8081 then 8080), APP_PORT (8081), SCRIPT_TIMEOUT (90s),
#      BOOT_TIMEOUT (180s), RUNTIME_LOG, ADMIN_PORT, ADMIN_PASSWORD, SERVE_PORT,
#      ALLOW_BUSY_SESSION=1, MDL_GATE_CACHE=0, MDL_BOOT_COMMAND (replaces mxcli run),
#      MDL_MXBUILD_PATH, MDL_DB_*, MDL_PSQL, MDL_VISUAL_REVIEW=agent, MDL_CLOSE_BROWSER=1,
#      MDL_DB_RESET=session -- also in tests/harness.env. A rule's level and exceptions: its card
#      in tests/rulebook/ (bash tests/rules.sh lists them).
# Lines 2-24 are printed by --help; keep them 23 lines.

# How to read this file: main() at the bottom is the whole gate, step by step. The steps
# live in tests/gate/ -- app.sh (find, boot, stop the app), checks.sh (how the ten model
# checks run, and their cache), steps.sh, layout.sh and security.sh (the checks), preflight.sh (sessions, stale model, environment) and tests.sh
# (the suite). tools/mdl-checks/gate_helpers.cjs holds the Node they call.
# No -e: a failing step must not end the gate.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
cd "$APP_DIR"
. "$HARNESS_DIR/portable.sh"
for part in hints app checks steps layout security preflight tests; do
  if [ ! -f "$HARNESS_DIR/gate/$part.sh" ]; then
    echo "tests/gate/$part.sh is missing -- re-run the installer" >&2
    exit 2
  fi
  . "$HARNESS_DIR/gate/$part.sh"
done
# MDL_DB_RESET=session: dbsnap_take before the tests, dbsnap_restore after the first DONE.
[ -f "$HARNESS_DIR/db-snapshot.sh" ] && . "$HARNESS_DIR/db-snapshot.sh"

# The gate's helpers (digests, JSON, timestamps) live in tools/mdl-checks/gate_helpers.cjs.
gate_helper() {
  "$NODE" tools/mdl-checks/gate_helpers.cjs "$@"
}

# Sets ONLY, TESTS_ONLY, BOOT, RESTART, STOP and USE_CACHE; --help prints lines 2-24 and exits.
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

# Merges the notes a background step left in files into the summary.
add_red_first_notes() {
  local line
  if [ -s "$WORK/redfirst.note" ]; then
    while IFS= read -r line; do summary+=("$line"); done < "$WORK/redfirst.note"
  fi
}

# What a check found that does not block DONE (yet): <check>.warnings, as `   - [CODE] ...` lines.
# "fix them anyway" sent sessions round extra full gates after DONE for warnings alone. Now a
# warning rides along with the next real fix, and one left at DONE goes into the report.
print_warnings() {
  local file shown=0
  for file in "$WORK"/*.warnings; do
    [ -s "$file" ] || continue
    [ "$shown" = "0" ] && { echo; echo "== warnings (they do not block DONE; fix them together with your next fix, not in a gate run of their own -- level: block in a rule's card in tests/rulebook/ makes it block)"; }
    shown=1
    head -12 "$file"
  done
  WARNINGS_SHOWN=$shown
}

# After a green --only: is the full gate worth running yet? DeepSeek ran 15 full gates in an hour
# on the footer's advice, several while coverage was still 0/24 and the verdict known. The
# coverage checker answers in 0.3s; a line here says which it is. Advice only: the verdict is unchanged.
only_coverage_note() {
  local modules out code lines
  [ -f tools/mdl-checks/check_test_coverage.cjs ] || return 0
  modules="$(mdl_user_modules "$MPR" 2>/dev/null)" || return 0
  [ -n "$modules" ] || return 0
  # shellcheck disable=SC2086
  out="$("$NODE" tools/mdl-checks/check_test_coverage.cjs . $modules 2>/dev/null)"; code=$?
  lines="$(printf '%s\n' "$out" | grep -E '^(PASS|FAIL) ' | sed -E 's/^(PASS|FAIL) +//' | tr '\n' ';' | sed 's/;$//')"
  [ -n "$lines" ] || return 0
  if [ "$code" = "0" ]; then
    echo "   coverage now: $lines -- every element is covered: the full gate can pass now"
  else
    echo "   coverage now: $lines -- the full gate cannot pass yet; the next feature and its test first"
  fi
}

# After a full DONE: did the last DONE see exactly this model, these tests and this theme? Pi
# re-ran a green gate on an unchanged app three times in two minutes "to confirm stability".
# theme/ counts: a session that changed only a stylesheet (a chart sized to the screen) was told
# its DONE was a repeat. Advice only.
done_repeat_note() {
  local key file="$CACHE_DIR/last-done.key"
  key="$(fingerprint tests theme 2>/dev/null)" || return 0
  [ -n "$key" ] || return 0
  if [ -f "$file" ] && [ "$(cat "$file" 2>/dev/null)" = "$key" ]; then
    echo "   Same model, tests and theme as the DONE at $(date -r "$file" +%H:%M 2>/dev/null || echo earlier): a repeat proves nothing new -- change something before the next run."
  fi
  mkdir -p "$CACHE_DIR" 2>/dev/null && echo "$key" > "$file" 2>/dev/null
  return 0
}

# Captions are warnings while the app is built: 286 of them once landed on a session with no test
# green. Each full DONE keeps a hash of every microflow; from then on a new or changed one needs its
# captions (check_naming). The first DONE with a backlog says once to clear it, module by module.
captions_after_done() {
  local backlog
  [ -f "$CACHE_DIR/naming.flows.json" ] || return 0
  backlog="$(sed -n 's/.* \([0-9][0-9]*\) caption warning(s).*/\1/p' "$WORK/naming.summary" 2>/dev/null | head -1)"
  if [ ! -f "$CACHE_DIR/captions-baseline.json" ] && [ "${backlog:-0}" -gt 0 ]; then
    echo "   Next: the app is done, so give its microflows their captions -- the ${backlog} caption warning(s) above."
    echo "   Module by module (skill naming-and-captions): a business @caption on each action, a question"
    echo "   on each decision, an @annotation on each loop. Then run the full gate once. From now on a"
    echo "   microflow you add or change needs its captions before DONE; the older ones stay warnings."
    WARNINGS_SHOWN=0
  fi
  cp "$CACHE_DIR/naming.flows.json" "$CACHE_DIR/captions-baseline.json" 2>/dev/null
  return 0
}

# Widget names likewise: each full DONE keeps a hash of every page and snippet; from then on a new
# or changed one needs <Page>_<What><Type> names (check_layout --names, NAME02).
names_after_done() {
  [ -f "$CACHE_DIR/layout.pages.json" ] || return 0
  cp "$CACHE_DIR/layout.pages.json" "$CACHE_DIR/names-baseline.json" 2>/dev/null
  return 0
}

# Prints the verdict lines and exits: 1 on a failure, 2 when a check could not run, else 0.
print_verdict_and_exit() {
  local line name timing=""
  print_warnings
  echo
  echo "== gate"
  for line in "${summary[@]}"; do echo "   $line"; done
  for name in tests mx catalog coverage naming layout security scope paths folders unused visual; do
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
    [ "${CHANGED:-0}" = "1" ] && scope="--changed (${#targets_ran[@]} of $(ls tests/verify-*.test.sh 2>/dev/null | wc -l | tr -d ' ') tests)"
    echo "   PASSED — $scope -- not DONE: the full gate has not run; run \`bash tests/gate.sh\`"
    only_coverage_note
    exit 0
  fi
  echo "   DONE — every check passed"
  done_repeat_note
  captions_after_done
  names_after_done
  declare -F dbsnap_restore >/dev/null && dbsnap_restore
  if [ "${WARNINGS_SHOWN:-0}" = "1" ]; then
    echo "   The warnings above stay: do not run the gate again for them alone -- name each in your report as what to fix next."
  fi
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
  # Three sessions grepped tests/gate/*.sh for what a code required; the page says it in one line.
  # One file per step (tests/checks/), so a session reads the codes of what failed, not all of them.
  local guides="" guide failed
  for failed in ${failures[@]+"${failures[@]}"} ${cannot_run[@]+"${cannot_run[@]}"}; do
    guide="tests/checks/$failed.md"; [ -f "$guide" ] || guide="tests/checks/app.md"
    case " $guides " in *" $guide "*) ;; *) guides="${guides:+$guides }$guide" ;; esac
  done
  echo "   what each code wants and its fix: ${guides:-tests/CHECKS.md} -- not the gate's source"
  echo "== still blocking DONE"
  # details holds name|label for every failed or unrunnable check, in the order they printed.
  # Every finding up to BLOCKERS_SHOWN, each with its fix: a session that saw only the first one
  # (through `| tail -16`) opened check_layout.cjs to learn what the other six wanted.
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
  ONLY=""; CHANGED=0; TESTS_ONLY=0; BOOT=0; RESTART=0; STOP=0; USE_CACHE="${MDL_GATE_CACHE:-1}"; targets_ran=()
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
  if [ "$TESTS_ONLY" = "0" ] && [ -z "$ONLY" ]; then
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
  preflight_studio_pro
  preflight_stale_model
  step_tests
  step_visual
  step_runtime_errors
  close_browser_if_asked
  note_microflow_tests
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
