#!/usr/bin/env bash
# Claude Code PostToolUse hook (matcher Bash); also run from the project root by the Codex/Cursor adapters
# and the OpenCode plugin with a Claude-shaped payload. After an `mxcli exec` prints restart advice (if the
# app answers on $APP_PORT or 8080) and a failing coverage report -- in full when it changed since the
# previous exec, otherwise as one line of counts; otherwise nothing. Exit 0.

# Cheap substring test first: almost no Bash call is an `mxcli exec`.
input="$(cat)"
case "$input" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac

# Prints the first Python that actually runs (Windows may have only a Store stub); inlined so the hook is self-contained.
mdl_find_python() {
  local candidate
  for candidate in python3 python py; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  # The python.org installer does not add Python to PATH by default.
  local local_app="${LOCALAPPDATA:-}"
  local_app="${local_app//\\//}"
  for candidate in \
      "$local_app/Programs/Python"/Python3*/python.exe \
      "$local_app/Programs/Python/Launcher/py.exe" \
      "/c/Program Files"/Python3*/python.exe \
      "/c/Program Files (x86)"/Python3*/python.exe; do
    [ -x "$candidate" ] || continue
    "$candidate" -c 'import json,sys' >/dev/null 2>&1 || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}
PY="$(mdl_find_python || true)"
PY="${PY:-python3}"

command="$(printf '%s' "$input" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null)"
# Precise check on the command field; read-only `mxcli -c` queries are skipped.
case "$command" in *"mxcli exec"*|*"mxcli.exe exec"*) ;; *) exit 0 ;; esac
# One line that says whether the exec applied, read from its output (Claude's tool_response; the
# plugins pass it as tool_response.output). `grep -ci error` on that output always matched --
# mxcli counts "0 errors, 2 warnings" -- and a session re-ran a clean exec twice to see why.
_verdict="$(printf '%s' "$input" | "$PY" -c 'import json, re, sys
d = json.load(sys.stdin)
r = d.get("tool_response")
text = "\n".join(str(r.get(k) or "") for k in ("stdout", "stderr", "output")) if isinstance(r, dict) else str(r or "")
command = d.get("tool_input", {}).get("command", "")
if re.search(r"Nothing was written|Refusing to execute|^\s*(Parse error|Error|error)\b", text, re.M):
    print("exec: FAILED -- mxcli wrote nothing; the reason is in its output above. Fix the script and exec it again.")
elif re.search(r"^\s*(Created|Modified|Replaced|Updated|Dropped|Altered|Moved|Granted|Revoked)\b|already in sync", text, re.M):
    print("exec: applied. (\"0 errors, N warnings\" in mxcli output is a count, not a failure.)")
elif re.search(r"\bgrep\b.*error", command, re.I):
    print("exec: its output went through grep, so this cannot tell whether it applied. mxcli prints "
          "\"Nothing was written\" and exits 1 when it refuses a script; \"0 errors, N warnings\" is a count, not a failure.")
' 2>/dev/null)"
[ -n "$_verdict" ] && printf '%s\n' "$_verdict"
case "$_verdict" in "exec: FAILED"*) exit 0 ;; esac
# Restart advice: under `mxcli run --watch` every change applies by itself (logic and pages by reload,
# schema, module and security by an in-place restart); without it, schema and security need a restart.
_app_running=0
for _port in "${APP_PORT:-8081}" 8080; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://localhost:$_port/" 2>/dev/null)" = "200" ] \
    && { _app_running=1; break; }
done
if [ "$_app_running" = "1" ]; then
  # Split the command like a shell (shlex, no execution; globs expanded) and read every .mdl it names.
  _words="$(printf '%s' "$command" | "$PY" -c 'import glob, shlex, sys
text = sys.stdin.read()
try:
    words = shlex.split(text)
except ValueError:
    words = text.split()
