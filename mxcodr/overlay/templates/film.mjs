#!/usr/bin/env node
// tests/film.mjs: a video of a test's run that a person can follow. The mx-codr installer writes it on every install
// (it is the bundle's, not the app's: edits are overwritten). Run it from the app folder or tests/:
//
//   node tests/film.mjs --list                  every test, numbered, with its file and line
//   node tests/film.mjs 7                       film test 7 of the list
//   node tests/film.mjs order approval          film the one test whose title holds these words
//   node tests/film.mjs orders.spec.ts:57       film the test at that line
//   node tests/film.mjs --pace 1500 7           slower film: ms each action is on screen (default 1000; 0 = the test's own speed)
//   node tests/film.mjs --all                   every test with a browser, in the background; one film each
//   node tests/film.mjs --status | --stop       how far --all is / stop it
//
// The film lands in .mxcli/films/<title>.mp4 (with ffmpeg) or .webm (open that in Chrome or Firefox). The test
// runs unchanged and at almost its own speed: a temporary config spreads the app's Playwright config and adds only
// video recording with Playwright's own annotations (an animated pointer travels to each element and a frame marks
// it, shown LIVE_PACE ms per action; the action callouts are hidden so no typed value shows), a short title card,
// and a short hold at the end. The slowing is done afterwards, on the video (ffmpeg): each action is shown --pace ms
// in slow motion, a long wait plays faster, the title card stays 2.5 s and the screen the test ends on (passed, or
// where it failed) stays at least 5 s. `--all` films every test in ONE Playwright run (one browser, one worker),
// each test's film made while the next one records. The app's playwright.config.ts is never edited,
// so a normal `npx playwright test` records nothing and is not slowed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// --pace: how long each action is on the film, in ms (slow motion around the pointer reaching it and the click)
export const DEFAULT_PACE = 1000;
// How long the recording itself shows each action (Playwright's annotation: the pointer travels in 60% of it, at
// least 80 ms, then the action runs): the only slowing a test gets while it records. 150 ms: the pointer travels in
// 2-3 frames of the 25 fps video and the frame around the element shows in about 4, which the film then plays over
// --pace ms. Measured on a Mendix app (2026-11-21): 250 ms showed the travel better but cost 0.1 s more per action
// (143 actions: 14 s of a 20-test --all); 120 ms showed the pointer only arriving.
export const LIVE_PACE = 150;
export const livePace = pace => (pace > 0 ? Math.min(pace, LIVE_PACE) : 0);
// The title card: shown CARD_LIVE_MS while recording (Playwright fades it in over 300 ms), its full frame held on
// the film for CARD_MS.
export const CARD_LIVE_MS = 700;
export const CARD_MS = 2500;
// The screen a filmed test ends on (passed, or where it failed) stays on the film at least 5 s, and two actions' time
// at a slower pace: its last frame, held on the video. While recording it is held LIVE_HOLD_MS (the video shows a
// screen a little after the page has it), at the test's end and before any of the kit's sign-outs
// (MXCODR_FILM_HOLD_MS); a sign-out inside the test, before the next user signs in, stays MID_HOLD_MS on the film.
export const MIN_HOLD_MS = 5000;
export const holdMs = pace => Math.max(MIN_HOLD_MS, 2 * pace);
export const LIVE_HOLD_MS = 400;
export const MID_HOLD_MS = 1500;
// A wait between actions (a page loading, the server answering) plays at its own speed up to IDLE_KEEP_S, the rest
// IDLE_SPEED times faster; at --pace 0 every wait plays at its own speed.
export const IDLE_KEEP_S = 1.5;
export const IDLE_SPEED = 3;
// A run time -> the raw video's second: (ms - the start of "Create page") / 1000 + LAG_S. Negative: the recorder
// starts inside that call, so a change the page makes shows on the video 0.05-0.09 s earlier than its time from the
// call's start says (16 changes over two runs, 40 ms frames; Playwright 1.64.1, Chromium, a Mac, 2026-11-21).
export const LAG_S = -0.07;
// Where on the short live holds the film's held frame is taken: their middle, so a machine whose video runs a little
// later or earlier still holds the right screen.
export const HOLD_PICK_S = 0.2;
export const FPS = 25;
// what one test takes to film on average (the test's own time, its actions' live pace, the card and the end hold,
// the conversion overlapping the next test): for the --all estimate
export const SECONDS_PER_TEST = 6;
const USAGE = 'node tests/film.mjs --list | <number | words from the title | file.spec.ts[:line]> | --all | --status | --stop  [--pace <ms>]';

