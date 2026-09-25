#!/usr/bin/env bash
# install.sh -- install the mx-codr harness (skills, lint rules, checkers, hooks, tests/gate.sh)
# into a Mendix project, creating the app when there is none. Safe to re-run.
#
# Usage: bash install.sh [project-dir] [--no-app] [--with-deps] [-h|--help]
#   Run it from the project folder, one level above the bundle:  cd <app> && bash mxcodr/install.sh
#   (not from inside mxcodr/ -- that still works, but the target is then guessed, not named).
#   --no-app     never create a Mendix app; stop when there is no .mpr
#   --with-deps  install missing prerequisites (winget/brew/apt/dnf); otherwise only reported
#   No dir: the current directory, or the project the bundle sits in when run from inside it.
# Env: MX_VERSION, APP_NAME (new app); MDL_ASSUME_YES=1; MDL_DEPS_DRY_RUN=1 (print installs only);
#   MDL_NO_UPDATE_CHECK=1; MXCLI_TAG, MXCLI_SHA256; MDL_DB_HOST, MDL_DB_USER, MDL_DB_PASSWORD,
#   PGPASSWORD; DOCKER_WAIT, DOCKER_PROBE_TIMEOUT (seconds); NO_COLOR.
# Exit: 0 installed; 1 ui_fail (bad argument, no project, no Python, app creation failed);
#   other non-zero = unexpected command failure. Missing prerequisites do not fail the install.
#
# How it is laid out: this file holds the constants and finds Python, then sources install/*.sh
# in the order below -- the first eight define functions, the rest run the install step by step.
#   install/ui.sh            terminal output (ui_*)
#   install/prereqs.sh       prerequisite helpers (package managers, install or report)
#   install/postgres.sh      PostgreSQL logins and tests/harness.env
#   install/docker.sh        Docker walkthrough
#   install/windows.sh       Windows repairs (junctions)
#   install/mxcli.sh         mxcli: download and update
#   install/studio_pro.sh    finding Studio Pro (Windows)
#   install/toolchain.sh     Playwright browser, JDK, MxBuild, no-Docker mode
#   install/target.sh        10. arguments and the target project
#   install/step_prereqs.sh  11. prerequisites
#   install/step_app.sh      12. create the Mendix app
#   install/step_skills.sh   13. skills, lint rules, checkers, rule
#   install/step_hosts.sh    14. hooks for Claude, Codex, Cursor, OpenCode, Pi
#   install/step_harness.sh  15-16. the test harness, record the install, check the environment
#   install/summary.sh       17. summary

set -euo pipefail

# --- Constants ---
DEFAULT_MX_VERSION="11.12.1"               # Mendix version for a new app when MX_VERSION is unset
PLAYWRIGHT_CLI_PACKAGE="@playwright/cli@0.1.15"   # pinned to the devcontainer's version
DEFAULT_DOCKER_WAIT=180                    # seconds to wait for the Docker daemon (DOCKER_WAIT)
UI_BAR_WIDTH=24                            # progress bar width, in characters
UI_SUB_EXPECTED=6                          # sub-steps expected inside one step, for the bar

# --- 1. Platform and Python ---
# On Windows (Git Bash) python3 may be a Store stub, so each Python candidate is run before use.
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1; EXE=".exe" ;;
  *)                    IS_WINDOWS=0; EXE="" ;;
esac

# mdl_find_python -- print the first Python 3 that really runs; return 1 if none.
mdl_find_python() {
  local candidate
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  # winget's python.org install is often not on PATH; search the install dirs too.
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

PY="$(mdl_find_python || true)"
# Not fatal: with --with-deps the prerequisites step installs Python and re-probes.

# The bundle this script belongs to: every part and file below is read from here.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="$(cat "$SRC/VERSION")"

# --- The rest, in install/ next to this file, in this order ---
for _install_part in ui prereqs postgres docker windows mxcli studio_pro toolchain \
                     target step_prereqs step_app step_skills step_hosts step_harness summary; do
  if [ ! -f "$SRC/install/$_install_part.sh" ]; then
    echo "install/$_install_part.sh is missing -- download the whole mxcodr/ bundle again" >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  . "$SRC/install/$_install_part.sh"
done
