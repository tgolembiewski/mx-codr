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
      printf '  Run it from the mx-codr folder you cloned; it asks for the Mendix project folder,\n'
      printf '  copies mxcodr/ there and installs:\n'
      printf '    bash mx-codr/mxcodr/install.sh --with-deps\n\n'
      printf '  path-to-project  the Mendix project (default: asked for, or the current folder\n'
      printf '                   when it holds a *.mpr). Never the mx-codr folder itself\n'
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

# The project folder: the one named on the command line, or the one asked for here. Running
# from inside a Mendix app (a *.mpr next to you) counts as naming it. The bundle and the mx-codr
# repo it was cloned with are never the project: guessing "the folder above the bundle" put two
# installs into the repo clone.
# Paths are compared physically (pwd -P): on macOS /tmp is a link to /private/tmp.
SRC_REAL="$(cd "$SRC" && pwd -P)"
REPO_ROOT=""
[ -e "$SRC/../.mx-codr-repo" ] && REPO_ROOT="$(cd "$SRC/.." && pwd -P)"
is_bundle_or_repo() {   # is_bundle_or_repo <path>
  local real
  real="$(cd "$1" 2>/dev/null && pwd -P)" || real="$1"
  case "$real" in
    "$SRC_REAL"|"$SRC_REAL"/*) return 0 ;;
  esac
  if [ -n "$REPO_ROOT" ]; then
    case "$real" in "$REPO_ROOT"|"$REPO_ROOT"/*) return 0 ;; esac
  fi
  return 1
}
to_unix_path() {        # C:\Mendix\App or ~/App -> an absolute path bash can use
  local path="$1"
  path="${path%\"}"; path="${path#\"}"
  case "$path" in "~"|"~/"*) path="$HOME${path#\~}" ;; esac
  if command -v cygpath >/dev/null 2>&1; then path="$(cygpath -u "$path")"; fi
  printf '%s\n' "$path"
}
project_state() {       # project_state <dir> -- one line saying what the install will do there
  local mpr
  mpr="$(find "$1" -maxdepth 1 -name '*.mpr' -print -quit 2>/dev/null)"
  if [ -n "$mpr" ]; then
    printf 'the Mendix app %s' "$(basename "$mpr")"
  elif [ "$CREATE_APP" = "1" ]; then
    printf 'no Mendix app yet: a new one (Mendix %s) is created there' "${MX_VERSION:-$DEFAULT_MX_VERSION}"
  else
    printf 'no Mendix app, and --no-app was given'
  fi
}

if [ -n "$APP_ARG" ]; then
  APP="$(to_unix_path "$APP_ARG")"
elif [ -t 0 ] && [ -z "${MDL_ASSUME_YES:-}" ]; then
  # Asked, with the current folder as the default unless it is the mx-codr clone.
  default_app=""
  is_bundle_or_repo "$PWD" || default_app="$PWD"
  default_shown="$default_app"
  command -v cygpath >/dev/null 2>&1 && [ -n "$default_app" ] && default_shown="$(cygpath -w "$default_app")"
  printf '  Where is your Mendix project? A folder with an app in it, or a new or empty folder\n'
  printf '  for a new app -- not the mx-codr folder you cloned.\n\n'
  if [ -n "$default_app" ]; then
    printf '  Project folder [%s]: ' "$default_shown"
  else
    printf '  Project folder: '
  fi
  read -r reply
  [ -n "$reply" ] || reply="$default_app"
  [ -n "$reply" ] || ui_fail "Nothing installed: no project folder given."
  APP="$(to_unix_path "$reply")"
elif [ -n "$(find "$PWD" -maxdepth 1 -name '*.mpr' -print -quit 2>/dev/null)" ] && ! is_bundle_or_repo "$PWD"; then
  APP="$PWD"   # not interactive, run from inside an app: that app
else
  ui_fail "Nothing installed: name the Mendix project folder." \
          "" \
          "  bash $SRC/install.sh /path/to/project --with-deps"
fi
case "$APP" in /*) ;; *) APP="$PWD/$APP" ;; esac
mkdir -p "$APP" 2>/dev/null || ui_fail "Cannot create the project folder: $APP"
APP="$(cd "$APP" && pwd)"
# $APP is interpolated into eval'd commands: reject shell metacharacters.
case "$APP" in
  *'`'*|*'$('*|*'"'*|*"'"*|*';'*|*'|'*|*'&'*|*$'\n'*)
    ui_fail "The project path contains a shell metacharacter and cannot be installed into:" \
            "  $APP" \
            "Rename the directory (or move the project) and run the installer again." ;;
esac
if is_bundle_or_repo "$APP"; then
  ui_fail "Nothing installed: $APP is the mx-codr folder, not a Mendix project." \
          "" \
          "Give the folder of your Mendix app, or a new folder for a new app, outside it:" \
          "" \
          "  bash $SRC/install.sh /path/to/project --with-deps"
fi

# Windows: without Studio Pro nothing here works -- creating the app, mx check and the build all
# run the mx.exe / mxbuild.exe it installs (Mendix publishes them separately for Linux only).
# Say so first, before minutes of other installs, rather than when the app is created.
if [ "$IS_WINDOWS" = "1" ] && [ -z "$(studio_pro_versions)" ] && [ -z "${MDL_SKIP_STUDIO_PRO_CHECK:-}" ]; then
  wanted_mx="${MX_VERSION:-}"
  mpr_file="$(find "$APP" -maxdepth 1 -name '*.mpr' -print -quit 2>/dev/null)"
  if [ -z "$wanted_mx" ] && [ -n "$mpr_file" ] && [ -n "${PY:-}" ]; then
    wanted_mx="$("$PY" -c 'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("select _ProductVersion from _MetaData").fetchone()[0])' "$mpr_file" 2>/dev/null || true)"
  fi
  wanted_mx="${wanted_mx:-$DEFAULT_MX_VERSION}"
  ui_fail "Mendix Studio Pro is not installed. Install it first, then run the installer again." \
          "" \
          "On Windows the harness cannot work without it: creating the app, mx check and" \
          "building the app all use the mx.exe and mxbuild.exe that come with Studio Pro." \
          "Docker does not replace it." \
          "" \
          "  1. Install Mendix Studio Pro $wanted_mx:" \
          "     https://marketplace.mendix.com/link/studiopro/" \
          "  2. Run this again:" \
          "     bash $SRC/install.sh \"$APP\" --with-deps"
fi

# No .mpr: create an app (MX_VERSION, APP_NAME) unless --no-app.
mpr_count=$(find "$APP" -maxdepth 1 -name '*.mpr' | wc -l | tr -d ' ')
if [ "$mpr_count" = "0" ] && [ "$CREATE_APP" = "0" ]; then
  ui_fail "No .mpr in $APP" \
          "Point this at a Mendix project, or drop --no-app to have one created here."
fi

printf '  %s%s target%s %s  %s(%s)%s\n\n' "$C_GREY" "$I_BOX" "$C_RESET" "$APP" "$C_GREY" "$(project_state "$APP")" "$C_RESET"
# A copy of the bundle goes into the project, so it can be re-run from there.
if [ "$SRC_REAL" != "$(cd "$APP" && pwd -P)/mxcodr" ]; then
  rm -rf "$APP/mxcodr" && cp -R "$SRC" "$APP/mxcodr" \
    || ui_fail "Could not copy the bundle into $APP/mxcodr"
  find "$APP/mxcodr" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null
fi

# NOTE: there are 12 ui_done steps (13 with a new app), so these totals are one short.
if [ "$mpr_count" = "0" ]; then ui_plan 14; else ui_plan 13; fi
