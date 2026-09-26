#!/usr/bin/env bash
# tests/run-docker.sh -- boots this project's app in Docker, for MDL_RUN_MODE=docker.
#
# gate.sh --boot-if-needed runs it (MDL_BOOT_COMMAND in tests/harness.env) and waits for the app.
# `mxcli docker run` builds the model into a package and starts the Mendix and PostgreSQL
# containers, every port shifted by APP_PORT-8080 (8081 -> admin 8091, database 5433). The
# runtime log is then followed into .mxcli/runtime.log, for the gate's server-error check. A
# model change is applied by running this again -- a rebuild and a restart, about 40 seconds
# (the gate does it before the tests); a model reload alone misses entity changes.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
# shellcheck source=portable.sh
. tests/portable.sh
MPR="${MPR:-$(find . -maxdepth 1 -name '*.mpr' -print -quit | sed 's|^\./||')}"
[ -n "$MPR" ] || { echo "run-docker.sh: no .mpr in $APP_DIR" >&2; exit 2; }
offset=$(( ${APP_PORT:-8081} - 8080 ))

# Docker Desktop's helpers (the credential store) are not always on a non-login shell's PATH;
# without them pulling an image fails with "docker-credential-... not found".
local_app="${LOCALAPPDATA:-}"
for dir in "/Applications/Docker.app/Contents/Resources/bin" "/c/Program Files/Docker/Docker/resources/bin" \
           "${local_app//\\//}/Programs/DockerDesktop/resources/bin"; do
  [ -d "$dir" ] && PATH="$PATH:$dir"
done

mkdir -p .mxcli
"$MXCLI" docker run -p "$MPR" --port-offset "$offset" --wait --skip-check
touch .mxcli/docker-model.stamp
# The log follower ends by itself when the containers stop.
( "$MXCLI" docker logs -p "$MPR" --follow > .mxcli/runtime.log 2>&1 & )
