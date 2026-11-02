// The mx-codr installer (harness v2, skills only). install.sh runs it from the bundle:
//   node overlay/install.mjs <app folder> [--db hsqldb|postgres] [--agent claude,cursor,codex,opencode,pi] [--theme <name>] [--yes] [--boot] [--request <file>]
// It installs nothing that runs while the agent builds: the pinned mxcli, MxBuild and the runtime cached,
// the database chosen, mxcli's own skills refreshed, one always-on rule file per agent, our skills beside
// mxcli's, a starter test kit in tests/ (only the files that are absent), tests/film.mjs (always), the app's look when one is chosen (theme/ only),
// .mxcodr/theme.mjs to change it later, and .mxcodr/installed.json (+ .mxcodr/bin/mxcli when it had to download mxcli). Run it again to
// repair or upgrade; an earlier bundle's gate (./mxgate, .mxgate/) and v1's hooks and checkers are removed.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeAtomic } from './lib/cache.mjs';
import { PIN, BUNDLE } from './lib/mx.mjs';
import { readTemplate, ruleText, mdcText, agentsBlockDir, checkRule, SKILLS_DIR, AGENTS, START, END } from './lib/rules.mjs';
import { INSTALLED_SKILLS, OPTIONAL_SKILLS, RETIRED_SKILLS } from './lib/skills.mjs';
import { decideTheme, activeFrameTheme, applyTheme, askTheme, installThemeTool } from './lib/theme.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const say = s => console.log(`mxcodr install: ${s}`);
const die = (s, fix) => { console.error(`mxcodr install: could not install: ${s}${fix ? `\n  fix: ${fix}` : ''}`); process.exit(2); };

export const FOOTPRINT = '.mxcodr';

