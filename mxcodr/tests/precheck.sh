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

# `--inline "<mdl>"`: MDL a command gives mxcli with -c, not in a file. It changes the model as much
# as a script does, and a session that wrote its access rules that way put a broken XPath into the
# model unchecked; every later exec was then blocked by an error that was not in its script.
# `--for-exec`: the exec hook is about to run these scripts. Only then does a missing Marketplace module
# hold every later build back; a probe run by hand only says so. A session that ran the precheck on a
# throwaway Business Events script to see whether it could exist set the wait flag for real, and every
# exec after it was refused with no way out but the person editing tests/harness.env.
for_exec=0
inline_args=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--for-exec" ]; then
    for_exec=1
    shift
  elif [ "$1" = "--inline" ] && [ "$#" -ge 2 ]; then
    inline_file="$(mdl_tmpfile mdl-inline).mdl"
    printf '%s\n' "$2" > "$inline_file"
    inline_args+=("$inline_file")
    shift 2
  else
    inline_args+=("$1")
    shift
  fi
done
set -- ${inline_args[@]+"${inline_args[@]}"}
[ "$#" -gt 0 ] || { echo "precheck: nothing to check -- name the .mdl script(s) the exec will run"; exit 0; }

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

# SCRIPT01: a document these scripts create that another script in mdlsource/ creates too (one-offs
# elsewhere are not compared: once run, they are history).
# Whichever runs last wins, so re-running one silently undoes the other -- no mx check sees it.
if [ -f tools/mdl-checks/gate_helpers.cjs ]; then
  duplicates="$("$NODE" tools/mdl-checks/gate_helpers.cjs duplicate-definitions "$@" 2>/dev/null)"
  if [ -n "$duplicates" ]; then
    echo "precheck: SCRIPT01 -- a document is created in more than one script (the real model is untouched):"
    printf '%s\n' "$duplicates"
    exit 1
  fi
fi

# TEST01: test first. A page or ACT_ microflow new to the model, named by no `# covers:` line of
# tests/verify-*.test.sh, waits for its test. Then the test is red until the exec (red-first comes
# by itself) and the tests do not pile up at the end. MDL_TEST_FIRST=0 (tests/harness.env) turns it off.
if [ "${MDL_TEST_FIRST:-1}" != "0" ] && [ "$(mdl_rule_level TEST01 block)" != "off" ] && [ -f tools/mdl-checks/gate_helpers.cjs ]; then
  untested="$("$NODE" tools/mdl-checks/gate_helpers.cjs test-first . "$MPR" "$@" 2>/dev/null)"
  if [ -n "$untested" ]; then
    echo "precheck: TEST01 -- test first: these scripts create what no browser test names yet (the real model is untouched):"
    printf '%s\n' "$untested"
    echo "  Write tests/verify-<feature>.test.sh first: a \`# covers:\` line naming them and a scenario that"
    echo "  opens them, does what the person would do and checks the result in the database (skill"
    echo "  test-first-delivery). Run it with bash tests/gate.sh --only <feature> -- it fails, they are not in the"
    echo "  app yet -- then run this exec again. One test may cover all the pages of one feature."
    exit 1
  fi
fi

started="$(date +%s)"
# The model often runs this by hand and the hook then runs it again before the exec: the second
# run is skipped when the scripts and the .mpr are unchanged since a pass (the exec itself
# changes the .mpr, so the cache never outlives the model it was checked against).
cache_dir=".mxcli/precheck"
fingerprint="$("$NODE" "$MDL_SHELL_HELPERS" precheck-fingerprint "$MPR" "$@" 2>/dev/null
)"
if [ -n "$fingerprint" ] && [ -f "$cache_dir/$fingerprint" ]; then
  echo "precheck: 0 errors -- same scripts and model already passed at $(cat "$cache_dir/$fingerprint") (cached, no second mx check)"
  exit 0
