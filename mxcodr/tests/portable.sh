#!/usr/bin/env bash
# tests/portable.sh -- platform shims and shared helpers (macOS, Linux, Git Bash on Windows).
# Sourced by gate.sh, lib.sh, orient.sh, diagnose.sh, precheck.sh, theme.sh, run-app.sh,
# run-docker.sh and marketplace-login.sh; not run on its own.
# Provides: $MXCLI, $NODE, $MDL_SHELL_HELPERS, mdl_find_node, $PY and mdl_find_python (older
# project tests only), mdl_load_harness_env, mdl_json_object,
#   mdl_json_string, mdl_json_number, mdl_ere_quote, mdl_runtime_running, mdl_check_local_database,
#   mdl_check_mxcli_freshness, mdl_check_install_freshness, mdl_syntax_digest, mdl_studio_pro_open,
#   mdl_studio_pro_warning, mdl_tmpdir, mdl_tmpfile, mdl_find_mpr, mdl_user_modules.
# Sourcing it also loads tests/harness.env as data (never sourced) and repairs JAVA_HOME.
# Inputs: MXCLI, PY, PORTABLE_APP_DIR, APP_DIR, LOCALAPPDATA. Nothing else is exported.

# --- 1. Find mxcli ---
# A preset MXCLI wins. _mdl_* variables are unset after use: this file is sourced.
_mdl_base="${PORTABLE_APP_DIR:-.}"
if [ -n "${MXCLI:-}" ]; then
  :
elif [ -x "$_mdl_base/mxcli" ]; then
  MXCLI="$_mdl_base/mxcli"
elif [ -x "$_mdl_base/mxcli.exe" ]; then
  MXCLI="$_mdl_base/mxcli.exe"
else
  MXCLI="$_mdl_base/mxcli"
fi
unset _mdl_base

