# install/docker.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Docker: the walkthrough when the daemon is missing or not running.

# --- Docker: install, start, wait for the daemon ---
# docker_ready -- true when the daemon answers; time-boxed because `docker info` hangs while Docker starts.
docker_ready() {
  have docker || return 1
  if have timeout; then
    timeout "${DOCKER_PROBE_TIMEOUT:-8}" docker info >/dev/null 2>&1
  else
    docker info >/dev/null 2>&1
  fi
}

# docker_install_command -- this machine's command to install Docker, or nothing.
docker_install_command() {
  case "$(pkg_manager)" in
    winget) echo "winget install -e --accept-package-agreements --accept-source-agreements --id Docker.DockerDesktop" ;;
    brew)   echo "brew install --cask docker" ;;
    apt)    echo "${SUDO}apt-get update -qq && ${SUDO}apt-get install -y docker.io" ;;
    dnf)    echo "${SUDO}dnf install -y docker" ;;
  esac
}

# docker_start_command -- start Docker detached: Docker Desktop in the foreground never returns.
docker_start_command() {
  if [ "$IS_WINDOWS" = "1" ]; then
    # Docker Desktop installs per machine (Program Files) or, lately, per user (LOCALAPPDATA).
    local program_files="${PROGRAMFILES:-C:\\Program Files}" local_app="${LOCALAPPDATA:-}" exe
    exe="${program_files//\\//}/Docker/Docker/Docker Desktop.exe"
    [ -n "$local_app" ] && [ -f "${local_app//\\//}/Programs/DockerDesktop/Docker Desktop.exe" ] \
      && exe="${local_app//\\//}/Programs/DockerDesktop/Docker Desktop.exe"
    echo "cmd //c start \"\" \"$exe\""
  elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    echo "open -a Docker"
  else
    echo "${SUDO}systemctl start docker"
  fi
}

# docker_walkthrough -- install and start Docker, wait for it, say what is left to do by hand.
docker_walkthrough() {
  local command
  command="$(docker_install_command)"
  if [ -z "$command" ]; then
    DEPS_MISSING+=("Docker -- no package manager here; install Docker Desktop by hand")
    return 1
  fi

  ui_clear
  printf '\n  %s%s%s Docker is not installed. Installing it.\n' "$C_YELLOW" "$I_WARN" "$C_RESET"
  printf '    Running:  %s%s%s\n\n' "$C_CYAN" "$command" "$C_RESET"
  ui_sub "installing Docker (this is a large download)"
  if ! dep_run "$command"; then
    ui_clear
    printf '  %s%s%s The install command failed. Its output:\n' "$C_RED" "$I_FAIL" "$C_RESET"
    tail -8 "$DEPS_LOG" 2>/dev/null | sed 's/^/      /'
    DEPS_MISSING+=("Docker -- install failed, see $DEPS_LOG")
    return 1
  fi
  DEPS_INSTALLED=$(( DEPS_INSTALLED + 1 ))

  # Installed is not running: Docker Desktop needs a first launch and licence acceptance.
  ui_clear
  printf '  %s%s%s Docker is installed. Three things it still needs from you:\n\n' "$C_GREEN" "$I_OK" "$C_RESET"
  if [ "$IS_WINDOWS" = "1" ]; then
    printf '      1. Start Docker Desktop from the Start menu.\n'
  else
    printf '      1. Start Docker.  %s%s%s\n' "$C_GREY" "$(docker_start_command)" "$C_RESET"
  fi
  printf '      2. Accept its licence the first time it opens.\n'
  if [ "$IS_WINDOWS" = "1" ]; then
    printf '      3. Let it enable the WSL2 backend when it asks. A reboot may be needed;\n'
    printf '         if so, reboot and re-run this installer -- it will pick up where it left off.\n'
  else
    printf '      3. Wait for the whale in the menu bar to stop animating.\n'
  fi
  printf '\n'

  docker_start_and_wait
}

# windows_docker_blocked -- on Windows, why Docker Desktop cannot start at all: its WSL 2 backend
# needs the Virtual Machine Platform feature, and its Hyper-V backend needs Hyper-V. Prints the
# reason when both are off; nothing when either is on or dism cannot tell (not elevated).
windows_docker_blocked() {
  [ "$IS_WINDOWS" = "1" ] || return 0
  local vmp hyperv
  vmp="$(windows_feature_state VirtualMachinePlatform)"
  hyperv="$(windows_feature_state Microsoft-Hyper-V)"
  [ "$vmp" = "Disabled" ] && [ "$hyperv" != "Enabled" ] || return 0
  echo "the Windows features Virtual Machine Platform and Windows Subsystem for Linux are off, and Docker Desktop needs WSL 2"
}
windows_feature_state() {   # windows_feature_state <feature> -- Enabled, Disabled or empty
  dism.exe //online //get-featureinfo "//featurename:$1" 2>/dev/null | tr -d '\r' \
    | sed -n 's/^State : //p' | head -1 || true
}

