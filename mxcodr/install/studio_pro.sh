# install/studio_pro.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Finding Studio Pro installs and their mx (Windows).

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
  encoded="$("$PY" -c 'import base64,sys; print(base64.b64encode(sys.argv[1].encode("utf-16-le")).decode())' "$elevated")"
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
