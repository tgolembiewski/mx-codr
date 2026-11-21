// tests/film.mjs (overlay/templates/film.mjs): the pure parts of the film recorder (the plan that slows the raw video
// afterwards included), the slowing itself on a synthetic video (skipped without ffmpeg), and the marks and the short
// hold at a test's end in a real Playwright run (without a video; skipped without the pinned Playwright). The
// recording itself (a running app) is proven by the smoke run on a real app, not here. fixtures/film-list.json is the output of
// `npx playwright test --list --reporter=json` on b2b-full so7 (2026-11-02), trimmed to three files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs, testsFromList, needsBrowser, pick, slug, grepFor, grepForAll, filmConfigText, wrapperText, collectResults, DEFAULT_PACE, MIN_HOLD_MS, holdMs,
  LIVE_PACE, LIVE_HOLD_MS, HOLD_PICK_S, CARD_MS, CARD_LIVE_MS, MID_HOLD_MS, livePace, videoText, TIMELINE_REPORTER, timelineOf, filmPlan, filmSecond, filmTime, filterText, ffmpegArgs, makeFilm, isTest, LAG_S } from '../overlay/templates/film.mjs';

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

test('the film config spreads the app\'s config and adds only the video (pointer, a frame round the element, the short live pace, no typed captions, the title) and the timeline reporter', () => {
  const cfg = filmConfigText({ baseImport: './playwright.config', wrapDir: '/a/tests/.film', outputDir: '/a/.mxcli/films/.work/out', timelineReporter: '/a/.mxcli/films/.work/film-timeline.cjs', timelineFile: '/a/.mxcli/films/.work/timeline.jsonl', grep: 'x$', pace: 1200 });
  assert.match(cfg, /^import base from "\.\/playwright\.config";$/m);
  assert.match(cfg, /\.\.\.base,/);
  assert.match(cfg, /use: \{ \.\.\.base\.use, video \}/);
  assert.match(cfg, /mode: 'on' as const/);
  assert.equal(LIVE_PACE, 150);
  assert.match(cfg, /actions: \{ duration: 150, cursor: 'pointer', style: \{ title: 'display: none', highlight: "outline: 3px solid [^"]*animation: none" \} \}/, 'recorded at the short live pace, whatever --pace');
  assert.equal(livePace(100), 100, 'a pace below it records at that pace');
  assert.equal(livePace(0), 0);
  assert.match(cfg, /test: \{ level: 'title', position: 'bottom' \}/);
  assert.match(cfg, /timeout: \(base\.timeout \|\| 30_000\) \* 3/);
  assert.match(cfg, /workers: 1,/);
  assert.match(cfg, /fullyParallel: false,/);
  assert.match(cfg, /reporter: \[\['list'\], \["\/a\/\.mxcli\/films\/\.work\/film-timeline\.cjs", \{ out: "\/a\/\.mxcli\/films\/\.work\/timeline\.jsonl" \}\]\]/);
  assert.match(cfg, /projects: base\.projects && base\.projects\.map/);
  assert.match(cfg, new RegExp(`const video = ${videoText(1200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`), 'the text films.mjs takes too');
  assert.doesNotMatch(filmConfigText({ baseImport: './p', wrapDir: 'w', outputDir: 'o', timelineReporter: 'r', timelineFile: 't', grep: 'g', pace: 0 }), /actions:/, 'pace 0: the test\'s own speed');
  const w = wrapperText('../orders.spec', 1000, '/a/.mxcli/films/.work/marks.jsonl');
  assert.match(w, new RegExp(`page\\.screencast\\.showChapter\\(testInfo\\.title, \\{ description: testInfo\\.titlePath\\.slice\\(0, -1\\)\\.join\\(' › '\\), duration: ${CARD_LIVE_MS} \\}\\)`));
  assert.match(w, /^import "\.\.\/orders\.spec";$/m);
  assert.ok(w.indexOf('beforeEach') < w.indexOf('import "../orders.spec"'), 'the hook is registered before the spec\'s tests');
  assert.match(w, /^import \{ test \} from '@playwright\/test';$/m, 'the line the pane\'s films.mjs rewrites, byte for byte');
  assert.match(w, /^process\.env\.MXCODR_FILM_HOLD_MS = '400';$/m, 'the kit\'s signOut holds as long: briefly');
  assert.match(w, /testInfo\._onDidFinishTestFunctionCallbacks;\n  if \(atEnd && typeof atEnd\.add === 'function'\) atEnd\.add\(\(\) => end\(page, testInfo\)\);/, 'marked and held right after the test function, before any afterEach');
  assert.match(w, /setTimeout\(resolve, 400\)/);
  assert.match(w, /appendFileSync\("\/a\/\.mxcli\/films\/\.work\/marks\.jsonl", JSON\.stringify\(\{ id: testInfo\.testId, k, at: Date\.now\(\), \.\.\.extra \}\)/, 'marks: the test, what, when');
  assert.match(w, /mark\(testInfo, 'card'\);\n  await page\.screencast\.showChapter/);
  assert.match(w, /frame === page\.mainFrame\(\) && frame\.url\(\) === 'about:blank'\) mark\(testInfo, 'blank'\)/, 'every sign-out (the kit leaves for about:blank)');
  assert.match(w, /mark\(testInfo, 'end', \{ blank: page\.isClosed\(\) \|\| page\.url\(\) === 'about:blank' \}\);/);
  assert.match(w, /test\.afterEach\(async \(\{ page \}, testInfo\) => \{ await end\(page, testInfo\); \}\);/, 'the fallback');
  assert.match(w, /if \(held\.has\(page\) \|\| page\.isClosed\(\) \|\| page\.url\(\) === 'about:blank'\) return;/, 'held once, never a blank page');
  assert.doesNotMatch(w, /waitForTimeout/, 'a plain timer: no step in the report or the trace');
  assert.equal(MIN_HOLD_MS, 5000);
  assert.equal(holdMs(0), 5000, 'pace 0 holds too: at least 5 s on every film');
  assert.equal(holdMs(1000), 5000);
  assert.equal(holdMs(4000), 8000, 'two actions\' time at a slow pace');
});

test('grep for several tests: any of their title paths, each to its end', () => {
  const re = new RegExp(grepForAll([tests[4], tests[1]]));
  assert.ok(re.test('roles.spec.ts role admin home page, signed-in bar and menu'));
  assert.ok(re.test('  orders.spec.ts credit rule: an order above the available credit is refused with the calculated amount'));
  assert.ok(!re.test('roles.spec.ts role manager home page, signed-in bar and menu'));
  assert.equal(grepForAll([tests[1]]), grepFor(tests[1]));
});

test('a reporter title path belongs to the list entry with the same file, describes and title (the same title in two describes is two tests)', () => {
  const t = tests[4];
  assert.ok(isTest(t, ['', '', 'roles.spec.ts', 'role admin', 'home page, signed-in bar and menu']));
  assert.ok(isTest(t, ['', 'chromium', 'roles.spec.ts', 'role admin', 'home page, signed-in bar and menu']));
  assert.ok(!isTest(t, ['', '', 'roles.spec.ts', 'role manager', 'home page, signed-in bar and menu']));
  assert.ok(!isTest(t, ['', '', 'other.spec.ts', 'role admin', 'home page, signed-in bar and menu']));
  assert.ok(isTest({ file: 'sub/a.spec.ts', describes: [], title: 'x' }, ['', '', 'sub\\a.spec.ts', 'x']), 'a Windows path');
});

// A test's timeline in wall-clock ms: the page made at 10 000 (the video's zero), the card at 10 100, actions, the end.
const T = { zero: 10_000, card: 10_100, actions: [{ start: 11_000, end: 11_300 }, { start: 13_000, end: 13_260 }, { start: 13_270, end: 13_530 }], end: { at: 20_000, blank: false }, blanks: [21_000], close: 21_500 };
const v = ms => (ms - T.zero) / 1000 + LAG_S;

test('the timeline: the video\'s zero from "Create page", the calls that act on an element, the wrapper\'s marks', () => {
  const lines = [
    { k: 'begin', id: 'a', path: ['', '', 'x.spec.ts', 't'], at: 9_900 },
    { k: 'step', id: 'a', cat: 'fixture', title: 'Fixture "context"', start: 9_950, ms: 10 },
    { k: 'step', id: 'a', cat: 'pw:api', title: 'Create page', start: 10_000, ms: 20 },
    { k: 'step', id: 'a', cat: 'pw:api', title: 'Navigate to "/"', start: 10_900, ms: 50 },
    { k: 'step', id: 'a', cat: 'pw:api', title: 'Click', start: 11_000, ms: 300 },
    { k: 'step', id: 'a', cat: 'pw:api', title: 'Fill "x"', start: 13_000, ms: 260 },
    { k: 'step', id: 'a', cat: 'expect', title: 'Expect "toBeVisible"', start: 13_300, ms: 100 },
    { k: 'step', id: 'b', cat: 'pw:api', title: 'Click', start: 1, ms: 1 },
    { k: 'step', id: 'a', cat: 'pw:api', title: 'Close context', start: 21_500, ms: 10 },
  ];
  const marks = [{ id: 'a', k: 'card', at: 10_100 }, { id: 'a', k: 'end', at: 20_000, blank: false }, { id: 'a', k: 'blank', at: 21_000 }, { id: 'b', k: 'card', at: 5 }];
  const tl = timelineOf(lines, marks, 'a');
  assert.equal(tl.zero, 10_000);
  assert.deepEqual(tl.actions.map(a => [a.start, a.end]), [[11_000, 11_300], [13_000, 13_260]], 'clicks and fills, not navigations or expects');
  assert.equal(tl.card, 10_100);
  assert.deepEqual(tl.end, { at: 20_000, blank: false });
  assert.deepEqual(tl.blanks, [21_000]);
  assert.equal(tl.close, 21_500);
  assert.equal(timelineOf(lines.filter(l => l.title !== 'Create page'), marks, 'a').zero, 9_950, 'else the context');
});

test('the plan: blank start cut, the card held, each action at least --pace in slow motion, long waits faster, the end held at least 5 s', () => {
  const plan = filmPlan(T, { pace: 1000 });
  const p = plan.pieces;
  assert.ok(p.every((x, i) => x.b >= x.a && (i === 0 || x.a >= p[i - 1].b - 1e-9)), 'in order, not overlapping');
  assert.deepEqual(p[0], { a: 0, b: v(10_100), out: 0 }, 'the blank page before the card: cut');
  assert.equal(p[2].a, p[2].b);
  assert.equal(p[2].out, CARD_MS / 1000, 'the card\'s full frame held');
  // the first action: from its annotation's start (end - live pace - 80 ms, not before the call) to 100 ms after it, 1 s
  const act = p.find(x => Math.abs(x.a - Math.max(v(11_300) - LIVE_PACE / 1000 - 0.08, v(11_000))) < 1e-9);
  assert.ok(act && Math.abs(act.b - (v(11_300) + 0.1)) < 1e-9 && act.out === 1);
  // two actions 10 ms apart: the second one's window starts where the first one's ends, still 1 s each
  const close = p.filter(x => x.a >= v(12_900) && x.b <= v(13_700) && x.b > x.a && x.out >= 1);
  assert.equal(close.length, 2);
  // the wait 13.63 .. 20.3: 1.5 s at its own speed, the rest 3 times faster
  const wait = p.find(x => x.a > v(13_500) && x.b > v(19_000));
  assert.ok(Math.abs(wait.out - (1.5 + (wait.b - wait.a - 1.5) / 3)) < 1e-9);
  // the end: the last frame of the short hold at the test's end, held 5 s, nothing after it
  const last = p.at(-1);
  assert.equal(last.a, last.b);
  assert.ok(Math.abs(last.a - (v(20_000) + LIVE_HOLD_MS / 1000 - HOLD_PICK_S)) < 1e-9, 'a frame late in the short hold');
  assert.equal(last.out, MIN_HOLD_MS / 1000);
  assert.equal(plan.cut, last.a);
  assert.ok(Math.abs(plan.total - p.reduce((s, x) => s + x.out, 0)) < 0.001);
  // film seconds: monotone, the card first, the end hold last
  let prev = -1;
  for (let t = 0; t <= plan.cut + 1; t += 0.01) { const f = filmSecond(plan, t); assert.ok(f >= prev - 1e-9); prev = f; }
  assert.ok(filmTime(plan, T, 11_000) > CARD_MS / 1000, 'the first action after the card');
  assert.equal(filmSecond(plan, plan.cut + 5), plan.total);
  assert.ok(plan.total - filmSecond(plan, plan.cut - 1e-6) >= 5 - 1e-3, 'the end screen at least 5 s (the total in ms)');
});

test('the plan\'s end: a test that signed out itself ends on the screen before it; a sign-out inside the test is held; pace 0 slows nothing', () => {
  const self = filmPlan({ ...T, end: { at: 20_000, blank: true }, blanks: [15_000, 19_000] }, { pace: 1000 });
  assert.ok(Math.abs(self.cut - (v(19_000) - HOLD_PICK_S)) < 1e-9, 'the screen before its last sign-out');
  const mid = self.pieces.find(x => x.a === x.b && Math.abs(x.a - (v(15_000) - HOLD_PICK_S)) < 1e-9);
  assert.equal(mid.out, MID_HOLD_MS / 1000, 'the first user\'s last screen held before the second signs in');
  const zero = filmPlan(T, { pace: 0 });
  assert.ok(zero.pieces.every(x => x.a === x.b || x.out === 0 || Math.abs(x.out - (x.b - x.a)) < 1e-9), 'every piece at its own speed');
  assert.equal(zero.pieces.at(-1).out, 5);
  const none = filmPlan(null, { pace: 1000, rawEnd: 7 });
  assert.deepEqual(none.pieces, [{ a: 0, b: 7, out: 7 }, { a: 7, b: 7, out: 5 }], 'no timeline: as recorded, its last frame held');
  const noEnd = filmPlan({ ...T, end: null, blanks: [] }, { pace: 1000 });
  assert.ok(Math.abs(noEnd.cut - (v(21_500) - 0.1)) < 1e-9, 'no end mark: before the context closed');
});

test('ffmpeg\'s filter and arguments: one term per piece, the film\'s frame rate, cut at the plan\'s length; a long filter in a file', () => {
  const plan = { pieces: [{ a: 0, b: 1, out: 0 }, { a: 1, b: 2, out: 1 }, { a: 2, b: 2, out: 3 }, { a: 2, b: 2.5, out: 2 }], total: 6, cut: 2.5 };
  assert.equal(filterText(plan), "setpts='(1*clip((T-1)/1,0,1)+3*gte(T,2)+2*clip((T-2)/0.5,0,1))/TB',fps=25,tpad=stop_mode=clone:stop_duration=6,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
  const a = ffmpegArgs('r.webm', 'f.mp4', plan);
  assert.deepEqual(a.slice(a.indexOf('-t'), a.indexOf('-t') + 2), ['-t', '6']);
  assert.equal(a[a.indexOf('-vf') + 1], filterText(plan));
  assert.equal(a.at(-1), 'f.mp4');
  assert.deepEqual(ffmpegArgs('r', 'f', plan, { filterFile: 'x.txt' }).slice(5, 7), ['-/vf', 'x.txt']);
  assert.deepEqual(ffmpegArgs('r', 'f', plan, { filterFile: 'x.txt', form: 'script' }).slice(5, 7), ['-filter_script:v', 'x.txt']);
});

// The slowing on a real video: 2 s red, 2 s green, 2 s blue (25 fps webm). The plan holds the red frame 3 s at 1.0,
// plays 2.0 .. 2.5 (green) in 2 s and cuts at 4.5 with the last (green) frame held 5 s.
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
test('the slowing on a real video: held frames and slow motion where the plan says, the film as long as the plan', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-slow-'));
  try {
    const raw = path.join(dir, 'raw.webm');
    const src = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=green:s=64x48:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=25:d=2',
      '-filter_complex', '[0][1][2]concat=n=3:v=1', '-c:v', 'libvpx', '-b:v', '200k', raw]);
    assert.equal(src.status, 0, String(src.stderr));
    const tl = { zero: 0, card: null, actions: [], end: { at: 4500 - LIVE_HOLD_MS + 100, blank: false }, blanks: [], close: null };
    // hand-made plan through the same functions the film uses: freeze at 1.0 (3 s), 1..2 own speed, 2..2.5 in 2 s
    const plan = { pieces: [{ a: 0, b: 1, out: 1 }, { a: 1, b: 1, out: 3 }, { a: 1, b: 2, out: 1 }, { a: 2, b: 2.5, out: 2 }, { a: 2.5, b: 4.5, out: 2 }, { a: 4.5, b: 4.5, out: 5 }], cut: 4.5, total: 14 };
    const out = path.join(dir, 'f.mp4');
    const r = spawnSync('ffmpeg', ffmpegArgs(raw, out, plan));
    assert.equal(r.status, 0, String(r.stderr));
    const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(dur - plan.total) < 0.1, `the film is ${dur} s, the plan ${plan.total}`);
    const px = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }).stdout;
    const runs = [];
    for (let i = 0; i + 2 < px.length; i += 3) { const c = px[i] > 150 ? 'R' : px[i + 1] > 100 ? 'G' : 'B'; if (runs.at(-1)?.c === c) runs.at(-1).n++; else runs.push({ c, n: 1 }); }
    assert.deepEqual(runs.map(x => x.c), ['R', 'G', 'B'], JSON.stringify(runs));
    assert.ok(Math.abs(runs[0].n / 25 - 5) < 0.1, `red: 1 s, held 3 s, 1 s more: ${runs[0].n / 25}`);
    assert.ok(Math.abs(runs[1].n / 25 - 3.5) < 0.1, `green: 0.5 s in 2 s, 1.5 s more at its own speed: ${runs[1].n / 25}`);
    assert.ok(Math.abs(runs[2].n / 25 - 5.5) < 0.1, `blue: 0.5 s, then held 5 s: ${runs[2].n / 25}`);
    // the film's seconds: where filmSecond says each colour starts
    assert.ok(Math.abs(filmSecond(plan, 2) - 5) < 0.05 && Math.abs(filmSecond(plan, 4) - 8.5) < 0.05);
    // makeFilm: the raw video goes, the .mp4 stays; without ffmpeg the raw recording stays as the .webm
    fs.copyFileSync(raw, path.join(dir, 'raw2.webm'));
    const made = await makeFilm({ raw, out: path.join(dir, 'x.mp4'), tl, pace: 1000, ffmpeg: 'ffmpeg', work: dir });
    assert.ok(made.slowed && made.file.endsWith('x.mp4') && fs.existsSync(made.file) && !fs.existsSync(raw));
    const plain = await makeFilm({ raw: path.join(dir, 'raw2.webm'), out: path.join(dir, 'y.mp4'), tl, pace: 1000, ffmpeg: null, work: dir });
    assert.deepEqual([plain.slowed, path.basename(plain.file)], [false, 'y.webm']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the kit\'s signOut and the wrapper share the held pages and the variable (the kit is unchanged: only the value is shorter)', () => {
  const impl = fs.readFileSync(new URL('../overlay/templates/tests/mx-impl.ts', import.meta.url), 'utf8');
  assert.match(impl, /Symbol\.for\('mxcodr\.film\.held'\)/);
  assert.match(wrapperText('x', 0, 'm'), /Symbol\.for\('mxcodr\.film\.held'\)/);
  assert.match(impl, /process\.env\.MXCODR_FILM_HOLD_MS/);
  assert.match(impl, /await filmHold\(page\);\n  await page\.goto\('about:blank'\);/, 'held before signOut leaves the screen');
});

