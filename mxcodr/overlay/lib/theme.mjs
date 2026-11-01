// The app's look: six themes the installer offers (overlay/themes/catalog.json), applied with mxcli's own
// theme commands. Only files under theme/ change, never the model. Self-contained: the installer copies
// this file to the app as .mxcodr/theme.mjs and the themes to .mxcodr/themes/, so the person can change
// the look later:
//     node .mxcodr/theme.mjs              the themes, each as a slice of the app in its colours
//     node .mxcodr/theme.mjs preview      open the preview page (every theme on a real app)
//     node .mxcodr/theme.mjs <n|name>     apply that theme
//
// atlas is Mendix's own Atlas: `mxcli theme remove` takes away any mxcli theme (mxcli new applies its
// signal theme). The others are created once from <name>.css on mxcli's signal base; their frame
// (<name>.skin.scss: top bar, active menu item, outline buttons, control heights; only Atlas variables)
// goes into the scaffold's partial, replacing an earlier bundle's frame, before `mxcli theme apply
// --variant light`. The mx-codr mark in the theme's colours replaces Mendix's logo and icons in theme/web/.
// With no --theme and no terminal (an unattended run) nothing is applied: the app keeps the look it has.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// overlay/lib/theme.mjs reads overlay/themes/; the app's .mxcodr/theme.mjs reads .mxcodr/themes/
export const THEMES_DIR = [path.join(here, 'themes'), path.join(here, '..', 'themes')].find(d => fs.existsSync(path.join(d, 'catalog.json'))) || path.join(here, '..', 'themes');
// installed.json's theme when none was chosen: the app keeps the look it had
export const AS_IS = 'as-is';

export const catalog = (dir = THEMES_DIR) => JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
const hasFrame = name => fs.existsSync(path.join(THEMES_DIR, `${name}.skin.scss`));
const partialOf = (app, name) => path.join(app, 'theme', 'mxcli-themes', name, 'files', 'theme', 'web', `_mxcli-${name}.scss`);

// A number from the list or a name -> the theme name; empty -> the first (atlas); anything else -> ''.
export function resolveTheme(choice) {
  const themes = catalog();
  const c = String(choice ?? '').trim().toLowerCase();
  if (!c) return themes[0].name;
  if (/^\d+$/.test(c)) return themes[Number(c) - 1]?.name || '';
  return themes.find(t => t.name === c)?.name || '';
}

// The mx-codr theme the app shows now (its partial in theme/web/), or ''.
export function activeFrameTheme(app) {
  for (const t of catalog()) if (hasFrame(t.name) && fs.existsSync(path.join(app, 'theme', 'web', `_mxcli-${t.name}.scss`))) return t.name;
  return '';
}

// What to do: {name, how}. how: flag (--theme), kept (the last install's), found (an mx-codr theme active
// with no record: an app from v1), ask (a terminal, nothing recorded), as-is (nothing applied).
export function decideTheme({ flag, prev = {}, tty = false, yes = false, active = '' }) {
  if (flag !== undefined) {
    const name = resolveTheme(flag);
    if (!name || !String(flag).trim()) throw new Error(`--theme ${flag}: not one of ${catalog().map(t => t.name).join(', ')}`);
    return { name, how: 'flag' };
  }
  if (prev.theme && catalog().some(t => t.name === prev.theme)) return { name: prev.theme, how: 'kept' };
  if ('theme' in prev) return { name: null, how: AS_IS };
  if (active) return { name: active, how: 'found' };
  if (tty && !yes) return { name: null, how: 'ask' };
  return { name: null, how: AS_IS };
}

// The frame goes after the scaffold's own block; an earlier frame (from its marker to the end) is replaced.
export function writeFrame(name, app) {
  const skin = path.join(THEMES_DIR, `${name}.skin.scss`), partial = partialOf(app, name);
  if (!fs.existsSync(skin) || !fs.existsSync(partial)) return false;
  const text = fs.readFileSync(partial, 'utf8');
  const start = text.search(/^\/\/ -+\n\/\/ mx-codr frame for /m);
  const kept = (start < 0 ? text : text.slice(0, start)).replace(/\n*$/, '\n');
  fs.writeFileSync(partial, kept + '\n' + fs.readFileSync(skin, 'utf8'));
  return true;
}

