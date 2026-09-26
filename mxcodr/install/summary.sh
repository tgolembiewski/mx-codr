# install/summary.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 17: the summary -- what landed, what is still missing, what to do next.

# --- 17. Summary: what landed, what is still missing, what to do next ---
ui_clear
printf '\n  %s%s Installed mx-codr %s%s\n' "$C_GREEN" "$I_OK" "$version" "$C_RESET"
printf '  %s  %s %s%s\n' "$C_GREY" "$I_ARROW" "$APP" "$C_RESET"

ui_head "$I_BOX" "What landed"
if [ -n "${created_app:-}" ]; then
  ui_row "app" "1" "$created_app  ${C_GREY}(created empty, Mendix ${mx_version:-?})${C_RESET}"
fi
ui_row "skills"   "$installed_skills" ".claude/skills  .agents/skills  .ai-context/skills"
ui_row "lint"     "$rules"            ".claude/lint-rules/"
ui_row "checkers" "$checks"           "tools/mdl-checks/  ${C_GREY}(VERSION $version)${C_RESET}"
ui_row "rule"     "1"                 ".claude/rules/mdl-skills.md  ${C_GREY}(every session)${C_RESET}"
ui_row "hooks"    "3"                 ".claude/settings.local.json  ${C_GREY}(Claude)${C_RESET}"
ui_row "hooks"    "3"                 ".codex/hooks.json  ${C_GREY}(Codex)${C_RESET}"
ui_row "hooks"    "4"                 ".cursor/hooks.json  ${C_GREY}(Cursor, + .cursor/rules/)${C_RESET}"
ui_row "plugin"   "1"                 ".opencode/plugin/  ${C_GREY}(OpenCode, + opencode.json)${C_RESET}"
ui_row "extension" "1"                ".pi/extensions/  ${C_GREY}(Pi, rules included)${C_RESET}"
if [ "$codex_reminder" = "added" ]; then
  ui_row "reminder" "1"               ".codex/config.toml  ${C_GREY}(after the first prompt)${C_RESET}"
else
  printf '     %s%-10s%s %s%3s%s  %s\n' "$C_YELLOW" "reminder" "$C_RESET" "$C_BOLD" "$I_WARN" "$C_RESET" \
    ".codex/config.toml already defines developer_instructions, left alone"
fi
if [ -n "${recorded:-}" ]; then
  ui_row "record" "$recorded"         "tools/mdl-checks/INSTALL.json  ${C_GREY}(the gate checks for drift)${C_RESET}"
fi
if [ "$suite_written" -gt 0 ]; then
  ui_row "harness" "$suite_written"   "tests/  ${C_GREY}(verify-*.test.sh are yours to write)${C_RESET}"
else
  ui_row "harness" "0"                "tests/ already had them, nothing overwritten"
fi
if [ -n "$browser_fixed" ]; then
  ui_row "repaired" "1"               ".playwright/cli.config.json  ${C_GREY}browser path${C_RESET}"
fi
if [ "$DEPS_INSTALLED" -gt 0 ]; then
  ui_row "deps"     "$DEPS_INSTALLED" "prerequisites installed  ${C_GREY}(log: $DEPS_LOG)${C_RESET}"
fi
if [ -n "${no_docker_mode:-}" ]; then
  ui_row "mx check" "1"               "local  ${C_GREY}($no_docker_mode + PostgreSQL, tests/harness.env)${C_RESET}"
fi

if [ -n "$mxbuild_note" ]; then
  printf '\n  %s%s%s %s\n' "$C_YELLOW" "$I_WARN" "$C_RESET" "$mxbuild_note"
fi

# Missing tools last, each with the command that fixes it.
if [ "${#DEPS_MISSING[@]}" -gt 0 ]; then
  printf '\n  %s%s Still missing%s\n' "$C_BOLD" "$I_WARN" "$C_RESET"
  for line in "${DEPS_MISSING[@]}"; do
    printf '     %s%s%s\n' "$C_YELLOW" "$line" "$C_RESET"
  done
  if [ "$WITH_DEPS" = "0" ]; then
    printf '     %s%s%s\n' "$C_GREY" "re-run with --with-deps to have these installed for you" "$C_RESET"
  fi
fi

# The one thing to do now, first: the agent works in the project folder, not in the clone.
app_shown="$APP"
command -v cygpath >/dev/null 2>&1 && app_shown="$(cygpath -w "$APP")"
ui_head "$I_PLAY" "Now"
printf '     %sOpen your agent in the project folder and ask it for a feature:%s\n' "$C_BOLD" "$C_RESET"
printf '       cd "%s"\n' "$app_shown"
printf '       claude      %s(or codex, cursor, opencode, pi)%s\n' "$C_GREY" "$C_RESET"

ui_head "$I_PLAY" "Next"
printf '     %-38s %s%s%s\n' "bash tests/orient.sh" "$C_GREY" "what is in this app, and its state" "$C_RESET"
printf '     %-38s %s%s%s\n' "bash tests/gate.sh --boot-if-needed" "$C_GREY" "suite + mx check, lint, coverage, naming, layout" "$C_RESET"
printf '     %-38s %s%s%s\n' "bash tests/gate.sh --only <feature>" "$C_GREY" "one script, warm browser, red loop" "$C_RESET"
printf '     %-38s %s%s%s\n' "bash tests/diagnose.sh <Entity> <user>" "$C_GREY" "why is that row not on the page" "$C_RESET"

ui_head "$I_DOT" "Good to know"
printf '     %s%s\n' "$C_BOLD" "Start a NEW agent session before building anything here.${C_RESET}"
printf '     %s\n' "An agent's skill list is fixed when its session starts, so the skills this installer"
printf '     %s\n' "just wrote are invisible to the session that ran it. Measured: a session that installed"
printf '     %s\n' "and then built without restarting read twelve SKILL.md files by hand -- 216k characters,"
printf '     %s\n' "36 commands, 6.5 minutes -- before its first real command. After a restart: 8 commands."
printf '     %s\n' "Codex will not fire its hooks until you open ${C_BOLD}/hooks${C_RESET} once and trust them."
printf '     %s\n' "Cursor needs hooks enabled for this workspace before ${C_BOLD}.cursor/hooks.json${C_RESET} runs."
printf '     %s\n' "OpenCode loads ${C_BOLD}.opencode/plugin/${C_RESET} at startup; restart an open session to pick it up."
printf '     %s\n' "Pi loads ${C_BOLD}.pi/extensions/${C_RESET} once the project is trusted; restart an open session to pick it up."
printf '     %s\n' "Write your own tests/verify-<feature>.test.sh -- the ${C_BOLD}test-first-delivery${C_RESET} skill has a"
printf '     %s\n' "complete example, and mxcodr/examples/ holds eight from the demo app."
printf '\n'
