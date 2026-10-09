# tests/gate/steps.sh -- the model checks, one check_<step> function per gate step: mx, catalog, coverage, naming, scope,
# unused, paths, folders. Layout and security have their own files.
# Sourced by tests/gate.sh after checks.sh (the runner, step_run and the shared describe helpers); defines functions only.

check_mx() {
  local out errors attempt
  # Twice: the copy is taken beside a boot, and a copy made while mxbuild touched the project
  # failed mx check with no error count (Windows, --restart); a fresh copy a moment later passed.
  for attempt in 1 2; do
    mx_check_copy || return 2
    errors="$(printf '%s\n' "$out" | grep -oE 'contains: [0-9]+ errors' | grep -oE '[0-9]+' | tail -1)"
    [ -n "$errors" ] && break
    [ "$attempt" = 1 ] && sleep 3
  done
  # mx check exits 0 even with model errors, so it is the count it prints that says.
  if [ -z "$errors" ]; then
    printf '%s\n' "$out" | tail -3 > "$WORK/mx.detail"
    if [ -n "${MDL_MXBUILD_PATH:-}" ]; then
      echo "   (using $MDL_MXBUILD_PATH -- it must match this project's Mendix version)" \
        >> "$WORK/mx.detail"
    fi
    echo "mx check: could not run -- mx did not report an error count" > "$WORK/mx.summary"; return 2
  fi
  echo "mx check: $errors errors" > "$WORK/mx.summary"
  [ "$errors" = "0" ] && return 0
  printf '%s\n' "$out" | grep -E '^\[error\]|error' | head -10 > "$WORK/mx.detail"
  return 1
}

# The catalog step: the rules mxcli's catalog tables answer (tools/mdl-checks/catalog_rules.cjs) on
# a copy of the project -- UI001 and SEC007, the two rules of mxcli lint that blocked DONE, ported
# from their Starlark, and LINT01 (mxcli lint's own advice) when the rulebook asks for it. The gate
# no longer runs mxcli lint itself: its other rules are advice, on request (LINT01 in tests/rulebook).
check_catalog() {
  local status
  step_run catalog catalog catalog_rules.cjs copy; status=$?
  [ "$status" = "3" ] && { echo "catalog: no user module to check" > "$WORK/catalog.summary"; return 0; }
  [ "$status" = "0" ] || return "$status"
  step_verdict catalog catalog 'PASS|WARN|FAIL' || return 2
  step_findings_file catalog
  step_warnings catalog 10 "catalog warnings"
  [ "$STEP_CODE" = "0" ] && return 0
  printf '%s\n' "$STEP_OUT" | grep '^  - ' | head -12 > "$WORK/catalog.detail"
  { echo "   These block DONE; why each one and its fix: tests/checks/catalog.md"; } >> "$WORK/catalog.detail"
  return 1
}

# Every page and ACT_ microflow must be named by a verify-*.test.sh `# covers:` line.
check_coverage() {
  [ -f tools/mdl-checks/check_test_coverage.cjs ] || {
    echo "coverage: could not run -- tools/mdl-checks/check_test_coverage.cjs is missing" > "$WORK/coverage.summary"
    return 2; }
  local gate out code
  modules_or_status coverage; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;   # no user modules: a real pass, summary already written
    *) return "$gate" ;;
  esac
  # All modules in one call: a test may cover a page in another module.
  # shellcheck disable=SC2086
  out="$("$NODE" tools/mdl-checks/check_test_coverage.cjs . $USER_MODULES 2>&1)"; code=$?
  printf '%s\n' "$out" | grep -E '^(PASS|FAIL|ERROR) ' | sed 's/^/coverage /' > "$WORK/coverage.summary"
  printf '%s\n' "$out" | grep -E '^[[:space:]]+- ' | head -10 > "$WORK/coverage.detail"
  case "$code" in
    0) return 0 ;;
    1) grep -q '^coverage FAIL ' "$WORK/coverage.summary" && return 1 ;;
  esac
  # The checker broke: keep its summary if it printed an ERROR line, else replace it.
  if ! grep -q '^coverage ERROR ' "$WORK/coverage.summary"; then
    echo "coverage: could not run -- check_test_coverage.cjs exited $code" > "$WORK/coverage.summary"
  fi
  printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 >> "$WORK/coverage.detail"
  return 2
}