# A hook runs after every terminal command, so the expansion is bounded: a pattern
# like /*/*/*/*/* took 14 seconds and returned 120k paths on this machine, and the
# hook has no timeout of its own on every host.
LIMIT = 200
for word in words:
    matches = []
    if any(c in word for c in "*?[") and word.count("*") <= 4:
        for i, match in enumerate(sorted(glob.iglob(word))):
            if i >= LIMIT:
                matches = []          # too broad to be a list of edited scripts
                break
            matches.append(match)
    print("\n".join(matches) if matches else word)' 2>/dev/null)"
  [ -n "$_words" ] || _words="$(printf '%s\n' $command)"
  _changed=""; _unreadable=""; _named=0
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
  _custom_boot=""
  if [ -n "${MDL_BOOT_COMMAND:-}" ] \
     || grep -qE '^[[:space:]]*(export[[:space:]]+)?MDL_BOOT_COMMAND=' tests/harness.env 2>/dev/null; then
    _custom_boot=1
  fi

  # A `mxcli run --watch` of this project (same .mpr, same directory) applies every change itself.
  _watching=""
  _mpr_name="$(ls -1 *.mpr 2>/dev/null | head -1)"
  if [ -z "$_custom_boot" ] && [ -n "$_mpr_name" ] && command -v pgrep >/dev/null 2>&1; then
    for _pid in $(pgrep -f 'mxcli(\.exe)? run ' 2>/dev/null); do
      case "$(ps -o command= -p "$_pid" 2>/dev/null)" in *"$_mpr_name"*--watch*) ;; *) continue ;; esac
      if command -v lsof >/dev/null 2>&1; then
        _cwd="$(lsof -a -p "$_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
        [ -z "$_cwd" ] || [ "$(cd "$_cwd" 2>/dev/null && pwd -P)" = "$(pwd -P)" ] || continue
      fi
      _watching=1
    done
  fi

  # Drop document-level grants first (describe prints them under every flow); the rest matches schema,
  # module, entity-access, role and settings changes, which need a reboot.
  _document_grant='(grant|revoke)[[:space:]]+(execute|view)[[:space:]]+on[[:space:]]+(microflow|nanoflow|page|snippet)'
  _schema_change='(create|alter|drop)[[:space:]]+(or[[:space:]]+(modify|replace)[[:space:]]+)?((non-)?persistent[[:space:]]+)?(entity|association|enumeration)'
  _security_or_settings_change='alter[[:space:]]+project[[:space:]]+security|alter[[:space:]]+settings'
  _module_change='(create|drop)[[:space:]]+module[[:space:]]'
  _access_change='(grant|revoke)[[:space:]]'
  _role_change='(create|drop)[[:space:]]+(or[[:space:]]+modify[[:space:]]+)?(module[[:space:]]+role|user[[:space:]]+role|demo[[:space:]]+user)'
  _restart_needed="$_schema_change|$_security_or_settings_change|$_module_change|$_access_change|$_role_change"
  # Any statement at all; without one the exec's effect is unknown.
  _any_statement='(create|alter|drop|grant|revoke|move|rename)[[:space:]]'
  _schema_or_security=""
  printf '%s' "$_changed" | grep -viE "$_document_grant" | grep -qiE "$_restart_needed" && _schema_or_security=1
  if [ -n "$_schema_or_security" ] && [ -n "$_watching" ]; then
    printf 'That exec touched entities, associations, enumerations, modules or security. This project runs under `mxcli run --watch`, which applies those itself with an in-place runtime restart in about 10 seconds (its log .mxcli/gate-boot.log says "applied via restart"), so do not restart by hand. Run the test: bash tests/gate.sh --only <feature> -- the gate waits for the change to be applied and warns if it was not.\n'
  elif [ -n "$_schema_or_security" ]; then
    printf 'That exec touched entities, associations, enumerations, modules or security, which do NOT hot-apply: the app is still serving the model it booted with, so a test failing now says nothing about the feature. Restart first: bash tests/gate.sh --restart --only <feature>\n'
  elif [ -n "$_unreadable" ] || ! printf '%s' "$_changed" | grep -qiE "$_any_statement"; then
    if [ -n "$_unreadable" ]; then _why="could not open${_unreadable}"; else _why="no script path or MDL in the command"; fi
    printf 'Could not tell what that exec changed (%s). If it touched entities, associations, enumerations or security, the app does not have it yet: bash tests/gate.sh --restart --only <feature>. Logic and screen changes need no restart: bash tests/gate.sh --only <feature>\n' "$_why"
  elif [ -n "$_custom_boot" ]; then
    printf 'That exec changed logic and screens only, but this project boots with MDL_BOOT_COMMAND rather than `mxcli run --watch`, so nothing hot-applies. Restart before trusting a test: bash tests/gate.sh --restart --only <feature>\n'
  else
    printf 'That exec changed logic and screens only -- `mxcli run --watch` hot-applies those in about two seconds, so no restart is needed. Run the test: bash tests/gate.sh --only <feature>\n'
  fi
