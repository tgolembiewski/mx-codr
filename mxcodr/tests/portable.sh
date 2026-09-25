#!/usr/bin/env bash
# tests/portable.sh -- platform shims and shared helpers (macOS, Linux, Git Bash on Windows).
# Sourced by gate.sh, lib.sh, orient.sh, diagnose.sh and run-app.sh; not run on its own.
# Provides: $MXCLI, $PY, mdl_find_python, mdl_load_harness_env, mdl_json_object,
#   mdl_json_string, mdl_json_number, mdl_ere_quote, mdl_check_local_database,
#   mdl_check_install_freshness, mdl_tmpdir, mdl_tmpfile, mdl_find_mpr, mdl_user_modules.
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

# --- 2. Find Python ---
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

# A preset PY wins; fall back to `python3` so later errors name a command.
if [ -z "${PY:-}" ]; then
  PY="$(mdl_find_python || true)"
  PY="${PY:-python3}"
fi

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
      MDL_REQUIRE_PRODUCTION|MDL_GATE_CACHE|MDL_VISUAL|MDL_VISUAL_REVIEW|MDL_RUNTIME_ERRORS) ;;
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

# --- 4. Quoting helpers: keep values from becoming code in generated JSON, JS or regex ---
mdl_json_object() {   # mdl_json_object k1 v1 k2 v2 ... -> {"k1":"v1",...}
  "$PY" -c 'import json,sys
a = sys.argv[1:]
print(json.dumps(dict(zip(a[0::2], a[1::2])), ensure_ascii=True))' "$@"
}

