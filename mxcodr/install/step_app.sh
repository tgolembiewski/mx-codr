# install/step_app.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 12: create a Mendix app when the project has no .mpr. Runs as it is read.

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
