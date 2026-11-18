// Coverage in the installer (overlay/lib/coverage.mjs): asked on a terminal after the agent question, --coverage /
// --no-coverage, off without a terminal and a flag, the choice kept on a reinstall. Off writes exactly what an
// install without the option writes; on swaps the rule file's done sentence, installs requirements-interview,
// points durable-tests at tests/coverage.mjs and writes that script. On stub apps, as install.test.mjs: no mxcli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideCoverage, answerCoverage, askCoverage, coverageRecord } from '../overlay/lib/coverage.mjs';
import { writeRules, copySkills, copyTestKit, copyFilm, copyCoverage, coverageOff, initBrain, summary, COVERAGE } from '../overlay/install.mjs';
import { INSTALLED_SKILLS, skillsFor } from '../overlay/lib/skills.mjs';
import { readTemplate, ruleText, parseRule, bodyLines, SKILLS_DIR, START, END } from '../overlay/lib/rules.mjs';
import { makeUi } from '../overlay/lib/ui.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-cov-inst-'));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const get = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => { try { fs.lstatSync(path.join(root, rel)); return true; } catch { return false; } };
const walk = (root, d = root, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(root, p, out) : out.push(path.relative(root, p)); } return out.sort(); };
const tree = root => Object.fromEntries(walk(root).map(f => [f, get(root, f)]));
const src = fs.readFileSync(new URL('../overlay/install.mjs', import.meta.url), 'utf8');
const bundleSkill = rel => fs.readFileSync(new URL(`../overlay/skills/${rel}`, import.meta.url), 'utf8');
const ALL = ['claude', 'cursor', 'codex', 'opencode', 'pi'];
const DIRS = ['.claude/skills', '.cursor/skills', '.agents/skills', '.opencode/skills'];
// a script beside a skill may keep its data in .mxcodr/ (test/skills-clean.test.mjs says why); skill texts may not
const scriptPaths = (file, line) => (file.endsWith('.mjs') ? line.replace(/\.mxcodr\//g, '') : line);
const GATE = /\bgates?\b|mxgate|\.mxgate|\.mxcodr|tests\/(orient|peek|lib|gate|film\.sh)|scenario\(|# covers|rulebook|--only\b|\bDONE\b/;

function stubApp() {
  const d = tmp();
  put(d, 'App.mpr', 'mpr');
  put(d, 'AGENTS.md', '# AGENTS.md\n\n<!-- mxcli:begin -->\nmxcli section\n<!-- mxcli:end -->\n');
  put(d, '.claude/skills/create-page/SKILL.md', 'mxcli own skill');
  return d;
}
// the file steps of an install, as main() runs them; opts undefined = the call as it was before coverage existed
function files(d, agents, opts) {
  if (opts === undefined) { writeRules(d, agents); copySkills(d, agents); }
  else { writeRules(d, agents, opts); copySkills(d, agents, undefined, opts); }
  copyTestKit(d, []); copyFilm(d);
  if (opts?.coverage) copyCoverage(d);
  return d;
}

test('the choice: a flag decides; else the last install\'s; else asked on a terminal; else off and not recorded', () => {
  assert.deepEqual(decideCoverage({ flag: true }), { on: true, how: 'flag' });
  assert.deepEqual(decideCoverage({ noFlag: true, prev: { coverage: true } }), { on: false, how: 'flag' }, '--no-coverage overrides the kept choice');
  assert.deepEqual(decideCoverage({ flag: true, prev: { coverage: false } }), { on: true, how: 'flag' }, '--coverage overrides the kept choice');
  assert.deepEqual(decideCoverage({ prev: { coverage: true }, tty: true }), { on: true, how: 'kept' }, 'a reinstall keeps it and does not ask');
  assert.deepEqual(decideCoverage({ prev: { coverage: false }, tty: true }), { on: false, how: 'kept' });
  assert.deepEqual(decideCoverage({ tty: true }), { on: false, how: 'ask' });
  assert.deepEqual(decideCoverage({ tty: true, yes: true }), { on: false, how: 'default' });
  assert.deepEqual(decideCoverage({}), { on: false, how: 'default' }, 'no terminal and no flag: off');
  assert.throws(() => decideCoverage({ flag: true, noFlag: true }), /both given/);
  // installed.json: the choice when one was made, nothing when it defaulted
  assert.deepEqual(coverageRecord({ on: false, how: 'default' }), {});
  assert.deepEqual(coverageRecord({ on: false, how: 'asked' }), { coverage: false });
  assert.deepEqual(coverageRecord({ on: true, how: 'kept' }), { coverage: true });
});

test('the question: y/yes on, n/no/Enter off, anything else asked again', async () => {
  for (const [a, on] of [['y', true], ['YES', true], ['n', false], ['no', false], ['', false], [' ', false]]) assert.equal(answerCoverage(a), on, a);
  assert.equal(answerCoverage('maybe'), null);
  let text = '';
  const answers = ['maybe', 'y'];
  const rl = { question: async p => { assert.equal(p, '\n  Coverage [y/N]: '); return answers.shift(); } };
  assert.deepEqual(await askCoverage({ rl, write: t => { text += t; } }), { on: true, how: 'asked' });
  assert.match(text, /Hold the agent to a test per requirement\? \(numbered requirements in the project brain,\n {2}`node tests\/coverage\.mjs` must show 0 missing before it is done\)/);
  assert.match(text, /Type y or n \(Enter is n\)/);
});

test('main(): the flags read, asked after the agents and before the theme, recorded in installed.json, one more bar step when on', () => {
  assert.match(src, /decideCoverage\(\{ flag: argv\.includes\('--coverage'\), noFlag: argv\.includes\('--no-coverage'\), prev, tty, yes: argv\.includes\('--yes'\) \}\)/);
  assert.match(src, /if \(picked\.how === 'ask'\) picked = await askAgents[^\n]*\n\s*if \(cov\.how === 'ask'\) cov = await askCoverage[^\n]*\n\s*if \(choice\.how === 'ask'\) choice = \{ name: await askTheme/);
  assert.match(src, /if \(picked\.how === 'ask' \|\| cov\.how === 'ask' \|\| choice\.how === 'ask'\)/);
  assert.match(src, /writeRules\(app, agents, \{ coverage: cov\.on \}\)/);
  assert.match(src, /copySkills\(app, agents, undefined, \{ coverage: cov\.on \}\)/);
  assert.match(src, /skills, \.\.\.coverageRecord\(cov\), testKit/);
  assert.match(src, /ui\.plan\(14 \+ \(newApp \? 1 : 0\) \+ \(cov\.on \? 1 : 0\)/);
  // the brain is created on every install, in its own step before this one (test/brain.test.mjs)
  assert.match(src, /if \(cov\.on\) \{\n\s*ui\.begin\('installing the coverage check'\);\n\s*ui\.done\('coverage', `1 \$\{ui\.i\.arrow\} \$\{copyCoverage\(app\)\}/);
  assert.match(src, /\} else \{\n\s*const off = coverageOff\(app, prev\);/);
});

test('off writes byte for byte what an install without the option writes, for every agent', () => {
  const plain = tree(files(stubApp(), ALL));
  const off = tree(files(stubApp(), ALL, { coverage: false }));
  assert.deepEqual(off, plain);
  // and that is today's install: the template rule, the bundle's skills unchanged, no coverage files
  assert.equal(off['.claude/rules/mxcodr.md'], readTemplate('mxcodr.md') + '\n' + readTemplate('brain.md'));
  for (const dir of DIRS) {
    assert.equal(off[`${dir}/durable-tests/SKILL.md`], bundleSkill('durable-tests/SKILL.md'));
    // installed always since 2026.11.14.2 (owner decision 2026-11-14), the bundle's text
    assert.equal(off[`${dir}/requirements-interview/SKILL.md`], bundleSkill('requirements-interview/SKILL.md'), `${dir}: requirements-interview`);
  }
  assert.ok(!(COVERAGE in off));
  // nothing an agent reads mentions tests/coverage.mjs, except requirements-interview's lines that say "with coverage on"
  for (const [f, t] of Object.entries(off)) for (const l of t.split('\n').filter(l => l.includes('tests/coverage.mjs')))
    assert.ok(f.includes('requirements-interview/') && /with coverage on/i.test(l), `${f}: ${l}`);
});

test('on: every agent\'s rule has the coverage done sentence, as many lines; requirements-interview installed (as when off); durable-tests points at tests/coverage.mjs; the script written', () => {
  const d = files(stubApp(), ALL, { coverage: true });
  const done = readTemplate('coverage-done.md').trimEnd();
  const claude = get(d, '.claude/rules/mxcodr.md');
  assert.ok(claude.includes(done));
  assert.equal(claude.split('\n').length, ruleText(SKILLS_DIR.claude).split('\n').length, 'as many lines as without coverage');
  assert.equal(bodyLines(parseRule(get(d, '.cursor/rules/mxcodr.mdc')).body), bodyLines(ruleText(SKILLS_DIR.cursor)));
  assert.ok(get(d, '.cursor/rules/mxcodr.mdc').includes(done));
  const md = get(d, 'AGENTS.md');
  assert.ok(md.slice(md.indexOf(START), md.indexOf(END)).includes(done), 'the AGENTS.md block too');
  for (const rule of [claude, get(d, '.cursor/rules/mxcodr.mdc'), md]) assert.doesNotMatch(rule, /printed a table/);
  for (const dir of DIRS) {
    for (const s of skillsFor({ coverage: true })) assert.ok(exists(d, `${dir}/${s}/SKILL.md`), `${dir}/${s}`);
    const dt = get(d, `${dir}/durable-tests/SKILL.md`);
    assert.match(dt, /Run `node tests\/coverage\.mjs`/);
    assert.match(dt, /`test\('\[R12\] a customer sees only its own orders', \.\.\.\)`/);
    assert.doesNotMatch(dt, /Print a table `requirement -> test/, 'one definition of done, not two');
    assert.equal(get(d, `${dir}/requirements-interview/SKILL.md`), bundleSkill('requirements-interview/SKILL.md'));
    for (const s of skillsFor({ coverage: true })) for (const f of walk(path.join(d, dir, s)))
      get(path.join(d, dir, s), f).split('\n').forEach((l, i) => assert.doesNotMatch(scriptPaths(f, l), GATE, `${dir}/${s}/${f}:${i + 1}`));
  }
  assert.equal(get(d, COVERAGE), readTemplate('coverage.mjs'));
  assert.equal(skillsFor({ coverage: true }), INSTALLED_SKILLS, 'the same skills with coverage on or off');
  assert.equal(skillsFor(), INSTALLED_SKILLS);
  assert.ok(INSTALLED_SKILLS.includes('requirements-interview'));
});

test('a reinstall that switches it off: plain rule and skills again, tests/coverage.mjs removed, docs/brain/ kept; a reinstall that stays on rewrites the script', () => {
  const d = files(stubApp(), ['claude'], { coverage: true });
  put(d, 'docs/brain/plan/01-orders.md', 'the plan');
  put(d, COVERAGE, 'edited by hand');
  files(d, ['claude'], { coverage: true });
  assert.equal(get(d, COVERAGE), readTemplate('coverage.mjs'), 'the bundle\'s script, on every install');
  assert.equal(coverageOff(d, { coverage: false }), null, 'was not on: nothing to remove');
  assert.ok(exists(d, COVERAGE));
  files(d, ['claude'], { coverage: false });
  assert.match(coverageOff(d, { coverage: true }), /coverage is off now: removed tests\/coverage\.mjs; .*docs\/brain\/ stays/);
  assert.ok(!exists(d, COVERAGE));
  assert.ok(exists(d, '.claude/skills/requirements-interview'), 'installed with coverage off too');
  assert.equal(get(d, '.claude/rules/mxcodr.md'), readTemplate('mxcodr.md') + '\n' + readTemplate('brain.md'));
  assert.equal(get(d, '.claude/skills/durable-tests/SKILL.md'), bundleSkill('durable-tests/SKILL.md'));
  assert.equal(get(d, 'docs/brain/plan/01-orders.md'), 'the plan');
  const plain = files(stubApp(), ['claude'], { coverage: false });
  for (const f of ['.claude/rules/mxcodr.md', '.claude/skills/durable-tests/SKILL.md']) assert.equal(get(d, f), get(plain, f));
});

test('the brain (every install, test/brain.test.mjs): mxcli brain init when docs/brain/ is missing, never over one that exists; a failure is a note, not the end', () => {
  const d = stubApp();
  const calls = [];
  const ok = initBrain(d, 'App.mpr', args => { calls.push(args); fs.mkdirSync(path.join(d, 'docs', 'brain'), { recursive: true }); return { status: 0 }; });
  assert.deepEqual(calls, [['brain', 'init', '-p', 'App.mpr']]);
  assert.equal(ok.ok, true);
  assert.equal(ok.line, 'docs/brain/ created (mxcli brain init)');
  assert.equal(initBrain(d, 'App.mpr', () => { throw new Error('must not run'); }), null);
  const failed = initBrain(stubApp(), 'App.mpr', () => ({ status: 1, stderr: 'boom' }));
  assert.equal(failed.ok, false);
  assert.match(failed.line, /mxcli brain init failed: boom; the agent runs \.\/mxcli brain init -p App\.mpr first/);
  assert.match(initBrain(stubApp(), 'App.mpr', null).line, /no mxcli to create it/);
});

test('the summary: one coverage line when on, none when off; the skills row counts the installed skills (the same on and off)', () => {
  const show = coverage => {
    let text = '';
    const ui = makeUi({ out: { write: t => { text += t; } }, err: { write() {} }, env: {}, isTTY: false });
    summary({ app: '/apps/Shop', mpr: 'Shop.mpr', mxcli: '/bin/mxcli', ruleTargets: ['.claude/rules/mxcodr.md'], skillDirs: ['.claude/skills/'], kit: { written: [] }, db: 'hsqldb', warnings: [], agents: ['claude'], coverage }, ui);
    return text;
  };
  const on = show(true), off = show(false);
  assert.match(on, /\n {5}coverage {4}on {2}docs\/brain\/plan \+ tests\/coverage\.mjs/);
  assert.match(on, new RegExp(`\\n {5}skills +${INSTALLED_SKILLS.length} `), 'the same skills with coverage on');
  assert.doesNotMatch(off, /coverage/);
  assert.match(off, new RegExp(`\\n {5}skills +${INSTALLED_SKILLS.length} `));
});
