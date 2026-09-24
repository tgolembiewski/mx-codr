#!/usr/bin/env bash
# install.sh -- install the mx-codr harness (skills, lint rules, checkers, hooks, tests/gate.sh)
# into a Mendix project, creating the app when there is none. Safe to re-run.
#
# Usage: bash install.sh [project-dir] [--no-app] [--with-deps] [-h|--help]
#   Run it from the project folder, one level above the bundle:  cd <app> && bash mxcodr/install.sh
#   (not from inside mxcodr/ -- that still works, but the target is then guessed, not named).
#   --no-app     never create a Mendix app; stop when there is no .mpr
#   --with-deps  install missing prerequisites (winget/brew/apt/dnf); otherwise only reported
#   No dir: the current directory, or the project the bundle sits in when run from inside it.
# Env: MX_VERSION, APP_NAME (new app); MDL_ASSUME_YES=1; MDL_DEPS_DRY_RUN=1 (print installs only);
#   MDL_NO_UPDATE_CHECK=1; MXCLI_TAG, MXCLI_SHA256; MDL_DB_HOST, MDL_DB_USER, MDL_DB_PASSWORD,
#   PGPASSWORD; DOCKER_WAIT, DOCKER_PROBE_TIMEOUT (seconds); NO_COLOR.
# Exit: 0 installed; 1 ui_fail (bad argument, no project, no Python, app creation failed);
#   other non-zero = unexpected command failure. Missing prerequisites do not fail the install.
#
# Sections 1-9b define functions; the install runs from section 10 on (create_app is defined in 12).
#   Constants
#   1. Platform and Python
#   2. Terminal output (ui_*)
#   3. Prerequisite helpers
#   4. PostgreSQL and harness.env
#   5. Docker
#   6. Windows repairs (junctions)
#   7. mxcli: download and update
#   8. Finding Studio Pro (Windows)
#   9. Playwright browser and JDK
#   9b. Prerequisite step helpers
#   10. Arguments and the target project
#   11. Step: prerequisites
#   12. Step: create the Mendix app
#   13. Step: skills, lint rules, checkers, rule
#   14. Step: hooks for Claude, Codex, Cursor, OpenCode
#   15. Step: the test harness
#   16. Step: record the install, check environment
#   17. Summary

set -euo pipefail

# --- Constants ---
DEFAULT_MX_VERSION="11.12.1"               # Mendix version for a new app when MX_VERSION is unset
PLAYWRIGHT_CLI_PACKAGE="@playwright/cli@0.1.15"   # pinned to the devcontainer's version
DEFAULT_DOCKER_WAIT=180                    # seconds to wait for the Docker daemon (DOCKER_WAIT)
UI_BAR_WIDTH=24                            # progress bar width, in characters
UI_SUB_EXPECTED=6                          # sub-steps expected inside one step, for the bar

# --- 1. Platform and Python ---
# On Windows (Git Bash) python3 may be a Store stub, so each Python candidate is run before use.
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1; EXE=".exe" ;;
  *)                    IS_WINDOWS=0; EXE="" ;;
esac

# mdl_find_python -- print the first Python 3 that really runs; return 1 if none.
mdl_find_python() {
  local candidate
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  # winget's python.org install is often not on PATH; search the install dirs too.
  local local_app="${LOCALAPPDATA:-}"
  local_app="${local_app//\\//}"
  for candidate in \
      "$local_app/Programs/Python"/Python3*/python.exe \
      "$local_app/Programs/Python/Launcher/py.exe" \
      "/c/Program Files"/Python3*/python.exe \
      "/c/Program Files (x86)"/Python3*/python.exe; do
    [ -x "$candidate" ] || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

PY="$(mdl_find_python || true)"
# Not fatal: with --with-deps the prerequisites step installs Python and re-probes.

# --- 2. Terminal output: colours, icons, progress bar ---
# Output only. Plain lines when not a TTY, ASCII icons without UTF-8.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  UI_TTY=1
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_BLUE=$'\033[38;5;39m'; C_CYAN=$'\033[38;5;44m'; C_GREEN=$'\033[38;5;42m'
  C_YELLOW=$'\033[38;5;214m'; C_RED=$'\033[38;5;203m'; C_GREY=$'\033[38;5;245m'
else
  UI_TTY=0
  C_RESET=""; C_BOLD=""; C_DIM=""
  C_BLUE=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_GREY=""
fi

case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8*|*utf8*|*UTF8*) UI_UNICODE=1 ;;
  *) UI_UNICODE=0 ;;
esac

if [ "$UI_UNICODE" = 1 ]; then
  I_OK="✔"; I_WARN="!"; I_FAIL="✘"; I_DOT="·"; I_ARROW="→"; I_PLAY="▶"; I_BOX="▪"
  BAR_FULL="█"; BAR_EMPTY="░"
else
  I_OK="+"; I_WARN="!"; I_FAIL="x"; I_DOT="-"; I_ARROW="->"; I_PLAY=">"; I_BOX="*"
  BAR_FULL="#"; BAR_EMPTY="."
fi

ui_banner() {
  local version="$1"
  # Terminals narrower than 62 columns get plain words instead of the wordmark.
  if [ "$UI_UNICODE" = 1 ] && [ "${UI_COLS:-80}" -ge 62 ]; then
    printf '\n'
    printf '%s  ███╗   ███╗██╗  ██╗       ██████╗ ██████╗ ██████╗ ██████╗ %s\n' "$C_BLUE" "$C_RESET"
    printf '%s  ████╗ ████║╚██╗██╔╝      ██╔════╝██╔═══██╗██╔══██╗██╔══██╗%s\n' "$C_BLUE" "$C_RESET"
    printf '%s  ██╔████╔██║ ╚███╔╝ █████╗██║     ██║   ██║██║  ██║██████╔╝%s\n' "$C_CYAN" "$C_RESET"
    printf '%s  ██║╚██╔╝██║ ██╔██╗ ╚════╝██║     ██║   ██║██║  ██║██╔══██╗%s\n' "$C_CYAN" "$C_RESET"
    printf '%s  ██║ ╚═╝ ██║██╔╝ ██╗      ╚██████╗╚██████╔╝██████╔╝██║  ██║%s\n' "$C_CYAN" "$C_RESET"
    printf '%s  ╚═╝     ╚═╝╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝%s\n' "$C_CYAN" "$C_RESET"
    printf '\n  %sversion:%s %s\n\n' "$C_BOLD" "$C_RESET" "$version"
  else
    printf '\n  %smx-codr%s  %s\n' "$C_BOLD" "$C_RESET" "$version"
    printf '  mxcli %s MDL skills, lint rules, hooks and the delivery gate\n\n' "$I_DOT"
  fi
}

# The bar counts whole steps, fixed up front; app creation adds sub-progress inside its step.
UI_COLS="${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}"
[ "$UI_COLS" -ge 40 ] 2>/dev/null || UI_COLS=80
UI_TOTAL=1
UI_STEP=0
UI_LABEL=""
UI_SUB_SEEN=0

# ui_plan <steps> -- set how many steps the bar is divided into (called once).
ui_plan() { UI_TOTAL="$1"; }

# ui_pct -- print the percentage: done steps plus sub-progress, capped inside the current step.
ui_pct() {
  local span=$(( 100 / UI_TOTAL ))
  local base=$(( UI_STEP * 100 / UI_TOTAL ))
  local inside=0 cap=$(( span * 9 / 10 ))   # sub-progress never fills more than 90% of a step
  if [ "$UI_SUB_SEEN" -gt 0 ]; then
    inside=$(( span * UI_SUB_SEEN / UI_SUB_EXPECTED ))
    [ "$inside" -gt "$cap" ] && inside="$cap"
  fi
  echo $(( base + inside ))
}

# ui_bar -- redraw the progress bar in place (TTY only).
ui_bar() {
  [ "$UI_TTY" = 1 ] || return 0
  local pct width="$UI_BAR_WIDTH" filled i bar=""
  pct="$(ui_pct)"
  filled=$(( pct * width / 100 ))
  i=0
  while [ "$i" -lt "$width" ]; do
    if [ "$i" -lt "$filled" ]; then bar="$bar$BAR_FULL"; else bar="$bar$BAR_EMPTY"; fi
    i=$(( i + 1 ))
  done
  local label="$UI_LABEL" max=$(( UI_COLS - width - 11 ))
  [ "$max" -lt 8 ] && max=8
  if [ "${#label}" -gt "$max" ]; then label="${label:0:$(( max - 1 ))}~"; fi
  printf '\r\033[K  %s%s%s  %s%3s%%%s  %s%s%s' \
    "$C_BLUE" "$bar" "$C_RESET" "$C_BOLD" "$pct" "$C_RESET" "$C_GREY" "$label" "$C_RESET"
}

# ui_clear -- wipe the bar's line. Explicit return 0 so a false test does not trip set -e.
ui_clear() { [ "$UI_TTY" = 1 ] && printf '\r\033[K'; return 0; }

ui_begin() {           # ui_begin "label"
  UI_LABEL="$1"
  UI_SUB_SEEN=0
  [ "$UI_TTY" = 1 ] || printf '  %s %s\n' "$I_DOT" "$1"
  ui_bar
}

ui_sub() {             # ui_sub "phase name" -- transient detail inside a step
  UI_SUB_SEEN=$(( UI_SUB_SEEN + 1 ))
  if [ "$UI_TTY" = 1 ]; then
    UI_LABEL="${UI_LABEL%% $I_DOT *} $I_DOT $1"
    ui_bar
  else
    printf '     %s %s\n' "$I_DOT" "$1"
  fi
}

ui_tick() {            # progress without a new label: the tool is still working
  UI_SUB_SEEN=$(( UI_SUB_SEEN + 1 ))
  ui_bar
}

ui_done() {            # ui_done "label" "detail"
  UI_STEP=$(( UI_STEP + 1 ))
  UI_SUB_SEEN=0
  ui_clear
  if [ -n "${2:-}" ]; then
    printf '  %s%s%s %-26s %s%s%s\n' "$C_GREEN" "$I_OK" "$C_RESET" "$1" "$C_GREY" "$2" "$C_RESET"
  else
    printf '  %s%s%s %s\n' "$C_GREEN" "$I_OK" "$C_RESET" "$1"
  fi
  UI_LABEL=""
  ui_bar
}

ui_note() {            # a fact worth keeping on screen, not a step
  ui_clear
  printf '  %s%s%s %s\n' "$C_YELLOW" "$I_WARN" "$C_RESET" "$1"
  ui_bar
}

ui_fail() {            # print every argument as its own line, then die
  ui_clear
  printf '  %s%s%s %s%s%s\n' "$C_RED" "$I_FAIL" "$C_RESET" "$C_BOLD" "$1" "$C_RESET" >&2
  shift
  while [ "$#" -gt 0 ]; do printf '    %s\n' "$1" >&2; shift; done
  printf '\n' >&2
  exit 1
}

ui_head() {            # section heading in the summary
  printf '\n  %s%s %s%s\n' "$C_BOLD" "$1" "$2" "$C_RESET"
}

