// tests/coverage.mjs (overlay/templates/coverage.mjs): which numbered requirements a test title cites.
// fixtures/coverage-brain/docs/brain/ was written by the real mxcli 0.29.0 on a copy of so1 (2026-11-04; 0.30.0 writes the same lines):
// `brain init`, then `brain capture "R<n> ..." --slice <slice> [-a @...]` and `brain promote <id>` for R1-R5,
// an open question R7 captured into a slice (`--open --slice 02-invoices`), a decision (modules/Sales.md) and an
// open question in project.md. One heading was then added by hand: `## R9 ...` in 01-customers.md, without
// mxcli's line under it; `mxcli brain plan` counts 5 requirements there (R1-R5), not R7 and not R9.
// fixtures/coverage-list.json is the output of `npx playwright test --list --reporter=json` (@playwright/test
// 1.64.1, the kit's config and mx.ts) on two specs written for it: a skipped [R1], a describe tagged [R2] around a
// loop of template-string titles, [R3][R4] in a test two describes deep, an unknown [R8], and an untagged test.
// The run made no ./mxcli call (no teardown, no sessionCheck fixture) and needed no running app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { entriesFrom, readPlan, testsFromList, coverage, format } from '../overlay/templates/coverage.mjs';

const fixtureApp = fileURLToPath(new URL('./fixtures/coverage-brain/', import.meta.url));
const list = JSON.parse(fs.readFileSync(new URL('./fixtures/coverage-list.json', import.meta.url), 'utf8'));
const template = fileURLToPath(new URL('../overlay/templates/coverage.mjs', import.meta.url));
const plan = readPlan(fixtureApp);
const tests = testsFromList(list);
const meta = (id = 'abc123') => `Anchors: \`@Shop.Order_Overview\` · id \`${id}\` · 2026-11-04`;
// a copy of the list with every test passing and without the unknown [R8] test
const greenList = () => {
  const j = structuredClone(list);
  const walk = s => { s.specs = (s.specs || []).filter(sp => !sp.title.includes('[R8]')); for (const sp of s.specs) for (const t of sp.tests) t.expectedStatus = 'passed'; (s.suites || []).forEach(walk); };
  j.suites.forEach(walk);
  return j;
};

test('the plan as mxcli 0.29 writes it: numbered entries with its line, slices from the file names; a hand-written heading and project.md do not count', () => {
  const pick = e => [e.id, e.slice, e.hand ? 'hand' : [e.anchored, e.open, e.dropped].map(Number).join('')];
  assert.deepEqual(plan.map(pick), [
    ['R1', '01-customers', '100'], ['R2', '01-customers', '100'], ['R9', '01-customers', 'hand'],
    ['R3', '02-invoices', '100'], ['R4', '02-invoices', '100'], ['R5', '02-invoices', '001'], ['R7', '02-invoices', '010'],
  ]);
  assert.equal(plan[0].text, 'A customer sees only its own invoices', 'the number is not part of the text');
  assert.equal(plan[0].entry, '405d28');
  assert.ok(!plan.some(e => e.text.includes('is a question') || e.text.includes('Finance')), 'project.md and modules/ are not the plan');
  // what `mxcli brain plan` counted on the same files: 5 requirements (R1-R5)
  assert.equal(plan.filter(e => !e.hand && !e.open).length, 5);
});

test('test titles from --list: describe path joined, template strings resolved, several tags in one title, a describe tag covers its tests, skipped tests cite nothing', () => {
  assert.deepEqual(tests.map(t => [t.file, t.line, t.title, t.tags, t.counts]), [
    ['invoices.spec.ts', 3, '[R1] a customer sees only its own invoices (not written yet)', ['R1'], false],
    ['invoices.spec.ts', 18, '[R8] a tag that names no requirement', ['R8'], true],
    ['invoices.spec.ts', 7, '[R2] the Customers list › is refused to a customer', ['R2'], true],
    ['invoices.spec.ts', 7, '[R2] the Customers list › is refused to a clerk', ['R2'], true],
    ['invoices.spec.ts', 9, '[R2] the Customers list › opens for a manager', ['R2'], true],
    ['invoices.spec.ts', 14, 'invoices › totals › [R3][R4] the manager dashboard shows the total in EUR', ['R3', 'R4'], true],
    ['seed.spec.ts', 3, 'startup runs twice without a second seed', [], true],
  ]);
  assert.deepEqual(testsFromList({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: '[R012] leading zeros', file: 'a.spec.ts', line: 1, tests: [] }] }] })[0].tags, ['R12']);
});