async function main() {
  const argv = process.argv.slice(2);
  const app = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv.shift()) : die('usage: node install.mjs <app folder> [--db hsqldb|postgres] [--agent claude] [--theme <name>] [--yes] [--boot] [--request <file>]');
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', cwd: app, env: { ...process.env, MXCLI_QUIET: '1' }, timeout: o.timeout || 600000, stdio: 'pipe' });
  if (Number(process.versions.node.split('.')[0]) < 20) die(`Node ${process.versions.node}; the installer needs Node 20 or later`);
  if (!fs.existsSync(app)) die(`no folder ${app}`);
  const mprs = fs.readdirSync(app).filter(f => f.endsWith('.mpr'));
  if (mprs.length !== 1) die(`expected one .mpr in ${app}, found ${mprs.length}`);
  const mpr = mprs[0];
  const foot = path.join(app, FOOTPRINT);
  // an upgrade from the v2 gate: its installed.json and downloaded mxcli move into .mxcodr/ first
  const prev = readJson(path.join(foot, 'installed.json'), null) || readJson(path.join(app, '.mxgate', 'installed.json'), {});
  migrateBin(app, prev);

  // 1. mxcli: a found binary of the pinned version, else download it into .mxcodr/bin; ./mxcli is that binary
  const mxcli = findMxcli(app, prev) || download(foot);
  say(`mxcli ${PIN} at ${mxcli}`);
  const local = ensureLocalMxcli(app, mxcli);
  if (local) say(local);

  // 2. database and agents (both kept from the last install unless given)
  const db = opt('--db') || prev.db || (await reachable(5432) ? 'postgres' : 'hsqldb');
  if (!['hsqldb', 'postgres'].includes(db)) die(`unknown --db ${db}`, 'use --db hsqldb or --db postgres');
  const dbName = prev.dbName || path.basename(mpr, '.mpr').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const agents = parseAgents(opt('--agent') || prev.agents?.join(',') || 'claude');
  say(`database ${db}${db === 'postgres' ? ` (${dbName})` : ''}; agents ${agents.join(', ')}`);

  // 2b. the app's look: --theme, else the last install's (its frame refreshed), else asked once on a terminal;
  // with no terminal or --yes nothing is applied (the app keeps the look mxcli new gave it). theme/ files only.
  let choice;
  try { choice = decideTheme({ flag: argv.includes('--theme') ? opt('--theme') ?? '' : undefined, prev, tty: Boolean(process.stdin.isTTY && process.stdout.isTTY), yes: argv.includes('--yes'), active: activeFrameTheme(app) }); } catch (e) { die(e.message, 'node overlay/lib/theme.mjs list shows the themes'); }
  if (choice.how === 'ask') {
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    choice = { name: await askTheme({ rl, write: t => process.stdout.write(t), plain: Boolean(process.env.NO_COLOR) }), how: 'flag' };
    rl.close();
  }
  const themeResult = applyTheme({ app, mpr, choice, run: args => run(mxcli, args) });
  say(themeResult.line || 'theme: none chosen, the app keeps its look (--theme <name> or node .mxcodr/theme.mjs to choose one)');

  // 3. MxBuild and the runtime, so the agent's first boot does not pay for them; then mxcli's own skills
  const mxb = run(mxcli, ['setup', 'mxbuild', '-p', mpr]);
  if (mxb.status !== 0) say(`warning: mxcli setup mxbuild failed: ${(mxb.stderr || mxb.stdout).trim().split('\n').pop()}`);
  const setup = run(mxcli, ['run', '--local', '--setup', ...(db === 'hsqldb' ? ['--db-type', 'hsqldb'] : ['--ensure-db', '--db-name', dbName]), '-p', mpr], { timeout: 1800000 });
  if (setup.status !== 0) die(`mxcli run --local --setup failed: ${(setup.stderr || setup.stdout).trim().split('\n').slice(-2).join(' ')}`, db === 'postgres' ? 'or install with --db hsqldb' : '');
  say('MxBuild and the runtime are cached');

  // 4-6. the earlier bundles' files out, then our rule file and skills in
  for (const line of upgradeCleanup(app)) say(`removed ${line}`);
  for (const line of writeRules(app, agents)) say(line);
  for (const line of copySkills(app, agents)) say(line);
  const kit = copyTestKit(app, Array.isArray(prev.testKit) ? prev.testKit : []);
  for (const line of kit.lines) say(line);
  say(`film recorder -> ${copyFilm(app)} (written on every install; the film-tests skill says how to use it)`);
  say(`theme tool -> ${installThemeTool(app)}`);
  // mxcli's own skills and its section of CLAUDE.md/AGENTS.md, after writeRules: an AGENTS.md that had no mxcli
  // section has its markers now, and this fills them (it leaves our block, outside them, as it is)
  const sync = run(mxcli, ['init', '--sync-skills', '.']);
  say(sync.status === 0 ? `mxcli's own skills are current for ${PIN}` : `warning: mxcli init --sync-skills failed: ${(sync.stderr || sync.stdout).trim().split('\n').pop()}`);

  // installed.json: what a later person-run report or gate would read, nothing else
  const inst = { bundle: BUNDLE, mxcli: { path: mxcli, version: PIN }, db, ...(db === 'postgres' ? { dbName } : {}), agents, skills: INSTALLED_SKILLS, testKit: kit.ours, theme: themeResult.theme, requests: prev.requests || {} };
  if (opt('--request')) {
    const { saveRequest } = await import('./lib/requests.mjs');
    let text; try { text = fs.readFileSync(opt('--request'), 'utf8'); } catch (e) { die(`--request ${opt('--request')}: ${e.code || e.message}`); }
    const file = saveRequest(app, text, 'install', inst.requests);
    say(file ? `request -> docs/requests/${file} (word for word)` : 'request: the same text is saved already in docs/requests/');
  }
  writeAtomic(path.join(foot, 'installed.json'), inst);
  say(`${FOOTPRINT}/installed.json written (bundle ${BUNDLE})`);

  // 7. a smoke boot when asked: the app boots and answers, then stops again
  if (argv.includes('--boot')) {
    const dbArgs = db === 'hsqldb' ? ['--db-type', 'hsqldb'] : ['--db-name', dbName];
    // Mendix's default ports when free, else three free ones: another app on this machine may hold them
    const pt = await bootPorts();
    const portArgs = pt.dflt ? [] : ['--app-port', String(pt.app), '--admin-port', String(pt.admin), '--serve-port', String(pt.serve)];
    const b = run(mxcli, ['run', '--local', '--detach', ...portArgs, ...dbArgs, '-p', mpr], { timeout: 15 * 60000 });
    if (b.status !== 0) die(`the app did not boot: ${(b.stderr || b.stdout).trim().split('\n').slice(-3).join(' | ')}`, 'see .mxcli/run.log');
    const w = run(mxcli, ['run', 'wait', '--ready', '--timeout', '10m', '-p', mpr], { timeout: 11 * 60000 });
    const st = run(mxcli, ['run', 'status', '-p', mpr]);
    run(mxcli, ['run', 'stop', '-p', mpr], { timeout: 120000 });
    if (w.status !== 0) die(`the app is not ready: ${(w.stderr || w.stdout).trim().split('\n').pop()}`, 'see .mxcli/run.log');
    say(`the app boots (${(st.stdout || '').trim().split('\n').pop()}); stopped again`);
  }
  say('done. The agent reads the rule file by itself; nothing runs while it builds.');
}

export function parseAgents(s) {
  const list = [...new Set(String(s).split(',').map(a => a.trim().toLowerCase()).filter(Boolean))];
  for (const a of list) if (!AGENTS.includes(a)) die(`unknown agent ${a}`, `use one or more of ${AGENTS.join(', ')}`);
  return list;
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

function download(foot) {
  const osName = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const arch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
  const dest = path.join(foot, 'bin', process.platform === 'win32' ? 'mxcli.exe' : 'mxcli');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  say(`downloading mxcli v${PIN} for ${osName}/${arch}`);
  const any = (process.env.PATH || '').split(path.delimiter).map(d => path.join(d, 'mxcli')).find(c => fs.existsSync(c) && versionOf(c));
  const r = any
    ? spawnSync(any, ['setup', 'mxcli', '--tag', `v${PIN}`, '--os', osName, '--arch', arch, '--output', dest], { encoding: 'utf8', timeout: 600000 })
    : spawnSync('curl', ['-fsSL', '-o', dest, `https://github.com/mendixlabs/mxcli/releases/download/v${PIN}/mxcli-${osName}-${arch}${process.platform === 'win32' ? '.exe' : ''}`], { encoding: 'utf8', timeout: 600000 });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main().catch(e => die(e.stack || e.message));
