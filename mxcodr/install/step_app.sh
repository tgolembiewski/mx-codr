# install/step_app.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 12: create a Mendix app when the project has no .mpr. Runs as it is read.

# --- 12. Step: create a Mendix app when the project has no .mpr ---
# app_creation_failed <what ran> <command to run by hand> -- the last lines of its log, then stop.
app_creation_failed() {
  ui_clear
  printf '  %s%s%s %slast lines of %s:%s\n' "$C_RED" "$I_FAIL" "$C_RESET" "$C_BOLD" "$1" "$C_RESET" >&2
  tail -5 "$tmp_app/new.log" 2>/dev/null | sed 's/^/    /' >&2
  ui_fail "Creating the Mendix app failed." \
          "Run it by hand to see why:" \
          "  $2"
}

# create_with_studio_pro_mx <mx.exe> <mxcli> <app-name> -- the app from Studio Pro's own mx.exe (a
# per-user install mxcli cannot see), then mxcli init for the AI tooling half of mxcli new.
create_with_studio_pro_mx() {
  local direct_mx="$1" creator_mxcli="$2" app_name="$3"
  ui_sub "Studio Pro $mx_version (mxcli cannot see this install)"
  if ! "$direct_mx" create-project --app-name "$app_name" --output-dir "$tmp_app/app" \
       >> "$tmp_app/new.log" 2>&1; then
    app_creation_failed "mx create-project" "\"$direct_mx\" create-project --app-name $app_name --output-dir /tmp/probe"
  fi
  ui_tick
  # mxcli new also initialises the AI tooling; do that half separately.
  "$creator_mxcli" init "$tmp_app/app" >> "$tmp_app/new.log" 2>&1 || true
  ui_tick
}

# create_with_mxcli_new <mxcli> <app-name> -- the app from mxcli new, its progress on the bar.
create_with_mxcli_new() {
  local creator_mxcli="$1" app_name="$2" skip_build
  # On Windows, skip mxcli new's first build: mxbuild leaves a Gradle daemon that holds
  # mxcli's output pipe, so mxcli waits for it forever (mxcli v0.24, docker/settle.go).
  # The gate's first boot builds the app anyway.
  skip_build=''
  case "$IS_WINDOWS" in
    1) if "$creator_mxcli" new --help 2>&1 | grep -q -- '--skip-build'; then skip_build='--skip-build'; fi ;;
  esac
  # --theme/--layout none: stock Atlas (mxcli's theme follows the OS dark mode).
  # mxcli's "Executing step '<phase>'" lines drive the sub-progress.
  if ! "$creator_mxcli" new "$app_name" --version "$mx_version" --output-dir "$tmp_app/app" \
       --theme none --layout none $skip_build 2>&1 | while :; do
         # mxcli prints nothing for minutes during the first build: redraw every 2s anyway, so
         # the elapsed time moves. read -t times out with a status above 128; EOF ends the loop.
         if IFS= read -r -t 2 line; then
           printf '%s\n' "$line" >> "$tmp_app/new.log"
           case "$line" in
             "Executing step "*) phase="${line#Executing step \'}"; ui_sub "${phase%\'}" ;;
             *...)               ui_tick ;;
           esac
         elif [ $? -gt 128 ]; then
           ui_bar
         else
           break
         fi
       done; then
    app_creation_failed "mxcli new" "$creator_mxcli new $app_name --version $mx_version --output-dir /tmp/probe"
  fi
}

# place_scaffold_mxcli <this machine's mxcli> -- the mxcli the new app keeps: on Linux the
# scaffold's own, elsewhere the one that created it, with the scaffold's Linux binary beside it.
place_scaffold_mxcli() {
  local stash_mxcli="$1"
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
    if [ -f "$APP/mxcli.linux" ]; then swapped_mxcli=1; fi
  fi
}

