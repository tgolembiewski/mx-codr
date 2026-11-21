// The app's look: the theme the installer offers, on a stub app. mxcli is a stub `run` that writes what
// `mxcli theme create/apply/remove` write (measured on mxcli 0.28.0, probe-v2-theme, and confirmed identical on 0.29.0 (2026-11-01) and 0.30.0 (2026-11-04)); the real
// mxcli run is the end-to-end proof in the README.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalog, resolveTheme, decideTheme, activeFrameTheme, applyTheme, writeFrame, listLines, askTheme, installThemeTool, THEMES_DIR, AS_IS } from '../overlay/lib/theme.mjs';
import { installerSource } from './installer-source.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-theme-'));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const get = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const walk = (root, d = root, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(root, p, out) : out.push(path.relative(root, p)); } return out.sort(); };
const snapshot = root => Object.fromEntries(walk(root).map(f => [f, fs.readFileSync(path.join(root, f), 'latin1')]));

// A stub app as `mxcli new` leaves it: an .mpr, a model folder, and mxcli's default theme (signal) under theme/web/.
function stubApp() {
  const d = tmp();
  put(d, 'App.mpr', 'mpr');
  put(d, 'mprcontents/a/b.mxunit', 'model');
  put(d, 'theme/web/main.scss', '// mxcli:theme:begin signal\n// mxcli:theme:end signal\n');
  put(d, 'theme/web/_mxcli-signal.scss', 'signal');
  put(d, 'theme/web/logo.png', 'mendix logo');
  return d;
}
// What mxcli 0.28 writes (identical on 0.29.0 and 0.30.0): create scaffolds theme/mxcli-themes/<name>/files/theme/web/_mxcli-<name>.scss,
// apply copies that partial to theme/web/ (dropping the other theme's), remove deletes the generated files.
function stubMxcli(app, calls = []) {
  return args => {
    calls.push(args.join(' '));
    const [, verb, name] = args;
    if (verb === 'create') put(app, `theme/mxcli-themes/${name}/files/theme/web/_mxcli-${name}.scss`, `// mxcli:theme:begin ${name}\ntokens\n// mxcli:theme:end ${name}\n`);
    if (verb === 'apply') {
      for (const f of fs.readdirSync(path.join(app, 'theme/web'))) if (/^_mxcli-(?!atlas-map|recipes|widgets)/.test(f)) fs.rmSync(path.join(app, 'theme/web', f));
      fs.copyFileSync(path.join(app, `theme/mxcli-themes/${name}/files/theme/web/_mxcli-${name}.scss`), path.join(app, `theme/web/_mxcli-${name}.scss`));
    }
    if (verb === 'remove') for (const f of fs.readdirSync(path.join(app, 'theme/web'))) if (f.startsWith('_mxcli-')) fs.rmSync(path.join(app, 'theme/web', f));
    return { status: 0, stdout: '', stderr: '' };
  };
}

test('the catalog: six themes, atlas first, each non-atlas one with its tokens, frame and logo; the preview carries the same catalog', () => {
  const names = catalog().map(t => t.name);
  assert.deepEqual(names, ['atlas', 'navy', 'teal', 'amber', 'plum', 'forest']);
  for (const n of names.slice(1)) {
    assert.ok(fs.existsSync(path.join(THEMES_DIR, `${n}.css`)), `${n}.css`);
    assert.match(fs.readFileSync(path.join(THEMES_DIR, `${n}.skin.scss`), 'utf8'), new RegExp(`^// -+\\n// mx-codr frame for the ${n} theme`));
  }
  for (const n of names) for (const f of ['logo.png', 'favicon.ico', 'img/icon-192.png']) assert.ok(fs.existsSync(path.join(THEMES_DIR, 'logos', n, f)), `${n}/${f}`);
  const preview = fs.readFileSync(path.join(THEMES_DIR, 'preview.html'), 'utf8');
  assert.deepEqual(JSON.parse(preview.match(/var CATALOG = (\[.*\]);/)[1]), catalog());
  assert.doesNotMatch(preview, /tests\/theme\.sh/);
});

