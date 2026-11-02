// The mx-codr installer (harness v2, skills only). install.sh runs it from the bundle:
//   node overlay/install.mjs <app folder> [--db hsqldb|postgres] [--agent claude,cursor,codex,opencode,pi] [--remove-agent <name>] [--theme <name>] [--yes] [--boot] [--request <file>] [--no-app]
// A folder with no .mpr first gets a new Mendix app (mxcli new; MX_VERSION, APP_NAME), unless --no-app.
// It installs nothing that runs while the agent builds: the pinned mxcli, MxBuild and the runtime cached,
// the database chosen, mxcli's own skills refreshed, one always-on rule file per agent (asked on a terminal,
// --agent adds one to the last install's, --remove-agent takes one out), our skills beside
// mxcli's, a starter test kit in tests/ (only the files that are absent), tests/film.mjs (always), the app's look when one is chosen (theme/ only),
// .mxcodr/theme.mjs to change it later, and .mxcodr/installed.json (+ .mxcodr/bin/mxcli when it had to download mxcli). Run it again to
// repair or upgrade; an earlier bundle's gate (./mxgate, .mxgate/) and v1's hooks and checkers are removed.
// What it prints looks like v1's installer (lib/ui.mjs): the banner, one numbered bar over the steps, a ✔ line
// per step, ! notes, a red ✘ on failure, and the summary.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeAtomic } from './lib/cache.mjs';
import { PIN, BUNDLE } from './lib/mx.mjs';
import { readTemplate, ruleText, mdcText, agentsBlockDir, checkRule, SKILLS_DIR, AGENTS, START, END } from './lib/rules.mjs';
import { INSTALLED_SKILLS, OPTIONAL_SKILLS, RETIRED_SKILLS } from './lib/skills.mjs';
import { decideTheme, activeFrameTheme, applyTheme, askTheme, installThemeTool } from './lib/theme.mjs';
import { makeUi } from './lib/ui.mjs';
import { decideAgents, askAgents, agentsNote, agentNames, agentStartLines, AGENT_INFO } from './lib/agents.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = makeUi();
// v1's ui_fail: a red cross, the message in bold, the fix indented below it; exit 2 (the tests and the eval runner read it)
const die = (s, ...fix) => { ui.fail(s, ...fix.filter(Boolean)); process.exit(2); };

export const FOOTPRINT = '.mxcodr';

async function main() {
  const argv = process.argv.slice(2);
  const app = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv.shift()) : die('usage: node install.mjs <app folder> [--db hsqldb|postgres] [--agent claude] [--remove-agent <name>] [--theme <name>] [--yes] [--boot] [--request <file>] [--no-app]');
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
  let choice;
  try { choice = decideTheme({ flag: argv.includes('--theme') ? opt('--theme') ?? '' : undefined, prev, tty, yes: argv.includes('--yes'), active: activeFrameTheme(app) }); } catch (e) { die(e.message, 'node overlay/lib/theme.mjs list shows the themes'); }
  if (picked.how === 'ask' || choice.how === 'ask') {
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const write = t => process.stdout.write(t);
    // the agents first: the theme question opens a preview in the browser
    if (picked.how === 'ask') picked = await askAgents({ rl, write, prev });
    if (choice.how === 'ask') choice = { name: await askTheme({ rl, write, plain: Boolean(process.env.NO_COLOR) }), how: 'flag' };
    rl.close();
  }
  const { agents } = picked;

  // the bar's steps, counted up front (v1: a plan one short pushed the bar past 100%)
  ui.plan(13 + (newApp ? 1 : 0) + (opt('--request') ? 1 : 0) + (argv.includes('--boot') ? 1 : 0));
  const warnings = [];
  const warn = s => { ui.note(s); warnings.push(s); };
  const lastLine = r => `${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n').filter(Boolean).pop() || `exit ${r.status}`;

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

  // 3. MxBuild and the runtime, so the agent's first boot does not pay for them
  ui.begin('caching MxBuild');
  const mxb = await live(mxcli, ['setup', 'mxbuild', '-p', mpr]);
  if (mxb.status !== 0) { ui.done('MxBuild', 'not cached'); warn(`mxcli setup mxbuild failed: ${lastLine(mxb)}`); }
  else { const v = /(\d+\.\d+\.\d+)/.exec(`${mxb.stdout}${mxb.stderr}`); ui.done('MxBuild', v ? `cached (Mendix ${v[1]})` : 'cached'); }
  ui.begin('caching the Mendix runtime');
  const setup = await live(mxcli, ['run', '--local', '--setup', ...(db === 'hsqldb' ? ['--db-type', 'hsqldb'] : ['--ensure-db', '--db-name', dbName]), '-p', mpr], { timeout: 1800000 });
  if (setup.status !== 0) die(`mxcli run --local --setup failed: ${`${setup.stderr || ''}\n${setup.stdout || ''}`.trim().split('\n').slice(-2).join(' ')}`, db === 'postgres' ? 'or install with --db hsqldb' : '');
  ui.done('runtime', `cached (${db})`);

  // 4-6. the earlier bundles' files out, then our rule file and skills in
  for (const line of upgradeCleanup(app)) ui.note(`removed ${line}`);
  ui.begin('installing the session rule');
  let ruleLines; try { ruleLines = writeRules(app, agents); } catch (e) { die(`the rule file failed its format check: ${e.message}`); }
  const ruleTargets = [];
  for (const line of ruleLines) { const m = /^rule (?:file|text) -> (\S+)/.exec(line); if (m) ruleTargets.push(m[1]); }
  ui.done('session rule', `${ruleTargets.length} ${ui.i.arrow} ${ruleTargets.join(', ') || 'none'}`);
  for (const line of ruleLines) if (!/^rule (?:file|text) -> /.test(line)) ui.note(/\s/.test(line) ? line : `removed ${line} (no agent that reads it was chosen)`);
  ui.begin('installing skills');
  const skillDirs = copySkills(app, agents).map(l => l.replace(/^\d+ skills -> /, ''));
  ui.done('skills', `${INSTALLED_SKILLS.length} ${ui.i.arrow} ${skillDirs.length > 1 ? `each of ${skillDirs.join(' ')}` : skillDirs[0]}`);
  ui.begin('installing the test kit');
  const kit = copyTestKit(app, Array.isArray(prev.testKit) ? prev.testKit : []);
  const keptLine = `kept the app's own ${kit.kept.join(', ')}`;
  ui.done('test kit', kit.written.length ? `${kit.written.length} ${ui.i.arrow} ${kit.written.join(', ')}` : kit.kept.length ? keptLine : 'nothing written');
  for (const line of kit.lines) if (!line.startsWith('test kit -> ') && !(line === `test kit: ${keptLine}` && !kit.written.length)) ui.note(line);
  ui.begin('installing the film recorder');
  ui.done('film recorder', `1 ${ui.i.arrow} ${copyFilm(app)} (written on every install; the film-tests skill says how to use it)`);
  ui.begin('installing the theme tool');
  ui.done('theme tool', `${ui.i.arrow} ${installThemeTool(app)}`);
  // mxcli's own skills and its section of CLAUDE.md/AGENTS.md, after writeRules: an AGENTS.md that had no mxcli
  // section has its markers now, and this fills them (it leaves our block, outside them, as it is)
  ui.begin("refreshing mxcli's own skills");
  const sync = await live(mxcli, ['init', '--sync-skills', '.']);
  if (sync.status === 0) ui.done('mxcli skills', `current for ${PIN}`);
  else { ui.done('mxcli skills', 'not refreshed'); warn(`mxcli init --sync-skills failed: ${lastLine(sync)}`); }

  // installed.json: what a later person-run report or gate would read, nothing else
  const inst = { bundle: BUNDLE, mxcli: { path: mxcli, version: PIN }, db, ...(db === 'postgres' ? { dbName } : {}), agents, skills: INSTALLED_SKILLS, testKit: kit.ours, theme: themeResult.theme, requests: prev.requests || {} };
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
  summary({ app, mpr, newApp, mxcli, downloaded: !found, ruleTargets, skillDirs, kit, theme: themeResult.theme, db, dbName, request, warnings, agents, picked });
}