// argv -> { cmd: 'help' | 'list' | 'one' | 'all' | 'all-run' | 'status' | 'stop', pace, query } or { error }
export function parseArgs(argv) {
  const args = [...argv];
  let pace = DEFAULT_PACE;
  const at = args.indexOf('--pace');
  if (at >= 0) {
    const v = args[at + 1];
    if (!/^\d+$/.test(v || '')) return { error: '--pace takes milliseconds, e.g. --pace 1500 (0 = the test\'s own speed)' };
    pace = Number(v);
    args.splice(at, 2);
  }
  if (!args.length || ['-h', '--help'].includes(args[0])) return { cmd: 'help', pace };
  const flags = { '--list': 'list', '--all': 'all', '--all-run': 'all-run', '--status': 'status', '--stop': 'stop' };
  if (flags[args[0]]) return args.length === 1 ? { cmd: flags[args[0]], pace } : { error: `${args[0]} takes nothing after it` };
  const unknown = args.find(a => a.startsWith('--'));
  if (unknown) return { error: `unknown option ${unknown}; ${USAGE}` };
  return { cmd: 'one', pace, query: args.join(' ') };
}

// `playwright test --list --reporter=json` -> [{ n, file, line, describes, title, full }], in the list's order.
export function testsFromList(json) {
  const out = [];
  const walk = (suite, describes) => {
    for (const spec of suite.specs || []) out.push({ file: spec.file, line: spec.line, describes, title: spec.title, full: [...describes, spec.title].join(' › ') });
    for (const child of suite.suites || []) walk(child, child.title && child.title !== child.file ? [...describes, child.title] : describes);
  };
  for (const file of json.suites || []) walk(file, []);
  return out.map((t, i) => ({ n: i + 1, ...t }));
}

// True unless the test's own function takes no page, context or browser (an API or OQL test has nothing to film).
export function needsBrowser(source, line) {
  const text = source.split('\n').slice(Math.max(0, line - 1), line + 3).join(' ');
  const head = text.slice(0, text.indexOf('=>') >= 0 ? text.indexOf('=>') : undefined);
  const params = head.match(/async\s*\(([^)]*)\)\s*$/) || head.match(/function\s*\w*\s*\(([^)]*)\)\s*$/);
  if (!params) return true;
  return /\b(page|context|browser)\b/.test(params[1]);
}

// A query -> { tests } (one, or several for --all) or { error } naming the candidates.
export function pick(tests, query) {
  const q = String(query).trim();
  if (/^\d+$/.test(q)) {
    const t = tests.find(x => x.n === Number(q));
    return t ? { tests: [t] } : { error: `no test number ${q}; there are ${tests.length} (--list shows them)` };
  }
  const loc = q.match(/^(.+\.(?:spec|test)\.[cm]?[jt]s)(?::(\d+))?$/);
  let found;
  if (loc) {
    const file = loc[1].replace(/\\/g, '/').replace(/^(\.\/)?(tests\/)?/, '');
    found = tests.filter(t => (t.file === file || t.file.endsWith('/' + file)) && (!loc[2] || t.line === Number(loc[2])));
  } else {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    found = tests.filter(t => words.every(w => t.full.toLowerCase().includes(w)) || t.full.toLowerCase().includes(q.toLowerCase()));
  }
  if (found.length === 1) return { tests: found };
  if (!found.length) return { error: `no test matches "${q}" (--list shows them)` };
  return { error: `${found.length} tests match "${q}"; name one by its number:\n${found.map(line).join('\n')}` };
}

export const line = t => `${String(t.n).padStart(3)}. ${t.full}  (${t.file}:${t.line})`;

// The film's file name: the test's title, lower case, letters and digits joined by '-', at most 80 characters
// cut at a word's end.
export function slug(t) {
  let s = t.full.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 80) { s = s.slice(0, 81); s = s.slice(0, s.lastIndexOf('-') > 20 ? s.lastIndexOf('-') : 80); }
  return s || `test-${t.n}`;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Playwright matches grep against "<project> <file> <describe...> <title>": the test's own title path, to the end.
export const grepFor = t => `${[...t.describes, t.title].map(escapeRe).join(' ')}$`;
// several tests in one run: any of their title paths
export const grepForAll = tests => (tests.length === 1 ? grepFor(tests[0]) : tests.map(t => `(?:${grepFor(t)})`).join('|'));

// The video and its annotations while recording: the pointer and a frame around the element for livePace(pace) ms
// per action (no callout: no typed value shows), the test's title at the bottom.
export const HIGHLIGHT = 'outline: 3px solid rgba(255, 140, 0, 0.95); outline-offset: 2px; border-radius: 4px; background: rgba(255, 140, 0, 0.12); animation: none';
export function videoText(pace) {
  const live = livePace(pace);
  const show = live > 0
    ? `{ actions: { duration: ${live}, cursor: 'pointer', style: { title: 'display: none', highlight: ${JSON.stringify(HIGHLIGHT)} } }, test: { level: 'title', position: 'bottom' } }`
    : `{ test: { level: 'title', position: 'bottom' } }`;
  return `{ mode: 'on' as const, size: viewport, show: ${show} }`;
}