# --- 2. Find Python, Node and the rulebook ---
# Python: older projects' own verify-*.test.sh call "$PY"; the harness itself runs on Node.
# A candidate must actually run (the Windows Store python3 stub does not); also searches
# the Windows install dirs, since the python.org installer leaves PATH alone.
mdl_find_python() {
  local candidate
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  # The python.org installer (also via winget) does not add Python to PATH; search its install dirs too.
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

# Prints a node that runs. The hooks that need it carry a copy; keep them the same.
mdl_find_node() {
  if command -v node >/dev/null 2>&1; then
    printf 'node\n'
    return 0
  fi
  # The Node.js installer (also via winget) puts node on PATH only for shells started after it.
  local local_app="${LOCALAPPDATA:-}" candidate
  local_app="${local_app//\\//}"
  for candidate in "/c/Program Files/nodejs/node.exe" "$local_app/Programs/nodejs/node.exe"; do
    [ -x "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

# The harness itself no longer runs Python (2026-10-05). PY stays for project tests written before
# that which call "$PY"; new tests use the lib helpers (field, oql_value, ...) or node.
# A preset PY wins; fall back to `python3` so such a test names the command it misses.
if [ -z "${PY:-}" ]; then
  PY="$(mdl_find_python || true)"
  PY="${PY:-python3}"
fi
# The checks run on Node. A preset NODE wins; fall back to `node` so later errors name a command.
if [ -z "${NODE:-}" ]; then
  NODE="$(mdl_find_node || true)"
  NODE="${NODE:-node}"
fi
# The small jobs of the test scripts (read a JSON field, decode OQL output, ...): installed in
# tools/mdl-checks/, in the bundle under checks/.
# `|| true`: a script under set -e must not stop when one of the two places is missing.
MDL_SHELL_HELPERS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tools/mdl-checks/shell_helpers.cjs" || true
[ -f "$MDL_SHELL_HELPERS" ] || MDL_SHELL_HELPERS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../checks" 2>/dev/null && pwd)/shell_helpers.cjs" || true
MDL_RULEBOOK="$(dirname "$MDL_SHELL_HELPERS")/rulebook.cjs"

# The rulebook: tests/rulebook/, one card per rule, the one place a rule's level (block, warn,
# info, off) and the person's exceptions come from. The gate copies it to $WORK/rulebook so every
# parallel step reads the same version; outside the gate (precheck, hooks) the folder itself is read.
# An app installed before the rulebook has none: every rule then keeps its built-in level.
mdl_rulebook_dir() {
  if [ -n "${WORK:-}" ] && [ -d "$WORK/rulebook" ]; then printf '%s\n' "$WORK/rulebook"
  elif [ -d tests/rulebook ]; then printf 'tests/rulebook\n'
  else return 1; fi
}
mdl_rulebook() {   # mdl_rulebook <command> [arg] -- rulebook.cjs on the rulebook dir; false without one
  local dir
  dir="$(mdl_rulebook_dir)" || return 1
  [ -f "$MDL_RULEBOOK" ] || return 1
  "$NODE" "$MDL_RULEBOOK" "$dir" "$@"
}
mdl_rule_level() {   # mdl_rule_level <CODE> [<default>] -- the effective level, the default without a rulebook
  local level
  level="$(mdl_rulebook level "$1" 2>/dev/null)" && [ -n "$level" ] && { printf '%s\n' "$level"; return 0; }
  printf '%s\n' "${2:-block}"
}
# mdl_rule_mode CODE... -- the old switch value for a group of codes: error when any is block, 0 when
# every one is off, else warn (what step_visual and step_runtime_errors used to read from MDL_*).
mdl_rule_mode() {
  local code level any_block=0 all_off=1
  for code in "$@"; do
    level="$(mdl_rule_level "$code" warn)"
    [ "$level" = "block" ] && any_block=1
    [ "$level" = "off" ] || all_off=0
  done
  if [ "$any_block" = "1" ]; then echo error; elif [ "$all_off" = "1" ]; then echo 0; else echo warn; fi
}
# mdl_rule_args <step> -- `--levels <json> --except <json>` for a checker, one word per line (read into
# an array); nothing without a rulebook, so the checker keeps its built-in levels.
mdl_rule_args() {
  local levels excepts
  levels="$(mdl_rulebook overrides "$1" 2>/dev/null)" || return 0
  excepts="$(mdl_rulebook excepts "$1" 2>/dev/null)" || return 0
  printf -- '--levels\n%s\n--except\n%s\n' "${levels:-{\}}" "${excepts:-{\}}"
}

# --- 3. Load tests/harness.env ---
# Parsed as allowlisted KEY=value, never sourced: sourcing would run shell from the project
# tree. Values are literal, one layer of quotes stripped. Usage: <file> [export].
mdl_load_harness_env() {
  local file="$1" mode="${2:-}" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    [ "$key" != "$line" ] || continue          # no '=' on the line
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"       # trim surrounding blanks
    key="${key%"${key##*[![:space:]]}"}"
    case "$key" in
      MDL_NO_DOCKER|MDL_MXBUILD_PATH|MDL_DB_HOST|MDL_DB_NAME|MDL_DB_USER|MDL_DB_PASSWORD| \
      MDL_PSQL|MDL_BOOT_COMMAND|MDL_PRECHECK|MDL_ALLOW_GREEN_FIRST|JAVA_HOME|MX_VERSION| \
      MDL_REQUIRE_PRODUCTION|MDL_GATE_CACHE|MDL_VISUAL|MDL_VISUAL_REVIEW|MDL_RUNTIME_ERRORS| \
      MDL_RUN_MODE|APP_PORT|ADMIN_PORT|MDL_CAPTIONS|MDL_CLOSE_BROWSER|MDL_SCOPE|MDL_MARKETPLACE_LOGIN| \
      MDL_TEST_FIRST|MDL_WIDGET_NAMES|MDL_KEEP_UNUSED|MDL_UNTESTED|MDL_PATHS|MDL_DB_RESET) ;;
      *) continue ;;
    esac
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    # printf -v assigns without eval.
    printf -v "$key" '%s' "$value"
    if [ "$mode" = "export" ]; then export "${key?}"; fi
  done < "$file"
  # Callers run under set -e: never return the loop's false status.
  return 0
}

_mdl_harness_env="$(dirname "${BASH_SOURCE[0]}")/harness.env"
mdl_load_harness_env "$_mdl_harness_env"
unset _mdl_harness_env

# A port is digits and nothing else. Bash runs a command substitution it finds inside $(( )):
# APP_PORT=x[$(command)] in tests/harness.env ran that command in every script that sources this
# file, and APP_PORT=1@host sent the test password to that host (audit of 2026-10-04). A value
# that is not a port is dropped, and said so, wherever it came from.
for _mdl_port in APP_PORT ADMIN_PORT; do
  case "${!_mdl_port:-}" in
    '') ;;
    *[!0-9]*|??????*)
      echo "tests/portable.sh: $_mdl_port is not a port number (digits only) -- ignored; fix it in tests/harness.env" >&2
      unset "$_mdl_port" ;;
  esac
