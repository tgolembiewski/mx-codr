# tests/gate/app.sh -- the app the gate tests: is it answering, boot it, stop it, its database.
# Sourced by tests/gate.sh; defines functions only. Entry points: ensure_app, restart_app.

answers() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$1" 2>/dev/null)" = "200" ]; }

# The boot log lines that mean the boot failed (mxcli, mxbuild and the runtime).
boot_error_re() {
  printf '%s' '^Error:|initial build failed|cannot be deployed, because it contains errors|is already in use|exited during startup|BUILD FAILED'
}
# True when the boot log already shows a failure, so the wait loop stops early.
boot_failed() {   # boot_failed <log>
  [ -f "$1" ] || return 1
  grep -qE "$(boot_error_re)" "$1" 2>/dev/null
}

# Prints the error lines, and the indented lines under an `Error:` line: mxbuild lists one build
# error per indented line, and not every one carries a [CE] code ("Invalid token ...").
report_boot_failure() {   # report_boot_failure <log> <waited>
  echo "the app did not start (${2}s): the boot reported an error rather than coming up" >&2
  # A runtime that builds but fails to start says only "See logging output"; the cause is the
  # runtime's own ERROR line, the step logged before it, and the exception's "Caused by".
  awk -v failure="$(boot_error_re)|\\[CE[0-9]+\\]" \
      '/^Error:/ { under = 1; print; next }
       under && /^[[:space:]]+[^[:space:]]/ { print; next }
       { under = 0 }
       / ERROR - / { if (step != "") print step; step = ""; print; next }
       /^Caused by:/ { print; next }
       / INFO - / { step = $0; next }
       $0 ~ failure { print }' "$1" 2>/dev/null \
    | awk '!seen[$0]++' | head -14 >&2
  build_error_hints "$1" >&2
  echo "   full log: $1" >&2
  exit 2
}

# build_error_hints <log> -- the build says where an error is, rarely what: one line per code
# seen, naming the usual cause and the skill that has the syntax.
build_error_hints() {
  mdl_ce_hints "$1"
  # The boot failed because something already holds one of this project's ports. Where it is
  # this project's own leftover -- a runtime that answers nothing but still holds the admin
  # API, an mxbuild left behind by a killed `mxcli run` -- one command clears it, and a
  # session that reads `pgrep`/`kill` first tends to write a wait loop of its own instead.
  if grep -q 'is already in use' "$1" 2>/dev/null; then
    echo "   hint port in use: if it belongs to THIS project (admin API, mxbuild serve, or the app port), stop it with one command and boot again:"
    echo "      bash tests/gate.sh --restart"
    echo "      only a process of ANOTHER project needs: pgrep -af 'mxbuild|runtimelauncher'   then kill that pid"
  fi
  # Builds, then the runtime dies on start with no element named: seen twice from an association to
  # another module whose delete rule carries an (empty) error message that mxcli did not store.
  # The runtime refuses to come up while the after-startup microflow throws or returns false,
  # so every boot dies the same way until that flow is fixed (seen: five in a row).
  if grep -q 'after-startup-action failed' "$1" 2>/dev/null; then
    echo "   hint after-startup: the app will not start until the AfterStartupMicroflow returns true. A seed wired there must be re-runnable (check whether the data is already there) and must never return false -- or take it out of startup (ALTER SETTINGS MODEL AfterStartupMicroflow = '') and call it from a test instead"
  fi
  if grep -q 'NoSuchElementException: None.get' "$1" 2>/dev/null; then
    echo "   hint None.get at startup: usually an association to another module's entity (e.g. to Administration.Account) with a PREVENT/RESTRICT delete rule -- recreate it with ON DELETE SET NULL, exec, then --restart. Do not repair mprcontents by hand"
  fi
}
# Polls $BASE_URL once a second until it answers, then prints how long it took.
# Exits 2 when <log> shows a boot error or BOOT_TIMEOUT seconds pass.
wait_for_boot() {   # wait_for_boot <log>
  local log="$1" waited=0
  until answers "$BASE_URL"; do
    perl -e 'select undef, undef, undef, 1' 2>/dev/null || sleep 1
    waited=$((waited + 1))
    boot_failed "$log" && report_boot_failure "$log" "$waited"
    if [ "$waited" -ge "$BOOT_TIMEOUT" ]; then
      echo "the app did not answer within ${BOOT_TIMEOUT}s; last lines of $log:" >&2
      tail -15 "$log" >&2
      exit 2
    fi
  done
  echo "   up after ${waited}s"
}

