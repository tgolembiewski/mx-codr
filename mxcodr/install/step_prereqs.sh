# install/step_prereqs.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 11: check and install the prerequisites. Runs as it is read.

# The project's tests/harness.env as it was, before the steps below rewrite it (setup_docker_mode
# writes it from scratch): step_harness moves its old rule switches into the rulebook's cards.
OLD_HARNESS_ENV=""
if [ -f "$APP/tests/harness.env" ]; then
  OLD_HARNESS_ENV="${TMPDIR:-/tmp}"; OLD_HARNESS_ENV="${OLD_HARNESS_ENV%/}/mdl-old-harness-env.$$"
  cp "$APP/tests/harness.env" "$OLD_HARNESS_ENV" 2>/dev/null && chmod 600 "$OLD_HARNESS_ENV" 2>/dev/null || OLD_HARNESS_ENV=""
fi

# --- 11. Step: prerequisites (Node, Playwright, mxcli, MxBuild, PostgreSQL, Docker, JDK) ---
# Missing tools are collected and reported in the summary.
DEPS_LOG="${TMPDIR:-/tmp}"; DEPS_LOG="${DEPS_LOG%/}/mdl-skills-deps.log"
: > "$DEPS_LOG" 2>/dev/null || DEPS_LOG=/dev/null

ui_begin "checking prerequisites"

# Node first: the hook merges, the hooks and the checks run on it.
dep_need "Node.js" "have node" "OpenJS.NodeJS.LTS" "node" "nodejs npm" || true
NODE="$(mdl_find_node || true)"
[ -n "$NODE" ] || ui_fail "This installer needs Node.js -- it merges the host hook files, and the" \
                          "hooks, playwright-cli and the plugins run on it." \
                          "Re-run without --no-deps, or install it and try again."
# A dry run walks the whole chain even though npm was not really installed.
if have npm || [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
  dep_apply "playwright-cli" "have playwright-cli" "npm install -g $PLAYWRIGHT_CLI_PACKAGE" || true
  if have playwright-cli || [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    dep_apply "Chromium headless shell" "playwright_browser_present" "$(playwright_browser_command)" || true
  fi
fi

mxcli_offer_update
# Still no ./mxcli (the release API was unreachable, or MDL_NO_UPDATE_CHECK): the compatible tag's
# download URL, verified only against MXCLI_SHA256. Never an older or newer mxcli from the PATH.
if [ ! -x "$APP/mxcli$EXE" ]; then
  dep_apply "mxcli" '[ -x "$APP/mxcli$EXE" ]' \
    "curl -fsSL -o \"$APP/mxcli$EXE\" \"$(mxcli_release_url)\" && chmod +x \"$APP/mxcli$EXE\"" || true
  [ -x "$APP/mxcli$EXE" ] && mxcli_verify_download "$APP/mxcli$EXE"
  mxcli_compatible_local || true
fi
found_mxcli="$(mxcli_for_project || true)"

# MxBuild for the project's version: mx check needs it, and without it mxcli new may use another version.
setup_mxcli="$(first_executable "$APP/mxcli$EXE" "$found_mxcli" || true)"
if [ -n "$setup_mxcli" ]; then
  choose_want_mx
  if [ -n "$want_mx" ]; then
    ensure_mxbuild_and_runtime "$setup_mxcli"
  fi
fi

# The run mode the user chose (target.sh): locally with PostgreSQL, or everything in Docker.
# Either way it is written to tests/harness.env.
no_docker_mode=""
ensure_windows_studio_repairs "${want_mx:-}"
if [ "$RUN_MODE" = "docker" ]; then
  setup_docker_mode
else
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