// ---- the summary: what landed, what to do now (v1's summary.sh, with v2's content) --------------------

// out: the ui to print with (the tests pass their own)
export function summary({ app, mpr, newApp, mxcli, downloaded, ruleTargets, skillDirs, kit, theme, db, dbName, request, warnings, agents, picked = { added: [], removed: [] } }, out = ui) {
  const ui = out;
  const { c, i } = ui;
  const note = s => `${c.grey}${s}${c.reset}`;
  ui.clear();
  ui.line(`\n  ${c.green}${i.ok} Installed mx-codr ${BUNDLE}${c.reset}`);
  ui.line(`  ${c.grey}  ${i.arrow} ${app}${c.reset}`);

  ui.head(i.box, 'What landed');
  if (newApp) ui.row('app', 1, `${newApp.name}.mpr  ${note(`(created empty, Mendix ${newApp.version})`)}`);
  ui.row('mxcli', 1, `${mxcli}  ${note(`(${PIN}${downloaded ? ', downloaded' : ''}; ./mxcli is this one)`)}`);
  ui.row('agents', agents.length, `${agentNames(agents)}${picked.added.length ? `  ${note(`(${agentNames(picked.added)} added now)`)}` : ''}`);
  if (picked.removed.length) ui.row('removed', picked.removed.length, `${agentNames(picked.removed)}  ${note('(deselected: its rule and our skills were taken out)')}`);
  ui.row('rule', ruleTargets.length, `${ruleTargets.join('  ')}  ${note('(every session)')}`);
  ui.row('skills', INSTALLED_SKILLS.length, `${skillDirs.join('  ')}  ${note("(beside mxcli's own)")}`);
  if (kit.written.length) ui.row('test kit', kit.written.length, `tests/  ${note('(written only when absent; yours from now on)')}`);
  else ui.row('test kit', 0, 'tests/ already had them, nothing overwritten');
  ui.row('film', 1, `tests/film.mjs  ${note('(node tests/film.mjs --list)')}`);
  ui.row('theme', theme && theme !== 'as-is' ? 1 : 0, `${theme && theme !== 'as-is' ? theme : 'as mxcli new made it'}  ${note('(node .mxcodr/theme.mjs changes it)')}`);
  ui.row('database', 1, `${db === 'postgres' ? `postgres, ${dbName}` : 'hsqldb'}  ${note('(MxBuild and the runtime cached)')}`);
  if (request) ui.row('request', 1, `${request}  ${note('(word for word)')}`);
  ui.row('record', 1, `${FOOTPRINT}/installed.json  ${note(`(bundle ${BUNDLE})`)}`);

  for (const w of warnings) ui.line(`\n  ${c.yellow}${i.warn}${c.reset} ${w}`);

  // the one thing to do now, first: the agent works in the app folder
  ui.head(i.play, 'Now');
  ui.line(`     ${c.bold}Start ${agents.length > 1 ? 'one of your agents' : 'your agent'} in the app folder and ask it for a feature:${c.reset}`);
  ui.line(`       cd "${app}"`);
  for (const [cmd, name, where] of agentStartLines(agents)) ui.line(`       ${cmd.padEnd(13)} ${name.padEnd(12)} ${note(where)}`);
  ui.line(`     ${c.bold}A session already open here must be restarted:${c.reset} skills are read when a session starts.`);

  const nextRows = [
    ['cd tests && npx playwright test', 'the suite the agent keeps (--shuffle before done)'],
    ['node tests/film.mjs --list', 'film a test, slowed so a person can follow'],
    ['node .mxcodr/theme.mjs', "change the app's look in seconds"],
    [`./mxcli run --local${db === 'hsqldb' ? ' --db-type hsqldb' : ''} -p ${mpr}`, 'boot the app yourself; ./mxcli run stop ends it'],
  ];
  // v1's column is 38 wide; a longer command (a long app name) widens it so the descriptions stay aligned
  const width = Math.max(38, ...nextRows.map(([cmd]) => cmd.length));
  ui.head(i.play, 'Next');
  for (const [cmd, what] of nextRows) ui.line(`     ${cmd.padEnd(width)} ${note(what)}`);

  ui.head(i.dot, 'Good to know');
  ui.line("     Why the restart: an agent's skill list is fixed when its session starts, so the skills this installer");
  ui.line('     just wrote are invisible to the session that ran it. Measured: a session that installed');
  ui.line('     and then built without restarting read twelve SKILL.md files by hand -- 216k characters,');
  ui.line('     36 commands, 6.5 minutes -- before its first real command. After a restart: 8 commands.');
  ui.line('     The agent reads the rule file by itself; nothing runs while it builds: no hooks, no gate.');
  if (agents.includes('cursor')) ui.line(`     Cursor reads ${c.bold}.cursor/rules/mxcodr.mdc${c.reset} (alwaysApply); restart an open session to pick it up.`);
  if (agents.some(a => ['codex', 'opencode', 'pi'].includes(a))) ui.line(`     Codex, opencode and Pi read our block in ${c.bold}AGENTS.md${c.reset}, after mxcli's section.`);
  ui.line(`     Another agent: ${c.bold}bash mxcodr/install.sh --agent <name>${c.reset} adds it (${Object.keys(AGENT_INFO).join(', ')}); --remove-agent <name> takes one out.`);
  ui.line(`     Run ${c.bold}bash mxcodr/install.sh${c.reset} again to repair or upgrade; your tests/ files stay.`);
  ui.line('');
}

