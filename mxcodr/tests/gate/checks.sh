# tests/gate/checks.sh -- the model checks that need no app (mx check, catalog, coverage, naming,
# layout, security, scope, paths, folders, unused), and their cache.
# Sourced by tests/gate.sh; defines functions only. Entry points: start_model_checks, collect_model_checks.

# Each check runs in a background subshell, so it reports through files: check_<name> writes
# $WORK/<name>.summary and .detail and returns 0 pass / 1 problems / 2 could not run;
# run_cached adds .status and .secs; collect reads them after `wait`.

# mx_check_copy [<dir> [<label>]] -- mx check on a fresh copy of the project in <dir> ($WORK/mxcheck);
# sets out. False when the copy failed (the reason in $WORK/<label>.summary, label mx).
# mx check runs on a copy: it rewrites the .mpr and would trigger --watch rebuilds.
# The copy needs widgets/ and theme*/ as well; `cp -Rc` clones on APFS, else plain cp -R.
mx_check_copy() {
  local scratch="${1:-$WORK/mxcheck}" label="${2:-mx}"
  project_copy "$scratch" "$label" || return 1
  mx_check_in "$scratch"
}

# project_copy <dir> <label> -- a fresh copy of the project's model, widgets, theme and Java in <dir>.
project_copy() {
  local item scratch="$1"
  rm -rf "$scratch"; mkdir -p "$scratch"
  for item in "$MPR" mprcontents widgets theme themesource javasource; do
    [ -e "$item" ] || continue
    cp -Rc "$item" "$scratch/" 2>/dev/null || cp -R "$item" "$scratch/" 2>/dev/null || {
      echo "$2: could not run -- could not copy $item to a scratch directory" > "$WORK/$2.summary"; return 1; }
  done
}

# mx_check_in <dir> -- mx check on the copy in <dir>; sets out.
mx_check_in() {
  # Without `mx update-widgets` (2.9s of a 5.2s check, measured); the one error that
  # step prevents, CE0463, buys the slow run. Same rule as tests/precheck.sh.
  local -a mx_args=(docker check -p "$1/$MPR")
  [ -n "${MDL_MXBUILD_PATH:-}" ] && mx_args+=(--mxbuild-path "$MDL_MXBUILD_PATH")
  out="$("$MXCLI" "${mx_args[@]}" --no-update-widgets 2>&1)"
  if printf '%s\n' "$out" | grep -q 'CE0463'; then
    out="$("$MXCLI" "${mx_args[@]}" 2>&1)"
  fi
  return 0
}

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

# Names from a `SHOW ... --json` listing on stdin; non-zero when it is not JSON.
qualified_names() {
  gate_helper qualified-names 2>/dev/null
}

# 0 passed, 1 findings, 2 broken. A traceback also exits 1, so 1 needs a FAIL line first.
checker_verdict() {
  case "$1" in
    0) return 0 ;;
    1) printf '%s\n' "$2" | head -1 | grep -qE '^FAIL ' && return 1 ;;
  esac
  return 2
}

# describe_one <kind> <document> -- its MDL, or false. Tried twice: these run beside a boot, and a
# describe that meets mxbuild touching the project fails once, then works (Windows, --restart).
describe_one() {
  local text
  text="$("$MXCLI" describe "$1" "$2" -p "$MPR" 2>/dev/null)" \
    || { sleep 2; text="$("$MXCLI" describe "$1" "$2" -p "$MPR" 2>/dev/null)"; } || return 1
  printf '%s\n' "$text"
}

# describe_many <kind> <names, one per line> -- their MDL from one mxcli call, or false (and
# nothing printed) when any of them fails or the list is empty.
describe_many() {
  local kind="$1" statements="" document text
  while IFS= read -r document; do
    [ -n "$document" ] && statements="$statements describe $kind $document;"
  done <<< "$2"
  [ -n "$statements" ] || return 1
  text="$("$MXCLI" -p "$MPR" -c "$statements" 2>/dev/null)" || return 1
  printf '%s\n' "$text"
}

# Describes every document of <kinds> into <dir>/<module>.mdl; failures go to
# $WORK/<label>.broken. False when anything failed.
describe_all() {
  local label="$1" dir="$2" kinds="$3" module kind listing names document text listed=0
  local broken="$WORK/$label.broken"
  : > "$broken"
  mkdir -p "$dir"
  for module in $USER_MODULES; do
    for kind in $kinds; do
      if ! listing="$("$MXCLI" -p "$MPR" --json -c "SHOW $kind IN $module" 2>/dev/null)"; then
        echo "SHOW $kind IN $module failed" >> "$broken"; continue
      fi
      if ! names="$(printf '%s' "$listing" | qualified_names)"; then
        echo "SHOW $kind IN $module did not return a JSON list of Module.Name" >> "$broken"; continue
      fi
      [ -z "$names" ] || listed=$((listed + $(printf '%s\n' "$names" | grep -c .)))
      # One mxcli for the whole list: 135 microflows took 9.0 s one process each and 1.3 s in one,
      # the same text. It stops at the first document it cannot describe, so then each is tried
      # on its own, which names the one that failed.
      if text="$(describe_many "${kind%S}" "$names")"; then
        printf '%s\n' "$text" >> "$dir/$module.mdl"
        continue
      fi
      while IFS= read -r document; do
        [ -n "$document" ] || continue
        describe_one "${kind%S}" "$document" >> "$dir/$module.mdl" \
          || echo "describe ${kind%S} $document failed" >> "$broken"
      done <<< "$names"
    done
  done
  # How many documents were listed: a checker that then recognises none of them in the describe
  # text is reading a format it does not know, and says "could not run" instead of PASS.
  echo "$listed" > "$WORK/$label.count"
  [ ! -s "$broken" ]
}