done
unset _mdl_port

# A second project runs beside the first with APP_PORT=8082 in its tests/harness.env: locally its
# admin API follows, APP_PORT+9 (8081 and 8090 by default).
if [ "${MDL_RUN_MODE:-}" != "docker" ] && [ -n "${APP_PORT:-}" ] && [ -z "${ADMIN_PORT:-}" ]; then
  ADMIN_PORT=$(( APP_PORT + 9 ))
fi

# Docker mode (MDL_RUN_MODE=docker, tests/run-docker.sh): every port is shifted by APP_PORT-8080,
# so the containers' admin API is APP_PORT+10, with the password of the stack mxcli wrote. A
# build can take minutes on the first start (images are downloaded), so the boot waits longer.
if [ "${MDL_RUN_MODE:-}" = "docker" ]; then
  ADMIN_PORT="${ADMIN_PORT:-$(( ${APP_PORT:-8081} + 10 ))}"
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    ADMIN_PASSWORD="$(sed -n 's/^M2EE_ADMIN_PASS=//p' "$(dirname "${BASH_SOURCE[0]}")/../.docker/.env" 2>/dev/null | head -1)"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-AdminPassword1!}"
  fi
  BOOT_TIMEOUT="${BOOT_TIMEOUT:-600}"
  # mxcli names the compose project after the .docker folder, so every app shared one set of
  # containers and one database volume. Name it after this app instead.
  if [ -z "${COMPOSE_PROJECT_NAME:-}" ]; then
    COMPOSE_PROJECT_NAME="mx-$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" \
      | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')"
  fi
  export ADMIN_PORT ADMIN_PASSWORD COMPOSE_PROJECT_NAME
fi

# --- 4. Quoting helpers: keep values from becoming code in generated JSON, JS or regex ---
mdl_json_object() {   # mdl_json_object k1 v1 k2 v2 ... -> {"k1":"v1",...}
  "$NODE" "$MDL_SHELL_HELPERS" json-object "$@"
}

mdl_json_string() {   # mdl_json_string <text> -> "text", escaped for JS source
  "$NODE" "$MDL_SHELL_HELPERS" json-string "$1"
}

mdl_ere_quote() {     # mdl_ere_quote <text> -- match it literally inside an ERE
  printf '%s' "$1" | sed 's/[][^$.*+?(){}|\\]/\\&/g'
}

mdl_json_number() {   # mdl_json_number <value> <fallback> -- digits only, never code
  case "$1" in
    ''|*[!0-9]*) printf '%s\n' "$2" ;;
    *)           printf '%s\n' "$1" ;;
  esac
}

