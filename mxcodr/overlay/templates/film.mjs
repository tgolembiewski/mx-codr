#!/usr/bin/env node
// tests/film.mjs: a video of a test's run, slowed so a person can follow it. The mx-codr installer writes it on
// every install (it is the bundle's, not the app's: edits are overwritten). Run it from the app folder or tests/:
//
//   node tests/film.mjs --list                  every test, numbered, with its file and line
//   node tests/film.mjs 7                       film test 7 of the list
//   node tests/film.mjs order approval          film the one test whose title holds these words
//   node tests/film.mjs orders.spec.ts:57       film the test at that line
//   node tests/film.mjs --pace 1500 7           slower: ms per action (default 1000; 0 = the test's own speed)
//   node tests/film.mjs --all                   every test with a browser, in the background; one film each
//   node tests/film.mjs --status | --stop       how far --all is / stop it
//
// The film lands in .mxcli/films/<title>.mp4 (with ffmpeg) or .webm (open that in Chrome or Firefox). The test
// runs unchanged: a temporary config spreads the app's Playwright config and adds only video recording with
// Playwright's own annotations (an animated pointer travels to each element, each action is paced, the action
// callouts are hidden so no typed value shows) and a title card naming the test before it starts. The app's
// playwright.config.ts is never edited, so a normal `npx playwright test` records nothing and is not slowed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PACE = 1000;
// what one slowed test takes on average (b2b-full so7, pace 1000): for the --all estimate
export const SECONDS_PER_TEST = 40;
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

// The temporary config: the app's own config spread, plus the video and its annotations; nothing else changes.
export function filmConfigText({ baseImport, wrapDir, outputDir, jsonFile, grep, pace }) {
  const show = pace > 0
    ? `{ actions: { duration: ${pace}, cursor: 'pointer', style: { title: 'display: none' } }, test: { level: 'title', position: 'bottom' } }`
    : `{ test: { level: 'title', position: 'bottom' } }`;
  return `// written by tests/film.mjs for one film and removed after it; the app's config is not changed
import { defineConfig } from '@playwright/test';
import base from ${JSON.stringify(baseImport)};

const viewport = (base.use && base.use.viewport) || { width: 1280, height: 800 };
const video = { mode: 'on' as const, size: viewport, show: ${show} };
export default defineConfig({
  ...base,
  testDir: ${JSON.stringify(wrapDir)},
  testMatch: '**/*',
  testIgnore: [],
  grep: new RegExp(${JSON.stringify(grep)}),
  grepInvert: undefined,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  timeout: (base.timeout || 30_000) * 10,
  outputDir: ${JSON.stringify(outputDir)},
  reporter: [['list'], ['json', { outputFile: ${JSON.stringify(jsonFile)} }]],
  use: { ...base.use, video },
  projects: base.projects && base.projects.map(p => ({ ...p, use: { ...p.use, video } })),
});
`;
}

