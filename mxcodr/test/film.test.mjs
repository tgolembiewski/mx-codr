// tests/film.mjs (overlay/templates/film.mjs): the pure parts of the film recorder. The recording itself (Playwright,
// a running app) is proven by the smoke run on a real app, not here. fixtures/film-list.json is the output of
// `npx playwright test --list --reporter=json` on b2b-full so7 (2026-11-02), trimmed to three files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseArgs, testsFromList, needsBrowser, pick, slug, grepFor, filmConfigText, wrapperText, collectResults, DEFAULT_PACE } from '../overlay/templates/film.mjs';

const list = JSON.parse(fs.readFileSync(new URL('./fixtures/film-list.json', import.meta.url), 'utf8'));
const tests = testsFromList(list);

test('arguments: --list, a number or words, --pace before or after, --all/--status/--stop alone; anything else is refused', () => {
  assert.deepEqual(parseArgs([]), { cmd: 'help', pace: DEFAULT_PACE });
  assert.equal(DEFAULT_PACE, 1000);
  assert.deepEqual(parseArgs(['--list']), { cmd: 'list', pace: 1000 });
  assert.deepEqual(parseArgs(['7']), { cmd: 'one', pace: 1000, query: '7' });
  assert.deepEqual(parseArgs(['order', 'approval']), { cmd: 'one', pace: 1000, query: 'order approval' });
  assert.deepEqual(parseArgs(['--pace', '1500', 'orders.spec.ts:57']), { cmd: 'one', pace: 1500, query: 'orders.spec.ts:57' });
  assert.deepEqual(parseArgs(['7', '--pace', '0']), { cmd: 'one', pace: 0, query: '7' });
  assert.deepEqual(parseArgs(['--all', '--pace', '800']), { cmd: 'all', pace: 800 });
  for (const c of ['status', 'stop']) assert.equal(parseArgs([`--${c}`]).cmd, c);
  assert.match(parseArgs(['--pace', 'fast', '7']).error, /--pace takes milliseconds/);
  assert.match(parseArgs(['--pace']).error, /--pace takes milliseconds/);
  assert.match(parseArgs(['--all', 'orders']).error, /--all takes nothing after it/);
  assert.match(parseArgs(['--video', '7']).error, /unknown option --video/);
});

test('the list: every test in order, numbered, with its file, line and describe path (a describe in a loop keeps both)', () => {
  assert.deepEqual(tests.map(t => [t.n, t.file, t.line]), [
    [1, 'orders.spec.ts', 11], [2, 'orders.spec.ts', 33], [3, 'orders.spec.ts', 48], [4, 'orders.spec.ts', 57],
    [5, 'roles.spec.ts', 16], [6, 'roles.spec.ts', 16], [7, 'startup.spec.ts', 7]]);
  assert.deepEqual(tests[4].describes, ['role admin']);
  assert.equal(tests[5].full, 'role manager › home page, signed-in bar and menu');
  assert.deepEqual(tests[0].describes, [], 'the file suite is not a describe');
});

test('a test whose function takes no page, context or browser has nothing to film', () => {
  assert.equal(needsBrowser("test('a', async ({ page }) => {\n", 1), true);
  assert.equal(needsBrowser("test('a', async () => {\n", 1), false);
  assert.equal(needsBrowser("test('a', async ({ request }) => {\n", 1), false);
  assert.equal(needsBrowser("x\ntest('a long title',\n  async ({ browser }) => {\n", 2), true, 'the parameters on the next line');
  assert.equal(needsBrowser("test('a', async function ({ context }) {\n", 1), true);
  assert.equal(needsBrowser('', 3), true, 'unread source: assume a browser');
});

test('picking one: by number, by file:line, by words of the title; several matches name the candidates by number', () => {
  assert.equal(pick(tests, '4').tests[0].title.slice(0, 9), 'approval:');
  assert.match(pick(tests, '40').error, /no test number 40; there are 7/);
  assert.equal(pick(tests, 'orders.spec.ts:57').tests[0].n, 4);
  assert.equal(pick(tests, 'tests/orders.spec.ts:48').tests[0].n, 3);
  assert.equal(pick(tests, 'Approval Manager').tests[0].n, 4, 'words in any order, any case');
  assert.equal(pick(tests, 'role admin').tests[0].n, 5);
  const many = pick(tests, 'home page');
  assert.match(many.error, /2 tests match "home page"; name one by its number:/);
  assert.match(many.error, /  5\. role admin › home page, signed-in bar and menu  \(roles\.spec\.ts:16\)/);
  assert.match(pick(tests, 'roles.spec.ts:16').error, /2 tests match/);
  assert.match(pick(tests, 'invoice email').error, /no test matches "invoice email"/);
});

