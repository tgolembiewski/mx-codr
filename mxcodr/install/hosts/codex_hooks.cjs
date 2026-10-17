// Merge the harness hooks into .codex/hooks.json, replacing an earlier registration of each script.
'use strict';
const fs = require('fs');
const { dumps, loadOrExit } = require('./json_file.cjs');

const path = process.argv[2];
const settings = loadOrExit(path, error => `invalid existing ${path}: ${error.message}\n`);

if (!('description' in settings)) settings.description = 'Mendix MDL skills and delivery gates';
if (!('hooks' in settings)) settings.hooks = {};
const hooks = settings.hooks;
// A project-relative path, like Claude's and Cursor's. The `$(git rev-parse ...)`
// this used to embed only expands if the host runs hook commands through a POSIX
// shell -- under a native Windows Codex it is literal text. All three scripts
// resolve the repo root themselves anyway.
const root = 'tools/mdl-checks/hooks';
const wanted = {
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: `bash ${root}/remind-skills-codex.sh`, timeout: 60 }],
  },
  // Codex hooks only its shell tool; apply_patch edits are not seen (the gate's drift check is).
  PreToolUse: {
    matcher: '^Bash$',
    hooks: [{ type: 'command', command: `bash ${root}/guard-harness-env.sh`, timeout: 30 }],
  },
  PostToolUse: {
    matcher: '^Bash$',
    hooks: [{ type: 'command', command: `bash ${root}/after-mxcli-exec-codex.sh`, timeout: 120 }],
  },
  Stop: {
    hooks: [{ type: 'command', command: `bash ${root}/stop-gate-codex.sh`, timeout: 600 }],
  },
};
const trimQuote = s => s.replace(/"+$/, '');
for (const [event, entry] of Object.entries(wanted)) {
  if (!(event in hooks)) hooks[event] = [];
  // An earlier install registered the same script through an embedded
  // `$(git rev-parse ...)`. Drop any registration of this script before adding the
  // new one, so an upgrade replaces it instead of firing the hook twice.
  const script = trimQuote(entry.hooks[0].command.split('/').pop());
  hooks[event] = hooks[event].filter(candidate =>
    !(candidate.hooks || []).some(handler => trimQuote(String(handler.command || '')).endsWith(script)));
  hooks[event].push(entry);
}

fs.writeFileSync(path, dumps(settings, 2) + '\n');