test('the fixture: R1 missing (only a skipped test cites it), [R8] unknown, R5 dropped, R7 open, R9 by hand; exit 1', () => {
  const r = coverage(plan, tests);
  assert.equal(r.ok, false);
  assert.deepEqual([r.total, r.tested], [4, 3]);
  assert.deepEqual(r.missing, [{ id: 'R1', text: 'A customer sees only its own invoices', slice: '01-customers', skippedOnly: ['invoices.spec.ts:3'] }]);
  assert.deepEqual(r.unknown, [{ id: 'R8', test: 'invoices.spec.ts:18 [R8] a tag that names no requirement' }]);
  assert.deepEqual([r.dropped, r.open, r.unanchored], [['R5'], ['R7'], []]);
  assert.deepEqual(r.byHand, [{ text: 'R9 Written by hand, no metadata line', slice: '01-customers' }]);
  assert.deepEqual(r.requirements.find(q => q.id === 'R2').tests.length, 3);
  const text = format(r);
  assert.equal(text.split('\n').pop(), '4 requirements, 3 tested, 1 missing; 1 unknown tag');
  assert.match(text, /^ {2}R1 {2}A customer sees only its own invoices {2}\(01-customers; only a skipped test cites it: invoices\.spec\.ts:3\)$/m);
  assert.match(text, /^ {2}\[R8\] {2}invoices\.spec\.ts:18/m);
  assert.match(text, /written by hand, not counted .*R9 Written by hand/);
});

test('every requirement cited and no unknown tag: 0 missing, exit 0; a tag citing a dropped requirement or an open question is not unknown', () => {
  const r = coverage(plan, testsFromList(greenList()));
  assert.equal(r.ok, true);
  assert.equal(format(r).split('\n').pop(), '4 requirements, 4 tested, 0 missing');
  const extra = [{ file: 'x.spec.ts', line: 1, title: '[R5][R7] seed and currency', tags: ['R5', 'R7'], counts: true }];
  assert.equal(coverage(plan, [...testsFromList(greenList()), ...extra]).ok, true);
});

test('a tag naming a hand-written heading is unknown: only what mxcli wrote is a requirement', () => {
  const t = [...testsFromList(greenList()), { file: 'x.spec.ts', line: 2, title: '[R9] by hand', tags: ['R9'], counts: true }];
  const r = coverage(plan, t);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown.map(u => u.id), ['R9']);
});