# 0 when there are user modules; else writes the summary and returns 2 (unreadable)
# or 3 (none, which the caller turns into a pass).
modules_or_status() {
  if [ "${USER_MODULES_READ:-1}" != "1" ]; then
    echo "$1: could not run -- SHOW MODULES failed" > "$WORK/$1.summary"; return 2
  fi
  if [ -z "$USER_MODULES" ]; then
    echo "$1: no user module found" > "$WORK/$1.summary"; return 3
  fi
  return 0
}

# The catalog step: the rules mxcli's catalog tables answer (tools/mdl-checks/catalog_rules.cjs) on
# a copy of the project -- UI001 and SEC007, the two rules of mxcli lint that blocked DONE, ported
# from their Starlark, and LINT01 (mxcli lint's own advice) when the rulebook asks for it. The gate
# no longer runs mxcli lint itself: its other rules are advice, on request (LINT01 in tests/rulebook).
check_catalog() {
  local gate found code total scratch="$WORK/catalogcheck"
  [ -f tools/mdl-checks/catalog_rules.cjs ] || {
    echo "catalog: could not run -- tools/mdl-checks/catalog_rules.cjs is missing" > "$WORK/catalog.summary"; return 2; }
  modules_or_status catalog; gate=$?
  case "$gate" in
    0) ;;
    3) echo "catalog: no user module to check" > "$WORK/catalog.summary"; return 0 ;;
    *) return "$gate" ;;
  esac
  rulebook_ok catalog || return 2
  project_copy "$scratch" catalog || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args catalog)
  # shellcheck disable=SC2086
  found="$("$NODE" tools/mdl-checks/catalog_rules.cjs . $USER_MODULES --mpr "$scratch/$MPR" ${rb[@]+"${rb[@]}"} 2>&1)"; code=$?
  if ! printf '%s\n' "$found" | head -1 | grep -qE '^(PASS|WARN|FAIL) '; then
    echo "catalog: could not run -- $(printf '%s\n' "$found" | grep -v '^[[:space:]]*$' | tail -1)" > "$WORK/catalog.summary"
    return 2
  fi
  echo "catalog: $(printf '%s\n' "$found" | head -1)" > "$WORK/catalog.summary"
  mkdir -p .mxcli 2>/dev/null && printf '%s\n' "$found" > .mxcli/catalog.txt 2>/dev/null
  total="$(printf '%s\n' "$found" | grep -c '^  ~ ')"
  if [ "$total" -gt 0 ]; then
    printf '%s\n' "$found" | grep '^  ~ ' | head -10 | sed -E 's/^  ~ /   - /' > "$WORK/catalog.warnings"
    [ "$total" -gt 10 ] && echo "   ... 10 of $total catalog warnings shown; all of them: .mxcli/catalog.txt" >> "$WORK/catalog.warnings"
  fi
  [ "$code" = "0" ] && return 0
  printf '%s\n' "$found" | grep '^  - ' | head -12 > "$WORK/catalog.detail"
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

# layout_unread <what> <codes> -- a describe that failed while gathering extra input for the layout
# check. It does not stop the check (one widget mxcli cannot describe would block every DONE), but
# the rules that read that input may have missed something, and the gate says which.
layout_unread() {
  local what="$1" codes="$2" first
  first="$(head -1 "$WORK/layout-$what.broken" 2>/dev/null)"
  echo "   - layout: some $what could not be read (${first:-describe failed}), so $codes may have missed a finding there" >> "$WORK/layout.unread"
  return 0
}

# Adds to nav_args (never replaces it: the caller has put --own-modules there already): the menu icons (NAV05) and the snippets' buttons (ICON01) always; the Log out and role-home rules (NAV01-NAV03) only
# when project security is on, since only then do users sign in. Returns 1, with the summary
# written, when security is on and the navigation cannot be read.
layout_sign_out_inputs() {
  local level
  level="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | grep -i 'Security Level' | head -1)"
  # No level means the command failed. It used to read as "security off", which skips the
  # sign-in rules (NAV01, NAV03, the accounts and home pages): a pass for a check that never ran.
  if [ -z "$level" ]; then
    echo "layout: could not run -- SHOW PROJECT SECURITY printed no level" > "$WORK/layout.summary"
    return 1
  fi
  case "$level" in
    *[Oo]ff*)
      # Without sign-in only the icons are checked, and a navigation that cannot be read does not block.
      "$MXCLI" -p "$MPR" -c "DESCRIBE NAVIGATION" > "$WORK/navigation.mdl" 2>/dev/null \
        && nav_args+=(--navigation "$WORK/navigation.mdl")
      # Snippets carry buttons too (ICON01); unreadable ones do not block, and are named.
      describe_all layout-snippets "$WORK/snippets" "SNIPPETS" || layout_unread snippets ICON01
      nav_args+=(--sign-out-sources "$WORK/snippets")
      return 0 ;;
  esac
  if ! "$MXCLI" -p "$MPR" -c "DESCRIBE NAVIGATION" > "$WORK/navigation.mdl" 2>/dev/null; then
    echo "layout: could not run -- DESCRIBE NAVIGATION failed" > "$WORK/layout.summary"
    return 1
  fi
  # A sign-out button in a snippet (a shared header, say) also counts; unreadable snippets do not
  # block, and are named.
  describe_all layout-snippets "$WORK/snippets" "SNIPPETS" || layout_unread snippets "ICON01, NAV01"
  nav_args+=(--navigation "$WORK/navigation.mdl" --sign-out-sources "$WORK/snippets" --users-sign-in)
  # Every user role with its module roles: ACCOUNT03, HOME01 and MODULE01 read them.
  # A listing or a role that cannot be read stops the check: without them ACCOUNT03, HOME01 and
  # MODULE01 find nothing, which read as a pass.
  local role guest roles
  : > "$WORK/userroles.mdl"
  if ! roles="$("$MXCLI" -p "$MPR" --json -c "SHOW USER ROLES" 2>/dev/null)" \
     || ! roles="$(printf '%s' "$roles" | "$NODE" "$MDL_SHELL_HELPERS" role-names 2>/dev/null)"; then
    echo "layout: could not run -- SHOW USER ROLES did not return a JSON list" > "$WORK/layout.summary"
    return 1
  fi
  while IFS= read -r role; do
    [ -n "$role" ] || continue
    if ! "$MXCLI" -p "$MPR" -c "DESCRIBE USER ROLE $role" >> "$WORK/userroles.mdl" 2>/dev/null; then
      echo "layout: could not run -- DESCRIBE USER ROLE $role failed" > "$WORK/layout.summary"
      return 1
    fi
  done <<< "$roles"
  nav_args+=(--user-roles "$WORK/userroles.mdl")
  # NAV06: who may open each page and microflow the menu links to, so the checker knows which
  # entries each role sees. An unreadable answer counts as "everyone" and can only add findings.
  local kind target
  while read -r kind target; do
    printf '%s %s\t' "$kind" "$target"
    "$MXCLI" -p "$MPR" --json -c "SHOW ACCESS ON $kind $target" 2>/dev/null | tr -d '\n\r'
    echo
  # mxcli 0.25 writes an item's action as `OnClick: show page M.P` and may put it on its own line.
  done < <(grep -iE "^[[:space:]]*menu[[:space:]]+item[[:space:]]+'|OnClick:" "$WORK/navigation.mdl" \
             | sed -E "s/^[[:space:]]*menu[[:space:]]+item[[:space:]]+'[^']*'//" \
             | grep -oiE "(page|microflow)[[:space:]]+[A-Za-z0-9_]+\.[A-Za-z0-9_]+" | sort -u) > "$WORK/menu-access.tsv"
  nav_args+=(--menu-access "$WORK/menu-access.tsv")
  guest="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | grep -iE '^(Guest|Anonymous) (User )?Role:' | head -1 | sed -E 's/^[^:]*:[[:space:]]*//')"
  if [ -n "$guest" ]; then nav_args+=(--guest-role "$guest"); fi
  # ACCOUNT01-02: only when the Administration module is there to link to.
  if "$MXCLI" -p "$MPR" --json -c "SHOW PAGES IN Administration" 2>/dev/null | grep -q '"Administration.Account_Overview"' \
     && "$MXCLI" -p "$MPR" --json -c "SHOW MICROFLOWS IN Administration" 2>/dev/null | grep -q '"Administration.ManageMyAccount"'; then
    nav_args+=(--admin-module)
  fi
  return 0
}