ui_row() {             # ui_row "what" "count" "where" -- summary line
  printf '     %s%-10s%s %s%3s%s  %s\n' "$C_CYAN" "$1" "$C_RESET" "$C_BOLD" "$2" "$C_RESET" "$3"
}

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="$(cat "$SRC/VERSION")"

# --- 3. Prerequisite helpers: detect a tool, then install it or report it ---
# The JDK is only reported (may need a reboot or licence click); Docker is installed when missing.
DEPS_INSTALLED=0
DEPS_MISSING=()          # human lines, printed in the summary rather than mid-step

have() { command -v "$1" >/dev/null 2>&1; }

pkg_manager() {
  if [ "$IS_WINDOWS" = "1" ]; then have winget && { echo winget; return 0; }; fi
  have brew   && { echo brew;   return 0; }
  have apt-get && { echo apt;   return 0; }
  have dnf    && { echo dnf;    return 0; }
  echo ""
}

# Root in a container has no sudo; a normal user outside one needs it.
SUDO=""
if [ "$(id -u 2>/dev/null || echo 0)" != "0" ] && have sudo; then SUDO="sudo "; fi

dep_run() {              # dep_run "<shell command>" -- honours the dry run
  if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    ui_note "would run: $1"
    return 0
  fi
  # DEPS_LOG is set in section 11.
  eval "$1" >>"$DEPS_LOG" 2>&1
}

# dep_apply <label> <detect> <install> -- install unless detected; 0 if present afterwards. Never aborts.
dep_apply() {
  local label="$1" detect="$2" command="$3"
  eval "$detect" >/dev/null 2>&1 && return 0

  if [ "$WITH_DEPS" = "0" ] || [ -z "$command" ]; then
    DEPS_MISSING+=("$label -- ${command:-no package manager found; install it by hand}")
    return 1
  fi

  ui_sub "installing $label"
  if dep_run "$command" && { [ -n "${MDL_DEPS_DRY_RUN:-}" ] || eval "$detect" >/dev/null 2>&1; }; then
    DEPS_INSTALLED=$(( DEPS_INSTALLED + 1 ))
    return 0
  fi
  DEPS_MISSING+=("$label -- $command  (tried, and it did not take; see $DEPS_LOG)")
  return 1
}

# dep_need <label> <detect> <winget-id> <brew> <apt/dnf> -- build this machine's install command, then dep_apply.
dep_need() {
  local command=""
  case "$(pkg_manager)" in
    winget) command="winget install -e --accept-package-agreements --accept-source-agreements --id $3" ;;
    brew)   command="brew install $4" ;;
    apt)    command="${SUDO}apt-get update -qq && ${SUDO}apt-get install -y $5" ;;
    dnf)    command="${SUDO}dnf install -y $5" ;;
  esac
  dep_apply "$1" "$2" "$command"
}

# docker_ready -- true when the daemon answers; time-boxed because `docker info` hangs while Docker starts.
docker_ready() {
  have docker || return 1
  if have timeout; then
    timeout "${DOCKER_PROBE_TIMEOUT:-8}" docker info >/dev/null 2>&1
  else
    docker info >/dev/null 2>&1
  fi
}

# ask "<prompt>" <y|n> -- MDL_ASSUME_YES answers yes (the app-creation guard does not use ask).
ask() {
  local question="$1" default="$2" reply
  if [ -n "${MDL_ASSUME_YES:-}" ]; then
    printf '%syes  %s(MDL_ASSUME_YES)%s\n' "$question" "$C_GREY" "$C_RESET"
    return 0
  fi
  printf '%s' "$question"
  read -r reply
  case "${reply:-$default}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

docker_install_command() {
  case "$(pkg_manager)" in
    winget) echo "winget install -e --accept-package-agreements --accept-source-agreements --id Docker.DockerDesktop" ;;
    brew)   echo "brew install --cask docker" ;;
    apt)    echo "${SUDO}apt-get update -qq && ${SUDO}apt-get install -y docker.io" ;;
    dnf)    echo "${SUDO}dnf install -y docker" ;;
  esac
}

# docker_start_command -- start Docker detached: Docker Desktop in the foreground never returns.
docker_start_command() {
  if [ "$IS_WINDOWS" = "1" ]; then
    local program_files="${PROGRAMFILES:-C:\\Program Files}"
    echo "cmd //c start \"\" \"${program_files//\\//}/Docker/Docker/Docker Desktop.exe\""
  elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    echo "open -a Docker"
  else
    echo "${SUDO}systemctl start docker"
  fi
}

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

# --- 5. Docker: install, start, wait for the daemon ---
# docker_walkthrough -- install and start Docker, wait for it, say what is left to do by hand.
docker_walkthrough() {
  local command
  command="$(docker_install_command)"
  if [ -z "$command" ]; then
    DEPS_MISSING+=("Docker -- no package manager here; install Docker Desktop by hand")
    return 1
  fi

  ui_clear
  printf '\n  %s%s%s Docker is not installed. Installing it.\n' "$C_YELLOW" "$I_WARN" "$C_RESET"
  printf '    Running:  %s%s%s\n\n' "$C_CYAN" "$command" "$C_RESET"
  ui_sub "installing Docker (this is a large download)"
  if ! dep_run "$command"; then
    ui_clear
    printf '  %s%s%s The install command failed. Its output:\n' "$C_RED" "$I_FAIL" "$C_RESET"
    tail -8 "$DEPS_LOG" 2>/dev/null | sed 's/^/      /'
    DEPS_MISSING+=("Docker -- install failed, see $DEPS_LOG")
    return 1
  fi
  DEPS_INSTALLED=$(( DEPS_INSTALLED + 1 ))

  # Installed is not running: Docker Desktop needs a first launch and licence acceptance.
  ui_clear
  printf '  %s%s%s Docker is installed. Three things it still needs from you:\n\n' "$C_GREEN" "$I_OK" "$C_RESET"
  if [ "$IS_WINDOWS" = "1" ]; then
    printf '      1. Start Docker Desktop from the Start menu.\n'
  else
    printf '      1. Start Docker.  %s%s%s\n' "$C_GREY" "$(docker_start_command)" "$C_RESET"
  fi
  printf '      2. Accept its licence the first time it opens.\n'
  if [ "$IS_WINDOWS" = "1" ]; then
    printf '      3. Let it enable the WSL2 backend when it asks. A reboot may be needed;\n'
    printf '         if so, reboot and re-run this installer -- it will pick up where it left off.\n'
  else
    printf '      3. Wait for the whale in the menu bar to stop animating.\n'
  fi
  printf '\n'

  if [ "$IS_WINDOWS" = "1" ] || [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    # Detached and time-boxed so a launcher that stays in the foreground cannot hang the install.
    ui_sub "starting Docker Desktop"
    ( dep_run "$(docker_start_command)" || true ) >/dev/null 2>&1 &
    sleep 2
  fi

  if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    ui_note "would wait here for the Docker daemon to answer"
    return 0
  fi

  # Ctrl-C stops only the waiting; the install continues.
  local stop_waiting=0
  trap 'stop_waiting=1' INT
  printf '    Waiting for the Docker daemon (Ctrl-C to stop waiting) '
  local waited=0
  while [ "$waited" -lt "${DOCKER_WAIT:-$DEFAULT_DOCKER_WAIT}" ] && [ "$stop_waiting" = "0" ]; do
    if docker_ready; then
      trap - INT
      printf '\n'
      ui_clear
      printf '  %s%s%s Docker is up.\n\n' "$C_GREEN" "$I_OK" "$C_RESET"
      return 0
    fi
    printf '.'
    sleep 3
    waited=$(( waited + 3 ))
  done
  trap - INT
  printf '\n'
  if [ "$stop_waiting" = "1" ]; then
    DEPS_MISSING+=("Docker -- installed; you stopped waiting for the daemon. When it is up: docker info")
    return 1
  fi
  DEPS_MISSING+=("Docker -- installed, but the daemon did not answer within ${DOCKER_WAIT:-$DEFAULT_DOCKER_WAIT}s.")
  DEPS_MISSING+=("          Start Docker Desktop, accept the licence, then: docker info")
  return 1
}

# --- 6. Windows repairs: path conversion, and junctions for Studio Pro and the JDK ---
# No-ops unless IS_WINDOWS=1. Junctions, not symlinks: they need no admin rights or Developer Mode.

win_path() {             # win_path <msys-path> -- echo the Windows form
  case "$1" in
    /[a-zA-Z]/*) printf '%s:%s\n' \
      "$(printf '%s' "${1:1:1}" | tr '[:lower:]' '[:upper:]')" "$(printf '%s' "${1:2}" | tr '/' '\\')" ;;
    *) printf '%s\n' "$1" | tr '/' '\\' ;;
  esac
}

# mxcli run --local symlinks the runtime, which unprivileged Windows refuses; pre-create a junction.
ensure_runtime_junction() {   # ensure_runtime_junction <version>
  [ "$IS_WINDOWS" = "1" ] || return 0
  local version="$1" runtime link
  runtime="$HOME/.mxcli/runtime/$version/runtime"
  link="$HOME/.mxcli/mxbuild/$version/runtime"
  [ -d "$runtime" ] || return 0
  [ -e "$link" ] && return 0
  mkdir -p "$HOME/.mxcli/mxbuild/$version" 2>/dev/null || return 0
  local runtime_win link_win drive
  drive="$(printf '%s' "${HOME:1:1}" | tr '[:lower:]' '[:upper:]')"
  runtime_win="$(printf '%s:%s' "$drive" "${runtime:2}" | tr '/' '\\')"
  link_win="$(printf '%s:%s' "$drive" "${link:2}" | tr '/' '\\')"
  # Doubled slashes stop Git Bash rewriting /c and /J into Windows paths.
  cmd //c mklink //J "$link_win" "$runtime_win" >> "$DEPS_LOG" 2>&1 || true
  [ -e "$link" ] && ui_note "runtime linked into the mxbuild cache (junction, no admin needed)"
  return 0
}

# mxbuild needs Studio Pro's gradle-8.5, OpenJDK and WebView2 beside the cached mxbuild; junction them in.
ensure_studio_support_junctions() {   # ensure_studio_support_junctions <version> <studio-dir>
  [ "$IS_WINDOWS" = "1" ] || return 0
  local version="$1" studio="$2" name target link linked=""
  [ -d "$studio" ] || return 0
  mkdir -p "$HOME/.mxcli/mxbuild/$version" 2>/dev/null || return 0
  for name in gradle-8.5 OpenJDK WebView2; do
    target="$studio/$name"
    link="$HOME/.mxcli/mxbuild/$version/$name"
    [ -d "$target" ] || continue
    [ -e "$link" ] && continue
    cmd //c mklink //J "$(win_path "$link")" "$(win_path "$target")" >> "$DEPS_LOG" 2>&1 || true
    [ -e "$link" ] && linked="$linked $name"
  done
  [ -n "$linked" ] && ui_note "linked into the mxbuild cache:$linked"
  return 0
}

# ARM64 Studio Pro ships win-arm64 tools but mxbuild asks for win-x64; alias them with junctions.
ensure_tool_arch_aliases() {  # ensure_tool_arch_aliases <studio-dir>
  [ "$IS_WINDOWS" = "1" ] || return 0
  local studio="$1" tool dir aliased=""
  for tool in deno node; do
    dir="$studio/modeler/tools/$tool"
    [ -d "$dir/win-arm64" ] || continue
    [ -e "$dir/win-x64" ] && continue
    cmd //c mklink //J "$(win_path "$dir/win-x64")" "$(win_path "$dir/win-arm64")" >> "$DEPS_LOG" 2>&1 || true
    [ -e "$dir/win-x64" ] && aliased="$aliased $tool"
  done
  [ -n "$aliased" ] && ui_note "win-x64 aliases for Studio Pro's arm64 tools:$aliased"
  return 0
}

# Runs the Studio Pro repairs; Docker builds use the same mxbuild, so this is not no-Docker only.
ensure_windows_studio_repairs() {   # ensure_windows_studio_repairs <version>
  [ "$IS_WINDOWS" = "1" ] || return 0
  [ -n "${1:-}" ] || return 0
  local mx dir
  mx="$(studio_pro_mx "$1" 2>/dev/null || true)"
  [ -n "$mx" ] || return 0
  dir="$(cd "$(dirname "$(dirname "$mx")")" && pwd)" || return 0
  ensure_studio_support_junctions "${dir##*/}" "$dir"
  ensure_tool_arch_aliases "$dir"
}

