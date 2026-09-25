# install/step_prereqs.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 11: check and install the prerequisites. Runs as it is read.

# --- 11. Step: prerequisites (Python, Node, Playwright, mxcli, MxBuild, PostgreSQL, Docker, JDK) ---
# Missing tools are collected and reported in the summary.
DEPS_LOG="${TMPDIR:-/tmp}"; DEPS_LOG="${DEPS_LOG%/}/mdl-skills-deps.log"
: > "$DEPS_LOG" 2>/dev/null || DEPS_LOG=/dev/null

ui_begin "checking prerequisites"

# Python first: the hook merges need it.
dep_need "Python 3" "mdl_find_python >/dev/null" "Python.Python.3.12" "python" "python3" || true
[ -n "$PY" ] || PY="$(mdl_find_python || true)"
[ -n "$PY" ] || ui_fail "This installer needs Python 3 -- it merges the host hook files." \
                        "Re-run with --with-deps, or install it and try again." \
                        "On Windows note that the python.org installer leaves \"Add python.exe" \
                        "to PATH\" unticked -- an installed but invisible Python looks the same."

dep_need "Node.js" "have node" "OpenJS.NodeJS.LTS" "node" "nodejs npm" || true
# A dry run walks the whole chain even though npm was not really installed.
if have npm || [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
  dep_apply "playwright-cli" "have playwright-cli" "npm install -g $PLAYWRIGHT_CLI_PACKAGE" || true
  if have playwright-cli || [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    dep_apply "Chromium headless shell" "playwright_browser_present" "$(playwright_browser_command)" || true
  fi
fi

mxcli_offer_update
found_mxcli="$(mxcli_for_project || true)"
if [ -z "$found_mxcli" ]; then
  dep_apply "mxcli" '[ -x "$APP/mxcli$EXE" ]' \
    "curl -fsSL -o \"$APP/mxcli$EXE\" \"$(mxcli_release_url)\" && chmod +x \"$APP/mxcli$EXE\"" || true
  [ -x "$APP/mxcli$EXE" ] && mxcli_verify_download "$APP/mxcli$EXE"
fi

# MxBuild for the project's version: mx check needs it, and without it mxcli new may use another version.
setup_mxcli="$(first_executable "$APP/mxcli$EXE" "$found_mxcli" || true)"
if [ -n "$setup_mxcli" ]; then
  choose_want_mx
  if [ -n "$want_mx" ]; then
    ensure_mxbuild_and_runtime "$setup_mxcli"
  fi
fi

# Docker or no-Docker mode: mx check needs no container, only the database does. No-Docker mode is written to tests/harness.env.
no_docker_mode=""
ensure_windows_studio_repairs "${want_mx:-}"
if ! docker_ready; then
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