# The layout step: check_layout.cjs over every page's `describe` -- navigation, accounts, the page top,
# spacing, grids, names, text inputs, URLs (NAV, ACCOUNT, USER, BACK, SPACE, GRID, NAME, TEXT, URL ...).
check_layout() {
  [ -f tools/mdl-checks/check_layout.cjs ] || {
    echo "layout: could not run -- tools/mdl-checks/check_layout.cjs is missing" > "$WORK/layout.summary"
    return 2; }
  local gate out code
  modules_or_status layout; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;   # no user modules: a real pass, summary already written
    *) return "$gate" ;;
  esac
  if ! describe_all layout "$WORK/pages" "PAGES"; then
    echo "layout: could not run -- $(head -1 "$WORK/layout.broken")" > "$WORK/layout.summary"
    head -5 "$WORK/layout.broken" | sed 's/^/  - /' > "$WORK/layout.detail"
    return 2
  fi
  if ! ls "$WORK"/pages/*.mdl >/dev/null 2>&1; then
    echo "layout: no page to check" > "$WORK/layout.summary"; return 0
  fi
  local -a nav_args=(--own-modules "$USER_MODULES")
  rm -f "$WORK/layout.unread"
  layout_sign_out_inputs || return 2
  # MODULE01: the empty template's module, still in an app that has its own.
  if "$MXCLI" -p "$MPR" --json -c "SHOW MODULES" 2>/dev/null | grep -q '"MyFirstModule"'; then
    nav_args+=(--template-module)
  fi
  # The project's own layouts, for a menu built from buttons (NAV04); unreadable ones do not block.
  describe_all layout-layouts "$WORK/layouts" "LAYOUTS" || layout_unread layouts NAV04
  ls "$WORK"/layouts/*.mdl >/dev/null 2>&1 && nav_args+=(--layouts "$WORK/layouts")
  # Flows open pages too (`show page` in an ACT_ microflow), for the Back-button rule (BACK01),
  # and write entities, for buttons that change a grid's rows outside its header (GRID02).
  describe_all layout-flows "$WORK/layout-flows" "MICROFLOWS NANOFLOWS" || layout_unread flows "BACK01, GRID02"
  ls "$WORK"/layout-flows/*.mdl >/dev/null 2>&1 && nav_args+=(--opened-from "$WORK/layout-flows")
  # The entities say how long the text a textbox edits may be (TEXT01, TEXT02).
  describe_entities_into "$WORK/layout-entities" || layout_unread entities "TEXT01, TEXT02"
  ls "$WORK"/layout-entities/*.mdl >/dev/null 2>&1 && nav_args+=(--entities "$WORK/layout-entities")
  # Widget names (NAME01/02): warnings until the first DONE, then a new or changed page needs them.
  case "${MDL_WIDGET_NAMES:-warn}" in
    0|off) ;;
    error) nav_args+=(--names error --page-hashes "$CACHE_DIR/layout.pages.json") ;;
    *) nav_args+=(--names warn --page-hashes "$CACHE_DIR/layout.pages.json")
       [ -f "$CACHE_DIR/names-baseline.json" ] && nav_args+=(--names-baseline "$CACHE_DIR/names-baseline.json") ;;
  esac
  rulebook_ok layout || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args layout)
  mkdir -p "$CACHE_DIR" 2>/dev/null
  out="$("$NODE" tools/mdl-checks/check_layout.cjs "$WORK/pages" "${nav_args[@]}" ${rb[@]+"${rb[@]}"} \
    --expect-pages "$(cat "$WORK/layout.count" 2>/dev/null || echo 0)" 2>&1)"; code=$?
  checker_verdict "$code" "$out"; gate=$?
  if [ "$gate" = "2" ]; then
    echo "layout: could not run -- check_layout.cjs exited $code" > "$WORK/layout.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/layout.detail"
    return 2
  fi
  echo "layout: $(printf '%s\n' "$out" | head -1)" > "$WORK/layout.summary"
  printf '%s\n' "$out" | grep -E '^\s+[-!] ' | head -12 > "$WORK/layout.detail"
  # Every finding, where a session reads them all without running the checker: the detail shows
  # twelve, and on InvoiceB2B a session hunted the checker's source for the other five URL01 pages.
  mkdir -p .mxcli 2>/dev/null && printf '%s\n' "$out" > .mxcli/layout.txt 2>/dev/null
  local shown total
  shown="$(grep -c . "$WORK/layout.detail")"; total="$(printf '%s\n' "$out" | grep -cE '^\s+[-!] ')"
  [ "$total" -gt "$shown" ] && echo "   ... $shown of $total findings shown; all of them: .mxcli/layout.txt" >> "$WORK/layout.detail"
  # How a page renders (ALERT01) is a warning while MDL_VISUAL=warn, a failure with MDL_VISUAL=error.
  local look
  look="$(printf '%s\n' "$out" | grep -E '^[[:space:]]+! \[ALERT01\]' | sed -E 's/^[[:space:]]+! /   - /')"
  local alert; alert="${MDL_VISUAL:-$(mdl_rule_mode ALERT01)}"
  if [ -n "$look" ] && [ "$alert" = "error" ]; then
    printf '%s\n' "$look" >> "$WORK/layout.detail"
    gate=1
  elif [ -n "$look" ] && [ "$alert" != "0" ]; then
    printf '%s\n' "$look" > "$WORK/layout.warnings"
  fi
  # A textbox whose attribute's name says it holds prose (TEXT02) is a hint, shown with the warnings.
  printf '%s\n' "$out" | grep -E '^[[:space:]]+! \[TEXT02\]' | sed -E 's/^[[:space:]]+! /   - /' >> "$WORK/layout.warnings"
  # Widget names: one line with the count and five examples, not hundreds (an app built before the
  # rule has a name to change on nearly every widget).
  local names_total names_repeated
  names_total="$(printf '%s\n' "$out" | grep -cE '^[[:space:]]+! \[NAME02\]')"
  names_repeated="$(printf '%s\n' "$out" | grep -cE '^[[:space:]]+! \[NAME01\]')"
  if [ "$names_total" -gt 0 ] || [ "$names_repeated" -gt 0 ]; then
    { echo "   - [NAME01/NAME02] $names_total widget name(s) do not read <Page>_<What><Type>, $names_repeated name(s) are used on more than one page (skill naming-and-captions, 'Widget names'); a page new or changed after the next DONE needs them. The first five:"
      printf '%s\n' "$out" | grep -E '^[[:space:]]+! \[NAME02\]' | head -5 | sed -E 's/^[[:space:]]+! /     /'
    } >> "$WORK/layout.warnings"
  fi
  [ -s "$WORK/layout.warnings" ] || rm -f "$WORK/layout.warnings"
  [ -s "$WORK/layout.unread" ] && cat "$WORK/layout.unread" >> "$WORK/layout.warnings"
  return "$gate"
}

# Only passes are cached, keyed on the bytes of every input the check reads plus the .mpr
# and mprcontents/; meta:<path> keys on size + mtime, env:NAME=value on the value.
fingerprint() {   # fingerprint <path>... -> one digest line; meta:<path> keys on size + mtime, env:NAME=value on the value
  gate_helper fingerprint "$MPR" mprcontents "$@"
}

# The key includes a secret kept outside the project, so a forged cache entry cannot replay.
mdl_cache_secret() {
  local file="${MDL_CACHE_SECRET_FILE:-$HOME/.mxcli/gate-cache.secret}"
  if [ ! -s "$file" ]; then
    mkdir -p "$(dirname "$file")" 2>/dev/null || { echo none; return 0; }
    ( umask 077; gate_helper secret > "$file" 2>/dev/null ) \
      || { echo none; return 0; }
  fi
  cat "$file" 2>/dev/null || echo none
}
# Replays a cached pass with "(cached HH:MM)", otherwise runs <function> and stores a pass.
run_cached() {
  local name="$1" fn="$2" key="" status; shift 2
  if [ "$USE_CACHE" = "1" ]; then
    key="$(fingerprint "$@" "env:MDL_CACHE_SECRET=$(mdl_cache_secret)" 2>/dev/null)"
    if [ -n "$key" ] && [ -f "$CACHE_DIR/$name.key" ] && [ "$(cat "$CACHE_DIR/$name.key")" = "$key" ] \
       && [ -f "$CACHE_DIR/$name.summary" ]; then
      sed "s/\$/ (cached $(date -r "$CACHE_DIR/$name.summary" +%H:%M 2>/dev/null || echo earlier))/" \
        "$CACHE_DIR/$name.summary" > "$WORK/$name.summary"
      : > "$WORK/$name.detail"
      [ -f "$CACHE_DIR/$name.warnings" ] && cp "$CACHE_DIR/$name.warnings" "$WORK/$name.warnings"
      echo 0 > "$WORK/$name.status"
      return 0
    fi
  fi
  local started=$SECONDS
  "$fn"; status=$?
  echo $((SECONDS - started)) > "$WORK/$name.secs"
  echo "$status" > "$WORK/$name.status"
  if [ "$status" = "0" ] && [ -n "$key" ] && mkdir -p "$CACHE_DIR" 2>/dev/null; then
    cp "$WORK/$name.summary" "$CACHE_DIR/$name.summary" 2>/dev/null && echo "$key" > "$CACHE_DIR/$name.key"
    # A pass can carry warnings; a replayed pass shows them again.
    rm -f "$CACHE_DIR/$name.warnings"
    [ -s "$WORK/$name.warnings" ] && cp "$WORK/$name.warnings" "$CACHE_DIR/$name.warnings"
  fi
  return "$status"
}

# The rulebook (tests/rulebook/): copied once into $WORK so the ten parallel steps read one
# version, and validated once; a broken card makes every model check "could not run" with the
# card and line (the file is the person's, so it has to be loud). Each step's effective levels
# and exceptions are part of its cache fingerprint (RULEBOOK_<step>).
rulebook_prepare() {
  rm -rf "$WORK/rulebook" "$WORK/rulebook.broken"
  [ -d tests/rulebook ] || return 0
  cp -R tests/rulebook "$WORK/rulebook" 2>/dev/null || { echo "could not copy tests/rulebook" > "$WORK/rulebook.broken"; return 0; }
  local out
  out="$("$NODE" "$MDL_RULEBOOK" "$WORK/rulebook" check 2>&1)" || printf '%s\n' "$out" | tail -1 > "$WORK/rulebook.broken"
  return 0
}
# rulebook_ok <step> -- false, with the step's summary written, when the rulebook is broken.
rulebook_ok() {
  [ -f "$WORK/rulebook.broken" ] || return 0
  echo "$1: could not run -- $(cat "$WORK/rulebook.broken") (tests/rulebook is the person's file)" > "$WORK/$1.summary"
  return 1
}
# rulebook_fingerprint <step> -- `env:RULEBOOK_<step>=<digest of its effective levels and exceptions>`.
rulebook_fingerprint() { printf 'env:RULEBOOK_%s=%s\n' "$1" "$(mdl_rulebook digest "$1" 2>/dev/null || echo none)"; }

# Starts the model checks in the background, each through the cache.
start_model_checks() {
  rulebook_prepare
  # Upgrading the gate, its config or mxcli must not replay an old pass.
  local -a cache_inputs=(tests/gate.sh tests/gate tools/mdl-checks/gate_helpers.cjs tools/mdl-checks/py_compat.cjs tools/mdl-checks/rulebook.cjs tests/harness.env "meta:$MXCLI")
  ( run_cached mx       check_mx       "${cache_inputs[@]}" "env:MDL_MXBUILD_PATH=${MDL_MXBUILD_PATH:-}" \
      meta:widgets meta:theme meta:themesource meta:javasource ) &
  ( run_cached catalog  check_catalog  "${cache_inputs[@]}" tools/mdl-checks/catalog_rules.cjs tools/mdl-checks/security_rules.cjs tools/mdl-checks/check_unused.cjs "$(rulebook_fingerprint catalog)" ) &
  ( run_cached coverage check_coverage "${cache_inputs[@]}" tests tools/mdl-checks/check_test_coverage.cjs "$(rulebook_fingerprint coverage)" ) &
  ( run_cached naming   check_naming   "${cache_inputs[@]}" tools/mdl-checks/check_mdl.cjs tools/mdl-checks/perf_rules.cjs tools/mdl-checks/index_rules.cjs tools/mdl-checks/event_rules.cjs tools/mdl-checks/datasource_rules.cjs "$CACHE_DIR/captions-baseline.json" "env:MDL_CAPTIONS=${MDL_CAPTIONS:-}" "$(rulebook_fingerprint naming)" ) &
  ( run_cached layout   check_layout   "${cache_inputs[@]}" tools/mdl-checks/check_layout.cjs tools/mdl-checks/layout_rules "$CACHE_DIR/names-baseline.json" "env:MDL_VISUAL=${MDL_VISUAL:-}" "env:MDL_WIDGET_NAMES=${MDL_WIDGET_NAMES:-}" "$(rulebook_fingerprint layout)" ) &
  ( run_cached security check_security "${cache_inputs[@]}" tools/mdl-checks/view_access.cjs tools/mdl-checks/security_rules.cjs tools/mdl-checks/check_unused.cjs "env:MDL_REQUIRE_PRODUCTION=${MDL_REQUIRE_PRODUCTION:-}" "$(rulebook_fingerprint security)" ) &
  ( run_cached scope    check_scope    "${cache_inputs[@]}" tools/mdl-checks/check_scope.cjs "env:MDL_SCOPE=${MDL_SCOPE:-}" "$(rulebook_fingerprint scope)" ) &
  ( run_cached paths    check_paths    "${cache_inputs[@]}" tools/mdl-checks/check_paths.cjs tools/mdl-checks/outcome_rules.cjs tools/mdl-checks/check_unused.cjs tests "$CACHE_DIR/paths-baseline.json" "env:MDL_UNTESTED=${MDL_UNTESTED:-}" "env:MDL_PATHS=${MDL_PATHS:-}" "$(rulebook_fingerprint paths)" ) &
  ( run_cached folders  check_folders  "${cache_inputs[@]}" tools/mdl-checks/check_folders.cjs tools/mdl-checks/check_unused.cjs "$(rulebook_fingerprint folders)" ) &
  ( run_cached unused   check_unused   "${cache_inputs[@]}" tools/mdl-checks/check_unused.cjs javasource javascriptsource meta:theme meta:themesource tests "env:MDL_KEEP_UNUSED=${MDL_KEEP_UNUSED:-}" "$(rulebook_fingerprint unused)" ) &
  echo "== mx check, catalog, coverage, naming, layout, security, scope, paths, folders and unused started (they need no app; running while the suite does)"
}

# Qualified entity names of the project's own modules, one per line. SHOW ENTITIES names its
# column "Entity", not "Qualified Name", so this does not go through qualified_names.
# False when a listing fails, is not a JSON list, or holds a name that is not Module.Entity: the
# names become file names and MDL statements, and a listing that cannot be read is not "no entities".
entity_names() {
  local module listing status=0
  for module in $USER_MODULES; do
    listing="$("$MXCLI" -p "$MPR" --json -c "SHOW ENTITIES IN $module" 2>/dev/null)" || { status=1; continue; }
    # newline="\n": on Windows print() writes \r\n, every name kept its \r, and no file matched it.
    # Until 2026-10-04 that failure was swallowed, so VIEW01 and the index rules never ran there.
    printf '%s' "$listing" | "$NODE" "$MDL_SHELL_HELPERS" entity-names 2>/dev/null || status=1
  done
  return "$status"
}

# Describes every entity of the project's own modules once, one file per entity, for the
# security checks below.
describe_entities() {
  describe_entities_into "$WORK/entities"
}

# describe_entities_into <dir> -- <dir>/<Module.Entity>.mdl for every entity of the project's own
# modules: one mxcli call for all of them, cut at each `create ... entity` line; one call each
# when that call fails.
describe_entities_into() {
  local dir="$1" names entity
  mkdir -p "$dir"
  names="$(entity_names)" || return 1
  [ -n "$names" ] || return 0
  if describe_many entity "$names" > "$dir/.all.mdl"; then
    "$NODE" "$MDL_SHELL_HELPERS" split-entities "$dir/.all.mdl" "$dir" || { rm -f "$dir/.all.mdl"; return 1; }
    rm -f "$dir/.all.mdl"
  else
    rm -f "$dir/.all.mdl"
    while IFS= read -r entity; do
      [ -n "$entity" ] || continue
      "$MXCLI" -p "$MPR" -c "DESCRIBE ENTITY $entity" > "$dir/$entity.mdl" 2>/dev/null || return 1
    done <<< "$names"
  fi
  # Every listed entity has its file, or the checks that read them saw only part of the model.
  while IFS= read -r entity; do
    [ -z "$entity" ] || [ -s "$dir/$entity.mdl" ] || return 1
  done <<< "$names"
  return 0
}

# VIEW01 lines (view_access.cjs): a view entity a row-scoped role reads with no XPath constraint.
# Exit 0 none, 1 findings (printed), 2 the checker could not run (its last lines in view.error).
view_findings() {
  local out code
  [ -f tools/mdl-checks/view_access.cjs ] || { echo "tools/mdl-checks/view_access.cjs is missing" > "$WORK/view.error"; return 2; }
  cat "$WORK/entities/"*.mdl 2>/dev/null > "$WORK/entities.mdl"
  out="$("$NODE" tools/mdl-checks/view_access.cjs "$WORK/entities.mdl" \
    --expect "$(ls "$WORK/entities/" 2>/dev/null | grep -c '\.mdl$')" 2>"$WORK/view.error")"; code=$?
  case "$code" in
    0) return 0 ;;
    1) if printf '%s\n' "$out" | grep -q '^\[VIEW01\]'; then printf '%s\n' "$out"; return 1; fi ;;
  esac
  return 2
}

# The security step: the level (security_level) and Mendix's own security best practices
# (security_rules.cjs: CRED01, ANON01, STRICT01, FILTER01, SQL01 block; EXTENDS01, ADMIN01, XSS01,
# WRITE01, PWD01 are warnings). Either one failing fails the step; the summary has a line of each.
check_security() {
  local level_status rules_status
  : > "$WORK/security.detail"
  rulebook_ok security || return 2
  security_level; level_status=$?
  mv "$WORK/security.summary" "$WORK/security.level" 2>/dev/null
  security_rules; rules_status=$?
  cat "$WORK/security.level" "$WORK/security.summary" > "$WORK/security.both" 2>/dev/null
  mv "$WORK/security.both" "$WORK/security.summary"
  rm -f "$WORK/security.level"
  [ "$level_status" = "1" ] || [ "$rules_status" = "1" ] && return 1
  [ "$level_status" = "2" ] || [ "$rules_status" = "2" ] && return 2
  return 0
}

security_rules() {
  local gate found code total scratch="$WORK/securitycheck"
  : > "$WORK/security.summary"
  [ -f tools/mdl-checks/security_rules.cjs ] || {
    echo "security rules: could not run -- tools/mdl-checks/security_rules.cjs is missing" > "$WORK/security.summary"; return 2; }
  modules_or_status security; gate=$?
  case "$gate" in
    0) ;;
    3) : > "$WORK/security.summary"; return 0 ;;
    *) return "$gate" ;;
  esac
  rulebook_ok security || return 2
  project_copy "$scratch" security || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args security)
  # shellcheck disable=SC2086
  found="$("$NODE" tools/mdl-checks/security_rules.cjs . $USER_MODULES --mpr "$scratch/$MPR" ${rb[@]+"${rb[@]}"} 2>&1)"; code=$?
  if ! printf '%s\n' "$found" | head -1 | grep -qE '^(PASS|FAIL) '; then
    echo "security rules: could not run -- $(printf '%s\n' "$found" | grep -v '^[[:space:]]*$' | tail -1)" > "$WORK/security.summary"
    return 2
  fi
  echo "security rules: $(printf '%s\n' "$found" | head -1)" > "$WORK/security.summary"
  # Every finding where a session can read them all without running the checker, as paths does.
  mkdir -p .mxcli 2>/dev/null && printf '%s\n' "$found" > .mxcli/security.txt 2>/dev/null
  total="$(printf '%s\n' "$found" | grep -c '^  ~ ')"
  if [ "$total" -gt 0 ]; then
    printf '%s\n' "$found" | grep '^  ~ ' | head -8 | sed -E 's/^  ~ /   - /' > "$WORK/security.warnings"
    [ "$total" -gt 8 ] && echo "   ... 8 of $total security warnings shown; all of them: .mxcli/security.txt" >> "$WORK/security.warnings"
  fi
  [ "$code" = "0" ] && return 0
  {
    printf '%s\n' "$found" | grep '^  - ' | sed 's/^  /   /'
    echo "   Why each one matters and its fix: tests/checks/security.md. Every finding: .mxcli/security.txt"
  } >> "$WORK/security.detail"
  return 1
}

# An app with sign-in is only as safe as its security level: at PROTOTYPE Mendix checks page and
# microflow access and the read/write rights, but IGNORES the XPath constraint on an access rule --
# the row-level rule is stored, passes mx check, and lets every row through. Two sessions
# built customer isolation on rules that did nothing. Production is therefore the level the gate
# requires; MDL_REQUIRE_PRODUCTION=0 in tests/harness.env is for an app that deliberately has no
# users at all.
security_level() {
  local level rules entity views
  # PRODUCTION01 in the rulebook (tests/rulebook/PRODUCTION01.md): `off` skips the level and VIEW01,
  # as MDL_REQUIRE_PRODUCTION=0 did; the security rules (CRED01 ...) run either way.
  [ "${MDL_REQUIRE_PRODUCTION:-1}" = "0" ] && { echo "security: not checked (MDL_REQUIRE_PRODUCTION=0)" > "$WORK/security.summary"; return 0; }
  [ "$(mdl_rule_level PRODUCTION01 block)" = "off" ] && { echo "security: not checked (PRODUCTION01 is off in tests/rulebook)" > "$WORK/security.summary"; return 0; }
  level="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | sed -n 's/^Security Level:[[:space:]]*//p' | head -1)"
  if [ -z "$level" ]; then
    echo "security: could not run -- SHOW PROJECT SECURITY printed no level" > "$WORK/security.summary"
    return 2
  fi
  # A model that could not be read, or a checker that crashed, is not "no VIEW01": it used to
  # read as "level Production", and that pass was then cached.
  if ! describe_entities; then
    echo "security: could not run -- the project's entities could not be listed or described" > "$WORK/security.summary"
    return 2
  fi
  views="$(view_findings)"
  if [ "$?" = "2" ]; then
    echo "security: could not run -- view_access.cjs did not finish" > "$WORK/security.summary"
    tail -3 "$WORK/view.error" 2>/dev/null >> "$WORK/security.detail"
    return 2
  fi
  if [ -n "$views" ]; then
    printf '%s\n' "$views" | sed 's/^/   /' >> "$WORK/security.detail"
  fi
  case "$level" in
    Production*)
      if [ -z "$views" ]; then echo "security: level Production" > "$WORK/security.summary"; return 0; fi
      echo "security: level Production, but $(printf '%s\n' "$views" | grep -c .) view entity rule(s) hand a row-scoped role every row (VIEW01)" > "$WORK/security.summary"
      return 1 ;;
  esac
  echo "security: level $level, and the gate requires Production" > "$WORK/security.summary"
  # Name the rules that are silently doing nothing, so the cost is concrete.
  rules=0
  for entity in "$WORK/entities/"*.mdl; do
    grep -q "where '" "$entity" 2>/dev/null || continue
    entity="$(basename "$entity" .mdl)"
    rules=$((rules + 1))
    [ "$rules" -le 5 ] && echo "   $entity has an access rule with an XPath constraint" >> "$WORK/security.detail"
  done
  {
    [ "$rules" = "0" ] || echo "   at $level those $rules XPath constraint(s) are NOT enforced: every signed-in user sees every row."
    echo "   Fix: alter project security level PRODUCTION;   (demo users keep working, and the rules start to bite)"
    echo "   Row isolation, the shape that works, in order:"
    echo "     1. link your own entity to the login account and let it go when the account goes:"
    echo "        create or modify association Mod.Customer_Account from Mod.Customer to Administration.Account type Reference on delete set null;"
    echo "     2. constrain the customer role on EVERY entity it may read, walking the association path back to the account:"
    echo "        grant Mod.CustomerRole on Mod.Invoice (read *) where '[Mod.Invoice_Order/Mod.Order/Mod.Order_Customer/Mod.Customer/Mod.Customer_Account = ''[%CurrentUser%]'']';"
    echo "        (the path alternates association/entity; comparing the last association to the token is what scopes the row)"
    echo "     3. Production needs a rule for every entity a page reads, not only the scoped ones -- an entity with no rule for that role reads as no access, and the page comes up empty."
    echo "     4. prove both directions in one test: the signed-in customer sees their own rows, and a row of another customer is absent (oql_count ... = 0), not merely off-screen."
    echo "   Skills: manage-security, xpath-constraints."
  } >> "$WORK/security.detail"
  return 1
}