# --- 5. JAVA_HOME repair ---
# A JAVA_HOME pointing at the JDK's bin/ breaks "$JAVA_HOME/bin/java"; strip the last part.
if [ -n "${JAVA_HOME:-}" ]; then
  _mdl_jh="${JAVA_HOME//\\//}"
  if [ ! -x "$_mdl_jh/bin/java" ] && [ ! -x "$_mdl_jh/bin/java.exe" ]; then
    if [ -x "$_mdl_jh/java" ] || [ -x "$_mdl_jh/java.exe" ]; then
      # By hand: dirname mangles backslash paths.
      case "$JAVA_HOME" in
        *\\*) JAVA_HOME="${JAVA_HOME%\\*}" ;;
        */*)   JAVA_HOME="${JAVA_HOME%/*}" ;;
      esac
      export JAVA_HOME
    fi
  fi
  unset _mdl_jh
fi

# --- 6. Local database check ---
# True while a Mendix runtime runs, and when that cannot be told: a lock is called stale only
# when nothing runs. Git Bash has no pgrep, and the warning said "stale, rm it" beside a running app.
mdl_runtime_running() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f 'runtimelauncher' >/dev/null 2>&1
    return
  fi
  command -v powershell.exe >/dev/null 2>&1 || return 0
  powershell.exe -NoProfile -Command '
    try { $p = Get-CimInstance Win32_Process -ErrorAction Stop } catch { exit 0 }
    if ($p | Where-Object { $_.Name -eq "java.exe" -and $_.CommandLine -like "*runtimelauncher*" }) { exit 0 }
    exit 1' >/dev/null 2>&1
  [ $? != 1 ]
}

# Warns (prints only) about a stale HSQLDB lock or a half-written database; both break a boot.
mdl_check_local_database() {
  local base="${1:-${APP_DIR:-.}/deployment/data/database}"
  [ -d "$base" ] || return 0
  command -v find >/dev/null 2>&1 || return 0

  local lock
  lock="$(find "$base" -name '*.lck' -type f 2>/dev/null | head -1)"
  if [ -n "$lock" ]; then
    # A lock is stale only when no runtime is running.
    if ! mdl_runtime_running; then
      echo "   !! a stale database lock is left over from a killed runtime:"
      echo "      ${lock#${APP_DIR:-.}/}"
      echo "      nothing is running now, so it only blocks the next boot:  rm '$lock'"
    fi
  fi

  local script
  script="$(find "$base" -name 'default.script' -type f 2>/dev/null | head -1)"
  [ -n "$script" ] || return 0
  grep -q 'CREATE MEMORY TABLE PUBLIC."mendixsystem\$version"' "$script" 2>/dev/null || return 0
  grep -q 'INSERT INTO "mendixsystem\$version"' "$script" 2>/dev/null && return 0
  local database_dir
  database_dir="$(dirname "$(dirname "$script")")"
  echo "   !! the local HSQLDB is half-written: deployment/data/database holds the version"
  echo "      table but no row in it, so a boot fails on mendixsystem\$version. A deploy"
  echo "      build cleaned deployment/ underneath it. It holds demo data only -- move it"
  echo "      aside and let the runtime build a fresh one, then reseed through the app:"
  echo "      mv '$database_dir' '$database_dir.broken-$(date +%H%M%S)'"
}

# --- 7. Install freshness ---
# Warns (prints only) when harness files differ from tools/mdl-checks/INSTALL.json checksums,
# or a newer bundle (mxcodr/, or dist/ in older copies) sits in the project.
# mdl_check_mxcli_freshness -- the app's mxcli against the build this harness was validated
# with (tools/mdl-checks/MXCLI_TESTED, "<version> <build-date>", written by install.sh).
#
# Measured on one session: an app left on v0.22.0 spent 8 minutes probing a page build
# error that the newer check refuses outright, by name (MDL-WIDGET25). The installer
# offers the newer binary only while it runs; nothing said so at the start of a later
# session. This prints one line, and what to run -- the session must not swap the binary.
mdl_check_mxcli_freshness() {
  local app="${APP_DIR:-.}"
  local tested="$app/tools/mdl-checks/MXCLI_TESTED"
  local out have_ver have_date want_ver want_date bundle="" candidate
  [ -f "$tested" ] || return 0
  read -r want_ver want_date < "$tested" || return 0
  [ -n "$want_date" ] || return 0
  out="$("${MXCLI:-./mxcli}" --version 2>/dev/null | head -1)" || out=""
  have_ver="$(printf '%s' "$out" | sed -n 's/^mxcli version \([^ ]*\).*/\1/p')"
  have_date="$(printf '%s' "$out" | sed -n 's/.*(\([0-9][0-9-]*T[0-9:]*Z\)).*/\1/p')"
  if [ -z "$have_date" ]; then
    echo "   mxcli: could not read ./mxcli --version; this harness was validated with $want_ver"
    return 0
  fi
  echo "   mxcli $have_ver (built ${have_date%%T*})"
  [ "$have_ver" = "$want_ver" ] && return 0
  for candidate in mxcodr dist; do
    if [ -f "$app/$candidate/install.sh" ]; then bundle="$candidate"; break; fi
  done
  # ISO build dates compare correctly as strings.
  if [[ "$have_date" < "$want_date" ]]; then
    echo "   !! ./mxcli is older than $want_ver, the mxcli this harness works with."
    echo "      An older check misses errors the newer one names at check time, so they surface at the build instead."
  else
    echo "   !! ./mxcli is not $want_ver, the mxcli this harness works with: a newer one can describe the"
    echo "      model in a form the gate's checks do not read yet, and they then pass what they should fail."
  fi
  echo "      Swap it before building:  bash ${bundle:-mxcodr}/install.sh .   (it puts $want_ver in ./mxcli)"
}

