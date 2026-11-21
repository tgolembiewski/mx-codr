// The installer (overlay/install.mjs), section 1: mxcli. The pinned binary found or downloaded, the v2 gate's copy
// moved, and ./mxcli made the pinned one.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PIN } from '../lib/mx.mjs';
import { FOOTPRINT } from './common.mjs';
import { ui, die } from './screen.mjs';

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
export function findMxcli(app, prev) {
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
export async function download(foot, live) {
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
