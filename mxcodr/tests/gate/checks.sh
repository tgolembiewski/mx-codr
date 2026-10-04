# tests/gate/checks.sh -- the model checks that need no app (mx check, lint, coverage, naming,
# layout, security, scope), and their cache.
# Sourced by tests/gate.sh; defines functions only. Entry points: start_model_checks, collect_model_checks.

# Each check runs in a background subshell, so it reports through files: check_<name> writes
# $WORK/<name>.summary and .detail and returns 0 pass / 1 problems / 2 could not run;
# run_cached adds .status and .secs; collect reads them after `wait`.

# mx_check_copy -- mx check on a fresh copy of the project; sets out. False when the copy failed.
# mx check runs on a copy: it rewrites the .mpr and would trigger --watch rebuilds.
# The copy needs widgets/ and theme*/ as well; `cp -Rc` clones on APFS, else plain cp -R.
mx_check_copy() {
  local item scratch="$WORK/mxcheck"
  rm -rf "$scratch"; mkdir -p "$scratch"
  for item in "$MPR" mprcontents widgets theme themesource javasource; do
    [ -e "$item" ] || continue
    cp -Rc "$item" "$scratch/" 2>/dev/null || cp -R "$item" "$scratch/" 2>/dev/null || {
      echo "mx check: could not run -- could not copy $item to a scratch directory" > "$WORK/mx.summary"; return 1; }
  done
  # Without `mx update-widgets` (2.9s of a 5.2s check, measured); the one error that
  # step prevents, CE0463, buys the slow run. Same rule as tests/precheck.sh.
  local -a mx_args=(docker check -p "$scratch/$MPR")
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
  gate_py qualified-names 2>/dev/null
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

# The lint warnings to fix now, from `mxcli lint` text on stdin, as `   - [CODE] ...` lines.
lint_worth_fixing() {
  grep -E '\[CONV011\][[:space:]]*$' | head -10 \
    | sed -E 's/^[[:space:]]*[^[:alnum:]]*[[:space:]]*//; s/ This causes N\+1 database operations\.//; s/[[:space:]]*\[CONV011\][[:space:]]*$//' \
    | sed 's/^/   - [CONV011] /; s/$/ -- change the objects in the loop, commit the list once after `end loop` (new objects: `add` them to a list first)/'
}

# Only lint errors fail; warnings and info do not.
check_lint() {
  local out code line errors
  out="$("$MXCLI" lint -p "$MPR" 2>&1)"; code=$?
  # Lint runs beside a boot: when mxbuild touches the project mid-run, lint stops on "Cache
  # invalid: project file modified" with no summary. Once more, after the change, is enough.
  if ! printf '%s\n' "$out" | grep -qE '^[0-9]+ issues:|No issues found\.'; then
    sleep 3
    out="$("$MXCLI" lint -p "$MPR" 2>&1)"; code=$?
  fi
  # Lint warnings never block, and the gate only counted them, so a session met a commit inside a
  # loop (CONV011, one database call per row) at the end of its work or not at all. The ones worth
  # fixing while the code is fresh are listed under the gate's warnings, each with its fix.
  printf '%s\n' "$out" | lint_worth_fixing > "$WORK/lint.warnings"
  # A .star file that fails to parse is skipped while lint still exits 0: not a pass.
  if printf '%s\n' "$out" | grep -qE 'rule file\(s\) skipped|rule file skipped'; then
    echo "lint: could not run -- $(printf '%s\n' "$out" | grep -cE '^Warning: rule file skipped') lint rule file(s) failed to load" > "$WORK/lint.summary"
    printf '%s\n' "$out" | grep -E '^Warning: rule file skipped' | sed 's/^Warning: rule file skipped: /  - /' | head -5 > "$WORK/lint.detail"
    return 2
  fi
  line="$(printf '%s\n' "$out" | grep -E '^[0-9]+ issues:' | tail -1)"
  if [ -z "$line" ] && [ "$code" = "0" ] && printf '%s\n' "$out" | grep -qF 'No issues found.'; then
    echo "lint: No issues found." > "$WORK/lint.summary"
    return 0
  fi
  if [ -z "$line" ]; then
    echo "lint: could not run -- mxcli lint exited $code without a summary" > "$WORK/lint.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -5 > "$WORK/lint.detail"
    return 2
  fi
  echo "lint: $line" > "$WORK/lint.summary"
  errors="$(printf '%s\n' "$line" | grep -oE '[0-9]+ errors' | grep -oE '[0-9]+')"
  [ -n "$errors" ] && [ "$errors" != "0" ] || return 0
  printf '%s\n' "$out" | grep -E '✖|\[error\]' | head -10 > "$WORK/lint.detail"
  return 1
}

# Every page and ACT_ microflow must be named by a verify-*.test.sh `# covers:` line.
check_coverage() {
  [ -f tools/mdl-checks/check_test_coverage.py ] || {
    echo "coverage: could not run -- tools/mdl-checks/check_test_coverage.py is missing" > "$WORK/coverage.summary"
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
  out="$("$PY" tools/mdl-checks/check_test_coverage.py . $USER_MODULES 2>&1)"; code=$?
  printf '%s\n' "$out" | grep -E '^(PASS|FAIL|ERROR) ' | sed 's/^/coverage /' > "$WORK/coverage.summary"
  printf '%s\n' "$out" | grep -E '^[[:space:]]+- ' | head -10 > "$WORK/coverage.detail"
  case "$code" in
    0) return 0 ;;
    1) grep -q '^coverage FAIL ' "$WORK/coverage.summary" && return 1 ;;
  esac
  # The checker broke: keep its summary if it printed an ERROR line, else replace it.
  if ! grep -q '^coverage ERROR ' "$WORK/coverage.summary"; then
    echo "coverage: could not run -- check_test_coverage.py exited $code" > "$WORK/coverage.summary"
  fi
  printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 >> "$WORK/coverage.detail"
  return 2
}

