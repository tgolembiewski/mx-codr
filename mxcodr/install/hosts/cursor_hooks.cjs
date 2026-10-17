// Merge the harness hooks into .cursor/hooks.json, replacing an earlier registration of each script.
'use strict';
const fs = require('fs');
const { dumps, loadOrExit } = require('./json_file.cjs');

const path = process.argv[2];
const settings = loadOrExit(path, error => `invalid existing ${path}: ${error.message}\n`);

if (!('version' in settings)) settings.version = 1;
if (!('hooks' in settings)) settings.hooks = {};
const hooks = settings.hooks;
// `bash <path>`, not `./<path>`: on Windows a .sh file is not executable, and the
// shebang means nothing to the shell Cursor spawns.
const root = 'tools/mdl-checks/hooks';
const wanted = {
  sessionStart: { command: `bash ${root}/remind-skills-cursor.sh`, timeout: 30 },
  // Before an `mxcli exec`: mx check on a copy of the model, denying an exec that would break the build.
  beforeShellExecution: { command: `bash ${root}/before-mxcli-exec-cursor.sh`, timeout: 180 },
  postToolUse: { command: `bash ${root}/after-mxcli-exec-cursor.sh`, timeout: 120 },
  // loop_limit caps the auto-submitted follow-ups; the marker is cleared on green,
  // so a session that fixes its failures stops looping before reaching it.
  stop: { command: `bash ${root}/stop-gate-cursor.sh`, timeout: 600, loop_limit: 5 },
};
for (const [event, entry] of Object.entries(wanted)) {
  if (!(event in hooks)) hooks[event] = [];
  // An earlier install registered the same script as `./tools/...`, which does not
  // run on Windows. Drop any registration of this script before adding the new one,
  // so the upgrade replaces it instead of firing the hook twice.
  const script = entry.command.split('/').pop();
  hooks[event] = hooks[event].filter(candidate => !String(candidate.command || '').endsWith(script));
  hooks[event].push(entry);
}

fs.writeFileSync(path, dumps(settings, 2) + '\n');