fi
# STALE01: re-running a script undoes what changed in its documents since it last ran. `create or
# modify page` rebuilds the whole page from the script, so an `alter page` another script made later
# is gone -- on InvoiceB2B a re-exec of 11_navigation.mdl put back twelve widget names a rename had
# replaced (2026-10-07). What the script wrote last time is its copy in .mxcli/applied/ (the after-exec
# hook keeps it), else the version git has; `mxcli diff` of that copy names the documents the model
# has changed since, and `mxcli diff` of the script the ones it would write. A document in both is
# overwritten with a version that misses those changes. A script never run before is not checked.
stale_units() {   # stale_units <script> -- the documents a diff would write, one "Kind: Module.Name" a line
  "$MXCLI" diff "$1" -p "$MPR" --format struct 2>/dev/null \
    | grep -E '^[A-Z][A-Za-z ]*: [A-Za-z_][A-Za-z0-9_]*\.[^[:space:]]+$' | sort -u
}
if [ -f tests/mdl-applied.sh ] && [ "${MDL_STALE_CHECK:-1}" != "0" ] && [ "$(mdl_rule_level STALE01 block)" != "off" ]; then
  . tests/mdl-applied.sh
  for script in "$@"; do
    reference="$(mdl_applied_reference "$script")" || continue
    since="$(stale_units "$reference")"
    [ -n "$since" ] && overwritten="$(comm -12 <(printf '%s\n' "$since") <(stale_units "$script"))" || overwritten=""
    case "$reference" in *.git) rm -f "$reference" ;; esac
    [ -n "$overwritten" ] || continue
    echo "precheck: STALE01 -- $script would undo later changes (the real model is untouched):"
    echo "  these documents changed in the model after $script last ran, and it would write its own"
    echo "  older version of them over those changes:"
    printf '%s\n' "$overwritten" | sed 's/^/    /'
    echo "  Put the change in a new script that alters only what it changes (alter page ... { ... },"
    echo "  create or modify for what is new), or first bring $script up to the model: DESCRIBE each"
    echo "  document above (./mxcli -p $MPR -c \"describe page Module.Name\") and replace its part of the"
    echo "  script with it. Never restore an old script to undo a test edit -- alter it back."
    exit 1
  done
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
    # mxcli's own `hint:` lines too ("X is defined later in this script -- move its create
    # statement before this one"): a session never saw that one and guessed.
    printf '%s\n' "$out" | sed $'s/\x1b\\[[0-9;]*m//g' | grep -v '^Using project' | awk '
      /^[[:space:]]*✗|Parse error:|^Error:|^[[:space:]]*Error:|^Reference error:/ {
        if (++shown > 15) { more++; next }
        print; want_at = 1; want_item = 1; next }
      want_item && /^[[:space:]]+- / { print; next }
      { want_item = 0 }
      want_at && /^[[:space:]]+at [^[:space:]]/ { print; want_at = 0; next }
      { want_at = 0 }
      /issues: [0-9]+ errors|^Refusing to execute/ { print }
      /^[[:space:]]*hint:/ { print }
      END { if (more) printf "  ... and %d more\n", more }'
    # A page that calls a new microflow which opens that page: each script fails alone, in either
    # order, and a session reached for --no-check (mxcli's own advice) -- which the precheck refuses.
    # "not found" too: a calculated attribute's microflow, or a page's microflow, in a later script.
    if printf '%s\n' "$out" | grep -qiE 'unresolved reference|(microflow|nanoflow|page|entity|snippet|enumeration|association)[^\n]{0,40}not found'; then
      echo "  Not found = not created yet. Order matters, inside a script too: create what is called before"
      echo "  its caller (mxcli 0.24 refuses a call to a microflow that the same script creates further down)."
      echo "  If another script creates it, exec that one first; if the two need EACH OTHER (a page calls a"
      echo "  new microflow that opens that page), move them into ONE .mdl. --no-check does not get past this check."
    fi
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
# Errors the model already had before these scripts are not theirs: an exec that adds none of its
# own passes, and says what is already broken, instead of blocking every script on the same error.
new_errors="$(printf '%s\n' "$out" | grep -E '^\[error\]')"
base="$(mdl_tmpdir mdl-precheck-base)" && {
  for item in "$MPR" mprcontents widgets theme themesource javasource; do
    [ -e "$item" ] && { cp -Rc "$item" "$base/" 2>/dev/null || cp -R "$item" "$base/" 2>/dev/null; }
  done
  base_out="$("$MXCLI" docker check -p "$base/$MPR" ${MDL_MXBUILD_PATH:+--mxbuild-path "$MDL_MXBUILD_PATH"} --no-update-widgets 2>&1)"
  rm -rf "$base"
  old_errors="$(printf '%s\n' "$base_out" | grep -E '^\[error\]')"
  if [ -n "$old_errors" ]; then
    # An old error stays the script's when the script touches what it names: CE0161 reads the same
    # for every broken rule of an entity, so a script that swaps one broken rule for another would
    # otherwise pass as "adds no error".
    new_errors="$(printf '%s\n' "$new_errors" | "$NODE" "$MDL_SHELL_HELPERS" new-errors <(printf '%s\n' "$old_errors") "$@")"
  fi
}
seconds=$(( $(date +%s) - started ))
if [ -n "${old_errors:-}" ]; then
  echo "precheck: the model ALREADY has $(printf '%s\n' "$old_errors" | grep -c .) error(s) before these scripts -- a change made"
  echo "  without a precheck (an inline mxcli -c, or Studio Pro). They are not in your script; fix them first:"
  printf '%s\n' "$old_errors" | head -8 | sed 's/^/  /'
