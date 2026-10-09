// Record what the installer put in this project, and what each file looked like.
//
// Called by install.sh; tests/portable.sh compares against the result at gate preflight.
// Usage: record_install.cjs <app-dir> <bundle-dir> <version>; prints the number of files recorded.
// Writes <app>/tools/mdl-checks/INSTALL.json with keys version, installed, files ({path: sha256}).
// Exit 0; 1 on wrong argument count, printing the usage line. A port of record_install.py that
// writes the same file.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Files are listed from the bundle, not globbed in the app, so mxcli's own skills and rules are not tracked.
const SKILL_DIRS = ['.claude/skills', '.agents/skills', '.ai-context/skills'];
const HARNESS_SCRIPTS = ['gate.sh', 'orient.sh', 'diagnose.sh', 'precheck.sh', 'peek.sh', 'film.sh', 'db-snapshot.sh', 'mdl-applied.sh', 'theme.sh', 'lib.sh', 'portable.sh', 'scenario-helpers.js',
  'run-docker.sh', 'run-app.sh', 'marketplace-login.sh', 'CHECKS.md', 'rules.sh'];

// Sorted names ending in `suffix`; [] if the directory is missing.
function listdir(dir, suffix) {
  try {
    return fs.readdirSync(dir).filter(n => n.endsWith(suffix)).sort();
  } catch {
    return [];
  }
}

const isfile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// [bundle file, app-relative destination] for everything tracked.
function* destinations(src) {
  for (const name of HARNESS_SCRIPTS) yield [path.join(src, 'tests', name), 'tests/' + name];

  for (const name of listdir(path.join(src, 'tests', 'gate'), '.sh')) yield [path.join(src, 'tests', 'gate', name), 'tests/gate/' + name];

  for (const name of listdir(path.join(src, 'tests', 'lib'), '.sh')) yield [path.join(src, 'tests', 'lib', name), 'tests/lib/' + name];

  for (const name of listdir(path.join(src, 'tests', 'checks'), '.md')) yield [path.join(src, 'tests', 'checks', name), 'tests/checks/' + name];

  // The rulebook: one card per rule, hashed without its ## Local section (the person's levels and
  // exceptions are theirs, not drift) -- see hashOf.
  for (const name of listdir(path.join(src, 'rulebook'), '.md')) yield [path.join(src, 'rulebook', name), 'tests/rulebook/' + name];

  for (const name of listdir(path.join(src, 'checks'), '.py')) yield [path.join(src, 'checks', name), 'tools/mdl-checks/' + name];

  // The checks that run on Node: the guard and this recorder.
  for (const name of listdir(path.join(src, 'checks'), '.cjs')) yield [path.join(src, 'checks', name), 'tools/mdl-checks/' + name];

  // check_layout.cjs's rules, one module per area of a page.
  for (const name of listdir(path.join(src, 'checks', 'layout_rules'), '.cjs')) {
    yield [path.join(src, 'checks', 'layout_rules', name), 'tools/mdl-checks/layout_rules/' + name];
  }

  // The plugins' shared core and the reminder template: read by every host, changed by none.
  for (const name of listdir(path.join(src, 'checks', 'plugins'), '.cjs')) {
    yield [path.join(src, 'checks', 'plugins', name), 'tools/mdl-checks/plugins/' + name];
  }
  if (isfile(path.join(src, 'checks', 'reminder.txt'))) yield [path.join(src, 'checks', 'reminder.txt'), 'tools/mdl-checks/reminder.txt'];

  for (const name of listdir(path.join(src, 'hooks'), '.sh')) yield [path.join(src, 'hooks', name), 'tools/mdl-checks/hooks/' + name];

  for (const name of listdir(path.join(src, 'lint-rules'), '.star')) yield [path.join(src, 'lint-rules', name), '.claude/lint-rules/' + name];

  // plugins/ holds one file per host that takes a plugin: the OpenCode plugin, and the Pi
  // extension, which is installed under its host's own name.
  for (const name of listdir(path.join(src, 'plugins'), '.js')) {
    if (name.endsWith('.pi.js')) yield [path.join(src, 'plugins', name), '.pi/extensions/mendix-mdl-harness.js'];
    else yield [path.join(src, 'plugins', name), '.opencode/plugin/' + name];
  }

  yield [path.join(src, 'rules', 'mdl-skills.md'), '.claude/rules/mdl-skills.md'];
  yield [path.join(src, 'rules', 'mdl-skills.mdc'), '.cursor/rules/mdl-skills.mdc'];

  const skillsRoot = path.join(src, 'skills');
  let skills = [];
  try {
    skills = fs.readdirSync(skillsRoot).sort();
  } catch { /* no skills */ }
  for (const skill of skills) {
    const source = path.join(skillsRoot, skill, 'SKILL.md');
    if (!isfile(source)) continue;
    for (const dir of SKILL_DIRS) yield [source, `${dir}/${skill}/SKILL.md`];
    for (const name of listdir(path.join(skillsRoot, skill, 'reference'), '.md')) {
      for (const dir of SKILL_DIRS) yield [path.join(skillsRoot, skill, 'reference', name), `${dir}/${skill}/reference/${name}`];
    }
  }
}

// The hash the manifest records for a file: a rulebook card counts without its ## Local section
// (tests/portable.sh install-freshness in shell_helpers.cjs compares the same way).
function hashOf(relative, bytes) {
  if (relative.startsWith('tests/rulebook/')) bytes = Buffer.from(require('./rulebook.cjs').withoutLocal(bytes.toString('utf8')));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// time.strftime("%Y-%m-%d %H:%M:%S"): local time.
function now() {
  const d = new Date();
  const two = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function main(argv) {
  if (argv.length !== 3) {
    process.stderr.write('Record what the installer put in this project, and what each file looked like.\n');
    process.exit(1);
  }
  const [app, src, version] = argv;

  const files = {};
  for (const [source, relative] of destinations(src)) {
    if (!isfile(source)) continue;
    // Keys stay forward-slashed so manifests are portable across Windows and macOS.
    try {
      files[relative] = hashOf(relative, fs.readFileSync(path.join(app, ...relative.split('/'))));
    } catch {
      // Not installed in this project.
    }
  }

  const manifest = path.join(app, 'tools', 'mdl-checks', 'INSTALL.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  // json.dump(..., indent=1, sort_keys=True): keys sorted at every level, non-ASCII as \uXXXX.
  const sorted = {};
  for (const key of Object.keys(files).sort()) sorted[key] = files[key];
  const text = JSON.stringify({ files: sorted, installed: now(), version }, null, 1)
    .replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  fs.writeFileSync(manifest, text + '\n');
  process.stdout.write(Object.keys(files).length + '\n');
}

if (require.main === module) {
  // --destinations <bundle>: the tracked [bundle file, destination] pairs as JSON, for the dev tools.
  if (process.argv[2] === '--destinations') process.stdout.write(JSON.stringify([...destinations(process.argv[3])]) + '\n');
  else main(process.argv.slice(2));
}
module.exports = { destinations, hashOf };