// The pinned Playwright (the extension's payload copy, or MXCODR_TEST_PW): its worker awaits the callbacks the
// wrapper adds to after the test function and before the afterEach hooks (internal; a pin bump that drops it fails here).
const PW = process.env.MXCODR_TEST_PW || fileURLToPath(new URL('../../spikes/studio-pro-ext/setup/playwright/node_modules', import.meta.url));
const hasPw = fs.existsSync(path.join(PW, '@playwright/test/cli.js'));
const hasBrowser = (() => { try { return hasPw && fs.existsSync(createRequire(path.join(PW, 'x.js'))('playwright-core').chromium.executablePath()); } catch { return false; } })();

test('the pinned Playwright awaits the end-of-test callbacks before the afterEach hooks', { skip: !hasPw && 'no Playwright at ' + PW }, () => {
  const worker = fs.readFileSync(path.join(PW, 'playwright/lib/worker/workerProcessEntry.js'), 'utf8');
  assert.match(worker, /for \(const cb of this\._onDidFinishTestFunctionCallbacks\)\s+await cb\(\);/);
  const finish = worker.indexOf('testInfo._didFinishTestFunction())');
  const after = worker.indexOf('_runEachHooksForSuites(reversedSuites, "afterEach"', finish);
  assert.ok(finish > 0 && after > finish, 'the callbacks run before the afterEach hooks');
});

