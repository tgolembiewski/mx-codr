#!/usr/bin/env node
// Writes overlay/lib/kit-shipped.json: the sha256 of every version of the starter test kit mx-codr ever wrote into an
// app, per kit file. copyTestKit replaces a kit file whose text is one of these (the person never edited it) with the
// current kit, and keeps any other text as the person's.
//   node mxcodr/tools/kit-shipped.mjs        (from the repository root; rerun after changing a kit template or KIT_EDITS)
// What counts as shipped, for every commit on any ref that touched the kit templates (mxcodr/overlay/templates/tests/,
// before 2026-11-01 mxcodr-v2/overlay/templates/tests/) or overlay/lib/live.mjs, and for the working tree:
//   - plain: the template as file mode copies it;
//   - live: the template with that commit's KIT_EDITS (live.mjs liveKitText; before KIT_EDITS the live kit was plain);
//   - wired: tests/playwright.config.ts after the extension's setup ran a wireTestsTab over it (any commit's, repeated
//     until nothing changes: a config wired by one setup and given the trace line by a later one).
// Hashes are of the text with CRLF turned into LF (git's autocrlf in an app gives a kit file CRLF); copyTestKit hashes
// the app's file the same way. Entries are only ever added: a version that once shipped stays shipped.
// mxcodr/test/kit-update.test.mjs fails when the current kit's hashes are missing here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(repo, 'mxcodr', 'overlay', 'lib', 'kit-shipped.json');
const KIT = ['mx.ts', 'mx.teardown.ts', 'playwright.config.ts', 'package.json'];
const DIRS = ['mxcodr/overlay/templates/tests', 'mxcodr-v2/overlay/templates/tests'];
const LIVE = ['mxcodr/overlay/lib/live.mjs', 'mxcodr-v2/overlay/lib/live.mjs'];
const lf = t => t.replace(/\r\n/g, '\n');
const sha = t => crypto.createHash('sha256').update(lf(t), 'utf8').digest('hex');

const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const show = (c, p) => { try { return git('show', `${c}:${p}`); } catch { return null; } };
const firstThere = (c, ps) => { for (const p of ps) { const t = show(c, p); if (t !== null) return t; } return null; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-shipped-'));
async function liveModule(text, tag) {
  if (!text || !/export const liveKitText/.test(text)) return null;
  const f = path.join(tmp, `live-${tag}.mjs`);
  fs.writeFileSync(f, text);
  return import(pathToFileURL(f).href);
}

// oldest first, so each hash is labelled with the first commit that shipped it
const commits = git('log', '--all', '--reverse', '--format=%H %h %ad', '--date=short', '--', ...DIRS, ...LIVE).trim().split('\n').filter(Boolean)
  .map(l => { const [sha, short, date] = l.split(' '); return { sha, label: `${short} ${date}` }; });
const versions = [];   // { label, files: { name: text }, live }
for (const c of commits) {
  const files = {};
  for (const n of KIT) { const t = firstThere(c.sha, DIRS.map(d => `${d}/${n}`)); if (t !== null) files[n] = t; }
  if (!Object.keys(files).length) continue;
  versions.push({ label: c.label, files, live: await liveModule(firstThere(c.sha, LIVE), c.sha.slice(0, 12)) });
}
{
  const files = {};
  for (const n of KIT) { const f = path.join(repo, DIRS[0], n); if (fs.existsSync(f)) files[n] = fs.readFileSync(f, 'utf8'); }
  const f = path.join(repo, LIVE[0]);
  versions.push({ label: 'working tree', files, live: await liveModule(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null, 'worktree') });
}

// a commit whose KIT_EDITS did not fit its own template shipped nothing live: noted, the plain text stands in
const liveText = (v, n, t) => { if (!v.live) return t; try { return v.live.liveKitText(n, t); } catch (e) { console.warn(`${v.label}: ${n}: ${e.message}`); return t; } };
const found = Object.fromEntries(KIT.map(n => [n, new Map()]));   // name -> Map(hash -> label)
const add = (n, text, label) => { const h = sha(text); if (!found[n].has(h)) found[n].set(h, label); };
for (const v of versions) {
  for (const [n, t] of Object.entries(v.files)) {
    add(n, t, `${v.label} plain`);
    add(n, liveText(v, n, t), `${v.label} live`);
  }
}
// the configs setup wired: every wireTestsTab over every config text known, until no new text comes out
const wires = versions.filter(v => v.live?.wireTestsTab).map(v => ({ label: v.label, wire: v.live.wireTestsTab }));
const configs = new Map();
for (const v of versions) if (v.files['playwright.config.ts']) {
  const t = v.files['playwright.config.ts'];
  for (const x of [t, liveText(v, 'playwright.config.ts', t)]) configs.set(lf(x), true);
}
for (let round = 0, grew = true; grew && round < 6; round++) {
  grew = false;
  for (const t of [...configs.keys()]) for (const w of wires) {
    let r; try { r = w.wire(t); } catch { continue; }
    if (r?.changed && !configs.has(lf(r.text))) { configs.set(lf(r.text), true); add('playwright.config.ts', r.text, `${w.label} wired`); grew = true; }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

let prev = {};
try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).files || {}; } catch { /* first run */ }
const files = {};
for (const n of KIT) {
  const rel = `tests/${n}`;
  const all = { ...Object.fromEntries(found[n]), ...(prev[rel] || {}) };   // a kept entry keeps its first label
  files[rel] = Object.fromEntries(Object.keys(all).sort().map(h => [h, all[h]]));
}
const out = {
  about: 'sha256 of every version of the starter test kit mx-codr wrote into an app (LF text), per file; generated by mxcodr/tools/kit-shipped.mjs, never edited by hand',
  files,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`${path.relative(repo, OUT)}: ${KIT.map(n => `tests/${n} ${Object.keys(files[`tests/${n}`]).length}`).join(', ')} (${versions.length} versions)`);
