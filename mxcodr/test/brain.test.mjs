// The project brain (docs/brain/), as the owner-approved contract of 2026-11-14 has the harness work with it:
// `mxcli brain init` on every install when docs/brain/ is missing (not only with coverage on), the brain rule
// (templates/brain.md) in the always-on rule text of every agent, and requirements-interview's panel / no-panel
// wording (MXCODR_PANEL=1: the person approves in mx-codr's panel; without it: in the chat). On stub apps, no mxcli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeRules, summary } from '../overlay/install.mjs';
import { readTemplate, ruleText, mdcText, parseRule, checkRule, SKILLS_DIR, AGENTS, START, END, BRAIN_RULE } from '../overlay/lib/rules.mjs';
import { makeUi } from '../overlay/lib/ui.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-brain-'));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const get = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const src = fs.readFileSync(new URL('../overlay/install.mjs', import.meta.url), 'utf8');
const brain = () => readTemplate(BRAIN_RULE);
const interview = () => fs.readFileSync(new URL('../overlay/skills/requirements-interview/SKILL.md', import.meta.url), 'utf8');

test('brain always: main() runs initBrain on every install, outside the coverage step, one bar step for it', () => {
  // its own step, before the coverage step, not inside `if (cov.on)`
  assert.match(src, /ui\.begin\('creating the project brain'\);\n\s*const brain = initBrain\(app, mpr, args => run\(mxcli, args\)\);/);
  const covBlock = /if \(cov\.on\) \{[\s\S]*?\n {2}\} else \{/.exec(src)[0];
  assert.doesNotMatch(covBlock, /initBrain/, 'the coverage step no longer creates the brain');
  assert.ok(src.indexOf("ui.begin('creating the project brain')") < src.indexOf('if (cov.on) {'));
  assert.match(src, /ui\.plan\(15 \+ \(newApp \? 1 : 0\) \+ \(cov\.on \? 1 : 0\)/);
  assert.match(src, /summary\(\{[^\n]*\bbrain\b[^\n]*\}\);/, 'the summary is told what happened to docs/brain/');
});

test('brain always: the summary has a brain row with or without coverage; kept, created or not created', () => {
  const show = (opts) => {
    let text = '';
    const ui = makeUi({ out: { write: t => { text += t; } }, err: { write() {} }, env: {}, isTTY: false });
    summary({ app: '/apps/Shop', mpr: 'Shop.mpr', mxcli: '/bin/mxcli', ruleTargets: ['.claude/rules/mxcodr.md'], skillDirs: ['.claude/skills/'], kit: { written: [] }, db: 'hsqldb', warnings: [], agents: ['claude'], ...opts }, ui);
    return text;
  };
  assert.match(show({ coverage: false, brain: { ok: true } }), /\n {5}brain {8}1 {2}docs\/brain\/ +\(created by mxcli brain init; the app's, never overwritten\)/);
  assert.match(show({ coverage: false, brain: null }), /\n {5}brain {8}1 {2}docs\/brain\/ +\(kept as it was; the app's, never overwritten\)/);
  assert.match(show({ coverage: true, brain: { ok: false, line: 'x' } }), /\n {5}brain {8}0 {2}docs\/brain\/ not created/);
});

test('the brain rule: in the rule text of every agent (Claude Code, Cursor, the AGENTS.md block), live mode and coverage too', () => {
  const b = brain();
  for (const dir of new Set(Object.values(SKILLS_DIR)))
    for (const opts of [{}, { coverage: true }, { live: true }, { live: true, skillsOff: ['film-tests'] }]) {
      const t = ruleText(dir, undefined, opts);
      assert.ok(t.endsWith('\n' + b), `${dir} ${JSON.stringify(opts)}: ends on the brain rule`);
      assert.deepEqual(checkRule(t), [], `${dir} ${JSON.stringify(opts)}`);
    }
  assert.ok(mdcText().endsWith('\n' + b));
  // as written into an app, for every agent the installer supports
  const d = tmp();
  put(d, 'App.mpr', 'mpr');
  writeRules(d, AGENTS);
  assert.ok(get(d, '.claude/rules/mxcodr.md').endsWith('\n' + b));
  assert.ok(parseRule(get(d, '.cursor/rules/mxcodr.mdc')).body.endsWith('\n' + b));
  const md = get(d, 'AGENTS.md');
  const block = md.slice(md.indexOf(START), md.indexOf(END));
  assert.ok(block.includes(b.trimEnd()), 'the AGENTS.md block (Codex, opencode, Pi) carries it');
});

test('the brain rule: the contract\'s points, short (read every session by every agent)', () => {
  const b = brain();
  // the plan line, exactly (contract 2)
  assert.ok(b.includes('`Requirement: R<n> <title> | slice <NN-name> | anchor @Module.Document | why <details>`'));
  assert.match(b, /no anchor yet: leave out\n` \| anchor \.\.\.`/);
  // capture with --json; three triggers; the open question captured before asking; at most 3 findings a turn
  assert.match(b, /`\.\/mxcli brain capture "<text>" \.\.\. --json`/);
  assert.match(b, /^1\. A request for a feature that is not in the requirement list/m);
  assert.match(b, /^2\. You cannot go on without a business-rule answer: capture the question with `--open` first, then ask it \(plan mode: no\n {3}`--open`, the answer goes into the plan's lines\)\./m);
  assert.match(b, /^3\. The person corrected the same thing a second time, or you chose between real alternatives/m);
  assert.match(b, /At most 3 per turn\./);
  assert.match(b, /never ask\nwhether to save something/);
  // the chat answer: promote, then resolve with the person's words (resolve needs a committed entry, measured)
  assert.match(b, /`\.\/mxcli brain promote <id>`, then `\.\/mxcli brain resolve <id> "<their exact words>"`/);
  // the never list
  assert.match(b, /Never promote your own findings, write a status into a requirement, or edit or drop an entry unless asked in the chat\./);
  assert.match(b, /never a bare module/);
  // 2026-11-14 (owner, after a real plan anchored two requirements at an existing page): (a) the anchor is new work
  assert.match(b, /The anchor is a NEW\n {3}document or attribute the work creates \(enum, page, microflow\): never an existing one, never a bare module\./);
  // owner, 1.78.28 / 1.79.32: a short title (about 8 words), the details and the reason on the second line, for every entry
  assert.match(b, /Every entry is `"<title>\\n<details>"`: a title of at most about 8 words saying what is\nrequired or decided, the details and the reason on the second line\./);
  assert.match(b, /`"R<n> <title>\\n<details>" --slice <NN-name> -a/);
  // owner, 1.77.27: a new slice takes the next free number (03 after 02-high-scores), never one already used
  assert.match(b, /a new slice takes the next free NN/);
  // a finding carries its why on the second line, and the person decides by it (the panel shows it as "Why: ...")
  assert.match(b, /\(the person decides by that why;/);
  // (b) every business-rule assumption of a plan on its own Decision line, approved with the plan; an open choice still asked
  assert.match(b, /per business-rule assumption one line\n`Decision: D<n> <title> \| anchor @Module\.Document \| why <details>` \(anchor and why optional, approved with the plan\); open\nchoices: trigger 2\./);
  // owner, 2026-11-14: decisions are numbered D<n> like requirements' R<n>; the pack names the next free numbers
  assert.match(b, /capture `"D<n> <title>\\n<why>" -a @\.\.\.` \(the person decides by that why;\n {3}n after the highest D, queue too\)\. At most 3 per turn\./);
  assert.match(b, /The pack names the next free R, D and slice numbers\./);
  assert.match(b, /A\nplan captures nothing: per new requirement one line\n`Requirement: /);
  // the switch, and the pack instead of reading docs/brain/
  // shell-neutral: `echo $MXCODR_PANEL` prints nothing in PowerShell, so the rule names no shell command for it
  assert.match(b, /\*\*With `MXCODR_PANEL=1`\*\* set, the person approves in mx-codr's panel: promote nothing else\./);
  assert.doesNotMatch(b, /echo \$MXCODR_PANEL/);
  assert.match(b, /The brain pack at session start is your brain reading and the requirement list \(no pack: `\.\/mxcli\nbrain list --kind requirement`\); do not read `docs\/brain\/`/);
  // 2026-11-14: an answer in the panel's question card is saved by the panel; the agent resolves only a chat message
  assert.match(b, /Answered in a chat message: /);
  assert.match(b, /`\.\/mxcli brain brief --module <M>`/);
  assert.match(b, /\*\*Without it\*\*, promote only what the person approved in the chat/);
  // small: lines and characters (about 4 characters a token)
  // owner, 2026-11-14: raised from 24 lines / 2,000 characters for the title + details form and the D numbers
  assert.ok(b.split('\n').length - 1 <= 26, `${b.split('\n').length - 1} lines`);
  assert.ok(b.length <= 2300, `${b.length} characters`);
  assert.doesNotMatch(b, /^---$/m);
});

test('requirements-interview: with MXCODR_PANEL=1 it captures and does not promote; without, promote after the person agrees in chat', () => {
  const t = interview();
  assert.match(t, /\*\*With `MXCODR_PANEL=1`\*\*[^\n]*\n?[^\n]*mx-codr's panel/);
  assert.match(t, /With `MXCODR_PANEL=1`[\s\S]{0,400}do not promote them/);
  assert.match(t, /\*\*Without it\*\*[\s\S]{0,300}when the person agrees in the chat, promote them/);
  // open questions: never resolved by the agent; the chat answer is promote, then resolve with their words
  assert.match(t, /\*\*Never resolve an open question yourself\*\*/);
  assert.match(t, /`\.\/mxcli brain promote <id>`, then\s+`\.\/mxcli brain resolve <id> "<their exact words>"`/);
  assert.doesNotMatch(t, /When they give it, run `\.\/mxcli brain resolve <id> "<their answer>"`/, 'resolve alone fails on a queued entry');
  // numbering continues after the queue too (contract 1)
  assert.match(t, /after the highest number already in `docs\/brain\/plan\/` and in the queue/);
  // captures with --json, so the id is in the output
  assert.match(t, /brain capture "R12 [^\n]*--json/);
});

test('requirements-interview is installed always (owner 2026-11-14): with or without coverage, file and live mode', async () => {
  const { INSTALLED_SKILLS, skillsFor } = await import('../overlay/lib/skills.mjs');
  const { copySkills } = await import('../overlay/install.mjs');
  assert.ok(INSTALLED_SKILLS.includes('requirements-interview'), 'in INSTALLED_SKILLS, which the extension\'s live setup lists too');
  assert.ok(skillsFor().includes('requirements-interview') && skillsFor({ coverage: true }).includes('requirements-interview'));
  for (const opts of [{}, { coverage: false }, { live: true }, { live: true, skillsOff: ['film-tests'] }]) {
    const d = tmp();
    put(d, 'App.mpr', 'mpr');
    copySkills(d, ['claude', 'codex'], undefined, opts);
    for (const dir of ['.claude/skills', '.agents/skills']) assert.ok(fs.existsSync(path.join(d, dir, 'requirements-interview', 'SKILL.md')), `${dir} ${JSON.stringify(opts)}`);
  }
});

test('requirements-interview: triggers on a bigger new request only, and reads right without coverage', () => {
  const t = interview();
  const desc = /^description: "(.*)"$/m.exec(t)[1];
  assert.match(desc, /Use before the first feature of a new app, and before a change that adds a role, a module or a channel\./);
  assert.match(desc, /Not for a fix, a small change or a question/);
  // every coverage-only step is said to be so
  for (const l of t.split('\n').filter(l => /tests\/coverage\.mjs/.test(l))) assert.match(l, /with coverage on/i, l);
  assert.match(t, /With coverage on \(the app has `tests\/coverage\.mjs`\)/);
});