mdl_check_install_freshness() {
  local app="${APP_DIR:-.}"
  local manifest="$app/tools/mdl-checks/INSTALL.json"
  local installed="$app/tools/mdl-checks/VERSION"
  local node="${NODE:-$(mdl_find_node || true)}"
  local bundle="" candidate
  for candidate in mxcodr dist; do
    if [ -f "$app/$candidate/VERSION" ]; then bundle="$candidate"; break; fi
  done

  [ -n "$node" ] || return 0

  if [ ! -f "$manifest" ]; then
    # No manifest: say so, since silence would read as a clean result.
    if [ -f "$installed" ] && [ -n "$bundle" ]; then
      echo "   !! no tools/mdl-checks/INSTALL.json, so harness drift cannot be detected here."
      local installed_version bundle_version newest
      installed_version="$(cat "$installed" 2>/dev/null)" || true
      bundle_version="$(cat "$app/$bundle/VERSION")" || true
      # Numeric per-field version sort: is the bundle older than the install?
      newest="$(printf '%s\n%s\n' "$installed_version" "$bundle_version" | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1)"
      if [ "$newest" = "$installed_version" ] && [ "$installed_version" != "$bundle_version" ]; then
        echo "      $bundle/ is older than what is installed ($bundle_version vs $installed_version); refresh $bundle/ first, then:  bash $bundle/install.sh ."
      else
        echo "      This install predates the record (VERSION says $installed_version):  bash $bundle/install.sh ."
      fi
    fi
    return 0
  fi

  "$NODE" "$MDL_SHELL_HELPERS" install-freshness "$app" "$manifest"
}

# --- 8. The syntax digest, Studio Pro holding the project, temporary files ---
# The syntax sessions look up most, from THIS project's mxcli, written once per mxcli version.
# Measured on three sessions: 22, 25 and 19 `./mxcli syntax` calls each, the same topics every
# time; a fourth listed the digest's table of contents and still asked 165 times, so a file to
# read is not enough -- the digest goes where each host loads instructions by itself:
#   .claude/rules/mdl-syntax-digest.md    Claude Code, at session start
#   .cursor/rules/mdl-syntax-digest.mdc   Cursor, alwaysApply
#   tools/mdl-checks/syntax-digest.md     OpenCode (opencode.json lists it), Pi (the extension
#                                         puts it into the system prompt), anyone else (cat it)
# The first line of the canonical file records the mxcli version it came from; a topic this
# mxcli does not know is skipped. Needs MXCLI; returns 1 when there is nothing to write.
MDL_SYNTAX_DIGEST="tools/mdl-checks/syntax-digest.md"
# Measured on seven sessions (445 lookups): what sessions ask for is the INDEX pages -- the bare
# `mxcli syntax` 27 times, `syntax microflow` 51, `page` 36, `security` 16, `layout` 15 -- while the
# nineteen leaf topics the digest used to carry were looked up 10 times in 89 with the digest in the
# prompt. So the digest holds the index rows (a topic per line, which is what lets a session name
# the leaf it needs in one call), the small leaves every app writes, and the pitfalls file
# (tools/mdl-checks/mdl-pitfalls.md) on top: those, not syntax, were where the time went.
# `index` is the bare `mxcli syntax`.
MDL_SYNTAX_TOPICS="index domain-model microflow page layout security navigation integration
  security.module-role security.user-role security.demo-user security.page-access
  module page.create microflow.variables microflow.retrieve microflow.show-page microflow.control-flow"
