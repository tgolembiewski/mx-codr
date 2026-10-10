# tests/gate/checks.sh -- how the model checks that need no app run: in the background, through the
# cache, each step's files collected after `wait`; plus what the steps share (step_run, the project
# copy, describe). The steps themselves: steps.sh (mx, catalog, coverage, naming, scope, unused,
# paths, folders), layout.sh, security.sh.
# Sourced by tests/gate.sh; defines functions only. Entry points: start_model_checks, collect_model_checks.

# Each check runs in a background subshell, so it reports through files: check_<name> writes
# $WORK/<name>.summary and .detail and returns 0 pass / 1 problems / 2 could not run;
# run_cached adds .status and .secs; collect reads them after `wait`.

# mx_check_copy [<dir> [<label>]] -- mx check on a fresh copy of the project in <dir> ($WORK/mxcheck);
# sets out. False when the copy failed (the reason in $WORK/<label>.summary, label mx).
# mx check runs on a copy: it rewrites the .mpr and would trigger --watch rebuilds.
# The copy needs widgets/ and theme*/ as well; `cp -Rc` clones on APFS, else plain cp -R.
mx_check_copy() {
  local scratch="${1:-$WORK/mxcheck}" label="${2:-mx}"
  project_copy "$scratch" "$label" || return 1
  mx_check_in "$scratch"
}

# project_copy <dir> <label> -- a fresh copy of the project's model, widgets, theme and Java in <dir>.
project_copy() {
  rm -rf "$1"; mkdir -p "$1"
  mdl_copy_model "$1" || {
    echo "$2: could not run -- could not copy $MDL_COPY_FAILED to a scratch directory" > "$WORK/$2.summary"; return 1; }
}

# mx_check_in <dir> -- mx check on the copy in <dir>; sets out.
mx_check_in() {
  # Without `mx update-widgets` (2.9s of a 5.2s check, measured); the one error that
  # step prevents, CE0463, buys the slow run. Same rule as tests/precheck.sh.
  local -a mx_args=(docker check -p "$1/$MPR")
  [ -n "${MDL_MXBUILD_PATH:-}" ] && mx_args+=(--mxbuild-path "$MDL_MXBUILD_PATH")
  out="$("$MXCLI" "${mx_args[@]}" --no-update-widgets 2>&1)"
  if printf '%s\n' "$out" | grep -q 'CE0463'; then
    out="$("$MXCLI" "${mx_args[@]}" 2>&1)"
  fi
  return 0
}

# Names from a `SHOW ... --json` listing on stdin; non-zero when it is not JSON.
qualified_names() {
  gate_helper qualified-names 2>/dev/null
}

# 0 passed, 1 findings, 2 broken. A traceback also exits 1, so 1 needs a FAIL line first.
checker_verdict() {
  case "$1" in
    0) return 0 ;;
    1) printf '%s\n' "$2" | head -1 | grep -qE '^FAIL ' && return 1 ;;
  esac
  return 2
}

# describe_one <kind> <document> -- its MDL, or false. Tried twice: these run beside a boot, and a
# describe that meets mxbuild touching the project fails once, then works (Windows, --restart).
describe_one() {
  local text
  text="$("$MXCLI" describe "$1" "$2" -p "$MPR" 2>/dev/null)" \
    || { sleep 2; text="$("$MXCLI" describe "$1" "$2" -p "$MPR" 2>/dev/null)"; } || return 1
  printf '%s\n' "$text"
}

# describe_many <kind> <names, one per line> -- their MDL from one mxcli call, or false (and
# nothing printed) when any of them fails or the list is empty.
describe_many() {
  local kind="$1" statements="" document text
  while IFS= read -r document; do
    [ -n "$document" ] && statements="$statements describe $kind $document;"
  done <<< "$2"
  [ -n "$statements" ] || return 1
  text="$("$MXCLI" -p "$MPR" -c "$statements" 2>/dev/null)" || return 1
  printf '%s\n' "$text"
}