# mxbuild splits --java-home on spaces, so hand it a space-free junction to the JDK.
jdk_spacefree_home() {   # jdk_spacefree_home <path-to-java> -- echo a space-free home
  [ "$IS_WINDOWS" = "1" ] || return 1
  local java="$1" home win link
  home="${java%/bin/java$EXE}"
  [ "$home" = "$java" ] && home="${java%/java$EXE}"
  win="$(win_path "$home")"
  case "$win" in
    *" "*) ;;
    *) printf '%s\n' "${win//\\//}"; return 0 ;;
  esac
  link="${LOCALAPPDATA:-$HOME/AppData/Local}"
  link="${link//\\//}/mxcli-jdk"
  case "$link" in *" "*) link="/c/mxcli-jdk" ;; esac
  [ -e "$link" ] || cmd //c mklink //J "$(win_path "$link")" "$win" >> "$DEPS_LOG" 2>&1 || true
  [ -x "$link/bin/java$EXE" ] || return 1
  printf '%s\n' "$(win_path "$link" | tr '\\' '/')"
}

# --- 7. Report-only prerequisites, and mxcli: download, verify, choose, update ---
# Report-only: a reboot or licence click stands between the install command and a working tool.
dep_report_only() {      # dep_report_only <label> <detect> <winget> <brew> <apt>
  eval "$2" >/dev/null 2>&1 && return 0
  local command=""
  case "$(pkg_manager)" in
    winget) command="winget install -e --id $3" ;;
    brew)   command="brew install $4" ;;
    apt)    command="${SUDO}apt-get install -y $5" ;;
    dnf)    command="${SUDO}dnf install -y $5" ;;
  esac
  DEPS_MISSING+=("$1 -- ${command:-install it by hand}  (not installed for you)")
  return 1
}

# mxcli_release_url -- download URL of the mxcli binary for this OS and CPU.
mxcli_release_url() {
  local os arch
  case "$(uname -s 2>/dev/null)" in
    Darwin)               os=darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=windows ;;
    *)                    os=linux ;;
  esac
  case "$(uname -m 2>/dev/null)" in
    arm64|aarch64) arch=arm64 ;;
    *)             arch=amd64 ;;
  esac
  printf 'https://github.com/mendixlabs/mxcli/releases/download/%s/mxcli-%s-%s%s\n' \
    "${MXCLI_TAG:-nightly}" "$os" "$arch" "$EXE"
}

# ui_fail when the sha256 differs from MXCLI_SHA256; with it unset the download is only reported.
mxcli_verify_download() {   # mxcli_verify_download <file>
  local want="${MXCLI_SHA256:-}" got
  if [ -z "$want" ]; then
    ui_note "mxcli came from the ${MXCLI_TAG:-nightly} release and is not checksum-verified (set MXCLI_SHA256 to pin it)"
    return 0
  fi
  got="$(shasum -a 256 "$1" 2>/dev/null | cut -d" " -f1)"
  [ -n "$got" ] || got="$(sha256sum "$1" 2>/dev/null | cut -d" " -f1)"
  if [ "$got" != "$want" ]; then
    rm -f "$1"
    ui_fail "The mxcli download does not match MXCLI_SHA256." "  expected $want" "  got      ${got:-nothing}"
  fi
}

# Use the newest runnable mxcli and offer to update ./mxcli (MDL_NO_UPDATE_CHECK=1 skips the online check).

# mxcli_describe <binary> -- "<build-date> <version>", or nothing when it cannot run here.
mxcli_describe() {
  local out ver date
  [ -n "${1:-}" ] && [ -x "$1" ] || return 1
  out="$("$1" --version 2>/dev/null | head -1)" || return 1
  ver="$(printf '%s' "$out" | sed -n 's/^mxcli version \([^ ]*\).*/\1/p')"
  date="$(printf '%s' "$out" | sed -n 's/.*(\([0-9][0-9-]*T[0-9:]*Z\)).*/\1/p')"
  [ -n "$ver" ] && [ -n "$date" ] || return 1
  printf '%s %s\n' "$date" "$ver"
}

# mxcli_newest_local -- set MXCLI_BEST/MXCLI_BEST_DESC to the newest runnable candidate (tie: earlier wins); sets MXCLI_CANDIDATES.
mxcli_newest_local() {
  local candidate desc
  MXCLI_BEST=""; MXCLI_BEST_DESC=""
  # Every place mxcli may be, in order; mxcli_for_project reuses this list.
  MXCLI_CANDIDATES=("$APP/mxcli$EXE" "$(command -v "mxcli$EXE" 2>/dev/null || true)"
                    "$SRC/../mxcli$EXE" "$SRC/mxcli$EXE")
  for candidate in "${MXCLI_CANDIDATES[@]}"; do
    desc="$(mxcli_describe "$candidate")" || continue
    candidate="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
    # ISO build dates compare correctly as strings.
    if [ -z "$MXCLI_BEST" ] || [[ "${desc%% *}" > "${MXCLI_BEST_DESC%% *}" ]]; then
      MXCLI_BEST="$candidate"; MXCLI_BEST_DESC="$desc"
    fi
  done
  [ -n "$MXCLI_BEST" ]
}

