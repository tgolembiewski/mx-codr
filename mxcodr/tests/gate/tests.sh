# tests/gate/tests.sh -- running tests/verify-*.test.sh and recording their result.
# Sourced by tests/gate.sh; defines functions only. Entry point: step_tests.
# Results go to the arrays the gate prints: failures (exit 1), cannot_run (exit 2), summary.

# Records each script's first red run in .mxcli/red-first/. Under --only, a script that goes
# green without one is flagged once: a test that never failed may assert nothing.
# Nothing is recorded while the runtime serves an older model: that red is not the test's.
record_red_first() {   # record_red_first <runner output> <environment cause or "">
  [ -n "$ONLY" ] || [ "$TESTS_ONLY" = "1" ] || return 0
  [ -z "${2:-}" ] || return 0
  if [ -s "$WORK/stale.note" ]; then
    echo "   !! red run not recorded: the app serves an older model. Restart, then watch the test go red"
    return 0
  fi
  local out="$1" dir="$APP_DIR/.mxcli/red-first" line name verdict
  mkdir -p "$dir" 2>/dev/null || return 0
  printf '%s\n' "$out" | grep -E '^\s+(PASS|FAIL)\s' | while read -r verdict name _; do
    name="${name%.test.sh}"
    case "$name" in ''|*/*|.*) continue ;; esac
    case "$verdict" in
      FAIL) [ -f "$dir/$name" ] || date '+%Y-%m-%d %H:%M' > "$dir/$name" ;;
      PASS)
        [ -n "$ONLY" ] || continue
        if [ ! -f "$dir/$name" ] && [ ! -f "$dir/$name.green" ]; then
          date '+%Y-%m-%d %H:%M' > "$dir/$name.green"
          # Also to a file: this runs in a `while read` subshell and must reach the summary.
          echo "$name: went green without ever being red -- break the feature once and watch it go red" \
            >> "$WORK/redfirst.note"
          echo "   !! $name went green without ever being red here. A test that has never"
          echo "      failed may assert nothing: break the feature once (an mxcli exec that"
          echo "      changes the message, say) and watch this same command go red, then undo it."
        fi ;;
    esac
  done
}

# A full run names every test with no recorded red run: `--only` records them, the suite does not,
# so this is the one place a code-first test shows up. A warning, never a failure -- the escape is
# MDL_ALLOW_GREEN_FIRST (tests/harness.env), a space or comma list of test names that are green by
# nature (a seeding reset, say).
note_never_red_tests() {
  [ -z "$ONLY" ] && [ "$TESTS_ONLY" = "0" ] || return 0
  local dir="$APP_DIR/.mxcli/red-first" script name allowed unproven=""
  for script in tests/verify-*.test.sh; do
    [ -f "$script" ] || continue
    name="$(basename "$script" .test.sh)"
    [ -f "$dir/$name" ] && continue
    allowed=0
    for allow in ${MDL_ALLOW_GREEN_FIRST:-}; do
      [ "${allow%,}" = "$name" ] && allowed=1
    done
    [ "$allowed" = "1" ] && continue
    unproven="$unproven $name"
  done
  [ -n "$unproven" ] || return 0
  summary+=("red-first: no red run recorded for$unproven -- a test that has never failed may assert")
  summary+=("   nothing. Break what it checks once (an mxcli exec that changes the message, then undo")
  summary+=("   it) and watch that one test go red, or list it in MDL_ALLOW_GREEN_FIRST if it is green")
  summary+=("   by nature. This is a warning; it does not fail the gate.")
}

# A MODULE set by the caller goes to every test. Otherwise each test takes the module on its own
# `# covers:` line (lib.sh), and only a test without one falls back to MDL_DEFAULT_MODULE.
export_test_module() {
  if [ -n "${MODULE:-}" ]; then
    export MODULE
    return 0
  fi
  MDL_DEFAULT_MODULE="$(printf '%s\n' "$USER_MODULES" | head -1)"
  [ -n "$MDL_DEFAULT_MODULE" ] || MDL_DEFAULT_MODULE="$(mdl_user_modules "$MPR" | head -1)"
  export MDL_DEFAULT_MODULE
}

# Runs the suite (or the --only matches) in this shell, appending to the arrays directly.
step_tests() {
  local -a targets
  local out status environment started=$SECONDS
  select_test_targets
  # look() appends to findings.jsonl in every scenario; this run's pages only. The screenshots
  # go too; review.md and verdicts.json stay, a verdict is keyed on a screenshot's bytes.
  rm -f .mxcli/visual/findings.jsonl .mxcli/visual/*.png 2>/dev/null
  echo "== tests: ${targets[*]}"
  out="$(run_suite "${targets[@]}")"
  status=$?
  echo $((SECONDS - started)) > "$WORK/tests.secs"
  # Script verdicts only; each failure's cause line is printed once, under the gate verdict.
  printf '%s\n' "$out" | grep -E '^\s+(PASS|FAIL)\s|^Total:'
  # One sign-out for a full run; lib.sh is sourced in a subshell to keep it out of the gate.
  if [ -z "$ONLY" ] && [ "${KEEP_SESSION:-0}" != "1" ]; then
    ( . tests/lib.sh >/dev/null 2>&1; release_session ) 2>/dev/null
  fi
  environment="$(environment_cause "$out")"
  if [ -n "$environment" ]; then
    echo "   !! not a feature failure: $environment"
  fi
  record_red_first "$out" "$environment"
  record_suite_result "$out" "$status" "$environment"
}

# Sets targets: tests/ for the whole suite, or the scripts --only names (exit 2 when none match).
select_test_targets() {
  local script
  targets=("tests/")
  [ -n "$ONLY" ] || return 0
  targets=()
  for script in tests/verify-*"$ONLY"*.test.sh; do
    [ -f "$script" ] && targets+=("$script")
  done
  [ ${#targets[@]} -gt 0 ] || { echo "no test matches '$ONLY'" >&2; exit 2; }
}

# run_suite <target>... -- the runner's output; its exit code is the suite's.
run_suite() {
  export PY MXCLI BASE_URL SCRIPT_TIMEOUT
  export_test_module
  # One licence session: a full run reuses it; --only keeps it signed in between runs.
  if [ -n "$ONLY" ]; then
    export KEEP_SESSION="${KEEP_SESSION:-1}"
  else
    export MDL_SESSION_REUSE="${MDL_SESSION_REUSE:-1}"
  fi
  "$MXCLI" playwright verify "$@" -p "$MPR" \
    --base-url "$BASE_URL" --timeout "$SCRIPT_TIMEOUT" --keep-open 2>&1
}

# environment_cause <runner output> -- a dead app or a closed browser looks like broken
# features; prints what happened, or nothing.
environment_cause() {
  case "$1" in
    *ERR_CONNECTION_REFUSED*|*ECONNREFUSED*)
      echo "the app stopped answering on $BASE_URL during the run (a model change that cannot hot-apply stops the runtime; restart it, or use --boot-if-needed)" ;;
    *"browser has been closed"*|*"Target page, context or browser has been closed"*)
      echo "the browser was closed while the suite was running (playwright-cli has one shared browser -- another session or command closed it)" ;;
    *"opening browser: exit status"*)
      echo "the browser could not be started (check .playwright/cli.config.json executablePath, then: playwright-cli close && playwright-cli open)" ;;
  esac
}

# record_suite_result <runner output> <exit code> <environment cause> -- the tests line of the
# summary, a tests failure, and the facts from diagnose.sh when a feature failed.
record_suite_result() {
  local out="$1" status="$2" environment="$3" line why
  line="$(printf '%s\n' "$out" | grep -E '^Total:' | tail -1)"
  if [ -n "$line" ] && [ -n "$environment" ]; then
    summary+=("tests: $line -- ENVIRONMENT, not the feature: $environment")
  elif [ -n "$line" ]; then
    summary+=("tests: $line")
  else
    # No Total line: the runner never ran the scripts; show the line that says why.
    why="$(printf '%s\n' "$out" | grep -iE '^error|error:|panic|unknown flag|no such file' | tail -1)"
    [ -n "$why" ] || why="$(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -1)"
    echo "   the runner produced no results: $why"
    summary+=("tests: no result -- ${environment:-${why:-the runner printed nothing}}")
  fi
  [ "$status" != "0" ] || return 0
  failures+=("tests")
  # The failing scripts' lines again under the verdict, with the other failures' details.
  # The runner prints a script's cause line before and after its verdict: keep one of each.
  printf '%s\n' "$out" | grep -E '^\s+FAIL' | awk '!seen[$0]++' | head -12 > "$WORK/tests.detail"
  details+=("tests|tests")
  if [ -z "$environment" ] && [ -x tests/diagnose.sh ]; then
    echo "== facts (tests/diagnose.sh)"
    bash tests/diagnose.sh 2>&1 | sed 's/^/   /' | head -40
  fi
}

# What the pages looked like when the tests left them (look() in scenario-helpers.js): overlapping
# widgets, sideways scroll, cut-off text -- and, with MDL_VISUAL_REVIEW=agent, screenshots the
# agent must judge. Warnings by default (MDL_VISUAL=warn); MDL_VISUAL=error makes them block DONE.
# A cancellation notice drew its red box over the order summary and the gate said DONE.
step_visual() {
  local mode="${MDL_VISUAL:-warn}" out
  [ "$mode" = "0" ] && return 0
  [ -z "${ONLY:-}" ] && [ "${TESTS_ONLY:-0}" != "1" ] || return 0
  local -a review=()
  [ "${MDL_VISUAL_REVIEW:-}" = "agent" ] && review=(--review "$APP_DIR/.mxcli/visual")
  out="$(gate_py visual-report .mxcli/visual/findings.jsonl mdlsource ${review[@]+"${review[@]}"} 2>/dev/null)"
  if [ -z "$out" ]; then
    summary+=("visual: nothing overlaps, scrolls sideways or is cut off on the pages the tests reached")
    return 0
  fi
  if [ "$mode" = "error" ]; then
    printf '%s\n' "$out" > "$WORK/visual.detail"
    echo "visual: $(printf '%s\n' "$out" | grep -c .) finding(s) on the pages the tests reached" > "$WORK/visual.summary"
    echo 1 > "$WORK/visual.status"
    collect visual "visual"
  else
    printf '%s\n' "$out" > "$WORK/visual.warnings"
    summary+=("visual: $(printf '%s\n' "$out" | grep -c .) warning(s) -- see == warnings (MDL_VISUAL=error makes them block DONE)")
  fi
}
