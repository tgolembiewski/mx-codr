# install/studio_pro.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Finding Studio Pro installs and their mx (Windows).

# --- Finding Studio Pro installs (Windows) ---
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
  printf '      %smkdir "C:\\Program Files\\Mendix"%s   (when it is not there yet)\n' "$C_CYAN" "$C_RESET"
  printf '      %smklink /J "%s" "%s"%s\n\n' "$C_CYAN" "$link_win" "$target_win" "$C_RESET"
  printf '    It needs administrator rights, so Windows will ask you to confirm.\n\n'

  if [ -e "/c/Program Files/Mendix/$version" ]; then
    return 0
  fi
  if ! ask "    Create it now? [Y/n] " y; then
    DEPS_MISSING+=("Studio Pro $version -- not visible to mxcli, so the app cannot be booted.")
    DEPS_MISSING+=("                 mkdir \"C:\\Program Files\\Mendix\" & mklink /J \"$link_win\" \"$target_win\"   (as administrator)")
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
  # One elevated PowerShell makes the parent folder (mklink needs it, and a machine with only a
  # per-user Studio Pro has no C:\Program Files\Mendix) and then the junction. The script goes
  # in as -EncodedCommand, so no quoting passes through bash, PowerShell and cmd.
  local elevated encoded
  elevated="New-Item -ItemType Directory -Force -Path 'C:\\Program Files\\Mendix' | Out-Null; "
  elevated+="New-Item -ItemType Junction -Path '$link_win' -Target '$target_win' | Out-Null"
  encoded="$("$NODE" "$SRC/install/install_tool.cjs" powershell-encode "$elevated")"
  powershell.exe -NoProfile -Command \
    "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','$encoded'" \
    >> "$DEPS_LOG" 2>&1 || true
  if [ -e "/c/Program Files/Mendix/$version" ]; then
    ui_note "Studio Pro $version linked into Program Files; mxcli can see it now"
    return 0
  fi
  DEPS_MISSING+=("Studio Pro $version -- the junction was not created, so the app cannot boot.")
  DEPS_MISSING+=("                 mkdir \"C:\\Program Files\\Mendix\" & mklink /J \"$link_win\" \"$target_win\"   (as administrator)")
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

# require_windows_studio_pro -- on Windows without any Studio Pro, stop: nothing here works without
# it -- creating the app, mx check and the build all run the mx.exe / mxbuild.exe it installs (Mendix
# publishes them separately for Linux only). Said first, before minutes of other installs, rather
# than when the app is created. MDL_SKIP_STUDIO_PRO_CHECK skips it.
require_windows_studio_pro() {
  local wanted_mx mpr_file
  [ "$IS_WINDOWS" = "1" ] && [ -z "$(studio_pro_versions)" ] && [ -z "${MDL_SKIP_STUDIO_PRO_CHECK:-}" ] || return 0
  wanted_mx="${MX_VERSION:-}"
  mpr_file="$(find "$APP" -maxdepth 1 -name '*.mpr' -print -quit 2>/dev/null)"
  if [ -z "$wanted_mx" ] && [ -n "$mpr_file" ] && [ -n "${NODE:-}" ]; then
    wanted_mx="$("$NODE" "$SRC/install/install_tool.cjs" mpr-version "$mpr_file" 2>/dev/null || true)"
  fi
  wanted_mx="${wanted_mx:-$DEFAULT_MX_VERSION}"
  ui_fail "Mendix Studio Pro is not installed. Install it first, then run the installer again." \
          "" \
          "On Windows the harness cannot work without it: creating the app, mx check and" \
          "building the app all use the mx.exe and mxbuild.exe that come with Studio Pro." \
          "Docker does not replace it." \
          "" \
          "  1. Install Mendix Studio Pro $wanted_mx:" \
          "     https://marketplace.mendix.com/link/studiopro/" \
          "  2. Run this again:" \
          "     bash $SRC/install.sh \"$APP\""
}

# --- Choosing the Mendix version of a new app (macOS) ---
# mac_studio_pro_versions -- Studio Pro apps installed on this Mac that carry mx, oldest first.
# The version is read from the app's name ("Mendix Studio Pro 11.15.0 Beta.app"): its Info.plist
# says 1.0. An app without Contents/modeler/mx (10.24 betas ship none) cannot create or check an
# app, so it is left out. MDL_STUDIO_PRO_APPS (directories, space-separated) replaces where it looks.
mac_studio_pro_versions() {
  local root app name version
  for root in ${MDL_STUDIO_PRO_APPS:-/Applications $HOME/Applications}; do
    [ -d "$root" ] || continue
    for app in "$root"/*Studio\ Pro*.app; do
      [ -x "$app/Contents/modeler/mx" ] || continue
      name="$(basename "$app")"
      version="$(printf '%s' "$name" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
      [ -n "$version" ] && printf '%s\n' "$version"
    done
  done | sort -V -u
}

# choose_mx_version -- sets and exports MX_VERSION for a new app on macOS, so creating the app, the
# MxBuild prerequisite and the target line all use the same version. MX_VERSION already set wins.
# One Studio Pro installed: that one. Several: always asked, the newest offered, MDL_ASSUME_YES
# included (it answers yes/no prompts, and this is a choice the person makes); with no terminal
# the newest is taken and the installer says so. None: DEFAULT_MX_VERSION applies.
# Windows keeps its own rule (the newest installed, create_app).
choose_mx_version() {
  local versions count newest reply i version
  [ -n "${MX_VERSION:-}" ] && return 0
  [ "$IS_WINDOWS" = "1" ] && return 0
  versions="$(mac_studio_pro_versions)"
  [ -n "$versions" ] || return 0
  count="$(printf '%s\n' "$versions" | wc -l | tr -d ' ')"
  newest="$(printf '%s\n' "$versions" | tail -1)"
  if [ "$count" = "1" ]; then
    export MX_VERSION="$newest"
    return 0
  fi
  if [ ! -t 0 ]; then
    export MX_VERSION="$newest"
    ui_clear
    printf '  %s%s%s Studio Pro %s for the new app, the newest of %s installed -- no terminal to ask.\n' \
      "$C_YELLOW" "${I_WARN:-!}" "$C_RESET" "$newest" "$count"
    printf '    MX_VERSION=<version> picks another: %s\n\n' "$(printf '%s ' $versions)"
    return 0
  fi
  ui_clear
  printf '  Which Mendix version should the new app use? Studio Pro installed here:\n\n'
  i=0
  while IFS= read -r version; do
    i=$((i + 1))
    if [ "$version" = "$newest" ]; then
      printf '    %s%2d%s  %s  %s(newest)%s\n' "$C_BOLD" "$i" "$C_RESET" "$version" "$C_GREY" "$C_RESET"
    else
      printf '    %s%2d%s  %s\n' "$C_BOLD" "$i" "$C_RESET" "$version"
    fi
  done <<< "$versions"
  while :; do
    printf '\n  Version [%s]: ' "$count"
    read -r reply
    reply="${reply:-$count}"
    case "$reply" in
      *[!0-9]*) # A version typed out, e.g. 11.12.1.
        if printf '%s\n' "$versions" | grep -qxF "$reply"; then MX_VERSION="$reply"; break; fi ;;
      *) if [ "$reply" -ge 1 ] && [ "$reply" -le "$count" ]; then
           MX_VERSION="$(printf '%s\n' "$versions" | sed -n "${reply}p")"; break
         fi ;;
    esac
    printf '  %sType a number from the list, or one of the versions.%s\n' "$C_YELLOW" "$C_RESET"
  done
  export MX_VERSION
  printf '\n'
}