test('the film\'s file name comes from the title; grep selects exactly that test', () => {
  assert.equal(slug(tests[3]), 'approval-above-50-000-gross-needs-a-manager-confirm-disabled-until-approved');
  assert.equal(slug(tests[4]), 'role-admin-home-page-signed-in-bar-and-menu');
  assert.equal(slug({ n: 3, full: '!!!' }), 'test-3');
  const re = new RegExp(grepFor(tests[1]));
  assert.ok(re.test('  orders.spec.ts credit rule: an order above the available credit is refused with the calculated amount'));
  assert.ok(!re.test('  orders.spec.ts quantity check: zero is refused, above stock warns'));
  const plus = new RegExp(grepFor(tests[0]));
  assert.ok(plus.test('orders.spec.ts order creation: lines, +1 on a repeated product, live totals, numbering, first history entry'), '+ is escaped');
  const admin = new RegExp(grepFor(tests[4]));
  assert.ok(admin.test('roles.spec.ts role admin home page, signed-in bar and menu'));
  assert.ok(!admin.test('roles.spec.ts role manager home page, signed-in bar and menu'));
});

test('the film config spreads the app\'s config and adds only the video: pointer, pacing, no typed captions, the title', () => {
  const cfg = filmConfigText({ baseImport: './playwright.config', wrapDir: '/a/tests/.film', outputDir: '/a/.mxcli/films/.work/out', jsonFile: '/a/.mxcli/films/.work/r.json', grep: 'x$', pace: 1200 });
  assert.match(cfg, /^import base from "\.\/playwright\.config";$/m);
  assert.match(cfg, /\.\.\.base,/);
  assert.match(cfg, /use: \{ \.\.\.base\.use, video \}/);
  assert.match(cfg, /mode: 'on' as const/);
  assert.match(cfg, /actions: \{ duration: 1200, cursor: 'pointer', style: \{ title: 'display: none' \} \}/);
  assert.match(cfg, /test: \{ level: 'title', position: 'bottom' \}/);
  assert.match(cfg, /timeout: \(base\.timeout \|\| 30_000\) \* 10/);
  assert.match(cfg, /workers: 1,/);
  assert.match(cfg, /projects: base\.projects && base\.projects\.map/);
  assert.doesNotMatch(filmConfigText({ baseImport: './p', wrapDir: 'w', outputDir: 'o', jsonFile: 'j', grep: 'g', pace: 0 }), /actions:/, 'pace 0: the test\'s own speed');
  const w = wrapperText('../orders.spec', 1000);
  assert.match(w, /page\.screencast\.showChapter\(testInfo\.title, \{ description: testInfo\.titlePath\.slice\(0, -1\)\.join\(' › '\), duration: 3000 \}\)/);
  assert.match(w, /^import "\.\.\/orders\.spec";$/m);
  assert.ok(w.indexOf('beforeEach') < w.indexOf('import "../orders.spec"'), 'the hook is registered before the spec\'s tests');
  assert.match(w, /test\.afterEach\(async \(\{ page \}\) => \{ await page\.waitForTimeout\(2000\); \}\);/, 'the last screen is held');
  assert.doesNotMatch(wrapperText('../orders.spec', 0), /afterEach/, 'pace 0: no hold');
});

test('the kit\'s own config records nothing and is not slowed: only film.mjs films', () => {
  const kit = fs.readFileSync(new URL('../overlay/templates/tests/playwright.config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(kit, /video|slowMo|launchOptions|screencast/);
  const film = fs.readFileSync(new URL('../overlay/templates/film.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(film, /writeFileSync\([^)]*playwright\.config/, 'film.mjs never writes the app\'s config');
});

test('the film run\'s JSON report gives each test\'s status and video', () => {
  const report = { suites: [{ specs: [], suites: [{ specs: [{ title: 'a', tests: [{ results: [{ status: 'failed', attachments: [{ name: 'trace', path: '/t' }, { name: 'video', path: '/v.webm' }] }] }] }] }] }] };
  assert.deepEqual(collectResults(report), [{ title: 'a', status: 'failed', video: '/v.webm' }]);
  assert.deepEqual(collectResults({ suites: [{ specs: [{ title: 'b', tests: [{ results: [{ status: 'passed', attachments: [] }] }] }] }] }), [{ title: 'b', status: 'passed', video: undefined }]);
});
