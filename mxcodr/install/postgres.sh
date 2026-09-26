# install/postgres.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# PostgreSQL logins and tests/harness.env (how this machine boots the app).

# --- 4. PostgreSQL logins and tests/harness.env ---
# `mxcli run --local` supports only PostgreSQL, with or without Docker.
psql_path() {
  if have psql; then command -v psql; return 0; fi
  local candidate
  # Guard clauses, not `[ -x ] && ...`: a false last statement in a loop aborts under set -e.
  for candidate in "/c/Program Files/PostgreSQL"/*/bin/psql.exe \
                   /opt/homebrew/opt/postgresql@*/bin/psql /usr/lib/postgresql/*/bin/psql; do
    [ -x "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

# Tries the mendix role and the postgres superuser. -w: fail instead of prompting for a password.
postgres_login() {       # echoes "<user>:<password>" for a login that answers
  local psql candidate password host="${MDL_DB_HOST:-127.0.0.1}"
  host="${host%%:*}"
  psql="$(psql_path)" || return 1
  for candidate in "${MDL_DB_USER:-mendix}:${MDL_DB_PASSWORD:-mendix}" \
                   "postgres:${PGPASSWORD:-postgres}" "postgres:" "${USER:-}:"; do
    password="${candidate#*:}"
    PGPASSWORD="$password" "$psql" -w -h "$host" -U "${candidate%%:*}" \
      -d postgres -tAc 'SELECT 1' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

postgres_answers() { postgres_login >/dev/null 2>&1; }

# postgres_ask_superuser -- ask once for a superuser password (never stored) to create the app role.
postgres_ask_superuser() {
  local psql user password host="${MDL_DB_HOST:-127.0.0.1}"
  host="${host%%:*}"
  psql="$(psql_path)" || return 1
  [ -t 0 ] || return 1
  [ "$UI_TTY" = 1 ] || return 1

  ui_clear
  printf '\n  %s%s%s PostgreSQL is running, but none of the usual logins worked.\n' \
    "$C_YELLOW" "$I_WARN" "$C_RESET"
  printf '    Give me a superuser once and I will create the %s%s%s role and this\n' \
    "$C_BOLD" "${MDL_DB_USER:-mendix}" "$C_RESET"
  printf '    project'"'"'s database. The password is used for that one command and is\n'
  printf '    never written to disk.\n\n'
  printf '    Superuser name [postgres]: '
  read -r user
  user="${user:-postgres}"
  printf '    Password for %s (not echoed): ' "$user"
  read -r -s password
  printf '\n\n'

  if ! PGPASSWORD="$password" "$psql" -w -h "$host" -U "$user" \
         -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    ui_note "that $user login was refused -- nothing was changed"
    return 1
  fi

  local wanted="${MDL_DB_USER:-mendix}" wanted_pass="${MDL_DB_PASSWORD:-mendix}"
  PGPASSWORD="$password" "$psql" -w -h "$host" -U "$user" -d postgres \
    -c "CREATE ROLE \"$wanted\" LOGIN PASSWORD '$wanted_pass' CREATEDB" >/dev/null 2>&1 || true
  # The role may exist with another password: reset it.
  PGPASSWORD="$password" "$psql" -w -h "$host" -U "$user" -d postgres \
    -c "ALTER ROLE \"$wanted\" LOGIN PASSWORD '$wanted_pass' CREATEDB" >/dev/null 2>&1 || true

  if PGPASSWORD="$wanted_pass" "$psql" -w -h "$host" -U "$wanted" \
       -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    ui_note "PostgreSQL role $wanted created"
    return 0
  fi
  DEPS_MISSING+=("PostgreSQL -- the $wanted role could not be created; see your server log.")
  return 1
}

# ensure_postgres_role -- create the app role if the login can; print "<user>:<password>" to use.
ensure_postgres_role() {
  local login user password psql host="${MDL_DB_HOST:-127.0.0.1}"
  host="${host%%:*}"
  login="$(postgres_login)" || return 1
  user="${login%%:*}"; password="${login#*:}"
  psql="$(psql_path)" || return 1
  if [ "$user" = "${MDL_DB_USER:-mendix}" ]; then
    printf '%s\n' "$login"; return 0
  fi
  local wanted="${MDL_DB_USER:-mendix}" wanted_pass="${MDL_DB_PASSWORD:-mendix}"
  if PGPASSWORD="$password" "$psql" -w -h "$host" -U "$user" -d postgres \
       -c "CREATE ROLE \"$wanted\" LOGIN PASSWORD '$wanted_pass' CREATEDB" >/dev/null 2>&1; then
    printf '%s:%s\n' "$wanted" "$wanted_pass"; return 0
  fi
  if PGPASSWORD="$wanted_pass" "$psql" -w -h "$host" -U "$wanted" \
       -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    printf '%s:%s\n' "$wanted" "$wanted_pass"; return 0
  fi
  printf '%s\n' "$login"
}

# ignore_credential_files -- gitignore tests/harness.env and credentials.env; make them owner-only.
ignore_credential_files() {
  local entry
  [ -f "$APP/tests/credentials.env" ] && chmod 600 "$APP/tests/credentials.env" 2>/dev/null
  [ -f "$APP/tests/harness.env" ] && chmod 600 "$APP/tests/harness.env" 2>/dev/null
  [ -d "$APP/.git" ] || [ -f "$APP/.gitignore" ] || return 0
  for entry in "tests/harness.env" "tests/credentials.env"; do
    grep -qxF "$entry" "$APP/.gitignore" 2>/dev/null && continue
    printf '%s\n' "$entry" >> "$APP/.gitignore"
  done
  return 0
}

# Rewrites tests/harness.env; sets MDL_DB_USER, MDL_DB_PASSWORD and no_docker_mode.
write_harness_env() {    # write_harness_env <mendix-install-dir>
  local mxbuild="$1" db_name psql login jdk jdk_home=""
  db_name="$(basename "$APP" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]//g')"
  psql="$(psql_path || true)"
  login="$(ensure_postgres_role || true)"
  jdk="$(jdk_find 21 || jdk_find 17 || true)"
  [ -n "$jdk" ] && jdk_home="$(jdk_spacefree_home "$jdk" || true)"
  if [ -n "$login" ]; then
    MDL_DB_USER="${login%%:*}"
    MDL_DB_PASSWORD="${login#*:}"
  fi
  mkdir -p "$APP/tests"
  {
    printf '# Written by install.sh -- how this project is built and run.\n'
    printf '# Read by tests/portable.sh as DATA -- KEY=value, one layer of quotes, no\n'
    printf '# shell. Only the keys it lists are honoured, and this file wins over the\n'
    printf '# environment for them. It holds a database password: keep it out of git.\n'
    printf 'MDL_RUN_MODE=local\n'
    printf 'MDL_NO_DOCKER=1\n'
    [ -n "$mxbuild" ] && printf 'MDL_MXBUILD_PATH="%s"\n' "$mxbuild"
    # mxcli's --db-host needs host:port.
    printf 'MDL_DB_HOST="%s"\n' "${MDL_DB_HOST:-127.0.0.1:5432}"
    printf 'MDL_DB_NAME="%s"\n' "$db_name"
    printf 'MDL_DB_USER="%s"\n' "${MDL_DB_USER:-mendix}"
    printf 'MDL_DB_PASSWORD="%s"\n' "${MDL_DB_PASSWORD:-mendix}"
    [ -n "$psql" ] && [ "$psql" != "psql" ] && printf 'MDL_PSQL="%s"\n' "$psql"
    if [ -n "$jdk_home" ]; then
      printf '\n# The JDK mxcli hands to mxbuild. mxbuild splits its own arguments on\n'
      printf '# spaces, so a path like "C:\\Program Files (Arm)\\zulu21" arrives as four\n'
      printf '# unrecognised arguments and serve mode exits printing usage. This one has\n'
      printf '# no spaces (a junction, created by install.sh).\n'
      printf 'JAVA_HOME="%s"\n' "$jdk_home"
      printf 'export JAVA_HOME\n'
    fi
    if [ "$IS_WINDOWS" = "1" ]; then
      printf '\n# How the gate boots the app. `mxcli run --local` cannot boot on Windows:\n'
      printf '# its liveness probe is os.Process.Signal(0), which Windows rejects for every\n'
      printf '# signal but Kill, so a healthy mxbuild and a healthy runtime both read as\n'
      printf '# "exited during startup". tests/run-app.sh drives mxbuild and the standalone\n'
      printf '# runtime directly instead. Delete this line once a fixed mxcli is installed.\n'
      printf 'MDL_BOOT_COMMAND="bash tests/run-app.sh"\n'
    fi
  } > "$APP/tests/harness.env"
  chmod 600 "$APP/tests/harness.env" 2>/dev/null || true
  ignore_credential_files
  case "$mxbuild" in
    *"/Program Files/Mendix/"*) no_docker_mode="Studio Pro ${mxbuild##*/}" ;;
    *"/Mendix Studio Pro"*)     no_docker_mode="Studio Pro ${mxbuild##*/}" ;;
    *)                          no_docker_mode="mxbuild ${mxbuild##*/}" ;;
  esac
}