# Describes every document of <kinds> into <dir>/<module>.mdl; failures go to
# $WORK/<label>.broken. False when anything failed.
describe_all() {
  local label="$1" dir="$2" kinds="$3" module kind listing names document text listed=0
  local broken="$WORK/$label.broken"
  : > "$broken"
  mkdir -p "$dir"
  for module in $USER_MODULES; do
    for kind in $kinds; do
      if ! listing="$("$MXCLI" -p "$MPR" --json -c "SHOW $kind IN $module" 2>/dev/null)"; then
        echo "SHOW $kind IN $module failed" >> "$broken"; continue
      fi
      if ! names="$(printf '%s' "$listing" | qualified_names)"; then
        echo "SHOW $kind IN $module did not return a JSON list of Module.Name" >> "$broken"; continue
      fi
      [ -z "$names" ] || listed=$((listed + $(printf '%s\n' "$names" | grep -c .)))
      # One mxcli for the whole list: 135 microflows took 9.0 s one process each and 1.3 s in one,
      # the same text. It stops at the first document it cannot describe, so then each is tried
      # on its own, which names the one that failed.
      if text="$(describe_many "${kind%S}" "$names")"; then
        printf '%s\n' "$text" >> "$dir/$module.mdl"
        continue
      fi
      while IFS= read -r document; do
        [ -n "$document" ] || continue
        describe_one "${kind%S}" "$document" >> "$dir/$module.mdl" \
          || echo "describe ${kind%S} $document failed" >> "$broken"
      done <<< "$names"
    done
  done
  # How many documents were listed: a checker that then recognises none of them in the describe
  # text is reading a format it does not know, and says "could not run" instead of PASS.
  echo "$listed" > "$WORK/$label.count"
  [ ! -s "$broken" ]
}

# 0 when there are user modules; else writes the summary and returns 2 (unreadable)
# or 3 (none, which the caller turns into a pass).
modules_or_status() {
  if [ "${USER_MODULES_READ:-1}" != "1" ]; then
    echo "$1: could not run -- SHOW MODULES failed" > "$WORK/$1.summary"; return 2
  fi
  if [ -z "$USER_MODULES" ]; then
    echo "$1: no user module found" > "$WORK/$1.summary"; return 3
  fi
  return 0
}

# --- What every checker step does the same way -------------------------------------------------
# step_run <step> <label> <checker.cjs> <copy|nocopy> [extra args...] -- the checker exists, the
# project has modules of its own, the rulebook reads, the project is copied to $WORK/<step>check
# (with `copy`), then `node tools/mdl-checks/<checker> . <modules> [--mpr copy] <rulebook args>
# <extra args>` runs. Sets STEP_OUT (stdout and stderr) and STEP_CODE. Returns 0 when the checker
# ran, 3 when the project has no module of its own, else 2 with the step's summary written.
step_run() {
  local step="$1" label="$2" checker="$3" copy="$4" gate line
  shift 4
  [ -f "tools/mdl-checks/$checker" ] || {
    echo "$label: could not run -- tools/mdl-checks/$checker is missing" > "$WORK/$step.summary"; return 2; }
  modules_or_status "$step"; gate=$?
  [ "$gate" = "0" ] || return "$gate"
  rulebook_ok "$step" || return 2
  local -a args=()
  if [ "$copy" = "copy" ]; then
    project_copy "$WORK/${step}check" "$step" || return 2
    args+=(--mpr "$WORK/${step}check/$MPR")
  fi
  while IFS= read -r line; do args+=("$line"); done < <(mdl_rule_args "$step")
  # shellcheck disable=SC2086
  STEP_OUT="$("$NODE" "tools/mdl-checks/$checker" . $USER_MODULES ${args[@]+"${args[@]}"} "$@" 2>&1)"; STEP_CODE=$?
  return 0
}

# step_verdict <step> <label> <verdicts> -- STEP_OUT's first line is one of <verdicts> (`PASS|FAIL`):
# the step's summary is `<label>: <that line>`. Otherwise the checker did not check the model:
# the summary says "could not run" with its last line, and the return is 2.
step_verdict() {
  if ! printf '%s\n' "$STEP_OUT" | head -1 | grep -qE "^($3) "; then
    echo "$2: could not run -- $(printf '%s\n' "$STEP_OUT" | grep -v '^[[:space:]]*$' | tail -1)" > "$WORK/$1.summary"
    return 2
  fi
  echo "$2: $(printf '%s\n' "$STEP_OUT" | head -1)" > "$WORK/$1.summary"
}

# step_findings_file <step> -- every finding in .mxcli/<step>.txt, where a session reads them all
# without running the checker. step_warnings <step> <max> <what> -- the `  ~ ` lines into
# $WORK/<step>.warnings, at most <max>, with "... <max> of <n> <what> shown" when there are more.
step_findings_file() { mkdir -p .mxcli 2>/dev/null && printf '%s\n' "$STEP_OUT" > ".mxcli/$1.txt" 2>/dev/null; }
step_warnings() {
  local total
  total="$(printf '%s\n' "$STEP_OUT" | grep -c '^  ~ ')"
  [ "$total" -gt 0 ] || return 0
  printf '%s\n' "$STEP_OUT" | grep '^  ~ ' | head -"$2" | sed -E 's/^  ~ /   - /' > "$WORK/$1.warnings"
  [ "$total" -gt "$2" ] && echo "   ... $2 of $total $3 shown; all of them: .mxcli/$1.txt" >> "$WORK/$1.warnings"
  return 0
}