// Runs a tool without blocking the event loop (the bar is redrawn meanwhile); every output line goes to onLine.
// -> Promise<{ status, stdout, stderr }>, status null when it could not start or ran past the timeout (then it is
// stopped by its own PID). After the tool exits its pipes get 2 s to close: a daemon it left behind may hold them
// (MxBuild's Gradle on Windows held mxcli's, v1).
export function runLive(cmd, args, { cwd, env = process.env, timeout = 600000, onLine = () => {} } = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', buf = '', finished = false, grace = null;
    let child;
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { resolve({ status: null, stdout: '', stderr: e.message }); return; }
    const feed = chunk => {
      buf += chunk;
      let n;
      while ((n = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, n);
        buf = buf.slice(buf[n] === '\r' && buf[n + 1] === '\n' ? n + 2 : n + 1);
        if (line.trim()) onLine(line);
      }
    };
    const killer = setTimeout(() => { child.kill(); }, timeout);
    const finish = status => {
      if (finished) return;
      finished = true;
      clearTimeout(killer); clearTimeout(grace);
      if (buf.trim()) onLine(buf);
      resolve({ status, stdout, stderr });
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { stdout += d; feed(d); });
    child.stderr.on('data', d => { stderr += d; feed(d); });
    child.on('error', e => { stderr += e.message; finish(null); });
    child.on('exit', (code, signal) => { grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(signal ? null : code); }, 2000); });
    child.on('close', (code, signal) => finish(signal ? null : code));
  });
}

export function parseAgents(s) {
  const list = [...new Set(String(s).split(',').map(a => a.trim().toLowerCase()).filter(Boolean))];
  for (const a of list) if (!AGENTS.includes(a)) die(`unknown agent ${a}`, `use one or more of ${AGENTS.join(', ')}`);
  return list;
}

// ---- 0. a new app when the folder has none --------------------------------------------------------

// The Mendix version of a new app when MX_VERSION is not set, on every platform (as v1 on macOS and Linux).
export const DEFAULT_MX_VERSION = '11.12.1';

