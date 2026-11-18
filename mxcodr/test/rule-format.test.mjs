import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readTemplate, ruleText, mdcText, parseRule, bodyLines, checkRule, SKILLS_DIR, DONE_SENTENCE, withCoverageDone } from '../overlay/lib/rules.mjs';
import { skillsFor } from '../overlay/lib/skills.mjs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const rule = readTemplate('mxcodr.md');

test('the template opens with sk2\'s keep-tests rule byte for byte (the measured file) and is 25 lines', () => {
  assert.equal(read('../overlay/templates/keep-tests.md'), read('./fixtures/keep-tests.md'));
  assert.ok(rule.startsWith(read('./fixtures/keep-tests.md')));
  assert.equal(rule.split('\n').length - 1, 25);
});

test('.claude/rules/mxcodr.md: first byte #, no line equals ---, no frontmatter, a 22-line body', () => {
  const t = ruleText(SKILLS_DIR.claude);
  assert.equal(t, rule, 'Claude Code gets the template unchanged');
  assert.equal(t[0], '#');
  assert.equal(t.split('\n').filter(l => l === '---').length, 0);
  const p = parseRule(t);
  assert.equal(p.frontmatter, null);
  assert.equal(bodyLines(p.body), 22);
  assert.deepEqual(checkRule(t), []);
});

test('.cursor/rules/mxcodr.mdc: frontmatter [description, alwaysApply], the same 22-line body, the Cursor skills folder', () => {
  const t = mdcText();
  const p = parseRule(t);
  assert.deepEqual(p.frontmatter, ['description', 'alwaysApply']);
  assert.equal(bodyLines(p.body), 22);
  assert.match(p.body, /`\.cursor\/skills\/`: `durable-tests`/);
  assert.doesNotMatch(p.body, /\.claude\/skills|beside mxcli/);
  assert.deepEqual(checkRule(t, { mdc: true }), []);
});

test('the AGENTS.md text: .agents/skills without the parenthetical; opencode keeps it', () => {
  assert.match(ruleText(SKILLS_DIR.codex), /`\.agents\/skills\/`: `durable-tests`/);
  assert.match(ruleText(SKILLS_DIR.opencode), /`\.opencode\/skills\/` \(beside mxcli's\)/);
});

test('sk1\'s shape (the text wrapped in --- lines) parses to an empty body and fails the check', () => {
  const sk1 = `---\n${rule}---\n`;
  const p = parseRule(sk1);
  assert.equal(p.body.length, 0);
  assert.ok(checkRule(sk1).length > 0);
  assert.ok(checkRule('---\nname: x\n---\n' + rule).length > 0, 'a file that starts with --- fails');
});

test('the coverage variant: 25 lines, a 22-line body, the same text except the done sentence; no option is the template', () => {
  const plain = ruleText(SKILLS_DIR.claude), cov = ruleText(SKILLS_DIR.claude, undefined, { coverage: true });
  assert.equal(ruleText(SKILLS_DIR.claude, undefined, { coverage: false }), rule);
  assert.equal(cov.split('\n').length - 1, 25);
  assert.equal(bodyLines(parseRule(cov).body), 22);
  assert.deepEqual(checkRule(cov), []);
  assert.equal((rule.match(new RegExp(DONE_SENTENCE.source, 'g')) || []).length, 1, 'the template has the done sentence once');
  const done = readTemplate('coverage-done.md').trimEnd();
  assert.equal(done, '**You are done only\nwhen** `node tests/coverage.mjs` shows `0 missing` (every numbered requirement in `docs/brain/plan/`\n'
    + 'cited by a test title as `[R12]`; record them first, skill `requirements-interview`) and\n`npx playwright test --shuffle` in `tests/` is green with `sessions left: 0`.');
  assert.equal(done.split('\n').length, rule.match(DONE_SENTENCE)[0].split('\n').length, 'as many lines as the sentence it replaces');
  // outside the sentence the two are the same, line for line
  assert.equal(cov.replace(done, '<done>'), plain.replace(DONE_SENTENCE, '<done>'));
  assert.notEqual(cov, plain);
  for (const t of [mdcText(undefined, { coverage: true }), ruleText(SKILLS_DIR.codex, undefined, { coverage: true })]) {
    assert.ok(t.includes(done));
    assert.equal(bodyLines(parseRule(t).body), 22);
  }
  assert.throws(() => withCoverageDone('# no such sentence\n'), /no longer has the sentence/);
});

test('the coverage variant names only skills a coverage install installs', () => {
  const cov = ruleText(SKILLS_DIR.claude, undefined, { coverage: true });
  for (const m of cov.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) assert.ok(skillsFor({ coverage: true }).includes(m[1]), m[1]);
  assert.match(cov, /`requirements-interview`/);
});