# create_app -- create the app in a temp dir and copy it in. Sets mx_version, created_app, swapped_mxcli (read by the summary).
create_app() {
  local creator_mxcli app_name direct_mx stash_mxcli
  # Same choice as for the prerequisites, but look for the compatible mxcli again when ./mxcli does not run.
  if ! mxcli_describe "$APP/mxcli$EXE" >/dev/null; then
    mxcli_compatible_local || true
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
  # The same version rule as for the prerequisites (toolchain.sh), but on Windows without a Studio Pro
  # there is no app to create.
  mx_version="$(new_app_mx_version)"
  if [ -z "$mx_version" ] && [ "$IS_WINDOWS" = "1" ]; then
    ui_fail "No Mendix Studio Pro found, and Windows has no other way to create an app." \
            "mxcli shells out to Studio Pro's mx.exe; the Mendix CDN's mxbuild is Linux-only." \
            "Install Studio Pro, or point this at a project that already has a .mpr."
  fi
  # mxcli new cannot see per-user Studio Pro installs and stamps the wrong version; use its mx.exe, then mxcli init.
  direct_mx=""
  if [ "$IS_WINDOWS" = "1" ] && ! studio_pro_mx_visible_to_mxcli "$mx_version" >/dev/null; then
    direct_mx="$(studio_pro_mx "$mx_version" 2>/dev/null || true)"
    # mxcli run --local cannot see per-user installs either; offer a junction.
    # A junction that could not be made is listed as missing; creating the app goes on.
    if [ -n "$direct_mx" ]; then offer_studio_pro_junction "$mx_version" "$direct_mx" || true; fi
  fi

  # The name goes in the done line: with it the label outgrew an 80-column bar ("(Mendix ~").
  ui_begin "creating the app (Mendix $mx_version)"
  # mxcli new needs an empty --output-dir: create in a temp dir, then move in.
  # tmp_app stays global: install.sh's EXIT trap runs MDL_EXIT_EXTRA after this function has returned.
  tmp_app="$(mktemp -d "${TMPDIR:-/tmp}/mdl-skills-new.XXXXXX")"
  MDL_EXIT_EXTRA='rm -rf "$tmp_app"'
  # Stash the running mxcli: on Windows copying over a running .exe deletes it.
  stash_mxcli="$tmp_app/mxcli-host$EXE"
  cp "$creator_mxcli" "$stash_mxcli" 2>/dev/null || stash_mxcli="$creator_mxcli"
  if [ -n "$direct_mx" ]; then
    create_with_studio_pro_mx "$direct_mx" "$creator_mxcli" "$app_name"
  else
    create_with_mxcli_new "$creator_mxcli" "$app_name"
  fi
  # Set the scaffold's Linux mxcli aside; copying it over a running mxcli breaks it.
  if [ -f "$tmp_app/app/mxcli" ]; then mv "$tmp_app/app/mxcli" "$tmp_app/app-mxcli-linux"; fi
  rm -f "$tmp_app/app/mxcli$EXE" 2>/dev/null || true
  cp -R "$tmp_app/app/." "$APP/"
  place_scaffold_mxcli "$stash_mxcli"
  rm -rf "$tmp_app"
  MDL_EXIT_EXTRA=''
  created_app="$app_name.mpr"
  # The look chosen up front; only theme/ files change. A failure is said, never fatal.
  theme_note=""
  if [ -n "${THEME:-}" ]; then
    ui_sub "theme $THEME"
    if apply_theme "$APP" "$APP/mxcli$EXE" "$THEME"; then theme_note=", theme $THEME"
    else theme_failed=1; fi
  fi
  ui_done "Mendix app created" "$created_app (Mendix $mx_version$theme_note)"
  [ -n "${theme_failed:-}" ] && ui_note "the $THEME theme could not be applied; try: bash tests/theme.sh $THEME"
  [ -n "${swapped_mxcli:-}" ] && ui_note "./mxcli$EXE swapped for this machine's binary (Linux one kept as mxcli.linux)"
  return 0
}

if [ "$mpr_count" = "0" ]; then
  create_app
else
  # An existing app keeps its look, but the frame of an mx-codr theme is the bundle's: re-apply
  # the active one so a fix to the frame reaches it (control heights, 2026-10-05). Only theme/
  # files change; a failure is said, never fatal.
  for _theme_partial in "$APP"/theme/web/_mxcli-*.scss; do
    [ -f "$_theme_partial" ] || continue
    _theme="$(basename "$_theme_partial" .scss)"; _theme="${_theme#_mxcli-}"
    [ -f "$SRC/checks/themes/$_theme.skin.scss" ] || continue
    if apply_theme "$APP" "$APP/mxcli$EXE" "$_theme" keep-logo; then ui_note "theme $_theme: frame refreshed"
    else ui_note "the $_theme theme could not be refreshed; try: bash tests/theme.sh $_theme"; fi
  done
fi
