// The mx-codr installer (harness v2, skills only). install.sh runs it from the bundle:
//   node overlay/install.mjs <app folder> [--db hsqldb|postgres] [--agent claude,cursor,codex,opencode,pi] [--remove-agent <name>] [--coverage | --no-coverage] [--theme <name>] [--yes] [--boot] [--request <file>] [--no-app]
// A folder with no .mpr first gets a new Mendix app (mxcli new; MX_VERSION, APP_NAME), unless --no-app.
// It installs one thing that runs while the agent builds, Claude Code's skill gate (lib/skill-gate.mjs: hooks in
// .claude/settings.local.json that refuse a model write or a test file until its project skill was read), and: the pinned mxcli, MxBuild and the runtime cached,
// the database chosen, mxcli's own skills refreshed, one always-on rule file per agent (asked on a terminal,
// --agent adds one to the last install's, --remove-agent takes one out), our skills beside
// mxcli's, a starter test kit in tests/ (absent files, and files unedited since an earlier install), tests/film.mjs (always), the app's look when one is chosen (theme/ only),
// .mxcodr/theme.mjs to change it later, and .mxcodr/installed.json (+ .mxcodr/bin/mxcli when it had to download mxcli).
// With coverage on (asked on a terminal, or --coverage) the agent is held to a test per numbered requirement:
// lib/coverage.mjs says what changes; off installs exactly what it did before. Run it again to
// repair or upgrade; an earlier bundle's gate (./mxgate, .mxgate/) and v1's hooks and checkers are removed.
// What it prints looks like v1's installer (lib/ui.mjs): the banner, one numbered bar over the steps, a ✔ line
// per step, ! notes, a red ✘ on failure, and the summary.
// The steps are in install/, one file per numbered section below (install/common.mjs, screen.mjs and summary.mjs
// hold what they share and print); this file keeps main() and re-exports every step, so the Studio Pro extension's
// setup, its translator and the tests import them from here as before.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeAtomic } from './lib/cache.mjs';
import { PIN, BUNDLE } from './lib/mx.mjs';
import { AGENTS } from './lib/rules.mjs';
import { skillsFor } from './lib/skills.mjs';
import { decideCoverage, askCoverage, coverageRecord } from './lib/coverage.mjs';
import { decideTheme, activeFrameTheme, applyTheme, askTheme, installThemeTool } from './lib/theme.mjs';
import { decideAgents, askAgents, agentsNote, agentNames } from './lib/agents.mjs';
import { FOOTPRINT } from './install/common.mjs';
import { ui, die } from './install/screen.mjs';
import { summary } from './install/summary.mjs';
import { runLive } from './install/run-live.mjs';
import { newAppPlan, createApp } from './install/new-app.mjs';
import { writeRules } from './install/rules-file.mjs';
import { copySkills } from './install/skills-copy.mjs';
import { installSkillGate } from './install/skill-gate-install.mjs';
import { copyTestKit } from './install/test-kit.mjs';
import { copyFilm } from './install/film-copy.mjs';
import { PLAN_DIR, copyCoverage, coverageOff } from './install/coverage-copy.mjs';
import { initBrain } from './install/brain.mjs';
import { upgradeCleanup } from './install/upgrade.mjs';
import { migrateBin, findMxcli, download, ensureLocalMxcli } from './install/mxcli.mjs';
import { bootPorts, reachable } from './install/probe.mjs';
export { FOOTPRINT } from './install/common.mjs';
export { summary } from './install/summary.mjs';
export { runLive } from './install/run-live.mjs';
export { DEFAULT_MX_VERSION, windowsStudioPros, newAppPlan, createApp, INSTALL_LOG, shortList, appendLog } from './install/new-app.mjs';
export { isScaffoldLeftover, mergeInto } from './install/merge.mjs';
export { writeRules, PLAN_START, PLAN_END, MXCLI_BEGIN, MXCLI_END, withMxcliSection, fenceText, unfence } from './install/rules-file.mjs';
export { copySkills } from './install/skills-copy.mjs';
export { SKILL_GATE, installSkillGate } from './install/skill-gate-install.mjs';
export { TEST_KIT, PLAYWRIGHT, lfText, kitHash, kitShipped, copyTestKit } from './install/test-kit.mjs';
export { FILM, copyFilm } from './install/film-copy.mjs';
export { COVERAGE, PLAN_DIR, copyCoverage, coverageOff } from './install/coverage-copy.mjs';
export { initBrain } from './install/brain.mjs';
export { stripOurs, upgradeCleanup } from './install/upgrade.mjs';
export { migrateBin, ensureLocalMxcli, replaceShim } from './install/mxcli.mjs';

