#!/usr/bin/env node
// Documents added to, or changed in, a Marketplace module: its next update deletes the one and undoes the other. Read-only, exit 0:
// `mxcli marketplace diff <content-id> --module <Name> --json` (mxcli 0.32) per Marketplace module.   node marketplace-check.mjs -p <app>.mpr [--module <Name>] [--json] [--mxcli <path>] [--baseline]
// added: not in the package (a warning, always). changed: differs, not in the baseline (a warning). differs: no baseline for this version (a note:
// Mendix's app template ships Atlas_Core, FeedbackModule and Administration documents changed). translated: texts ./mxcodr-live translate wrote
// (a note, bundle .17.15). unknown: mxcli cannot describe it (a note). not checked: no login, no content id, a version no longer listed (never
// clean). The baseline (BASELINE): what differed when --baseline ran, per module and version, right after the app is created or a module installed (never widened).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE = '.mxcodr/marketplace-baseline.json', TRANSLATIONS = '.mxcodr/translations'; // BASELINE beside the .mpr too (.17.2/.3); TRANSLATIONS: translate's maps
// The app's mxcli: --mxcli, else the one in the app folder, else mxcli on the PATH.
export function findMxcli(appDir, platform = process.platform) {
  const name = platform === 'win32' ? 'mxcli.exe' : 'mxcli';
  return fs.existsSync(path.join(appDir, name)) ? path.join(appDir, name) : name;
}

/** A runner: { status, stdout, stderr } for an argument array (never a shell). */
export const mxcliRunner = (mxcli, appDir) => args => {
  const r = spawnSync(mxcli, args, { cwd: appDir, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 600000, windowsHide: true,
    env: { ...process.env, MXCLI_QUIET: '1' } });
  return { status: r.error ? -1 : r.status, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : (r.stderr ?? '') };
};

/** The top-level fields of one BSON document (strings, booleans, int32; the rest skipped). */
export function bsonTop(buf) {
  const out = {};
  let i = 4;
  while (i < buf.length - 1) {
    const t = buf[i++];
    const e = buf.indexOf(0, i);
    if (t === 0 || e < 0) break;
    const k = buf.toString('utf8', i, e);
    i = e + 1;
    if (t === 2) { const l = buf.readInt32LE(i); out[k] = buf.toString('utf8', i + 4, i + 3 + l); i += 4 + l; }
    else if (t === 3 || t === 4) i += buf.readInt32LE(i);
    else if (t === 8) out[k] = buf[i++] === 1;
    else if (t === 16) { out[k] = buf.readInt32LE(i); i += 4; }
    else if (t === 1 || t === 9 || t === 17 || t === 18) i += 8;
    else if (t === 5) i += 5 + buf.readInt32LE(i);
    else if (t !== 10 && t !== 6) break; // a type this reader does not know: keep what it has
  }
  return out;
}

/** The Marketplace modules [{ name, id, version }] from the module units in mprcontents/ (MPR v2); null without it. */
export function marketplaceModules(appDir) {
  const root = path.join(appDir, 'mprcontents');
  if (!fs.existsSync(root)) return null;
  const mods = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const b = e.name.endsWith('.mxunit') ? fs.readFileSync(p) : null;
      const m = b?.includes('Projects$ModuleImpl') ? bsonTop(b) : {};
      if (m.$Type === 'Projects$ModuleImpl' && m.FromAppStore === true)
        mods.push({ name: m.Name, id: m.AppStorePackageIdString || '', version: m.AppStoreVersion || '' });
    }
  };
  walk(root);
  return mods.sort((a, b) => a.name.localeCompare(b.name));
}

/** An MPR v1 app (no mprcontents/): the Marketplace modules `list modules` names, without a content id. */
function modulesFromList(run, mpr) {
  try {
    return JSON.parse(run(['-p', mpr, '--json', '-q', '-c', 'list modules']).stdout).filter(m => /^Marketplace\b/.test(m.Source || ''))
      .map(m => ({ name: m.Module, id: '', version: String(m.Source).replace(/^Marketplace v?/, '') }));
  } catch { return []; }
}

export function readTranslated(appDir, out = {}) { // {module: Set(element)}; a broken map: none
  let fl = []; try { fl = fs.readdirSync(path.join(appDir, TRANSLATIONS)).filter(f => f.endsWith('.json')); } catch { /* no maps */ }
  for (const f of fl) { try { const m = JSON.parse(fs.readFileSync(path.join(appDir, TRANSLATIONS, f), 'utf8')); for (const e of Array.isArray(m?.elements) && typeof m.module === 'string' ? m.elements : []) (out[m.module] ??= new Set()).add(String(e)); } catch { /* skip */ } } return out; }
export const readBaseline = appDir => { for (const f of [BASELINE, path.basename(BASELINE)]) { try { return JSON.parse(fs.readFileSync(path.join(appDir, f), 'utf8')); } catch { /* next */ } } return null; };

