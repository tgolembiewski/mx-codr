# tests/gate/security.sh -- the security step: the Production level and VIEW01 (security_level), the rules (security_rules)
# Sourced by tests/gate.sh after checks.sh (the runner, step_run and the shared describe helpers); defines functions only.

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
  local status
  : > "$WORK/security.summary"
  step_run security "security rules" security_rules.cjs copy; status=$?
  [ "$status" = "3" ] && { : > "$WORK/security.summary"; return 0; }
  [ "$status" = "0" ] || return "$status"
  step_verdict security "security rules" 'PASS|FAIL' || return 2
  step_findings_file security
  step_warnings security 8 "security warnings"
  [ "$STEP_CODE" = "0" ] && return 0
  {
    printf '%s\n' "$STEP_OUT" | grep '^  - ' | sed 's/^  /   /'
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