# mxcli_latest_release -- "<published-at> <tag> <sha256> <url>" of the latest release, or nothing; fields validated.
mxcli_latest_release() {
  [ -z "${MDL_NO_UPDATE_CHECK:-}" ] || return 1
  have curl || return 1
  local api="${MXCLI_RELEASES_API:-https://api.github.com/repos/mendixlabs/mxcli/releases/latest}"
  local asset line published tag sha url
  asset="$(basename "$(mxcli_release_url)")"
  line="$(curl -fsSL -m 10 "$api" 2>/dev/null | "$PY" -c 'import json, sys
asset = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for item in data.get("assets") or []:
    digest = str(item.get("digest") or "")
    if item.get("name") == asset and digest.startswith("sha256:"):
        print(data.get("published_at", ""), data.get("tag_name", ""), digest[7:],
              item.get("browser_download_url", ""))
        break
else:
    sys.exit(1)' "$asset" 2>/dev/null)" || return 1
  read -r published tag sha url <<< "$line"
  [[ "$published" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || return 1
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [ -z "${MXCLI_RELEASES_API:-}" ]; then
    case "$url" in https://github.com/mendixlabs/mxcli/releases/download/*) ;; *) return 1 ;; esac
  fi
  printf '%s %s %s %s\n' "$published" "$tag" "$sha" "$url"
}

# mxcli_older_than_release <desc> <published-at> <tag> -- older only if not that tag and built >12h before release.
mxcli_older_than_release() {
  local date="${1%% *}" ver="${1#* }"
  [ "$ver" = "$3" ] && return 1
  "$PY" -c 'import datetime, sys
parse = lambda text: datetime.datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ")
sys.exit(0 if parse(sys.argv[1]) + datetime.timedelta(hours=12) < parse(sys.argv[2]) else 1)' \
    "$date" "$2" 2>/dev/null
}

# mxcli_put_in_project <file> -- replace ./mxcli, keeping the old one beside it under its version.
mxcli_put_in_project() {
  local source="$1" target="$APP/mxcli$EXE" old backup
  if old="$(mxcli_describe "$target")"; then
    backup="$APP/mxcli.$(printf '%s' "${old#* }" | tr -c 'A-Za-z0-9._-' '_')$EXE"
    [ -e "$backup" ] || cp "$target" "$backup" 2>/dev/null || true
  fi
  cp "$source" "$target.new" && chmod +x "$target.new" && mv -f "$target.new" "$target"
}

# mxcli_label <desc> -- "v0.22.0, built 2026-09-14", or "none" for an empty one.
mxcli_label() {
  if [ -n "${1:-}" ]; then printf '%s, built %s' "${1#* }" "${1%%T*}"; else printf 'none'; fi
}

# mxcli_offer_update -- offer a newer release or local build over ./mxcli; sets MXCLI_BEST*. Returns 0.
mxcli_offer_update() {
  local project_desc="" latest published tag sha url tmp got prompt
  project_desc="$(mxcli_describe "$APP/mxcli$EXE" || true)"
  mxcli_newest_local || true

  if latest="$(mxcli_latest_release)"; then
    read -r published tag sha url <<< "$latest"
    if [ -z "$MXCLI_BEST_DESC" ] || mxcli_older_than_release "$MXCLI_BEST_DESC" "$published" "$tag"; then
      prompt="    mxcli $tag is available (this project uses $(mxcli_label "$project_desc")). Download it into ./mxcli$EXE? [Y/n] "
      if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
        ui_note "would download mxcli $tag into ./mxcli$EXE"
      elif [ -z "${MDL_ASSUME_YES:-}" ] && ! [ -t 0 ]; then
        ui_note "mxcli $tag is available; this project uses $(mxcli_label "$project_desc"). Re-run interactively, or with MDL_ASSUME_YES=1, to update."
      elif ask "$prompt" y; then
        tmp="$(mktemp "${TMPDIR:-/tmp}/mxcli-download.XXXXXX")"
        if curl -fsSL -m 600 -o "$tmp" "$url" 2>/dev/null; then
          got="$(shasum -a 256 "$tmp" 2>/dev/null | cut -d" " -f1)"
          [ -n "$got" ] || got="$(sha256sum "$tmp" 2>/dev/null | cut -d" " -f1)"
          if [ "$got" = "$sha" ] && mxcli_put_in_project "$tmp"; then
            ui_note "./mxcli$EXE updated to $tag (checksum verified against the release)"
          else
            DEPS_MISSING+=("mxcli $tag -- the download did not match the release checksum, so ./mxcli$EXE was left as it was.")
          fi
        else
          DEPS_MISSING+=("mxcli $tag -- the download failed, so ./mxcli$EXE was left as it was.")
        fi
        rm -f "$tmp"
        mxcli_newest_local || true
        return 0
      fi
    fi
  fi

  if [ -n "$MXCLI_BEST" ] && [ "$MXCLI_BEST" != "$APP/mxcli$EXE" ] && [ -e "$APP/mxcli$EXE" ] \
     && { [ -z "$project_desc" ] || [[ "${MXCLI_BEST_DESC%% *}" > "${project_desc%% *}" ]]; }; then
    prompt="    This project's ./mxcli$EXE is $(mxcli_label "$project_desc"); $MXCLI_BEST is $(mxcli_label "$MXCLI_BEST_DESC"). Use the newer one? [Y/n] "
    if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
      ui_note "would copy mxcli ${MXCLI_BEST_DESC#* } into ./mxcli$EXE"
    elif [ -z "${MDL_ASSUME_YES:-}" ] && ! [ -t 0 ]; then
      ui_note "a newer mxcli ($(mxcli_label "$MXCLI_BEST_DESC")) is at $MXCLI_BEST; this project uses $(mxcli_label "$project_desc"). Re-run interactively, or with MDL_ASSUME_YES=1, to update."
    elif ask "$prompt" y; then
      if mxcli_put_in_project "$MXCLI_BEST"; then
        ui_note "./mxcli$EXE updated to ${MXCLI_BEST_DESC#* }"
        mxcli_newest_local || true
      fi
    fi
  fi
  return 0
}

# first_executable <path>... -- print the first non-empty, executable path; return 1 if none.
first_executable() {
  local candidate
  for candidate in "$@"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

# mxcli_for_project -- print the mxcli to use: ./mxcli if it runs, else MXCLI_BEST, else the first executable candidate.
# Needs mxcli_newest_local to have run: it sets MXCLI_BEST and MXCLI_CANDIDATES.
mxcli_for_project() {
  if mxcli_describe "$APP/mxcli$EXE" >/dev/null; then
    printf '%s\n' "$APP/mxcli$EXE"
  elif [ -n "${MXCLI_BEST:-}" ]; then
    printf '%s\n' "$MXCLI_BEST"
  else
    # Nothing answered --version.
    first_executable "${MXCLI_CANDIDATES[@]}"
  fi
}

# --- 8. Finding Studio Pro installs (Windows) ---
# No CDN mxbuild runs on Windows; Studio Pro's mx is used, installed in Program Files or %LOCALAPPDATA%.
studio_pro_roots() {
  local local_app="${LOCALAPPDATA:-}"
  local_app="${local_app//\\//}"
  printf '%s\n' "/c/Program Files/Mendix" "/c/Program Files (x86)/Mendix"
  [ -n "$local_app" ] && printf '%s\n' "$local_app/Programs/Mendix"
}

# studio_pro_versions -- installed Studio Pro versions that have mx.exe, oldest first.
studio_pro_versions() {
  local root dir
  while IFS= read -r root; do
    [ -d "$root" ] || continue
    for dir in "$root"/*/; do
      [ -x "$dir/modeler/mx.exe" ] || continue
      printf '%s\n' "$(basename "$dir")"
    done
  done < <(studio_pro_roots) | sort -V -u
}

# studio_pro_mx_visible_to_mxcli <version-prefix> -- mx.exe under C:\Program Files\Mendix (where mxcli looks), or return 1.
studio_pro_mx_visible_to_mxcli() {   # <version-prefix>
  local dir
  for dir in "/c/Program Files/Mendix"/"$1"*/; do
    [ -x "$dir/modeler/mx.exe" ] || continue
    printf '%s\n' "$dir/modeler/mx.exe"
    return 0
  done
  return 1
}

# offer_studio_pro_junction <version> <mx.exe> -- ask, then junction a per-user install into Program Files (UAC).
offer_studio_pro_junction() {   # <version> <path-to-per-user-mx.exe>
  local version="$1" mx="$2" install_dir target_win link_win
  install_dir="$(cd "$(dirname "$(dirname "$mx")")" && pwd)"
  # No sed \U here: it is GNU-only.
  local drive rest
  drive="$(printf '%s' "${install_dir:1:1}" | tr '[:lower:]' '[:upper:]')"
  rest="${install_dir:2}"
  target_win="$(printf '%s:%s' "$drive" "$rest" | tr '/' '\\')"
  link_win="C:\\Program Files\\Mendix\\$version"

  ui_clear
  printf '\n  %s%s%s Studio Pro %s is installed where mxcli cannot see it.\n\n' \
    "$C_YELLOW" "$I_WARN" "$C_RESET" "$version"
  printf '    mxcli looks only in %sC:\\Program Files\\Mendix%s, and yours is at\n' "$C_BOLD" "$C_RESET"
  printf '    %s%s%s. Creating the app works around that,\n' "$C_CYAN" "$target_win" "$C_RESET"
  printf '    but %srunning%s it does not -- mxcli resolves mxbuild on its own there.\n\n' \
    "$C_BOLD" "$C_RESET"
  printf '    A directory junction fixes it permanently. No copy, no disk used:\n'
  printf '      %smklink /J "%s" "%s"%s\n\n' "$C_CYAN" "$link_win" "$target_win" "$C_RESET"
  printf '    It needs administrator rights, so Windows will ask you to confirm.\n\n'

  if [ -e "/c/Program Files/Mendix/$version" ]; then
    return 0
  fi
  if ! ask "    Create it now? [Y/n] " y; then
    DEPS_MISSING+=("Studio Pro $version -- not visible to mxcli, so the app cannot be booted.")
    DEPS_MISSING+=("                 mklink /J \"$link_win\" \"$target_win\"   (as administrator)")
    return 1
  fi

  case "$link_win$target_win" in
    *"'"*|*'"'*)
      DEPS_MISSING+=("Studio Pro $version -- the path contains a quote, so the junction cannot be")
      DEPS_MISSING+=("                 created safely from here. Run it yourself, as administrator:")
      DEPS_MISSING+=("                 mklink /J \"$link_win\" \"$target_win\"")
      return 1 ;;
  esac
  ui_sub "asking Windows for permission"
  powershell.exe -NoProfile -Command \
    "Start-Process cmd.exe -Verb RunAs -Wait -ArgumentList '/c','mklink','/J','\"$link_win\"','\"$target_win\"'" \
    >> "$DEPS_LOG" 2>&1 || true
  if [ -e "/c/Program Files/Mendix/$version" ]; then
    ui_note "Studio Pro $version linked into Program Files; mxcli can see it now"
    return 0
  fi
  DEPS_MISSING+=("Studio Pro $version -- the junction was not created, so the app cannot boot.")
  DEPS_MISSING+=("                 mklink /J \"$link_win\" \"$target_win\"   (as administrator)")
  return 1
}

studio_pro_mx() {        # studio_pro_mx <version-prefix> -- echo the matching mx.exe
  local version="$1" root dir
  while IFS= read -r root; do
    [ -d "$root" ] || continue
    for dir in "$root"/"$version"*/; do
      [ -x "$dir/modeler/mx.exe" ] || continue
      printf '%s\n' "$dir/modeler/mx.exe"
      return 0
    done
  done < <(studio_pro_roots)
  return 1
}

# --- 9. Playwright browser and JDK lookup ---
# playwright_browser_command -- the devcontainer's browser install; $(npm root -g) expands when dep_apply evals it.
playwright_browser_command() {
  printf 'node "$(npm root -g)/@playwright/cli/node_modules/playwright-core/cli.js" install chromium chromium-headless-shell\n'
}

# JDK major by Mendix version: 11 up to 9.x, 21 for 10.x-11.13, 25 from 11.14.
jdk_major_for() {         # jdk_major_for <mendix-version>
  case "${1%%.*}" in
    ""|8|9) echo 11 ;;
    10)     echo 21 ;;
    11)     case "$1" in 11.1[4-9]*|11.[2-9][0-9]*) echo 25 ;; *) echo 21 ;; esac ;;
    *)      echo 25 ;;
  esac
}

java_major() {            # java_major <path-to-java> -- echo the major version
  "$1" -version 2>&1 | head -1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p'
}

# Searches beyond PATH; JAVA_HOME may point at the home or at its bin/.
jdk_find() {              # jdk_find <wanted-major> -- echo a matching java
  local want="$1" candidate found
  local -a candidates=()
  if [ -n "${JAVA_HOME:-}" ]; then
    local home="${JAVA_HOME//\\//}"
    candidates+=("$home/bin/java$EXE" "$home/java$EXE" "$home/bin/java" "$home/java")
  fi
  have java && candidates+=("$(command -v java)")
  candidates+=(
    "/c/Program Files/Eclipse Adoptium"*/jdk-*/bin/java.exe
    "/c/Program Files/Java"/jdk-*/bin/java.exe
    "/c/Program Files/Microsoft"/jdk-*/bin/java.exe
    "/c/Program Files"*/zulu*/bin/java.exe
    "/c/Program Files"*/zulu*/java.exe
    /usr/lib/jvm/*/bin/java
    /Library/Java/JavaVirtualMachines/*/Contents/Home/bin/java
  )
  for candidate in "${candidates[@]}"; do
    [ -x "$candidate" ] || continue
    found="$(java_major "$candidate")"
    [ "$found" = "$want" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

playwright_browser_present() {
  local root
  for root in "$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright" \
              "${LOCALAPPDATA:-}/ms-playwright" "${PLAYWRIGHT_BROWSERS_PATH:-}"; do
    [ -n "$root" ] || continue
    set -- "$root"/chromium_headless_shell-*
    [ -e "$1" ] && return 0
  done
  return 1
}

# --- 9b. Prerequisite step helpers (want_mx, MxBuild, no-Docker mode, JDK) ---
# choose_want_mx -- set want_mx: the .mpr's Mendix version, or for a new app the one it will be created with.
choose_want_mx() {
  if [ "$mpr_count" = "0" ]; then
    # Same version rule as create_app.
    if [ -n "${MX_VERSION:-}" ]; then
      want_mx="$MX_VERSION"
    elif [ "$IS_WINDOWS" = "1" ]; then
      want_mx="$(studio_pro_versions | tail -1)"
      want_mx="${want_mx:-$DEFAULT_MX_VERSION}"
    else
      want_mx="$DEFAULT_MX_VERSION"
    fi
  else
    # Print the Mendix version stored in the project's .mpr (SQLite).
    want_mx="$("$PY" - "$APP" <<'PY_WANT' 2>/dev/null || true
import glob, os, sqlite3, sys
mprs = glob.glob(os.path.join(sys.argv[1], "*.mpr"))
if mprs:
    try:
        con = sqlite3.connect("file:%s?mode=ro" % mprs[0], uri=True)
        print(con.execute("select * from _MetaData limit 1").fetchone()[1])
    except Exception:
        pass
PY_WANT
)"
  fi
  # want_mx ends up in an eval'd command: accept only a version number.
  case "$want_mx" in
    ''|*[!0-9.]*)
      [ -z "$want_mx" ] || ui_note "ignoring an unexpected Mendix version in the project file: $want_mx"
      want_mx="" ;;
  esac
}