// The temporary config: the app's own config spread, plus the video and its annotations, and the reporter that keeps
// each test's timeline (its actions' times) for the slowing afterwards; nothing else changes.
export function filmConfigText({ baseImport, wrapDir, outputDir, timelineReporter, timelineFile, grep, pace }) {
  return `// written by tests/film.mjs for one film run and removed after it; the app's config is not changed
import { defineConfig } from '@playwright/test';
import base from ${JSON.stringify(baseImport)};

const viewport = (base.use && base.use.viewport) || { width: 1280, height: 800 };
const video = ${videoText(pace)};
export default defineConfig({
  ...base,
  testDir: ${JSON.stringify(wrapDir)},
  testMatch: '**/*',
  testIgnore: [],
  grep: new RegExp(${JSON.stringify(grep)}),
  grepInvert: undefined,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  repeatEach: 1,
  timeout: (base.timeout || 30_000) * 3,
  outputDir: ${JSON.stringify(outputDir)},
  reporter: [['list'], [${JSON.stringify(timelineReporter)}, { out: ${JSON.stringify(timelineFile)} }]],
  use: { ...base.use, video },
  projects: base.projects && base.projects.map(p => ({ ...p, use: { ...p.use, video } })),
});
`;
}

// The timeline reporter (a file film.mjs writes next to the config): one JSON line per test begin and end (its
// title path, status, video) and per Playwright call and fixture (start, duration). Times are this machine's clock,
// the same the wrapper's marks use.
export const TIMELINE_REPORTER = `// written by tests/film.mjs: each filmed test's timeline, for the slowing afterwards
const fs = require('node:fs');
class FilmTimeline {
  constructor(o) { this.out = o.out; }
  printsToStdio() { return false; }
  w(o) { try { fs.appendFileSync(this.out, JSON.stringify(o) + '\\n'); } catch { /* the film is then unslowed */ } }
  onTestBegin(test, result) { this.w({ k: 'begin', id: test.id, path: test.titlePath(), at: result.startTime.getTime() }); }
  onStepEnd(test, result, step) {
    if (step.category === 'pw:api' || step.category === 'fixture') this.w({ k: 'step', id: test.id, title: step.title, cat: step.category, start: step.startTime.getTime(), ms: step.duration });
  }
  onTestEnd(test, result) {
    const video = (result.attachments || []).find(a => a.name === 'video' && a.path);
    this.w({ k: 'end', id: test.id, path: test.titlePath(), status: result.status, video: video && video.path, at: Date.now() });
  }
}
module.exports = FilmTimeline;
`;

// One wrapper per filmed spec, named like it (the on-screen title shows the spec's own name): a short title card
// before each test, the marks the slowing needs, the short hold at its end, then the spec itself, imported unchanged.
// The marks (one JSON line each in `marks`): the card's start, every time the page goes to about:blank (the kit's
// sign-out), and the test function's end with whether the page is blank then. The end: Playwright runs the
// afterEach hooks innermost first, and the spec's import is evaluated before the wrapper's own hooks are registered,
// so no afterEach of the wrapper can run before the spec's sign-out. The wrapper's beforeEach adds the end to the
// callbacks Playwright awaits right after the test function ends, passed or failed, before any afterEach (the set its
// own screenshot: 'only-on-failure' uses; internal to Playwright, measured on 1.64.1, so looked for first).
// MXCODR_FILM_HOLD_MS tells the kit's signOut (tests/mx-impl.ts) to hold the same short time before it leaves the
// page; a page held once at its end, or already on about:blank, is not held again. Plain timers, not
// page.waitForTimeout: no step in the report or the trace.
export function wrapperText(importPath, pace, marks) {
  return `// written by tests/film.mjs for one film run and removed after it
import { test } from '@playwright/test';
import { appendFileSync } from 'node:fs';
process.env.MXCODR_FILM_HOLD_MS = '${LIVE_HOLD_MS}';
const held = globalThis[Symbol.for('mxcodr.film.held')] ??= new WeakSet();
const ended = new Set();
const mark = (testInfo, k, extra = {}) => { try { appendFileSync(${JSON.stringify(marks)}, JSON.stringify({ id: testInfo.testId, k, at: Date.now(), ...extra }) + '\\n'); } catch { /* unmarked: held at the video's end */ } };
const hold = async page => {
  if (held.has(page) || page.isClosed() || page.url() === 'about:blank') return;
  held.add(page);
  await new Promise(resolve => setTimeout(resolve, ${LIVE_HOLD_MS}));
};
const end = async (page, testInfo) => {
  if (ended.has(testInfo.testId)) return;
  ended.add(testInfo.testId);
  mark(testInfo, 'end', { blank: page.isClosed() || page.url() === 'about:blank' });
  await hold(page);
};
test.beforeEach(async ({ page }, testInfo) => {
  page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() === 'about:blank') mark(testInfo, 'blank'); });
  mark(testInfo, 'card');
  await page.screencast.showChapter(testInfo.title, { description: testInfo.titlePath.slice(0, -1).join(' › '), duration: ${CARD_LIVE_MS} });
  const atEnd = testInfo._onDidFinishTestFunctionCallbacks;
  if (atEnd && typeof atEnd.add === 'function') atEnd.add(() => end(page, testInfo));
});
// a Playwright without that set (or a beforeEach of the spec that failed before this one): the screen still there
test.afterEach(async ({ page }, testInfo) => { await end(page, testInfo); });
import ${JSON.stringify(importPath)};
`;
}