/** One module's result from its `marketplace diff` run, the baseline (or null) and translate's documents (Set or null). */
export function classify(mod, run, baseline, translatedEls = null) {
  const base = { module: mod.name, version: mod.version };
  if (!mod.id) return { ...base, status: 'not checked', reason: 'no Marketplace content id recorded (installed from a file, or an MPR v1 app)' };
  let d = null;
  try { d = JSON.parse(run.stdout); } catch { /* not JSON: mxcli said why on stderr */ }
  if (run.status !== 0 || !d || typeof d !== 'object' || !('module' in d))
    return { ...base, status: 'not checked', reason: (run.stderr || run.stdout || 'mxcli failed').trim().split('\n').filter(Boolean).slice(0, 2).join(' / ') };
  const version = d.installedVersion ?? mod.version;
  const known = baseline?.modules?.[mod.name];
  const inBase = known && known.version === version ? new Set(known.modified ?? []) : null;
  const added = d.onlyInstalled ?? [], modified = d.modified ?? [];
  const isTr = e => !!translatedEls?.has(e), changed = inBase ? modified.filter(e => !inBase.has(e) && !isTr(e)) : []; // isTr: allowed, another edit there not told apart
  const unknown = (d.unknown ?? []).map(u => (typeof u === 'string' ? u : u.element)), translated = modified.filter(e => isTr(e) && !inBase?.has(e));
  return { ...base, version, status: added.length + changed.length ? 'warning' : 'ok', added, changed,
    differs: inBase ? [] : modified.filter(e => !isTr(e)), translated, unknown, baseline: !!inBase };
}

/** Every Marketplace module of the app (or the one named), each through `marketplace diff`. */
export function check({ mpr, run, only }) {
  const appDir = path.dirname(path.resolve(mpr));
  const mods = (marketplaceModules(appDir) ?? modulesFromList(run, mpr)).filter(m => !only || m.name === only);
  const baseline = readBaseline(appDir), translated = readTranslated(appDir);
  const modules = mods.map(m => classify(m, m.id ? run(['marketplace', 'diff', m.id, '--module', m.name, '-p', mpr, '--json']) : null, baseline, translated[m.name] ?? null));
  return { modules, warnings: modules.reduce((n, r) => n + (r.added?.length ?? 0) + (r.changed?.length ?? 0), 0),
    notChecked: modules.filter(r => r.status === 'not checked').length, baseline: !!baseline };
}

/** The baseline after a check: an entry for each module checked that has none for its version (what differs now);
 * an existing entry is never widened, so a later run cannot clear its own `changed`. null: nothing new to record. */
export function baselineFrom(result, old = null, now = new Date()) {
  const modules = { ...(old?.modules ?? {}) };
  const fresh = result.modules.filter(r => r.status !== 'not checked' && !r.baseline);
  for (const r of fresh) modules[r.module] = { version: r.version, modified: [...r.differs].sort() };
  return fresh.length ? { takenAt: now.toISOString(), modules } : null;
}

// "PAGE_TEMPLATE Blank", "PAGE_TEMPLATE Grid", "BUILDING_BLOCK X" -> "1 BUILDING_BLOCK, 2 PAGE_TEMPLATE"
const byType = els => Object.entries(els.reduce((n, e) => ({ ...n, [e.split(' ')[0]]: (n[e.split(' ')[0]] ?? 0) + 1 }), {}))
  .sort(([a], [b]) => a.localeCompare(b)).map(([t, k]) => `${k} ${t}`).join(', ');

/** The report a person or an agent reads. */
export function report(result) {
  const out = [];
  for (const r of result.modules) {
    const at = `${r.module} ${r.version}`.trim();
    if (r.status === 'not checked') { out.push(`not checked  ${at}: ${r.reason}`); continue; }
    for (const e of r.added) out.push(`warning  ${at}: added ${e} -- the next Marketplace update deletes it; move it to the app's own module (skill module-structure)`);
    for (const e of r.changed) out.push(`warning  ${at}: changed ${e} -- the next update undoes it; make the change in ${r.module}Ext instead and restore the original (skill module-structure)`);
    if (r.differs.length) out.push(`note     ${at}: differs from the package: ${r.differs.join(', ')} (no baseline for this version: maybe Mendix's app template, maybe an edit)`);
    if (r.translated?.length) out.push(`note     ${at}: texts translated by ./mxcodr-live translate (allowed; another edit in these documents is not told apart here: ./mxcodr-live marketplace update --plan-only compares without the translations): ${r.translated.join(', ')}`);
    if (r.unknown.length) out.push(`note     ${at}: not compared (mxcli cannot describe them): ${byType(r.unknown)}`);
    if (!r.added.length && !r.changed.length && !r.differs.length && !r.translated?.length) out.push(`ok       ${at}`);
  }
  out.push(`marketplace check: ${result.modules.length} Marketplace module(s), ${result.warnings} warning(s), ${result.notChecked} not checked${result.baseline ? '' : ', no baseline'}`);
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const found = fs.readdirSync('.').filter(f => f.endsWith('.mpr'));
  const mpr = opt('-p') ?? (found.length === 1 ? found[0] : undefined);
  if (!mpr) { console.error('usage: node marketplace-check.mjs -p <app>.mpr [--module <Name>] [--json] [--baseline] [--mxcli <path>]'); process.exit(2); }
  const appDir = path.dirname(path.resolve(mpr));
  const result = check({ mpr, run: mxcliRunner(opt('--mxcli') ?? findMxcli(appDir), appDir), only: opt('--module') });
  const b = args.includes('--baseline') ? baselineFrom(result, readBaseline(appDir)) : null;
  if (b) { fs.mkdirSync(path.join(appDir, path.dirname(BASELINE)), { recursive: true }); fs.writeFileSync(path.join(appDir, BASELINE), JSON.stringify(b, null, 2) + '\n'); }
  if (args.includes('--baseline')) console.error(b ? `baseline written: ${BASELINE}` : 'baseline: nothing new to record');
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : report(result));
}