mdl_json_string() {   # mdl_json_string <text> -> "text", escaped for JS source
  "$PY" -c 'import json,sys; print(json.dumps(sys.argv[1], ensure_ascii=True))' "$1"
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
# Warns (prints only) about a stale HSQLDB lock or a half-written database; both break a boot.
mdl_check_local_database() {
  local base="${1:-${APP_DIR:-.}/deployment/data/database}"
  [ -d "$base" ] || return 0
  command -v find >/dev/null 2>&1 || return 0

  local lock
  lock="$(find "$base" -name '*.lck' -type f 2>/dev/null | head -1)"
  if [ -n "$lock" ]; then
    # A lock is stale only when no runtime is running.
    if ! { command -v pgrep >/dev/null 2>&1 && pgrep -f 'runtimelauncher' >/dev/null 2>&1; }; then
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
  # ISO build dates compare correctly as strings.
  [[ "$have_date" < "$want_date" ]] || return 0
  for candidate in mxcodr dist; do
    if [ -f "$app/$candidate/install.sh" ]; then bundle="$candidate"; break; fi
  done
  echo "   !! ./mxcli is older than the build this harness was validated with ($want_ver, ${want_date%%T*})."
  echo "      An older check misses errors the newer one names at check time, so they surface at the build instead."
  echo "      Swap it before building:  bash ${bundle:-mxcodr}/install.sh .   (it offers the newer binary it finds)"
}

mdl_check_install_freshness() {
  local app="${APP_DIR:-.}"
  local manifest="$app/tools/mdl-checks/INSTALL.json"
  local installed="$app/tools/mdl-checks/VERSION"
  local python="${PY:-$(mdl_find_python || true)}"
  local bundle="" candidate
  for candidate in mxcodr dist; do
    if [ -f "$app/$candidate/VERSION" ]; then bundle="$candidate"; break; fi
  done

  [ -n "$python" ] || return 0

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

  "$python" - "$app" "$manifest" <<'PY_FRESH'
import hashlib, json, os, sys

app, manifest_path = sys.argv[1], sys.argv[2]
try:
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
except Exception:
    raise SystemExit(0)

installed = manifest.get("version", "?")
changed, missing = [], []
for relative, expected in sorted((manifest.get("files") or {}).items()):
    try:
        with open(os.path.join(app, *relative.split("/")), "rb") as handle:
            actual = hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        missing.append(relative)
        continue
    if actual != expected:
        changed.append(relative)


def name_some(paths, limit):
    shown = ", ".join(paths[:limit])
    if len(paths) > limit:
        shown += " and %d more" % (len(paths) - limit)
    return shown


def ordered(version):
    # 2026.09.11.28 sorts after 2026.09.11.3, which string comparison gets wrong
    # as soon as a within-day counter passes 9 -- and they reach 28.
    try:
        return tuple(int(part) for part in version.split("."))
    except (AttributeError, ValueError):
        return ()


# A newer bundle sitting in the project is the plainest signal there is. The
# other direction is the hand-copy case, where the files are ahead of mxcodr/ on
# purpose, so it is left alone -- the checksums below cover it.
# mxcodr beside the project, or dist in a copy made before the 2026-09-15 rename.
name = next((n for n in ("mxcodr", "dist") if os.path.exists(os.path.join(app, n, "VERSION"))), None)
bundle = os.path.join(app, name, "VERSION") if name else ""
if bundle:
    try:
        with open(bundle, encoding="utf-8") as handle:
            available = handle.read().strip()
    except OSError:
        available = ""
    if available and ordered(available) > ordered(installed):
        print("   !! the harness installed here is %s; %s/ holds a newer one (%s)."
              % (installed, name, available))
        print("      An out-of-date checker passes what the current one fails:  bash %s/install.sh ." % name)

if missing:
    print("   !! %d harness file(s) gone since install: %s"
          % (len(missing), name_some(missing, 3)))
    print("      re-run the installer to put them back")

if changed:
    print("   !! differs from the installed harness (%s): %s"
          % (installed, name_some(changed, 4)))
    print("      either these were edited here, and the next install overwrites them -- send a")
    print("      real fix upstream -- or newer files were copied in and the VERSION stamp is stale")
PY_FRESH
}

# --- 8. Temporary files (GNU and BSD mktemp both accept an XXXXXX template) ---
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
MDL_SYNTAX_TOPICS="domain-model.entity.create domain-model.association.create domain-model.enumeration.create
  security.module-role security.user-role security.demo-user security.entity-access settings.alter
  module page.create page.action page.datasource snippet.create navigation.create microflow.object-operations"

mdl_syntax_digest() {
  local version topic block tmp topics
  [ -n "${MXCLI:-}" ] || return 1
  version="$("$MXCLI" --version 2>/dev/null | head -1)"
  [ -n "$version" ] || return 1
  [ -d "$(dirname "$MDL_SYNTAX_DIGEST")" ] || return 1
  # Written again when mxcli or the topic list changes (page.datasource was added to a digest
  # an installed project had already cached for its mxcli version).
  topics="<!-- topics: $(echo $MDL_SYNTAX_TOPICS) -->"
  if ! { [ -f "$MDL_SYNTAX_DIGEST" ] && [ "$(head -1 "$MDL_SYNTAX_DIGEST")" = "<!-- $version -->" ] \
         && [ "$(sed -n 2p "$MDL_SYNTAX_DIGEST")" = "$topics" ]; }; then
    tmp="$MDL_SYNTAX_DIGEST.tmp"
    {
      printf '<!-- %s -->\n%s\n' "$version" "$topics"
      printf '# MDL syntax this project looks up most\n\n'
      printf 'Generated from `./mxcli syntax <topic>` of this project. The rest: `./mxcli syntax`.\n'
      for topic in $MDL_SYNTAX_TOPICS; do
        block="$("$MXCLI" syntax "$topic" 2>/dev/null \
          | awk '/^Syntax:$/ { on = 1; next } /^[A-Z][A-Za-z ]+:$/ { on = 0 } on')"
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
# mdl_user_modules <mpr> -- one module per line: not System, MyFirstModule or a Marketplace module
# (those have a Source). Returns 2 when SHOW MODULES fails or does not return a JSON list.
mdl_user_modules() {
  local listing
  listing="$("$MXCLI" -p "$1" --json -c "SHOW MODULES" 2>/dev/null)" || return 2
  printf '%s' "$listing" | "$PY" -c 'import json,sys
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit(1)
if not isinstance(rows, list):
    sys.exit(1)
for row in rows:
    if not (row.get("Source") or "").strip() and row.get("Module") not in ("System","MyFirstModule"):
        print(row["Module"])' 2>/dev/null || return 2
}