test('a filmed test is marked at its end and holds its last screen briefly before a describe-level afterEach leaves it, passed and failed', { skip: !hasBrowser && 'needs the pinned Playwright and its Chromium', timeout: 120_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-hold-'));
  try {
    fs.mkdirSync(path.join(dir, '.film'));
    fs.symlinkSync(PW, path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : undefined);
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "private": true }\n');
    fs.writeFileSync(path.join(dir, 'h.spec.ts'), `import { test, expect } from '@playwright/test';
test.afterEach(async ({ page }) => { console.log('FILELEVEL ' + Date.now()); });
test.describe('hold', () => {
  test.afterEach(async ({ page }) => { console.log('SIGNOUT ' + Date.now()); await page.goto('about:blank'); });
  test('passes', async ({ page }) => { await page.goto('data:text/html,<p>done</p>'); console.log('END ' + Date.now()); });
  test('fails', async ({ page }) => { await page.goto('data:text/html,<p>no</p>'); console.log('END ' + Date.now()); expect(1).toBe(2); });
});
`);
    const marks = path.join(dir, 'marks.jsonl');
    fs.writeFileSync(path.join(dir, '.film', 'h.spec.ts'), wrapperText('../h.spec', 0, marks));
    fs.writeFileSync(path.join(dir, 'c.config.ts'), "export default { testDir: './.film', testMatch: '**/*', workers: 1, reporter: 'list', use: { headless: true } };\n");
    const r = spawnSync(process.execPath, [path.join(PW, '@playwright/test/cli.js'), 'test', '-c', 'c.config.ts'], { cwd: dir, encoding: 'utf8', timeout: 110_000 });
    const out = r.stdout + r.stderr;
    const ts = [...out.matchAll(/^(END|SIGNOUT|FILELEVEL) (\d+)$/gm)].map(m => [m[1], Number(m[2])]);
    assert.deepEqual(ts.map(t => t[0]), ['END', 'SIGNOUT', 'FILELEVEL', 'END', 'SIGNOUT', 'FILELEVEL'], out);
    for (const i of [0, 3]) assert.ok(ts[i + 1][1] - ts[i][1] >= LIVE_HOLD_MS - 50 && ts[i + 1][1] - ts[i][1] < LIVE_HOLD_MS + 1000, `held ${ts[i + 1][1] - ts[i][1]} ms before the sign-out\n${out}`);
    // the marks: per test the card, the end (before the sign-out, the page not blank) and the sign-out's about:blank
    const m = fs.readFileSync(marks, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const ids = [...new Set(m.map(x => x.id))];
    assert.equal(ids.length, 2, 'two tests');
    for (const [n, id] of ids.entries()) {
      const k = m.filter(x => x.id === id);
      assert.deepEqual(k.map(x => x.k), ['card', 'end', 'blank'], JSON.stringify(k));
      assert.equal(k[1].blank, false);
      assert.ok(Math.abs(k[1].at - ts[n * 3][1]) < 200, 'the end mark right after the test function');
      assert.ok(k[2].at >= ts[n * 3 + 1][1], 'about:blank after the sign-out began');
    }
    for (const i of [1, 4]) assert.ok(ts[i + 1][1] - ts[i][1] < 1000, 'held once: not again after the sign-out');
    assert.match(out, /1 failed/);
    assert.match(out, /1 passed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