# PIDs of this project's runtime and `mxcli run`, matched on the project path; oldest first.
# The path is followed by a separator or the end of the argument, because one project's
# directory is often a prefix of another's: an unanchored match let a --stop in .../InvoiceB2B
# kill the runtime of .../InvoiceB2BOpus5.5, whose deployment path starts with the same text.
project_pids() {
  command -v pgrep >/dev/null 2>&1 || return 0
  { pgrep -f "runtimelauncher.*$(mdl_ere_quote "$APP_DIR")(/|[[:space:]]|$)" 2>/dev/null
    pgrep -f "mxcli(\.exe)? run .*$(mdl_ere_quote "$MPR")([[:space:]]|$)" 2>/dev/null; } | sort -un
}
descendants() {   # every process under <pid>, deepest first
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do descendants "$child"; echo "$child"; done
}
# `mxbuild --serve` processes started in this project's directory: left behind when `mxcli run`
# is killed, they hold port 6543 and make the next boot fail. Needs lsof to read the directory.
orphan_mxbuild_pids() {
  command -v pgrep >/dev/null 2>&1 && command -v lsof >/dev/null 2>&1 || return 0
  local pid dir
  for pid in $(pgrep -f 'mxbuild.* --serve' 2>/dev/null); do
    dir="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    [ -n "$dir" ] && [ "$(cd "$dir" 2>/dev/null && pwd -P)" = "$(cd "$APP_DIR" && pwd -P)" ] && echo "$pid"
  done
}

# Stops this project's app: the runtime, `mxcli run` with everything under it, and orphaned
# mxbuild. SIGTERM, up to 15s for a clean stop, then SIGKILL. Other projects are never touched.
stop_project_app() {
  local victims="" pid waited=0
  if [ "${MDL_RUN_MODE:-}" = "docker" ]; then
    "$MXCLI" docker down -p "$MPR" >/dev/null 2>&1 && echo "   stopped this project's Docker containers" \
      || echo "   nothing of this project was running in Docker"
    return 0
  fi
  for pid in $(project_pids) $(orphan_mxbuild_pids); do
    victims="$victims $(descendants "$pid" | tr '\n' ' ') $pid"
  done
  # A child of `mxcli run` is also found on its own: list each pid once.
  victims="$(printf '%s\n' $victims | awk 'NF && !seen[$0]++' | tr '\n' ' ')"
  if [ -z "${victims// /}" ]; then
    echo "   nothing of this project was running"
    return 0
  fi
  # shellcheck disable=SC2086
  kill -TERM $victims 2>/dev/null || true
  while [ "$waited" -lt 15 ] && [ -n "$(project_pids)$(orphan_mxbuild_pids)" ]; do
    sleep 1; waited=$((waited + 1))
  done
  # shellcheck disable=SC2086
  [ -z "$(project_pids)$(orphan_mxbuild_pids)" ] || kill -KILL $victims 2>/dev/null || true
  echo "   stopped:$(echo $victims)"
}

