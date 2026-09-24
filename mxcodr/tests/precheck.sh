#!/usr/bin/env bash
# tests/precheck.sh -- the build's own checker, before an exec touches the real model.
#
#   bash tests/precheck.sh mdlsource/02-invoices.mdl [more.mdl ...]
#
# `./mxcli check` reads the script alone, so it passes what only the whole model shows:
# a reserved name (CE7247), an enumeration in a text box (CE2421), a broken XPath or
# expression (CE0161, CE0117), a missing member (CE1613). Under `mxcli run --watch`
# each of those stops the runtime for a rebuild that fails, and the app is down until
# the fix -- about a minute a time. This script applies the scripts to a scratch copy
# of the model and runs `mx check` there (~6s): the errors the build would print, with
# nothing changed and nothing restarted. The Claude, Cursor and OpenCode hooks run it
# before every `mxcli exec` and block the exec when it fails.
#
# It sees what `mx check` sees, which is not everything the deployment build sees: a Marketplace
# module whose version does not match the project's Mendix version passes here (CE4271) and fails
# the build. Running a full build before every exec would cost far more than it saves, so the boot
# stays the backstop for that one class.
# Exit 0: no errors (or the check could not run: no mx, no .mpr -- says so, never blocks).
# Exit 1: the scripts break the model; the `[error]` lines are on stdout.
# MDL_PRECHECK=0 (environment or tests/harness.env) skips it.
# A pass is remembered in .mxcli/precheck/<sha of scripts + .mpr> for an hour, so a run by hand
# and the hook's run before the same exec cost one mx check, not two.
# Inputs: MPR, MXCLI, MDL_MXBUILD_PATH, MDL_PRECHECK.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 0
# shellcheck source=portable.sh
. tests/portable.sh

if [ "${MDL_PRECHECK:-1}" = "0" ]; then
  echo "precheck: skipped (MDL_PRECHECK=0)"
  exit 0
fi
if [ "$#" -eq 0 ]; then
  echo "precheck: nothing to check -- name the .mdl script(s) the exec will run"
  exit 0
fi
mdl_find_mpr 2>/dev/null || { echo "precheck: could not run -- no .mpr in $(pwd)"; exit 0; }

# One copy of each script, in order: `cat > x.mdl <<EOF ... && mxcli exec x.mdl` names it twice,
# and a second apply of a non-re-runnable script would fail on the copy for no reason.
scripts=()
for script in "$@"; do
  [ -f "$script" ] || { echo "precheck: could not run -- no such script: $script"; exit 0; }
  seen=0
  for known in ${scripts[@]+"${scripts[@]}"}; do [ "$known" = "$script" ] && seen=1; done
  [ "$seen" = "1" ] || scripts+=("$script")
done
set -- "${scripts[@]}"

started="$(date +%s)"
# The model often runs this by hand and the hook then runs it again before the exec: the second
# run is skipped when the scripts and the .mpr are unchanged since a pass (the exec itself
# changes the .mpr, so the cache never outlives the model it was checked against).
cache_dir=".mxcli/precheck"
fingerprint="$("$PY" - "$MPR" "$@" <<'PY' 2>/dev/null
import hashlib, os, sys
h = hashlib.sha256()
for path in sys.argv[1:]:
    with open(path, 'rb') as f:
        h.update(f.read())
# The .mpr is an index; the units live in mprcontents, so their names, sizes and times count too.
for root, dirs, files in os.walk('mprcontents'):
    for name in sorted(files):
        st = os.stat(os.path.join(root, name))
        h.update(('%s/%s %d %d\n' % (root, name, st.st_size, st.st_mtime_ns)).encode())
print(h.hexdigest()[:24])
PY
)"
if [ -n "$fingerprint" ] && [ -f "$cache_dir/$fingerprint" ]; then
  echo "precheck: 0 errors -- same scripts and model already passed at $(cat "$cache_dir/$fingerprint") (cached, no second mx check)"
  exit 0
fi
scratch="$(mdl_tmpdir mdl-precheck)" || { echo "precheck: could not run -- no scratch directory"; exit 0; }
trap 'rm -rf "$scratch"' EXIT

# The same copy the gate's mx check makes: the .mpr with its units, widgets and theme.
# `cp -Rc` clones on APFS; elsewhere plain cp -R (0.3s for a 30MB project here).
for item in "$MPR" mprcontents widgets theme themesource javasource; do
  [ -e "$item" ] || continue
  cp -Rc "$item" "$scratch/" 2>/dev/null || cp -R "$item" "$scratch/" 2>/dev/null \
    || { echo "precheck: could not run -- could not copy $item"; exit 0; }
