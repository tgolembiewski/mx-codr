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
  summary+=("   it) and watch that one test go red. If it is green by nature, say so in your report; the")
  summary+=("   person may list it in MDL_ALLOW_GREEN_FIRST. This is a warning; it does not fail the gate.")
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
# What the previous run left beside the project: playwright-cli's page snapshots (.yml), console logs
# and downloads in .playwright-cli/, and the verify-*-failure.png screenshots `mxcli playwright verify`
# writes. On InvoiceB2B: 618 snapshots, 420 logs and 180 invoice PDFs (7.7 MB) and 26 screenshots,
# none of them ignored by git. Cleared before each run, so what is there is the last run's: a failure
# keeps its screenshot until the next run. Only files at the top of .playwright-cli/; its folders and
# .playwright/ (the browser's config) stay.
clear_test_artefacts() {
  local f
  if [ -d .playwright-cli ] && [ ! -L .playwright-cli ]; then
    for f in .playwright-cli/*; do
      [ -f "$f" ] && [ ! -L "$f" ] && rm -f "$f"
    done
  fi
  for f in verify-*-failure.png; do
    [ -f "$f" ] && [ ! -L "$f" ] && rm -f "$f"
  done
  return 0
}

step_tests() {
  local -a targets
  local out status environment started=$SECONDS
  select_test_targets
  # look() appends to findings.jsonl in every scenario; this run's pages only. The screenshots
  # go too; review.md and verdicts.json stay, a verdict is keyed on a screenshot's bytes.
  rm -f .mxcli/visual/findings.jsonl .mxcli/visual/*.png 2>/dev/null
  clear_test_artefacts
  echo "== tests: ${targets[*]}"
  # From here on, what the runtime logs as an error happened during the suite (step_runtime_errors).
  date '+%Y-%m-%d %H:%M:%S' > "$WORK/tests.started"
  out="$(run_suite "${targets[@]}")"
  status=$?
  echo $((SECONDS - started)) > "$WORK/tests.secs"
  # Script verdicts only; each failure's cause line is printed once, under the gate verdict.
  printf '%s\n' "$out" | grep -E '^\s+(PASS|FAIL)\s|^Total:'
  syntax_notes "${targets[@]}" > "$WORK/tests.syntax"
  cat "$WORK/tests.syntax"
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
  # Only a run on the current model counts as having exercised it.
  if [ -z "$environment" ] && [ ! -s "$WORK/stale.note" ]; then
    record_tests_seen "${targets[@]}"
  fi
  targets_ran=("${targets[@]}")
}

# syntax_notes <target>... -- one line per test script bash cannot parse. Such a script dies before
# lib.sh's traps exist, and the runner showed only "FAIL verify-admin (55ms)" with no reason: an
# apostrophe in a JS comment ("the module's overview") had closed the single-quoted scenario '...'.
syntax_notes() {
  local target script err hint cut
  for target in "$@"; do
    for script in "$target" "$target"verify-*.test.sh; do
      case "$script" in *.test.sh) ;; *) continue ;; esac
      [ -f "$script" ] || continue
      # An apostrophe can cut a scenario body short and leave the file parseable: the runner then
      # says only "returned nothing" (three times in one B2B session, 2026-10-07).
      cut="$("$NODE" "$MDL_SHELL_HELPERS" scenario-quotes "$script" 2>/dev/null | head -1)"
      if [ -n "$cut" ]; then
        echo "   FAIL $(basename "$script" .test.sh): line ${cut%%:*}: an apostrophe ends the scenario '...' body there (${cut#*: }) -- write ’, or reword the comment or string"
        continue
      fi
      err="$(bash -n "$script" 2>&1)" && continue
      err="$(printf '%s\n' "$err" | head -1 | sed 's/^[^:]*: //')"
      hint=""
      grep -q "scenario '" "$script" \
        && hint=" -- an apostrophe inside scenario '...' ends the quoted JS: write ’ or a double-quoted JS string"
      echo "   FAIL $(basename "$script" .test.sh): bash cannot parse it: ${err}${hint}"
    done
  done
}

# document_unit_map -- $WORK/docmap.json, {qualified name: unit id} for pages, microflows and
# nanoflows. The catalog gives it: a refresh reads the .mpr and writes .mxcli/catalog.db (0.05s,
# the .mpr untouched). When the catalog cannot be read the map is empty, and every unit then
# counts as one no test can name: --changed runs everything, which is the safe side.
document_unit_map() {
  local kind
  echo '{}' > "$WORK/docmap.json"
  "$MXCLI" -p "$MPR" -c "REFRESH CATALOG" >/dev/null 2>&1 || return 0
  { for kind in PAGES MICROFLOWS NANOFLOWS; do
      "$MXCLI" -p "$MPR" --json -c "SELECT Id, QualifiedName FROM CATALOG.$kind" 2>/dev/null
    done; } | gate_helper doc-map > "$WORK/docmap.json" 2>/dev/null || echo '{}' > "$WORK/docmap.json"
}

# record_tests_seen <target>... -- after a run that exercised the current model: remember, per test
# that ran, the state of the units it covers, so --changed can tell what a later change touched.
record_tests_seen() {
  local target script
  local -a scripts=()
  for target in "$@"; do
    case "$target" in
      */) for script in "$target"verify-*.test.sh; do [ -f "$script" ] && scripts+=("$script"); done ;;
      *)  scripts+=("$target") ;;
    esac
  done
  [ ${#scripts[@]} -gt 0 ] || return 0
  [ -f "$WORK/docmap.json" ] || document_unit_map
  gate_helper record-tests-seen . "$WORK/docmap.json" "${scripts[@]}" >/dev/null 2>&1 || true
}

# Sets targets: tests/ for the whole suite, the scripts --only names (exit 2 when none match), or
# under --changed the tests whose covered documents changed since they last ran here.
select_test_targets() {
  local script line
  targets=("tests/")
  if [ "${CHANGED:-0}" = "1" ]; then
    document_unit_map
    targets=()
    echo "== changed since each test last ran"
    while IFS= read -r line; do
      case "$line" in
        "RUN "*)  line="${line#RUN }"; targets+=("tests/${line%% *}.test.sh"); echo "   $line" ;;
        "NOTE "*) echo "   ${line#NOTE }" ;;
      esac
    done < <(gate_helper changed-tests . "$WORK/docmap.json" 2>/dev/null)
    if [ ${#targets[@]} -eq 0 ]; then
      echo "   nothing: every test ran on this model already -- run the full gate, bash tests/gate.sh"
      exit 0
    fi
    return 0
  fi
  [ -n "$ONLY" ] || return 0
  targets=()
  for script in tests/verify-*"$ONLY"*.test.sh; do
    [ -f "$script" ] && targets+=("$script")
  done
  [ ${#targets[@]} -gt 0 ] || { echo "no test matches '$ONLY'" >&2; exit 2; }
}

# close_browser_if_asked -- MDL_CLOSE_BROWSER=1 closes this project's playwright-cli browser once the
# suite is done. Every session left its own open: 39 daemons and 155 headless Chrome processes
# (6.5 GB), the oldest 18 days old. Off by default: --only reuses the open browser and its sign-in.
close_browser_if_asked() {
  [ "${MDL_CLOSE_BROWSER:-0}" = "1" ] || return 0
  command -v playwright-cli >/dev/null 2>&1 || return 0
  playwright-cli close >/dev/null 2>&1 || true
}

# run_suite <target>... -- the runner's output; its exit code is the suite's.
run_suite() {
  export PY MXCLI BASE_URL SCRIPT_TIMEOUT
  # The visual checks' mode from the rulebook, read once for the suite instead of in every test.
  _MDL_VISUAL_MODE="$(mdl_rule_mode VIS01 VIS02 VIS03 VIS04 LOOK01 LOOK02)"; export _MDL_VISUAL_MODE
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
    *"Maximum number of sessions exceeded"*)
      echo "$SESSION_LIMIT_CAUSE" ;;
    *)
      session_limit_in_log && echo "$SESSION_LIMIT_CAUSE" ;;
  esac
}

# A trial-licence runtime allows a few sessions. Past that it refuses every sign-in, and REST or
# OData calls with Basic auth fail too: a DeepSeek session saw "sign-in was refused" and "the
# OData service answered at neither path" in three suites, each test green alone, while
# runtime.log held 72 lines of "Maximum number of sessions exceeded! (You are currently using a
# trial license)". The runner often shows only the sign-in failure, so the log is read as well.
SESSION_LIMIT_CAUSE="the runtime ran out of sessions (trial licence: \"Maximum number of sessions exceeded\" in .mxcli/runtime.log) -- sign-ins were refused and Basic-auth REST/OData calls failed, most likely not the features. bash tests/gate.sh --restart starts with none; each user a scenario signs in as, and each Basic-auth call, can hold one"

# session_limit_in_log -- true when runtime.log has the session-limit line since the suite started.
# The refusal is logged as an exception whose stack trace lines carry no date: each line takes the
# time of the dated line above it. Compared as text, "com.mendix..." sorted after every date, so a
# refusal days old blamed every later suite, green ones too (InvoiceB2B, 2026-10-05).
session_limit_in_log() {
  local log="${RUNTIME_LOG:-$APP_DIR/.mxcli/runtime.log}" started
  [ -f "$log" ] && [ -s "$WORK/tests.started" ] || return 1
  started="$(cat "$WORK/tests.started")"
  awk -v since="$started" '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] / { stamp = $1 " " substr($2, 1, 8) }
    stamp >= since && /Maximum number of sessions exceeded/ { found = 1; exit }
    END { exit !found }' "$log"
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
    # Exit 0 without a Total line, with tests there to run: nothing was tested, and nothing failed
    # either, so this used to count as a pass.
    if [ "$status" = "0" ] && ls tests/verify-*.test.sh >/dev/null 2>&1; then
      cannot_run+=("tests")
      return 0
    fi
  fi
  [ "$status" != "0" ] || return 0
  failures+=("tests")
  # The failing scripts' lines again under the verdict, with the other failures' details.
  # The runner prints a script's cause line before and after its verdict: keep one of each.
  { printf '%s\n' "$out" | grep -E '^\s+FAIL' | awk '!seen[$0]++' | head -12
    cat "$WORK/tests.syntax" 2>/dev/null; } > "$WORK/tests.detail"
  details+=("tests|tests")
  if [ -z "$environment" ] && [ -x tests/diagnose.sh ]; then
    echo "== facts (tests/diagnose.sh)"
    bash tests/diagnose.sh 2>&1 | sed 's/^/   /' | head -40
  fi
}

# What the pages looked like when the tests left them (look() in scenario-helpers.js): overlapping
# widgets, sideways scroll, cut-off text -- and, with MDL_VISUAL_REVIEW=agent, screenshots the
# agent must judge. Warnings by default; VIS01..VIS04 at `block` in tests/rulebook make them block DONE.
# A cancellation notice drew its red box over the order summary and the gate said DONE.
step_visual() {
  # The level comes from the rulebook (tests/rulebook/app/VIS01..VIS04.md, LOOK01/02).
  local mode out
  mode="$(mdl_rule_mode VIS01 VIS02 VIS03 VIS04 LOOK01 LOOK02)"
  [ "$mode" = "0" ] && return 0
  [ -z "${ONLY:-}" ] && [ "${TESTS_ONLY:-0}" != "1" ] || return 0
  local -a review=()
  [ "${MDL_VISUAL_REVIEW:-}" = "agent" ] && review=(--review "$APP_DIR/.mxcli/visual")
  out="$(gate_helper visual-report .mxcli/visual/findings.jsonl mdlsource ${review[@]+"${review[@]}"} 2>"$WORK/visual.error")" || {
    # The helper crashed: empty output used to read as "nothing overlaps".
    summary+=("visual: could not run -- gate_helpers.cjs visual-report failed: $(tail -1 "$WORK/visual.error" 2>/dev/null)")
    cannot_run+=("visual")
    return 0
  }
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
    summary+=("visual: $(printf '%s\n' "$out" | grep -c .) warning(s) -- see == warnings (level: block in tests/rulebook/app/VIS01..VIS04.md makes them block DONE)")
  fi
}

# Microflow tests (*.test.mdl, *.test.md under tests/) are not run here: `mxcli test --local` boots
# its own runtime on port 8081, where this project's app already runs. So the gate says they exist
# and how to run them, in one summary line; `mxcli test --list` only parses the files (no boot).
note_microflow_tests() {
  local count how
  [ -n "$(find tests -name '*.test.mdl' -o -name '*.test.md' 2>/dev/null | head -1)" ] || return 0
  # Only once the suite is green: with it red, two sessions took this line as the next job and
  # spent 20-40 minutes on microflow tests that do not count for DONE.
  [ -z "${failures[*]:-}" ] || return 0
  count="$("$MXCLI" test tests/ -p "$MPR" --list 2>/dev/null | sed -nE 's/^Found ([0-9]+) test.*/\1/p' | head -1)"
  if [ -n "${MDL_BOOT_COMMAND:-}" ]; then
    # This project boots without `mxcli run --local` (Windows), and `mxcli test --local` boots the same way.
    how="run them with mxcli test (skill test-microflows): --local does not boot where mxcli run --local cannot"
  else
    # `;` before the boot: a failing test must not leave the app stopped.
    how="run them: bash tests/gate.sh --stop && $MXCLI test tests/ -p $MPR --local; bash tests/gate.sh --boot-if-needed"
  fi
  summary+=("microflow tests: ${count:-some} under tests/, NOT run by the gate -- after changing logic $how")
}

# What the server logged as ERROR while the suite ran. A page action that throws shows a generic
# dialog, and a test that does not look for it passes; the runtime log has the real error. A
# warning by default; RUNTIME01 at `block` in tests/rulebook blocks DONE, `off` turns it off.
step_runtime_errors() {
  local log="${RUNTIME_LOG:-$APP_DIR/.mxcli/runtime.log}" mode out
  mode="$(mdl_rule_mode RUNTIME01)"
  [ "$mode" = "0" ] && return 0
  [ -f "$log" ] && [ -s "$WORK/tests.started" ] || return 0
  out="$(gate_helper runtime-errors "$log" "$(cat "$WORK/tests.started")" 2>"$WORK/runtime.error")" || {
    summary+=("runtime log: could not run -- gate_helpers.cjs runtime-errors failed: $(tail -1 "$WORK/runtime.error" 2>/dev/null)")
    cannot_run+=("runtime log")
    return 0
  }
  [ -n "$out" ] || return 0
  if [ "$mode" = "error" ]; then
    printf '%s\n' "$out" > "$WORK/runtime.detail"
    echo "runtime: errors in the server log during the tests" > "$WORK/runtime.summary"
    echo 1 > "$WORK/runtime.status"
    collect runtime "runtime log"
  else
    printf '%s\n' "$out" >> "$WORK/runtime.warnings"
    summary+=("runtime: the server logged $(printf '%s\n' "$out" | grep -c .) distinct error(s) during the tests -- see == warnings; the full log: ${log#"$APP_DIR"/}")
  fi
}