# Only passes are cached, keyed on the bytes of every input the check reads plus the .mpr
# and mprcontents/; meta:<path> keys on size + mtime, env:NAME=value on the value.
fingerprint() {   # fingerprint <path>... -> one digest line; meta:<path> keys on size + mtime, env:NAME=value on the value
  gate_helper fingerprint "$MPR" mprcontents "$@"
}

# The key includes a secret kept outside the project, so a forged cache entry cannot replay.
mdl_cache_secret() {
  local file="${MDL_CACHE_SECRET_FILE:-$HOME/.mxcli/gate-cache.secret}"
  if [ ! -s "$file" ]; then
    mkdir -p "$(dirname "$file")" 2>/dev/null || { echo none; return 0; }
    ( umask 077; gate_helper secret > "$file" 2>/dev/null ) \
      || { echo none; return 0; }
  fi
  cat "$file" 2>/dev/null || echo none
}
# Replays a cached pass with "(cached HH:MM)", otherwise runs <function> and stores a pass.
run_cached() {
  local name="$1" fn="$2" key="" status; shift 2
  if [ "$USE_CACHE" = "1" ]; then
    key="$(fingerprint "$@" "env:MDL_CACHE_SECRET=$(mdl_cache_secret)" 2>/dev/null)"
    if [ -n "$key" ] && [ -f "$CACHE_DIR/$name.key" ] && [ "$(cat "$CACHE_DIR/$name.key")" = "$key" ] \
       && [ -f "$CACHE_DIR/$name.summary" ]; then
      sed "s/\$/ (cached $(date -r "$CACHE_DIR/$name.summary" +%H:%M 2>/dev/null || echo earlier))/" \
        "$CACHE_DIR/$name.summary" > "$WORK/$name.summary"
      : > "$WORK/$name.detail"
      [ -f "$CACHE_DIR/$name.warnings" ] && cp "$CACHE_DIR/$name.warnings" "$WORK/$name.warnings"
      echo 0 > "$WORK/$name.status"
      return 0
    fi
  fi
  local started=$SECONDS
  "$fn"; status=$?
  echo $((SECONDS - started)) > "$WORK/$name.secs"
  echo "$status" > "$WORK/$name.status"
  if [ "$status" = "0" ] && [ -n "$key" ] && mkdir -p "$CACHE_DIR" 2>/dev/null; then
    cp "$WORK/$name.summary" "$CACHE_DIR/$name.summary" 2>/dev/null && echo "$key" > "$CACHE_DIR/$name.key"
    # A pass can carry warnings; a replayed pass shows them again.
    rm -f "$CACHE_DIR/$name.warnings"
    [ -s "$WORK/$name.warnings" ] && cp "$WORK/$name.warnings" "$CACHE_DIR/$name.warnings"
  fi
  return "$status"
}

# The rulebook (tests/rulebook/): copied once into $WORK so the ten parallel steps read one
# version, and validated once; a broken card makes every model check "could not run" with the
# card and line (the file is the person's, so it has to be loud). Each step's effective levels
# and exceptions are part of its cache fingerprint (RULEBOOK_<step>).
rulebook_prepare() {
  rm -rf "$WORK/rulebook" "$WORK/rulebook.broken"
  [ -d tests/rulebook ] || return 0
  cp -R tests/rulebook "$WORK/rulebook" 2>/dev/null || { echo "could not copy tests/rulebook" > "$WORK/rulebook.broken"; return 0; }
  local out
  out="$("$NODE" "$MDL_RULEBOOK" "$WORK/rulebook" check 2>&1)" || printf '%s\n' "$out" | tail -1 > "$WORK/rulebook.broken"
  return 0
}
# rulebook_ok <step> -- false, with the step's summary written, when the rulebook is broken.
rulebook_ok() {
  [ -f "$WORK/rulebook.broken" ] || return 0
  echo "$1: could not run -- $(cat "$WORK/rulebook.broken") (tests/rulebook is the person's file)" > "$WORK/$1.summary"
  return 1
}
# rulebook_fingerprint <step> -- `env:RULEBOOK_<step>=<digest of its effective levels and exceptions>`.
rulebook_fingerprint() { printf 'env:RULEBOOK_%s=%s\n' "$1" "$(mdl_rulebook digest "$1" 2>/dev/null || echo none)"; }

