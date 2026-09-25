# install/step_hosts.sh -- part of install.sh, which sources the parts in order; never run it on its own.
# Step 14: register the hooks and plugins for Claude Code, Codex, Cursor, OpenCode and Pi. Runs as it is read.

# --- 14. Step: register hooks for Claude Code, Codex, Cursor and OpenCode ---
# Merged into .claude/settings.local.json, which mxcli init leaves alone.
ui_begin "registering Claude hooks"
mkdir -p "$APP/tools/mdl-checks/hooks"
cp "$SRC"/hooks/*.sh "$APP/tools/mdl-checks/hooks/"
chmod +x "$APP/tools/mdl-checks/hooks/"*.sh
# Each merge adds only missing entries; unparseable JSON stops the install rather than being overwritten.
"$PY" - "$APP/.claude/settings.local.json" <<'PY_MERGE'
import json, sys
path = sys.argv[1]
try:
    settings = json.load(open(path))
except FileNotFoundError:
    settings = {}
except json.JSONDecodeError as exc:
    # Replacing it would throw away whatever the developer had; the Codex and Cursor
    # mergers below refuse for the same reason.
    raise SystemExit("   !! %s is not valid JSON (%s); leaving it alone. Fix it and re-run." % (path, exc))
hooks = settings.setdefault("hooks", {})
wanted = {
    "UserPromptSubmit": {"hooks": [{"type": "command", "command": "bash tools/mdl-checks/hooks/remind-skills.sh"}]},
    # 180s: the precheck copies the model and runs mx check on it (~6s on a small app).
    "PreToolUse": {"matcher": "Bash", "hooks": [{"type": "command", "command": "bash tools/mdl-checks/hooks/before-mxcli-exec.sh", "timeout": 180}]},
    "PostToolUse": {"matcher": "Bash", "hooks": [{"type": "command", "command": "bash tools/mdl-checks/hooks/after-mxcli-exec.sh"}]},
}
for event, entry in wanted.items():
    existing = hooks.setdefault(event, [])
    if not any(json.dumps(e, sort_keys=True) == json.dumps(entry, sort_keys=True) for e in existing):
        existing.append(entry)
json.dump(settings, open(path, "w"), indent=2)
PY_MERGE
ui_done "Claude hooks" "3 $I_ARROW .claude/settings.local.json"
ignore_credential_files

# Codex: PostToolUse ignores plain stdout, so it gets an adapter.
ui_begin "registering Codex hooks"
mkdir -p "$APP/.codex"

# An untrusted hook cannot ask to be trusted: add a first-turn reminder unless developer_instructions exist.
codex_reminder="$("$PY" - "$APP/.codex/config.toml" <<'PY_CODEX_CONFIG'
import os, re, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        existing = handle.read()
except FileNotFoundError:
    existing = ""

if re.search(r"(?m)^[ \t]*developer_instructions[ \t]*=", existing):
    print("existing")
    raise SystemExit(0)

reminder = '''# Codex hook trust reminder
developer_instructions = """
After the first user prompt in each new Codex session for this repository, include one short reminder to open `/hooks` and review or trust the project hooks if they are new or changed. Do not repeat the reminder later in the same session.
"""

'''
with open(path, "w", encoding="utf-8") as handle:
    handle.write(reminder)
    handle.write(existing)
print("added")
PY_CODEX_CONFIG
)"

"$PY" - "$APP/.codex/hooks.json" <<'PY_CODEX_MERGE'
import json, os, sys

path = sys.argv[1]
if os.path.exists(path):
    try:
        with open(path) as handle:
            settings = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit("invalid existing %s: %s" % (path, exc))
else:
    settings = {}

settings.setdefault("description", "Mendix MDL skills and delivery gates")
hooks = settings.setdefault("hooks", {})
# A project-relative path, like Claude's and Cursor's. The `$(git rev-parse ...)`
# this used to embed only expands if the host runs hook commands through a POSIX
# shell -- under a native Windows Codex it is literal text. All three scripts
# resolve the repo root themselves anyway.
root = 'tools/mdl-checks/hooks'
wanted = {
    "UserPromptSubmit": {
        "hooks": [{
            "type": "command",
            "command": 'bash %s/remind-skills-codex.sh' % root,
            "timeout": 60,
        }],
    },
    "PostToolUse": {
        "matcher": "^Bash$",
        "hooks": [{
            "type": "command",
            "command": 'bash %s/after-mxcli-exec-codex.sh' % root,
            "timeout": 120,
        }],
    },
    "Stop": {
        "hooks": [{
            "type": "command",
            "command": 'bash %s/stop-gate-codex.sh' % root,
            "timeout": 600,
        }],
    },
}
for event, entry in wanted.items():
    existing = hooks.setdefault(event, [])
    # An earlier install registered the same script through an embedded
    # `$(git rev-parse ...)`. Drop any registration of this script before adding the
    # new one, so an upgrade replaces it instead of firing the hook twice.
    script = entry["hooks"][0]["command"].rsplit("/", 1)[-1].rstrip('"')
    existing[:] = [
        candidate for candidate in existing
        if not any(
            str(handler.get("command", "")).rstrip('"').endswith(script)
            for handler in candidate.get("hooks", [])
        )
    ]
    existing.append(entry)

with open(path, "w") as handle:
    json.dump(settings, handle, indent=2)
    handle.write("\n")
PY_CODEX_MERGE
ui_done "Codex hooks" "3 $I_ARROW .codex/hooks.json"

# Cursor reads neither .claude/rules nor .ai-context: an alwaysApply .mdc rule plus three adapter hooks.
ui_begin "registering Cursor hooks"
mkdir -p "$APP/.cursor/rules"
cp "$SRC/rules/mdl-skills.mdc" "$APP/.cursor/rules/mdl-skills.mdc"

"$PY" - "$APP/.cursor/hooks.json" <<'PY_CURSOR_MERGE'
import json, os, sys

path = sys.argv[1]
if os.path.exists(path):
    try:
        with open(path) as handle:
            settings = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit("invalid existing %s: %s" % (path, exc))
else:
    settings = {}

settings.setdefault("version", 1)
hooks = settings.setdefault("hooks", {})
# `bash <path>`, not `./<path>`: on Windows a .sh file is not executable, and the
# shebang means nothing to the shell Cursor spawns.
root = "tools/mdl-checks/hooks"
wanted = {
    "sessionStart": {"command": "bash %s/remind-skills-cursor.sh" % root, "timeout": 30},
    # Before an `mxcli exec`: mx check on a copy of the model, denying an exec that would break the build.
    "beforeShellExecution": {"command": "bash %s/before-mxcli-exec-cursor.sh" % root, "timeout": 180},
    "postToolUse": {"command": "bash %s/after-mxcli-exec-cursor.sh" % root, "timeout": 120},
    # loop_limit caps the auto-submitted follow-ups; the marker is cleared on green,
    # so a session that fixes its failures stops looping before reaching it.
    "stop": {"command": "bash %s/stop-gate-cursor.sh" % root, "timeout": 600, "loop_limit": 5},
}
for event, entry in wanted.items():
    existing = hooks.setdefault(event, [])
    # An earlier install registered the same script as `./tools/...`, which does not
    # run on Windows. Drop any registration of this script before adding the new one,
    # so the upgrade replaces it instead of firing the hook twice.
    script = entry["command"].rsplit("/", 1)[-1]
    existing[:] = [
        candidate for candidate in existing
        if not str(candidate.get("command", "")).endswith(script)
    ]
    existing.append(entry)

with open(path, "w") as handle:
    json.dump(settings, handle, indent=2)
    handle.write("\n")
PY_CURSOR_MERGE
ui_done "Cursor hooks" "4 $I_ARROW .cursor/hooks.json, 1 rule $I_ARROW .cursor/rules/"

# OpenCode: one plugin (mutable payloads, no exit codes); rules via opencode.json "instructions".
ui_begin "installing the OpenCode plugin"
mkdir -p "$APP/.opencode/plugin"
cp "$SRC/plugins/mendix-mdl-harness.js" "$APP/.opencode/plugin/"

"$PY" - "$APP/opencode.json" <<'PY_OPENCODE'
import json, os, sys

path = sys.argv[1]
if os.path.exists(path):
    try:
        with open(path) as handle:
            config = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit("invalid existing %s: %s" % (path, exc))
else:
    config = {}

config.setdefault("$schema", "https://opencode.ai/config.json")
instructions = config.setdefault("instructions", [])
for entry in (".claude/rules/mdl-skills.md", "tools/mdl-checks/syntax-digest.md"):
    if entry not in instructions:
        instructions.append(entry)

with open(path, "w") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
PY_OPENCODE
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