fi
if [ -z "$new_errors" ]; then
  echo "precheck: 0 new errors -- $* adds no error of its own (${seconds}s)"
  exit 0
fi
echo "precheck: $(printf '%s\n' "$new_errors" | grep -c .) error(s) -- the build would fail. Fix the script, then exec (${seconds}s):"
printf '%s\n' "$new_errors" | head -12
# An old error these scripts clear can unmask others: Mendix stops checking a part of the model at
# its first error, then reports what lay behind it. Those are not in these scripts. InvoiceChase
# (2026-10-09): dropping a broken demo user surfaced a button and an XPath in two other scripts'
# documents, and the session re-ran the same script four times on "fix the script".
if [ -n "${old_errors:-}" ]; then
  cleared="$(printf '%s\n' "$old_errors" | grep -Fxv -f <(printf '%s\n' "$out" | grep -E '^\[error\]') | grep -c .)"
  if [ "${cleared:-0}" -gt 0 ]; then
    echo "  These scripts clear $cleared of the model's old error(s), and Mendix then checks further: the errors"
    echo "  above may sit in documents these scripts never touch (the widget or activity it names tells which)."
    echo "  Fix each in the script that creates its document, and apply every fix in ONE exec -- one script"
    echo "  holding them all -- since each one alone still leaves the others."
  fi
fi
# The same one-line hints the gate prints for a failed boot: a block of 26 identical CE2729
# errors is one missing pair of grants, and reads as 26 problems without them.
if [ -f tests/gate/hints.sh ]; then
  # shellcheck source=gate/hints.sh
  . tests/gate/hints.sh
  hint_log="$scratch/precheck-errors.txt"
  printf '%s\n' "$new_errors" > "$hint_log" 2>/dev/null
  mdl_ce_hints "$hint_log"
fi
# A missing Marketplace module: install it, or -- not logged in -- stop and ask the person to log in.
if [ -f tests/marketplace-login.sh ]; then
  printf '%s\n' "$new_errors" > "$scratch/precheck-errors.txt" 2>/dev/null
  if [ "$for_exec" = "1" ]; then
    bash tests/marketplace-login.sh needs "$scratch/precheck-errors.txt"
  else
    bash tests/marketplace-login.sh probe "$scratch/precheck-errors.txt"
  fi
fi
exit 1