# SCOPE01: a page's data source microflow returns rows its role may not read -- a microflow does
# not apply entity access, so an XPath-scoped access rule does not reach them. A warning unless
# MDL_SCOPE=error: a DeepSeek portal leaked another customer's invoice this way, and only its
# verify test caught it.
check_scope() {
  local gate out code total
  [ -f tools/mdl-checks/check_scope.cjs ] || {
    echo "scope: could not run -- tools/mdl-checks/check_scope.cjs is missing" > "$WORK/scope.summary"; return 2; }
  modules_or_status scope; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;
    *) return "$gate" ;;
  esac
  rulebook_ok scope || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args scope)
  # shellcheck disable=SC2086
  out="$("$NODE" tools/mdl-checks/check_scope.cjs . $USER_MODULES ${rb[@]+"${rb[@]}"} 2>&1)"; code=$?
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
  local gate out found code scratch="$WORK/unusedcheck" count errors
  [ -f tools/mdl-checks/check_unused.cjs ] || {
    echo "unused: could not run -- tools/mdl-checks/check_unused.cjs is missing" > "$WORK/unused.summary"; return 2; }
  modules_or_status unused; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;
    *) return "$gate" ;;
  esac
  rulebook_ok unused || return 2
  project_copy "$scratch" unused || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args unused)
  # shellcheck disable=SC2086
  found="$("$NODE" tools/mdl-checks/check_unused.cjs . $USER_MODULES --mpr "$scratch/$MPR" ${rb[@]+"${rb[@]}"} \
    ${MDL_KEEP_UNUSED:+--keep "$MDL_KEEP_UNUSED"} 2>&1)"; code=$?
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
  local gate found code scratch="$WORK/pathscheck" total
  [ -f tools/mdl-checks/check_paths.cjs ] || {
    echo "paths: could not run -- tools/mdl-checks/check_paths.cjs is missing" > "$WORK/paths.summary"; return 2; }
  modules_or_status paths; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;
    *) return "$gate" ;;
  esac
  rulebook_ok paths || return 2
  project_copy "$scratch" paths || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args paths)
  # shellcheck disable=SC2086
  found="$("$NODE" tools/mdl-checks/check_paths.cjs . $USER_MODULES --mpr "$scratch/$MPR" ${rb[@]+"${rb[@]}"} \
    --baseline "$CACHE_DIR/paths-baseline.json" ${MDL_UNTESTED:+--untested "$MDL_UNTESTED"} \
    $([ "${MDL_PATHS:-}" = "error" ] && echo --all-fail) 2>&1)"; code=$?
  if ! printf '%s\n' "$found" | head -1 | grep -qE '^(PASS|FAIL) '; then
    echo "paths: could not run -- $(printf '%s\n' "$found" | grep -v '^[[:space:]]*$' | tail -1)" > "$WORK/paths.summary"
    return 2
  fi
  echo "paths: $(printf '%s\n' "$found" | head -1)" > "$WORK/paths.summary"
  # Every finding, old ones too, where a session can read them all without running the checker.
  mkdir -p .mxcli 2>/dev/null && printf '%s\n' "$found" > .mxcli/paths.txt 2>/dev/null
  total="$(printf '%s\n' "$found" | grep -c '^  ~ ')"
  if [ "$total" -gt 0 ]; then
    printf '%s\n' "$found" | grep '^  ~ ' | head -6 | sed -E 's/^  ~ /   - /' > "$WORK/paths.warnings"
    [ "$total" -gt 6 ] && echo "   ... 6 of $total older paths without a test shown; all of them: .mxcli/paths.txt" >> "$WORK/paths.warnings"
  fi
  [ "$code" = "0" ] && return 0
  {
    printf '%s\n' "$found" | grep '^  - ' | sed 's/^  /   /'
    echo "   A path is walked when a test (not a comment in it) asserts what the user meets there. Read"
    echo "   tests/checks/paths.md and reference/paths.md of the test-first-delivery skill. Every finding: .mxcli/paths.txt"
  } > "$WORK/paths.detail"
  return 1
}