fi

# Test coverage; skipped without the checker or an .mpr.
[ -f tools/mdl-checks/check_test_coverage.py ] || exit 0
mpr="$(ls -1 *.mpr 2>/dev/null | head -1)"; [ -n "$mpr" ] || exit 0

# Own modules: not System, MyFirstModule or Marketplace (non-empty Source).
MXCLI="./mxcli"; [ -x "$MXCLI" ] || { [ -x "./mxcli.exe" ] && MXCLI="./mxcli.exe"; }
modules="$("$MXCLI" -p "$mpr" --json -c "SHOW MODULES" 2>/dev/null \
  | "$PY" -c 'import json,sys
for row in json.load(sys.stdin):
    if not (row.get("Source") or "").strip() and row.get("Module") not in ("System","MyFirstModule"):
        print(row["Module"])' 2>/dev/null)"
[ -n "$modules" ] || exit 0

# All modules in one call, so cross-module covers are not reported as stale.
# shellcheck disable=SC2086
out="$("$PY" tools/mdl-checks/check_test_coverage.py . $modules 2>&1)" || true

# The report rarely changes between two execs (a test-first session names elements it has not
# built yet, exec after exec), so the full list is printed only when it differs from the previous
# exec in this project and session; otherwise one line with the counts. The marker lives outside
# the project, keyed by its path and the session.
_state="${TMPDIR:-/tmp}/mendix-mdl-hooks"
_session="$(printf '%s' "$input" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("session_id") or "")' 2>/dev/null | tr -cd 'A-Za-z0-9._-')"
_key="$(printf '%s\n%s' "$(pwd -P)" "$_session" | "$PY" -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest()[:20])' 2>/dev/null)"
_marker="$_state/${_key:-none}.coverage"
case "$out" in
  *FAIL*) ;;
  *) [ -z "$_key" ] || rm -f "$_marker" 2>/dev/null; exit 0 ;;
esac
_digest="$(printf '%s' "$out" | "$PY" -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())' 2>/dev/null)"
if [ -n "$_key" ] && [ -n "$_digest" ] && [ "$(cat "$_marker" 2>/dev/null)" = "$_digest" ]; then
  _untested="$(printf '%s\n' "$out" | grep -c 'no test covers')"
  _stale="$(printf '%s\n' "$out" | grep -c 'covers: names')"
  printf 'Test coverage: unchanged since the previous exec -- %s element(s) without a test, %s `covers:` name(s) not in the model yet. The full list prints when it changes; `bash tests/orient.sh` shows it any time.\n' "$_untested" "$_stale"
  exit 0
fi
if [ -n "$_key" ] && [ -n "$_digest" ]; then
  mkdir -p "$_state" 2>/dev/null && printf '%s\n' "$_digest" > "$_marker" 2>/dev/null
fi
printf 'Test coverage after that mxcli exec:\n%s\nEvery page and ACT_ microflow needs a tests/verify-*.test.sh with a `# covers:` line naming it (skill: test-first-delivery).\n' "$out"
exit 0