# ensure_mxbuild_and_runtime <mxcli> -- MxBuild (or Studio Pro on Windows) for want_mx; on Windows also cache the runtime.
ensure_mxbuild_and_runtime() {
  local mxcli="$1" installed_studio
  if [ "$IS_WINDOWS" = "1" ]; then
    # `mxcli setup mxbuild` refuses on Windows (the CDN build is Linux-only); Studio Pro is the only source.
    if ! studio_pro_mx "$want_mx" >/dev/null; then
      installed_studio="$(studio_pro_versions | tr '\n' ' ')"
      DEPS_MISSING+=("Studio Pro $want_mx -- needed for \`mx check\` and to create an app at that version.")
      DEPS_MISSING+=("               installed here: ${installed_studio:-none}. Set MX_VERSION to one of those,")
      DEPS_MISSING+=("               or install Studio Pro $want_mx. (The Mendix CDN's mxbuild is Linux-only.)")
    fi
  else
    dep_apply "MxBuild $want_mx" \
      "[ -x \"$HOME/.mxcli/mxbuild/$want_mx/modeler/mx\" ]" \
      "\"$mxcli\" setup mxbuild --version \"$want_mx\"" || true
  fi
  # Cache the runtime; the first attempt may fail on the symlink, the junction fixes it, the retry must pass.
  if [ "$IS_WINDOWS" = "1" ]; then
    ui_sub "caching the Mendix runtime"
    "$mxcli" run --local -p "$APP/$(basename "$APP").mpr" --setup >> "$DEPS_LOG" 2>&1 || true
    ensure_runtime_junction "$want_mx"
  fi
}

# setup_local_build -- with no Docker daemon: use a local Studio Pro or cached mxbuild plus PostgreSQL, and install Docker.
setup_local_build() {
  local studio_dir="" studio_mx
  if [ -n "${want_mx:-}" ] && [ "$IS_WINDOWS" = "1" ]; then
    studio_mx="$(studio_pro_mx "$want_mx" 2>/dev/null || true)"
    [ -n "$studio_mx" ] && studio_dir="$(cd "$(dirname "$(dirname "$studio_mx")")" && pwd)"
  fi
  # Off Windows, a cached mxbuild enables the same mode.
  if [ -z "$studio_dir" ] && [ -n "${want_mx:-}" ] && [ -d "$HOME/.mxcli/mxbuild/$want_mx" ]; then
    studio_dir="$HOME/.mxcli/mxbuild/$want_mx"
  fi

  # A local mxbuild or Studio Pro is always set up; Docker is still installed below.
  if [ -n "$studio_dir" ]; then
    if ! postgres_answers; then
      if psql_path >/dev/null 2>&1; then
        # psql is installed but no login worked: ask for a superuser.
        postgres_ask_superuser || true
        if ! postgres_answers; then
          DEPS_MISSING+=("PostgreSQL -- installed, but none of the logins tried could connect.")
          DEPS_MISSING+=("              Put a working one in tests/harness.env and re-run:")
          DEPS_MISSING+=("                MDL_DB_USER=... MDL_DB_PASSWORD=... MDL_DB_HOST=...")
        fi
      else
        dep_need "PostgreSQL" "postgres_answers" \
          "PostgreSQL.PostgreSQL.17" "postgresql@17" "postgresql" || true
      fi
    fi
    ensure_studio_support_junctions "${studio_dir##*/}" "$studio_dir"
    ensure_tool_arch_aliases "$studio_dir"
    write_harness_env "$studio_dir"
    if ! postgres_answers; then
      DEPS_MISSING+=("PostgreSQL -- no login worked yet, so the app cannot boot. Everything")
      DEPS_MISSING+=("              else in the gate runs. Fix the credentials in")
      DEPS_MISSING+=("              tests/harness.env, or create the role by hand:")
      DEPS_MISSING+=("                psql -U postgres -c \"CREATE ROLE ${MDL_DB_USER:-mendix} LOGIN PASSWORD '${MDL_DB_PASSWORD:-mendix}' CREATEDB\"")
    fi
  fi

  # Docker is installed whenever missing; a local mxbuild only covers mx check.
  if have docker; then
    docker_ready || DEPS_MISSING+=("Docker -- installed but the daemon is not running: $(docker_start_command)")
  else
    docker_walkthrough || true
  fi
}

# check_jdk -- report a JDK for want_mx that is missing or off the PATH (often on Windows); never installs one.
check_jdk() {
  local want_jdk found_jdk
  want_jdk="$(jdk_major_for "${want_mx:-}")"
  found_jdk="$(jdk_find "$want_jdk" || true)"
  if [ -z "$found_jdk" ]; then
    dep_report_only "JDK $want_jdk" "false" \
      "EclipseAdoptium.Temurin.$want_jdk.JDK" "temurin@$want_jdk" "temurin-$want_jdk-jdk" || true
  elif ! have java || [ "$(java_major java 2>/dev/null)" != "$want_jdk" ]; then
    DEPS_MISSING+=("JDK $want_jdk -- installed but not on the PATH: $found_jdk")
    DEPS_MISSING+=("           \`./mxcli$EXE run --local\` needs it there. In Git Bash:")
    DEPS_MISSING+=("           export PATH=\"\$(dirname '$found_jdk'):\$PATH\"")
  fi
}

# --- 10. Command-line arguments and the target project ---
APP_ARG=""
CREATE_APP=1
WITH_DEPS=0
for arg in "$@"; do
  case "$arg" in
    --no-app) CREATE_APP=0 ;;
    --with-deps) WITH_DEPS=1 ;;
    -h|--help)
      printf 'bash mxcodr/install.sh [path-to-project] [--no-app] [--with-deps]\n\n'
      printf '  Run it from the project folder, one level above mxcodr/:\n'
      printf '    cd <app> && bash mxcodr/install.sh --with-deps\n'
      printf '  not from inside mxcodr/ (cd mxcodr && bash install.sh): that still installs into\n'
      printf '  the folder above, but the target is guessed instead of named.\n\n'
      printf '  path-to-project  where to install (default: the current directory,\n'
      printf '                   or the parent project when run from inside the bundle)\n'
      printf '  --no-app         never create a Mendix app; require one to be there already\n'
      printf '  --with-deps      install missing prerequisites (Python, Node, playwright-cli,\n'
      printf '                   its browser, mxcli, MxBuild) with this machine'"'"'s package manager.\n'
      printf '                   Without it they are only reported. Docker is installed when\n'
      printf '                   missing either way; the JDK is only reported.\n\n'
      printf '  MX_VERSION=%s  APP_NAME=<name>   env overrides when an app is created\n' "$DEFAULT_MX_VERSION"
      printf '  MDL_DEPS_DRY_RUN=1                    print the install commands, run none\n'
      printf '  MDL_ASSUME_YES=1                      answer the prerequisite prompts with yes\n'
      printf '  MDL_NO_UPDATE_CHECK=1                 do not look online for a newer mxcli\n'
      exit 0 ;;
    -*) ui_fail "Unknown option: $arg" "Run with --help to see what this takes." ;;
    *)
      if [ -z "$APP_ARG" ]; then APP_ARG="$arg"; else ui_fail "Only one path can be given (got \"$APP_ARG\" and \"$arg\")."; fi ;;
  esac
done

ui_banner "$version"

if [ -n "$APP_ARG" ]; then APP="$APP_ARG"; else APP="$PWD"; fi
[ -d "$APP" ] || ui_fail "No such directory: $APP"
APP="$(cd "$APP" && pwd)"
# $APP is interpolated into eval'd commands: reject shell metacharacters.
case "$APP" in
  *'`'*|*'$('*|*'"'*|*"'"*|*';'*|*'|'*|*'&'*|*$'\n'*)
    ui_fail "The project path contains a shell metacharacter and cannot be installed into:" \
            "  $APP" \
            "Rename the directory (or move the project) and run the installer again." ;;
esac

# With no path named, running from inside the bundle targets the directory it sits in.
target_inferred=0
looks_like_project() {
  local marker
  [ -n "$(find "$1" -maxdepth 1 -name '*.mpr' -print -quit 2>/dev/null)" ] && return 0
  for marker in CLAUDE.md AGENTS.md .ai-context .claude mxcli; do
    [ -e "$1/$marker" ] && return 0
  done
  return 1
}

