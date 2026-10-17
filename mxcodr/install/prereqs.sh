# install/prereqs.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Prerequisite helpers: package managers, installing or only reporting a missing tool, yes/no questions.

# --- Prerequisite helpers: detect a tool, then install it or report it ---
# The JDK is only reported (may need a reboot or licence click); Docker is installed when missing.
DEPS_INSTALLED=0
DEPS_MISSING=()          # human lines, printed in the summary rather than mid-step

have() { command -v "$1" >/dev/null 2>&1; }

pkg_manager() {
  if [ "$IS_WINDOWS" = "1" ]; then have winget && { echo winget; return 0; }; fi
  have brew   && { echo brew;   return 0; }
  have apt-get && { echo apt;   return 0; }
  have dnf    && { echo dnf;    return 0; }
  echo ""
}

# Root in a container has no sudo; a normal user outside one needs it.
SUDO=""
if [ "$(id -u 2>/dev/null || echo 0)" != "0" ] && have sudo; then SUDO="sudo "; fi

dep_run() {              # dep_run "<shell command>" -- honours the dry run
  if [ -n "${MDL_DEPS_DRY_RUN:-}" ]; then
    ui_note "would run: $1"
    return 0
  fi
  # DEPS_LOG is set by step_prereqs.sh.
  eval "$1" >>"$DEPS_LOG" 2>&1
}

# dep_apply <label> <detect> <install> -- install unless detected; 0 if present afterwards. Never aborts.
dep_apply() {
  local label="$1" detect="$2" command="$3"
  eval "$detect" >/dev/null 2>&1 && return 0

  if [ "$WITH_DEPS" = "0" ] || [ -z "$command" ]; then
    DEPS_MISSING+=("$label -- ${command:-no package manager found; install it by hand}")
    return 1
  fi

  ui_sub "installing $label"
  if dep_run "$command" && { [ -n "${MDL_DEPS_DRY_RUN:-}" ] || eval "$detect" >/dev/null 2>&1; }; then
    DEPS_INSTALLED=$(( DEPS_INSTALLED + 1 ))
    return 0
  fi
  DEPS_MISSING+=("$label -- $command  (tried, and it did not take; see $DEPS_LOG)")
  return 1
}

# dep_need <label> <detect> <winget-id> <brew> <apt/dnf> -- build this machine's install command, then dep_apply.
dep_need() {
  local command=""
  case "$(pkg_manager)" in
    winget) command="winget install -e --accept-package-agreements --accept-source-agreements --id $3" ;;
    brew)   command="brew install $4" ;;
    apt)    command="${SUDO}apt-get update -qq && ${SUDO}apt-get install -y $5" ;;
    dnf)    command="${SUDO}dnf install -y $5" ;;
  esac
  dep_apply "$1" "$2" "$command"
}

# Report-only: a reboot or licence click stands between the install command and a working tool.
dep_report_only() {      # dep_report_only <label> <detect> <winget> <brew> <apt>
  eval "$2" >/dev/null 2>&1 && return 0
  local command=""
  case "$(pkg_manager)" in
    winget) command="winget install -e --id $3" ;;
    brew)   command="brew install $4" ;;
    apt)    command="${SUDO}apt-get install -y $5" ;;
    dnf)    command="${SUDO}dnf install -y $5" ;;
  esac
  DEPS_MISSING+=("$1 -- ${command:-install it by hand}  (not installed for you)")
  return 1
}

# ask "<prompt>" <y|n> -- MDL_ASSUME_YES answers yes (the app-creation guard does not use ask).
ask() {
  local question="$1" default="$2" reply
  # The progress bar is redrawn in place on its own line, with no newline: a question printed
  # now landed on the same line ("0%  checking prerequisites    mxcli v0.24.0 is available...").
  # Wipe the bar first; the next step draws it again below the answer.
  ui_clear
  if [ -n "${MDL_ASSUME_YES:-}" ]; then
    printf '%syes  %s(MDL_ASSUME_YES)%s\n' "$question" "$C_GREY" "$C_RESET"
    return 0
  fi
  printf '%s' "$question"
  read -r reply
  case "${reply:-$default}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}