test('resolve: a number or a name, empty is atlas, anything else is nothing', () => {
  assert.equal(resolveTheme(''), 'atlas');
  assert.equal(resolveTheme(' 3 '), 'teal');
  assert.equal(resolveTheme('Plum'), 'plum');
  assert.equal(resolveTheme('7'), '');
  assert.equal(resolveTheme('0'), '');
  assert.equal(resolveTheme('signal'), '');
});

test('decide: --theme wins; a recorded theme is kept; no terminal or --yes leaves the look as it is; a terminal is asked once', () => {
  assert.deepEqual(decideTheme({ flag: 'teal', prev: { theme: 'navy' }, tty: true }), { name: 'teal', how: 'flag' });
  assert.throws(() => decideTheme({ flag: 'pink' }), /--theme pink: not one of atlas, navy, teal, amber, plum, forest/);
  assert.deepEqual(decideTheme({ prev: { theme: 'navy' }, tty: true }), { name: 'navy', how: 'kept' });
  assert.deepEqual(decideTheme({ prev: {}, tty: false }), { name: null, how: AS_IS });
  assert.deepEqual(decideTheme({ prev: {}, tty: true, yes: true }), { name: null, how: AS_IS });
  assert.deepEqual(decideTheme({ prev: {}, tty: true }), { name: null, how: 'ask' });
  // the default recorded once is not asked again: the reinstall loop would nag
  assert.deepEqual(decideTheme({ prev: { theme: AS_IS }, tty: true }), { name: null, how: AS_IS });
  // a v1 app with no record but an mx-codr theme active: that one, its frame refreshed
  assert.deepEqual(decideTheme({ prev: {}, tty: true, active: 'plum' }), { name: 'plum', how: 'found' });
});

test('the default (no terminal, no flag) changes nothing in the app', () => {
  const d = stubApp();
  const before = snapshot(d);
  const calls = [];
  const choice = decideTheme({ prev: {}, tty: false, active: activeFrameTheme(d) });
  const r = applyTheme({ app: d, mpr: 'App.mpr', choice, run: stubMxcli(d, calls) });
  assert.equal(r.theme, AS_IS);
  assert.deepEqual(calls, []);
  assert.deepEqual(snapshot(d), before);
});

test('apply teal: theme create from the bundle tokens, the frame into the scaffold, apply --variant light, the teal logo; only theme/ changes', () => {
  const d = stubApp();
  const before = snapshot(d);
  const calls = [];
  const r = applyTheme({ app: d, mpr: 'App.mpr', choice: { name: 'teal', how: 'flag' }, run: stubMxcli(d, calls) });
  assert.equal(r.ok, true, r.line);
  assert.equal(r.theme, 'teal');
  assert.deepEqual(calls.map(c => c.replace(THEMES_DIR, '<themes>')), [
    'theme create teal -p App.mpr --from <themes>/teal.css --base signal',
    'theme apply teal -p App.mpr --variant light',
  ]);
  assert.match(get(d, 'theme/web/_mxcli-teal.scss'), /mx-codr frame for the teal theme[\s\S]*--navtopbar-bg: #0c6766/);
  assert.deepEqual(fs.readFileSync(path.join(d, 'theme/web/logo.png')), fs.readFileSync(path.join(THEMES_DIR, 'logos/teal/logo.png')));
  const after = snapshot(d);
  const changed = Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]);
  assert.ok(changed.length > 3);
  for (const f of changed) assert.match(f, /^theme\//, `${f} is outside theme/`);
});

