#!/usr/bin/env bash
# run-app.sh -- boot the app without `mxcli run --local` (which cannot boot on Windows):
# mxbuild deployment, standalone runtime, M2EE admin API. Run by gate.sh --boot-if-needed
# (MDL_BOOT_COMMAND in tests/harness.env) or by hand. Settings from tests/harness.env.
#   bash tests/run-app.sh [--rebuild]    (rebuilds anyway when the .mpr is newer; MPR= picks one)
# Prints "== step" lines; exit 0 with "== app up on ...", exit 1 with "== start FAILED".
set -euo pipefail

# --- 1. Paths and settings ---
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
# harness.env is read as data, not sourced (see tests/portable.sh).
. "$APP_DIR/tests/portable.sh"
mdl_load_harness_env "$APP_DIR/tests/harness.env" export

case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE_SUFFIX=".exe" ;; *) EXE_SUFFIX="" ;; esac

# All paths derived from the Mendix version and harness.env; override in the environment.
mdl_find_mpr || exit 1
case "$MPR" in /*) ;; *) MPR="$APP_DIR/$MPR" ;; esac
MX_VERSION="${MX_VERSION:-$(basename "${MDL_MXBUILD_PATH:-}")}"
if [ -z "$MX_VERSION" ] || [ ! -d "$HOME/.mxcli/mxbuild/$MX_VERSION" ]; then
  for _d in "$HOME"/.mxcli/mxbuild/*/; do [ -d "$_d" ] && MX_VERSION="$(basename "$_d")"; done
