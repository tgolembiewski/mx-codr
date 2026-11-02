#!/usr/bin/env bash
# mx-codr installer (harness v2, skills only; macOS, Linux, Git Bash): check Node >= 20, then hand over to
# the Node installer, which runs from this bundle and writes into the app only the rule file, our skills
# and .mxcodr/ (installed.json, and bin/ when it downloads mxcli). With no .mpr in the folder it first
# creates the Mendix app there (mxcli new; MX_VERSION, APP_NAME), unless --no-app.
#   cd <folder> && bash mxcodr/install.sh [--db hsqldb|postgres] [--agent claude[,cursor,codex,opencode,pi]] [--theme <name>] [--yes] [--boot] [--request <file>] [--no-app]
# The folder may also be named first: bash install.sh <app folder> [options]. Without one it is the current
# folder, or the folder the bundle sits in when run from inside mxcodr/.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
usage='usage: bash install.sh [<app folder>] [--db hsqldb|postgres] [--agent claude[,cursor,codex,opencode,pi]] [--theme <name>] [--yes] [--boot] [--request <file>] [--no-app]'
for a in "$@"; do
  case "$a" in
    -h|--help)
      printf '%s\n\n' "$usage"
      printf '  <app folder>  default: the current folder, or the folder holding mxcodr/ when run from inside it\n'
      printf '  no .mpr there: a Mendix app is created (MX_VERSION, default 11.12.1; APP_NAME, default the\n'
      printf '                folder name in letters and digits); --no-app stops instead. Existing files stay.\n'
      printf '  --agent       default claude (or the last install'"'"'s); --db default postgres when port 5432\n'
      printf '                answers, else hsqldb; --yes or no terminal: no theme question\n'
      exit 0 ;;
  esac
done
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  app="$1"; shift
else
  # no folder named: the current one, or the bundle's parent when we stand inside the bundle (physical paths:
  # /tmp and /var are links on macOS)
  cwd="$(pwd -P)"; bundle="$(cd "$here" && pwd -P)"
  case "$cwd/" in "$bundle"/*) app="$(dirname "$bundle")" ;; *) app="$cwd" ;; esac
fi
[ -d "$app" ] || { echo "mxcodr: no folder $app" >&2; exit 2; }
if ! command -v node >/dev/null 2>&1; then
  echo "mxcodr: Node.js 20 or later is needed: https://nodejs.org (macOS: brew install node)" >&2; exit 2
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "mxcodr: Node $(node -v) is too old; install Node 20 or later (https://nodejs.org)" >&2; exit 2
fi
# Git Bash: Node on Windows reads /c/Users/... as C:\c\Users\..., so paths it gets are Windows paths
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }
# --request <file>: saved word for word in docs/requests/NN.md; made absolute before the cd
args=()
while [ $# -gt 0 ]; do
  if [ "$1" = "--request" ] && [ $# -gt 1 ]; then
    [ -f "$2" ] || { echo "mxcodr: no request file $2" >&2; exit 2; }
    args+=("--request" "$(native "$(cd "$(dirname "$2")" && pwd)/$(basename "$2")")"); shift 2
  else args+=("$1"); shift; fi
done
app="$(cd "$app" && pwd -P)"
cd "$app"
exec node "$(native "$here/overlay/install.mjs")" "$(native "$app")" ${args[@]+"${args[@]}"}
