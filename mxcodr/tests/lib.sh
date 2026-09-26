#!/usr/bin/env bash
# lib.sh -- shared helpers for browser tests. A test sources it after its `# covers:` line:
#   source "$(dirname "$0")/lib.sh"
# Rule: ONE scenario per test -- each playwright-cli process costs ~0.6s to start; oql is ~0.03s.
# Exit codes: pass 0, fail() 1, SCRIPT_TIMEOUT 124.
#
# Shell helpers:
#   scenario '<js body>'                 run one browser journey; print its return value as JSON
#   field "$result" <key>                print one value (true/false/null spelled as JSON)
#   fields "$result" <key>...            print several values, one per line
#   oql "<OQL>"                          query the app's database; rows as JSON
#   oql_count <Entity> ["<where>"]       count matching rows of $MODULE.<Entity>
#   oql_value <Entity> <Attr> "<where>"  first match's value ('empty' / 'no-such-row')
#   await_row <Entity> "<where>" [s]     wait up to s seconds (default 8) for a row; 1 if none
#   fail "<message>"                     "FAIL: <message>" on stderr, exit 1
#   release_session                      sign the browser out (gate.sh, end of run)
#
# JS helpers a scenario body can call (open_app, menu, fill, row_action, ...): listed at the
# top of tests/scenario-helpers.js.
#
# Env (all optional):
#   BASE_URL                               app address (default http://localhost:8081)
#   APP_DIR, MPR                           project folder and .mpr (default: folder above tests/)
#   MXCLI, PY                              mxcli and Python (default: tests/portable.sh)
#   TEST_USER, TEST_PASSWORD, CREDENTIALS  sign-in (default: tests/credentials.env)
#   MODULE                                 module for oql_count/oql_value (default: the
#                                          test's `# covers:` module, then MDL_DEFAULT_MODULE)
#   RUNTIME_LOG                            read for licence refusals (default .mxcli/runtime.log)
#   SCRIPT_TIMEOUT                         per-script limit, "90" or "90s"
#   ACTION_TIMEOUT_MS                      wait per browser step (default 8000)
#   KEEP_SESSION, MDL_SESSION_REUSE, FRESH_SESSION  session reuse (section 6)
#   ADMIN_HOST, ADMIN_PORT                 admin API for oql (default localhost:8090)
#
# Sections: 1 Paths  2 Credentials  3 Module  4 fail -- here; the rest in tests/lib/, sourced below:
#   5 Time limit lib/timeout.sh   6 Sessions lib/sessions.sh   7 scenario lib/scenario.sh
#   8 field/fields, 9 Data assertions lib/results.sh

# --- 1. Paths and tools ---
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8081}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
_MDL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MPR="${MPR:-$(cd "$APP_DIR" && ls -1 *.mpr | head -1)}"
# MXCLI and PY come from portable.sh unless already set.
PORTABLE_APP_DIR="$APP_DIR"
. "$(dirname "${BASH_SOURCE[0]}")/portable.sh"

# --- 2. Credentials ---
# From the environment, else tests/credentials.env (TEST_USER=, TEST_PASSWORD=,
# TEST_PASSWORD_<user>=), else none (Security Level: Off).
CREDENTIALS="${CREDENTIALS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/credentials.env}"
if [ -z "${TEST_USER:-}" ] && [ -f "$CREDENTIALS" ]; then
  _user_line="$(grep -E '^TEST_USER=' "$CREDENTIALS" 2>/dev/null | tail -1 || true)"
  TEST_USER="${_user_line#*=}"
fi
TEST_USER="${TEST_USER:-demo_administrator}"
if [ -z "${TEST_PASSWORD:-}" ] && [ -f "$CREDENTIALS" ]; then
  # Read as data, never sourced. -F: TEST_USER is a literal, not a pattern.
  _per_user="$(grep -F -- "TEST_PASSWORD_${TEST_USER}=" "$CREDENTIALS" 2>/dev/null \
    | grep -F -v -e '#' | tail -1 || true)"
  _shared="$(grep -E '^TEST_PASSWORD=' "$CREDENTIALS" 2>/dev/null | tail -1 || true)"
  TEST_PASSWORD="${_per_user#*=}"
  [ -n "$TEST_PASSWORD" ] || TEST_PASSWORD="${_shared#*=}"
  TEST_PASSWORD="${TEST_PASSWORD%\"}"; TEST_PASSWORD="${TEST_PASSWORD#\"}"
fi
TEST_PASSWORD="${TEST_PASSWORD:-}"

# --- 3. Module ---
# MODULE if set; else the module on the test's `# covers:` line (so an app with several modules
# works, and a red-first test runs before the module exists); else the gate's MDL_DEFAULT_MODULE;
# else the project's first own module.
if [ -z "${MODULE:-}" ] && [ -f "${BASH_SOURCE[1]:-}" ]; then
  MODULE="$(sed -nE 's/^#[[:space:]]*covers:[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)\..*/\1/p' \
    "${BASH_SOURCE[1]}" 2>/dev/null | head -1)"
fi
MODULE="${MODULE:-${MDL_DEFAULT_MODULE:-}}"
if [ -z "${MODULE:-}" ]; then
  # `|| true`: under set -e an unreadable module list must not end the test here; oql_count
  # then fails with "needs a module", which says what is missing.
  MODULE="$(mdl_user_modules "$APP_DIR/$MPR" | sed -n 1p)" || true
fi

# --- 4. fail and the runtime log ---
RUNTIME_LOG="${RUNTIME_LOG:-$APP_DIR/.mxcli/runtime.log}"

# Inside $(...) fail ends only that subshell; callers add `|| exit 1`.
# Also noted in a file: a fail inside $(...) (or behind 2>/dev/null) reaches the EXIT trap that way.
fail() {
  _MDL_FAIL_SAID=1
  echo "FAIL: $*" >&2
  [ -z "${_MDL_FAIL_NOTE:-}" ] || printf 'FAIL: %s\n' "$*" > "$_MDL_FAIL_NOTE" 2>/dev/null || true
  exit 1
}

# --- 5-9: tests/lib/, in this order (the time limit and the sessions start as they are read) ---
for _mdl_part in timeout sessions scenario results; do
  [ -f "$_MDL_LIB_DIR/lib/$_mdl_part.sh" ] || fail "tests/lib/$_mdl_part.sh is missing -- re-run the installer"
  # shellcheck source=/dev/null
  . "$_MDL_LIB_DIR/lib/$_mdl_part.sh"
done
unset _mdl_part