test('an empty ledger is not "0 missing": no plan, or only hand-written headings, fails', () => {
  const none = coverage([], tests);
  assert.equal(none.ok, false);
  assert.equal(none.empty, true);
  assert.match(format(none), /^no numbered requirement in docs\/brain\/plan\/: record them first \(skill requirements-interview\)/);
  // the hint: promote after the person agreed in the chat; in mx-codr's panel (MXCODR_PANEL=1) the person saves them
  assert.match(format(none, { panel: false }), /--json`, then `\.\/mxcli brain promote <id> -p <app>\.mpr`/);
  assert.match(format(none, { panel: true }), /--json`, then the person saves them in mx-codr's panel \(they count from then on; never promote them yourself\)/);
  assert.doesNotMatch(format(none, { panel: true }), /brain promote/);
  const hand = entriesFrom('# Slice: 01-x\n\n## R1 Typed by hand\n\nno mxcli line\n', '01-x');
  const r = coverage(hand, tests);
  assert.equal(r.ok, false);
  assert.match(format(r), /1 heading\(s\) there were written by hand and are not counted/);
  assert.deepEqual(readPlan(fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-cov-'))), []);
  // only dropped requirements: nothing left to test is still an empty ledger
  assert.equal(coverage(entriesFrom(`## R1 x (dropped: gone)\n\n${meta()}\n`, '01-x'), []).ok, false);
});

test('a number used twice and a requirement without a number fail', () => {
  const e = [...entriesFrom(`## R1 first\n\n${meta('aaa111')}\n\n## Orders are approved\n\n${meta('bbb222')}\n`, '01-a'), ...entriesFrom(`## R1 again\n\n${meta('ccc333')}\n`, '02-b')];
  const t = [{ file: 'a.spec.ts', line: 1, title: '[R1] x', tags: ['R1'], counts: true }];
  const r = coverage(e, t);
  assert.equal(r.ok, false);
  assert.deepEqual(r.duplicates, ['R1']);
  assert.deepEqual(r.unnumbered, [{ text: 'Orders are approved', slice: '01-a' }]);
  assert.equal(format(r).split('\n').pop(), '1 requirements, 1 tested, 0 missing; 1 used twice, 1 without a number');
});

test('a requirement anchored at nothing is information only: listed as unanchored, never a failure', () => {
  const e = entriesFrom(`## R1 anchored\n\n${meta('aaa111')}\n\n## R2 not anchored\n\nAnchors: none · id \`bbb222\` · 2026-11-04\n`, '01-a');
  const t = [{ file: 'a.spec.ts', line: 1, title: '[R1][R2] both', tags: ['R1', 'R2'], counts: true }];
  const r = coverage(e, t);
  assert.equal(r.ok, true);
  assert.deepEqual(r.unanchored, ['R2']);
  assert.match(format(r), /unanchored, so `\.\/mxcli brain plan` cannot count them as built: R2/);
});

// ---- the script as the agent runs it: an app folder with tests/coverage.mjs, a config and a stand-in for
// @playwright/test's cli that prints a list (the real one is proven by the fixture above)
function app({ listJson = list, plan: withPlan = true, playwright = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-cov-app-'));
  if (withPlan) fs.cpSync(path.join(fixtureApp, 'docs'), path.join(d, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(d, 'tests'));
  fs.copyFileSync(template, path.join(d, 'tests', 'coverage.mjs'));
  fs.writeFileSync(path.join(d, 'tests', 'playwright.config.ts'), 'export default {};\n');
  if (playwright) {
    const pw = path.join(d, 'tests', 'node_modules', '@playwright', 'test');
    fs.mkdirSync(pw, { recursive: true });
    fs.writeFileSync(path.join(pw, 'package.json'), '{"name":"@playwright/test","version":"1.64.1"}\n');
    fs.writeFileSync(path.join(pw, 'list.json'), JSON.stringify(listJson));
    fs.writeFileSync(path.join(pw, 'cli.js'), "if (!process.argv.includes('--list')) process.exit(9);\nprocess.stdout.write(require('fs').readFileSync(__dirname + '/list.json', 'utf8'));\nprocess.exitCode = JSON.parse(require('fs').readFileSync(__dirname + '/list.json', 'utf8')).errors?.length ? 1 : 0;\n");
  }
  return d;
}
const run = (d, ...args) => spawnSync(process.execPath, ['tests/coverage.mjs', ...args], { cwd: d, encoding: 'utf8' });

test('exit codes: 1 on the fixture, 0 when every requirement is cited, 1 with no plan, 2 when the tests cannot be listed', () => {
  const r1 = run(app());
  assert.equal(r1.status, 1);
  assert.equal(r1.stdout.trim().split('\n').pop(), '4 requirements, 3 tested, 1 missing; 1 unknown tag');
  const r0 = run(app({ listJson: greenList() }));
  assert.equal(r0.status, 0, r0.stderr);
  assert.equal(r0.stdout.trim().split('\n').pop(), '4 requirements, 4 tested, 0 missing');
  assert.equal(run(app({ plan: false, listJson: greenList() })).status, 1);
  const broken = run(app({ listJson: { config: {}, suites: [], errors: [{ message: 'SyntaxError: orders.spec.ts: Unterminated string constant. (1:5)' }] } }));
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /could not list the tests[\s\S]*Unterminated string constant/);
  const noPw = run(app({ playwright: false }));
  assert.equal(noPw.status, 2);
  assert.match(noPw.stderr, /@playwright\/test is not installed next to playwright\.config\.ts; run npm install in tests first/);
  assert.equal(run(app(), '--verbose').status, 2);
});

test('--json: the same result as an object, the same exit code', () => {
  const r = run(app(), '--json');
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.deepEqual([j.ok, j.total, j.tested, j.missing.map(m => m.id), j.unknown.map(u => u.id)], [false, 4, 3, ['R1'], ['R8']]);
  assert.deepEqual(j.requirements.map(q => [q.id, q.tests.length]), [['R1', 0], ['R2', 3], ['R3', 1], ['R4', 1], ['R5', 0]]);
  assert.equal(JSON.parse(run(app({ listJson: greenList() }), '--json').stdout).ok, true);
});
