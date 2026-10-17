# tests/gate/verdict.sh -- the end of a gate run: the verdict it prints and exits with, the warnings
# and blockers under it, .mxcli/last-gate.txt for the next session, and at DONE the block for the person.
# Sourced by tests/gate.sh; defines functions only. Entry point: print_verdict_and_exit.

# Merges the notes a background step left in files into the summary.
add_red_first_notes() {
  local line
  if [ -s "$WORK/redfirst.note" ]; then
    while IFS= read -r line; do summary+=("$line"); done < "$WORK/redfirst.note"
  fi
}

# What a check found that does not block DONE (yet): <check>.warnings, as `   - [CODE] ...` lines.
# "fix them anyway" sent sessions round extra full gates after DONE for warnings alone. Now a
# warning rides along with the next real fix, and one left at DONE goes into the report.
# Every warning goes to .mxcli/warnings.txt; the output carries a short form of them. They were
# up to 11k of a 26k gate output, re-read on every later turn of the session (B2B, 2026-10-12): while
# a check fails, one line per step (how many, which codes); at DONE, four lines per step.
print_warnings() {
  local file shown=0 step count codes
  mkdir -p .mxcli 2>/dev/null && : > .mxcli/warnings.txt 2>/dev/null
  for file in "$WORK"/*.warnings; do
    [ -s "$file" ] || continue
    [ "$shown" = "0" ] && { echo; echo "== warnings (they do not block DONE; fix them together with your next fix, not in a gate run of their own -- level: block in a rule's card in tests/rulebook/ makes it block; all of them: .mxcli/warnings.txt)"; }
    shown=1
    step="$(basename "$file" .warnings)"
    { echo "== $step"; cat "$file"; } >> .mxcli/warnings.txt 2>/dev/null
    if [ ${#failures[@]} -gt 0 ]; then
      count="$(grep -cE '^[[:space:]]*- ' "$file")"
      codes="$(grep -oE '\[[A-Z]+[0-9]+\]|\[[a-z]+(-[a-z]+)+\]' "$file" | tr -d '[]' | codes_by_count)"
      echo "   $step: ${count:-0} warning(s)${codes:+ ($codes)} -- after the blocking ones are fixed"
    else
      head -4 "$file"
      [ "$(wc -l < "$file" | tr -d ' ')" -gt 4 ] && echo "   ... $(( $(wc -l < "$file" | tr -d ' ') - 4 )) more line(s) of $step in .mxcli/warnings.txt"
    fi
  done
  WARNINGS_SHOWN=$shown
}

# After a green --only: is the full gate worth running yet? DeepSeek ran 15 full gates in an hour
# on the footer's advice, several while coverage was still 0/24 and the verdict known. The
# coverage checker answers in 0.3s; a line here says which it is. Advice only: the verdict is unchanged.
only_coverage_note() {
  local modules out code lines
  [ -f tools/mdl-checks/check_test_coverage.cjs ] || return 0
  modules="$(mdl_user_modules "$MPR" 2>/dev/null)" || return 0
  [ -n "$modules" ] || return 0
  # shellcheck disable=SC2086
  out="$("$NODE" tools/mdl-checks/check_test_coverage.cjs . $modules 2>/dev/null)"; code=$?
  lines="$(printf '%s\n' "$out" | grep -E '^(PASS|FAIL) ' | sed -E 's/^(PASS|FAIL) +//' | tr '\n' ';' | sed 's/;$//')"
  [ -n "$lines" ] || return 0
  if [ "$code" = "0" ]; then
    echo "   coverage now: $lines -- every element is covered: the full gate can pass now"
  else
    echo "   coverage now: $lines -- the full gate cannot pass yet; the next feature and its test first"
  fi
}

# After a full DONE: did the last DONE see exactly this model, these tests and this theme? Pi
# re-ran a green gate on an unchanged app three times in two minutes "to confirm stability".
# theme/ counts: a session that changed only a stylesheet (a chart sized to the screen) was told
# its DONE was a repeat. Advice only.
done_repeat_note() {
  local key file="$CACHE_DIR/last-done.key"
  key="$(fingerprint tests theme 2>/dev/null)" || return 0
  [ -n "$key" ] || return 0
  if [ -f "$file" ] && [ "$(cat "$file" 2>/dev/null)" = "$key" ]; then
    echo "   Same model, tests and theme as the DONE at $(date -r "$file" +%H:%M 2>/dev/null || echo earlier): a repeat proves nothing new -- change something before the next run."
  fi
  mkdir -p "$CACHE_DIR" 2>/dev/null && echo "$key" > "$file" 2>/dev/null
  return 0
}

# Captions are warnings while the app is built: 286 of them once landed on a session with no test
# green. Each full DONE keeps a hash of every microflow; from then on a new or changed one needs its
# captions (check_naming). The first DONE with a backlog says once to clear it, module by module.
captions_after_done() {
  local backlog
  [ -f "$CACHE_DIR/naming.flows.json" ] || return 0
  backlog="$(sed -n 's/.* \([0-9][0-9]*\) caption warning(s).*/\1/p' "$WORK/naming.summary" 2>/dev/null | head -1)"
  if [ ! -f "$CACHE_DIR/captions-baseline.json" ] && [ "${backlog:-0}" -gt 0 ]; then
    echo "   Next: the app is done, so give its microflows their captions -- the ${backlog} caption warning(s) above."
    echo "   Module by module (skill naming-and-captions): a business @caption on each action, a question"
    echo "   on each decision, an @annotation on each loop. Then run the full gate once. From now on a"
    echo "   microflow you add or change needs its captions before DONE; the older ones stay warnings."
    WARNINGS_SHOWN=0
  fi
  cp "$CACHE_DIR/naming.flows.json" "$CACHE_DIR/captions-baseline.json" 2>/dev/null
  return 0
}