case "$APP" in
  "$SRC"|"$SRC"/*)
    if [ -n "$APP_ARG" ]; then
      ui_fail "install.sh installs INTO a Mendix project; that path is the bundle itself." \
              "$APP" \
              "" \
              "Name the project instead:" \
              "  bash $SRC/install.sh /path/to/project"
    fi
    parent="$(cd "$SRC/.." && pwd)"
    if [ "$parent" = "/" ] || [ "$parent" = "$HOME" ]; then
      ui_fail "Nothing installed: $parent is not a project folder." \
              "" \
              "Copy $(basename "$SRC")/ into your Mendix project (or an empty folder for a new app), then run this:" \
              "" \
              "  cd /path/to/project && bash $(basename "$SRC")/install.sh --with-deps"
    fi
    if ! looks_like_project "$parent"; then
      ui_fail "Nothing installed: run the installer from the project folder, not from inside $(basename "$SRC")/." \
              "" \
              "To install, run this:" \
              "" \
              "  cd $parent && bash $(basename "$SRC")/install.sh --with-deps" \
              "" \
              "There is no Mendix app in $parent yet, so that creates one first."
    fi
    APP="$parent"
    target_inferred=1 ;;
esac

# No .mpr: create an app (MX_VERSION, APP_NAME) unless --no-app.
mpr_count=$(find "$APP" -maxdepth 1 -name '*.mpr' | wc -l | tr -d ' ')
if [ "$mpr_count" = "0" ] && [ "$CREATE_APP" = "0" ]; then
  ui_fail "No .mpr in $APP" \
          "Point this at a Mendix project, or drop --no-app to have one created here."
fi

if [ "$target_inferred" = 1 ]; then
  printf '  %s%s target%s %s  %s(the project this bundle sits in)%s\n' \
    "$C_GREY" "$I_BOX" "$C_RESET" "$APP" "$C_GREY" "$C_RESET"
  printf '  %s  next time run it from the project folder: cd %s && bash %s/install.sh%s\n' \
    "$C_GREY" "$APP" "$(basename "$SRC")" "$C_RESET"
else
  printf '  %s%s target%s %s\n' "$C_GREY" "$I_BOX" "$C_RESET" "$APP"
fi
printf '\n'

# Ask before creating an app in a directory the caller did not name.
if [ "$target_inferred" = 1 ] && [ "$mpr_count" = "0" ] && [ "$CREATE_APP" = "1" ]; then
  if [ -t 0 ] && [ "$UI_TTY" = 1 ]; then
    printf '  %s%s%s There is no Mendix app in %s.\n' "$C_YELLOW" "$I_WARN" "$C_RESET" "$APP"
    printf '    Create an empty one there now? [y/N] '
    read -r reply
    case "$reply" in
      y|Y|yes|YES) printf '\n' ;;
      *) ui_fail "Nothing installed." "Name a project with an app, or pass --no-app to install without creating one." ;;
    esac
  else
    ui_fail "Nothing installed: run the installer from the project folder, not from inside $(basename "$SRC")/." \
            "" \
            "To install, run this:" \
            "" \
            "  cd $APP && bash $(basename "$SRC")/install.sh --with-deps" \
            "" \
            "There is no Mendix app in $APP yet, so that creates one first."
  fi
fi

# NOTE: there are 12 ui_done steps (13 with a new app), so these totals are one short.
if [ "$mpr_count" = "0" ]; then ui_plan 14; else ui_plan 13; fi

# --- 11. Step: prerequisites (Python, Node, Playwright, mxcli, MxBuild, PostgreSQL, Docker, JDK) ---
# Missing tools are collected and reported in the summary.
DEPS_LOG="${TMPDIR:-/tmp}"; DEPS_LOG="${DEPS_LOG%/}/mdl-skills-deps.log"
: > "$DEPS_LOG" 2>/dev/null || DEPS_LOG=/dev/null

ui_begin "checking prerequisites"

# Python first: the hook merges need it.
dep_need "Python 3" "mdl_find_python >/dev/null" "Python.Python.3.12" "python" "python3" || true
[ -n "$PY" ] || PY="$(mdl_find_python || true)"
[ -n "$PY" ] || ui_fail "This installer needs Python 3 -- it merges the host hook files." \
                        "Re-run with --with-deps, or install it and try again." \
                        "On Windows note that the python.org installer leaves \"Add python.exe" \
                        "to PATH\" unticked -- an installed but invisible Python looks the same."

dep_need "Node.js" "have node" "OpenJS.NodeJS.LTS" "node" "nodejs npm" || true
# A dry run walks the whole chain even though npm was not really installed.
if have npm || [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
  dep_apply "playwright-cli" "have playwright-cli" "npm install -g $PLAYWRIGHT_CLI_PACKAGE" || true
  if have playwright-cli || [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    dep_apply "Chromium headless shell" "playwright_browser_present" "$(playwright_browser_command)" || true
  fi
fi

mxcli_offer_update
found_mxcli="$(mxcli_for_project || true)"
if [ -z "$found_mxcli" ]; then
  dep_apply "mxcli" '[ -x "$APP/mxcli$EXE" ]' \
    "curl -fsSL -o \"$APP/mxcli$EXE\" \"$(mxcli_release_url)\" && chmod +x \"$APP/mxcli$EXE\"" || true
  [ -x "$APP/mxcli$EXE" ] && mxcli_verify_download "$APP/mxcli$EXE"
fi

# MxBuild for the project's version: mx check needs it, and without it mxcli new may use another version.
setup_mxcli="$(first_executable "$APP/mxcli$EXE" "$found_mxcli" || true)"
if [ -n "$setup_mxcli" ]; then
  choose_want_mx
  if [ -n "$want_mx" ]; then
    ensure_mxbuild_and_runtime "$setup_mxcli"
  fi
fi

# Docker or no-Docker mode: mx check needs no container, only the database does. No-Docker mode is written to tests/harness.env.
no_docker_mode=""
ensure_windows_studio_repairs "${want_mx:-}"
if ! docker_ready; then
  setup_local_build
fi
check_jdk

if [ "$DEPS_INSTALLED" -gt 0 ]; then
  ui_done "prerequisites" "$DEPS_INSTALLED installed, ${#DEPS_MISSING[@]} still missing"
elif [ "${#DEPS_MISSING[@]}" -gt 0 ]; then
  ui_done "prerequisites" "${#DEPS_MISSING[@]} missing $I_ARROW listed below"
else
  ui_done "prerequisites" "all present"
fi

# --- 12. Step: create a Mendix app when the project has no .mpr ---
# create_app -- create the app in a temp dir and copy it in. Sets mx_version, created_app, swapped_mxcli (read by the summary).
create_app() {
  local creator_mxcli app_name direct_mx stash_mxcli
  # Same choice as for the prerequisites, but look for the newest mxcli again when ./mxcli does not run.
  if ! mxcli_describe "$APP/mxcli$EXE" >/dev/null; then
    mxcli_newest_local || true
  fi
  creator_mxcli="$(mxcli_for_project || true)"
  if [ -z "$creator_mxcli" ]; then
    ui_fail "No .mpr here, and no mxcli to create one with." \
            "Looked in the project, on the PATH, and beside this installer." \
            "Install mxcli, or point this at an existing Mendix project."
  fi
  # App name: letters and digits, starting with a letter.
  app_name="${APP_NAME:-$(basename "$APP" | sed 's/[^A-Za-z0-9]//g')}"
  case "$app_name" in [A-Za-z]*) ;; *) app_name="App$app_name" ;; esac
  # On Windows default to the newest installed Studio Pro: mxcli new can only build that version.
  if [ -n "${MX_VERSION:-}" ]; then
    mx_version="$MX_VERSION"
  elif [ "$IS_WINDOWS" = "1" ]; then
    mx_version="$(studio_pro_versions | tail -1)"
    if [ -z "$mx_version" ]; then
      ui_fail "No Mendix Studio Pro found, and Windows has no other way to create an app." \
              "mxcli shells out to Studio Pro's mx.exe; the Mendix CDN's mxbuild is Linux-only." \
              "Install Studio Pro, or point this at a project that already has a .mpr."
    fi
  else
    mx_version="$DEFAULT_MX_VERSION"
  fi
  # mxcli new cannot see per-user Studio Pro installs and stamps the wrong version; use its mx.exe, then mxcli init.
  direct_mx=""
  if [ "$IS_WINDOWS" = "1" ] && ! studio_pro_mx_visible_to_mxcli "$mx_version" >/dev/null; then
    direct_mx="$(studio_pro_mx "$mx_version" 2>/dev/null || true)"
    # mxcli run --local cannot see per-user installs either; offer a junction.
    [ -n "$direct_mx" ] && offer_studio_pro_junction "$mx_version" "$direct_mx"
  fi

  ui_begin "creating $app_name (Mendix $mx_version)"
  # --theme/--layout none: stock Atlas (mxcli's theme follows the OS dark mode).
  # mxcli new needs an empty --output-dir: create in a temp dir, then move in.
  # tmp_app stays global: the EXIT trap reads it after this function has returned.
  tmp_app="$(mktemp -d "${TMPDIR:-/tmp}/mdl-skills-new.XXXXXX")"
  trap 'rm -rf "$tmp_app"' EXIT
  # Stash the running mxcli: on Windows copying over a running .exe deletes it.
  stash_mxcli="$tmp_app/mxcli-host$EXE"
  cp "$creator_mxcli" "$stash_mxcli" 2>/dev/null || stash_mxcli="$creator_mxcli"
  # mxcli's "Executing step '<phase>'" lines drive the sub-progress.
  if [ -n "$direct_mx" ]; then
    ui_sub "Studio Pro $mx_version (mxcli cannot see this install)"
    if ! "$direct_mx" create-project --app-name "$app_name" --output-dir "$tmp_app/app" \
         >> "$tmp_app/new.log" 2>&1; then
      ui_clear
      printf '  %s%s%s %slast lines of mx create-project:%s\n' "$C_RED" "$I_FAIL" "$C_RESET" "$C_BOLD" "$C_RESET" >&2
      tail -5 "$tmp_app/new.log" 2>/dev/null | sed 's/^/    /' >&2
      ui_fail "Creating the Mendix app failed." \
              "Run it by hand to see why:" \
              "  \"$direct_mx\" create-project --app-name $app_name --output-dir /tmp/probe"
    fi
    ui_tick
    # mxcli new also initialises the AI tooling; do that half separately.
    "$creator_mxcli" init "$tmp_app/app" >> "$tmp_app/new.log" 2>&1 || true
    ui_tick
  elif ! "$creator_mxcli" new "$app_name" --version "$mx_version" --output-dir "$tmp_app/app" \
       --theme none --layout none 2>&1 | while IFS= read -r line; do
         printf '%s\n' "$line" >> "$tmp_app/new.log"
         case "$line" in
           "Executing step "*) phase="${line#Executing step \'}"; ui_sub "${phase%\'}" ;;
           *...)               ui_tick ;;
         esac
       done; then
    ui_clear
    printf '  %s%s%s %slast lines of mxcli new:%s\n' "$C_RED" "$I_FAIL" "$C_RESET" "$C_BOLD" "$C_RESET" >&2
    tail -5 "$tmp_app/new.log" 2>/dev/null | sed 's/^/    /' >&2
    ui_fail "Creating the Mendix app failed." \
            "Run it by hand to see why:" \
            "  $creator_mxcli new $app_name --version $mx_version --output-dir /tmp/probe"
  fi
  # Set the scaffold's Linux mxcli aside; copying it over a running mxcli breaks it.
  if [ -f "$tmp_app/app/mxcli" ]; then mv "$tmp_app/app/mxcli" "$tmp_app/app-mxcli-linux"; fi
  rm -f "$tmp_app/app/mxcli$EXE" 2>/dev/null || true
  cp -R "$tmp_app/app/." "$APP/"
  # The scaffold's mxcli is a Linux binary; `file` is missing on minimal Git for Windows, so test only on Linux.
  if [ "$(uname -s 2>/dev/null)" = "Linux" ]; then
    if [ -f "$tmp_app/app-mxcli-linux" ]; then
      mv "$tmp_app/app-mxcli-linux" "$APP/mxcli"
      chmod +x "$APP/mxcli" 2>/dev/null || true
    fi
  else
    # Off Linux keep it beside the working binary, for the devcontainer.
    if [ -f "$tmp_app/app-mxcli-linux" ]; then
      mv "$tmp_app/app-mxcli-linux" "$APP/mxcli.linux"
    fi
    cp "$stash_mxcli" "$APP/mxcli$EXE" 2>/dev/null || true
    chmod +x "$APP/mxcli$EXE" 2>/dev/null || true
    [ -f "$APP/mxcli.linux" ] && swapped_mxcli=1
  fi
  rm -rf "$tmp_app"
  trap - EXIT
  created_app="$app_name.mpr"
  ui_done "Mendix app created" "$created_app"
  [ -n "${swapped_mxcli:-}" ] && ui_note "./mxcli$EXE swapped for this machine's binary (Linux one kept as mxcli.linux)"
  return 0
}

if [ "$mpr_count" = "0" ]; then
  create_app
fi

# --- 13. Step: copy skills, lint rules, checkers and the session rule ---
# Copies, not symlinks, so a plain clone of the app has the skills.
SKILL_DIRS=(.claude/skills .agents/skills .ai-context/skills)

ui_begin "installing skills"
installed_skills=0
for skill in "$SRC"/skills/*/; do
  name="$(basename "$skill")"
  for dest in "${SKILL_DIRS[@]}"; do
    mkdir -p "$APP/$dest/$name"
    cp "$skill/SKILL.md" "$APP/$dest/$name/SKILL.md"
    # reference/*.md: the detail a skill's SKILL.md links to (read on demand, not up front).
    if [ -d "$skill/reference" ]; then
      mkdir -p "$APP/$dest/$name/reference"
      cp "$skill/reference/"*.md "$APP/$dest/$name/reference/"
    fi
  done
  installed_skills=$((installed_skills + 1))
done
ui_done "skills" "$installed_skills $I_ARROW each of ${SKILL_DIRS[*]}"