# docker_start_and_wait -- start Docker detached and wait for its daemon; say what is left if it
# does not answer. Returns 0 once `docker info` answers.
docker_start_and_wait() {
  # A Docker that cannot start is not waited for: 3 minutes, then advice that could not help.
  local blocked
  blocked="$(windows_docker_blocked)"
  if [ -n "$blocked" ]; then
    DEPS_MISSING+=("Docker -- cannot start on this computer: $blocked.")
    DEPS_MISSING+=("          As administrator: wsl --install --no-distribution, reboot, start Docker Desktop, then re-run this installer")
    DEPS_MISSING+=("          -- or re-run it with MDL_RUN_MODE=local: the app then runs without Docker")
    return 1
  fi
  if [ "$IS_WINDOWS" = "1" ] || [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    # Detached and time-boxed so a launcher that stays in the foreground cannot hang the install.
    ui_sub "starting Docker Desktop"
    ( dep_run "$(docker_start_command)" || true ) >/dev/null 2>&1 &
    sleep 2
  fi

  if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    ui_note "would wait here for the Docker daemon to answer"
    return 0
  fi

  # Ctrl-C stops only the waiting; the install continues.
  local stop_waiting=0
  trap 'stop_waiting=1' INT
  printf '    Waiting for the Docker daemon (Ctrl-C to stop waiting) '
  local waited=0
  while [ "$waited" -lt "${DOCKER_WAIT:-$DEFAULT_DOCKER_WAIT}" ] && [ "$stop_waiting" = "0" ]; do
    if docker_ready; then
      trap - INT
      printf '\n'
      ui_clear
      printf '  %s%s%s Docker is up.\n\n' "$C_GREEN" "$I_OK" "$C_RESET"
      return 0
    fi
    printf '.'
    sleep 3
    waited=$(( waited + 3 ))
  done
  trap - INT
  printf '\n'
  if [ "$stop_waiting" = "1" ]; then
    DEPS_MISSING+=("Docker -- installed; you stopped waiting for the daemon. When it is up: docker info")
    return 1
  fi
  DEPS_MISSING+=("Docker -- installed, but the daemon did not answer within ${DOCKER_WAIT:-$DEFAULT_DOCKER_WAIT}s.")
  DEPS_MISSING+=("          Start Docker Desktop, accept the licence, then: docker info")
  return 1
}

# --- The run mode: locally (the default) or everything in Docker ---
# choose_run_mode -- sets RUN_MODE to local or docker. MDL_RUN_MODE picks it without asking; a
# re-run offers the mode tests/harness.env recorded; with no terminal the default is taken.
choose_run_mode() {
  local default=1 recorded reply
  case "${MDL_RUN_MODE:-}" in local|docker) RUN_MODE="$MDL_RUN_MODE"; return 0 ;; esac
  recorded="$(sed -n 's/^MDL_RUN_MODE=//p' "$APP/tests/harness.env" 2>/dev/null | tr -d '"' | head -1)" || recorded=""
  [ "$recorded" = "docker" ] && default=2
  RUN_MODE=local; [ "$default" = 2 ] && RUN_MODE=docker
  if [ ! -t 0 ] || [ -n "${MDL_ASSUME_YES:-}" ]; then return 0; fi
  printf '  How should the app run while you and the agent build it?\n\n'
  printf '    %s1) Locally, without Docker%s  (recommended)\n' "$C_BOLD" "$C_RESET"
  printf '       The Mendix runtime and PostgreSQL run directly on this computer.\n'
  printf '       + A model change is live in about a second (hot reload), so the agent'"'"'s\n'
  printf '         build-and-test loop stays fast\n'
  printf '       + Nothing has to be kept running in the background\n'
  printf '       - PostgreSQL is installed on this computer\n\n'
  printf '    %s2) In Docker, everything inside containers%s\n' "$C_BOLD" "$C_RESET"
  printf '       The Mendix runtime and its database run in Docker containers.\n'
  printf '       + Nothing but Docker is installed; remove the containers and it is gone\n'
  printf '       + Close to how the app runs on a server\n'
  printf '       - Slower: every model change is rebuilt and the app restarted -- about\n'
  printf '         40 seconds, against about 1 locally -- and the first start downloads images\n'
  printf '       - Docker Desktop must be running whenever you or the agent work\n'
  printf '       - Heavier on the computer (Docker Desktop; WSL2 on Windows)\n'
  if [ "$IS_WINDOWS" = "1" ]; then
    printf '       - Studio Pro is still needed: the app is built on this computer\n'
  fi
  printf '\n  Choice [%s]: ' "$default"
  read -r reply
  case "${reply:-$default}" in
    2|d|D|docker|Docker) RUN_MODE=docker ;;
    *)                   RUN_MODE=local ;;
  esac
  printf '\n'
}

# setup_docker_mode -- Docker installed and answering, and tests/harness.env saying the gate
# runs the app through tests/run-docker.sh.
setup_docker_mode() {
  if ! have docker; then
    docker_walkthrough || true
  elif ! docker_ready; then
    ui_clear
    printf '  %s%s%s Docker is installed but not running.\n' "$C_YELLOW" "$I_WARN" "$C_RESET"
    docker_start_and_wait || true
  fi
  mkdir -p "$APP/tests"
  # The person's own switches survive, as in write_harness_env; the local mode's keys do not.
  local previous=""
  [ -f "$APP/tests/harness.env" ] && previous="$(cat "$APP/tests/harness.env" 2>/dev/null)"
  {
    harness_env_header
    printf 'MDL_RUN_MODE=docker\n'
    printf '\n# The app and its database run in Docker. tests/run-docker.sh builds and\n'
    printf '# starts them (mxcli docker run); the gate runs it again after a model change.\n'
    printf 'MDL_BOOT_COMMAND="bash tests/run-docker.sh"\n'
  } > "$APP/tests/harness.env.new"
  if [ -n "$previous" ]; then
    keep_person_switches "$previous" "$APP/tests/harness.env.new" \
      "MDL_NO_DOCKER MDL_MXBUILD_PATH MDL_DB_HOST MDL_DB_NAME MDL_DB_USER MDL_DB_PASSWORD MDL_PSQL JAVA_HOME"
  fi
  mv "$APP/tests/harness.env.new" "$APP/tests/harness.env"
  chmod 600 "$APP/tests/harness.env" 2>/dev/null || true
  ignore_credential_files
}