# Runs check_mdl.cjs --skill naming over the described microflows and nanoflows. Caption rules are
# warnings unless MDL_CAPTIONS=error: 286 of them once landed on a session with no test green.
check_naming() {
  [ -f tools/mdl-checks/check_mdl.cjs ] || {
    echo "naming: could not run -- tools/mdl-checks/check_mdl.cjs is missing" > "$WORK/naming.summary"
    return 2; }
  local gate out code
  modules_or_status naming; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;   # no user modules: a real pass, summary already written
    *) return "$gate" ;;
  esac
  if ! describe_all naming "$WORK/mdl" "MICROFLOWS NANOFLOWS"; then
    echo "naming: could not run -- $(head -1 "$WORK/naming.broken")" > "$WORK/naming.summary"
    head -5 "$WORK/naming.broken" | sed 's/^/  - /' > "$WORK/naming.detail"
    return 2
  fi
  if ! ls "$WORK"/mdl/*.mdl >/dev/null 2>&1; then
    echo "naming: no microflow or nanoflow to check" > "$WORK/naming.summary"; return 0
  fi
  rulebook_ok naming || return 2
  local captions=warn total
  [ "${MDL_CAPTIONS:-warn}" = "error" ] && captions=error
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args naming)
  # PERF07 reads the entities' indexes and the pages' data sources as well.
  rm -f "$WORK/naming.unread"
  local -a index_inputs=(--entities "$WORK/naming-entities" --pages "$WORK/naming-pages")
  if ! describe_entities_into "$WORK/naming-entities" || ! describe_all naming-pages "$WORK/naming-pages" "PAGES"; then
    # The index rules are warnings: without their input they are left out, and the gate says so.
    index_inputs=()
    echo "   - naming: the entities or pages could not be read, so the index and event-handler rules (PERF07, PERF08, EVENT01-04, ERR01) did not run" > "$WORK/naming.unread"
  fi
  # Captions: a backlog of warnings until the first DONE; from then on a microflow that is new or
  # changed since the last DONE needs them (the hashes each DONE keeps, tests/gate.sh).
  local -a baseline=()
  [ -f "$CACHE_DIR/captions-baseline.json" ] && baseline=(--captions-baseline "$CACHE_DIR/captions-baseline.json")
  mkdir -p "$CACHE_DIR" 2>/dev/null
  out="$("$NODE" tools/mdl-checks/check_mdl.cjs "$WORK/mdl" --skill naming --captions "$captions" ${rb[@]+"${rb[@]}"} \
    ${index_inputs[@]+"${index_inputs[@]}"} --expect-flows "$(cat "$WORK/naming.count" 2>/dev/null || echo 0)" \
    --format "$("$MXCLI" --version 2>/dev/null | head -1)" \
    --flow-hashes "$CACHE_DIR/naming.flows.json" ${baseline[@]+"${baseline[@]}"} 2>&1)"; code=$?
  checker_verdict "$code" "$out"; gate=$?
  if [ "$gate" = "2" ]; then
    echo "naming: could not run -- check_mdl.cjs exited $code" > "$WORK/naming.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/naming.detail"
    return 2
  fi
  echo "naming: $(printf '%s\n' "$out" | head -1)" > "$WORK/naming.summary"
  # A session read ten detail lines as ten findings when there were 286: say how many are left out.
  total="$(printf '%s\n' "$out" | grep -cE '^\s+- ')"
  printf '%s\n' "$out" | grep -E '^\s+- ' | head -10 > "$WORK/naming.detail"
  [ "$total" -gt 10 ] && echo "  ... 10 of $total shown -- the rest are the same kinds; fix them script by script" >> "$WORK/naming.detail"
  # Every performance and event-handler warning is listed: each names a different table, loop or
  # handler, and Pi, shown 8 of 12 PERF07 lines, hunted the cache and the dumps for the other four.
  # The caption warnings stay capped at 8.
  local perf_lines other_total
  perf_lines="$(printf '%s\n' "$out" | grep -E '^\s+! \[(PERF|EVENT|ERR)' | sed -E 's/^[[:space:]]+! /   - /')"
  other_total="$(printf '%s\n' "$out" | grep -E '^\s+! ' | grep -cvE '\[(PERF|EVENT|ERR)')"
  if [ -n "$perf_lines" ] || [ "$other_total" -gt 0 ] || [ -s "$WORK/naming.unread" ]; then
    { cat "$WORK/naming.unread" 2>/dev/null
      [ -n "$perf_lines" ] && printf '%s\n' "$perf_lines"
      printf '%s\n' "$out" | grep -E '^\s+! ' | grep -vE '\[(PERF|EVENT|ERR)' | head -8 | sed -E 's/^[[:space:]]+! /   - /'
      [ "$other_total" -gt 8 ] && echo "   ... 8 of $other_total naming warnings shown (MDL_CAPTIONS=error makes caption rules block)"
    } > "$WORK/naming.warnings"
  fi
  return "$gate"
}

# SCOPE01: a page's data source microflow returns rows its role may not read -- a microflow does
# not apply entity access, so an XPath-scoped access rule does not reach them. A warning unless
# MDL_SCOPE=error: a DeepSeek portal leaked another customer's invoice this way, and only its
# verify test caught it.
check_scope() {
  local status out code total
  step_run scope scope check_scope.cjs nocopy; status=$?
  [ "$status" = "3" ] && return 0
  [ "$status" = "0" ] || return "$status"
  out="$STEP_OUT"; code="$STEP_CODE"
  if [ "$code" = "2" ]; then
    echo "scope: could not run -- $(printf '%s\n' "$out" | tail -1)" > "$WORK/scope.summary"; return 2
  fi
  # 0 passes and 1 has findings, each under a PASS or WARN line; anything else (a traceback
  # exits 1 too) did not check the model, and counted as "findings", a pass while MDL_SCOPE=warn.
  if { [ "$code" != "0" ] && [ "$code" != "1" ]; } || ! printf '%s\n' "$out" | head -1 | grep -qE '^(PASS|WARN|FAIL) '; then
    echo "scope: could not run -- check_scope.cjs exited $code" > "$WORK/scope.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/scope.detail"
    return 2
  fi
  echo "scope: $(printf '%s\n' "$out" | head -1)" > "$WORK/scope.summary"
  [ "$code" = "0" ] && return 0
  # SCOPE01 at `block` (tests/rulebook, or MDL_SCOPE=error while it exists): the checker says FAIL.
  if [ "${MDL_SCOPE:-warn}" = "error" ] || printf '%s\n' "$out" | head -1 | grep -q '^FAIL '; then
    printf '%s\n' "$out" | grep -E '^\s+- ' > "$WORK/scope.detail"
    return 1
  fi
  total="$(printf '%s\n' "$out" | grep -cE '^\s+- ')"
  printf '%s\n' "$out" | grep -E '^\s+- ' | head -6 | sed -E 's/^[[:space:]]+- /   - /' > "$WORK/scope.warnings"
  [ "$total" -gt 6 ] && echo "   ... 6 of $total shown" >> "$WORK/scope.warnings"
  return 0
}

# UNUSED01: a microflow, nanoflow, page, snippet, enumeration or Java action of the project's own
# modules that nothing uses -- 67 were left behind over 34 apps (data source flows replaced by
# XPath, probes, a reset flow no button called). Three proofs, all on a copy of the project:
# check_unused.cjs finds no reference in the catalog and the name in no other document, Java,
# JavaScript, theme or test file (a test's `# covers:` line declares, it does not use); then every one of them is dropped on the copy and mx check must
# still report 0 errors. A document Mendix still needs is never reported. MDL_KEEP_UNUSED in
# tests/harness.env (Mod.Doc,Mod.Other) keeps one on purpose.
check_unused() {
  local status out found code scratch="$WORK/unusedcheck" count errors
  local -a extra=()
  [ -n "${MDL_KEEP_UNUSED:-}" ] && extra+=(--keep "$MDL_KEEP_UNUSED")
  step_run unused unused check_unused.cjs copy ${extra[@]+"${extra[@]}"}; status=$?
  [ "$status" = "3" ] && return 0
  [ "$status" = "0" ] || return "$status"
  found="$STEP_OUT"; code="$STEP_CODE"
  case "$code" in
    0) echo "unused: no unused document" > "$WORK/unused.summary"; return 0 ;;
    1) printf '%s\n' "$found" | head -1 | grep -qE '^(FAIL|WARN) ' || code=2 ;;
  esac
  if [ "$code" != "1" ]; then
    echo "unused: could not run -- $(printf '%s\n' "$found" | grep -v '^[[:space:]]*$' | tail -1)" > "$WORK/unused.summary"
    return 2
  fi
  # UNUSED01 below block in tests/rulebook: listed under the warnings, not dropped on a copy.
  if printf '%s\n' "$found" | head -1 | grep -q '^WARN '; then
    echo "unused: $(printf '%s\n' "$found" | head -1 | sed 's/^WARN  //') (UNUSED01 is a warning in tests/rulebook)" > "$WORK/unused.summary"
    printf '%s\n' "$found" | grep '^  ~ ' | head -10 | sed 's/^  ~ /   - /' > "$WORK/unused.warnings"
    return 0
  fi
  count="$(printf '%s\n' "$found" | grep -c '^  - \[UNUSED01\]')"
  printf '%s\n' "$found" | sed -n 's/^drop: //p' > "$WORK/unused.drop.mdl"
  # The third proof: Mendix itself, with every one of them gone.
  if ! "$MXCLI" exec "$WORK/unused.drop.mdl" -p "$scratch/$MPR" > "$WORK/unused.exec" 2>&1; then
    echo "unused: $count document(s) look unused, but dropping them on a copy failed -- left alone" > "$WORK/unused.summary"
    tail -2 "$WORK/unused.exec" | sed 's/^/   /' > "$WORK/unused.warnings"
    return 0
  fi
  mx_check_in "$scratch"   # sets out
  errors="$(printf '%s\n' "$out" | grep -oE 'contains: [0-9]+ errors' | grep -oE '[0-9]+' | tail -1)"
  if [ "$errors" != "0" ]; then
    # Not proven: Mendix needs one of them, or the model had errors before (mx check says which).
    if [ -n "$errors" ]; then
      echo "unused: $count document(s) look unused, but mx check without them reports $errors error(s) -- left alone" > "$WORK/unused.summary"
    else
      echo "unused: $count document(s) look unused, but mx check without them printed no error count -- left alone" > "$WORK/unused.summary"
    fi
    return 0
  fi
  echo "unused: $count document(s) nothing uses (UNUSED01) -- no reference in the model, the name in no other document, Java, JavaScript, theme or test file, and mx check passes without them" > "$WORK/unused.summary"
  {
    printf '%s\n' "$found" | grep '^  - \[UNUSED01\]' | sed 's/^  /   /'
    echo "   Fix: drop them in one script -- the gate dropped them on a copy and mx check still reported 0 errors:"
    sed 's/^/     /' "$WORK/unused.drop.mdl"
    echo "   Dropping one can leave what only it called unused: run the gate again after."
    echo "   Its source in mdlsource/ goes too, or a re-run brings it back; and its name on a # covers: line"
    echo "   of tests/verify-*.test.sh (a covers: line is no use -- coverage fails on a name not in the model)."
    echo "   Kept on purpose (an API for later, a page opened by URL)? The person adds it to tests/harness.env:"
    echo "     MDL_KEEP_UNUSED=$(sed -n 's/^drop [a-z ]* \([^ ;]*\);$/\1/p' "$WORK/unused.drop.mdl" | head -1)"
  } > "$WORK/unused.detail"
  return 1
}

# The testable paths of the model (check_paths.cjs): every message a user can be shown, every
# workflow user task and its outcomes, every role-scoped entity, every demo user's role and every
# published service needs a test that walks it -- read from the model, so it holds for any app.
# Paths that existed when the harness was installed (.mxcli/gate-cache/paths-baseline.json, written
# by the installer) and have not changed since are warnings; new or changed ones block. WF01 (a
# workflow task anyone can decide) always blocks. MDL_UNTESTED in tests/harness.env: the person's
# list of paths deliberately left without a test.
check_paths() {
  local status
  local -a extra=(--baseline "$CACHE_DIR/paths-baseline.json")
  [ -n "${MDL_UNTESTED:-}" ] && extra+=(--untested "$MDL_UNTESTED")
  [ "${MDL_PATHS:-}" = "error" ] && extra+=(--all-fail)
  step_run paths paths check_paths.cjs copy "${extra[@]}"; status=$?
  [ "$status" = "3" ] && return 0
  [ "$status" = "0" ] || return "$status"
  step_verdict paths paths 'PASS|FAIL' || return 2
  step_findings_file paths   # old paths too
  step_warnings paths 6 "older paths without a test"
  [ "$STEP_CODE" = "0" ] && return 0
  {
    printf '%s\n' "$STEP_OUT" | grep '^  - ' | sed 's/^  /   /'
    echo "   A path is walked when a test (not a comment in it) asserts what the user meets there. Read"
    echo "   tests/checks/paths.md and reference/paths.md of the test-first-delivery skill. Every finding: .mxcli/paths.txt"
  } > "$WORK/paths.detail"
  return 1
}

# FOLDER01 (check_folders.cjs): every document of the app's own modules in <business folder>/UI
# (pages, snippets), /FNC (microflows, nanoflows) or /ENV (everything else). The finding lists the
# `move` statements; one script with all of them applies it. Read from a copy's catalog, as unused does.
check_folders() {
  local status found
  step_run folders folders check_folders.cjs copy; status=$?
  [ "$status" = "3" ] && return 0
  [ "$status" = "0" ] || return "$status"
  step_verdict folders folders 'PASS|WARN|FAIL' || return 2
  found="$STEP_OUT"
  [ "$STEP_CODE" = "0" ] && return 0
  # FOLDER01 below block in tests/rulebook: the documents and their moves under the warnings.
  if printf '%s\n' "$found" | head -1 | grep -q '^WARN '; then
    { printf '%s\n' "$found" | grep '^  ~ ' | head -10 | sed 's/^  ~ /   - /'
      printf '%s\n' "$found" | sed -n 's/^move: /     /p' | head -10; } > "$WORK/folders.warnings"
    return 0
  fi
  {
    printf '%s\n' "$found" | grep '^  - \[FOLDER01\]' | sed 's/^  /   /'
    echo "   Fix: every move below in ONE new script (mdl 1;) and one exec -- a move changes no behaviour:"
    printf '%s\n' "$found" | sed -n 's/^move: /     /p'
    echo "   New documents go straight into place: create ... folder 'Orders/FNC' (or 'Orders/UI')."
  } > "$WORK/folders.detail"
  return 1
}