# FOLDER01 (check_folders.cjs): every document of the app's own modules in <business folder>/UI
# (pages, snippets), /FNC (microflows, nanoflows) or /ENV (everything else). The finding lists the
# `move` statements; one script with all of them applies it. Read from a copy's catalog, as unused does.
check_folders() {
  local gate found code scratch="$WORK/folderscheck"
  [ -f tools/mdl-checks/check_folders.cjs ] || {
    echo "folders: could not run -- tools/mdl-checks/check_folders.cjs is missing" > "$WORK/folders.summary"; return 2; }
  modules_or_status folders; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;
    *) return "$gate" ;;
  esac
  rulebook_ok folders || return 2
  project_copy "$scratch" folders || return 2
  local -a rb=(); while IFS= read -r line; do rb+=("$line"); done < <(mdl_rule_args folders)
  # shellcheck disable=SC2086
  found="$("$NODE" tools/mdl-checks/check_folders.cjs . $USER_MODULES --mpr "$scratch/$MPR" ${rb[@]+"${rb[@]}"} 2>&1)"; code=$?
  if ! printf '%s\n' "$found" | head -1 | grep -qE '^(PASS|WARN|FAIL) '; then
    echo "folders: could not run -- $(printf '%s\n' "$found" | grep -v '^[[:space:]]*$' | tail -1)" > "$WORK/folders.summary"
    return 2
  fi
  echo "folders: $(printf '%s\n' "$found" | head -1)" > "$WORK/folders.summary"
  [ "$code" = "0" ] && return 0
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