# Runs check_mdl.py --skill naming over the described microflows and nanoflows. Caption rules are
# warnings unless MDL_CAPTIONS=error: 286 of them once landed on a session with no test green.
check_naming() {
  [ -f tools/mdl-checks/check_mdl.py ] || {
    echo "naming: could not run -- tools/mdl-checks/check_mdl.py is missing" > "$WORK/naming.summary"
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
  local captions=warn total
  [ "${MDL_CAPTIONS:-warn}" = "error" ] && captions=error
  # PERF07 reads the entities' indexes and the pages' data sources as well.
  rm -f "$WORK/naming.unread"
  local -a index_inputs=(--entities "$WORK/naming-entities" --pages "$WORK/naming-pages")
  if ! describe_entities_into "$WORK/naming-entities" || ! describe_all naming-pages "$WORK/naming-pages" "PAGES"; then
    # The index rules are warnings: without their input they are left out, and the gate says so.
    index_inputs=()
    echo "   - naming: the entities or pages could not be read, so the index rules (PERF07, PERF08) did not run" > "$WORK/naming.unread"
  fi
  # Captions: a backlog of warnings until the first DONE; from then on a microflow that is new or
  # changed since the last DONE needs them (the hashes each DONE keeps, tests/gate.sh).
  local -a baseline=()
  [ -f "$CACHE_DIR/captions-baseline.json" ] && baseline=(--captions-baseline "$CACHE_DIR/captions-baseline.json")
  mkdir -p "$CACHE_DIR" 2>/dev/null
  out="$("$PY" tools/mdl-checks/check_mdl.py "$WORK/mdl" --skill naming --captions "$captions" \
    ${index_inputs[@]+"${index_inputs[@]}"} --expect-flows "$(cat "$WORK/naming.count" 2>/dev/null || echo 0)" \
    --format "$("$MXCLI" --version 2>/dev/null | head -1)" \
    --flow-hashes "$CACHE_DIR/naming.flows.json" ${baseline[@]+"${baseline[@]}"} 2>&1)"; code=$?
  checker_verdict "$code" "$out"; gate=$?
  if [ "$gate" = "2" ]; then
    echo "naming: could not run -- check_mdl.py exited $code" > "$WORK/naming.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/naming.detail"
    return 2
  fi
  echo "naming: $(printf '%s\n' "$out" | head -1)" > "$WORK/naming.summary"
  # A session read ten detail lines as ten findings when there were 286: say how many are left out.
  total="$(printf '%s\n' "$out" | grep -cE '^\s+- ')"
  printf '%s\n' "$out" | grep -E '^\s+- ' | head -10 > "$WORK/naming.detail"
  [ "$total" -gt 10 ] && echo "  ... 10 of $total shown -- the rest are the same kinds; fix them script by script" >> "$WORK/naming.detail"
  # Every performance warning is listed: each names a different table or loop, and Pi, shown 8 of
  # 12 PERF07 lines, hunted the cache and the dumps for the other four. The rest stay capped at 8.
  local perf_lines other_total
  perf_lines="$(printf '%s\n' "$out" | grep -E '^\s+! \[PERF' | sed -E 's/^[[:space:]]+! /   - /')"
  other_total="$(printf '%s\n' "$out" | grep -E '^\s+! ' | grep -cv '\[PERF')"
  if [ -n "$perf_lines" ] || [ "$other_total" -gt 0 ] || [ -s "$WORK/naming.unread" ]; then
    { cat "$WORK/naming.unread" 2>/dev/null
      [ -n "$perf_lines" ] && printf '%s\n' "$perf_lines"
      printf '%s\n' "$out" | grep -E '^\s+! ' | grep -v '\[PERF' | head -8 | sed -E 's/^[[:space:]]+! /   - /'
      [ "$other_total" -gt 8 ] && echo "   ... 8 of $other_total naming warnings shown (MDL_CAPTIONS=error makes caption rules block)"
    } > "$WORK/naming.warnings"
  fi
  return "$gate"
}

# Adds to nav_args (never replaces it: the caller has put --own-modules there already): the menu icons (NAV05) and the snippets' buttons (ICON01) always; the Log out and role-home rules (NAV01-NAV03) only
# when project security is on, since only then do users sign in. Returns 1, with the summary
# written, when security is on and the navigation cannot be read.
# layout_unread <what> <codes> -- a describe that failed while gathering extra input for the layout
# check. It does not stop the check (one widget mxcli cannot describe would block every DONE), but
# the rules that read that input may have missed something, and the gate says which.
layout_unread() {
  local what="$1" codes="$2" first
  first="$(head -1 "$WORK/layout-$what.broken" 2>/dev/null)"
  echo "   - layout: some $what could not be read (${first:-describe failed}), so $codes may have missed a finding there" >> "$WORK/layout.unread"
  return 0
}

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
     || ! roles="$(printf '%s' "$roles" | "$PY" -c 'import json, sys
sys.stdout.reconfigure(newline="\n")      # Windows: print() would end each name with \r\n
rows = json.load(sys.stdin)
if not isinstance(rows, list):
    raise SystemExit(1)
for row in rows:
    print(row.get("Name", ""))' 2>/dev/null)"; then
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
  done < <(grep -iE "^[[:space:]]*menu[[:space:]]+item[[:space:]]+'" "$WORK/navigation.mdl" \
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

# Widget spacing, read from `describe page` (Starlark lint rules cannot see widgets).
check_layout() {
  [ -f tools/mdl-checks/check_layout.py ] || {
    echo "layout: could not run -- tools/mdl-checks/check_layout.py is missing" > "$WORK/layout.summary"
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
  out="$("$PY" tools/mdl-checks/check_layout.py "$WORK/pages" "${nav_args[@]}" \
    --expect-pages "$(cat "$WORK/layout.count" 2>/dev/null || echo 0)" 2>&1)"; code=$?
  checker_verdict "$code" "$out"; gate=$?
  if [ "$gate" = "2" ]; then
    echo "layout: could not run -- check_layout.py exited $code" > "$WORK/layout.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/layout.detail"
    return 2
  fi
  echo "layout: $(printf '%s\n' "$out" | head -1)" > "$WORK/layout.summary"
  printf '%s\n' "$out" | grep -E '^\s+[-!] ' | head -12 > "$WORK/layout.detail"
  # How a page renders (ALERT01) is a warning while MDL_VISUAL=warn, a failure with MDL_VISUAL=error.
  local look
  look="$(printf '%s\n' "$out" | grep -E '^[[:space:]]+! \[ALERT01\]' | sed -E 's/^[[:space:]]+! /   - /')"
  if [ -n "$look" ] && [ "${MDL_VISUAL:-warn}" = "error" ]; then
    printf '%s\n' "$look" >> "$WORK/layout.detail"
    gate=1
  elif [ -n "$look" ] && [ "${MDL_VISUAL:-warn}" != "0" ]; then
    printf '%s\n' "$look" > "$WORK/layout.warnings"
  fi
  [ -s "$WORK/layout.unread" ] && cat "$WORK/layout.unread" >> "$WORK/layout.warnings"
  return "$gate"
}

# Only passes are cached, keyed on the bytes of every input the check reads plus the .mpr
# and mprcontents/; meta:<path> keys on size + mtime, env:NAME=value on the value.
fingerprint() {   # fingerprint <path>... -> one digest line; meta:<path> keys on size + mtime, env:NAME=value on the value
  gate_py fingerprint "$MPR" mprcontents "$@"
}

# The key includes a secret kept outside the project, so a forged cache entry cannot replay.
mdl_cache_secret() {
  local file="${MDL_CACHE_SECRET_FILE:-$HOME/.mxcli/gate-cache.secret}"
  if [ ! -s "$file" ]; then
    mkdir -p "$(dirname "$file")" 2>/dev/null || { echo none; return 0; }
    ( umask 077; gate_py secret > "$file" 2>/dev/null ) \
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

# Starts the model checks in the background, each through the cache.
start_model_checks() {
  # Upgrading the gate, its config or mxcli must not replay an old pass.
  local -a cache_inputs=(tests/gate.sh tests/gate tools/mdl-checks/gate_helpers.py tests/harness.env "meta:$MXCLI")
  ( run_cached mx       check_mx       "${cache_inputs[@]}" "env:MDL_MXBUILD_PATH=${MDL_MXBUILD_PATH:-}" \
      meta:widgets meta:theme meta:themesource meta:javasource ) &
  ( run_cached lint     check_lint     "${cache_inputs[@]}" .claude/lint-rules ) &
  ( run_cached coverage check_coverage "${cache_inputs[@]}" tests tools/mdl-checks/check_test_coverage.py ) &
  ( run_cached naming   check_naming   "${cache_inputs[@]}" tools/mdl-checks/check_mdl.py tools/mdl-checks/perf_rules.py tools/mdl-checks/index_rules.py "$CACHE_DIR/captions-baseline.json" "env:MDL_CAPTIONS=${MDL_CAPTIONS:-}" ) &
  ( run_cached layout   check_layout   "${cache_inputs[@]}" tools/mdl-checks/check_layout.py "env:MDL_VISUAL=${MDL_VISUAL:-}" ) &
  ( run_cached security check_security "${cache_inputs[@]}" tools/mdl-checks/view_access.py "env:MDL_REQUIRE_PRODUCTION=${MDL_REQUIRE_PRODUCTION:-}" ) &
  ( run_cached scope    check_scope    "${cache_inputs[@]}" tools/mdl-checks/check_scope.py "env:MDL_SCOPE=${MDL_SCOPE:-}" ) &
  echo "== mx check, lint, coverage, naming, layout, security and scope started (they need no app; running while the suite does)"
}

# An app with sign-in is only as safe as its security level: at PROTOTYPE Mendix checks page and
# microflow access and the read/write rights, but IGNORES the XPath constraint on an access rule --
# the row-level rule is stored, passes mx check and lint, and lets every row through. Two sessions
# built customer isolation on rules that did nothing. Production is therefore the level the gate
# requires; MDL_REQUIRE_PRODUCTION=0 in tests/harness.env is for an app that deliberately has no
# users at all.
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
    printf '%s' "$listing" | "$PY" -c 'import json, re, sys
sys.stdout.reconfigure(newline="\n")
rows = json.load(sys.stdin)
if not isinstance(rows, list):
    raise SystemExit(1)
for row in rows:
    name = row.get("Entity") or row.get("Qualified Name") or row.get("QualifiedName")
    if not name:
        continue
    if not re.fullmatch(r"[A-Za-z_]\w*\.[A-Za-z_]\w*", name):
        raise SystemExit(1)
    print(name)' 2>/dev/null || status=1
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
    "$PY" -c 'import re, sys
current, pending, out = None, [], {}
for line in open(sys.argv[1], encoding="utf-8"):
    head = re.match(r"\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?:\S+\s+)?entity\s+([\w.]+)", line, re.I)
    if head:
        current = head.group(1)
        out[current], pending = pending, []
    if current:
        out[current].append(line)
        if line.strip() == "/":
            current = None
    else:
        pending.append(line)   # the doc comment and position above the next entity
for name, lines in out.items():
    with open(sys.argv[2] + "/" + name + ".mdl", "w", encoding="utf-8") as handle:
        handle.write("".join(lines))' "$dir/.all.mdl" "$dir" || { rm -f "$dir/.all.mdl"; return 1; }
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

# VIEW01 lines (view_access.py): a view entity a row-scoped role reads with no XPath constraint.
# Exit 0 none, 1 findings (printed), 2 the checker could not run (its last lines in view.error).
view_findings() {
  local out code
  [ -f tools/mdl-checks/view_access.py ] || { echo "tools/mdl-checks/view_access.py is missing" > "$WORK/view.error"; return 2; }
  cat "$WORK/entities/"*.mdl 2>/dev/null > "$WORK/entities.mdl"
  out="$("$PY" tools/mdl-checks/view_access.py "$WORK/entities.mdl" \
    --expect "$(ls "$WORK/entities/" 2>/dev/null | grep -c '\.mdl$')" 2>"$WORK/view.error")"; code=$?
  case "$code" in
    0) return 0 ;;
    1) if printf '%s\n' "$out" | grep -q '^\[VIEW01\]'; then printf '%s\n' "$out"; return 1; fi ;;
  esac
  return 2
}

check_security() {
  local level rules entity views
  [ "${MDL_REQUIRE_PRODUCTION:-1}" = "0" ] && { echo "security: not checked (MDL_REQUIRE_PRODUCTION=0)" > "$WORK/security.summary"; return 0; }
  level="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | sed -n 's/^Security Level:[[:space:]]*//p' | head -1)"
  if [ -z "$level" ]; then
    echo "security: could not run -- SHOW PROJECT SECURITY printed no level" > "$WORK/security.summary"
    return 2
  fi
  # A model that could not be read, or a checker that crashed, is not "no VIEW01": it used to
  # read as "level Production", and that pass was then cached.
  : > "$WORK/security.detail"
  if ! describe_entities; then
    echo "security: could not run -- the project's entities could not be listed or described" > "$WORK/security.summary"
    return 2
  fi
  views="$(view_findings)"
  if [ "$?" = "2" ]; then
    echo "security: could not run -- view_access.py did not finish" > "$WORK/security.summary"
    tail -3 "$WORK/view.error" 2>/dev/null > "$WORK/security.detail"
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
  [ -f tools/mdl-checks/check_scope.py ] || {
    echo "scope: could not run -- tools/mdl-checks/check_scope.py is missing" > "$WORK/scope.summary"; return 2; }
  modules_or_status scope; gate=$?
  case "$gate" in
    0) ;;
    3) return 0 ;;
    *) return "$gate" ;;
  esac
  # shellcheck disable=SC2086
  out="$("$PY" tools/mdl-checks/check_scope.py . $USER_MODULES 2>&1)"; code=$?
  if [ "$code" = "2" ]; then
    echo "scope: could not run -- $(printf '%s\n' "$out" | tail -1)" > "$WORK/scope.summary"; return 2
  fi
  # 0 passes and 1 has findings, each under a PASS or WARN line; anything else (a traceback
  # exits 1 too) did not check the model, and counted as "findings", a pass while MDL_SCOPE=warn.
  if { [ "$code" != "0" ] && [ "$code" != "1" ]; } || ! printf '%s\n' "$out" | head -1 | grep -qE '^(PASS|WARN) '; then
    echo "scope: could not run -- check_scope.py exited $code" > "$WORK/scope.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/scope.detail"
    return 2
  fi
  echo "scope: $(printf '%s\n' "$out" | head -1)" > "$WORK/scope.summary"
  [ "$code" = "0" ] && return 0
  if [ "${MDL_SCOPE:-warn}" = "error" ]; then
    printf '%s\n' "$out" | grep -E '^\s+- ' > "$WORK/scope.detail"
    return 1
  fi
  total="$(printf '%s\n' "$out" | grep -cE '^\s+- ')"
  printf '%s\n' "$out" | grep -E '^\s+- ' | head -6 | sed -E 's/^[[:space:]]+- /   - /' > "$WORK/scope.warnings"
  [ "$total" -gt 6 ] && echo "   ... 6 of $total shown" >> "$WORK/scope.warnings"
  return 0
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
  collect lint "lint"
  collect coverage "coverage"
  collect naming "naming"
  collect layout "layout"
  collect security "security"
  collect scope "scope"
}
