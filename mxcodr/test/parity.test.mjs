// The readability refactor's round 2 (2026-11-21) moves the bundle's code between files and changes nothing it does.
// This compares the working bundle with the frozen one (reference.mjs, REF_COMMIT): every module's export surface
// (names, kinds, constant values), what the installer's steps write into an app for several option sets (each file's
// text, and what each step returns), what the installer prints and writes end to end with a stand-in mxcli, and what
// the copies it leaves in the app (tests/film.mjs, the skill gate) print when they run. No list of intended changes:
// a commit that changes the bundle's behaviour moves REF_COMMIT.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { reference, BUNDLE_DIR } from './reference.mjs';

const ref = reference();
const skip = !ref && 'needs git and the round 2 reference commit';
const imp = (root, rel) => import(pathToFileURL(path.join(root, rel)).href);
const tmp = p => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const where = s => [ref, BUNDLE_DIR, fs.realpathSync(BUNDLE_DIR)].reduce((t, r) => t.split(r).join('<B>'), s);

const shape = m => Object.keys(m).sort().map(k => `${k}:${typeof m[k]}`);
const values = m => Object.keys(m).sort().filter(k => typeof m[k] !== 'function').map(k => [k, m[k] instanceof Map || m[k] instanceof Set ? [...m[k]] : m[k] instanceof RegExp ? String(m[k]) : m[k]]);
const mjsUnder = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap(e => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  return e.isDirectory() ? mjsUnder(root, r) : e.name.endsWith('.mjs') ? [r] : [];
});

test('harness round 2: every module of the frozen bundle exports the same names, of the same kinds, and the same constant values', { skip }, async () => {
  const rels = mjsUnder(path.join(ref, 'overlay')).map(r => `overlay/${r}`);
  assert.ok(rels.length >= 18, String(rels.length));
  for (const rel of rels) {
    const [o, n] = [await imp(ref, rel), await imp(BUNDLE_DIR, rel)];
    assert.deepEqual(shape(n), shape(o), rel);
    assert.equal(where(JSON.stringify(values(n))), where(JSON.stringify(values(o))), `${rel}: the values of its constants`);
  }
});

// An app folder as text: every file (and link) under it, relative path -> its text, the app's own path and the
// install log's dates replaced. Both bundles' installs are compared as these maps.
function tree(app) {
  const out = {};
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(app, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name, f = path.join(app, r);
      if (e.isSymbolicLink()) out[r] = `link -> ${fs.readlinkSync(f)}`;
      else if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(f, 'utf8');
    }
  };
  walk('');
  return JSON.parse(norm(JSON.stringify(out), app));
}
const norm = (s, app) => where(s.split(app).join('<APP>')).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<T>');

