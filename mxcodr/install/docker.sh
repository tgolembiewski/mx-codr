# install/docker.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Docker: the walkthrough when the daemon is missing or not running.

# --- 5. Docker: install, start, wait for the daemon ---
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