// One wrapper per filmed spec, named like it (the on-screen title shows the spec's own name): a title card
// before each test, then the spec itself, imported unchanged.
export function wrapperText(importPath, pace) {
  return `// written by tests/film.mjs for one film and removed after it
import { test } from '@playwright/test';
test.beforeEach(async ({ page }, testInfo) => {
  await page.screencast.showChapter(testInfo.title, { description: testInfo.titlePath.slice(0, -1).join(' › '), duration: ${pace > 0 ? 3000 : 1500} });
});
${pace > 0 ? `// the last screen stays a moment; a file-level afterEach of the spec (sign-out) runs after this one, one inside a describe before it
test.afterEach(async ({ page }) => { await page.waitForTimeout(${2 * pace}); });
` : ''}import ${JSON.stringify(importPath)};
`;
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

function playwright(where, args, opts = {}) {
  let cli;
  try { cli = createRequire(path.join(where.configDir, 'noop.js')).resolve('@playwright/test/cli'); } catch {
    fail(`@playwright/test is not installed next to ${where.config}; run npm install in ${path.relative(process.cwd(), where.configDir) || '.'} first`);
  }
  return opts.wait === false
    ? spawn(process.execPath, [cli, 'test', ...args], { cwd: where.configDir, stdio: opts.stdio || 'inherit' })
    : spawnSync(process.execPath, [cli, 'test', ...args], { cwd: where.configDir, encoding: 'utf8', stdio: opts.stdio || 'pipe', maxBuffer: 64 << 20 });
}

function listTests(where) {
  const r = playwright(where, ['-c', where.config, '--list', '--reporter=json']);
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
async function answers(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' }); return true; } catch { return false; }
}
async function appUp(where) {
  const url = baseUrl(where.testsDir);
  if (await answers(url)) return url;
  const mpr = fs.readdirSync(where.app).find(f => f.endsWith('.mpr')) || '<app>.mpr';
  fail(`no app answers at ${url}; start it first: ./mxcli run --local --detach -p ${mpr} (then ./mxcli run wait --ready -p ${mpr})`);
}

const filmsDir = where => path.join(where.app, '.mxcli', 'films');
const hasFfmpeg = () => spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

// Films one test; returns 'PASS' | 'FAIL' and prints where the film is.
function filmOne(where, t, pace) {
  const films = filmsDir(where);
  const work = path.join(films, '.work');
  const wrapDir = path.join(where.configDir, '.film');
  const configFile = path.join(where.configDir, '.film.config.ts');
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(wrapDir, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const spec = path.join(t.rootDir, t.file);
    const wrapper = path.join(wrapDir, t.file);
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    const rel = path.relative(path.dirname(wrapper), spec).split(path.sep).join('/').replace(/\.[cm]?[jt]s$/, '');
    fs.writeFileSync(wrapper, wrapperText(rel.startsWith('.') ? rel : './' + rel, pace));
    const jsonFile = path.join(work, 'result.json');
    fs.writeFileSync(configFile, filmConfigText({ baseImport: './' + where.config.replace(/\.[cm]?[jt]s$/, ''), wrapDir, outputDir: path.join(work, 'out'), jsonFile, grep: grepFor(t), pace }));
    say(`filming: ${t.full}  (${t.file}:${t.line})`);
    playwright(where, ['-c', path.basename(configFile)], { stdio: 'inherit' });
    let result; try { result = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch { result = null; }
    const ran = result ? collectResults(result) : [];
    const mine = ran[0];
    if (!mine || !mine.video) { console.error(`film: ${t.full} ran, but no film was written`); return 'FAIL'; }
    const name = slug(t);
    for (const ext of ['webm', 'mp4']) fs.rmSync(path.join(films, `${name}.${ext}`), { force: true });
    const webm = path.join(films, `${name}.webm`);
    fs.renameSync(mine.video, webm);
    let filmFile = webm;
    if (hasFfmpeg()) {
      const mp4 = path.join(films, `${name}.mp4`);
      const c = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', mp4], { stdio: 'ignore' });
      if (c.status === 0 && fs.existsSync(mp4)) filmFile = mp4; else fs.rmSync(mp4, { force: true });
    }
    const shown = path.relative(where.app, filmFile).split(path.sep).join('/');
    const verdict = mine.status === 'passed' ? 'PASS' : 'FAIL';
    say(verdict === 'PASS' ? `PASS  ${t.full} -> ${shown}` : `FAIL  ${t.full} -> ${shown} (the film shows where it stopped)`);
    return verdict;
  } finally {
    fs.rmSync(wrapDir, { recursive: true, force: true });
    fs.rmSync(configFile, { force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
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
    process.exitCode = filmOne(where, t, opt.pace) === 'PASS' ? 0 : 1;
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
    const minutes = Math.ceil(filmable.length * SECONDS_PER_TEST * Math.max(opt.pace, 250) / DEFAULT_PACE / 60);
    say(`Filming ${filmable.length} tests in the background: about ${minutes} minutes.`);
    say(`  progress: node tests/film.mjs --status      log: ${path.relative(where.app, logFile(where))}`);
    say('  stop:     node tests/film.mjs --stop');
    say('Do not run the tests meanwhile: the app allows few sessions at a time.');
    return;
  }
  // all-run: the background half of --all
  fs.writeFileSync(pidFile(where), String(process.pid));
  try {
    for (const t of tests.filter(x => !x.browser)) say(`skip  ${t.full} (no browser in this test)`);
    let passed = 0, failed = 0;
    const url = baseUrl(where.testsDir);
    for (const [i, t] of filmable.entries()) {
      say(`filming ${i + 1}/${filmable.length} ${t.full}`);
      if (filmOne(where, t, opt.pace) === 'PASS') passed++; else failed++;
      if (i < filmable.length - 1 && !(await answers(url))) {
        say(`stopped: the app stopped answering after "${t.full}" (an unlicensed Mendix app stops after its maximum run time).`);
        say(`         not filmed: ${filmable.slice(i + 1).map(x => x.n).join(', ')}; start the app again and film those one by one.`);
        break;
      }
    }
    say(`done: ${passed} passed, ${failed} failed; the films are in ${path.relative(where.app, filmsDir(where))}/`);
  } finally { fs.rmSync(pidFile(where), { force: true }); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => fail(e.stack || e.message));
