#!/usr/bin/env bash
# diagnose.sh -- state facts for a red test: security, row counts, live sessions, runtime
# errors, and optionally one entity's access and one user's roles. Changes nothing.
#   bash tests/diagnose.sh [Entity] [user]    (pass "" as Entity to skip it)
# Env: RUNTIME_LOG, ADMIN_PORT (8090), ADMIN_PASSWORD, APP_PORT, MPR. Exit 2 without a .mpr, else 0.
# Lookups run in parallel into numbered files; no set -e so one failure doesn't stop the rest.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
cd "$APP_DIR"
. "$HARNESS_DIR/portable.sh"
mdl_find_mpr || exit 2
ENTITY="${1:-}"
USER_NAME="${2:-}"
RUNTIME_LOG="${RUNTIME_LOG:-$APP_DIR/.mxcli/runtime.log}"
WORK="$(mdl_tmpdir mdl-diagnose)"
trap 'rm -rf "$WORK"' EXIT


# --- Sections: each prints its own "== heading" and runs in the background. ---

security_section() {
  echo "== security"
  "$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>&1 | grep -iE 'security level|demo users|guest|admin user'
  "$MXCLI" -p "$MPR" -c "SHOW DEMO USERS" 2>&1 | grep -E '^\|' | head -12
}

# The persistent entities of one module, one qualified name per line.
persistent_entities() {   # persistent_entities <module>
  "$MXCLI" -p "$MPR" --json -c "SHOW ENTITIES IN $1" 2>/dev/null \
    | "$PY" -c 'import json,sys
for row in json.load(sys.stdin):
    name = row.get("Entity") or ""
    if name and "non-persistent" not in (row.get("Type") or "").lower():
        print(name)' 2>/dev/null
}

# The row count of one entity; "?" when the answer has no count, 0 when unreadable.
row_count() {   # row_count <Module.Entity>
  # Quoted: an entity named Order (a reserved word) does not parse bare, and printed a false 0.
  "$MXCLI" oql -p "$MPR" --json "SELECT COUNT(*) AS n FROM ${1%.*}.\"${1##*.}\"" 2>/dev/null \
    | "$PY" -c '
import json, sys
text = sys.stdin.read()
start = text.find("[")
try:
    rows, _ = json.JSONDecoder().raw_decode(text[start:])
except Exception:
    rows = []
print(rows[0].get("n", "?") if rows else 0)
'
}

rows_section() {
  local probe module entity count
  echo "== rows in the database"
  # OQL needs the runtime: with the app down, counts would read as missing data.
  probe="$("$MXCLI" oql -p "$MPR" --json "SELECT COUNT(*) AS n FROM System.User" 2>&1)"
  case "$probe" in
    *'"n"'*) ;;
    *) echo "   the runtime is not answering, so row counts are unavailable"
       echo "   (start it: $MXCLI run --local -p $MPR --app-port ${APP_PORT:-8081} --watch)"
       return 0 ;;
  esac
  for module in $(mdl_user_modules "$MPR"); do
    persistent_entities "$module" | while read -r entity; do
      count="$(row_count "$entity")"
      printf "   %-40s %s\n" "$entity" "${count:-?}"
    done
  done
  printf "   %-40s %s\n" "System.User" "$("$MXCLI" oql -p "$MPR" --json "SELECT Name FROM System.User" 2>/dev/null | grep -c '"Name"')"
}

sessions_section() {
  local refusals
  echo "== live sessions (a developer/trial licence caps them)"
  curl -s -m 5 -X POST "http://localhost:${ADMIN_PORT:-8090}/" \
    -H "X-M2EE-Authentication: $(printf '%s' "${ADMIN_PASSWORD:-mxcli-local-dev}" | base64)" \
    -H 'Content-Type: application/json' -d '{"action":"get_logged_in_user_names"}' 2>/dev/null \
    | "$PY" -c 'import json,sys
try:
    f=json.load(sys.stdin)["feedback"]
    print("   signed in: %s (%s)" % (", ".join(f.get("users") or []) or "nobody", f.get("count", 0)))
except Exception:
    print("   admin port did not answer")' 2>/dev/null
  if [ -f "$RUNTIME_LOG" ]; then
    refusals="$(current_run_log | tail -400 | grep -c 'Maximum number of sessions exceeded')"
    [ "$refusals" != "0" ] && echo "   session-cap refusals in the last 400 log lines: $refusals"
  fi
}

# The runtime log since its last "=== runtime start" marker (the whole log when it has none).
current_run_log() {
  awk '/^=== runtime start /{n=0; delete kept; next} {kept[++n]=$0} END{for (i=1; i<=n; i++) print kept[i]}' "$RUNTIME_LOG"
}

errors_section() {
  echo "== last runtime errors (since the runtime last started)"
  if [ -f "$RUNTIME_LOG" ]; then
    current_run_log | grep -E ' (ERROR|CRITICAL) ' | tail -5 | cut -c1-160
  else
    echo "   no runtime log at $RUNTIME_LOG"
  fi
}

access_section() {
  local module
  echo "== access on $ENTITY (row-level XPath is what hides rows from a role)"
  for module in $(mdl_user_modules "$MPR"); do
    "$MXCLI" -p "$MPR" -c "SHOW ACCESS ON ENTITY $module.$ENTITY" 2>/dev/null | head -25
  done
  echo "== associations of $ENTITY (a missing link looks exactly like a missing row)"
  for module in $(mdl_user_modules "$MPR"); do
    "$MXCLI" -p "$MPR" -c "SHOW ASSOCIATIONS IN $module" 2>/dev/null | grep -i "$ENTITY" | head -10
  done
}

user_section() {
  echo "== $USER_NAME"
  # The query's second line is indented as it always was: the text reaches mxcli as typed.
  "$MXCLI" oql -p "$MPR" --json \
    "SELECT u/Name AS UserName, r/Name AS RoleName FROM System.User AS u
       JOIN u/System.UserRoles/System.UserRole AS r WHERE u/Name = '$USER_NAME'" 2>&1 | head -20
}

# --- Run them in parallel. The file number sets the print order. ---
security_section > "$WORK/1-security" 2>&1 &
rows_section     > "$WORK/2-rows"     2>&1 &
sessions_section > "$WORK/3-sessions" 2>&1 &
errors_section   > "$WORK/4-errors"   2>&1 &
if [ -n "$ENTITY" ]; then
  access_section > "$WORK/5-access"   2>&1 &
fi
if [ -n "$USER_NAME" ]; then
  user_section   > "$WORK/6-user"     2>&1 &
fi

wait
cat "$WORK"/[0-9]-* 2>/dev/null

# Last, as it is usually silent: a half-written or locked local database.
mdl_check_local_database
