# install/step_hosts.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 14: register the hooks and plugins for Claude Code, Codex, Cursor, OpenCode and Pi. Runs as it is read.

# --- 14. Step: register hooks for Claude Code, Codex, Cursor, OpenCode and Pi ---
# Merged into .claude/settings.local.json, which mxcli init leaves alone.
ui_begin "registering Claude hooks"
mkdir -p "$APP/tools/mdl-checks/hooks"
cp "$SRC"/hooks/*.sh "$APP/tools/mdl-checks/hooks/"
chmod +x "$APP/tools/mdl-checks/hooks/"*.sh
# Each merge adds only missing entries; unparseable JSON stops the install rather than being overwritten.
"$NODE" "$SRC/install/hosts/claude_settings.cjs" "$APP/.claude/settings.local.json"
ui_done "Claude hooks" "5 $I_ARROW .claude/settings.local.json"
ignore_credential_files

# Codex: PostToolUse ignores plain stdout, so it gets an adapter.
ui_begin "registering Codex hooks"
mkdir -p "$APP/.codex"

# An untrusted hook cannot ask to be trusted: add a first-turn reminder unless developer_instructions exist.
codex_reminder="$("$NODE" "$SRC/install/hosts/codex_config.cjs" "$APP/.codex/config.toml")"

"$NODE" "$SRC/install/hosts/codex_hooks.cjs" "$APP/.codex/hooks.json"
ui_done "Codex hooks" "4 $I_ARROW .codex/hooks.json"

# Cursor reads neither .claude/rules nor .ai-context: an alwaysApply .mdc rule plus three adapter hooks.
ui_begin "registering Cursor hooks"
mkdir -p "$APP/.cursor/rules"
cp "$SRC/rules/mdl-skills.mdc" "$APP/.cursor/rules/mdl-skills.mdc"

"$NODE" "$SRC/install/hosts/cursor_hooks.cjs" "$APP/.cursor/hooks.json"
ui_done "Cursor hooks" "4 $I_ARROW .cursor/hooks.json, 1 rule $I_ARROW .cursor/rules/"

# OpenCode: one plugin (mutable payloads, no exit codes); rules via opencode.json "instructions".
ui_begin "installing the OpenCode plugin"
mkdir -p "$APP/.opencode/plugin"
cp "$SRC/plugins/mendix-mdl-harness.js" "$APP/.opencode/plugin/"

"$NODE" "$SRC/install/hosts/opencode_config.cjs" "$APP/opencode.json"
ui_done "OpenCode plugin" "1 $I_ARROW .opencode/plugin/, rules $I_ARROW opencode.json"

# Pi: one extension -- tool_call blocks a failing exec, tool_result appends the coverage report,
# agent_before_settle asks for one more turn on a red gate, and before_agent_start puts the rules
# into the system prompt. Measured on Pi 0.87.1, a .pi/AGENTS.md never reached the model, so the
# rules travel with the extension; an earlier install's .pi/AGENTS.md is removed when it is ours.
# Skills need nothing -- Pi reads the Agent Skills layout this installer already writes to .agents/skills/.
ui_begin "installing the Pi extension"
mkdir -p "$APP/.pi/extensions"
cp "$SRC/plugins/mendix-mdl-harness.pi.js" "$APP/.pi/extensions/mendix-mdl-harness.js"
if [ -f "$APP/.pi/AGENTS.md" ] && head -3 "$APP/.pi/AGENTS.md" | grep -q 'The rules for building in this app are in `.claude/rules/mdl-skills.md`'; then
  rm -f "$APP/.pi/AGENTS.md"
fi
ui_done "Pi extension" "1 $I_ARROW .pi/extensions/ (rules in the system prompt)"
# When the agents compact their context, as the person chose (install/compaction.sh).
apply_compaction