# Prints the psql to use (MDL_PSQL, PATH, Program Files); returns 1 if none.
psql_binary() {
  if [ -n "${MDL_PSQL:-}" ] && [ -x "$MDL_PSQL" ]; then printf '%s\n' "$MDL_PSQL"; return 0; fi
  if command -v psql >/dev/null 2>&1; then printf 'psql\n'; return 0; fi
  local candidate
  for candidate in "/c/Program Files/PostgreSQL"/*/bin/psql.exe; do
    [ -x "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

ensure_database() {      # the non-container equivalent of --ensure-db
  [ -n "${MDL_DB_NAME:-}" ] || return 0
  local psql
  psql="$(psql_binary)" || {
    echo "   !! no psql found, so the database cannot be checked or created." >&2
    echo "      Install PostgreSQL, or set MDL_PSQL in tests/harness.env." >&2
    return 1
  }
  # MDL_DB_HOST is host:port; psql wants them apart.
  local host="${MDL_DB_HOST:-127.0.0.1:5432}" port user="${MDL_DB_USER:-mendix}"
  port="${host##*:}"; host="${host%%:*}"
  case "$port" in ''|*[!0-9]*) port=5432 ;; esac
  # The name is interpolated into SQL: safe characters only.
  case "$MDL_DB_NAME" in
    ''|*[!A-Za-z0-9_]*)
      echo "   !! MDL_DB_NAME must be letters, digits or underscore; leaving the database alone" >&2
      return 1 ;;
  esac
  # PGPASSWORD is given per call, never exported to the tests and checkers.
  local pass="${MDL_DB_PASSWORD:-mendix}"
  if PGPASSWORD="$pass" "$psql" -w -h "$host" -p "$port" -U "$user" -d postgres -tAc \
       "SELECT 1 FROM pg_database WHERE datname='$MDL_DB_NAME'" 2>/dev/null | grep -q 1; then
    return 0
  fi
  echo "   creating database $MDL_DB_NAME"
  PGPASSWORD="$pass" "$psql" -w -h "$host" -p "$port" -U "$user" -d postgres \
    -c "CREATE DATABASE \"$MDL_DB_NAME\"" >/dev/null 2>&1
}

# --restart: stop this project's app so ensure_app boots it again.
# Kill the whole tree under `mxcli run`: TERM on mxcli alone orphans mxbuild and Java.
restart_app() {
  echo "== restarting this project's app"
  stop_project_app
  sleep 1
  # Whatever answered belonged to the old runtime; do not adopt it.
  BASE_URL=""
}

# Finds the app on $APP_PORT or 8080; with --boot-if-needed boots it (MDL_BOOT_COMMAND, else
# `mxcli run --local --watch`); otherwise exits 2 saying how to start it. Sets BASE_URL.
ensure_app() {
  find_running_app && return 0
  [ "$BOOT" = "1" ] || explain_no_app
  # Nothing answers, yet this project still has processes: a half-dead run of its own. It can
  # still hold the admin API or mxbuild's port while the app port is free, and the boot then
  # dies on "is already in use" with the app left down. Stop them first -- what --restart does.
  if [ -n "$(project_pids)$(orphan_mxbuild_pids)" ]; then
    echo "   !! nothing answers, but this project still has processes running -- stopping them first (what --restart does)"
    stop_project_app
    sleep 1
  fi
  # An orphaned `mxbuild --serve` of ANOTHER project holds port 6543 and makes the boot fail.
  if [ "${MDL_RUN_MODE:-}" != "docker" ] && command -v pgrep >/dev/null 2>&1 && pgrep -f 'mxbuild' >/dev/null 2>&1; then
    echo "   !! an mxbuild process is already running. If this boot fails on"
    echo "      'port 6543 (mxbuild serve) is already in use', it is an orphan:"
    echo "      pgrep -af 'mxbuild|runtimelauncher'   then kill that pid"
  fi
  # MDL_BOOT_COMMAND replaces `mxcli run --local` where that cannot boot (Windows).
  if [ -n "${MDL_BOOT_COMMAND:-}" ]; then
    boot_with_command
  else
    boot_with_mxcli_run
  fi
}

# True when BASE_URL (else $APP_PORT, then 8080) answers; sets BASE_URL to the one that did.
find_running_app() {
  local candidate
  if [ -z "${BASE_URL:-}" ]; then
    for candidate in "http://localhost:$APP_PORT" http://localhost:8080; do
      answers "$candidate" && { BASE_URL="$candidate"; break; }
    done
  fi
  [ -n "${BASE_URL:-}" ] && answers "$BASE_URL"
}

# No app and no --boot-if-needed: say how to start one, exit 2.
explain_no_app() {
  cat >&2 <<MSG
no app answering on ${BASE_URL:-http://localhost:$APP_PORT or :8080}. Start it, ideally with
hot reload so page and microflow changes need no restart:

  ${MDL_BOOT_COMMAND:-$MXCLI run --local -p $MPR --app-port $APP_PORT --watch}

or re-run this with --boot-if-needed.
MSG
  exit 2
}

# The boot log is emptied for each boot (see boot_with_command); the previous one is kept, so a
# failure that a later boot overwrote can still be read: .mxcli/gate-boot.prev.log.
mdl_rotate_boot_log() {
  [ -s .mxcli/gate-boot.log ] && cp .mxcli/gate-boot.log .mxcli/gate-boot.prev.log 2>/dev/null
  : > .mxcli/gate-boot.log
}

boot_with_command() {
  echo "== no app answering; booting with MDL_BOOT_COMMAND"
  ensure_database || true
  echo "   running: $MDL_BOOT_COMMAND"
  # `( cmd & )` detaches the app: `wait` does not block on it and it outlives the gate. The
  # redirect truncates the log only once that subshell runs, so empty it here: for the first
  # second the wait loop would otherwise read the PREVIOUS boot's errors and report this boot
  # as failed after 1s, with the old failure as its reason.
  mkdir -p .mxcli && mdl_rotate_boot_log
  ( bash -c "$MDL_BOOT_COMMAND" > .mxcli/gate-boot.log 2>&1 & )
  BASE_URL="http://localhost:$APP_PORT"
  wait_for_boot .mxcli/gate-boot.log
}

# Default boot: `mxcli run --local --watch` (hot reload).
boot_with_mxcli_run() {
  local -a boot_args=(run --local -p "$MPR" --app-port "$APP_PORT" --watch)
  echo "== no app answering; booting $MPR on port $APP_PORT with hot reload"
  # A second app on this machine needs its own admin and mxbuild ports.
  [ -n "${ADMIN_PORT:-}" ] && boot_args+=(--admin-port "$ADMIN_PORT")
  [ -n "${SERVE_PORT:-}" ] && boot_args+=(--serve-port "$SERVE_PORT")
  if [ -n "${MDL_DB_NAME:-}" ]; then
    ensure_database || true
    boot_args+=(--db-name "$MDL_DB_NAME")
    [ -n "${MDL_DB_HOST:-}" ] && boot_args+=(--db-host "$MDL_DB_HOST")
    [ -n "${MDL_DB_USER:-}" ] && boot_args+=(--db-user "$MDL_DB_USER")
    [ -n "${MDL_DB_PASSWORD:-}" ] && boot_args+=(--db-password "$MDL_DB_PASSWORD")
  else
    # A fresh project has no database; --ensure-db creates it only when missing.
    boot_args+=(--ensure-db)
  fi
  # Empty the log first; see boot_with_command for why.
  mkdir -p .mxcli && mdl_rotate_boot_log
  ( "$MXCLI" "${boot_args[@]}" > .mxcli/gate-boot.log 2>&1 & )
  BASE_URL="http://localhost:$APP_PORT"
  wait_for_boot .mxcli/gate-boot.log
}
