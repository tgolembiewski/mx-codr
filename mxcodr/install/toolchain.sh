# install/toolchain.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# The Playwright browser, the JDK, MxBuild and the runtime, and the no-Docker build mode.

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

# The version line, wherever it is: with JAVA_TOOL_OPTIONS set (a ~/.zshrc had
# -Djava.awt.headless=true), `java -version` starts with "Picked up JAVA_TOOL_OPTIONS: ...", and
# reading the first line only found no version in any of the four JDKs installed, so the installer
# said "JDK 21 -- still missing" (2026-10-06).
java_major() {            # java_major <path-to-java> -- echo the major version
  "$1" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -1
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

# app_jdk <studio-dir> -- the java mxbuild needs for this app: the JDK major of its Mendix version
# (want_mx; 25 from 11.14), found on the machine or, failing that, the OpenJDK Studio Pro ships
# beside mxbuild. Until 2026-10-10 harness.env always named a JDK 21 (or 17): a new 11.15 app on
# Windows then failed to build its Java actions with "release version 25 not supported", though
# Studio Pro 11.15 carried a JDK 25. Without a known version the old choice stands.
app_jdk() {
  local studio="${1:-}" want candidate
  [ -n "${want_mx:-}" ] || { jdk_find 21 || jdk_find 17; return; }
  want="$(jdk_major_for "$want_mx")"
  jdk_find "$want" && return 0
  for candidate in "$studio"/OpenJDK/bin/java$EXE "$studio"/OpenJDK/*/bin/java$EXE; do
    [ -n "$studio" ] && [ -x "$candidate" ] || continue
    [ "$(java_major "$candidate")" = "$want" ] && { printf '%s\n' "$candidate"; return 0; }
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
    want_mx="$("$NODE" "$SRC/install/install_tool.cjs" app-mx-version "$APP" 2>/dev/null || true)"
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

}

# check_jdk -- report a JDK for want_mx that is missing or off the PATH (often on Windows); never installs one.
check_jdk() {
  local want_jdk found_jdk
  want_jdk="$(jdk_major_for "${want_mx:-}")"
  found_jdk="$(jdk_find "$want_jdk" || true)"
  # Windows, no JDK of that major: Studio Pro ships one (11.15: OpenJDK 25), and tests/harness.env
  # names it (app_jdk), so the gate builds and runs with it; nothing to install. The installer used
  # to ask for a Temurin 25 the app did not need (2026-10-10).
  if [ -z "$found_jdk" ] && [ "$IS_WINDOWS" = "1" ] && [ -n "${want_mx:-}" ]; then
    local local_app="${LOCALAPPDATA:-}" studio
    for studio in "/c/Program Files/Mendix/$want_mx" "${local_app//\\//}/Programs/Mendix/$want_mx"; do
      [ -d "$studio/OpenJDK" ] || continue
      if app_jdk "$studio" >/dev/null 2>&1; then
        ui_note "JDK $want_jdk: Studio Pro $want_mx's own, which tests/harness.env names"
        return 0
      fi
    done
  fi
  if [ -z "$found_jdk" ]; then
    dep_report_only "JDK $want_jdk" "false" \
      "EclipseAdoptium.Temurin.$want_jdk.JDK" "temurin@$want_jdk" "temurin-$want_jdk-jdk" || true
  elif ! have java || [ "$(java_major java 2>/dev/null)" != "$want_jdk" ]; then
    DEPS_MISSING+=("JDK $want_jdk -- installed but not on the PATH: $found_jdk")
    DEPS_MISSING+=("           \`./mxcli$EXE run --local\` needs it there. In Git Bash:")
    DEPS_MISSING+=("           export PATH=\"\$(dirname '$found_jdk'):\$PATH\"")
  fi
}