// The browser and home-screen icons, the sign-in logo and Atlas's top-bar logo, by the names mxbuild
// copies from theme/web/ (logos/<name>/ mirrors theme/web/).
export function copyLogo(name, app) {
  const src = path.join(THEMES_DIR, 'logos', name), web = path.join(app, 'theme', 'web');
  if (!fs.existsSync(src) || !fs.existsSync(web)) return false;
  fs.cpSync(src, web, { recursive: true });
  // `mxcli run --watch` copies theme/web/ only when a stylesheet changes: nudge one
  const main = path.join(web, 'main.scss');
  if (fs.existsSync(main)) { const now = new Date(); fs.utimesSync(main, now, now); }
  return true;
}

// Applies the decision. run(args) runs mxcli in the app -> {status, stdout, stderr}.
// -> {ok, theme (what installed.json records), line (what to print, or '')}. Never throws for mxcli.
export function applyTheme({ app, mpr, choice, run }) {
  const { name, how } = choice;
  if (!name) return { ok: true, theme: AS_IS, line: '' };
  const fail = r => (r.stderr || r.stdout || '').trim().split('\n').pop();
  const again = ['kept', 'found'].includes(how);
  const said = what => `theme ${name}: ${what}`;
  const failed = why => ({ ok: false, theme: name, line: `${said(`could not be applied (${why})`)}; try: node .mxcodr/theme.mjs ${name}` });
  if (again) {
    // a reinstall keeps the theme: only the frame is refreshed, and only while the theme is still the app's
    if (!hasFrame(name)) return { ok: true, theme: name, line: '' };
    if (activeFrameTheme(app) !== name || !fs.existsSync(partialOf(app, name))) return { ok: true, theme: name, line: said('kept, not active in theme/web/ any more, left as it is') };
  }
  if (name === 'atlas') {
    run(['theme', 'remove', '-p', mpr]); // fails when the app has no mxcli theme: that is Atlas already
    copyLogo(name, app);
    return { ok: true, theme: name, line: said("Mendix's own Atlas (no mxcli theme)") };
  }
  if (!fs.existsSync(partialOf(app, name))) {
    const c = run(['theme', 'create', name, '-p', mpr, '--from', path.join(THEMES_DIR, `${name}.css`), '--base', 'signal']);
    if (c.status !== 0) return failed(`mxcli theme create: ${fail(c)}`);
  }
  if (!writeFrame(name, app)) return failed('its frame has no scaffold to go into');
  const a = run(['theme', 'apply', name, '-p', mpr, '--variant', 'light']);
  if (a.status !== 0) return failed(`mxcli theme apply: ${fail(a)}`);
  if (!again) copyLogo(name, app); // a reinstall keeps whatever logo the app carries now
  return { ok: true, theme: name, line: said(again ? 'kept, frame refreshed' : 'applied (theme/ only)') };
}

// ---- the list and the question ------------------------------------------------------------------

function colour(hex, layer) {
  const h = hex.replace(/^#+/, '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  if (['truecolor', '24bit'].includes(process.env.COLORTERM || '')) return `\x1b[${layer};2;${r};${g};${b}m`;
  const q = v => Math.floor((v * 5) / 255);
  return `\x1b[${layer};5;${16 + 36 * q(r) + 6 * q(g) + q(b)}m`;
}
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - [...s].length));

// One line per theme: number, name, a slice of the app in its colours (side menu, top bar, page, a
// selected row, the Save button), the description. plain: no escape codes.
export function listLines(plain) {
  const R = '\x1b[0m', B = '\x1b[1m', G = '\x1b[38;5;245m';
  const bg = h => colour(h, 48), fg = h => colour(h, 38);
  return catalog().map((t, i) => {
    const n = i + 1, l = t.light, desc = t.description.split(' -- ').join(' — '), dflt = n === 1 ? '  (default)' : '';
    if (plain) return `    ${n}  ${pad(t.name, 8)} ${desc}${dflt}`;
    const top = t.frame?.top || l.rail;
    const swatch = bg(l.rail) + fg(l['rail-ink-active']) + ' ▤ ' + R + bg(top) + fg('#ffffff') + ' Your App ' + R +
      bg(l.ground) + fg(l.ink) + ' Orders ' + R + bg(l['surface-selected']) + fg(l.ink) + ' INV-042 ' + R +
      bg(l.brand) + fg(l['brand-ink']) + ' Save ' + R;
    return `    ${B}${n}${R}  ${pad(t.name, 8)} ${swatch}  ${G}${desc}${dflt}${R}`;
  });
}