// ---- the slowing: the raw video's timeline -> the film's -------------------------------------------------------

// The calls that act on an element: Playwright shows its annotation (the pointer, the frame) right before each.
const INPUT = /^(Click|Double click|Fill|Check|Uncheck|Set checked|Press|Press sequentially|Type|Hover|Tap|Select option|Set input files|Drag and drop|Clear|Focus|Select text)\b/;

// One test's timeline lines (reporter) and marks (wrapper) -> what the slowing needs, in wall-clock ms:
// { zero (the video's first frame), actions: [{ start, end }], card, end: { at, blank }, blanks: [ms], close }
export function timelineOf(lines, marks, id) {
  const mine = lines.filter(l => l.id === id);
  const steps = mine.filter(l => l.k === 'step');
  const at = s => s && s.start;
  // the video starts with the page (Playwright's recorder starts in "Create page"), else the context
  const zero = at(steps.find(s => s.cat === 'pw:api' && s.title === 'Create page')) ?? at(steps.find(s => s.cat === 'fixture' && /"page"/.test(s.title)))
    ?? at(steps.find(s => s.cat === 'fixture' && /"context"/.test(s.title))) ?? mine.find(l => l.k === 'begin')?.at;
  const m = marks.filter(x => x.id === id);
  const end = m.find(x => x.k === 'end');
  const close = steps.find(s => s.cat === 'pw:api' && s.title === 'Close context');
  return {
    zero,
    actions: steps.filter(s => s.cat === 'pw:api' && INPUT.test(s.title)).map(s => ({ start: s.start, end: s.start + s.ms, title: s.title })).sort((a, b) => a.start - b.start),
    card: m.find(x => x.k === 'card')?.at,
    end: end ? { at: end.at, blank: !!end.blank } : null,
    blanks: m.filter(x => x.k === 'blank').map(x => x.at).sort((a, b) => a - b),
    close: close ? close.start : null,
  };
}

/**
 * The film's plan: the raw video cut into pieces, each { a, b, out } (seconds of the raw video a..b play in `out`
 * seconds of the film; a === b is a held frame, the one just before a, for `out`). Pure, so the film and the step
 * times of the pane's player come from the same numbers. -> { pieces, total, cut } (cut: the raw second the film
 * ends on, then held). Without a timeline the raw video plays as it is and its last frame is held.
 */
export function filmPlan(tl, { pace = DEFAULT_PACE, lag = LAG_S, rawEnd = null } = {}) {
  const pieces = [];
  let at = 0;
  const v = ms => Math.max(0, (ms - tl.zero) / 1000 + lag);
  const idle = len => (pace > 0 && len > IDLE_KEEP_S ? IDLE_KEEP_S + (len - IDLE_KEEP_S) / IDLE_SPEED : len);
  const play = (to, how = 'idle') => { if (to > at + 1e-6) { const len = to - at; pieces.push({ a: at, b: to, out: how === 'cut' ? 0 : how === 'idle' ? idle(len) : len }); at = to; } };
  const freeze = (t, out) => { play(t); pieces.push({ a: at, b: at, out }); };
  const hold = holdMs(pace) / 1000;
  if (!tl || !Number.isFinite(tl.zero)) {
    const end = rawEnd ?? 0;
    if (end > 0) pieces.push({ a: 0, b: end, out: end });
    pieces.push({ a: end, b: end, out: hold });
    return finish(pieces, end);
  }
  // the end: the test's last screen (held LIVE_HOLD_MS while recording: a frame late in that hold), or, when the test
  // signed out itself, the screen before its last sign-out (the kit held it LIVE_HOLD_MS too)
  const blanks = tl.blanks.map(v);
  let endAt;
  if (tl.end && !tl.end.blank) endAt = v(tl.end.at) + LIVE_HOLD_MS / 1000 - HOLD_PICK_S;
  else if (blanks.length) endAt = blanks[blanks.length - 1] - HOLD_PICK_S;
  else if (tl.end) endAt = v(tl.end.at);
  else endAt = tl.close ? v(tl.close) - 0.1 : (rawEnd ?? 0);
  if (rawEnd != null) endAt = Math.min(endAt, rawEnd);
  // the title card: the blank page before it cut, its fade-in played, its full frame held
  if (Number.isFinite(tl.card) && v(tl.card) < endAt) {
    play(v(tl.card), 'cut');
    const full = Math.min(v(tl.card) + 0.4, endAt);
    play(full, 'own');
    pieces.push({ a: at, b: at, out: CARD_MS / 1000 });
  }
  // the actions (each one's annotation: the last livePace before the action ran, and a little of what it did) in
  // slow motion, the sign-outs inside the test held
  const live = livePace(pace) / 1000;
  const events = [];
  if (live > 0) for (const x of tl.actions) {
    const b = v(x.end) + 0.1, a = Math.max(v(x.end) - live - 0.08, v(x.start));
    events.push({ a, b, kind: 'act' });
  }
  for (const t of blanks.slice(0, -1).concat(tl.end && tl.end.blank ? [] : blanks.slice(-1))) events.push({ a: t - HOLD_PICK_S, b: t - HOLD_PICK_S, kind: 'mid' });
  events.sort((x, y) => x.a - y.a);
  for (const e of events) {
    if (e.a >= endAt) break;
    if (e.kind === 'mid') { if (e.a > at) freeze(e.a, MID_HOLD_MS / 1000); continue; }
    play(e.a);
    const b = Math.min(e.b, endAt);
    if (b > at + 1e-6) { const len = b - at; pieces.push({ a: at, b, out: Math.max(len, pace / 1000) }); at = b; }
  }
  play(endAt);
  pieces.push({ a: at, b: at, out: hold });
  return finish(pieces, endAt);
}
const finish = (pieces, cut) => ({ pieces, cut, total: Math.round(pieces.reduce((s, p) => s + p.out, 0) * 1000) / 1000 });