MDL_PITFALLS="tools/mdl-checks/mdl-pitfalls.md"

mdl_syntax_digest() {
  local version topic block tmp topics
  [ -n "${MXCLI:-}" ] || return 1
  version="$("$MXCLI" --version 2>/dev/null | head -1)"
  [ -n "$version" ] || return 1
  [ -d "$(dirname "$MDL_SYNTAX_DIGEST")" ] || return 1
  # Written again when mxcli or the topic list changes (page.datasource was added to a digest
  # an installed project had already cached for its mxcli version).
  # The pitfalls' checksum is part of the key: an updated list rewrites the digest.
  topics="<!-- topics: $(echo $MDL_SYNTAX_TOPICS) pitfalls:$(cksum < "$MDL_PITFALLS" 2>/dev/null | cut -d' ' -f1) -->"
  if ! { [ -f "$MDL_SYNTAX_DIGEST" ] && [ "$(head -1 "$MDL_SYNTAX_DIGEST")" = "<!-- $version -->" ] \
         && [ "$(sed -n 2p "$MDL_SYNTAX_DIGEST")" = "$topics" ]; }; then
    tmp="$MDL_SYNTAX_DIGEST.tmp"
    {
      printf '<!-- %s -->\n%s\n' "$version" "$topics"
      printf '# MDL syntax this project looks up most\n\n'
      printf 'Generated from `./mxcli syntax <topic>` of this project, and current for its mxcli: use it\n'
      printf 'as it stands and look up only topics that are not here. The rest: `./mxcli syntax`.\n\n'
      [ -f "$MDL_PITFALLS" ] && cat "$MDL_PITFALLS"
      for topic in $MDL_SYNTAX_TOPICS; do
        if [ "$topic" = "index" ]; then out="$("$MXCLI" syntax 2>/dev/null)"; else out="$("$MXCLI" syntax "$topic" 2>/dev/null)"; fi
        # A leaf has a Syntax: block; an index page has none, and its rows (two spaces, a topic, a
        # description) are what to keep.
        block="$(printf '%s\n' "$out" | awk '/^Syntax:$/ { on = 1; next } /^[A-Z][A-Za-z ]+:$/ { on = 0 } on')"
        [ -n "$block" ] || block="$(printf '%s\n' "$out" | grep -E '^  [a-z][a-z0-9.-]+ {2,}' | sed -E 's/^  //; s/ {2,}/  /')"
        [ -n "$block" ] || continue
        printf '\n## %s\n\n```\n%s\n```\n' "$topic" "$block"
      done
    } > "$tmp" && mv "$tmp" "$MDL_SYNTAX_DIGEST" || return 1
  fi
  # The copies the hosts load by themselves, refreshed whenever they differ.
  if [ -d .claude/rules ] && ! cmp -s "$MDL_SYNTAX_DIGEST" .claude/rules/mdl-syntax-digest.md; then
    cp "$MDL_SYNTAX_DIGEST" .claude/rules/mdl-syntax-digest.md
  fi
  if [ -d .cursor/rules ]; then
    tmp="$(mdl_tmpfile mdl-digest)"
    { printf -- '---\ndescription: The MDL syntax this project looks up most, from its own mxcli\nalwaysApply: true\n---\n\n'
      cat "$MDL_SYNTAX_DIGEST"; } > "$tmp"
    cmp -s "$tmp" .cursor/rules/mdl-syntax-digest.mdc || cp "$tmp" .cursor/rules/mdl-syntax-digest.mdc
    rm -f "$tmp"
  fi
  return 0
}