test('apply atlas: mxcli theme remove (Mendix\'s own look) and the atlas logo; nothing else', () => {
  const d = stubApp();
  const calls = [];
  const r = applyTheme({ app: d, mpr: 'App.mpr', choice: { name: 'atlas', how: 'flag' }, run: stubMxcli(d, calls) });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['theme remove -p App.mpr']);
  assert.ok(!fs.existsSync(path.join(d, 'theme/web/_mxcli-signal.scss')));
});

test('reinstall: the kept theme is re-applied with the bundle\'s frame, replacing the old one, and keeps the app\'s logo', () => {
  const d = stubApp();
  applyTheme({ app: d, mpr: 'App.mpr', choice: { name: 'navy', how: 'flag' }, run: stubMxcli(d) });
  // an earlier bundle's frame in the scaffold, and a logo the person put in since
  const partial = 'theme/mxcli-themes/navy/files/theme/web/_mxcli-navy.scss';
  put(d, partial, get(d, partial).replace(/--navtopbar-bg: #[0-9a-f]+/, '--navtopbar-bg: #000000'));
  put(d, 'theme/web/logo.png', 'their own logo');
  assert.equal(activeFrameTheme(d), 'navy');
  const calls = [];
  const r = applyTheme({ app: d, mpr: 'App.mpr', choice: decideTheme({ prev: { theme: 'navy' }, tty: true }), run: stubMxcli(d, calls) });
  assert.equal(r.ok, true, r.line);
  assert.match(r.line, /frame refreshed/);
  assert.deepEqual(calls, ['theme apply navy -p App.mpr --variant light'], 'no second create');
  assert.equal(get(d, partial).split('mx-codr frame for').length, 2, 'one frame, not two');
  assert.doesNotMatch(get(d, 'theme/web/_mxcli-navy.scss'), /#000000/);
  assert.equal(get(d, 'theme/web/logo.png'), 'their own logo');
});

test('reinstall: a kept theme the app no longer has active is left alone', () => {
  const d = stubApp();
  const calls = [];
  const r = applyTheme({ app: d, mpr: 'App.mpr', choice: { name: 'forest', how: 'kept' }, run: stubMxcli(d, calls) });
  assert.deepEqual(calls, []);
  assert.equal(r.theme, 'forest');
  assert.match(r.line, /not active/);
});

test('a failing mxcli is said, never fatal', () => {
  const d = stubApp();
  const r = applyTheme({ app: d, mpr: 'App.mpr', choice: { name: 'amber', how: 'flag' }, run: () => ({ status: 1, stdout: '', stderr: 'refused: local edits' }) });
  assert.equal(r.ok, false);
  assert.match(r.line, /amber.*refused: local edits.*node \.mxcodr\/theme\.mjs amber/);
});

test('writeFrame twice leaves one frame', () => {
  const d = stubApp();
  put(d, 'theme/mxcli-themes/plum/files/theme/web/_mxcli-plum.scss', 'tokens\n');
  writeFrame('plum', d); writeFrame('plum', d);
  const text = get(d, 'theme/mxcli-themes/plum/files/theme/web/_mxcli-plum.scss');
  assert.ok(text.startsWith('tokens\n\n// ----'));
  assert.equal(text.split('mx-codr frame for').length, 2);
});

test('the list: one row per theme, atlas the default; --plain has no escape codes', () => {
  const plain = listLines(true);
  assert.equal(plain.length, 6);
  assert.match(plain[0], /^ {4}1 {2}atlas +Mendix's own Atlas look — blue frame, no mxcli theme {2}\(default\)$/);
  assert.ok(plain.every(l => !l.includes('\x1b')));
  assert.ok(listLines(false).every(l => l.includes('\x1b[')));
});

test('ask: Enter is atlas; a wrong answer is asked again', async () => {
  const io = answers => {
    const out = [];
    return { out, input: { question: async () => answers.shift() }, write: s => out.push(s) };
  };
  let t = io(['']);
  assert.equal(await askTheme({ rl: t.input, write: t.write, plain: true, openPreview: () => false }), 'atlas');
  assert.match(t.out.join(''), /How should the app look\?[\s\S]*Preview: .*preview\.html[\s\S]*Change it later: node \.mxcodr\/theme\.mjs <name>/);
  t = io(['pink', '5']);
  assert.equal(await askTheme({ rl: t.input, write: t.write, plain: true, openPreview: () => true }), 'plum');
  assert.match(t.out.join(''), /the preview opened in your browser[\s\S]*Type a number from the list, or a theme name/);
});

test('the change-it-later command: .mxcodr/theme.mjs and .mxcodr/themes/ in the app, and it runs there', () => {
  const d = stubApp();
  installThemeTool(d);
  assert.ok(fs.existsSync(path.join(d, '.mxcodr/theme.mjs')));
  assert.ok(fs.existsSync(path.join(d, '.mxcodr/themes/teal.skin.scss')));
  assert.ok(fs.existsSync(path.join(d, '.mxcodr/themes/logos/forest/logo.png')));
  const r = spawnSync(process.execPath, ['.mxcodr/theme.mjs', 'list', '--plain'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /now: as mxcli new made it[\s\S]*6 {2}forest/);
  const bad = spawnSync(process.execPath, ['.mxcodr/theme.mjs', 'pink'], { cwd: d, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no theme 'pink'/);
});

test('the installer takes --theme and --yes, records the theme, and installs the change-it-later command', () => {
  const src = installerSource();
  assert.match(src, /opt\('--theme'\)/);
  assert.match(src, /argv\.includes\('--yes'\)/);
  assert.match(src, /theme: themeResult\.theme/);
  assert.match(src, /installThemeTool\(app\)/);
  assert.match(fs.readFileSync(fileURLToPath(new URL('../install.sh', import.meta.url)), 'utf8'), /--theme <name>\] \[--yes\]/);
});

// ---- live.36: the Look tab's knobs make a theme "custom" from tokens only (no CSS of ours) ----------------------
import { customTokens, customSkin, makeCustom, KNOBS } from '../overlay/lib/theme.mjs';
const tokensOf = text => Object.fromEntries([...text.matchAll(/--mxt-([a-z-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const darkOf = text => tokensOf(text.slice(text.indexOf('@media (prefers-color-scheme: dark)')));
const lightOf = text => tokensOf(text.slice(0, text.indexOf('@media (prefers-color-scheme: dark)')));

test('custom tokens: the base theme\'s palette with the brand colour and its derived tones, the radius and the font; only --mxt-* tokens the base declares', () => {
  const css = customTokens({ base: 'navy', brand: '#7f5af0', radius: 'round', font: 'system' });
  const base = fs.readFileSync(path.join(THEMES_DIR, 'navy.css'), 'utf8');
  const l = lightOf(css), d = darkOf(css);
  assert.equal(l.brand, '#7f5af0');
  assert.equal(l['brand-hover'], '#6346bb', 'hover: the brand 22% towards black, as the catalog does');
  assert.equal(l['brand-ink'], '#ffffff');
  assert.equal(l['surface-selected'], '#f0ebfd', 'a tint: 88% towards white');
  assert.equal(d.brand, '#b9a4f7', 'dark: the brand 45% towards white');
  assert.equal(l.radius, KNOBS.radius.round[0]);
  assert.equal(l['radius-lg'], KNOBS.radius.round[1]);
  assert.equal(l.font, KNOBS.font.system.value);
  for (const k of Object.keys({ ...l, ...d })) assert.ok(SIGNAL_TOKENS.includes(k), `--mxt-${k} is one of mxcli's tokens`);
  assert.equal(l.ground, lightOf(base).ground, 'the rest of the palette is the base theme\'s');
  assert.doesNotMatch(css, /[{;]\s*(?!--mxt-)[a-z-]+\s*:/, 'nothing but --mxt-* declarations');
  assert.equal(lightOf(customTokens({ base: 'navy', brand: '#f5d90a' }))['brand-ink'], '#14202e', 'a light brand gets dark text');
  assert.throws(() => customTokens({ base: 'navy', brand: 'red' }), /#rrggbb/);
  assert.throws(() => customTokens({ base: 'atlas', brand: '#123456' }), /base/);
});
const SIGNAL_TOKENS = ['brand', 'brand-hover', 'brand-ink', 'control-height', 'danger', 'focus-halo', 'font', 'font-heading', 'font-mono', 'font-size', 'ground', 'info', 'ink', 'ink-faint', 'ink-muted', 'line', 'line-height', 'radius', 'radius-lg', 'rail', 'rail-ink', 'rail-ink-active', 'rail-line', 'row-height', 'shadow', 'success', 'surface', 'surface-alt', 'surface-hover', 'surface-selected', 'tint-info', 'tint-neutral', 'tint-ok', 'tint-risk', 'tint-warn', 'tone-info', 'tone-ok', 'tone-risk', 'tone-warn', 'warning'];

test('custom frame: the base theme\'s frame with only its Atlas variables\' colours changed', () => {
  const skin = customSkin({ base: 'teal', brand: '#7f5af0' });
  const base = fs.readFileSync(path.join(THEMES_DIR, 'teal.skin.scss'), 'utf8');
  assert.match(skin, /--navtopbar-bg: #59... ?;|--navtopbar-bg: #[0-9a-f]{6};/);
  assert.doesNotMatch(skin, /#0c6766|#14595a/, 'the base colours replaced');
  assert.equal(skin.replace(/#[0-9a-f]{6}/g, '#x'), base.replace(/#[0-9a-f]{6}/g, '#x').replace(/teal/g, 'custom'), 'same rules, colours only');
});

test('makeCustom: create (or --force over an earlier custom), its frame, apply with the chosen variant; theme/ only', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-custom-'));
  const calls = [];
  const partial = path.join(app, 'theme', 'mxcli-themes', 'custom', 'files', 'theme', 'web', '_mxcli-custom.scss');
  const run = args => {
    calls.push(args.join(' '));
    if (args[1] === 'create') { fs.mkdirSync(path.dirname(partial), { recursive: true }); fs.writeFileSync(partial, '// scaffold\n'); }
    return { status: 0, stdout: '', stderr: '' };
  };
  const dir = path.join(app, '.mxcodr', 'look');
  let r = makeCustom({ app, mpr: 'A.mpr', run, dir, knobs: { base: 'navy', brand: '#7f5af0', radius: 'slight', font: 'plex', variant: 'dark' } });
  assert.equal(r.ok, true, r.line);
  assert.match(calls[0], /^theme create custom -p A\.mpr --from .*custom\.css --base signal$/);
  assert.equal(calls[1], 'theme apply custom -p A.mpr --variant dark');
  assert.match(fs.readFileSync(partial, 'utf8'), /mx-codr frame for/);
  r = makeCustom({ app, mpr: 'A.mpr', run, dir, knobs: { base: 'navy', brand: '#123456', radius: 'sharp', font: 'open', variant: 'light' } });
  assert.match(calls[2], /--force$/, 're-editing overwrites the earlier custom');
});

test('applyTheme passes the variant (light by default, as file mode)', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-variant-'));
  const calls = [];
  const partial = path.join(app, 'theme', 'mxcli-themes', 'teal', 'files', 'theme', 'web', '_mxcli-teal.scss');
  const run = args => { calls.push(args.join(' ')); if (args[1] === 'create') { fs.mkdirSync(path.dirname(partial), { recursive: true }); fs.writeFileSync(partial, '// s\n'); } return { status: 0 }; };
  applyTheme({ app, mpr: 'A.mpr', choice: { name: 'teal', how: 'flag', variant: 'auto' }, run });
  assert.equal(calls.at(-1), 'theme apply teal -p A.mpr --variant auto');
});
