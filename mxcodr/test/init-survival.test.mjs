// The probe of plan section 4 as a repeatable test: what we install survives `mxcli init --all-tools`
// and `mxcli init --sync-skills`. Runs the pinned mxcli found on PATH; skipped when there is none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PIN } from '../overlay/lib/mx.mjs';
import { writeRules, copySkills, copyTestKit, copyFilm } from '../overlay/install.mjs';
import { START } from '../overlay/lib/rules.mjs';

const mxcli = (process.env.PATH || '').split(path.delimiter).map(d => path.join(d, 'mxcli'))
  .find(c => { const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 20000 }); return r.status === 0 && r.stdout.includes(`v${PIN}`); });

const walk = (root, d = root, out = []) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(root, p, out) : out.push(p); } return out; };
const snapshot = (app, rels) => Object.fromEntries(rels.map(r => path.join(app, r)).filter(f => fs.existsSync(f)).flatMap(f => fs.statSync(f).isDirectory() ? walk(app, f) : [f]).map(f => [path.relative(app, f), fs.readFileSync(f, 'utf8')]));

test(`our rule files, skills, test kit and AGENTS.md block survive mxcli ${PIN} init --all-tools and --sync-skills`, { skip: !mxcli && `no mxcli ${PIN} on PATH` }, () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-init-'));
  const init = (...a) => { const r = spawnSync(mxcli, ['init', ...a, '.'], { cwd: app, encoding: 'utf8', timeout: 120000, env: { ...process.env, MXCLI_QUIET: '1' } }); assert.equal(r.status, 0, r.stderr || r.stdout); };
  init('--all-tools'); // mxcli's own files and markers first, as in an app made by mxcli new
  const agents = ['claude', 'cursor', 'codex', 'opencode'];
  writeRules(app, agents); copySkills(app, agents); copyTestKit(app); copyFilm(app);
  fs.writeFileSync(path.join(app, '.claude', 'settings.local.json'), '{"model":"sonnet"}\n');
  const ours = ['.claude/rules/mxcodr.md', '.cursor/rules/mxcodr.mdc', '.claude/skills/durable-tests', '.claude/skills/film-tests', 'tests/film.mjs', '.cursor/skills', '.agents/skills', '.opencode/skills/app-security', '.claude/settings.local.json', 'tests'];
  const before = snapshot(app, ours);
  const block = t => t.slice(t.indexOf(START));
  const agentsBefore = block(fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8'));
  assert.ok(Object.keys(before).length > 20, 'the snapshot holds the installed files');
  for (const f of ['tests/film.mjs', '.claude/skills/film-tests/SKILL.md', '.agents/skills/film-tests/SKILL.md']) assert.ok(f in before, f);
  for (const args of [['--sync-skills'], ['--all-tools']]) {
    init(...args);
    assert.deepEqual(snapshot(app, ours), before, `after init ${args}`);
    assert.equal(block(fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8')), agentsBefore, `AGENTS.md block after init ${args}`);
  }
});

// D1 (probe 2026-11-01): with no AGENTS.md the installer wrote one holding only our block, and the next
// `mxcli init` regenerated the file without it. Now mxcli's markers go first, --sync-skills fills them, init keeps ours.
test(`an AGENTS.md the installer creates keeps our block through mxcli ${PIN} init --sync-skills and init --all-tools`, { skip: !mxcli && `no mxcli ${PIN} on PATH` }, () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-noagents-'));
  const init = (...a) => { const r = spawnSync(mxcli, ['init', ...a, '.'], { cwd: app, encoding: 'utf8', timeout: 120000, env: { ...process.env, MXCLI_QUIET: '1' } }); assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout + r.stderr; };
  const md = () => fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8');
  fs.writeFileSync(path.join(app, 'App.mpr'), ''); // --sync-skills fills the section only in a folder with an .mpr
  fs.writeFileSync(path.join(app, 'AGENTS.md'), '# Team notes\n\nkeep me\n'); // a hand-written AGENTS.md, no mxcli markers
  writeRules(app, ['codex']);
  const block = t => t.slice(t.indexOf(START));
  const ours = block(md());
  init('--sync-skills');
  assert.ok(md().indexOf('<!-- mxcli:end -->') > 200, 'sync filled mxcli\'s section');
  for (const args of [['--all-tools'], ['--sync-skills'], []]) {
    init(...args);
    assert.equal(block(md()), ours, `our block after init ${args}`);
    assert.match(md(), /keep me/, `the team's notes after init ${args}`);
    assert.equal(md().split('<!-- mxcli:begin').length, 2, `one mxcli section after init ${args}`);
  }
  fs.rmSync(path.join(app, 'AGENTS.md'));
  writeRules(app, ['codex']);
  init('--all-tools');
  assert.equal(block(md()), ours, 'an AGENTS.md created from nothing keeps our block too');
});
