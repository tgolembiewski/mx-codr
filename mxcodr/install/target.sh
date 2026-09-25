# install/target.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Section 10: the command-line arguments and the project to install into. Runs as it is read.

# --- 10. Command-line arguments and the target project ---
APP_ARG=""
CREATE_APP=1
WITH_DEPS=0
for arg in "$@"; do
  case "$arg" in
    --no-app) CREATE_APP=0 ;;
    --with-deps) WITH_DEPS=1 ;;
    -h|--help)
      printf 'bash mxcodr/install.sh [path-to-project] [--no-app] [--with-deps]\n\n'
      printf '  Run it from the project folder, one level above mxcodr/:\n'
      printf '    cd <app> && bash mxcodr/install.sh --with-deps\n'
      printf '  not from inside mxcodr/ (cd mxcodr && bash install.sh): that still installs into\n'
      printf '  the folder above, but the target is guessed instead of named.\n\n'
      printf '  path-to-project  where to install (default: the current directory,\n'
      printf '                   or the parent project when run from inside the bundle)\n'
      printf '  --no-app         never create a Mendix app; require one to be there already\n'
      printf '  --with-deps      install missing prerequisites (Python, Node, playwright-cli,\n'
      printf '                   its browser, mxcli, MxBuild) with this machine'"'"'s package manager.\n'
      printf '                   Without it they are only reported. Docker is installed when\n'
      printf '                   missing either way; the JDK is only reported.\n\n'
      printf '  MX_VERSION=%s  APP_NAME=<name>   env overrides when an app is created\n' "$DEFAULT_MX_VERSION"
      printf '  MDL_DEPS_DRY_RUN=1                    print the install commands, run none\n'
      printf '  MDL_ASSUME_YES=1                      answer the prerequisite prompts with yes\n'
      printf '  MDL_NO_UPDATE_CHECK=1                 do not look online for a newer mxcli\n'
      exit 0 ;;
    -*) ui_fail "Unknown option: $arg" "Run with --help to see what this takes." ;;
    *)
      if [ -z "$APP_ARG" ]; then APP_ARG="$arg"; else ui_fail "Only one path can be given (got \"$APP_ARG\" and \"$arg\")."; fi ;;
  esac
done

ui_banner "$version"

if [ -n "$APP_ARG" ]; then APP="$APP_ARG"; else APP="$PWD"; fi
[ -d "$APP" ] || ui_fail "No such directory: $APP"
APP="$(cd "$APP" && pwd)"
# $APP is interpolated into eval'd commands: reject shell metacharacters.
case "$APP" in
  *'`'*|*'$('*|*'"'*|*"'"*|*';'*|*'|'*|*'&'*|*$'\n'*)
    ui_fail "The project path contains a shell metacharacter and cannot be installed into:" \
            "  $APP" \
            "Rename the directory (or move the project) and run the installer again." ;;
esac

# With no path named, running from inside the bundle targets the directory it sits in.
target_inferred=0
looks_like_project() {
  local marker
  [ -n "$(find "$1" -maxdepth 1 -name '*.mpr' -print -quit 2>/dev/null)" ] && return 0
  for marker in CLAUDE.md AGENTS.md .ai-context .claude mxcli; do
    [ -e "$1/$marker" ] && return 0
  done
  return 1
}

case "$APP" in
  "$SRC"|"$SRC"/*)
    if [ -n "$APP_ARG" ]; then
      ui_fail "install.sh installs INTO a Mendix project; that path is the bundle itself." \
              "$APP" \
              "" \
              "Name the project instead:" \
              "  bash $SRC/install.sh /path/to/project"
    fi
    parent="$(cd "$SRC/.." && pwd)"
    if [ "$parent" = "/" ] || [ "$parent" = "$HOME" ]; then
      ui_fail "Nothing installed: $parent is not a project folder." \
              "" \
              "Copy $(basename "$SRC")/ into your Mendix project (or an empty folder for a new app), then run this:" \
              "" \
              "  cd /path/to/project && bash $(basename "$SRC")/install.sh --with-deps"
    fi
    if ! looks_like_project "$parent"; then
      ui_fail "Nothing installed: run the installer from the project folder, not from inside $(basename "$SRC")/." \
              "" \
              "To install, run this:" \
              "" \
              "  cd $parent && bash $(basename "$SRC")/install.sh --with-deps" \
              "" \
              "There is no Mendix app in $parent yet, so that creates one first."
    fi
    APP="$parent"
    target_inferred=1 ;;
esac

# No .mpr: create an app (MX_VERSION, APP_NAME) unless --no-app.
mpr_count=$(find "$APP" -maxdepth 1 -name '*.mpr' | wc -l | tr -d ' ')
if [ "$mpr_count" = "0" ] && [ "$CREATE_APP" = "0" ]; then
  ui_fail "No .mpr in $APP" \
          "Point this at a Mendix project, or drop --no-app to have one created here."
fi

if [ "$target_inferred" = 1 ]; then
  printf '  %s%s target%s %s  %s(the project this bundle sits in)%s\n' \
    "$C_GREY" "$I_BOX" "$C_RESET" "$APP" "$C_GREY" "$C_RESET"
  printf '  %s  next time run it from the project folder: cd %s && bash %s/install.sh%s\n' \
    "$C_GREY" "$APP" "$(basename "$SRC")" "$C_RESET"
else
  printf '  %s%s target%s %s\n' "$C_GREY" "$I_BOX" "$C_RESET" "$APP"
fi
printf '\n'

# Ask before creating an app in a directory the caller did not name.
if [ "$target_inferred" = 1 ] && [ "$mpr_count" = "0" ] && [ "$CREATE_APP" = "1" ]; then
  if [ -t 0 ] && [ "$UI_TTY" = 1 ]; then
    printf '  %s%s%s There is no Mendix app in %s.\n' "$C_YELLOW" "$I_WARN" "$C_RESET" "$APP"
    printf '    Create an empty one there now? [y/N] '
    read -r reply
    case "$reply" in
      y|Y|yes|YES) printf '\n' ;;
      *) ui_fail "Nothing installed." "Name a project with an app, or pass --no-app to install without creating one." ;;
    esac
  else
    ui_fail "Nothing installed: run the installer from the project folder, not from inside $(basename "$SRC")/." \
            "" \
            "To install, run this:" \
            "" \
            "  cd $APP && bash $(basename "$SRC")/install.sh --with-deps" \
            "" \
            "There is no Mendix app in $APP yet, so that creates one first."
  fi
fi

# NOTE: there are 12 ui_done steps (13 with a new app), so these totals are one short.
if [ "$mpr_count" = "0" ]; then ui_plan 14; else ui_plan 13; fi
