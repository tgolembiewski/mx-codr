#!/usr/bin/env bash
# orient.sh -- app facts at session start: app state, security, tests and coverage, the rulebook,
# navigation, module structure. Run by the agent (or you) once per session.
#   bash tests/orient.sh        (env: APP_PORT, default 8081; MPR when there are several)
# Lookups run in parallel into numbered files. Exit 2 without a .mpr, else 0.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
cd "$APP_DIR"
. "$HARNESS_DIR/portable.sh"
mdl_find_mpr || exit 2
APP_PORT="${APP_PORT:-8081}"
# MDL_DB_RESET=session: the session's database snapshot, before anything it does writes data.
[ -f "$HARNESS_DIR/db-snapshot.sh" ] && bash "$HARNESS_DIR/db-snapshot.sh" take
WORK="$(mdl_tmpdir mdl-orient)"
trap 'rm -rf "$WORK"' EXIT


# --- Sections: each prints its own "== heading" and runs in the background. ---

structure_section() {
  echo "== structure (this app's own modules; System and Atlas are not listed)"
  for module in $(mdl_user_modules "$MPR"); do
    "$MXCLI" -p "$MPR" -c "SHOW STRUCTURE DEPTH 2 IN $module" 2>&1 | head -60
  done
}

security_section() {
  echo "== security"
  "$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>&1 | grep -iE 'security level|demo users|guest|user roles'
  "$MXCLI" -p "$MPR" -c "SHOW USER ROLES" 2>&1 | grep -E '^\|' | head -10
  # Whether a Marketplace module can be installed: known before a feature needs one.
  [ -f tests/marketplace-login.sh ] && bash tests/marketplace-login.sh status | sed 's/^/   /'
}

navigation_section() {
  echo "== navigation"
  "$MXCLI" -p "$MPR" -c "SHOW NAVIGATION HOMES" 2>&1 | head -10
  "$MXCLI" -p "$MPR" -c "SHOW NAVIGATION MENU" 2>&1 | head -15
}

tests_section() {
  local script module
  echo "== tests already here (and what each one covers)"
  for script in tests/verify-*.test.sh; do
    [ -f "$script" ] || continue
    printf '   %-42s %s\n' "$(basename "$script")" \
      "$(grep -m1 '^# covers:' "$script" | sed 's/^# covers: //')"
  done
  echo "== coverage"
  if [ -f tools/mdl-checks/check_test_coverage.cjs ]; then
    # One call for all modules, as the gate and the after-exec hook do: asked one module at a
    # time, a test that covers another module's page is reported as naming something stale.
    # shellcheck disable=SC2046
    "$NODE" tools/mdl-checks/check_test_coverage.cjs . $(mdl_user_modules "$MPR") 2>&1 \
      | grep -E '^(PASS|FAIL|ERROR)' | sed 's/^/   /'
  fi
}

# The rulebook: how many rules, and what the person changed (a level, an exception). mxcli lint
# itself is no longer run here: its advice is read on request (LINT01 in tests/rulebook/).
rulebook_section() {
  [ -d tests/rulebook ] || return 0
  echo "== rulebook (tests/rulebook/<CODE>.md; bash tests/rules.sh)"
  local count changed
  count="$(ls tests/rulebook/[A-Za-z]*.md 2>/dev/null | wc -l | tr -d ' ')"
  if changed="$(mdl_rulebook changes 2>/dev/null)"; then
    echo "   $count rules; changed by the person: ${changed:-none}"
  else
    echo "   $count cards -- $(mdl_rulebook check 2>&1 | tail -1)"
  fi
}

app_section() {
  echo "== app"
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$APP_PORT" 2>/dev/null)" = "200" ]; then
    echo "   running on http://localhost:$APP_PORT"
  else
    echo "   not running -- $MXCLI run --local -p $MPR --app-port $APP_PORT --watch"
  fi
  [ -f tests/credentials.env ] && echo "   tests/credentials.env present (test sign-in configured)"
  [ -d docs/brain ] && echo "   docs/brain/ present -- read project.md before building"
  [ -f tools/mdl-checks/VERSION ] && echo "   harness $(cat tools/mdl-checks/VERSION)"
  mdl_check_mxcli_freshness
  mdl_check_install_freshness
  # A pointer, not the text: sessions pipe this output through `head`, and a digest printed
  # here would be cut there.
  if mdl_syntax_digest; then
    echo "   syntax: $MDL_SYNTAX_DIGEST -- the $(grep -c '^## ' "$MDL_SYNTAX_DIGEST") topics every session otherwise looks up; loaded into the session under Claude Code, Cursor, OpenCode and Pi, elsewhere cat it whole once"
  fi
}

# --- Run them in parallel. The file number sets the print order, not the start order. ---
structure_section  > "$WORK/9-structure"  2>&1 &
security_section   > "$WORK/1-security"   2>&1 &
navigation_section > "$WORK/4-navigation" 2>&1 &
tests_section      > "$WORK/2-tests"      2>&1 &
rulebook_section   > "$WORK/3-rulebook"   2>&1 &
app_section        > "$WORK/0-app"        2>&1 &

wait
# Structure last: it is long, and output piped through `head` must keep the rest.
cat "$WORK"/[0-9]-* 2>/dev/null