# .mxcli/last-gate.txt: where the gate stood, for the next session's tests/orient.sh. A long build
# done one request per session (B2B, 2026-10-15: a fresh session finished a follow-up in 6 min and
# 0.7M tokens, against 650-800k tokens a turn late in one long session) starts from it instead of a
# gate run of its own. `full:` is the last full gate, `last:` the last run of any kind.
# The codes behind a red run, most frequent first: "NAME02 x3, URL01 x1"; "tests" for a red suite.
blocking_codes() {
  local name codes=""
  for name in ${failures[@]+"${failures[@]}"}; do
    [ -s "$WORK/$name.detail" ] || continue
    codes="$codes$(grep -E '^[[:space:]]*- \[' "$WORK/$name.detail" | grep -oE '\[[A-Z]+[0-9]+\]' | tr -d '[]')
"
  done
  codes="$(printf '%s' "$codes" | grep . | codes_by_count)"
  printf '%s' "${codes:-see the gate output}"
}

record_last_gate() {
  local verdict="$1" when full=""
  when="$(date '+%Y-%m-%d %H:%M')"
  mkdir -p .mxcli 2>/dev/null || return 0
  if [ -n "${ONLY:-}" ] || [ "${TESTS_ONLY:-0}" = "1" ]; then
    full="$(grep '^full:' .mxcli/last-gate.txt 2>/dev/null)"
    verdict="${ONLY:+--only $ONLY }$verdict"
  else
    full="full: $when $verdict"
  fi
  printf '%s\nlast: %s %s\n' "${full:-full: never run}" "$when" "$verdict" > .mxcli/last-gate.txt 2>/dev/null
  return 0
}

# A full gate while the last --only run of this app was red is a two-minute way to learn what that
# --only said: four to seven of a B2B run's red full gates were that (2026-10-15). It is refused with
# the --only to run; --force runs it anyway (a feature given up, a test deleted on purpose).
refuse_after_red_only() {
  local red
  [ -z "$ONLY" ] && [ "$TESTS_ONLY" = "0" ] && [ "$RESTART_ALONE" = "0" ] && [ "${FORCE:-0}" = "0" ] || return 0
  red="$(sed -n 's/^last: [0-9-]* [0-9:]* --only \(.*\) NOT DONE -- failed.*/\1/p' .mxcli/last-gate.txt 2>/dev/null | head -1)"
  [ -n "$red" ] || return 0
  echo "== gate"
  echo "   NOT DONE — the last \`--only $red\` run was red: run \`bash tests/gate.sh --only $red\` until it says PASSED, then the full gate."
  echo "   A full gate now would only repeat what that run said, two minutes later. \`--force\` runs it anyway."
  exit 1
}

