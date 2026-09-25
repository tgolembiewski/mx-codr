# install/ui.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Terminal output: the banner, the progress bar and every ui_* line the install prints.

# --- 2. Terminal output: colours, icons, progress bar ---
# Output only. Plain lines when not a TTY, ASCII icons without UTF-8.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  UI_TTY=1
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_BLUE=$'\033[38;5;39m'; C_CYAN=$'\033[38;5;44m'; C_GREEN=$'\033[38;5;42m'
  C_YELLOW=$'\033[38;5;214m'; C_RED=$'\033[38;5;203m'; C_GREY=$'\033[38;5;245m'
else
  UI_TTY=0
  C_RESET=""; C_BOLD=""; C_DIM=""
  C_BLUE=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_GREY=""
fi

case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8*|*utf8*|*UTF8*) UI_UNICODE=1 ;;
  *) UI_UNICODE=0 ;;
esac

if [ "$UI_UNICODE" = 1 ]; then
  I_OK="✔"; I_WARN="!"; I_FAIL="✘"; I_DOT="·"; I_ARROW="→"; I_PLAY="▶"; I_BOX="▪"
  BAR_FULL="█"; BAR_EMPTY="░"
else
  I_OK="+"; I_WARN="!"; I_FAIL="x"; I_DOT="-"; I_ARROW="->"; I_PLAY=">"; I_BOX="*"
  BAR_FULL="#"; BAR_EMPTY="."
fi

ui_banner() {
  local version="$1"
  # Terminals narrower than 62 columns get plain words instead of the wordmark.
  if [ "$UI_UNICODE" = 1 ] && [ "${UI_COLS:-80}" -ge 62 ]; then
    printf '\n'
    printf '%s  ███╗   ███╗██╗  ██╗       ██████╗ ██████╗ ██████╗ ██████╗ %s\n' "$C_BLUE" "$C_RESET"
    printf '%s  ████╗ ████║╚██╗██╔╝      ██╔════╝██╔═══██╗██╔══██╗██╔══██╗%s\n' "$C_BLUE" "$C_RESET"
    printf '%s  ██╔████╔██║ ╚███╔╝ █████╗██║     ██║   ██║██║  ██║██████╔╝%s\n' "$C_CYAN" "$C_RESET"
    printf '%s  ██║╚██╔╝██║ ██╔██╗ ╚════╝██║     ██║   ██║██║  ██║██╔══██╗%s\n' "$C_CYAN" "$C_RESET"
    printf '%s  ██║ ╚═╝ ██║██╔╝ ██╗      ╚██████╗╚██████╔╝██████╔╝██║  ██║%s\n' "$C_CYAN" "$C_RESET"
    printf '%s  ╚═╝     ╚═╝╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝%s\n' "$C_CYAN" "$C_RESET"
    printf '\n  %sversion:%s %s\n\n' "$C_BOLD" "$C_RESET" "$version"
  else
    printf '\n  %smx-codr%s  %s\n' "$C_BOLD" "$C_RESET" "$version"
    printf '  mxcli %s MDL skills, lint rules, hooks and the delivery gate\n\n' "$I_DOT"
  fi
}

# The bar counts whole steps, fixed up front; app creation adds sub-progress inside its step.
UI_COLS="${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}"
[ "$UI_COLS" -ge 40 ] 2>/dev/null || UI_COLS=80
UI_TOTAL=1
UI_STEP=0
UI_LABEL=""
UI_SUB_SEEN=0

# ui_plan <steps> -- set how many steps the bar is divided into (called once).
ui_plan() { UI_TOTAL="$1"; }

# ui_pct -- print the percentage: done steps plus sub-progress, capped inside the current step.
ui_pct() {
  local span=$(( 100 / UI_TOTAL ))
  local base=$(( UI_STEP * 100 / UI_TOTAL ))
  local inside=0 cap=$(( span * 9 / 10 ))   # sub-progress never fills more than 90% of a step
  if [ "$UI_SUB_SEEN" -gt 0 ]; then
    inside=$(( span * UI_SUB_SEEN / UI_SUB_EXPECTED ))
    [ "$inside" -gt "$cap" ] && inside="$cap"
  fi
  echo $(( base + inside ))
}