fi
MXCACHE="${MXCACHE:-$HOME/.mxcli/mxbuild/$MX_VERSION}"
# The mxbuild cache first, else the Studio Pro install tests/harness.env names: with a per-user
# Studio Pro the installer filled the cache with gradle and the JDK only, and every boot failed
# on "mxbuild.exe: No such file or directory".
STUDIO="${MDL_MXBUILD_PATH:-}"
pick() {   # pick <cache-path> <studio-path> -- the first that exists, else the cache path
  if [ -e "$1" ] || [ -z "$STUDIO" ] || [ ! -e "$2" ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi
}
MXBUILD="${MXBUILD:-$(pick "$MXCACHE/modeler/mxbuild$EXE_SUFFIX" "$STUDIO/modeler/mxbuild$EXE_SUFFIX")}"
MXBUILD_TOOLS="${MXBUILD_TOOLS:-$(pick "$MXCACHE/modeler/tools/node" "$STUDIO/modeler/tools/node")}"
RUNTIME="${RUNTIME:-$(dirname "$(dirname "$(dirname "$(pick "$HOME/.mxcli/runtime/$MX_VERSION/runtime/launcher/runtimelauncher.jar" \
  "$STUDIO/runtime/launcher/runtimelauncher.jar")")")")}"
# JAVA_HOME must be space-free: mxbuild splits its arguments on spaces.
JAVA_DIR="${JAVA_HOME:-}"
JAVA="${JAVA:-$JAVA_DIR/bin/java$EXE_SUFFIX}"
GRADLE_HOME="${GRADLE_HOME:-$MXCACHE/gradle-8.5}"
[ -d "$GRADLE_HOME" ] || GRADLE_HOME="${MDL_MXBUILD_PATH:-}/gradle-8.5"
APP_PORT="${APP_PORT:-8081}"
ADMIN_PORT="${ADMIN_PORT:-8090}"
# mxcli oql and diagnose.sh use this password by default.
ADMIN_PASS="${ADMIN_PASSWORD:-${ADMIN_PASS:-mxcli-local-dev}}"
DB_HOST="${MDL_DB_HOST:-127.0.0.1:5432}"
DB_NAME="${MDL_DB_NAME:-$(basename "$MPR" .mpr | tr '[:upper:]' '[:lower:]')}"
DB_USER="${MDL_DB_USER:-mendix}"
DB_PASSWORD="${MDL_DB_PASSWORD:-mendix}"
PY="${PY:-$(mdl_find_python)}"

# Fixed values, named here so they read as what they are.
ADMIN_WAIT_SECONDS=90         # how long to wait for the admin API after starting java
ADMIN_REQUEST_SECONDS=300     # the longest wait for one admin action
DEPLOYMENT="$APP_DIR/deployment"
BUILT_MODEL="$DEPLOYMENT/model/model.mdp"
HSQLDB_DIR="$DEPLOYMENT/data/database"

# --- Helpers ---

# admin <json-body> -- send one M2EE admin action, print the JSON answer.
admin() {                                   # admin <json-body>
  curl -s -m "$ADMIN_REQUEST_SECONDS" -H "X-M2EE-Authentication: $(printf '%s' "$ADMIN_PASS" | base64)" \
    -H 'Content-Type: application/json' -d "$1" "http://127.0.0.1:$ADMIN_PORT/"
}

# Kill every Mendix runtime java process (Windows/PowerShell).
stop_runtime() {
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { \$_.CommandLine -like '*runtimelauncher*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1 || true
  sleep 2
}

# needs_rebuild [--rebuild] -- true when asked or the .mpr is newer than the built deployment (no hot reload).
needs_rebuild() {
  [ "${1:-}" = "--rebuild" ] && return 0
  [ -f "$BUILT_MODEL" ] || return 0
  [ "$MPR" -nt "$BUILT_MODEL" ]
}

# --- 2. Build the deployment ---
# --target=deploy cleans deployment/ and can corrupt Studio Pro's HSQLDB there: save and restore it.
build_deployment() {
  local saved_db=""
  echo "== building deployment (this is the slow part)"
  stop_runtime
  if [ -d "$HSQLDB_DIR" ]; then
    saved_db="$(mdl_tmpdir mdl-hsqldb)"
    cp -R "$HSQLDB_DIR/." "$saved_db/" 2>/dev/null || saved_db=""
  fi
  # Output to a file, not a pipe: Gradle leaves a daemon behind that holds a pipe open, so
  # `mxbuild | tail` waited for ever after a failed build -- the boot hung instead of failing.
  local build_log="$APP_DIR/.mxcli/mxbuild.log" build_ok=1
  mkdir -p "$APP_DIR/.mxcli"
  "$MXBUILD" "--java-home=$JAVA_DIR" "--java-exe-path=$JAVA" \
    "--gradle-home=$GRADLE_HOME" --target=deploy "$MPR" > "$build_log" 2>&1 || build_ok=0
  tail -3 "$build_log"
  if [ -n "$saved_db" ]; then
    mkdir -p "$HSQLDB_DIR"
    cp -R "$saved_db/." "$HSQLDB_DIR/" 2>/dev/null || true
    rm -rf "$saved_db"
    echo "   (Studio Pro's local database kept across the build)"
  fi
  if [ "$build_ok" = "0" ]; then
    echo "== build FAILED -- full output: $build_log"
    # A Java compile error is in Gradle's own log; its first lines say what is missing.
    grep -h -m5 'error:' "$DEPLOYMENT"/log/*gradle_log.txt 2>/dev/null | sed 's/^/   /'
    echo "== start FAILED" >&2
    exit 1
  fi
}

# --- 3. Point the built configuration at PostgreSQL ---
point_config_at_postgres() {
  "$PY" - "$APP_DIR" "$DB_HOST" "$DB_NAME" "$DB_USER" "$DB_PASSWORD" "$APP_PORT" <<'PY'
import json, pathlib, sys
app, host, name, user, password, port = sys.argv[1:7]
p = pathlib.Path(app) / 'deployment' / 'model' / 'config.json'
cfg = json.loads(p.read_text())
cfg['Configuration'].update({
    'DatabaseType': 'PostgreSQL', 'DatabaseHost': host,
    'DatabaseName': name, 'DatabaseUserName': user,
    'DatabasePassword': password,
    'ApplicationRootUrl': 'http://localhost:%s/' % port,
})
p.write_text(json.dumps(cfg, indent=2))
PY
}

# --- 4. Bundle the web client ---
# mxbuild never runs rollup; without dist/index.js the app renders a blank page.
web_client_needs_bundling() {
  [ ! -f "$DEPLOYMENT/web/dist/index.js" ] \
    || [ "$DEPLOYMENT/web/index.js" -nt "$DEPLOYMENT/web/dist/index.js" ]
}

# Print the first bundled node that exists (ARM Studio Pro ships win-arm64 only); nothing if none.
find_bundled_node() {
  local platform
  for platform in win-x64 win-arm64 linux-x64 darwin-arm64; do
    if [ -x "$MXBUILD_TOOLS/$platform/node$EXE_SUFFIX" ]; then
      echo "$MXBUILD_TOOLS/$platform/node$EXE_SUFFIX"
      return 0
    fi
  done
}

bundle_web_client() {
  local node
  echo "== bundling the web client (mxbuild skips this)"
  node="$(find_bundled_node)"
  [ -n "$node" ] || { echo "no bundled node under $MXBUILD_TOOLS" >&2; exit 1; }
  ( cd "$DEPLOYMENT/web" && NODE_ENV=production "$node" \
      "$MXBUILD_TOOLS/node_modules/rollup/dist/bin/rollup" -c rollup.config.mjs 2>&1 | tail -2 )
}

# --- 5. Start the runtime ---
start_runtime() {
  echo "== starting the runtime container"
  stop_runtime
  # studiopro=true registers the /dev/ servlets `mxcli oql` needs.
  MX_INSTALL_PATH="$RUNTIME" M2EE_ADMIN_PASS="$ADMIN_PASS" M2EE_ADMIN_PORT="$ADMIN_PORT" \
    nohup "$JAVA" -Dmendix.running.locally.by.studiopro=true \
    -jar "$RUNTIME/runtime/launcher/runtimelauncher.jar" \
    "$(cygpath -w "$DEPLOYMENT" 2>/dev/null || echo "$DEPLOYMENT")" \
    > "$APP_DIR/.mxcli/runtime.log" 2>&1 &
}

# Poll once a second until the admin API answers; carry on after ADMIN_WAIT_SECONDS regardless.
wait_for_admin_api() {
  local attempt
  for attempt in $(seq 1 "$ADMIN_WAIT_SECONDS"); do
    curl -s -m 2 -o /dev/null "http://127.0.0.1:$ADMIN_PORT/" && break
    sleep 1
  done
}

# --- 6. Configure and start through the admin API ---
# BasePath/RuntimePath have no defaults; json.dumps escapes Windows backslashes.
config_json() {
  "$PY" - "$(cygpath -w "$DEPLOYMENT")" "$(cygpath -w "$RUNTIME/runtime")" "$APP_PORT" \
        "$DB_HOST" "$DB_NAME" "$DB_USER" "$DB_PASSWORD" <<'PY'
import json, sys
base, runtime, port, host, name, user, password = sys.argv[1:8]
print(json.dumps({"action": "update_configuration", "params": {
    "BasePath": base,
    "RuntimePath": runtime,
    "DTAPMode": "D",
    "DatabaseType": "PostgreSQL", "DatabaseHost": host,
    "DatabaseName": name,
    "DatabaseUserName": user, "DatabasePassword": password,
    "ApplicationRootUrl": "http://localhost:%s/" % port,
    "MicroflowConstants": {
        "FeedbackModule.LocalStorageKey": "mxfeedback-form-data",
        "FeedbackModule.ClientIdentifier": "Feedback Module 4.0.2"},
}}))
PY
}

configure_runtime() {
  # Jetty needs all three params, or `start` fails with "No Runtime Jetty server available".
  admin "{\"action\":\"update_appcontainer_configuration\",\"params\":{\"runtime_port\":$APP_PORT,\"runtime_listen_addresses\":\"127.0.0.1\",\"runtime_jetty_options\":{}}}" >/dev/null
  admin "$(config_json)" >/dev/null
}

# Start the app; exit 0 with "== app up on ...", or print the answer and exit 1.
start_app() {
  local result
  result="$(admin '{"action":"start"}')"
  # result 3: schema behind the model -- apply DDL and start again.
  case "$result" in
    *'"result":3'*) admin '{"action":"execute_ddl_commands"}' >/dev/null
                    result="$(admin '{"action":"start"}')" ;;
  esac

  case "$result" in
    *'"result":0'*) echo "== app up on http://localhost:$APP_PORT/" ;;
    *) echo "$result" | head -c 600; echo; echo "== start FAILED" >&2; exit 1 ;;
  esac
}

# --- Main: the steps in order ---
if needs_rebuild "${1:-}"; then
  build_deployment
fi
point_config_at_postgres
if web_client_needs_bundling; then
  bundle_web_client
fi
start_runtime
wait_for_admin_api
configure_runtime
start_app
