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
// Its parts are in film/ beside it (tests/film/ in the app): timing.mjs, pick.mjs (which tests), run-texts.mjs (the
// files a film run writes), slowing.mjs (the film made from the video); this file runs it and re-exports them all.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SECONDS_PER_TEST } from './film/timing.mjs';
import { parseArgs, testsFromList, needsBrowser, pick, line, slug, grepForAll, isTest } from './film/pick.mjs';
import { filmConfigText, TIMELINE_REPORTER, wrapperText } from './film/run-texts.mjs';
import { timelineOf, makeFilm } from './film/slowing.mjs';
export { DEFAULT_PACE, LIVE_PACE, livePace, CARD_LIVE_MS, CARD_MS, MIN_HOLD_MS, holdMs, LIVE_HOLD_MS, MID_HOLD_MS, IDLE_KEEP_S, IDLE_SPEED, LAG_S, HOLD_PICK_S, FPS, SECONDS_PER_TEST } from './film/timing.mjs';
export { parseArgs, testsFromList, needsBrowser, pick, line, slug, grepFor, grepForAll, isTest, collectResults } from './film/pick.mjs';
export { HIGHLIGHT, videoText, filmConfigText, TIMELINE_REPORTER, wrapperText } from './film/run-texts.mjs';
export { timelineOf, filmPlan, filmSecond, filmTime, sumTree, filterText, ffmpegArgs, plainArgs, makeFilm } from './film/slowing.mjs';

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

// One film run's folders and files: the work folder (cleared) in .mxcli/films/, and the wrappers' folder (cleared) and
// the temporary config beside the app's config.
function runFolders(where) {
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
  return { films, work, wrapDir, configFile, timeline, marks, reporter };
}

// What the run reads: the timeline reporter, a wrapper per filmed spec, and the temporary config.
function writeRunFiles(where, tests, pace, { work, wrapDir, configFile, timeline, marks, reporter }) {
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
}

/**
 * Films the tests in ONE Playwright run (one worker, one browser): each test's film is made (ffmpeg, one at a time)
 * as soon as its test ends, while the next one records. Prints a line per test as film.mjs always has
 * ("filming i/n", PASS/FAIL with the film). -> { passed, failed, notFilmed: [tests] }
 */
async function filmTests(where, tests, pace, { numbered = false, url } = {}) {
  const { films, work, wrapDir, configFile, timeline, marks, reporter } = runFolders(where);
  const ffmpeg = ffmpegPath();
  let passed = 0, failed = 0;
  const done = new Set();
  let child = null, stoppedWhy = null;
  try {
    writeRunFiles(where, tests, pace, { work, wrapDir, configFile, timeline, marks, reporter });
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
      const note = made.slowed ? '' : made.converted ? ' (its timeline was not found: at the test\'s own speed)' : ffmpeg ? ' (ffmpeg could not convert it: the raw recording, at the test\'s own speed)' : ' (no ffmpeg: the raw recording, at the test\'s own speed; install ffmpeg for the slowed film)';
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

// --status: the background --all's pid, and the last lines of its log.
function showStatus(where) {
  const pid = allRunning(where);
  if (!pid && !fs.existsSync(logFile(where))) { say('no film --all has run here'); return; }
  say(pid ? `recording in the background (pid ${pid})` : 'not running; the last run:');
  say(fs.readFileSync(logFile(where), 'utf8').split('\n').filter(l => /^(filming|PASS|FAIL|skip|stopped|done)/.test(l)).slice(-25).join('\n'));
}

// --stop: the background --all ended, its leftovers removed.
async function stopAll(where) {
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
}

// --all: this script again in the background (--all-run), detached, its output in the log.
async function startAll(where, filmable, opt, self) {
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
}

// all-run: the background half of --all
async function runAll(where, tests, filmable, opt) {
  fs.writeFileSync(pidFile(where), String(process.pid));
  try {
    for (const t of tests.filter(x => !x.browser)) say(`skip  ${t.full} (no browser in this test)`);
    const r = await filmTests(where, filmable, opt.pace, { numbered: true, url: baseUrl(where.testsDir) });
    say(`done: ${r.passed} passed, ${r.failed} failed; the films are in ${path.relative(where.app, filmsDir(where))}/`);
  } finally { fs.rmSync(pidFile(where), { force: true }); }
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.error) fail(opt.error);
  const self = fileURLToPath(import.meta.url);
  const where = locate(path.dirname(self));
  if (opt.cmd === 'help') { say(fs.readFileSync(self, 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (opt.cmd === 'status') { showStatus(where); return; }
  if (opt.cmd === 'stop') { await stopAll(where); return; }
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
  if (opt.cmd === 'all') { await startAll(where, filmable, opt, self); return; }
  await runAll(where, tests, filmable, opt);
}

// run as a script, not imported (the pane's films.mjs imports it; an importer's argv[1] need not be a file)
const isMain = () => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) main().catch(e => fail(e.stack || e.message));