# ui_bar -- redraw the progress bar in place (TTY only).
ui_bar() {
  [ "$UI_TTY" = 1 ] || return 0
  local pct width="$UI_BAR_WIDTH" filled i bar=""
  pct="$(ui_pct)"
  filled=$(( pct * width / 100 ))
  i=0
  while [ "$i" -lt "$width" ]; do
    if [ "$i" -lt "$filled" ]; then bar="$bar$BAR_FULL"; else bar="$bar$BAR_EMPTY"; fi
    i=$(( i + 1 ))
  done
  local label="$UI_LABEL" max=$(( UI_COLS - width - 11 ))
  [ "$max" -lt 8 ] && max=8
  if [ "${#label}" -gt "$max" ]; then label="${label:0:$(( max - 1 ))}~"; fi
  printf '\r\033[K  %s%s%s  %s%3s%%%s  %s%s%s' \
    "$C_BLUE" "$bar" "$C_RESET" "$C_BOLD" "$pct" "$C_RESET" "$C_GREY" "$label" "$C_RESET"
}

# ui_clear -- wipe the bar's line. Explicit return 0 so a false test does not trip set -e.
ui_clear() { [ "$UI_TTY" = 1 ] && printf '\r\033[K'; return 0; }

ui_begin() {           # ui_begin "label"
  UI_LABEL="$1"
  UI_SUB_SEEN=0
  [ "$UI_TTY" = 1 ] || printf '  %s %s\n' "$I_DOT" "$1"
  ui_bar
}

ui_sub() {             # ui_sub "phase name" -- transient detail inside a step
  UI_SUB_SEEN=$(( UI_SUB_SEEN + 1 ))
  if [ "$UI_TTY" = 1 ]; then
    UI_LABEL="${UI_LABEL%% $I_DOT *} $I_DOT $1"
    ui_bar
  else
    printf '     %s %s\n' "$I_DOT" "$1"
  fi
}

ui_tick() {            # progress without a new label: the tool is still working
  UI_SUB_SEEN=$(( UI_SUB_SEEN + 1 ))
  ui_bar
}

ui_done() {            # ui_done "label" "detail"
  UI_STEP=$(( UI_STEP + 1 ))
  UI_SUB_SEEN=0
  ui_clear
  if [ -n "${2:-}" ]; then
    printf '  %s%s%s %-26s %s%s%s\n' "$C_GREEN" "$I_OK" "$C_RESET" "$1" "$C_GREY" "$2" "$C_RESET"
  else
    printf '  %s%s%s %s\n' "$C_GREEN" "$I_OK" "$C_RESET" "$1"
  fi
  UI_LABEL=""
  ui_bar
}

ui_note() {            # a fact worth keeping on screen, not a step
  ui_clear
  printf '  %s%s%s %s\n' "$C_YELLOW" "$I_WARN" "$C_RESET" "$1"
  ui_bar
}

ui_fail() {            # print every argument as its own line, then die
  ui_clear
  printf '  %s%s%s %s%s%s\n' "$C_RED" "$I_FAIL" "$C_RESET" "$C_BOLD" "$1" "$C_RESET" >&2
  shift
  while [ "$#" -gt 0 ]; do printf '    %s\n' "$1" >&2; shift; done
  printf '\n' >&2
  exit 1
}

ui_head() {            # section heading in the summary
  printf '\n  %s%s %s%s\n' "$C_BOLD" "$1" "$2" "$C_RESET"
}

ui_row() {             # ui_row "what" "count" "where" -- summary line
  printf '     %s%-10s%s %s%3s%s  %s\n' "$C_CYAN" "$1" "$C_RESET" "$C_BOLD" "$2" "$C_RESET" "$3"
}