/** A second of the raw video -> the second of the film it shows at (a held frame counts before what follows it). */
export function filmSecond(plan, t) {
  let acc = 0;
  for (const p of plan.pieces) {
    if (p.a === p.b) { if (t >= p.a) { acc += p.out; continue; } break; }
    if (t >= p.b) { acc += p.out; continue; }
    if (t > p.a) acc += ((t - p.a) / (p.b - p.a)) * p.out;
    break;
  }
  return Math.min(acc, plan.total);
}
/** A wall-clock time of the run (ms) -> the film's second, for the steps of the pane's player. */
export const filmTime = (plan, tl, ms, lag = LAG_S) => (tl && Number.isFinite(tl.zero) ? filmSecond(plan, Math.max(0, (ms - tl.zero) / 1000 + lag)) : Math.max(0, (ms - (tl?.zero ?? ms)) / 1000));

const num = x => String(Math.round(x * 10000) / 10000);
/** The ffmpeg filter of a plan: every frame's new time (a sum over the pieces), the film's frame rate, the last
 * frame held past the end (cut at plan.total by -t). */
export function filterText(plan, fps = FPS) {
  const terms = [];
  for (const p of plan.pieces) {
    if (p.out <= 0) continue;
    if (p.a === p.b) terms.push(`${num(p.out)}*gte(T,${num(p.a)})`);
    else terms.push(`${num(p.out)}*clip((T-${num(p.a)})/${num(p.b - p.a)},0,1)`);
  }
  return `setpts='(${terms.join('+') || '0'})/TB',fps=${fps},tpad=stop_mode=clone:stop_duration=${num(holdMs(0) / 1000 + 1)},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
}

// ffmpeg's arguments for a film (H.264 in an mp4 that starts playing before it is all loaded). A long filter goes in a
// file: `-/vf <file>` (ffmpeg 7.1 and later), else `-filter_script:v <file>` (earlier ones; 9 has no such option).
export function ffmpegArgs(raw, mp4, plan, { filterFile = null, form = 'slash' } = {}) {
  const f = filterText(plan);
  const vf = filterFile ? (form === 'slash' ? ['-/vf', filterFile] : ['-filter_script:v', filterFile]) : ['-vf', f];
  return ['-v', 'error', '-y', '-i', raw, ...vf, '-t', num(plan.total), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4];
}

function run(cmd, args, onChild) {
  return new Promise(resolve => {
    let err = '';
    const c = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    onChild?.(c);
    c.stderr.on('data', d => { err += d; });
    c.on('error', e => resolve({ status: 127, err: e.message }));
    c.on('close', code => resolve({ status: code ?? 1, err }));
  });
}

/**
 * The raw video -> the film: the plan's slowing with ffmpeg (`ffmpeg`: its path, or null when there is none), into
 * `out` (.mp4). -> { file, plan, slowed } — file is the .mp4, or the raw .webm moved to `out`'s name when there is no
 * ffmpeg or it failed (then slowed is false and plan is the raw video's own timeline).
 */
export async function makeFilm({ raw, out, tl, pace, ffmpeg, work, onChild }) {
  const webm = out.replace(/\.mp4$/, '.webm');
  for (const f of [out, webm]) fs.rmSync(f, { force: true });
  if (ffmpeg) {
    const plan = filmPlan(tl, { pace });
    const text = filterText(plan);
    const long = text.length > 6000;
    const filterFile = long ? path.join(work, `filter-${process.pid}-${Date.now()}.txt`) : null;
    if (long) fs.writeFileSync(filterFile, text);
    let r = await run(ffmpeg, ffmpegArgs(raw, out, plan, { filterFile }), onChild);
    if (r.status !== 0 && long) r = await run(ffmpeg, ffmpegArgs(raw, out, plan, { filterFile, form: 'script' }), onChild);
    if (filterFile) fs.rmSync(filterFile, { force: true });
    if (r.status === 0 && fs.existsSync(out)) { fs.rmSync(raw, { force: true }); return { file: out, plan, slowed: true }; }
    fs.rmSync(out, { force: true });
  }
  fs.renameSync(raw, webm);
  return { file: webm, plan: null, slowed: false };
}

// ---- running it ----------------------------------------------------------------------------------------------

const say = s => console.log(s);
const fail = (s, code = 2) => { console.error(`film: ${s}`); process.exit(code); };

// The folders: tests/ (where this script is), the app, and the Playwright config in use (tests/ first, then root).
export function locate(testsDir) {
  const app = path.dirname(testsDir);
  const names = ['ts', 'js', 'mjs', 'cjs'].map(e => `playwright.config.${e}`);
  for (const dir of [testsDir, app]) for (const n of names) if (fs.existsSync(path.join(dir, n))) return { app, testsDir, configDir: dir, config: n };
  return { app, testsDir, configDir: null, config: null };
}

function playwrightCli(where) {
  try { return createRequire(path.join(where.configDir, 'noop.js')).resolve('@playwright/test/cli'); } catch {
    fail(`@playwright/test is not installed next to ${where.config}; run npm install in ${path.relative(process.cwd(), where.configDir) || '.'} first`);
  }
}

function listTests(where) {
  const r = spawnSync(process.execPath, [playwrightCli(where), 'test', '-c', where.config, '--list', '--reporter=json'], { cwd: where.configDir, encoding: 'utf8', maxBuffer: 64 << 20 });
  const text = r.stdout || '';
  let json;
  try { json = JSON.parse(text.slice(text.indexOf('{'))); } catch { fail(`playwright could not list the tests:\n${(r.stderr || text).trim().split('\n').slice(-5).join('\n')}`); }
  const rootDir = json.config?.rootDir || where.configDir;
  return testsFromList(json).map(t => {
    let source = '';
    try { source = fs.readFileSync(path.join(rootDir, t.file), 'utf8'); } catch { /* unread: assume a browser */ }
    return { ...t, rootDir, browser: needsBrowser(source, t.line) };
  });
}

// APP_URL as the kit reads it: the environment, else tests/.env, else Mendix's default port.
function baseUrl(testsDir) {
  if (process.env.APP_URL) return process.env.APP_URL;
  try { const m = fs.readFileSync(path.join(testsDir, '.env'), 'utf8').match(/^\s*APP_URL\s*=\s*(.+?)\s*$/m); if (m) return m[1].replace(/^['"]|['"]$/g, ''); } catch { /* none */ }
  return 'http://127.0.0.1:8080';
}
// Three tries a second apart: a long --all run's kept-alive connection the app has closed fails the first fetch
// (2026-11-21: --all stopped after its 5th test with the app answering).
export async function answers(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' }); return true; } catch { /* again */ }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}
async function appUp(where) {
  const url = baseUrl(where.testsDir);
  if (await answers(url)) return url;
  const mpr = fs.readdirSync(where.app).find(f => f.endsWith('.mpr')) || '<app>.mpr';
  fail(`no app answers at ${url}; start it first: ./mxcli run --local --detach -p ${mpr} (then ./mxcli run wait --ready -p ${mpr})`);
}

const filmsDir = where => path.join(where.app, '.mxcli', 'films');
const ffmpegPath = () => (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 ? 'ffmpeg' : null);
const readLines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } }); } catch { return []; } };

// A reporter's title path (['', project, file, ...describes, title]) is this test's
export const isTest = (t, titlePath) => {
  const want = [...t.describes, t.title];
  const p = titlePath || [];
  if (p.length < want.length + 1) return false;
  const tail = p.slice(p.length - want.length);
  const file = String(p[p.length - want.length - 1] || '').replace(/\\/g, '/');
  return tail.every((x, i) => x === want[i]) && (file === t.file || file.endsWith('/' + t.file));
};

/**
 * Films the tests in ONE Playwright run (one worker, one browser): each test's film is made (ffmpeg, one at a time)
 * as soon as its test ends, while the next one records. Prints a line per test as film.mjs always has
 * ("filming i/n", PASS/FAIL with the film). -> { passed, failed, notFilmed: [tests] }
 */
async function filmTests(where, tests, pace, { numbered = false, url } = {}) {
  const films = filmsDir(where);
  const work = path.join(films, '.work');
  const wrapDir = path.join(where.configDir, '.film');
  const configFile = path.join(where.configDir, '.film.config.ts');
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(wrapDir, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const timeline = path.join(work, 'timeline.jsonl');
  const marks = path.join(work, 'marks.jsonl');
  const reporter = path.join(work, 'film-timeline.cjs');
  const ffmpeg = ffmpegPath();
  let passed = 0, failed = 0;
  const done = new Set();
  let child = null, stoppedWhy = null;
  try {
    fs.writeFileSync(reporter, TIMELINE_REPORTER);
    for (const file of [...new Set(tests.map(t => t.file))]) {
      const t = tests.find(x => x.file === file);
      const spec = path.join(t.rootDir, file);
      const wrapper = path.join(wrapDir, file);
      fs.mkdirSync(path.dirname(wrapper), { recursive: true });
      const rel = path.relative(path.dirname(wrapper), spec).split(path.sep).join('/').replace(/\.[cm]?[jt]s$/, '');
      fs.writeFileSync(wrapper, wrapperText(rel.startsWith('.') ? rel : './' + rel, pace, marks));
    }
    fs.writeFileSync(configFile, filmConfigText({ baseImport: './' + where.config.replace(/\.[cm]?[jt]s$/, ''), wrapDir, outputDir: path.join(work, 'out'), timelineReporter: reporter, timelineFile: timeline, grep: grepForAll(tests), pace }));
    if (!numbered) say(`filming: ${tests[0].full}  (${tests[0].file}:${tests[0].line})`);
    child = spawn(process.execPath, [playwrightCli(where), 'test', '-c', path.basename(configFile)], { cwd: where.configDir, stdio: 'inherit' });
    const exited = new Promise(resolve => child.on('close', resolve));
    let seen = 0, queue = Promise.resolve(), running = true;
    exited.then(() => { running = false; });
    const finishOne = async (t, endLine) => {
      const verdict = endLine.status === 'passed' ? 'PASS' : 'FAIL';
      if (!endLine.video || !fs.existsSync(endLine.video)) { failed++; console.error(`film: ${t.full} ran, but no film was written`); return; }
      const tl = timelineOf(readLines(timeline), readLines(marks), endLine.id);
      const out = path.join(films, `${slug(t)}.mp4`);
      const made = await makeFilm({ raw: endLine.video, out, tl, pace, ffmpeg, work });
      const shown = path.relative(where.app, made.file).split(path.sep).join('/');
      const note = made.slowed ? '' : ffmpeg ? ' (ffmpeg could not convert it: the raw recording, at the test\'s own speed)' : ' (no ffmpeg: the raw recording, at the test\'s own speed; install ffmpeg for the slowed film)';
      if (verdict === 'PASS') passed++; else failed++;
      say(verdict === 'PASS' ? `PASS  ${t.full} -> ${shown}${note}` : `FAIL  ${t.full} -> ${shown} (the film shows where it stopped)${note}`);
    };
    const poll = async () => {
      const lines = readLines(timeline);
      for (; seen < lines.length; seen++) {
        const l = lines[seen];
        const t = l.path && tests.find(x => isTest(x, l.path));
        if (!t) continue;
        if (l.k === 'begin' && numbered) say(`filming ${tests.indexOf(t) + 1}/${tests.length} ${t.full}`);
        if (l.k === 'end' && !done.has(t)) {
          done.add(t);
          queue = queue.then(() => finishOne(t, l)).catch(e => { failed++; console.error(`film: ${t.full}: ${e.message}`); });
          // a failed test may be the app gone (an unlicensed Mendix app stops after its maximum run time)
          if (l.status !== 'passed' && url && done.size < tests.length && !(await answers(url))) {
            stoppedWhy = t;
            try { child.kill('SIGTERM'); } catch { /* ended */ }
          }
        }
      }
    };
    while (running) { await poll(); await new Promise(r => setTimeout(r, 250)); }
    await exited;
    await poll();
    await queue;
  } finally {
    fs.rmSync(wrapDir, { recursive: true, force: true });
    fs.rmSync(configFile, { force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
  const notFilmed = tests.filter(t => !done.has(t));
  if (stoppedWhy) {
    say(`stopped: the app stopped answering after "${stoppedWhy.full}" (an unlicensed Mendix app stops after its maximum run time).`);
    say(`         not filmed: ${notFilmed.map(x => x.n).join(', ')}; start the app again and film those one by one.`);
  } else for (const t of notFilmed) { failed++; console.error(`film: ${t.full} did not run, so there is no film`); }
  return { passed, failed, notFilmed };
}

// The film run's JSON report -> [{ title, status, video }] for every test that ran.
export function collectResults(report) {
  const out = [];
  const walk = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) for (const r of test.results || []) {
      const video = (r.attachments || []).find(a => a.name === 'video' && a.path);
      out.push({ title: spec.title, status: r.status, video: video && video.path });
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const s of report.suites || []) walk(s);
  return out;
}

// What a stopped or killed film leaves: its temporary config and wrappers (the app's own config would collect the
// wrappers as specs) and its work folder.
function cleanLeftovers(where) {
  if (where.configDir) for (const f of ['.film', '.film.config.ts']) fs.rmSync(path.join(where.configDir, f), { recursive: true, force: true });
  fs.rmSync(path.join(filmsDir(where), '.work'), { recursive: true, force: true });
}

// --all runs in the background: its pid and log in .mxcli/films/.
const pidFile = where => path.join(filmsDir(where), '.all.pid');
const logFile = where => path.join(filmsDir(where), 'all.log');
function allRunning(where) {
  const pid = Number(fs.existsSync(pidFile(where)) ? fs.readFileSync(pidFile(where), 'utf8').trim() : NaN);
  if (!Number.isInteger(pid) || pid <= 0) return 0;
  try { process.kill(pid, 0); return pid; } catch { return 0; }
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.error) fail(opt.error);
  const self = fileURLToPath(import.meta.url);
  const where = locate(path.dirname(self));
  if (opt.cmd === 'help') { say(fs.readFileSync(self, 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (opt.cmd === 'status') {
    const pid = allRunning(where);
    if (!pid && !fs.existsSync(logFile(where))) { say('no film --all has run here'); return; }
    say(pid ? `recording in the background (pid ${pid})` : 'not running; the last run:');
    say(fs.readFileSync(logFile(where), 'utf8').split('\n').filter(l => /^(filming|PASS|FAIL|skip|stopped|done)/.test(l)).slice(-25).join('\n'));
    return;
  }
  if (opt.cmd === 'stop') {
    const pid = allRunning(where);
    if (!pid) { say('nothing is recording in the background'); return; }
    // the background run leads its own process group (detached): its playwright and browser end with it; on
    // Windows taskkill /T ends that one pid's tree
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    else try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
    fs.rmSync(pidFile(where), { force: true });
    await new Promise(r => setTimeout(r, 1000));
    cleanLeftovers(where);
    say(`stopped the background recording; the films made so far are in ${path.relative(where.app, filmsDir(where))}/`);
    return;
  }
  if (!where.config) fail('no playwright.config.* in tests/ or the app folder: there is no suite to film');
  // the background half finds its own pid in the file its parent wrote
  if (!['list', 'all-run'].includes(opt.cmd) && allRunning(where)) fail('a film --all is recording in the background; wait for it (--status) or --stop it');
  if (!allRunning(where)) cleanLeftovers(where);
  const tests = listTests(where);
  if (opt.cmd === 'list') {
    if (!tests.length) { say('no tests yet'); return; }
    for (const t of tests) say(line(t) + (t.browser ? '' : '  no browser: nothing to film'));
    return;
  }
  if (opt.cmd === 'one') {
    const p = pick(tests, opt.query);
    if (p.error) fail(p.error);
    const t = p.tests[0];
    if (!t.browser) fail(`${t.full} opens no browser: nothing to film`);
    await appUp(where);
    fs.mkdirSync(filmsDir(where), { recursive: true });
    const r = await filmTests(where, [t], opt.pace);
    process.exitCode = r.passed === 1 ? 0 : 1;
    return;
  }
  const filmable = tests.filter(t => t.browser);
  if (opt.cmd === 'all') {
    if (!filmable.length) fail('no test with a browser to film');
    await appUp(where);
    fs.mkdirSync(filmsDir(where), { recursive: true });
    const log = fs.openSync(logFile(where), 'w');
    const child = spawn(process.execPath, [self, '--pace', String(opt.pace), '--all-run'], { cwd: where.app, detached: true, stdio: ['ignore', log, log], windowsHide: true });
    fs.writeFileSync(pidFile(where), String(child.pid));
    child.unref();
    const minutes = Math.ceil(filmable.length * SECONDS_PER_TEST / 60);
    say(`Filming ${filmable.length} tests in the background: about ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    say(`  progress: node tests/film.mjs --status      log: ${path.relative(where.app, logFile(where))}`);
    say('  stop:     node tests/film.mjs --stop');
    say('Do not run the tests meanwhile: the app allows few sessions at a time.');
    return;
  }
  // all-run: the background half of --all
  fs.writeFileSync(pidFile(where), String(process.pid));
  try {
    for (const t of tests.filter(x => !x.browser)) say(`skip  ${t.full} (no browser in this test)`);
    const r = await filmTests(where, filmable, opt.pace, { numbered: true, url: baseUrl(where.testsDir) });
    say(`done: ${r.passed} passed, ${r.failed} failed; the films are in ${path.relative(where.app, filmsDir(where))}/`);
  } finally { fs.rmSync(pidFile(where), { force: true }); }
}

// run as a script, not imported (the pane's films.mjs imports it; an importer's argv[1] need not be a file)
const isMain = () => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) main().catch(e => fail(e.stack || e.message));
