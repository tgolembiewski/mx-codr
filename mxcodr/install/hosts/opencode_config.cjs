// Add the rules and the syntax digest to the instructions in opencode.json.
'use strict';
const fs = require('fs');
const { dumps, loadOrExit } = require('./json_file.cjs');

const path = process.argv[2];
const config = loadOrExit(path, error => `invalid existing ${path}: ${error.message}\n`);

if (!('$schema' in config)) config.$schema = 'https://opencode.ai/config.json';
if (!('instructions' in config)) config.instructions = [];
for (const entry of ['.claude/rules/mdl-skills.md', 'tools/mdl-checks/syntax-digest.md']) {
  if (!config.instructions.includes(entry)) config.instructions.push(entry);
}

fs.writeFileSync(path, dumps(config, 2) + '\n');