# mdl_studio_pro_open <project dir> -- prints how Studio Pro holds the project, or nothing.
# Studio Pro keeps the model in memory and saves its own copy of a document over what mxcli
# wrote: on 2026-10-04 it rewrote a domain model at 19:13 and twelve indexes an exec had added
# at 18:47 were gone, model and database. "open" when lsof shows a Studio Pro process with a file
# under the directory; "running" on Windows, where no lsof says which project it has.
# The runtime it starts carries -Dmendix.running.locally.by.studiopro; only the program counts.
mdl_studio_pro_open() {
  local dir pid
  dir="$(cd "$1" 2>/dev/null && pwd -P)" || return 0
  if command -v pgrep >/dev/null 2>&1; then
    for pid in $(pgrep -f '(/MacOS/studiopro|[Ss]tudio[Pp]ro(\.exe)?)$' 2>/dev/null); do
      command -v lsof >/dev/null 2>&1 || { echo running; return 0; }
      lsof -p "$pid" -Fn 2>/dev/null | grep -qF "n$dir" && { echo open; return 0; }
    done
  elif command -v tasklist >/dev/null 2>&1; then
    tasklist 2>/dev/null | grep -qi '^studiopro\.exe' && echo running
  fi
  return 0
}

# One line for the gate and the hooks, or nothing.
mdl_studio_pro_warning() {   # mdl_studio_pro_warning <project dir>
  case "$(mdl_studio_pro_open "$1")" in
    open) echo "!! Studio Pro has this project open: what it saves next replaces what mxcli wrote to the same document (it dropped 12 indexes once). Close it without saving, or make the change in Studio Pro." ;;
    running) echo "!! Studio Pro is running: if it has this project open, what it saves next replaces what mxcli wrote. Close it without saving first." ;;
  esac
}

# Temporary files: GNU and BSD mktemp both accept an XXXXXX template.
mdl_tmpdir() {  # mdl_tmpdir <name> -- portable `mktemp -d -t <name>`
  mktemp -d "${TMPDIR:-/tmp}/$1.XXXXXX"
}

mdl_tmpfile() {  # mdl_tmpfile <name> -- portable `mktemp -t <name>`
  mktemp "${TMPDIR:-/tmp}/$1.XXXXXX"
}

# --- 9. Find the .mpr ---
# mdl_find_mpr -- set MPR for the current directory: MPR=<name>.mpr when given, else the first
# *.mpr (with a warning when there are several). Returns 1, with the reason on stderr, when none.
mdl_find_mpr() {
  if [ -n "${MPR:-}" ]; then
    [ -f "$MPR" ] || { echo "no $MPR in $(pwd)" >&2; return 1; }
    return 0
  fi
  MPR="$(ls -1 *.mpr 2>/dev/null | head -1)"
  [ -n "$MPR" ] || { echo "no .mpr in $(pwd)" >&2; return 1; }
  if [ "$(ls -1 *.mpr 2>/dev/null | wc -l | tr -d ' ')" != "1" ]; then
    echo "   !! more than one .mpr here; using $MPR. Remove the others, or name one with MPR=." >&2
  fi
  return 0
}

# --- 10. The app's own modules ---
# mdl_user_modules <mpr> -- one module per line: not System, MyFirstModule, MxTest (the module `mxcli
# test` injects; a gate that listed it could not run naming) or a Marketplace module (those have a
# Source). Returns 2 when SHOW MODULES fails or does not return a JSON list.
mdl_user_modules() {
  local listing
  listing="$("$MXCLI" -p "$1" --json -c "SHOW MODULES" 2>/dev/null)" || return 2
  # newline="\n": on Windows print() writes \r\n, and every module but the last one kept its \r
  # ("Integration\r" in a two-module app), so the coverage check found no module of that name.
  printf '%s' "$listing" | "$NODE" "$MDL_SHELL_HELPERS" user-modules 2>/dev/null || return 2
}