ui_begin "installing lint rules"
mkdir -p "$APP/.claude/lint-rules"
cp "$SRC"/lint-rules/*.star "$APP/.claude/lint-rules/"
rules=$(ls -1 "$SRC"/lint-rules/*.star | wc -l | tr -d ' ')
ui_done "lint rules" "$rules $I_ARROW .claude/lint-rules/"

ui_begin "installing checkers"
mkdir -p "$APP/tools/mdl-checks"
cp -R "$SRC"/checks/. "$APP/tools/mdl-checks/"
cp "$SRC/VERSION" "$APP/tools/mdl-checks/VERSION"
# The mxcli build this bundle was validated with; orient.sh compares ./mxcli against it.
[ -f "$SRC/MXCLI_TESTED" ] && cp "$SRC/MXCLI_TESTED" "$APP/tools/mdl-checks/MXCLI_TESTED"
checks=$(ls -1 "$SRC"/checks/*.py | wc -l | tr -d ' ')
ui_done "checkers" "$checks $I_ARROW tools/mdl-checks/"

# In .claude/rules/ because mxcli init regenerates CLAUDE.md.
ui_begin "installing the session rule"
mkdir -p "$APP/.claude/rules"
cp "$SRC/rules/mdl-skills.md" "$APP/.claude/rules/mdl-skills.md"
ui_done "session rule" "1 $I_ARROW .claude/rules/mdl-skills.md"

# --- 14. Step: register hooks for Claude Code, Codex, Cursor and OpenCode ---
# Merged into .claude/settings.local.json, which mxcli init leaves alone.
ui_begin "registering Claude hooks"
mkdir -p "$APP/tools/mdl-checks/hooks"
cp "$SRC"/hooks/*.sh "$APP/tools/mdl-checks/hooks/"
chmod +x "$APP/tools/mdl-checks/hooks/"*.sh
# Each merge adds only missing entries; unparseable JSON stops the install rather than being overwritten.
"$PY" - "$APP/.claude/settings.local.json" <<'PY_MERGE'
import json, sys
path = sys.argv[1]
try:
    settings = json.load(open(path))
except FileNotFoundError:
    settings = {}
except json.JSONDecodeError as exc:
    # Replacing it would throw away whatever the developer had; the Codex and Cursor
    # mergers below refuse for the same reason.
    raise SystemExit("   !! %s is not valid JSON (%s); leaving it alone. Fix it and re-run." % (path, exc))
hooks = settings.setdefault("hooks", {})
wanted = {
    "UserPromptSubmit": {"hooks": [{"type": "command", "command": "bash tools/mdl-checks/hooks/remind-skills.sh"}]},
    # 180s: the precheck copies the model and runs mx check on it (~6s on a small app).
    "PreToolUse": {"matcher": "Bash", "hooks": [{"type": "command", "command": "bash tools/mdl-checks/hooks/before-mxcli-exec.sh", "timeout": 180}]},
    "PostToolUse": {"matcher": "Bash", "hooks": [{"type": "command", "command": "bash tools/mdl-checks/hooks/after-mxcli-exec.sh"}]},
}
for event, entry in wanted.items():
    existing = hooks.setdefault(event, [])
    if not any(json.dumps(e, sort_keys=True) == json.dumps(entry, sort_keys=True) for e in existing):
        existing.append(entry)
json.dump(settings, open(path, "w"), indent=2)
PY_MERGE
ui_done "Claude hooks" "3 $I_ARROW .claude/settings.local.json"
ignore_credential_files

# Codex: PostToolUse ignores plain stdout, so it gets an adapter.
ui_begin "registering Codex hooks"
mkdir -p "$APP/.codex"

# An untrusted hook cannot ask to be trusted: add a first-turn reminder unless developer_instructions exist.
codex_reminder="$("$PY" - "$APP/.codex/config.toml" <<'PY_CODEX_CONFIG'
import os, re, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        existing = handle.read()
except FileNotFoundError:
    existing = ""

if re.search(r"(?m)^[ \t]*developer_instructions[ \t]*=", existing):
    print("existing")
    raise SystemExit(0)

reminder = '''# Codex hook trust reminder
developer_instructions = """
After the first user prompt in each new Codex session for this repository, include one short reminder to open `/hooks` and review or trust the project hooks if they are new or changed. Do not repeat the reminder later in the same session.
"""

'''
with open(path, "w", encoding="utf-8") as handle:
    handle.write(reminder)
    handle.write(existing)
print("added")
PY_CODEX_CONFIG
)"

"$PY" - "$APP/.codex/hooks.json" <<'PY_CODEX_MERGE'
import json, os, sys

path = sys.argv[1]
if os.path.exists(path):
    try:
        with open(path) as handle:
            settings = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit("invalid existing %s: %s" % (path, exc))
else:
    settings = {}

settings.setdefault("description", "Mendix MDL skills and delivery gates")
hooks = settings.setdefault("hooks", {})
# A project-relative path, like Claude's and Cursor's. The `$(git rev-parse ...)`
# this used to embed only expands if the host runs hook commands through a POSIX
# shell -- under a native Windows Codex it is literal text. All three scripts
# resolve the repo root themselves anyway.
root = 'tools/mdl-checks/hooks'
wanted = {
    "UserPromptSubmit": {
        "hooks": [{
            "type": "command",
            "command": 'bash %s/remind-skills-codex.sh' % root,
            "timeout": 60,
        }],
    },
    "PostToolUse": {
        "matcher": "^Bash$",
        "hooks": [{
            "type": "command",
            "command": 'bash %s/after-mxcli-exec-codex.sh' % root,
            "timeout": 120,
        }],
    },
    "Stop": {
        "hooks": [{
            "type": "command",
            "command": 'bash %s/stop-gate-codex.sh' % root,
            "timeout": 600,
        }],
    },
}
for event, entry in wanted.items():
    existing = hooks.setdefault(event, [])
    # An earlier install registered the same script through an embedded
    # `$(git rev-parse ...)`. Drop any registration of this script before adding the
    # new one, so an upgrade replaces it instead of firing the hook twice.
    script = entry["hooks"][0]["command"].rsplit("/", 1)[-1].rstrip('"')
    existing[:] = [
        candidate for candidate in existing
        if not any(
            str(handler.get("command", "")).rstrip('"').endswith(script)
            for handler in candidate.get("hooks", [])
        )
    ]
    existing.append(entry)

with open(path, "w") as handle:
    json.dump(settings, handle, indent=2)
    handle.write("\n")
PY_CODEX_MERGE
ui_done "Codex hooks" "3 $I_ARROW .codex/hooks.json"

# Cursor reads neither .claude/rules nor .ai-context: an alwaysApply .mdc rule plus three adapter hooks.
ui_begin "registering Cursor hooks"
mkdir -p "$APP/.cursor/rules"
cp "$SRC/rules/mdl-skills.mdc" "$APP/.cursor/rules/mdl-skills.mdc"

"$PY" - "$APP/.cursor/hooks.json" <<'PY_CURSOR_MERGE'
import json, os, sys

path = sys.argv[1]
if os.path.exists(path):
    try:
        with open(path) as handle:
            settings = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit("invalid existing %s: %s" % (path, exc))
else:
    settings = {}

settings.setdefault("version", 1)
hooks = settings.setdefault("hooks", {})
# `bash <path>`, not `./<path>`: on Windows a .sh file is not executable, and the
# shebang means nothing to the shell Cursor spawns.
root = "tools/mdl-checks/hooks"
wanted = {
    "sessionStart": {"command": "bash %s/remind-skills-cursor.sh" % root, "timeout": 30},
    # Before an `mxcli exec`: mx check on a copy of the model, denying an exec that would break the build.
    "beforeShellExecution": {"command": "bash %s/before-mxcli-exec-cursor.sh" % root, "timeout": 180},
    "postToolUse": {"command": "bash %s/after-mxcli-exec-cursor.sh" % root, "timeout": 120},
    # loop_limit caps the auto-submitted follow-ups; the marker is cleared on green,
    # so a session that fixes its failures stops looping before reaching it.
    "stop": {"command": "bash %s/stop-gate-cursor.sh" % root, "timeout": 600, "loop_limit": 5},
}
for event, entry in wanted.items():
    existing = hooks.setdefault(event, [])
    # An earlier install registered the same script as `./tools/...`, which does not
    # run on Windows. Drop any registration of this script before adding the new one,
    # so the upgrade replaces it instead of firing the hook twice.
    script = entry["command"].rsplit("/", 1)[-1]
    existing[:] = [
        candidate for candidate in existing
        if not str(candidate.get("command", "")).endswith(script)
    ]
    existing.append(entry)

with open(path, "w") as handle:
    json.dump(settings, handle, indent=2)
    handle.write("\n")
PY_CURSOR_MERGE
ui_done "Cursor hooks" "4 $I_ARROW .cursor/hooks.json, 1 rule $I_ARROW .cursor/rules/"

# OpenCode: one plugin (mutable payloads, no exit codes); rules via opencode.json "instructions".
ui_begin "installing the OpenCode plugin"
mkdir -p "$APP/.opencode/plugin"
cp "$SRC/plugins/mendix-mdl-harness.js" "$APP/.opencode/plugin/"

"$PY" - "$APP/opencode.json" <<'PY_OPENCODE'
import json, os, sys

path = sys.argv[1]
if os.path.exists(path):
    try:
        with open(path) as handle:
            config = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit("invalid existing %s: %s" % (path, exc))
else:
    config = {}

config.setdefault("$schema", "https://opencode.ai/config.json")
instructions = config.setdefault("instructions", [])
for entry in (".claude/rules/mdl-skills.md", "tools/mdl-checks/syntax-digest.md"):
    if entry not in instructions:
        instructions.append(entry)

with open(path, "w") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
PY_OPENCODE
ui_done "OpenCode plugin" "1 $I_ARROW .opencode/plugin/, rules $I_ARROW opencode.json"

# Pi: one extension -- tool_call blocks a failing exec, tool_result appends the coverage report,
# agent_before_settle asks for one more turn on a red gate, and before_agent_start puts the rules
# into the system prompt. Measured on Pi 0.87.1, a .pi/AGENTS.md never reached the model, so the
# rules travel with the extension; an earlier install's .pi/AGENTS.md is removed when it is ours.
# Skills need nothing -- Pi reads the Agent Skills layout this installer already writes to .agents/skills/.
ui_begin "installing the Pi extension"
mkdir -p "$APP/.pi/extensions"
cp "$SRC/plugins/mendix-mdl-harness.pi.js" "$APP/.pi/extensions/mendix-mdl-harness.js"
if [ -f "$APP/.pi/AGENTS.md" ] && head -3 "$APP/.pi/AGENTS.md" | grep -q 'The rules for building in this app are in `.claude/rules/mdl-skills.md`'; then
  rm -f "$APP/.pi/AGENTS.md"
fi
ui_done "Pi extension" "1 $I_ARROW .pi/extensions/ (rules in the system prompt)"

# --- 15. Step: install the test harness ---
# Core scripts are upgraded in place; other files are copied only when absent. verify-*.test.sh are the app's own.
ui_begin "installing the test harness"
mkdir -p "$APP/tests"
suite_written=0
for source_file in "$SRC"/tests/*; do
  name="$(basename "$source_file")"
  target="$APP/tests/$name"
  case "$name" in
    gate.sh|orient.sh|diagnose.sh|precheck.sh|peek.sh|lib.sh|portable.sh|scenario-helpers.js|gate) ;;
    *) if [ -e "$target" ]; then continue; fi ;;
  esac
  if [ -d "$source_file" ]; then
    # tests/gate/: the gate's steps, upgraded in place like gate.sh.
    mkdir -p "$target" && cp -R "$source_file"/. "$target"/
    suite_written=$((suite_written + 1))
    continue
  fi
  cp "$source_file" "$target"
  chmod +x "$target" 2>/dev/null || true
  suite_written=$((suite_written + 1))
done

# Rewrite old test comparisons against True/False: lib.sh's field() now prints true/false.
migrated=""
for script in "$APP"/tests/verify-*.test.sh; do
  [ -f "$script" ] || continue
  if grep -qE '= "(True|False)"' "$script" 2>/dev/null; then
    perl -pi -e 's/= "True"/= "true"/g; s/= "False"/= "false"/g' "$script" 2>/dev/null \
      && migrated="$migrated $(basename "$script")"
  fi
done
[ -z "$migrated" ] || ui_note "field() booleans are now true/false; rewrote the comparison in:$migrated"

# LF line endings: CRLF breaks bash scripts.
if [ ! -e "$APP/.gitattributes" ] && [ -f "$SRC/.gitattributes" ]; then
  cp "$SRC/.gitattributes" "$APP/.gitattributes"
fi
ui_done "test harness" "$suite_written $I_ARROW tests/  (verify-*.test.sh left alone)"

# The syntax digest, now rather than at the first orient: Claude Code reads .claude/rules/ only
# when a session starts, so a digest written during the first session would reach only the
# second. Same function orient.sh calls; best effort -- a missing or old mxcli skips it.
if [ -x "$APP/mxcli$EXE" ] && [ -f "$APP/tests/portable.sh" ]; then
  ( cd "$APP" && MXCLI="./mxcli$EXE" && . tests/portable.sh && mdl_syntax_digest ) >/dev/null 2>&1 || true
fi

# --- 16. Step: record the install, then check the environment ---
# INSTALL.json lets the gate detect stale or locally edited harness files.
ui_begin "recording the install"
recorded="$("$PY" "$APP/tools/mdl-checks/record_install.py" "$APP" "$SRC" "$version" 2>/dev/null || true)"
ui_done "install record" "${recorded:-0} files $I_ARROW tools/mdl-checks/INSTALL.json"

ui_begin "checking the environment"

# Repair a .playwright/cli.config.json that pins chromium to a path that does not exist.
playwright_config="$APP/.playwright/cli.config.json"
browser_fixed=""
if [ -f "$playwright_config" ]; then
  browser_fixed="$("$PY" - "$playwright_config" <<'PY_BROWSER'
import glob, json, os, sys

path = sys.argv[1]
try:
    config = json.load(open(path))
except Exception:
    sys.exit(0)
options = config.get("browser", {}).get("launchOptions", {})
current = options.get("executablePath")
if not current or os.path.exists(current):
    sys.exit(0)
# Prefer a headless shell Playwright has already downloaded; otherwise let it choose.
roots = [
    os.path.expanduser("~/Library/Caches/ms-playwright"),   # macOS
    os.path.expanduser("~/.cache/ms-playwright"),           # Linux
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "ms-playwright"),  # Windows
]
candidates = []
for root in roots:
    if not root:
        continue
    for suffix in ("chrome-headless-shell", "chrome-headless-shell.exe"):
        candidates += sorted(glob.glob(os.path.join(
            root, "chromium_headless_shell-*", "chrome-headless-shell-*", suffix)))
if candidates:
    options["executablePath"] = candidates[-1]
    replacement = candidates[-1]
else:
    options.pop("executablePath", None)
    replacement = "Playwright's own browser"
json.dump(config, open(path, "w"), indent=2)
print("%s -> %s" % (current, replacement))
PY_BROWSER
)"
fi

# Report a missing mxbuild for the project's version now, not halfway through a gate.
mxbuild_note=""
mxbuild_note="$("$PY" - "$APP" "$IS_WINDOWS" <<'PY_MXBUILD'
import glob, os, sqlite3, sys

app = sys.argv[1]
mprs = glob.glob(os.path.join(app, "*.mpr"))
if not mprs:
    sys.exit(0)
try:
    con = sqlite3.connect("file:%s?mode=ro" % mprs[0], uri=True)
    version = con.execute("select * from _MetaData limit 1").fetchone()[1]
except Exception:
    sys.exit(0)
cached = os.path.expanduser("~/.mxcli/mxbuild/%s" % version)
if sys.argv[2] == "1":
    # Studio Pro installs in two places; 10.x and 11.x default to the per-user one.
    roots = [os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "Mendix"),
             os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Mendix")]
    cached = ""
    for root in roots:
        if not root:
            continue
        candidate = os.path.join(root, version, "modeler")
        if os.path.isdir(candidate):
            cached = candidate
            break
    cached = cached or os.path.join(roots[0], version, "modeler")
if not os.path.isdir(cached):
    if os.name == "nt" or sys.argv[2] == "1":
        print("Mendix %s: `mx check` needs Studio Pro %s -- the Mendix CDN's mxbuild is "
              "Linux-only, so `mxcli setup mxbuild` cannot help here." % (version, version))
    else:
        print("Mendix %s, no mxbuild cached -- `mx check` will not run until: "
              "./mxcli setup mxbuild -p %s" % (version, os.path.basename(mprs[0])))
PY_MXBUILD
)"

ui_done "environment" "checked"

# --- 17. Summary: what landed, what is still missing, what to do next ---
ui_clear
printf '\n  %s%s Installed mx-codr %s%s\n' "$C_GREEN" "$I_OK" "$version" "$C_RESET"
printf '  %s  %s %s%s\n' "$C_GREY" "$I_ARROW" "$APP" "$C_RESET"

ui_head "$I_BOX" "What landed"
if [ -n "${created_app:-}" ]; then
  ui_row "app" "1" "$created_app  ${C_GREY}(created empty, Mendix ${mx_version:-?})${C_RESET}"
fi
ui_row "skills"   "$installed_skills" ".claude/skills  .agents/skills  .ai-context/skills"
ui_row "lint"     "$rules"            ".claude/lint-rules/"
ui_row "checkers" "$checks"           "tools/mdl-checks/  ${C_GREY}(VERSION $version)${C_RESET}"
ui_row "rule"     "1"                 ".claude/rules/mdl-skills.md  ${C_GREY}(every session)${C_RESET}"
ui_row "hooks"    "3"                 ".claude/settings.local.json  ${C_GREY}(Claude)${C_RESET}"
ui_row "hooks"    "3"                 ".codex/hooks.json  ${C_GREY}(Codex)${C_RESET}"
ui_row "hooks"    "4"                 ".cursor/hooks.json  ${C_GREY}(Cursor, + .cursor/rules/)${C_RESET}"
ui_row "plugin"   "1"                 ".opencode/plugin/  ${C_GREY}(OpenCode, + opencode.json)${C_RESET}"
ui_row "extension" "1"                ".pi/extensions/  ${C_GREY}(Pi, rules included)${C_RESET}"
if [ "$codex_reminder" = "added" ]; then
  ui_row "reminder" "1"               ".codex/config.toml  ${C_GREY}(after the first prompt)${C_RESET}"
else
  printf '     %s%-10s%s %s%3s%s  %s\n' "$C_YELLOW" "reminder" "$C_RESET" "$C_BOLD" "$I_WARN" "$C_RESET" \
    ".codex/config.toml already defines developer_instructions, left alone"
fi
if [ -n "${recorded:-}" ]; then
  ui_row "record" "$recorded"         "tools/mdl-checks/INSTALL.json  ${C_GREY}(the gate checks for drift)${C_RESET}"
fi
if [ "$suite_written" -gt 0 ]; then
  ui_row "harness" "$suite_written"   "tests/  ${C_GREY}(verify-*.test.sh are yours to write)${C_RESET}"
else
  ui_row "harness" "0"                "tests/ already had them, nothing overwritten"
fi
if [ -n "$browser_fixed" ]; then
  ui_row "repaired" "1"               ".playwright/cli.config.json  ${C_GREY}browser path${C_RESET}"
fi
if [ "$DEPS_INSTALLED" -gt 0 ]; then
  ui_row "deps"     "$DEPS_INSTALLED" "prerequisites installed  ${C_GREY}(log: $DEPS_LOG)${C_RESET}"
fi
if [ -n "${no_docker_mode:-}" ]; then
  ui_row "mx check" "1"               "local  ${C_GREY}($no_docker_mode + PostgreSQL, tests/harness.env)${C_RESET}"
fi

if [ -n "$mxbuild_note" ]; then
  printf '\n  %s%s%s %s\n' "$C_YELLOW" "$I_WARN" "$C_RESET" "$mxbuild_note"
fi

# Missing tools last, each with the command that fixes it.
if [ "${#DEPS_MISSING[@]}" -gt 0 ]; then
  printf '\n  %s%s Still missing%s\n' "$C_BOLD" "$I_WARN" "$C_RESET"
  for line in "${DEPS_MISSING[@]}"; do
    printf '     %s%s%s\n' "$C_YELLOW" "$line" "$C_RESET"
  done
  if [ "$WITH_DEPS" = "0" ]; then
    printf '     %s%s%s\n' "$C_GREY" "re-run with --with-deps to have these installed for you" "$C_RESET"
  fi
fi

ui_head "$I_PLAY" "Next"
printf '     %-38s %s%s%s\n' "bash tests/orient.sh" "$C_GREY" "what is in this app, and its state" "$C_RESET"
printf '     %-38s %s%s%s\n' "bash tests/gate.sh --boot-if-needed" "$C_GREY" "suite + mx check, lint, coverage, naming, layout" "$C_RESET"
printf '     %-38s %s%s%s\n' "bash tests/gate.sh --only <feature>" "$C_GREY" "one script, warm browser, red loop" "$C_RESET"
printf '     %-38s %s%s%s\n' "bash tests/diagnose.sh <Entity> <user>" "$C_GREY" "why is that row not on the page" "$C_RESET"

ui_head "$I_DOT" "Good to know"
printf '     %s%s\n' "$C_BOLD" "Start a NEW agent session before building anything here.${C_RESET}"
printf '     %s\n' "An agent's skill list is fixed when its session starts, so the skills this installer"
printf '     %s\n' "just wrote are invisible to the session that ran it. Measured: a session that installed"
printf '     %s\n' "and then built without restarting read twelve SKILL.md files by hand -- 216k characters,"
printf '     %s\n' "36 commands, 6.5 minutes -- before its first real command. After a restart: 8 commands."
printf '     %s\n' "Codex will not fire its hooks until you open ${C_BOLD}/hooks${C_RESET} once and trust them."
printf '     %s\n' "Cursor needs hooks enabled for this workspace before ${C_BOLD}.cursor/hooks.json${C_RESET} runs."
printf '     %s\n' "OpenCode loads ${C_BOLD}.opencode/plugin/${C_RESET} at startup; restart an open session to pick it up."
printf '     %s\n' "Pi loads ${C_BOLD}.pi/extensions/${C_RESET} once the project is trusted; restart an open session to pick it up."
printf '     %s\n' "Write your own tests/verify-<feature>.test.sh -- the ${C_BOLD}test-first-delivery${C_RESET} skill has a"
printf '     %s\n' "complete example, and $SRC/examples/ holds eight from the demo app."
printf '\n'
