#!/usr/bin/env bash
# mx-codr installer (harness v2, skills only; macOS, Linux, Git Bash): check Node >= 20, then hand over to
# the Node installer, which runs from this bundle and writes into the app only the rule file, our skills
# and .mxcodr/ (installed.json, and bin/ when it downloads mxcli).
#   bash install.sh <app folder> [--db hsqldb|postgres] [--agent claude[,cursor,codex,opencode,pi]] [--theme <name>] [--yes] [--boot] [--request <file>]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
usage='usage: bash install.sh <app folder> [--db hsqldb|postgres] [--agent claude[,cursor,codex,opencode,pi]] [--theme <name>] [--yes] [--boot] [--request <file>]'
app="${1:?$usage}"; shift
[ -d "$app" ] || { echo "mxcodr: no folder $app" >&2; exit 2; }
if ! command -v node >/dev/null 2>&1; then
  echo "mxcodr: Node.js 20 or later is needed: https://nodejs.org (macOS: brew install node)" >&2; exit 2
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "mxcodr: Node $(node -v) is too old; install Node 20 or later (https://nodejs.org)" >&2; exit 2
fi
# --request <file>: saved word for word in docs/requests/NN.md; made absolute before the cd
args=()
while [ $# -gt 0 ]; do
  if [ "$1" = "--request" ] && [ $# -gt 1 ]; then
    [ -f "$2" ] || { echo "mxcodr: no request file $2" >&2; exit 2; }
    args+=("--request" "$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"); shift 2
  else args+=("$1"); shift; fi
done
app="$(cd "$app" && pwd)"
cd "$app"
exec node "$here/overlay/install.mjs" "$app" ${args[@]+"${args[@]}"}
