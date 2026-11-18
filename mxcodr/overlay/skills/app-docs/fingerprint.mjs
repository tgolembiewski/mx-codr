#!/usr/bin/env node
// Fingerprint of what the app documentation (docs/app-docs.html) was written from. The agent writes it into the
// HTML's <meta name="mxcodr-docs">; the mx-codr panel computes it again to tell whether the docs are out of date.
// Both use this one file (the panel imports it), so the two can only differ when the model, the app settings or the
// requirements did. Read-only: mxcli runs with an argument array (no shell), on Windows and Mac alike.
//
//   node fingerprint.mjs -p <app>.mpr [--mxcli <path>]          the JSON, one line
//   node fingerprint.mjs -p <app>.mpr --check docs/app-docs.html  what is out of date ({current, parts, mxcli})
// Parts:
//   module:<Name>  `describe module <Name> --all` of each app module, without layout-only lines (positions, curves,
//                  anchors, annotation positions): moving boxes in Studio Pro changes nothing
//   app            navigation, project security, user roles, settings, the module list with the Marketplace versions
//                  (add-on modules out: mx-codr's own MxCodr and MxCodrBridge carry the package version, 2026-11-18)
//   brain          the requirements the page cites, docs/brain/plan/ ("none" without it); decisions are not in the page
// model (format 2, 2026-11-18): the model's own files, the .mpr and mprcontents/, hashed as bytes: the witness. The
// same whatever mxcli reads them with, and untouched by Studio Pro opening the app, by mxcli's .mxcli/ cache, by the
// widget definitions DESCRIBE names widgets from, and by an add-on's update. While it is unchanged the page is current;
// the parts only say which part changed once it did (with the same mxcli: DESCRIBE's wording changes between
// versions, measured 0.31 -> 0.32: 3 of 6 module hashes on an unchanged model).
// overall hashes the parts in a fixed order (mxcli's version is kept apart). Hashes: sha256, the first 16 hex characters.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const hash = s => createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
export const noLayout = s => String(s).replace(/\r\n/g, '\n').split('\n')
  .filter(l => !/^\s*@(position|curve|anchor|merge)\b/i.test(l))
  .map(l => l.replace(/@annotation\(text: ('(?:[^']|'')*'), position: \([^)]*\)\)/i, '@annotation $1'))
  .join('\n');

/** The app's mxcli: --mxcli, else the one in the app folder (mxcli.exe first on Windows), else mxcli on the PATH. */
export function findMxcli(appDir, platform = process.platform) {
  const names = platform === 'win32' ? ['mxcli.exe'] : ['mxcli'];
  return names.map(n => path.join(appDir, n)).find(p => fs.existsSync(p)) ?? (platform === 'win32' ? 'mxcli.exe' : 'mxcli');
}

/** A runner: mxcli's stdout for an argument array (never a shell; the same options on both sides). */
export const mxcliRunner = (mxcli, appDir) => args => execFileSync(mxcli, args, {
  cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 << 20, timeout: 120000, windowsHide: true,
  env: { ...process.env, MXCLI_QUIET: '1' },
});

/** The fingerprint of an app. run(args) -> stdout; the mpr is passed to mxcli as given, the brain is read beside it. */
export function fingerprint({ mpr, run = mxcliRunner(findMxcli(path.dirname(path.resolve(mpr))), path.dirname(path.resolve(mpr))), now = new Date() }) {
  const appDir = path.dirname(path.resolve(mpr));
  const q = (stmt, json = false) => run(['-p', mpr, ...(json ? ['--json'] : []), '-c', stmt]);
  const version = String(run(['--version'])).trim();
  const modules = JSON.parse(q('show modules', true)).filter(m => m.Type !== 'Add-on');
  const appModules = modules.filter(m => !m.Source && m.Module !== 'System').map(m => m.Module).sort();
  const parts = {};
  for (const m of appModules) parts[`module:${m}`] = hash(noLayout(run(['describe', 'module', m, '--all', '-p', mpr])));
  parts.app = hash([q('describe navigation'), q('show project security'), q('show user roles'), q('describe settings'),
    modules.map(m => `${m.Module} ${m.Source || ''}`).join('\n')].join('\n--\n'));
  parts.brain = brainHash(path.join(appDir, 'docs', 'brain', 'plan'));
  const overall = hash(Object.keys(parts).sort().map(k => `${k}=${parts[k]}`).join('\n'));
  const fp = { v: FORMAT, mxcli: version, generatedAt: now.toISOString(), overall, model: modelHash(mpr), parts };
  // for a page from before format 2 only, never stored (not enumerable): its brain part hashed all of docs/brain/
  Object.defineProperty(fp, 'legacy', { value: { brain: brainHash(path.join(appDir, 'docs', 'brain')) } });
  return fp;
}

export const FORMAT = 2;

/** The model's own files as bytes: the .mpr, and for MPR v2 every file under mprcontents/ (its path with /, the same on
 * Windows). Measured on a large real app's copy (2069 units, 106 MB): 0.1-0.3 s. */
export function modelHash(mpr) {
  const h = createHash('sha256');
  h.update(fs.readFileSync(mpr));
  const dir = path.join(path.dirname(path.resolve(mpr)), 'mprcontents');
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else { h.update(`\n${r}\n`); h.update(fs.readFileSync(path.join(d, e.name))); }
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return h.digest('hex').slice(0, 16);
}

/** docs/brain/ as one hash: each file's path (with /, the same on Windows) and its text. */
export function brainHash(dir) {
  const files = [];
  const walk = d => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  if (fs.existsSync(dir)) walk(dir);
  return files.length ? hash(files.map(f => `${path.relative(dir, f).split(path.sep).join('/')}\n${fs.readFileSync(f, 'utf8')}`).join('\n--\n')) : 'none';
}

/** The fingerprint stored in the docs' <meta name="mxcodr-docs" content='...'> (null: none, or not JSON). */
export function readMeta(html) {
  const m = /<meta\s+name="mxcodr-docs"\s+content=(?:'([^']*)'|"([^"]*)")\s*\/?>/i.exec(String(html ?? ''));
  if (!m) return null;
  const raw = (m[1] ?? m[2]).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  try { const j = JSON.parse(raw); return j && typeof j === 'object' && typeof j.overall === 'string' ? j : null; } catch { return null; }
}

/** stored vs now: current, the parts that differ (added and removed modules too), and whether mxcli changed.
 * Format 2 (stored.model): the model's files unchanged -> current whatever DESCRIBE says now (another mxcli, a widget
 * definition, a cache), the requirements aside; changed under another mxcli -> parts ["model"]: which parts cannot be
 * told (the parts are another mxcli's wording), the page is written again; changed under the same mxcli -> the parts
 * that differ (layout only: none, current). A page from before format 2 (no witness): its module parts, and its brain
 * as it was then (all of docs/brain/); not its app part, which held the add-on modules' versions at the time and so
 * cannot be computed again: that page is current until a module or the brain changed (Mark as current or the next
 * update writes format 2). */
export function compare(stored, now) {
  if (!stored) return { current: false, parts: ['all'], mxcli: false };
  const mxcli = stored.mxcli !== now.mxcli;
  const keys = [...new Set([...Object.keys(stored.parts ?? {}), ...Object.keys(now.parts ?? {})])].sort();
  const parts = keys.filter(k => (stored.parts ?? {})[k] !== (now.parts ?? {})[k]);
  if (typeof stored.model !== 'string') {
    const was = { ...now.parts, brain: now.legacy?.brain ?? now.parts?.brain };
    const old = keys.filter(k => k !== 'app' && (stored.parts ?? {})[k] !== was[k]);
    return { current: !old.length, parts: old, mxcli };
  }
  const brain = parts.includes('brain') ? ['brain'] : [];
  if (stored.model === now.model) return { current: !brain.length, parts: brain, mxcli };
  if (mxcli) return { current: false, parts: ['model', ...brain], mxcli };
  return { current: !parts.length, parts, mxcli };
}

/** Mark as current: the page with fp in its meta, every section's data-hash (data-src "all": overall) and the old
 * overall elsewhere (the footer) replaced; the text untouched. null: the page has no fingerprint meta. */
export function stamp(html, fp) {
  const META = /<meta\s+name="mxcodr-docs"\s+content=(?:'[^']*'|"[^"]*")\s*\/?>/i;
  html = String(html ?? '');
  if (!META.test(html)) return null;
  const old = readMeta(html);
  const json = JSON.stringify(fp).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  let out = html.replace(META, () => `<meta name="mxcodr-docs" content='${json}'>`);
  out = out.replace(/(data-src="([^"]*)"\s+data-hash=")([0-9a-f]*)(")/g, (m, a, src, _h, b) => {
    const h = src === 'all' ? fp.overall : fp.parts?.[src];
    return h ? a + h + b : m;
  });
  if (old?.overall && /^[0-9a-f]{16}$/.test(old.overall) && old.overall !== fp.overall) out = out.split(old.overall).join(fp.overall);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const mpr = opt('-p');
  if (!mpr) { console.error('usage: node fingerprint.mjs -p <app>.mpr [--mxcli <path>] [--check docs/app-docs.html]'); process.exit(2); }
  const appDir = path.dirname(path.resolve(mpr));
  const fp = fingerprint({ mpr, run: mxcliRunner(opt('--mxcli') ?? findMxcli(appDir), appDir) });
  const check = opt('--check');
  if (check) console.log(JSON.stringify({ ...compare(readMeta(fs.existsSync(check) ? fs.readFileSync(check, 'utf8') : ''), fp), now: fp }));
  else console.log(JSON.stringify(fp));
}