// An app an earlier bundle installed into: the v2 gate's files and hooks, its AGENTS.md block, an empty rules.local.md.
function oldApp() {
  const app = tmp('mxcodr-par-app-');
  fs.writeFileSync(path.join(app, 'App.mpr'), '');
  fs.mkdirSync(path.join(app, '.mxgate', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(app, 'rules.local.md'), '\n');
  fs.mkdirSync(path.join(app, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(app, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(./mxgate check)', 'Bash(ls)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash .mxgate/pre.sh' }] }] } }));
  fs.writeFileSync(path.join(app, 'AGENTS.md'), "# Notes\n\nThe person's text.\n\n<!-- mxgate:start -->\nold\n<!-- mxgate:end -->\n");
  return app;
}

// The installer's steps in main()'s order, as the Studio Pro extension's setup calls them (with live and skillsOff).
async function steps(root, app, { agents, coverage = false, live = false, skillsOff = [], prev = {} }) {
  const I = await imp(root, 'overlay/install.mjs');
  const T = await imp(root, 'overlay/lib/theme.mjs');
  const r = {};
  r.migrated = I.migrateBin(app, prev);
  r.cleanup = I.upgradeCleanup(app);
  r.rules = I.writeRules(app, agents, { coverage, live, skillsOff });
  r.skills = I.copySkills(app, agents, undefined, { coverage, live, skillsOff });
  r.gate = I.installSkillGate(app, agents);
  r.kit = I.copyTestKit(app, Array.isArray(prev.testKit) ? prev.testKit : [], undefined, { live });
  r.film = I.copyFilm(app, undefined, { live });
  r.brain = I.initBrain(app, 'App.mpr', null);
  r.coverage = coverage ? I.copyCoverage(app) : I.coverageOff(app, prev);
  r.theme = T.installThemeTool(app);
  return r;
}
const RUNS = [
  [{ agents: ['claude'] }],
  [{ agents: ['claude', 'cursor', 'codex', 'opencode', 'pi'], coverage: true }],
  [{ agents: ['claude', 'codex'], live: true, skillsOff: ['app-security', 'files-and-images'] }],
  [{ agents: ['cursor', 'pi'], coverage: true, live: true }],
  // a reinstall: coverage off again, Claude Code taken out, a kit recorded by the first run
  [{ agents: ['claude', 'cursor'], coverage: true }, { agents: ['cursor'], prev: { coverage: true, testKit: ['tests/mx-impl.ts', 'tests/mx.ts'] } }],
];

test("harness round 2: the installer's steps write the same files with the same text, and return the same, for every option set", { skip }, async () => {
  for (const run of RUNS) {
    const [a, b] = [oldApp(), oldApp()];
    for (const opts of run) {
      const [o, n] = [await steps(ref, a, opts), await steps(BUNDLE_DIR, b, opts)];
      assert.equal(norm(JSON.stringify(n), b), norm(JSON.stringify(o), a), JSON.stringify(opts));
    }
    assert.deepEqual(tree(b), tree(a), JSON.stringify(run));
  }
});

// A stand-in for the pinned mxcli, so main() runs end to end in seconds and offline: a binary (findMxcli skips
// scripts) that reports the pinned version, makes an empty <name>.mpr for `new`, and does nothing else.
const STUB_C = `#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "--version")) { printf("mxcli version v%s\\n", PIN); return 0; }
  if (argc > 2 && !strcmp(argv[1], "new")) {
    for (int i = 2; i < argc - 1; i++) if (!strcmp(argv[i], "--output-dir")) {
      char f[4096]; mkdir(argv[i + 1], 0755); snprintf(f, sizeof f, "%s/%s.mpr", argv[i + 1], argv[2]);
      FILE *o = fopen(f, "w"); if (o) fclose(o);
    }
  }
  return 0;
}
`;
let stubDir;
function stub(pin) {
  if (stubDir !== undefined) return stubDir;
  stubDir = null;
  if (process.platform === 'win32') return null;
  const d = tmp('mxcodr-par-stub-');
  fs.writeFileSync(path.join(d, 'stub.c'), STUB_C.replace('PIN', JSON.stringify(pin)));
  const r = spawnSync('cc', ['-o', path.join(d, 'mxcli'), path.join(d, 'stub.c')], { encoding: 'utf8' });
  if (r.status === 0) stubDir = d;
  return stubDir;
}

function install(root, app, args, bin) {
  const r = spawnSync(process.execPath, [path.join(root, 'overlay', 'install.mjs'), app, ...args], {
    encoding: 'utf8', timeout: 60000, cwd: app,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_COLOR: '1', MX_VERSION: '', APP_NAME: '' },
  });
  const t = s => norm(s ?? '', app).replace(/\b\d+(\.\d+)?\s?(ms|s|m)\b/g, '<t>');
  return `exit ${r.status}\n--stdout\n${t(r.stdout)}\n--stderr\n${t(r.stderr)}`;
}

test('harness round 2: install.mjs end to end (a stand-in mxcli): the same output and the same app, fresh, reinstalled and in a folder with no app', { skip }, async () => {
  const { PIN } = await imp(BUNDLE_DIR, 'overlay/lib/mx.mjs');
  const bin = stub(PIN);
  if (!bin) return; // no C compiler here: the step-by-step test above still runs
  const runs = [
    ['--db', 'hsqldb', '--yes'],
    ['--db', 'hsqldb', '--yes', '--agent', 'cursor,codex', '--coverage'],
    ['--yes', '--remove-agent', 'codex', '--no-coverage'],
  ];
  const [a, b] = [oldApp(), oldApp()];
  for (const args of runs) {
    assert.equal(install(BUNDLE_DIR, b, args, bin), install(ref, a, args, bin), args.join(' '));
    assert.deepEqual(tree(b), tree(a), args.join(' '));
  }
  // no .mpr: mxcli new (the stand-in) makes one in a temporary folder and it is moved in; --no-app stops first
  for (const args of [['--db', 'hsqldb', '--yes', '--agent', 'claude'], ['--yes', '--no-app']]) {
    const [x, y] = [tmp('mxcodr-par-new-'), tmp('mxcodr-par-new-')];
    for (const d of [x, y]) fs.writeFileSync(path.join(d, 'README.md'), 'the folder\'s own\n');
    assert.equal(install(BUNDLE_DIR, y, args, bin).replaceAll(path.basename(y).replace(/[^A-Za-z0-9]/g, ''), '<NAME>'),
      install(ref, x, args, bin).replaceAll(path.basename(x).replace(/[^A-Za-z0-9]/g, ''), '<NAME>'), args.join(' '));
    const named = (d, t) => JSON.parse(JSON.stringify(t).replaceAll(path.basename(d).replace(/[^A-Za-z0-9]/g, ''), '<NAME>'));
    assert.deepEqual(named(y, tree(y)), named(x, tree(x)), args.join(' '));
  }
});

// What the copies the installer leaves in the app do when they run: tests/film.mjs's help and its refusals, and the
// skill gate's hooks (a model write refused, the skill read, the write let through).
test('harness round 2: the copies in the app run the same: tests/film.mjs and .mxcodr/skill-gate.mjs', { skip }, async () => {
  const run = (app, args, input) => {
    const r = spawnSync(process.execPath, args, { cwd: app, input, encoding: 'utf8', timeout: 30000, env: { ...process.env, CLAUDE_PROJECT_DIR: app, MXCODR_SKILL_GATE: '' } });
    return `exit ${r.status}\n${norm(r.stdout, app)}\n--\n${norm(r.stderr, app)}`;
  };
  const outputs = async root => {
    const app = oldApp();
    await steps(root, app, { agents: ['claude'] });
    const out = [];
    for (const args of [[], ['--help'], ['--list'], ['--pace', 'fast', '7'], ['--status'], ['--stop'], ['7']]) out.push(run(app, ['tests/film.mjs', ...args]));
    const gate = mode => ['.mxcodr/skill-gate.mjs', mode];
    const write = JSON.stringify({ session_id: 's1', cwd: app, tool_name: 'Bash', tool_input: { command: './mxcli -p App.mpr -c "CREATE MODULE Fleet"' } });
    out.push(run(app, gate('pre'), write));
    for (const s of ['module-structure', 'naming-and-captions']) out.push(run(app, gate('post'), JSON.stringify({ session_id: 's1', cwd: app, tool_name: 'Skill', tool_input: { skill: s } })));
    out.push(run(app, gate('pre'), write));
    out.push(run(app, gate('reset'), JSON.stringify({ session_id: 's1', cwd: app, source: 'compact' })));
    out.push(run(app, gate('pre'), write));
    out.push(run(app, gate('pre'), 'not json'));
    return out;
  };
  assert.deepEqual(await outputs(BUNDLE_DIR), await outputs(ref));
});
