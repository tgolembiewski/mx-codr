// The installer (overlay/install.mjs), section 5b: the starter test kit.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { liveKitText } from '../lib/live.mjs';
import { OVERLAY } from './common.mjs';

// ---- 5b. the starter test kit -------------------------------------------------------------------

// The kit (templates/tests/): helpers for sign-in and sign-out, dialogs, grids, OQL and forged calls, its
// teardown and a Playwright config. An absent file is written. A file already there is left alone unless its text is
// one mx-codr shipped before (lib/kit-shipped.json: every past version, plain, live and as setup wired it; CRLF
// counts as LF): then the person never edited it and it is replaced with the current kit (its CRLF kept), so a fix
// in the kit reaches apps installed earlier. Any other text is the person's: kept, and `edited` names it once
// (the kit's later fixes are not in it). A link or other non-file is never written through. The agent's specs and
// helpers.ts are never touched. The config is left out when the app already has a Playwright config at its root
// (two configs: the kit's teardown would silently not run). The teardown and the config import from ./mx, so they
// are left out too when tests/mx.ts is the person's own: not in the last install's record (prevKit) and not a text
// mx-codr shipped; and an unedited teardown or config is not updated when it would import a name the person's
// edited tests/mx.ts does not export. A kept tests/package.json that pins another Playwright gets the pin hint
// (the finish condition needs --shuffle). mxcli init does not touch tests/.
// -> { written, updated, kept, edited, ours, lines }; kept = the files there that were not written (current or the
// person's), edited = those of them that are the person's text; ours = the kit files there now that are the kit's
// (written or updated now, or kept and recorded before or the current kit's text): what installed.json records as testKit.
// bundle 2026.11.20.1: tests/mx.ts is the short list of helpers and signatures agents read; the code is in tests/mx-impl.ts
// (agents read the kit whole whatever a skill says: 24.6k characters before). mx-impl.ts comes first so mx.ts is written
// only beside it.
export const TEST_KIT = ['tests/mx-impl.ts', 'tests/mx.ts', 'tests/mx.teardown.ts', 'tests/playwright.config.ts', 'tests/package.json'];
export const PLAYWRIGHT = '1.64.1'; // the version tests/package.json pins: it has --shuffle
const MX_DEPENDENTS = ['tests/mx.teardown.ts', 'tests/playwright.config.ts'];
// what kit-shipped.json hashes: the text with CRLF as LF (an app's git with autocrlf checks a kit file out CRLF)
export const lfText = t => t.replace(/\r\n/g, '\n');
export const kitHash = t => crypto.createHash('sha256').update(lfText(t), 'utf8').digest('hex');
// the hashes of the kit versions mx-codr shipped, per kit file ({} when the data file is missing: nothing is replaced)
export function kitShipped(file = path.join(OVERLAY, 'lib', 'kit-shipped.json')) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).files || {}; } catch { return {}; }
}
// the kit's mx.ts imports ./mx-impl: written or updated only when tests/mx-impl.ts is (or becomes) the kit's, never over
// a file of that name the kit did not write
const IMPL = 'tests/mx-impl.ts';
// live: the Studio Pro extension's kit (lib/live.mjs KIT_EDITS), compared and written as edited; file mode copies.
// shipped: the hashes to replace (tests pass their own).
export function copyTestKit(app, prevKit = [], src = path.join(OVERLAY, 'templates', 'tests'), { live = false, shipped = kitShipped() } = {}) {
  const written = [], updated = [], kept = [], edited = [], ours = [], lines = [];
  const isThere = f => { try { fs.lstatSync(f); return true; } catch { return false; } };
  const kitText = name => { const t = fs.readFileSync(path.join(src, name), 'utf8'); return live ? liveKitText(name, t) : t; };
  const appText = rel => { try { const f = path.join(app, rel); return fs.lstatSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null; } catch { return null; } };
  // an existing kit file: the current kit's text, a text mx-codr shipped before, or the person's (a link counts as theirs)
  const stateOf = rel => {
    const t = appText(rel);
    if (t === null) return 'own';
    if (lfText(t) === lfText(kitText(path.basename(rel)))) return 'current';
    return shipped[rel]?.[kitHash(t)] ? 'shipped' : 'own';
  };
  const rootConfig = ['ts', 'js', 'mjs', 'cjs'].map(e => `playwright.config.${e}`).find(f => fs.existsSync(path.join(app, f)));
  // a package.json or Playwright config at the root is the app's setup: no second one in tests/
  const rootSetup = fs.existsSync(path.join(app, 'package.json')) ? 'package.json' : rootConfig;
  const mxState = isThere(path.join(app, 'tests/mx.ts')) ? stateOf('tests/mx.ts') : null;
  const ownMx = mxState === 'own' && !prevKit.includes('tests/mx.ts');
  // the names a kit text imports from ./mx that the person's edited tests/mx.ts does not export
  const mxOwn = mxState === 'own' ? appText('tests/mx.ts') ?? '' : null;
  const missingFromMx = text => mxOwn === null ? [] : [...text.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'\.\/mx'/gm)]
    .flatMap(m => m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean))
    .filter(n => !new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|type|interface|class)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b`).test(mxOwn));
  const skipped = [], held = [], heldRel = [];
  const implTheirs = isThere(path.join(app, IMPL)) && stateOf(IMPL) === 'own' && !prevKit.includes(IMPL);
  for (const rel of TEST_KIT) {
    const f = path.join(app, rel);
    if (rel === 'tests/mx.ts' && implTheirs) {
      if (isThere(f)) { kept.push(rel); if (stateOf(rel) === 'own') edited.push(rel); else ours.push(rel); }
      held.push(`${rel} (${IMPL} is not the kit's)`); heldRel.push(rel);
      continue;
    }
    if (isThere(f)) {
      const st = stateOf(rel);
      if (st === 'shipped') {
        const text = kitText(path.basename(rel));
        const missing = MX_DEPENDENTS.includes(rel) ? missingFromMx(text) : [];
        if (missing.length) { held.push(`${rel} (imports ${missing.join(', ')})`); heldRel.push(rel); kept.push(rel); ours.push(rel); continue; }
        const old = appText(rel);
        fs.writeFileSync(f, old.includes('\r\n') ? lfText(text).replace(/\n/g, '\r\n') : text);
        updated.push(rel);
        ours.push(rel);
        continue;
      }
      kept.push(rel);
      if (st === 'own') edited.push(rel);
      if (st === 'current' || prevKit.includes(rel)) ours.push(rel);
      continue;
    }
    if (ownMx && MX_DEPENDENTS.includes(rel)) { skipped.push(rel); continue; }
    // the person's own tests/mx.ts that does not import the kit's code: no mx-impl.ts beside it
    if (ownMx && rel === IMPL && !/from\s*['"]\.\/mx-impl['"]/.test(mxOwn ?? '')) continue;
    if (rel === 'tests/playwright.config.ts' && rootConfig) { lines.push(`test kit: no tests/playwright.config.ts, the app has ${rootConfig}; name globalTeardown: './tests/mx.teardown.ts' in it`); continue; }
    if (rel === 'tests/package.json' && rootSetup) { lines.push(`test kit: no tests/package.json, the app has ${rootSetup} at its root; pin @playwright/test there: npm install -D -E @playwright/test@${PLAYWRIGHT}`); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (live) fs.writeFileSync(f, kitText(path.basename(rel)));
    else fs.copyFileSync(path.join(src, path.basename(rel)), f);
    written.push(rel);
    ours.push(rel);
  }
  reportKit(app, { written, updated, kept, edited, held, heldRel, skipped, lines });
  ours.sort((x, y) => TEST_KIT.indexOf(x) - TEST_KIT.indexOf(y));
  return { written, updated, kept, edited, ours, lines };
}
// The kit's lines for the person, after the files: what was written, updated, kept, yours, held or skipped, and the
// pin hint for a kept tests/package.json. Pushed onto lines.
function reportKit(app, { written, updated, kept, edited, held, heldRel, skipped, lines }) {
  const current = kept.filter(r => !edited.includes(r) && !heldRel.includes(r));
  if (written.length) lines.push(`test kit -> ${written.join(', ')}`);
  if (updated.length) lines.push(`test kit: updated ${updated.join(', ')} to the current kit (unchanged since an earlier mx-codr wrote them)`);
  if (current.length) lines.push(`test kit: kept ${current.join(', ')}`);
  if (edited.length) lines.push(`test kit: ${edited.join(', ')} ${edited.length > 1 ? 'are' : 'is'} yours (not a text mx-codr shipped), kept as ${edited.length > 1 ? 'they are' : 'it is'}: the kit's later fixes are not in ${edited.length > 1 ? 'them' : 'it'}; to take the current kit, move ${edited.length > 1 ? 'them' : 'it'} aside and install again (in Studio Pro: run the mx-codr setup again)`);
  if (held.length) lines.push(`test kit: not updated ${held.join(', ')}: ${held.some(h => h.includes(IMPL)) ? `the kit's tests/mx.ts imports ${IMPL}; move yours aside and install again` : 'your tests/mx.ts does not export what the current kit imports'}; kept as before`);
  if (skipped.length) lines.push(`test kit: skipped ${skipped.join(', ')}: tests/mx.ts is the app's own and they import from the kit's mx.ts; to get the kit, move tests/mx.ts aside and install again`);
  if (kept.includes('tests/package.json')) {
    const pin = playwrightPin(path.join(app, 'tests/package.json'));
    if (pin !== PLAYWRIGHT) lines.push(`test kit: tests/package.json ${pin ? `pins @playwright/test ${pin}` : 'does not pin @playwright/test'}; the finish condition needs --shuffle, so pin it in tests/: npm install -D -E @playwright/test@${PLAYWRIGHT}`);
  }
}
// The @playwright/test version a package.json names (dev or plain dependency), or null.
function playwrightPin(f) {
  try { const p = JSON.parse(fs.readFileSync(f, 'utf8')); return p.devDependencies?.['@playwright/test'] || p.dependencies?.['@playwright/test'] || null; } catch { return null; }
}