async function main() {
  const argv = process.argv.slice(2);
  const { app, opt, run, live, mprsHere, newApp, foot, prev } = start(argv);
  const { db, picked, cov, choice } = await takeChoices({ argv, opt, app, prev });
  const { agents } = picked;

  // the bar's steps, counted up front (v1: a plan one short pushed the bar past 100%)
  ui.plan(15 + (newApp ? 1 : 0) + (cov.on ? 1 : 0) + (opt('--request') ? 1 : 0) + (argv.includes('--boot') ? 1 : 0));
  const warnings = [];
  const warn = s => { ui.note(s); warnings.push(s); };
  const lastLine = r => `${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n').filter(Boolean).pop() || `exit ${r.status}`;
  const { found, mxcli, mpr, dbName } = await mxcliAndApp({ app, prev, foot, live, newApp, mprsHere });
  const themeResult = showChoices({ app, mpr, db, dbName, agents, picked, choice, run, mxcli, warn });
  await cacheMendix({ live, mxcli, mpr, db, dbName, warn, lastLine });
  const { ruleTargets, skills, skillDirs, kit, brain } = installFiles({ app, agents, cov, prev, mpr, run, mxcli, warn });
  await refreshMxcliSkills({ live, mxcli, warn, lastLine });
  const { request } = await recordInstall({ app, opt, foot, mxcli, db, dbName, agents, skills, cov, kit, themeResult, prev });
  await smokeBoot({ argv, db, dbName, live, run, mxcli, mpr, lastLine });
  summary({ app, mpr, newApp, mxcli, downloaded: !found, ruleTargets, skillDirs, kit, theme: themeResult.theme, db, dbName, request, warnings, agents, picked, coverage: cov.on, brain });
}

// The folder, the tools runner and the last install's record: what every later phase reads.
function start(argv) {
  const app = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv.shift()) : die('usage: node install.mjs <app folder> [--db hsqldb|postgres] [--agent claude] [--remove-agent <name>] [--coverage | --no-coverage] [--theme <name>] [--yes] [--boot] [--request <file>] [--no-app]');
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const env = { ...process.env, MXCLI_QUIET: '1' };
  const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', cwd: app, env, timeout: o.timeout || 600000, stdio: 'pipe' });
  // the slow tools run without blocking, so the bar keeps its elapsed time moving and shows their phases
  const live = (cmd, args, o = {}) => { const stop = ui.live(); return runLive(cmd, args, { cwd: o.cwd || app, env, timeout: o.timeout || 600000, onLine: ui.toolLine }).finally(stop); };
  if (Number(process.versions.node.split('.')[0]) < 20) die(`Node ${process.versions.node}; the installer needs Node 20 or later`);
  if (!fs.existsSync(app)) die(`no folder ${app}`);
  ui.banner(BUNDLE);
  const mprsHere = () => fs.readdirSync(app).filter(f => f.endsWith('.mpr'));
  if (mprsHere().length > 1) die(`expected one .mpr in ${app}, found ${mprsHere().length}`, 'install into a folder that holds one Mendix app');
  // no app yet: --no-app stops before anything is written; else the version is settled now (on Windows a
  // Studio Pro of it must be installed), before mxcli is looked for or downloaded
  let newApp = null;
  if (!mprsHere().length) {
    if (argv.includes('--no-app')) die(`no Mendix app (.mpr) in ${app}, and --no-app was given`, 'install into the folder of a Mendix app, or leave out --no-app to have one created there');
    try { newApp = newAppPlan(app); } catch (e) { die(e.message, e.fix); }
  }
  ui.target(app, newApp ? `no Mendix app yet: a new one (Mendix ${newApp.version}) is created there` : `the Mendix app ${mprsHere()[0]}`);
  const foot = path.join(app, FOOTPRINT);
  // an upgrade from the v2 gate: its installed.json and downloaded mxcli move into .mxcodr/ first
  const prev = readJson(path.join(foot, 'installed.json'), null) || readJson(path.join(app, '.mxgate', 'installed.json'), {});
  migrateBin(app, prev);
  return { app, opt, run, live, mprsHere, newApp, foot, prev };
}

async function takeChoices({ argv, opt, app, prev }) {
  // the choices first, as v1 asked its questions before the bar: database (kept from the last install unless
  // given), agents, then the app's look: --theme, else the last install's (its frame refreshed), else
  // asked once on a terminal; with no terminal or --yes nothing is applied (the look mxcli new gave it stays)
  const db = opt('--db') || prev.db || (await reachable(5432) ? 'postgres' : 'hsqldb');
  if (!['hsqldb', 'postgres'].includes(db)) die(`unknown --db ${db}`, 'use --db hsqldb or --db postgres');
  // the agents: --agent adds to the last install's, --remove-agent takes one out; on a terminal with neither (and
  // no --yes) the person picks them (lib/agents.mjs); else the last install's, or Claude Code, and a note
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let picked;
  try { picked = decideAgents({ flag: argv.includes('--agent') ? opt('--agent') ?? '' : undefined, remove: argv.includes('--remove-agent') ? opt('--remove-agent') ?? '' : undefined, prev, tty, yes: argv.includes('--yes') }); } catch (e) { die(e.message, e.fix); }
  // a test per requirement: --coverage / --no-coverage, else the last install's choice, else asked on a terminal
  let cov;
  try { cov = decideCoverage({ flag: argv.includes('--coverage'), noFlag: argv.includes('--no-coverage'), prev, tty, yes: argv.includes('--yes') }); } catch (e) { die(e.message, e.fix); }
  let choice;
  try { choice = decideTheme({ flag: argv.includes('--theme') ? opt('--theme') ?? '' : undefined, prev, tty, yes: argv.includes('--yes'), active: activeFrameTheme(app) }); } catch (e) { die(e.message, 'node overlay/lib/theme.mjs list shows the themes'); }
  if (picked.how === 'ask' || cov.how === 'ask' || choice.how === 'ask') {
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const write = t => process.stdout.write(t);
    // the agents first: the theme question opens a preview in the browser
    if (picked.how === 'ask') picked = await askAgents({ rl, write, prev });
    if (cov.how === 'ask') cov = await askCoverage({ rl, write });
    if (choice.how === 'ask') choice = { name: await askTheme({ rl, write, plain: Boolean(process.env.NO_COLOR) }), how: 'flag' };
    rl.close();
  }
  return { db, picked, cov, choice };
}

async function mxcliAndApp({ app, prev, foot, live, newApp, mprsHere }) {
  // 1. mxcli: a found binary of the pinned version, else download it into .mxcodr/bin; ./mxcli is that binary
  ui.begin('finding mxcli');
  const found = findMxcli(app, prev);
  const mxcli = found || await download(foot, live);
  ui.done('mxcli', `${PIN} ${ui.i.arrow} ${mxcli}${found ? '' : ' (downloaded)'}`);
  if (newApp) {
    ui.begin(`creating the app (Mendix ${newApp.version})`);
    ui.sub('first time: MxBuild, minutes');
    let lines;
    try { lines = await createApp(app, newApp, (args, cwd) => live(mxcli, args, { cwd, timeout: 3600000 })); } catch (e) { die('Creating the Mendix app failed.', e.message, e.fix); }
    ui.done('Mendix app created', `${newApp.name}.mpr (Mendix ${newApp.version})`);
    for (const line of lines) if (!line.startsWith('Mendix app created:')) ui.note(line);
  }
  const mprs = mprsHere();
  if (mprs.length !== 1) die(`expected one .mpr in ${app}, found ${mprs.length}`);
  const mpr = mprs[0];
  const dbName = prev.dbName || path.basename(mpr, '.mpr').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  // after a new app: its scaffold's ./mxcli (a Linux build on macOS, or a link that broke in the move) is replaced
  const local = ensureLocalMxcli(app, mxcli);
  if (local) ui.note(local);
  return { found, mxcli, mpr, dbName };
}

function showChoices({ app, mpr, db, dbName, agents, picked, choice, run, mxcli, warn }) {
  // 2. database and agents
  ui.begin('choosing the database');
  ui.done('database', db === 'postgres' ? `postgres (${dbName})` : 'hsqldb');
  ui.begin('choosing the agents');
  ui.done('agents', `${agentNames(agents)}${picked.added.length ? ` (added ${agentNames(picked.added)})` : ''}`);
  if (picked.how === 'kept' || picked.how === 'default') warn(agentsNote(agents));
  if (picked.removed.length) ui.note(`removing ${agentNames(picked.removed)}: its rule and our skills go (you deselected it)`);

  // 2b. the app's look (theme/ files only)
  ui.begin('applying the theme');
  const themeResult = applyTheme({ app, mpr, choice, run: args => run(mxcli, args) });
  if (!themeResult.line) ui.done('theme', 'none chosen, the app keeps its look (--theme <name> or node .mxcodr/theme.mjs)');
  else if (themeResult.ok) ui.done('theme', themeResult.line.replace(/^theme /, ''));
  else { ui.done('theme', 'not applied'); warn(themeResult.line); }
  return themeResult;
}

async function cacheMendix({ live, mxcli, mpr, db, dbName, warn, lastLine }) {
  // 3. MxBuild and the runtime, so the agent's first boot does not pay for them
  ui.begin('caching MxBuild');
  const mxb = await live(mxcli, ['setup', 'mxbuild', '-p', mpr]);
  if (mxb.status !== 0) { ui.done('MxBuild', 'not cached'); warn(`mxcli setup mxbuild failed: ${lastLine(mxb)}`); }
  else { const v = /(\d+\.\d+\.\d+)/.exec(`${mxb.stdout}${mxb.stderr}`); ui.done('MxBuild', v ? `cached (Mendix ${v[1]})` : 'cached'); }
  ui.begin('caching the Mendix runtime');
  const setup = await live(mxcli, ['run', '--local', '--setup', ...(db === 'hsqldb' ? ['--db-type', 'hsqldb'] : ['--ensure-db', '--db-name', dbName]), '-p', mpr], { timeout: 1800000 });
  if (setup.status !== 0) die(`mxcli run --local --setup failed: ${`${setup.stderr || ''}\n${setup.stdout || ''}`.trim().split('\n').slice(-2).join(' ')}`, db === 'postgres' ? 'or install with --db hsqldb' : '');
  ui.done('runtime', `cached (${db})`);
}

function installFiles({ app, agents, cov, prev, mpr, run, mxcli, warn }) {
  // 4-6. the earlier bundles' files out, then our rule file and skills in
  for (const line of upgradeCleanup(app)) ui.note(`removed ${line}`);
  ui.begin('installing the session rule');
  let ruleLines; try { ruleLines = writeRules(app, agents, { coverage: cov.on }); } catch (e) { die(`the rule file failed its format check: ${e.message}`); }
  const ruleTargets = [];
  for (const line of ruleLines) { const m = /^rule (?:file|text) -> (\S+)/.exec(line); if (m) ruleTargets.push(m[1]); }
  ui.done('session rule', `${ruleTargets.length} ${ui.i.arrow} ${ruleTargets.join(', ') || 'none'}`);
  for (const line of ruleLines) if (!/^rule (?:file|text) -> /.test(line)) ui.note(/\s/.test(line) ? line : `removed ${line} (no agent that reads it was chosen)`);
  ui.begin('installing skills');
  const skills = skillsFor({ coverage: cov.on });
  const skillDirs = copySkills(app, agents, undefined, { coverage: cov.on }).map(l => l.replace(/^\d+ skills -> /, ''));
  ui.done('skills', `${skills.length} ${ui.i.arrow} ${skillDirs.length > 1 ? `each of ${skillDirs.join(' ')}` : skillDirs[0]}`);
  ui.begin('installing the skill gate');
  let gate = null, gateErr = null;
  try { gate = installSkillGate(app, agents); } catch (e) { gateErr = e.message; }
  ui.done('skill gate', gateErr ? 'not installed' : gate ? `${ui.i.arrow} ${gate}` : 'none (Claude Code not chosen)');
  if (gateErr) warn(`skill gate: ${gateErr}`);
  ui.begin('installing the test kit');
  const kit = copyTestKit(app, Array.isArray(prev.testKit) ? prev.testKit : []);
  const changed = [...kit.written, ...kit.updated];
  ui.done('test kit', changed.length ? `${changed.length} ${ui.i.arrow} ${changed.join(', ')}${kit.updated.length ? ` (${kit.updated.length} updated)` : ''}` : kit.kept.length ? `kept ${kit.kept.join(', ')}` : 'nothing written');
  // the written ones are on the done line; every other line (updated, yours, skipped, pin) is a note
  for (const line of kit.lines) if (!line.startsWith('test kit -> ') && !(!changed.length && line.startsWith('test kit: kept '))) ui.note(line);
  ui.begin('installing the film recorder');
  ui.done('film recorder', `1 ${ui.i.arrow} ${copyFilm(app)} (written on every install; the film-tests skill says how to use it)`);
  // the project brain on every install (owner contract 2026-11-14): the agent captures requirements, open questions
  // and findings into it with or without coverage; docs/brain/ is the app's and is never overwritten or removed
  ui.begin('creating the project brain');
  const brain = initBrain(app, mpr, args => run(mxcli, args));
  ui.done('project brain', brain === null ? 'docs/brain/ kept as it was (the app\'s, never overwritten)' : brain.ok ? 'docs/brain/ created (mxcli brain init)' : 'docs/brain/ not created');
  if (brain && !brain.ok) warn(brain.line);
  if (cov.on) {
    ui.begin('installing the coverage check');
    ui.done('coverage', `1 ${ui.i.arrow} ${copyCoverage(app)} (written on every install; requirements in ${PLAN_DIR}/)`);
  } else {
    const off = coverageOff(app, prev);
    if (off) ui.note(off);
  }
  ui.begin('installing the theme tool');
  ui.done('theme tool', `${ui.i.arrow} ${installThemeTool(app)}`);
  return { ruleTargets, skills, skillDirs, kit, brain };
}

async function refreshMxcliSkills({ live, mxcli, warn, lastLine }) {
  // mxcli's own skills and its section of CLAUDE.md/AGENTS.md, after writeRules: an AGENTS.md that had no mxcli
  // section has its markers now, and this fills them (it leaves our block, outside them, as it is)
  ui.begin("refreshing mxcli's own skills");
  const sync = await live(mxcli, ['init', '--sync-skills', '.']);
  if (sync.status === 0) ui.done('mxcli skills', `current for ${PIN}`);
  else { ui.done('mxcli skills', 'not refreshed'); warn(`mxcli init --sync-skills failed: ${lastLine(sync)}`); }
}

async function recordInstall({ app, opt, foot, mxcli, db, dbName, agents, skills, cov, kit, themeResult, prev }) {
  // installed.json: what a later person-run report or gate would read, nothing else
  const inst = { bundle: BUNDLE, mxcli: { path: mxcli, version: PIN }, db, ...(db === 'postgres' ? { dbName } : {}), agents, skills, ...coverageRecord(cov), testKit: kit.ours, ...(kit.edited.length ? { testKitEdited: kit.edited } : {}), theme: themeResult.theme, requests: prev.requests || {} };
  let request = null;
  if (opt('--request')) {
    ui.begin('saving the request');
    const { saveRequest } = await import('./lib/requests.mjs');
    let text; try { text = fs.readFileSync(opt('--request'), 'utf8'); } catch (e) { die(`--request ${opt('--request')}: ${e.code || e.message}`); }
    const file = saveRequest(app, text, 'install', inst.requests);
    request = file ? `docs/requests/${file}` : null;
    ui.done('request', file ? `${ui.i.arrow} docs/requests/${file} (word for word)` : 'the same text is saved already in docs/requests/');
  }
  ui.begin('recording the install');
  writeAtomic(path.join(foot, 'installed.json'), inst);
  ui.done('install record', `${ui.i.arrow} ${FOOTPRINT}/installed.json (bundle ${BUNDLE})`);
  return { request };
}

async function smokeBoot({ argv, db, dbName, live, run, mxcli, mpr, lastLine }) {
  // 7. a smoke boot when asked: the app boots and answers, then stops again
  if (argv.includes('--boot')) {
    ui.begin('booting the app once');
    const dbArgs = db === 'hsqldb' ? ['--db-type', 'hsqldb'] : ['--db-name', dbName];
    // Mendix's default ports when free, else three free ones: another app on this machine may hold them
    const pt = await bootPorts();
    const portArgs = pt.dflt ? [] : ['--app-port', String(pt.app), '--admin-port', String(pt.admin), '--serve-port', String(pt.serve)];
    const b = await live(mxcli, ['run', '--local', '--detach', ...portArgs, ...dbArgs, '-p', mpr], { timeout: 15 * 60000 });
    if (b.status !== 0) die(`the app did not boot: ${`${b.stderr || ''}\n${b.stdout || ''}`.trim().split('\n').slice(-3).join(' | ')}`, 'see .mxcli/run.log');
    const w = await live(mxcli, ['run', 'wait', '--ready', '--timeout', '10m', '-p', mpr], { timeout: 11 * 60000 });
    const st = run(mxcli, ['run', 'status', '-p', mpr]);
    await live(mxcli, ['run', 'stop', '-p', mpr], { timeout: 120000 });
    if (w.status !== 0) die(`the app is not ready: ${lastLine(w)}`, 'see .mxcli/run.log');
    ui.done('smoke boot', `the app boots (${(st.stdout || '').trim().split('\n').pop()}); stopped again`);
  }
}

export function parseAgents(s) {
  const list = [...new Set(String(s).split(',').map(a => a.trim().toLowerCase()).filter(Boolean))];
  for (const a of list) if (!AGENTS.includes(a)) die(`unknown agent ${a}`, `use one or more of ${AGENTS.join(', ')}`);
  return list;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main().catch(e => die(`The installer stopped unexpectedly: ${e.message}`, ...String(e.stack || '').split('\n').slice(1, 4).map(l => l.trim()), 'Nothing after this step was done. Please report these lines.'));
