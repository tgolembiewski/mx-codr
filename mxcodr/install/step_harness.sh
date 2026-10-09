# install/step_harness.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Steps 15-16: install the test harness, record the install, check the environment. Runs as it is read.

# --- 15. Step: install the test harness ---
# Core scripts are upgraded in place; other files are copied only when absent. verify-*.test.sh are the app's own.
ui_begin "installing the test harness"
mkdir -p "$APP/tests"
suite_written=0
for source_file in "$SRC"/tests/*; do
  name="$(basename "$source_file")"
  target="$APP/tests/$name"
  case "$name" in
    theme.sh|gate.sh|film.sh|db-snapshot.sh|mdl-applied.sh|orient.sh|diagnose.sh|precheck.sh|peek.sh|lib.sh|portable.sh|rules.sh|scenario-helpers.js|run-docker.sh|run-app.sh|marketplace-login.sh|CHECKS.md|checks|gate|lib) ;;
    *) if [ -e "$target" ]; then continue; fi ;;
  esac
  if [ -d "$source_file" ]; then
    # tests/gate/ and tests/lib/: the parts of gate.sh and lib.sh, upgraded in place like them;
    # tests/checks/: what each code wants, one file per gate step.
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
# tests/checks/lint.md went with the lint step (bundle 2026.10.09.2): an upgraded app does not keep it.
rm -f "$APP/tests/checks/lint.md"
ui_done "test harness" "$suite_written $I_ARROW tests/  (verify-*.test.sh left alone)"

# The rulebook: one card per rule in tests/rulebook/. A card's text is upgraded to the bundle's;
# its ## Local section (the person's level and exceptions) is kept word for word; a card the bundle
# does not have (the team's own) is left alone.
if [ -d "$SRC/rulebook" ]; then
  ui_begin "installing the rulebook"
  rulebook_note="$("$NODE" "$SRC/checks/rulebook.cjs" "$SRC/rulebook" merge "$APP" 2>&1 | tail -1)"
  rulebook_note="${rulebook_note#rulebook: }"
  ui_done "rulebook" "$rulebook_note $I_ARROW tests/rulebook/"
fi

# The syntax digest, now rather than at the first orient: Claude Code reads .claude/rules/ only
# when a session starts, so a digest written during the first session would reach only the
# second. Same function orient.sh calls; best effort -- a missing or old mxcli skips it.
if [ -x "$APP/mxcli$EXE" ] && [ -f "$APP/tests/portable.sh" ]; then
  ( cd "$APP" && MXCLI="./mxcli$EXE" && . tests/portable.sh && mdl_syntax_digest ) >/dev/null 2>&1 || true
fi

# The paths baseline (check_paths.cjs): the model as it is now, so the paths it already has without a
# test are warnings to clear and every path added from here on needs its test before DONE. Written
# once, from a copy of the model (the catalog is written beside the .mpr); never overwritten, since
# a later install would make everything built in between old. A new app gets an empty one.
if [ -x "$APP/mxcli$EXE" ] && [ -f "$APP/tests/portable.sh" ] && [ ! -f "$APP/.mxcli/gate-cache/paths-baseline.json" ]; then
  ( cd "$APP" && MXCLI="./mxcli$EXE" && . tests/portable.sh && mdl_find_mpr 2>/dev/null \
    && modules="$(mdl_user_modules "$MPR")" && copy="$(mdl_tmpdir mdl-baseline)" \
    && cp -R "$MPR" "$copy"/ && { [ ! -d mprcontents ] || cp -R mprcontents "$copy"/; } \
    && { [ -z "$modules" ] && { mkdir -p .mxcli/gate-cache && echo '{}' > .mxcli/gate-cache/paths-baseline.json; } \
         || "$NODE" tools/mdl-checks/check_paths.cjs . $modules --mpr "$copy/$MPR" \
              --write-baseline .mxcli/gate-cache/paths-baseline.json; }
    rm -rf "$copy" ) >/dev/null 2>&1 || true
fi

# --- 16. Step: record the install, then check the environment ---
# INSTALL.json lets the gate detect stale or locally edited harness files.
ui_begin "recording the install"
recorded="$("$NODE" "$APP/tools/mdl-checks/record_install.cjs" "$APP" "$SRC" "$version" 2>/dev/null || true)"
ui_done "install record" "${recorded:-0} files $I_ARROW tools/mdl-checks/INSTALL.json"

ui_begin "checking the environment"

# Repair a .playwright/cli.config.json that pins chromium to a path that does not exist.
playwright_config="$APP/.playwright/cli.config.json"
browser_fixed=""
if [ -f "$playwright_config" ]; then
  browser_fixed="$("$NODE" "$SRC/install/install_tool.cjs" fix-browser "$playwright_config")"
fi

# Report a missing mxbuild for the project's version now, not halfway through a gate.
mxbuild_note=""
mxbuild_note="$("$NODE" "$SRC/install/install_tool.cjs" mxbuild-note "$APP" "$IS_WINDOWS")"

ui_done "environment" "checked"