# Starts the model checks in the background, each through the cache.
start_model_checks() {
  rulebook_prepare
  # Upgrading the gate, its config or mxcli must not replay an old pass.
  local -a cache_inputs=(tests/gate.sh tests/gate tools/mdl-checks/gate_helpers.cjs tools/mdl-checks/gate_values.cjs tools/mdl-checks/gate_scripts.cjs tools/mdl-checks/gate_runtime.cjs tools/mdl-checks/gate_visual.cjs tools/mdl-checks/gate_changed.cjs tools/mdl-checks/py_compat.cjs tools/mdl-checks/rulebook.cjs tools/mdl-checks/mxcli_client.cjs tests/harness.env "meta:$MXCLI")
  ( run_cached mx       check_mx       "${cache_inputs[@]}" "env:MDL_MXBUILD_PATH=${MDL_MXBUILD_PATH:-}" \
      meta:widgets meta:theme meta:themesource meta:javasource ) &
  ( run_cached catalog  check_catalog  "${cache_inputs[@]}" tools/mdl-checks/catalog_rules.cjs tools/mdl-checks/security_rules.cjs tools/mdl-checks/check_unused.cjs "$(rulebook_fingerprint catalog)" ) &
  ( run_cached coverage check_coverage "${cache_inputs[@]}" tests tools/mdl-checks/check_test_coverage.cjs tools/mdl-checks/test_rules.cjs "$(rulebook_fingerprint coverage)" ) &
  ( run_cached naming   check_naming   "${cache_inputs[@]}" tools/mdl-checks/check_mdl.cjs tools/mdl-checks/perf_rules.cjs tools/mdl-checks/index_rules.cjs tools/mdl-checks/event_rules.cjs tools/mdl-checks/datasource_rules.cjs "$CACHE_DIR/captions-baseline.json" "$(rulebook_fingerprint naming)" ) &
  ( run_cached layout   check_layout   "${cache_inputs[@]}" tools/mdl-checks/check_layout.cjs tools/mdl-checks/layout_rules "$CACHE_DIR/names-baseline.json" "$(rulebook_fingerprint layout)" ) &
  ( run_cached security check_security "${cache_inputs[@]}" tools/mdl-checks/view_access.cjs tools/mdl-checks/security_rules.cjs tools/mdl-checks/check_unused.cjs "$(rulebook_fingerprint security)" ) &
  ( run_cached scope    check_scope    "${cache_inputs[@]}" tools/mdl-checks/check_scope.cjs "$(rulebook_fingerprint scope)" ) &
  ( run_cached paths    check_paths    "${cache_inputs[@]}" tools/mdl-checks/check_paths.cjs tools/mdl-checks/outcome_rules.cjs tools/mdl-checks/check_unused.cjs tests "$CACHE_DIR/paths-baseline.json" "$(rulebook_fingerprint paths)" ) &
  ( run_cached folders  check_folders  "${cache_inputs[@]}" tools/mdl-checks/check_folders.cjs tools/mdl-checks/check_unused.cjs "$(rulebook_fingerprint folders)" ) &
  ( run_cached unused   check_unused   "${cache_inputs[@]}" tools/mdl-checks/check_unused.cjs javasource javascriptsource meta:theme meta:themesource tests "$(rulebook_fingerprint unused)" ) &
  echo "== mx check, catalog, coverage, naming, layout, security, scope, paths, folders and unused started (they need no app; running while the suite does)"
}

# Reads one background check's files into summary, failures or cannot_run, and details.
collect() {
  local name="$1" label="$2" status line
  if [ ! -f "$WORK/$name.status" ]; then
    # No status file: the worker died. Not a pass.
    summary+=("$label: could not run -- the check left no result")
    cannot_run+=("$label")
    return 0
  fi
  status="$(cat "$WORK/$name.status")"
  if [ -s "$WORK/$name.summary" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && summary+=("$line")
    done < "$WORK/$name.summary"
  fi
  # What the person's ## Local sections changed for this step (tests/rulebook/), so a verdict read
  # beside the rulebook explains itself. In the summary, not the detail: a replayed pass keeps it.
  local changed; changed="$(mdl_rulebook changes "$name" 2>/dev/null)" || changed=""
  [ -n "$changed" ] && summary+=("   rulebook: $changed")
  # The detail lines print under the verdict (print_verdict_and_exit), so the tail of the
  # output holds both the verdict and its cause.
  case "$status" in
    0) ;;
    2) # A check that stopped without writing why left a bare "could not run", and a session
       # took it for its own fault and spent many steps taking the gate apart.
       # A checker's own "ERROR <why>" line says why: adding "without saying why" under it
       # contradicted it (coverage, "no module named Integration").
       if ! grep -qE 'could not run|^[a-z]+ ERROR ' "$WORK/$name.summary" 2>/dev/null; then
         summary+=("$label: could not run -- the check stopped without saying why. That is a fault in the harness, not in your project: run bash tests/gate.sh once more; if it repeats, say so and carry on with the other checks")
       fi
       details+=("$name|$label (could not run)")
       cannot_run+=("$label") ;;
    *) details+=("$name|$label")
       failures+=("$label") ;;
  esac
}

# After `wait`: each background check's verdict into summary, failures or cannot_run.
collect_model_checks() {
  collect mx "mx check"
  collect catalog "catalog"
  collect coverage "coverage"
  collect naming "naming"
  collect layout "layout"
  collect security "security"
  collect scope "scope"
  collect paths "paths"
  collect folders "folders"
  collect unused "unused"
}