# Prints the verdict lines and exits: 1 on a failure, 2 when a check could not run, else 0.
print_verdict_and_exit() {
  local line name timing=""
  print_warnings
  echo
  echo "== gate"
  for line in "${summary[@]}"; do echo "   $line"; done
  for name in tests mx catalog coverage naming layout security scope paths folders unused visual; do
    [ -f "$WORK/$name.secs" ] && timing="$timing $name $(cat "$WORK/$name.secs")s,"
  done
  echo "   timing:${timing} wall $((SECONDS - GATE_START))s"
  if [ ${#failures[@]} -gt 0 ]; then
    echo "   NOT DONE — failed: ${failures[*]}"
    [ ${#cannot_run[@]} -eq 0 ] || echo "   and could not run: ${cannot_run[*]}"
    print_failure_details
    EARLY_CODES=""
    [ -n "${ONLY:-}" ] && print_early_blockers
    print_blockers
    [ -n "$EARLY_CODES" ] && echo "   and the full gate would refuse $EARLY_CODES (== before DONE above)"
    record_last_gate "NOT DONE -- failed: ${failures[*]} ($(blocking_codes))"
    exit 1
  fi
  if [ ${#cannot_run[@]} -gt 0 ]; then
    echo "   NOT DONE — could not run: ${cannot_run[*]}"
    echo "   A check that did not run has not passed. Fix what stopped it, then run the gate again."
    print_failure_details
    record_last_gate "NOT DONE -- could not run: ${cannot_run[*]}"
    exit 2
  fi
  # A partial run passing is not the gate passing: `--only 000` once ended in the same DONE line
  # as the full gate, and a session took it for DONE with a red suite behind it.
  if [ -n "${ONLY:-}" ] || [ "${TESTS_ONLY:-0}" = "1" ]; then
    local scope="tests only"
    [ -n "${ONLY:-}" ] && scope="--only $ONLY"
    [ "${CHANGED:-0}" = "1" ] && scope="--changed (${#targets_ran[@]} of $(ls tests/verify-*.test.sh 2>/dev/null | wc -l | tr -d ' ') tests)"
    EARLY_CODES=""
    [ -n "${ONLY:-}" ] && print_early_blockers
    local coverage="${EARLY_COVERAGE:+; coverage open: $EARLY_COVERAGE}"
    if [ -n "$EARLY_CODES" ]; then
      echo "   PASSED — $scope -- not DONE: the full gate would refuse $EARLY_CODES$coverage (== before DONE above); fix them before the full gate"
    elif [ -n "$coverage" ]; then
      echo "   PASSED — $scope -- not DONE: the full gate would refuse what is untested$coverage (== before DONE above); write those tests first"
    else
      echo "   PASSED — $scope -- not DONE: the full gate has not run; run \`bash tests/gate.sh\`"
    fi
    only_coverage_note
    record_last_gate "PASSED${EARLY_CODES:+ -- the full gate would refuse $EARLY_CODES}$coverage"
    exit 0
  fi
  print_for_the_person
  echo "   DONE — every check passed"
  record_last_gate "DONE$( [ -s .mxcli/warnings.txt ] && printf ' (%s warnings in .mxcli/warnings.txt)' "$(grep -cE '^[[:space:]]*- ' .mxcli/warnings.txt)")"
  done_repeat_note
  captions_after_done
  declare -F dbsnap_restore >/dev/null && dbsnap_restore
  if [ "${WARNINGS_SHOWN:-0}" = "1" ]; then
    echo "   The warnings above stay: do not run the gate again for them alone -- name each in your report as what to fix next."
  fi
  exit 0
}

# The last lines of every red run: one line per failed check -- how many findings, and the first
# of them -- then the verdict again. Sessions read the gate through `tail -3`, `tail -25` or
# `sed -n '/== naming/,$p' | head`, so the verdict above the details, or the details above the
# end, were each cut off by one of them; after a compaction the model had neither and spent an
# hour rediscovering what still blocked DONE. Whatever tail it takes now ends with that list.
# Findings listed per check under "still blocking DONE".
BLOCKERS_SHOWN=5

print_blockers() {
  local entry name label detail count shown pattern
  pattern='^[[:space:]]*- \[|\[error\]|^[[:space:]]*FAIL[[:space:]:]|^[[:space:]]+- '
  # Three sessions grepped tests/gate/*.sh for what a code required; the page says it in one line.
  # One file per step (tests/checks/), so a session reads the codes of what failed, not all of them.
  local guides="" guide failed
  for failed in ${failures[@]+"${failures[@]}"} ${cannot_run[@]+"${cannot_run[@]}"}; do
    guide="tests/checks/$failed.md"; [ -f "$guide" ] || guide="tests/checks/app.md"
    case " $guides " in *" $guide "*) ;; *) guides="${guides:+$guides }$guide" ;; esac
  done
  echo "   what each code wants and its fix: ${guides:-tests/CHECKS.md} -- not the gate's source"
  echo "== still blocking DONE"
  # details holds name|label for every failed or unrunnable check, in the order they printed.
  # Every finding up to BLOCKERS_SHOWN, each with its fix: a session that saw only the first one
  # (through `| tail -16`) opened check_layout.cjs to learn what the other six wanted.
  for entry in ${details[@]+"${details[@]}"}; do
    name="${entry%%|*}"; label="${entry#*|}"
    detail="$WORK/$name.detail"
    count=0
    [ -s "$detail" ] && count="$(grep -cE "$pattern" "$detail")"
    if [ "$count" = "0" ]; then
      echo "   $label: see == $label above"
      continue
    fi
    echo "   $label: $count"
    grep -E "$pattern" "$detail" | head -"$BLOCKERS_SHOWN" \
      | sed -E 's/^[[:space:]]*(- )?//' | cut -c1-260 | sed 's/^/     - /'
    shown=$(( count < BLOCKERS_SHOWN ? count : BLOCKERS_SHOWN ))
    [ "$count" -gt "$shown" ] && echo "     ... $((count - shown)) more under == $label above"
  done
  echo "   NOT DONE — failed: ${failures[*]}"
}

# The cause of every failure, under the verdict: a session that reads only the last lines of
# the output still sees why, instead of running the gate again to find out.
print_failure_details() {
  local entry name label
  for entry in ${details[@]+"${details[@]}"}; do
    name="${entry%%|*}"; label="${entry#*|}"
    case "$label" in
      *"(could not run)") echo "== $label" ;;
      *) [ -s "$WORK/$name.detail" ] || continue; echo "== $label" ;;
    esac
    [ -s "$WORK/$name.detail" ] && cat "$WORK/$name.detail"
  done
}

# After DONE: what the person needs from the app just finished. The agent ends its report with this
# block (rules/mdl-skills.md), so the person need not ask: who can sign in -- each demo user with its
# roles and the password the tests sign in with (tests/credentials.env) -- and the assumptions the
# agent made without them, open in the project brain (skill requirements-interview). Nothing when
# there is neither.
print_for_the_person() {
  local users questions staged
  users="$(demo_sign_ins)"
  questions="$(open_brain_questions)"
  staged="$(staged_brain_entries)"
  [ -n "$users$questions$staged" ] || return 0
  echo "== for the person -- end your report with this block, as printed"
  if [ -n "$users" ]; then
    echo "   sign in at ${BASE_URL:-http://localhost:${APP_PORT:-8081}}"
    printf '%s\n' "$users"
  fi
  if [ -n "$questions" ]; then
    echo "   assumed without you -- confirm or correct each: ./mxcli brain resolve <id> \"<answer>\""
    printf '%s\n' "$questions"
  fi
  if [ -n "$staged" ]; then
    echo "   recorded but never promoted, so no check reads them -- promote each (./mxcli brain promote <id>) or drop it:"
    printf '%s\n' "$staged"
  fi
}

# Entries captured but left in mxcli's queue (.mxcli, git-ignored): an unattended session recorded five
# assumptions and promoted none, and the DONE block, reading docs/brain/, showed none (2026-10-12).
staged_brain_entries() {
  "$MXCLI" brain staged -p "$MPR" 2>/dev/null | sed -nE 's/^([0-9a-f]{6,})[[:space:]]+[^[:space:]]+[[:space:]]+(.*)$/   \1   \2/p'
}

# The open questions in docs/brain/ (`mxcli brain capture --open`): a `## ` heading whose entry line
# ends in OPEN. Read from the files: `mxcli brain plan` rebuilds the catalog first.
open_brain_questions() {
  local file
  for file in docs/brain/*.md docs/brain/*/*.md; do
    [ -f "$file" ] || continue
    awk '/^## /{ heading = substr($0, 4); next }
         /OPEN[[:space:]]*$/ && heading != "" && match($0, /id `[0-9a-f]+`/) {
           printf "   %-8s %s\n", substr($0, RSTART + 4, RLENGTH - 5), heading; heading = "" }' "$file"
  done
}

# Each demo user, one line: name, roles, password (from tests/credentials.env). Nothing when demo users are off.
demo_sign_ins() {
  local security users name roles password per shared credentials="$APP_DIR/tests/credentials.env"
  security="$("$MXCLI" -p "$MPR" -c "SHOW PROJECT SECURITY" 2>/dev/null)"
  grep -qiE '^Demo Users Enabled: *true' <<<"$security" || return 0
  users="$("$MXCLI" -p "$MPR" --json -c "SHOW DEMO USERS" 2>/dev/null | "$NODE" -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try { for (const u of JSON.parse(s)) console.log(u["User Name"] + "\t" + (u["User Roles"] || "")); } catch (e) {}
    });' 2>/dev/null)"
  [ -n "$users" ] || return 0
  shared="$(grep -E '^TEST_PASSWORD=' "$credentials" 2>/dev/null | tail -1)"
  while IFS=$'\t' read -r name roles; do
    [ -n "$name" ] || continue
    # Read as data, never sourced; -F: a user name is a literal, not a pattern.
    per="$(grep -F -- "TEST_PASSWORD_${name}=" "$credentials" 2>/dev/null | grep -F -v -e '#' | tail -1)"
    password="${per#*=}"; [ -n "$per" ] || password="${shared#*=}"
    password="${password%\"}"; password="${password#\"}"
    printf '   %-22s %-28s %s\n' "$name" "($roles)" "${password:-password not in tests/credentials.env}"
  done <<<"$users"
}
