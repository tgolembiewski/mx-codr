# tests/gate/checks.sh -- the five model checks that need no app, and their cache.
# Sourced by tests/gate.sh; defines functions only. Entry points: start_model_checks, collect_model_checks.

# Each check runs in a background subshell, so it reports through files: check_<name> writes
# $WORK/<name>.summary and .detail and returns 0 pass / 1 problems / 2 could not run;
# run_cached adds .status and .secs; collect reads them after `wait`.
check_mx() {
  local out errors item
  # mx check runs on a copy: it rewrites the .mpr and would trigger --watch rebuilds.
  # The copy needs widgets/ and theme*/ as well; `cp -Rc` clones on APFS, else plain cp -R.
  local scratch="$WORK/mxcheck"
  mkdir -p "$scratch"
  for item in "$MPR" mprcontents widgets theme themesource javasource; do
    [ -e "$item" ] || continue
    cp -Rc "$item" "$scratch/" 2>/dev/null || cp -R "$item" "$scratch/" 2>/dev/null || {
      echo "mx check: could not run -- could not copy $item to a scratch directory" > "$WORK/mx.summary"; return 2; }
  done
  # Without `mx update-widgets` (2.9s of a 5.2s check, measured); the one error that
  # step prevents, CE0463, buys the slow run. Same rule as tests/precheck.sh.
  local -a mx_args=(docker check -p "$scratch/$MPR")
  [ -n "${MDL_MXBUILD_PATH:-}" ] && mx_args+=(--mxbuild-path "$MDL_MXBUILD_PATH")
  out="$("$MXCLI" "${mx_args[@]}" --no-update-widgets 2>&1)"
  if printf '%s\n' "$out" | grep -q 'CE0463'; then
    out="$("$MXCLI" "${mx_args[@]}" 2>&1)"
  fi
  # mx check exits 0 even with model errors, so read the count it prints.
  errors="$(printf '%s\n' "$out" | grep -oE 'contains: [0-9]+ errors' | grep -oE '[0-9]+' | tail -1)"
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

# Describes every document of <kinds> into <dir>/<module>.mdl; failures go to
# $WORK/<label>.broken. False when anything failed.
describe_all() {
  local label="$1" dir="$2" kinds="$3" module kind listing names document
  local broken="$WORK/$label.broken"
  : > "$broken"
  mkdir -p "$dir"
  for module in $USER_MODULES; do
    for kind in $kinds; do
      if ! listing="$("$MXCLI" -p "$MPR" --json -c "SHOW $kind IN $module" 2>/dev/null)"; then
        echo "SHOW $kind IN $module failed" >> "$broken"; continue
      fi
      if ! names="$(printf '%s' "$listing" | qualified_names)"; then
        echo "SHOW $kind IN $module did not return a JSON list" >> "$broken"; continue
      fi
      while IFS= read -r document; do
        [ -n "$document" ] || continue
        "$MXCLI" describe "${kind%S}" "$document" -p "$MPR" >> "$dir/$module.mdl" 2>/dev/null \
          || echo "describe ${kind%S} $document failed" >> "$broken"
      done <<< "$names"
    done
  done
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

# Only lint errors fail; warnings and info do not.
check_lint() {
  local out code line errors
  out="$("$MXCLI" lint -p "$MPR" 2>&1)"; code=$?
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

# Runs check_mdl.py --skill naming over the described microflows and nanoflows.
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
  out="$("$PY" tools/mdl-checks/check_mdl.py "$WORK/mdl" --skill naming 2>&1)"; code=$?
  checker_verdict "$code" "$out"; gate=$?
  if [ "$gate" = "2" ]; then
    echo "naming: could not run -- check_mdl.py exited $code" > "$WORK/naming.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/naming.detail"
    return 2
  fi
  echo "naming: $(printf '%s\n' "$out" | head -1)" > "$WORK/naming.summary"
  printf '%s\n' "$out" | grep -E '^\s+- ' | head -10 > "$WORK/naming.detail"
  return "$gate"
}

# Sets nav_args: the menu icons (NAV05) and the snippets' buttons (ICON01) always; the Log out and role-home rules (NAV01-NAV03) only
# when project security is on, since only then do users sign in. Returns 1, with the summary
# written, when security is on and the navigation cannot be read.
layout_sign_out_inputs() {
  local level
  level="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | grep -i 'Security Level' | head -1)"
  case "$level" in
    *[Oo]ff*|"")
      # Without sign-in only the icons are checked, and a navigation that cannot be read does not block.
      "$MXCLI" -p "$MPR" -c "DESCRIBE NAVIGATION" > "$WORK/navigation.mdl" 2>/dev/null \
        && nav_args=(--navigation "$WORK/navigation.mdl")
      # Snippets carry buttons too (ICON01); unreadable ones do not block.
      describe_all layout-snippets "$WORK/snippets" "SNIPPETS" || true
      nav_args+=(--sign-out-sources "$WORK/snippets")
      return 0 ;;
  esac
  if ! "$MXCLI" -p "$MPR" -c "DESCRIBE NAVIGATION" > "$WORK/navigation.mdl" 2>/dev/null; then
    echo "layout: could not run -- DESCRIBE NAVIGATION failed" > "$WORK/layout.summary"
    return 1
  fi
  # A sign-out button in a snippet (a shared header, say) also counts; unreadable snippets do not block.
  describe_all layout-snippets "$WORK/snippets" "SNIPPETS" || true
  nav_args=(--navigation "$WORK/navigation.mdl" --sign-out-sources "$WORK/snippets" --users-sign-in)
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
  local -a nav_args=()
  layout_sign_out_inputs || return 2
  # The project's own layouts, for a menu built from buttons (NAV04); unreadable ones do not block.
  describe_all layout-layouts "$WORK/layouts" "LAYOUTS" || true
  ls "$WORK"/layouts/*.mdl >/dev/null 2>&1 && nav_args+=(--layouts "$WORK/layouts")
  # Flows open pages too (`show page` in an ACT_ microflow), for the Back-button rule (BACK01).
  describe_all layout-flows "$WORK/layout-flows" "MICROFLOWS NANOFLOWS" || true
  ls "$WORK"/layout-flows/*.mdl >/dev/null 2>&1 && nav_args+=(--opened-from "$WORK/layout-flows")
  out="$("$PY" tools/mdl-checks/check_layout.py "$WORK/pages" "${nav_args[@]}" 2>&1)"; code=$?
  checker_verdict "$code" "$out"; gate=$?
  if [ "$gate" = "2" ]; then
    echo "layout: could not run -- check_layout.py exited $code" > "$WORK/layout.summary"
    printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -3 > "$WORK/layout.detail"
    return 2
  fi
  echo "layout: $(printf '%s\n' "$out" | head -1)" > "$WORK/layout.summary"
  printf '%s\n' "$out" | grep -E '^\s+[-!] ' | head -12 > "$WORK/layout.detail"
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
  fi
  return "$status"
}

# Starts the five model checks in the background, each through the cache.
start_model_checks() {
  # Upgrading the gate, its config or mxcli must not replay an old pass.
  local -a cache_inputs=(tests/gate.sh tests/gate tools/mdl-checks/gate_helpers.py tests/harness.env "meta:$MXCLI")
  ( run_cached mx       check_mx       "${cache_inputs[@]}" "env:MDL_MXBUILD_PATH=${MDL_MXBUILD_PATH:-}" \
      meta:widgets meta:theme meta:themesource meta:javasource ) &
  ( run_cached lint     check_lint     "${cache_inputs[@]}" .claude/lint-rules ) &
  ( run_cached coverage check_coverage "${cache_inputs[@]}" tests tools/mdl-checks/check_test_coverage.py ) &
  ( run_cached naming   check_naming   "${cache_inputs[@]}" tools/mdl-checks/check_mdl.py ) &
  ( run_cached layout   check_layout   "${cache_inputs[@]}" tools/mdl-checks/check_layout.py ) &
  ( run_cached security check_security "${cache_inputs[@]}" "env:MDL_REQUIRE_PRODUCTION=${MDL_REQUIRE_PRODUCTION:-}" ) &
  echo "== mx check, lint, coverage, naming, layout and security started (they need no app; running while the suite does)"
}

# An app with sign-in is only as safe as its security level: at PROTOTYPE Mendix checks page and
# microflow access and the read/write rights, but IGNORES the XPath constraint on an access rule --
# the row-level rule is stored, passes mx check and lint, and lets every row through. Two sessions
# built customer isolation on rules that did nothing. Production is therefore the level the gate
# requires; MDL_REQUIRE_PRODUCTION=0 in tests/harness.env is for an app that deliberately has no
# users at all.
# Qualified entity names of the project's own modules, one per line. SHOW ENTITIES names its
# column "Entity", not "Qualified Name", so this does not go through qualified_names.
entity_names() {
  local module
  for module in $USER_MODULES; do
    "$MXCLI" -p "$MPR" --json -c "SHOW ENTITIES IN $module" 2>/dev/null | "$PY" -c 'import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
for row in rows if isinstance(rows, list) else []:
    name = row.get("Entity") or row.get("Qualified Name") or row.get("QualifiedName")
    if name:
        print(name)' 2>/dev/null
  done
}

check_security() {
  local level rules entity
  [ "${MDL_REQUIRE_PRODUCTION:-1}" = "0" ] && { echo "security: not checked (MDL_REQUIRE_PRODUCTION=0)" > "$WORK/security.summary"; return 0; }
  level="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null | sed -n 's/^Security Level:[[:space:]]*//p' | head -1)"
  if [ -z "$level" ]; then
    echo "security: could not run -- SHOW PROJECT SECURITY printed no level" > "$WORK/security.summary"
    return 2
  fi
  case "$level" in
    Production*) echo "security: level Production" > "$WORK/security.summary"; return 0 ;;
  esac
  echo "security: level $level, and the gate requires Production" > "$WORK/security.summary"
  : > "$WORK/security.detail"
  # Name the rules that are silently doing nothing, so the cost is concrete.
  rules=0
  for entity in $(entity_names); do
    "$MXCLI" -p "$MPR" -c "DESCRIBE ENTITY $entity" 2>/dev/null | grep -q "where '" || continue
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
    2) details+=("$name|$label (could not run)")
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
}