export const previewPage = () => path.join(THEMES_DIR, 'preview.html');

// Opens a file in the browser, best effort and silent. -> true when a browser was started.
export function openInBrowser(file) {
  if (process.env.MXCODR_NO_BROWSER || process.env.CI) return false;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore' }); p.on('error', () => {}); p.unref(); return true; } catch { return false; }
}

// Asks once: the list, the preview page, then a number or name until one fits. Enter is atlas.
// rl: {question(prompt) -> Promise<string>}; write(text). -> the theme name.
export async function askTheme({ rl, write, plain, openPreview = openInBrowser }) {
  const page = previewPage();
  const opened = openPreview(page);
  write(`\n  How should the app look?${opened ? '  (the preview opened in your browser)\n\n' : `\n  Preview: ${page}\n\n`}`);
  write(listLines(plain).join('\n') + '\n');
  write('\n    menu · top bar · page · selected row · button. Change it later: node .mxcodr/theme.mjs <name>\n');
  for (;;) {
    const name = resolveTheme(await rl.question('\n  Theme [1]: '));
    if (name) { write('\n'); return name; }
    write('  Type a number from the list, or a theme name.\n');
  }
}

// ---- the change-it-later command in the app ------------------------------------------------------

// Copies this file to .mxcodr/theme.mjs and the themes (tokens, frames, logos, the preview) to .mxcodr/themes/.
export function installThemeTool(app) {
  const foot = path.join(app, '.mxcodr');
  fs.mkdirSync(foot, { recursive: true });
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(foot, 'theme.mjs'));
  fs.rmSync(path.join(foot, 'themes'), { recursive: true, force: true });
  fs.cpSync(THEMES_DIR, path.join(foot, 'themes'), { recursive: true });
  return '.mxcodr/theme.mjs and .mxcodr/themes/ (change the look later: node .mxcodr/theme.mjs)';
}

function cli(argv) {
  const app = process.cwd();
  const mpr = fs.readdirSync(app).find(f => f.endsWith('.mpr'));
  if (!mpr) { console.error('no .mpr here: run it in the app folder (node .mxcodr/theme.mjs)'); return 2; }
  const plain = argv.includes('--plain') || Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;
  const cmd = argv.filter(a => a !== '--plain')[0] || 'list';
  const inst = (() => { try { return JSON.parse(fs.readFileSync(path.join(app, '.mxcodr', 'installed.json'), 'utf8')); } catch { return {}; } })();
  if (cmd === 'list') {
    const now = activeFrameTheme(app) || (inst.theme && inst.theme !== AS_IS ? inst.theme : 'as mxcli new made it');
    console.log(`The app's look (now: ${now})\n\n${listLines(plain).join('\n')}\n\n  node .mxcodr/theme.mjs <number|name>   switch    node .mxcodr/theme.mjs preview   see them all`);
    return 0;
  }
  if (cmd === 'preview') {
    if (!openInBrowser(previewPage())) console.log(`open this in a browser: ${previewPage()}`);
    return 0;
  }
  const name = resolveTheme(cmd);
  if (!name) { console.error(`no theme '${cmd}': node .mxcodr/theme.mjs lists them`); return 2; }
  const mxcli = [inst.mxcli?.path, path.join(app, 'mxcli'), 'mxcli'].find(m => m === 'mxcli' || (m && fs.existsSync(m)));
  const run = args => spawnSync(mxcli, args, { cwd: app, encoding: 'utf8', env: { ...process.env, MXCLI_QUIET: '1' } });
  const r = applyTheme({ app, mpr, choice: { name, how: 'flag' }, run });
  console.log(r.line);
  if (!r.ok) return 1;
  // installed.json records the choice, so a reinstall keeps it
  if (inst.bundle) fs.writeFileSync(path.join(app, '.mxcodr', 'installed.json'), JSON.stringify({ ...inst, theme: r.theme }, null, 1));
  console.log('With the app running under --watch, reload the page in a few seconds (a hard reload for the tab icon).');
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = cli(process.argv.slice(2));
