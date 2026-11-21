// The installer (overlay/install.mjs), section 0: a new Mendix app when the folder has none, and the install log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLE } from '../lib/mx.mjs';
import { FOOTPRINT } from './common.mjs';
import { mergeInto } from './merge.mjs';

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
