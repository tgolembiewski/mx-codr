#!/usr/bin/env bash
# Claude Code PostToolUse hook (matcher Bash); also run from the project root by the Codex/Cursor adapters
# and the OpenCode plugin with a Claude-shaped payload. After an `mxcli exec` prints restart advice (if the
# app answers on $APP_PORT or 8080) and a failing coverage report -- in full when it changed since the
# previous exec, otherwise as one line of counts; otherwise nothing. Exit 0.

# Cheap substring test first: almost no Bash call is an `mxcli exec`.
input="$(cat)"
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac

# NODE and HOOK_TOOL (hook_tool.cjs, the small jobs: read a field, wrap a message).
. "$(dirname "${BASH_SOURCE[0]}")/hook-env.sh"

command="$(printf '%s' "$input" | "$NODE" "$HOOK_TOOL" command 2>/dev/null)"
# Precise check on the command field; read-only `mxcli -c` queries are skipped.
case "$command" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac
# One line that says whether the exec applied, read from its output (Claude's tool_response; the
# plugins pass it as tool_response.output). `grep -ci error` on that output always matched --
# mxcli counts "0 errors, 2 warnings" -- and a session re-ran a clean exec twice to see why.
_verdict="$(printf '%s' "$input" | "$NODE" "$HOOK_TOOL" exec-verdict 2>/dev/null)"
[ -n "$_verdict" ] && printf '%s\n' "$_verdict"
case "$_verdict" in "exec: FAILED"*) exit 0 ;; esac

# Read once, for everything below:
#   WORDS        the command split like a shell (no execution; globs expanded, at most 200 paths
#                per word), one per line
#   MPR          the project's .mpr, or empty
#   MXCLI        ./mxcli, else ./mxcli.exe when that one is executable
#   SESSION_KEY  this project and session, hashed: the name of the markers kept in STATE_DIR,
#                outside the project
WORDS="$(printf '%s' "$command" | "$NODE" "$HOOK_TOOL" words 2>/dev/null)"
MPR="$(ls -1 *.mpr 2>/dev/null | head -1)"
MXCLI="./mxcli"; [ -x "$MXCLI" ] || { [ -x "./mxcli.exe" ] && MXCLI="./mxcli.exe"; }
_session="$(printf '%s' "$input" | "$NODE" "$HOOK_TOOL" get session_id 2>/dev/null | tr -cd 'A-Za-z0-9._-')"
SESSION_KEY="$(printf '%s\n%s' "$(pwd -P)" "$_session" | "$NODE" "$HOOK_TOOL" sha256 20 2>/dev/null)"
STATE_DIR="${TMPDIR:-/tmp}/mendix-mdl-hooks"

# What each script wrote, for STALE01 next time it runs (tests/precheck.sh, tests/mdl-applied.sh).
record_applied() {
  local _word _applied
  [ -f tests/mdl-applied.sh ] || return 0
  . tests/mdl-applied.sh
  _applied=()
  while IFS= read -r _word; do
    case "$_word" in *.mdl) _applied+=("$_word") ;; esac
  done <<HOOK_APPLIED
$WORDS
HOOK_APPLIED
  mdl_applied_record ${_applied[@]+"${_applied[@]}"}
}

# CE0463: mxcli writes a data grid in an older widget definition on every exec of its page, so the
# next precheck blocks on errors no script holds -- each InvoiceChase run lost rounds to it
# (2026-10-12). A File Uploader the same (file-image session, 2026-10-13). Update the widgets
# right after such an exec (about 6 s), as Studio Pro's
# "Update all widgets" would.
widgets_refresh() {
  local _word _grid=""
  while IFS= read -r _word; do
    case "$_word" in *.mdl) [ -f "$_word" ] && grep -qiE '^[[:space:]]*(datagrid|fileuploader)[[:space:]]' "$_word" && _grid=1 ;; esac
  done <<HOOK_GRID
$WORDS
HOOK_GRID
  [ -n "$_grid" ] || return 0
  [ -n "$MPR" ] || return 0
  [ -x "$MXCLI" ] || return 0
  if "$MXCLI" fix widgets -p "$MPR" >/dev/null 2>&1; then
    echo "Data grids and file uploaders updated to the installed widget definition (mxcli fix widgets), so CE0463 does not come back."
  fi
}