# Reads one background check's files into summary, failures or cannot_run, and details.
collect() {
  local name="$1" label="$2" status line
  if [ ! -f "$WORK/$name.status" ]; then
    # No status file: the worker died. Not a pass.
    summary+=("$label: could not run -- the check left no result")
    cannot_run+=("$label")
    return 0
  fi
  status="$(cat "$WORK/$name.status")"
  if [ -s "$WORK/$name.summary" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && summary+=("$line")
    done < "$WORK/$name.summary"
  fi
  # What the person's ## Local sections changed for this step (tests/rulebook/), so a verdict read
  # beside the rulebook explains itself. In the summary, not the detail: a replayed pass keeps it.
  local changed; changed="$(mdl_rulebook changes "$name" 2>/dev/null)" || changed=""
  [ -n "$changed" ] && summary+=("   rulebook: $changed")
  # The detail lines print under the verdict (print_verdict_and_exit), so the tail of the
  # output holds both the verdict and its cause.
  case "$status" in
    0) ;;
    2) # A check that stopped without writing why left a bare "could not run", and a session
       # took it for its own fault and spent many steps taking the gate apart.
       # A checker's own "ERROR <why>" line says why: adding "without saying why" under it
       # contradicted it (coverage, "no module named Integration").
       if ! grep -qE 'could not run|^[a-z]+ ERROR ' "$WORK/$name.summary" 2>/dev/null; then
         summary+=("$label: could not run -- the check stopped without saying why. That is a fault in the harness, not in your project: run bash tests/gate.sh once more; if it repeats, say so and carry on with the other checks")
       fi
       details+=("$name|$label (could not run)")
       cannot_run+=("$label") ;;
    *) details+=("$name|$label")
       failures+=("$label") ;;
  esac
}

# After `wait`: each background check's verdict into summary, failures or cannot_run.
collect_model_checks() {
  collect mx "mx check"
  collect catalog "catalog"
  collect coverage "coverage"
  collect naming "naming"
  collect layout "layout"
  collect security "security"
  collect scope "scope"
  collect paths "paths"
  collect folders "folders"
  collect unused "unused"
}
