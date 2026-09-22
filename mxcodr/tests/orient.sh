#!/usr/bin/env bash
# orient.sh -- app facts at session start: app state, security, tests and coverage, lint,
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
  if [ -f tools/mdl-checks/check_test_coverage.py ]; then
    for module in $(mdl_user_modules "$MPR"); do
      printf '   %-20s %s\n' "$module" "$("$PY" tools/mdl-checks/check_test_coverage.py . "$module" 2>&1 | tail -1)"
    done
  fi
}

lint_section() {
  local lint
  echo "== lint (the project's own rules included)"
  lint="$("$MXCLI" lint -p "$MPR" 2>&1)"
  printf '%s\n' "$lint" | tail -1
  printf '%s\n' "$lint" | grep -oE '\[(MOD001|REU001|SEC00[0-9]|ARCH00[0-9])\]' | sort | uniq -c | head -8
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
}

# --- Run them in parallel. The file number sets the print order, not the start order. ---
structure_section  > "$WORK/9-structure"  2>&1 &
security_section   > "$WORK/1-security"   2>&1 &
navigation_section > "$WORK/4-navigation" 2>&1 &
tests_section      > "$WORK/2-tests"      2>&1 &
lint_section       > "$WORK/3-lint"       2>&1 &
app_section        > "$WORK/0-app"        2>&1 &

wait
# Structure last: it is long, and output piped through `head` must keep the rest.
cat "$WORK"/[0-9]-* 2>/dev/null
