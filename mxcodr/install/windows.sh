# install/windows.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Windows repairs: the junctions and aliases a Studio Pro install needs for mxcli to find it.

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