done
# .mxcli/widgets is the resolved widget-definition cache. Without it the exec below rebuilds it
# from widgets/*.mpk on every run (measured: 0.7s against 0.2s); only that one directory is
# copied -- the rest of .mxcli is this project's catalog, logs and records, none of it read here.
if [ -d .mxcli/widgets ]; then
  mkdir -p "$scratch/.mxcli" 2>/dev/null \
    && { cp -Rc .mxcli/widgets "$scratch/.mxcli/" 2>/dev/null || cp -R .mxcli/widgets "$scratch/.mxcli/" 2>/dev/null; }
fi

# Apply to the copy. A script that fails here fails on the real model the same way,
# and `mxcli check` already showed the line; the exec's own message is enough.
for script in "$@"; do
  out="$("$MXCLI" exec "$script" -p "$scratch/$MPR" 2>&1)" || {
    echo "precheck: $script fails to apply (the real model is untouched):"
    # The errors themselves, then the verdict. mxcli 0.24 prints every error first and a 6-line
    # summary after them ("Refusing to execute: N error(s) above"); a plain `tail -6` kept only
    # the summary, and a session read "33 error(s) above" with nothing above it three times in
    # thirty seconds, then guessed at the causes. Errors are the `✗` lines and their `at` line;
    # a parse or apply failure prints `Parse error:` / `Error:` instead. At most 15 are shown.
    printf '%s\n' "$out" | sed $'s/\x1b\\[[0-9;]*m//g' | grep -v '^Using project' | awk '
      /^[[:space:]]*✗|Parse error:|^Error:|^[[:space:]]*Error:/ {
        if (++shown > 15) { more++; next }
        print; want_at = 1; next }
      want_at && /^[[:space:]]+at [^[:space:]]/ { print; want_at = 0; next }
      { want_at = 0 }
      /issues: [0-9]+ errors|^Refusing to execute/ { print }
      END { if (more) printf "  ... and %d more\n", more }'
    exit 1
  }
done

# `mxcli docker check` runs `mx update-widgets` before `mx check` to prevent one false error,
# CE0463 (a widget definition out of step with its .mpk). That step is 2.9s of every check
# here -- 5.2s against 2.3s, measured on a 41-microflow app -- and nothing in a script
# changes widgets/. So the check runs without it, and only a CE0463 in the result buys the
# slow run: a real one is still reported, a false one still prevented.
mx_args=(docker check -p "$scratch/$MPR")
[ -n "${MDL_MXBUILD_PATH:-}" ] && mx_args+=(--mxbuild-path "$MDL_MXBUILD_PATH")
out="$("$MXCLI" "${mx_args[@]}" --no-update-widgets 2>&1)"
if printf '%s\n' "$out" | grep -q 'CE0463'; then
  out="$("$MXCLI" "${mx_args[@]}" 2>&1)"
fi
# mx check exits 0 even with model errors, so read the count it prints.
errors="$(printf '%s\n' "$out" | grep -oE 'contains: [0-9]+ errors' | grep -oE '[0-9]+' | tail -1)"
seconds=$(( $(date +%s) - started ))
if [ -z "$errors" ]; then
  echo "precheck: could not run mx check (${seconds}s) -- the build will be the first to see CE errors:"
  printf '%s\n' "$out" | tail -3
  exit 0
fi
if [ "$errors" = "0" ]; then
  if [ -n "$fingerprint" ]; then
    mkdir -p "$cache_dir" 2>/dev/null && find "$cache_dir" -type f -mmin +60 -delete 2>/dev/null
    date +%H:%M:%S > "$cache_dir/$fingerprint" 2>/dev/null
  fi
  echo "precheck: 0 errors -- mx check passed on a copy of the model with $* applied (${seconds}s)"
  exit 0
fi
echo "precheck: $errors error(s) -- the build would fail. Fix the script, then exec (${seconds}s):"
printf '%s\n' "$out" | grep -E '^\[error\]' | head -12
# The same one-line hints the gate prints for a failed boot: a block of 26 identical CE2729
# errors is one missing pair of grants, and reads as 26 problems without them.
if [ -f tests/gate/hints.sh ]; then
  # shellcheck source=gate/hints.sh
  . tests/gate/hints.sh
  hint_log="$scratch/precheck-errors.txt"
  printf '%s\n' "$out" | grep -E '^\[error\]' > "$hint_log" 2>/dev/null
  mdl_ce_hints "$hint_log"
fi
exit 1