# Studio Pro with this project open saves its own copy of a document over what the exec wrote
# (it dropped 12 indexes on 2026-10-04). The same process pattern as mdl_studio_pro_open in
# tests/portable.sh, which also covers Windows; a test keeps the two patterns identical.
studio_pro_warning() {
  local _here _pid
  command -v pgrep >/dev/null 2>&1 || return 0
  _here="$(pwd -P)"
  for _pid in $(pgrep -f '(/MacOS/studiopro|[Ss]tudio[Pp]ro(\.exe)?)$' 2>/dev/null); do
    if ! command -v lsof >/dev/null 2>&1 || grep -qF "n$_here" <<< "$(lsof -p "$_pid" -Fn 2>/dev/null)"; then
      echo "!! Studio Pro has this project open: what it saves next replaces what that exec wrote. Close it without saving, or make the change in Studio Pro."
      break
    fi
  done
}

# REQ01: a page or module built while no requirement is recorded (skill requirements-interview). Said
# once a session; not while answers wait in the queue for the person (`brain staged`), not with
# MDL_REQUIREMENTS=off, not at level off in tests/rulebook/app/REQ01.md.
req01_note() {
  local _req_mode _req_level _req_built _req_mxcli _req_marker _req_how _word
  _req_mode="${MDL_REQUIREMENTS:-$(sed -nE 's/^[[:space:]]*MDL_REQUIREMENTS=["'"'"']?([a-z]*).*/\1/p' tests/harness.env 2>/dev/null | tail -1)}"
  _req_level=warn
  [ -f tools/mdl-checks/rulebook.cjs ] && [ -d tests/rulebook ] \
    && _req_level="$("$NODE" tools/mdl-checks/rulebook.cjs tests/rulebook level REQ01 2>/dev/null || echo warn)"
  if [ "$_req_mode" != "off" ] && [ "$_req_level" != "off" ] && ! ls docs/brain/plan/*.md >/dev/null 2>&1; then
    _req_built=""
    while IFS= read -r _word; do
      case "$_word" in *.mdl) [ -f "$_word" ] && grep -qiE '^[[:space:]]*create[[:space:]]+((or[[:space:]]+(modify|replace)[[:space:]]+)?page|module)[[:space:]]' "$_word" && _req_built=1 ;; esac
    done <<HOOK_REQ
$WORDS
HOOK_REQ
    grep -qiE 'create[[:space:]]+((or[[:space:]]+(modify|replace)[[:space:]]+)?page|module)[[:space:]]' <<< "$command" && _req_built=1
    # Not $MXCLI: this one takes ./mxcli.exe whenever ./mxcli is not executable, executable or not.
    _req_mxcli="./mxcli"; [ -x "$_req_mxcli" ] || _req_mxcli="./mxcli.exe"
    # No "none" for an empty key here, unlike the coverage marker.
    _req_marker="$STATE_DIR/$SESSION_KEY.req01"
    if [ -n "$_req_built" ] && [ ! -f "$_req_marker" ] \
       && ! grep -q ' plan/' <<< "$("$_req_mxcli" brain staged -p "$MPR" 2>/dev/null)"; then
      if [ "$_req_mode" = "assume" ]; then _req_how="take your recommended answers as assumptions"; else _req_how="ask the person and wait for the answers"; fi
      echo "REQ01 (warning): that exec built a page or a module, and no requirement is recorded yet (docs/brain/plan/ is empty)."
      echo "  Before the next feature, read skill requirements-interview: $_req_how, and record each one with ./mxcli brain capture."
      mkdir -p "${_req_marker%/*}" 2>/dev/null && : > "$_req_marker" 2>/dev/null
    fi
  fi
}

# Re-running an older script undoes a later one: `create or modify page` drops another script's
# `alter page`, and a `grant` puts back access another script revoked (script_overrides.cjs).
script_overrides_note() {
  [ -f tools/mdl-checks/script_overrides.cjs ] && "$NODE" tools/mdl-checks/script_overrides.cjs --command "$command" 2>/dev/null
}

# Restart advice, only while the app answers: under `mxcli run --watch` every change applies by
# itself (logic and pages by reload, schema, module and security by an in-place restart); without
# it, schema and security need a restart.
restart_advice() {
  local _app_running=0 _port _words _word _changed="" _unreadable="" _named=0 _custom_boot="" _watching="" _pid _cwd _why
  for _port in "${APP_PORT:-8081}" 8080; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://localhost:$_port/" 2>/dev/null)" = "200" ] \
      && { _app_running=1; break; }
  done
  [ "$_app_running" = "1" ] || return 0

  # Read every .mdl the command names; when the split gave nothing, the command's own words.
  _words="$WORDS"
  [ -n "$_words" ] || _words="$(printf '%s\n' $command)"
  while IFS= read -r _word; do
    case "$_word" in
      *.mdl)
        _named=1
        if [ -f "$_word" ]; then
          _changed="$_changed
$(cat "$_word" 2>/dev/null)"
        else
          _unreadable="$_unreadable $_word"
        fi ;;
    esac
  done <<HOOK_WORDS
$_words
HOOK_WORDS
  # No script named: the MDL, if any, is inline in the command.
  [ "$_named" = "1" ] || _changed="$command"

  # An app booted by MDL_BOOT_COMMAND is not under `mxcli run --watch`, so nothing hot-applies.
  if [ -n "${MDL_BOOT_COMMAND:-}" ] \
     || grep -qE '^[[:space:]]*(export[[:space:]]+)?MDL_BOOT_COMMAND=' tests/harness.env 2>/dev/null; then
    _custom_boot=1
  fi

  # A `mxcli run --watch` of this project (same .mpr, same directory) applies every change itself.
  if [ -z "$_custom_boot" ] && [ -n "$MPR" ] && command -v pgrep >/dev/null 2>&1; then
    for _pid in $(pgrep -f 'mxcli(\.exe)? run ' 2>/dev/null); do
      case "$(ps -o command= -p "$_pid" 2>/dev/null)" in *"$MPR"*--watch*) ;; *) continue ;; esac
      if command -v lsof >/dev/null 2>&1; then
        _cwd="$(lsof -a -p "$_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
        [ -z "$_cwd" ] || [ "$(cd "$_cwd" 2>/dev/null && pwd -P)" = "$(pwd -P)" ] || continue
      fi
      _watching=1
    done
  fi

  # Drop document-level grants first (describe prints them under every flow); the rest matches schema,
  # module, entity-access, role and settings changes, which need a reboot.
  local _document_grant='(grant|revoke)[[:space:]]+(execute|view)[[:space:]]+on[[:space:]]+(microflow|nanoflow|page|snippet)'
  local _schema_change='(create|alter|drop)[[:space:]]+(or[[:space:]]+(modify|replace)[[:space:]]+)?((non-)?persistent[[:space:]]+)?(entity|association|enumeration)'
  local _security_or_settings_change='alter[[:space:]]+project[[:space:]]+security|alter[[:space:]]+settings'
  local _module_change='(create|drop)[[:space:]]+module[[:space:]]'
  local _access_change='(grant|revoke)[[:space:]]'
  local _role_change='(create|drop)[[:space:]]+(or[[:space:]]+modify[[:space:]]+)?(module[[:space:]]+role|user[[:space:]]+role|demo[[:space:]]+user)'
  local _restart_needed="$_schema_change|$_security_or_settings_change|$_module_change|$_access_change|$_role_change"
  # Any statement at all; without one the exec's effect is unknown.
  local _any_statement='(create|alter|drop|grant|revoke|move|rename)[[:space:]]'
  local _schema_or_security=""
  grep -qiE "$_restart_needed" <<< "$(grep -viE "$_document_grant" <<< "$_changed")" && _schema_or_security=1
  if [ -n "$_schema_or_security" ] && [ -n "$_watching" ]; then
    printf 'That exec touched entities, associations, enumerations, modules or security. This project runs under `mxcli run --watch`, which applies those itself with an in-place runtime restart in about 10 seconds (its log .mxcli/gate-boot.log says "applied via restart"), so do not restart by hand. Run the test: bash tests/gate.sh --only <feature> -- the gate waits for the change to be applied and warns if it was not.\n'
  elif [ -n "$_schema_or_security" ]; then
    printf 'That exec touched entities, associations, enumerations, modules or security, which do NOT hot-apply: the app is still serving the model it booted with, so a test failing now says nothing about the feature. Restart first: bash tests/gate.sh --restart --only <feature>\n'
  elif [ -n "$_unreadable" ] || ! grep -qiE "$_any_statement" <<< "$_changed"; then
    if [ -n "$_unreadable" ]; then _why="could not open${_unreadable}"; else _why="no script path or MDL in the command"; fi
    printf 'Could not tell what that exec changed (%s). If it touched entities, associations, enumerations or security, the app does not have it yet: bash tests/gate.sh --restart --only <feature>. Logic and screen changes need no restart: bash tests/gate.sh --only <feature>\n' "$_why"
  elif [ -n "$_custom_boot" ]; then
    printf 'That exec changed logic and screens only, but this project boots with MDL_BOOT_COMMAND rather than `mxcli run --watch`, so nothing hot-applies. Restart before trusting a test: bash tests/gate.sh --restart --only <feature>\n'
  else
    printf 'That exec changed logic and screens only -- `mxcli run --watch` hot-applies those in about two seconds, so no restart is needed. Run the test: bash tests/gate.sh --only <feature>\n'
  fi
}

# Test coverage; skipped without the checker or an .mpr.
coverage_report() {
  local modules out marker digest untested stale
  [ -f tools/mdl-checks/check_test_coverage.cjs ] || return 0
  [ -n "$MPR" ] || return 0

  # Own modules: not System, MyFirstModule, MxTest (`mxcli test` injects it) or Marketplace (non-empty
  # Source). The same list as mdl_user_modules in tests/portable.sh, which this copy had fallen behind.
  modules="$("$MXCLI" -p "$MPR" --json -c "SHOW MODULES" 2>/dev/null \
    | "$NODE" "$HOOK_TOOL" modules 2>/dev/null)"
  [ -n "$modules" ] || return 0

  # All modules in one call, so cross-module covers are not reported as stale.
  # shellcheck disable=SC2086
  out="$("$NODE" tools/mdl-checks/check_test_coverage.cjs . $modules 2>&1)" || true

  # The report rarely changes between two execs (a test-first session names elements it has not
  # built yet, exec after exec), so the full list is printed only when it differs from the previous
  # exec in this project and session; otherwise one line with the counts.
  marker="$STATE_DIR/${SESSION_KEY:-none}.coverage"
  case "$out" in
    *FAIL*) ;;
    *) [ -z "$SESSION_KEY" ] || rm -f "$marker" 2>/dev/null; return 0 ;;
  esac
  digest="$(printf '%s' "$out" | "$NODE" "$HOOK_TOOL" sha256 2>/dev/null)"
  if [ -n "$SESSION_KEY" ] && [ -n "$digest" ] && [ "$(cat "$marker" 2>/dev/null)" = "$digest" ]; then
    untested="$(printf '%s\n' "$out" | grep -c 'no test covers')"
    stale="$(printf '%s\n' "$out" | grep -c 'covers: names')"
    printf 'Test coverage: unchanged since the previous exec -- %s element(s) without a test, %s `covers:` name(s) not in the model yet. The full list prints when it changes; `bash tests/orient.sh` shows it any time.\n' "$untested" "$stale"
    return 0
  fi
  if [ -n "$SESSION_KEY" ] && [ -n "$digest" ]; then
    mkdir -p "$STATE_DIR" 2>/dev/null && printf '%s\n' "$digest" > "$marker" 2>/dev/null
  fi
  printf 'Test coverage after that mxcli exec:\n%s\nEvery page and ACT_ microflow needs a tests/verify-*.test.sh with a `# covers:` line naming it (skill: test-first-delivery).\n' "$out"
}

record_applied
widgets_refresh
studio_pro_warning
req01_note
script_overrides_note
restart_advice
coverage_report
exit 0