// Installed Studio Pro versions on Windows -> [{ version, mx, perUser }], oldest first. mxcli looks only in
// C:\Program Files\Mendix; a per-user install (%LOCALAPPDATA%\Programs\Mendix) is found here too (as v1 did).
export function windowsStudioPros({ env = process.env, exists = fs.existsSync, list = d => fs.readdirSync(d) } = {}) {
  const roots = [['C:\\Program Files\\Mendix', false], ['C:\\Program Files (x86)\\Mendix', false]];
  if (env.LOCALAPPDATA) roots.push([path.win32.join(env.LOCALAPPDATA, 'Programs', 'Mendix'), true]);
  const out = [];
  for (const [root, perUser] of roots) {
    let names = []; try { names = list(root); } catch { continue; }
    for (const n of names) {
      const mx = path.win32.join(root, n, 'modeler', 'mx.exe');
      const version = (n.match(/^\d+\.\d+\.\d+/) || [])[0];
      if (version && exists(mx) && !out.some(o => o.version === version)) out.push({ version, mx, perUser });
    }
  }
  const key = v => v.split('.').map(Number);
  return out.sort((a, b) => { const x = key(a.version), y = key(b.version); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
}

// What a new app is created as: { name, version, studioPro? }. Throws (with .fix) when that cannot be done here.
// Name: APP_NAME, else the folder's name in letters and digits, 'App' in front when it starts with a digit.
// Version: MX_VERSION, else 11.12.1. On Windows that version's Studio Pro must be installed: the Mendix CDN's
// MxBuild is Linux-only there, and a version Studio Pro does not have would be stamped with its own. Never installs one.
export function newAppPlan(app, { env = process.env, platform = process.platform, studioPros = () => windowsStudioPros({ env }) } = {}) {
  const fail = (msg, fix) => Object.assign(new Error(msg), { fix });
  let name = env.APP_NAME || path.basename(app).replace(/[^A-Za-z0-9]/g, '');
  if (!/^[A-Za-z]/.test(name)) name = `App${name}`;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw fail(`APP_NAME ${name} is not a Mendix app name`, 'use letters and digits, starting with a letter');
  const version = env.MX_VERSION || DEFAULT_MX_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw fail(`MX_VERSION ${version} is not a Mendix version`, 'MX_VERSION=11.12.1 (three numbers)');
  if (platform !== 'win32') return { name, version };
  const all = studioPros();
  const sp = all.find(s => s.version === version);
  if (!sp) throw fail(`no Studio Pro ${version} installed, and on Windows the app is created with Studio Pro's own mx.exe (looked in C:\\Program Files\\Mendix and %LOCALAPPDATA%\\Programs\\Mendix)`,
    all.length ? `installed here: ${all.map(s => s.version).join(', ')}; run again with MX_VERSION=<one of them>, or install Studio Pro ${version}` : `install Studio Pro ${version} (the installer never installs it), or set MX_VERSION to the version you have`);
  return { name, version, studioPro: sp };
}

// Creates the app in a temporary folder and moves it in, so the folder may already hold mxcodr/ and other files
// (mergeInto says which are replaced and which kept). run(args, cwd) runs mxcli.
// On Windows mxcli new skips its first build (MxBuild's Gradle daemon held mxcli's pipe, v1), and a per-user
// Studio Pro mxcli cannot see creates the project with its own mx.exe, then mxcli init (as v1). run may return a
// promise (the installer runs mxcli new without blocking, so the bar moves). -> Promise<lines to print>: short
// ones; the full lists of paths go to .mxcodr/install.log.
export async function createApp(app, plan, run, { tmpRoot = os.tmpdir(), runMx = (exe, args) => spawnSync(exe, args, { encoding: 'utf8', timeout: 3600000, stdio: 'pipe' }), merge = mergeInto } = {}) {
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'mxcodr-new-'));
  const out = path.join(tmp, 'app');
  const fail = (what, r) => Object.assign(new Error(`${what} failed: ${`${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-3).join(' | ') || `exit ${r.status}`}`), { fix: `run it by hand to see why: mxcli new ${plan.name} --version ${plan.version} --output-dir <an empty folder>` });
  const lines = [];
  // Ctrl-C while mxcli new runs: the folder is untouched, only the temporary one goes. While the app moves in it
  // waits: a JS listener means the signal no longer ends the process at once, so the moves (sync) finish or are
  // undone first, and the run ends after them with an app that is whole.
  let moving = false, pending = null;
  const onSignal = sig => { if (moving) { pending = sig; return; } fs.rmSync(tmp, { recursive: true, force: true }); process.exit(130); };
  for (const sig of SIGNALS) process.on(sig, onSignal);
  try {
    if (plan.studioPro?.perUser) {
      const r = runMx(plan.studioPro.mx, ['create-project', '--app-name', plan.name, '--output-dir', out]);
      if (r.status !== 0) throw fail(`${plan.studioPro.mx} create-project`, r);
      const i = await run(['init', out], tmp);
      if (i.status !== 0) lines.push(`warning: mxcli init failed: ${(i.stderr || i.stdout || '').trim().split('\n').pop()}`);
    } else {
      const r = await run(['new', plan.name, '--version', plan.version, '--output-dir', out, ...(plan.studioPro ? ['--skip-build'] : [])], tmp);
      if (r.status !== 0) throw fail('mxcli new', r);
    }
    if (!fs.existsSync(out) || !fs.readdirSync(out).some(f => f.endsWith('.mpr'))) throw Object.assign(new Error(`mxcli new made no .mpr in ${out}`), { fix: `mxcli new ${plan.name} --version ${plan.version} --output-dir <an empty folder>` });
    moving = true;
    let merged;
    try { merged = merge(out, app); } finally {
      // a signal that came during the moves is delivered on the next turn of the event loop
      await new Promise(r => setTimeout(r, 0));
      moving = false;
      if (pending) { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(130); }
    }
    const { kept, replaced, setAside } = merged;
    lines.push(`Mendix app created: ${plan.name}.mpr (Mendix ${plan.version})`);
    const log = [];
    if (replaced.length) {
      lines.push(`replaced ${count(replaced, 'file')} an earlier mxcli scaffold left here with the new app's copies${replaced.length > SHOWN ? ` (list in ${INSTALL_LOG})` : `: ${replaced.join(', ')}`}`);
      log.push(`replaced (left by an earlier mxcli scaffold, the new app's copy put in):`, ...replaced.map(r => `  ${r}`));
    }
    for (const [from, to] of setAside) { lines.push(`moved ${from} to ${to}: it had no .mpr, and the new app's units must not mix with it`); log.push(`moved aside: ${from} -> ${to}`); }
    if (kept.length) {
      lines.push(`kept ${count(kept, 'file')} already in the folder (the new app's copy left out): ${shortList(kept, `list in ${INSTALL_LOG}`)}`);
      log.push(`kept (the folder's own, the new app's copy left out):`, ...kept.map(r => `  ${r}`));
    }
    if (log.length) appendLog(app, [`creating ${plan.name}.mpr (Mendix ${plan.version})`, ...log]);
    return lines;
  } finally {
    for (const sig of SIGNALS) process.off(sig, onSignal);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const SIGNALS = process.platform === 'win32' ? ['SIGINT'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
export const INSTALL_LOG = `${FOOTPRINT}/install.log`;
const SHOWN = 5;
const count = (list, what) => `${list.length} ${what}${list.length === 1 ? '' : 's'}`;
// at most five names on screen, then "and N more (<where>)": a note is one line, never a wall
export function shortList(list, where, max = SHOWN) {
  return list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} and ${list.length - max} more (${where})`;
}
// .mxcodr/install.log: what the screen only counts, one dated block per install
export function appendLog(app, lines) {
  fs.mkdirSync(path.join(app, FOOTPRINT), { recursive: true });
  fs.appendFileSync(path.join(app, INSTALL_LOG), `# ${new Date().toISOString()} bundle ${BUNDLE}\n${lines.join('\n')}\n\n`);
}

// Which of the folder's files, at a path the fresh scaffold also has, are leftovers of an earlier mxcli
// new/init here (the folder has no .mpr, so they belong to no app) and are replaced by the new copy. The rule:
// only what mxcli itself writes and nobody edits by hand -- .ai-context/, mxcli's skills, commands and lint
// rules under .claude/, .claude/settings.json, lint-config.yaml and bootstrap-mxcli.sh, .mxcli/,
// .devcontainer/, .playwright/, .mendix-cache/, .classpath, .project; CLAUDE.md and AGENTS.md only when
// nothing but mxcli's section (and our block) is in them; .gitignore only when every line of it is in the
// new one. Everything else at a shared path is the person's and is kept (.claude/rules/, README.md, a
// CLAUDE.md with their own text, a .gitignore they added lines to...): when in doubt, keep.
const SCAFFOLD_DIRS = ['.ai-context/', '.claude/skills/', '.claude/commands/', '.claude/lint-rules/', '.mxcli/', '.devcontainer/', '.playwright/', '.mendix-cache/'];
const SCAFFOLD_FILES = '.claude/settings.json .claude/lint-config.yaml .claude/bootstrap-mxcli.sh .classpath .project'.split(' ');
export function isScaffoldLeftover(rel, theirs, fresh) {
  if (SCAFFOLD_FILES.includes(rel) || SCAFFOLD_DIRS.some(d => rel.startsWith(d))) return true;
  const text = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  if (rel === 'CLAUDE.md' || rel === 'AGENTS.md') {
    const t = text(theirs);
    return t !== null && t.includes(MXCLI_BEGIN) && !unfence(unfence(t, MXCLI_BEGIN, MXCLI_END), START, END).trim();
  }
  if (rel === '.gitignore') {
    const t = text(theirs), n = text(fresh);
    if (t === null || n === null) return false;
    const ok = new Set(n.split(/\r?\n/).map(l => l.trim()));
    return t.split(/\r?\n/).every(l => !l.trim() || ok.has(l.trim()));
  }
  return false;
}

// Moves the new app (src) into dst. A name dst lacks is moved in; a folder on both sides is merged; a file on
// both sides is replaced when isScaffoldLeftover says so, else kept (the scaffold's copy dropped). A leftover
// mprcontents/ (no .mpr beside it) is moved aside whole: units of two apps must never mix.
// All-or-nothing: everything is planned first, the .mpr moves last, and a failure part-way undoes every move
// (the replaced leftovers come back from .mxcodr/merge-backup/), so a failed run never leaves scaffold files
// without an app (createApp holds Ctrl-C off until the moves are over).
// -> { kept, replaced, setAside: [[from, to]] }, paths relative to dst.
export function mergeInto(src, dst, { move = moveEntry } = {}) {
  const kept = [], replaced = [], setAside = [], steps = [];
  const plan = (rel) => {
    for (const n of fs.readdirSync(path.join(src, rel))) {
      const r = rel ? `${rel}/${n}` : n, s = path.join(src, r), d = path.join(dst, r);
      let there = null; try { there = fs.lstatSync(d); } catch { /* absent */ }
      const sDir = fs.lstatSync(s).isDirectory();
      if (!there) steps.push({ s, d, r });
      else if (r === 'mprcontents' && sDir) {
        let to = 'mprcontents.old', k = 1;
        while (fs.existsSync(path.join(dst, to))) to = `mprcontents.old${++k}`;
        steps.push({ s: d, d: path.join(dst, to), r: to, aside: true }, { s, d, r });
        setAside.push(['mprcontents/', `${to}/`]);
      } else if (there.isDirectory() && !there.isSymbolicLink() && sDir) plan(r);
      else if (!there.isDirectory() && !sDir && isScaffoldLeftover(r, d, s)) { steps.push({ s, d, r, replace: true }); replaced.push(r); }
      else kept.push(r);
    }
  };
  plan('');
  // the app last: mprcontents/, then the .mpr, so an app is either whole or not there
  const rank = st => (st.aside ? 0 : st.r === 'mprcontents' ? 1 : /^[^/]+\.mpr$/.test(st.r) ? 2 : 0);
  steps.sort((a, b) => rank(a) - rank(b));
  const backup = path.join(dst, FOOTPRINT, 'merge-backup');
  const done = [];
  try {
    for (const st of steps) {
      if (st.replace) {
        const b = path.join(backup, st.r);
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.renameSync(st.d, b);
        done.push({ undo: () => fs.renameSync(b, st.d) });
      }
      const copied = move(st.s, st.d);
      done.push({ undo: () => { if (copied) fs.rmSync(st.d, { recursive: true, force: true }); else fs.renameSync(st.d, st.s); } });
    }
  } catch (e) {
    for (const st of done.reverse()) { try { st.undo(); } catch { /* best effort: keep undoing the rest */ } }
    fs.rmSync(backup, { recursive: true, force: true });
    try { fs.rmdirSync(path.join(dst, FOOTPRINT)); } catch { /* not empty, or absent: fine */ }
    throw Object.assign(new Error(`moving the new app into the folder failed (${e.code || e.message}); every move was undone`), { fix: 'free the folder (no file open or locked in it) and run the installer again' });
  }
  fs.rmSync(backup, { recursive: true, force: true });
  try { fs.rmdirSync(path.join(dst, FOOTPRINT)); } catch { /* not empty, or absent: fine */ }
  return { kept, replaced, setAside };
}

// src -> dst by rename, by copy across volumes (EXDEV); -> true when it was copied (src still there)
function moveEntry(s, d) {
  try { fs.renameSync(s, d); return false; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  try { fs.cpSync(s, d, { recursive: true, verbatimSymlinks: true }); } catch (e) { fs.rmSync(d, { recursive: true, force: true }); throw e; }
  return true;
}

// ---- 4. the always-on rule file, one copy per agent --------------------------------------------------

const RULE_FILES = { claude: '.claude/rules/mxcodr.md', cursor: '.cursor/rules/mxcodr.mdc' };

// Writes the rule file for each agent and checks what it wrote; removes our copy for agents not chosen.
// Returns the lines to print. Throws when a written file fails the format check.
export function writeRules(app, agents) {
  const out = [];
  const text = readTemplate('mxcodr.md');
  const write = (rel, body, mdc) => {
    const f = path.join(app, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    const errs = checkRule(fs.readFileSync(f, 'utf8'), { mdc });
    if (errs.length) throw new Error(`${rel}: ${errs.join('; ')}`);
    out.push(`rule file -> ${rel}`);
  };
  if (agents.includes('claude')) write(RULE_FILES.claude, ruleText(SKILLS_DIR.claude, text), false);
  else rmIf(app, RULE_FILES.claude, out);
  if (agents.includes('cursor')) write(RULE_FILES.cursor, mdcText(text), true);
  else rmIf(app, RULE_FILES.cursor, out);
  const agentsMd = path.join(app, 'AGENTS.md');
  const dir = agentsBlockDir(agents);
  let old = fs.existsSync(agentsMd) ? fs.readFileSync(agentsMd, 'utf8') : '';
  if (dir) {
    const block = ruleText(dir, text);
    const errs = checkRule(block);
    if (errs.length) throw new Error(`AGENTS.md block: ${errs.join('; ')}`);
    // `mxcli init` regenerates an AGENTS.md without its markers whole, and keeps what lies outside them:
    // with no mxcli section here our block would be lost on the next init, so its (empty) markers go first
    if (!old.includes(MXCLI_BEGIN)) {
      old = withMxcliSection(old);
      out.push(`AGENTS.md had no mxcli section; wrote its markers first, so mxcli init keeps our block${fs.existsSync(agentsMd) ? ' and the text already there' : ''}`);
    }
    fs.writeFileSync(agentsMd, fenceText(old, block));
    out.push(`rule text -> AGENTS.md (between ${START} and ${END}, skills in ${dir}/)`);
  } else if (old.includes(START)) {
    fs.writeFileSync(agentsMd, unfence(old, START, END));
    out.push('removed our block from AGENTS.md (no agent that reads it was chosen)');
  }
  return out;
}

// mxcli's section of AGENTS.md: `mxcli init` replaces what lies between these markers and keeps the rest;
// `mxcli init --sync-skills` fills an empty pair. Put first, before any text the file already had.
export const MXCLI_BEGIN = '<!-- mxcli:begin', MXCLI_END = '<!-- mxcli:end -->';
export const withMxcliSection = old => `${MXCLI_BEGIN} -->\n${MXCLI_END}\n` + (old.trim() ? '\n' + old.trimStart() : '');

// Our block in AGENTS.md, between markers; replaced in place, appended after mxcli's section when missing.
export function fenceText(old, block, start = START, end = END) {
  const body = `${start}\n${block.trimEnd()}\n${end}`;
  const a = old.indexOf(start), b = old.indexOf(end);
  if (a >= 0 && b > a) return old.slice(0, a) + body + old.slice(b + end.length);
  return (old.trimEnd() ? old.trimEnd() + '\n\n' : '') + body + '\n';
}
export function unfence(old, start, end) {
  const a = old.indexOf(start), b = old.indexOf(end);
  if (a < 0 || b < a) return old;
  const rest = (old.slice(0, a).trimEnd() + '\n\n' + old.slice(b + end.length).trimStart()).trim();
  return rest ? rest + '\n' : '';
}

// ---- 5. our skills, beside mxcli's ----------------------------------------------------------------

// Every folder an agent reads skills from, plus .ai-context/skills where v1 also put ours.
const ALL_SKILL_DIRS = [...new Set([...Object.values(SKILLS_DIR), '.ai-context/skills'])];
const OURS = [...INSTALLED_SKILLS, ...OPTIONAL_SKILLS, ...RETIRED_SKILLS];

// Removes every skill of ours from every skills folder (mxcli ships none of these names), then copies
// the installed ones into each chosen agent's folder. Returns the lines to print.
export function copySkills(app, agents, src = path.join(here, 'skills')) {
  const out = [];
  for (const d of ALL_SKILL_DIRS) for (const s of OURS) fs.rmSync(path.join(app, d, s), { recursive: true, force: true });
  const dirs = [...new Set(agents.map(a => SKILLS_DIR[a]))];
  for (const d of dirs) {
    for (const s of INSTALLED_SKILLS) fs.cpSync(path.join(src, s), path.join(app, d, s), { recursive: true });
    out.push(`${INSTALLED_SKILLS.length} skills -> ${d}/`);
  }
  return out;
}

// ---- 5b. the starter test kit -------------------------------------------------------------------

// The kit (templates/tests/): helpers for sign-in and sign-out, dialogs, grids, OQL and forged calls, its
// teardown and a Playwright config. Each file is written only when absent: once written it is the app's own,
// so a later bundle never overwrites it, and the agent's specs and helpers.ts are never touched. The config is
// left out when the app already has a Playwright config at its root (two configs: the kit's teardown would
// silently not run). The teardown and the config import from ./mx, so they are left out too when tests/mx.ts
// is the person's own: not in the last install's record (prevKit) and not the bundle's text. A kept
// tests/package.json that pins another Playwright gets the pin hint (the finish condition needs --shuffle).
// mxcli init does not touch tests/.
// -> { written, kept, ours, lines }; ours = the kit files there now that are the kit's (written now, or kept
// and recorded before or still the bundle's text): what installed.json records as testKit.
export const TEST_KIT = ['tests/mx.ts', 'tests/mx.teardown.ts', 'tests/playwright.config.ts', 'tests/package.json'];
export const PLAYWRIGHT = '1.64.1'; // the version tests/package.json pins: it has --shuffle
const MX_DEPENDENTS = ['tests/mx.teardown.ts', 'tests/playwright.config.ts'];
export function copyTestKit(app, prevKit = [], src = path.join(here, 'templates', 'tests')) {
  const written = [], kept = [], ours = [], lines = [];
  const isThere = f => { try { fs.lstatSync(f); return true; } catch { return false; } };
  const sameAsKit = rel => { try { return fs.readFileSync(path.join(app, rel), 'utf8') === fs.readFileSync(path.join(src, path.basename(rel)), 'utf8'); } catch { return false; } };
  const rootConfig = ['ts', 'js', 'mjs', 'cjs'].map(e => `playwright.config.${e}`).find(f => fs.existsSync(path.join(app, f)));
  // a package.json or Playwright config at the root is the app's setup: no second one in tests/
  const rootSetup = fs.existsSync(path.join(app, 'package.json')) ? 'package.json' : rootConfig;
  const ownMx = isThere(path.join(app, 'tests/mx.ts')) && !prevKit.includes('tests/mx.ts') && !sameAsKit('tests/mx.ts');
  const skipped = [];
  for (const rel of TEST_KIT) {
    const f = path.join(app, rel);
    if (isThere(f)) {
      kept.push(rel);
      if (prevKit.includes(rel) || sameAsKit(rel)) ours.push(rel);
      continue;
    }
    if (ownMx && MX_DEPENDENTS.includes(rel)) { skipped.push(rel); continue; }
    if (rel === 'tests/playwright.config.ts' && rootConfig) { lines.push(`test kit: no tests/playwright.config.ts, the app has ${rootConfig}; name globalTeardown: './tests/mx.teardown.ts' in it`); continue; }
    if (rel === 'tests/package.json' && rootSetup) { lines.push(`test kit: no tests/package.json, the app has ${rootSetup} at its root; pin @playwright/test there: npm install -D -E @playwright/test@${PLAYWRIGHT}`); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.copyFileSync(path.join(src, path.basename(rel)), f);
    written.push(rel);
    ours.push(rel);
  }
  if (written.length) lines.push(`test kit -> ${written.join(', ')}`);
  if (kept.length) lines.push(`test kit: kept the app's own ${kept.join(', ')}`);
  if (skipped.length) lines.push(`test kit: skipped ${skipped.join(', ')}: tests/mx.ts is the app's own and they import from the kit's mx.ts; to get the kit, move tests/mx.ts aside and install again`);
  if (kept.includes('tests/package.json')) {
    const pin = playwrightPin(path.join(app, 'tests/package.json'));
    if (pin !== PLAYWRIGHT) lines.push(`test kit: tests/package.json ${pin ? `pins @playwright/test ${pin}` : 'does not pin @playwright/test'}; the finish condition needs --shuffle, so pin it in tests/: npm install -D -E @playwright/test@${PLAYWRIGHT}`);
  }
  ours.sort((x, y) => TEST_KIT.indexOf(x) - TEST_KIT.indexOf(y));
  return { written, kept, ours, lines };
}
// The @playwright/test version a package.json names (dev or plain dependency), or null.
function playwrightPin(f) {
  try { const p = JSON.parse(fs.readFileSync(f, 'utf8')); return p.devDependencies?.['@playwright/test'] || p.dependencies?.['@playwright/test'] || null; } catch { return null; }
}

// ---- 5c. the film recorder ---------------------------------------------------------------------------

// tests/film.mjs records a test's run as a video when a person asks (the film-tests skill). Unlike the kit it is
// the bundle's, not the app's: written on every install and reinstall, whatever the kit's files are, so a later
// bundle's fix reaches every app. It only adds a temporary config while it films; the app's config is never edited.
export const FILM = 'tests/film.mjs';
export function copyFilm(app, src = path.join(here, 'templates', 'film.mjs')) {
  const f = path.join(app, FILM);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.rmSync(f, { force: true }); // a link or a read-only copy is replaced, not written through
  fs.copyFileSync(src, f);
  return FILM;
}

// ---- 6. upgrade: the earlier bundles' files out -----------------------------------------------------

// Paths an earlier bundle wrote that this one has no use for (v2 gate, then v1). The app's own tests/*.spec.ts,
// docs/requests/ and docs/brain/ are never touched.
const OLD_PATHS = [
  'mxgate', '.mxgate', '.claude/rules/mxgate.md', '.claude/rules/mdl-skills.md', '.cursor/rules/mdl-skills.mdc',
  'tools/mdl-checks', 'tests/gate.sh', 'tests/gate', 'tests/rulebook', 'tests/checks', 'tests/film.sh',
  '.opencode/plugin/mendix-mdl-harness.js', '.pi/extensions/mendix-mdl-harness.js',
];
// A hook or permission is ours when it names one of these.
const OUR_MARKS = ['.mxgate/', './mxgate', 'tools/mdl-checks/', 'tests/gate.sh'];
const isOurs = s => OUR_MARKS.some(m => String(s).includes(m));

// Takes our entries out of a settings or hooks JSON object; everything else stays as it was. -> true when changed.
export function stripOurs(cfg) {
  let changed = false;
  if (Array.isArray(cfg?.permissions?.allow)) {
    const keep = cfg.permissions.allow.filter(p => !isOurs(p));
    if (keep.length !== cfg.permissions.allow.length) { cfg.permissions.allow = keep; changed = true; }
  }
  const prune = list => list.flatMap(e => {
    if (e && typeof e === 'object' && 'command' in e && isOurs(e.command)) { changed = true; return []; }
    if (e && Array.isArray(e.hooks)) {
      const inner = prune(e.hooks);
      if (e.hooks.length && !inner.length) { changed = true; return []; }
      return [{ ...e, hooks: inner }];
    }
    return [e];
  });
  if (cfg?.hooks && typeof cfg.hooks === 'object') {
    for (const [ev, list] of Object.entries(cfg.hooks)) {
      if (!Array.isArray(list)) continue;
      const kept = prune(list);
      if (kept.length) cfg.hooks[ev] = kept; else { delete cfg.hooks[ev]; changed = true; }
    }
  }
  return changed;
}

// Removes what an earlier bundle installed. Returns what it removed, one line each.
export function upgradeCleanup(app) {
  const out = [];
  for (const rel of OLD_PATHS) rmIf(app, rel, out);
  // rules.local.md was the v2 gate's file for the person's own rules: removed only while empty
  const rl = path.join(app, 'rules.local.md');
  if (fs.existsSync(rl)) { if (!fs.readFileSync(rl, 'utf8').trim()) rmIf(app, 'rules.local.md', out); else out.push('nothing from rules.local.md: it has text, so it stays (the gate that read it is gone)'); }
  for (const rel of ['.claude/settings.local.json', '.codex/hooks.json', '.cursor/hooks.json']) {
    const f = path.join(app, rel);
    const cfg = readJson(f, null);
    if (cfg && stripOurs(cfg)) { fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n'); out.push(`our hooks and permissions from ${rel}`); }
  }
  const agentsMd = path.join(app, 'AGENTS.md');
  if (fs.existsSync(agentsMd)) {
    const t = fs.readFileSync(agentsMd, 'utf8');
    const u = unfence(t, '<!-- mxgate:start -->', '<!-- mxgate:end -->');
    if (u !== t) { fs.writeFileSync(agentsMd, u); out.push('the mxgate block from AGENTS.md'); }
  }
  return out;
}

function rmIf(app, rel, out) {
  const f = path.join(app, rel);
  let there = false; try { fs.lstatSync(f); there = true; } catch { /* absent */ }
  if (!there) return;
  fs.rmSync(f, { recursive: true, force: true });
  out.push(rel);
}

// ---- 1. mxcli ------------------------------------------------------------------------------------

// The v2 gate kept a downloaded mxcli in .mxgate/bin; it moves to .mxcodr/bin before .mxgate/ goes,
// and ./mxcli or the recorded path follow it.
export function migrateBin(app, prev) {
  const oldBin = path.join(app, '.mxgate', 'bin');
  const newBin = path.join(app, FOOTPRINT, 'bin');
  if (!fs.existsSync(oldBin) || fs.existsSync(newBin)) return false;
  fs.mkdirSync(path.dirname(newBin), { recursive: true });
  fs.renameSync(oldBin, newBin);
  if (prev?.mxcli?.path && prev.mxcli.path.startsWith(oldBin)) prev.mxcli.path = newBin + prev.mxcli.path.slice(oldBin.length);
  const own = path.join(app, 'mxcli');
  try {
    const target = fs.lstatSync(own).isSymbolicLink() ? path.resolve(app, fs.readlinkSync(own)) : '';
    if (target.startsWith(oldBin + path.sep)) { fs.unlinkSync(own); fs.symlinkSync(path.join(newBin, path.relative(oldBin, target)), own); }
  } catch { /* no ./mxcli */ }
  return true;
}

function versionOf(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, MXCLI_QUIET: '1' } });
  const m = `${r.stdout}${r.stderr}`.match(/mxcli version v?(\d+\.\d+\.\d+)/);
  return r.status === 0 && m ? m[1] : null;
}
const isScript = f => { try { const b = Buffer.alloc(2); const fd = fs.openSync(f, 'r'); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd); return b.toString() === '#!'; } catch { return true; } };

// The recorded binary, mxcli on PATH, then the app's own ./mxcli.
function findMxcli(app, prev) {
  const cands = [];
  if (prev.mxcli?.path) cands.push(prev.mxcli.path);
  for (const d of (process.env.PATH || '').split(path.delimiter)) if (d) cands.push(path.join(d, process.platform === 'win32' ? 'mxcli.exe' : 'mxcli'));
  cands.push(path.join(app, FOOTPRINT, 'bin', process.platform === 'win32' ? 'mxcli.exe' : 'mxcli'));
  for (const c of cands) if (fs.existsSync(c) && !isScript(c) && versionOf(c) === PIN) return fs.realpathSync(c);
  const own = path.join(app, 'mxcli');
  if (fs.existsSync(own) && !isScript(own) && versionOf(own) === PIN) return fs.realpathSync(own);
  return null;
}

// Downloads with live(cmd, args) (the installer's non-blocking runner), so the bar shows the time it takes.
async function download(foot, live) {
  const osName = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const arch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
  const dest = path.join(foot, 'bin', process.platform === 'win32' ? 'mxcli.exe' : 'mxcli');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  ui.sub(`downloading v${PIN} for ${osName}/${arch}`);
  const any = (process.env.PATH || '').split(path.delimiter).map(d => path.join(d, 'mxcli')).find(c => fs.existsSync(c) && versionOf(c));
  const r = any
    ? await live(any, ['setup', 'mxcli', '--tag', `v${PIN}`, '--os', osName, '--arch', arch, '--output', dest])
    : await live('curl', ['-fsSL', '-o', dest, `https://github.com/mendixlabs/mxcli/releases/download/v${PIN}/mxcli-${osName}-${arch}${process.platform === 'win32' ? '.exe' : ''}`]);
  if (r.status !== 0 || !fs.existsSync(dest)) die(`could not download mxcli v${PIN}: ${(r.stderr || '').trim().slice(-300)}`);
  fs.chmodSync(dest, 0o755);
  if (versionOf(dest) !== PIN) die(`the downloaded mxcli does not report v${PIN}`);
  return dest;
}

// ./mxcli is the pinned mxcli. Replaced: an earlier bundle's Node shim, a link that leads nowhere, or a
// binary that does not run here or reports another version (mxcli new on macOS can leave a Linux one).
// Someone else's wrapper script stays. -> a line to print, or null when nothing changed.
export function ensureLocalMxcli(app, mxcliPath, check = versionOf) {
  const f = path.join(app, 'mxcli');
  let why = null;
  let st; try { st = fs.lstatSync(f); } catch { why = 'was missing'; }
  if (!why && st.isSymbolicLink() && !fs.existsSync(f)) why = 'was a link that leads nowhere';
  if (!why && !st.isSymbolicLink() && st.size < 4096) {
    const text = fs.readFileSync(f, 'utf8');
    if (text.includes('.mxgate/shim.mjs') || text.includes(".mxgate', 'shim.mjs'")) why = 'was the mxgate shim of an earlier bundle';
  }
  if (!why && !isScript(f) && check(f) !== PIN) why = 'did not run here or was another version';
  if (!why) return null;
  try { if (fs.realpathSync(f) === fs.realpathSync(mxcliPath)) return null; } catch { /* replaced below */ }
  fs.rmSync(f, { force: true });
  try { fs.symlinkSync(mxcliPath, f); } catch { fs.copyFileSync(mxcliPath, f); fs.chmodSync(f, 0o755); }
  return `./mxcli ${why}; it is mxcli ${PIN} now`;
}
// The earlier name, kept for the shim test.
export const replaceShim = (app, mxcliPath) => {
  const f = path.join(app, 'mxcli');
  let text = '';
  try { if (!fs.lstatSync(f).isSymbolicLink() && fs.statSync(f).size < 4096) text = fs.readFileSync(f, 'utf8'); } catch { return false; }
  if (!text.includes('.mxgate/shim.mjs') && !text.includes(".mxgate', 'shim.mjs'")) return false;
  return Boolean(ensureLocalMxcli(app, mxcliPath));
};

// Ports for the smoke boot only (the agent boots the app itself later, on mxcli's defaults).
async function bootPorts() {
  const free = p => new Promise(res => { const srv = net.createServer(); srv.once('error', () => res(false)); srv.listen(p, '127.0.0.1', () => srv.close(() => res(true))); });
  if (await free(8080) && await free(8090) && await free(6543)) return { dflt: true };
  for (let p = 18080; p < 18980; p += 3) if (await free(p) && await free(p + 1) && await free(p + 2)) return { app: p, admin: p + 1, serve: p + 2 };
  die('no three free ports for the smoke boot', 'install without --boot');
}

function reachable(port) {
  return new Promise(res => { const s = net.connect({ port, host: '127.0.0.1' }); s.setTimeout(800); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); s.once('timeout', () => { s.destroy(); res(false); }); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main().catch(e => die(`The installer stopped unexpectedly: ${e.message}`, ...String(e.stack || '').split('\n').slice(1, 4).map(l => l.trim()), 'Nothing after this step was done. Please report these lines.'));
