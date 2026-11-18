// The app documentation skill (owner-approved 2026-11-15): installed always, for every agent; one sentence in the
// always-on rule text (the end-of-turn update once docs/app-docs.html exists), gone when the skill is switched off;
// the fingerprint the agent writes and the mx-codr panel recomputes ignores layout-only changes. No mxcli: a fake runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copySkills, writeRules } from '../overlay/install.mjs';
import { ruleText, mdcText, SKILLS_DIR, AGENTS, START, END, checkRule, readTemplate } from '../overlay/lib/rules.mjs';
import { INSTALLED_SKILLS } from '../overlay/lib/skills.mjs';
import { DOCS_SENTENCE } from '../overlay/lib/skilloff.mjs';
import { fingerprint, noLayout, readMeta, compare, findMxcli, brainHash } from '../overlay/skills/app-docs/fingerprint.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-docs-'));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const skill = f => fs.readFileSync(new URL(`../overlay/skills/app-docs/${f}`, import.meta.url), 'utf8');

test('app-docs is installed always, with its template and fingerprint, into every agent\'s skills folder; live mode runs the fingerprint through ./mxcodr-live', () => {
  assert.ok(INSTALLED_SKILLS.includes('app-docs'));
  for (const live of [false, true]) {
    const d = tmp();
    put(d, 'App.mpr', 'mpr');
    copySkills(d, AGENTS, undefined, { live });
    for (const dir of new Set(Object.values(SKILLS_DIR))) {
      for (const f of ['SKILL.md', 'template.html', 'fingerprint.mjs']) assert.ok(fs.existsSync(path.join(d, dir, 'app-docs', f)), `${dir} ${f} live=${live}`);
      const t = fs.readFileSync(path.join(d, dir, 'app-docs', 'SKILL.md'), 'utf8');
      if (live) {
        assert.match(t, /`\.\/mxcodr-live docs fingerprint`/);
        assert.match(t, /`\.\/mxcodr-live docs check` names the parts/);
        assert.doesNotMatch(t, /node <this skill's folder>\/fingerprint\.mjs/, 'a node line asks every time in Standard');
      } else assert.match(t, /`node <this skill's folder>\/fingerprint\.mjs -p <app>\.mpr --check docs\/app-docs\.html`/);
    }
  }
});

test('the rule sentence: in every shape of the rule text (file, coverage, live, every agent), still 38 lines; gone when app-docs is off', () => {
  const rule = readTemplate('mxcodr.md');
  assert.equal(rule.split('\n').length - 1, 38);
  assert.ok(rule.trimEnd().endsWith(DOCS_SENTENCE.trim()), 'the last line of templates/mxcodr.md');
  for (const dir of new Set(Object.values(SKILLS_DIR)))
    for (const opts of [{}, { coverage: true }, { live: true }, { live: true, skillsOff: ['film-tests'] }]) {
      const t = ruleText(dir, undefined, opts);
      assert.ok(t.includes(DOCS_SENTENCE), `${dir} ${JSON.stringify(opts)}`);
      assert.deepEqual(checkRule(t), []);
      const off = ruleText(dir, undefined, { ...opts, skillsOff: [...(opts.skillsOff ?? []), 'app-docs'] });
      assert.ok(!off.includes('app-docs'), `${dir} ${JSON.stringify(opts)}: switched off, the rule no longer names it`);
      assert.match(off, /Marketplace widgets only from publisher Mendix or Mendix Labs\.\n/);
    }
  assert.ok(mdcText().includes(DOCS_SENTENCE));
  const d = tmp();
  put(d, 'App.mpr', 'mpr');
  writeRules(d, AGENTS);
  const md = fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8');
  assert.ok(md.slice(md.indexOf(START), md.indexOf(END)).includes(DOCS_SENTENCE));
});

test('the skill: when (on request, then each turn that changed the model), the jargon ban, links on every name, the secrets ban', () => {
  const t = skill('SKILL.md');
  assert.match(t, /\*\*Generate\*\* only when the person asks\. Never on your own/);
  assert.match(t, /at the end of every turn that changed the model/);
  assert.match(t, /never "persistent", "non-persistent", "specialises",\n?\s*"generalisation", "cardinality", "association"/);
  assert.match(t, /\*\*Every Mendix name is a link\*\*/);
  assert.match(t, /constant values, URLs of configurations, passwords/);
  assert.match(t, /\*\*Check before you claim\.\*\*/);
  assert.match(t, /\*\*The key is visual, the behaviour is text\.\*\*/);
  assert.match(t, /Never rewrite an unchanged section/);
});

test('the skill: comments (docs/app-docs.comments.json): only open ones and their passages, a contradiction answered not applied, never deleted; updates keep commented passages', () => {
  const t = skill('SKILL.md');
  assert.match(t, /`docs\/app-docs\.comments\.json`/);
  assert.match(t, /Work on the comments with `status: "open"` only, and in the page only on their passages/);
  assert.match(t, /set the comment's `status` to `"resolved"`/);
  assert.match(t, /Where the note contradicts the model[^\n]*do not change the text:\n\s*set `status` to `"answered"`, `reply`/);
  assert.match(t, /never delete a comment/);
  assert.match(t, /A passage with an open or answered comment \(section 8\)|A passage with an open or answered comment \(section 7\)/);
});

test('the template: print CSS for Save as PDF (light theme, no switch, a section per page, the drawing whole, names plain)', () => {
  const t = skill('template.html');
  const print = /@media print \{([\s\S]*?)\n\}/.exec(t)?.[1] ?? '';
  assert.match(print, /:root\[data-theme="dark"\][^{]*\{ color-scheme: light; --paper: #ffffff;/);
  assert.match(print, /\.theme \{ display: none; \}/);
  assert.match(print, /main > section\.page ~ section\.page \{ break-before: page; \}/);
  assert.match(print, /figure\.drawing, \.sheet, \.titleblock[^{]*\{ break-inside: avoid; \}/);
  assert.match(print, /a\.mx, a\.mx:hover \{ color: inherit; text-decoration: none; \}/);
});

test('the template: two inline scripts, element links that are harmless outside the panel, in-page anchors scrolled, Google Fonts only', () => {
  const t = skill('template.html');
  const scripts = [...t.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2);
  assert.match(scripts[1], /closest\("a\.mx"\)/);
  assert.match(scripts[1], /e\.preventDefault\(\);if\(up\)window\.parent\.postMessage\(\{mxcodrDocs:"open",name:a\.getAttribute\("data-mx"\),kind:a\.getAttribute\("data-kind"\)\}/);
  assert.match(scripts[1], /up=window\.parent!==window/, 'posts only when framed');
  assert.match(scripts[1], /scrollIntoView\(\)/, 'a srcdoc frame resolves "#id" against the panel\'s URL: the script scrolls itself');
  assert.match(t, /<a class="mx" href="#" data-mx="Module\.Name" data-kind="entity\|microflow\|nanoflow\|page\|snippet\|enumeration\|role">/);
  assert.match(t, /a\.mx \{ color: inherit;/);
  for (const m of t.matchAll(/(?:href|src)="(https?:[^"]+)"/g)) assert.match(m[1], /^https:\/\/fonts\.(googleapis|gstatic)\.com/);
});

// a fake mxcli: the model as a few texts
function fakeModel(over = {}) {
  const m = {
    modules: [{ Module: 'Shop', Source: '' }, { Module: 'Admin', Source: '' }, { Module: 'Atlas_Core', Source: 'Marketplace v4.1.0', Version: '4.1.0' }, { Module: 'System', Source: '' }],
    Shop: '@position(100, 200)\ncreate persistent entity Shop.Order (\n  Number: Integer\n);\n@annotation(text: \'a note\', position: (10, 20))\n',
    Admin: 'create persistent entity Admin.Log (\n  Text: String(200)\n);\n',
    nav: 'navigation', sec: 'security', roles: 'roles', settings: 'settings', ...over,
  };
  return args => {
    if (args[0] === '--version') return 'mxcli version v0.31.0\n';
    if (args[0] === 'describe' && args[1] === 'module') return m[args[2]];
    const stmt = args[args.length - 1];
    return { 'show modules': JSON.stringify(m.modules), 'describe navigation': m.nav, 'show project security': m.sec, 'show user roles': m.roles, 'describe settings': m.settings }[stmt];
  };
}

test('fingerprint: a layout-only change (boxes moved, annotation moved) keeps every hash; an attribute changes its module and overall only', () => {
  const d = tmp();
  put(d, 'App.mpr', 'mpr');
  const mpr = path.join(d, 'App.mpr');
  const a = fingerprint({ mpr, run: fakeModel() });
  assert.deepEqual(Object.keys(a.parts).sort(), ['app', 'brain', 'module:Admin', 'module:Shop']);
  assert.equal(a.parts.brain, 'none');
  assert.match(a.overall, /^[0-9a-f]{16}$/);
  const moved = fingerprint({ mpr, run: fakeModel({ Shop: '@position(900, 40)\ncreate persistent entity Shop.Order (\n  Number: Integer\n);\n@annotation(text: \'a note\', position: (300, 5))\n' }) });
  assert.deepEqual(moved.parts, a.parts);
  assert.equal(moved.overall, a.overall);
  const crlf = fingerprint({ mpr, run: fakeModel({ Shop: fakeModel()(['describe', 'module', 'Shop']).replace(/\n/g, '\r\n') }) });
  assert.equal(crlf.overall, a.overall, 'Windows line ends change nothing');
  put(d, 'mprcontents/ab/cd/abcd.mxunit', 'the model saved with a change'); // the witness (format 2): a saved model
  const attr = fingerprint({ mpr, run: fakeModel({ Shop: '@position(100, 200)\ncreate persistent entity Shop.Order (\n  Number: Integer,\n  Total: Decimal\n);\n' }) });
  assert.notEqual(attr.parts['module:Shop'], a.parts['module:Shop']);
  assert.equal(attr.parts['module:Admin'], a.parts['module:Admin']);
  assert.equal(attr.parts.app, a.parts.app);
  assert.notEqual(attr.overall, a.overall);
  assert.deepEqual(compare(a, attr), { current: false, parts: ['module:Shop'], mxcli: false });
  // the annotation's text is content: changing it counts
  assert.notEqual(noLayout("@annotation(text: 'a', position: (1, 2))"), noLayout("@annotation(text: 'b', position: (1, 2))"));
  // the navigation is the app part
  assert.deepEqual(compare(a, fingerprint({ mpr, run: fakeModel({ nav: 'navigation 2' }) })).parts, ['app']);
});

test('fingerprint: the brain part follows docs/brain/ (paths with /, the same on Windows); meta read back; compare', () => {
  const d = tmp();
  put(d, 'App.mpr', 'mpr');
  put(d, 'docs/brain/plan/01-orders.md', '## R1 Orders\n');
  const mpr = path.join(d, 'App.mpr');
  const a = fingerprint({ mpr, run: fakeModel() });
  assert.notEqual(a.parts.brain, 'none');
  assert.equal(a.parts.brain, brainHash(path.join(d, 'docs', 'brain', 'plan')), 'the requirements the page cites');
  put(d, 'docs/brain/plan/01-orders.md', '## R1 Orders\n## R2 Invoices\n');
  const b = fingerprint({ mpr, run: fakeModel() });
  assert.deepEqual(compare(a, b).parts, ['brain']);
  const html = `<html><head><meta name="mxcodr-docs" content='${JSON.stringify(a)}'></head></html>`;
  assert.deepEqual(readMeta(html), a);
  assert.equal(readMeta('<html></html>'), null);
  assert.equal(readMeta(`<meta name="mxcodr-docs" content="${JSON.stringify(a).replace(/"/g, '&quot;')}">`).overall, a.overall);
  assert.deepEqual(compare(a, a), { current: true, parts: [], mxcli: false });
  assert.equal(compare(a, { ...a, mxcli: 'mxcli version v0.32.0' }).mxcli, true);
  assert.deepEqual(compare(null, a), { current: false, parts: ['all'], mxcli: false });
  // a module added or removed is a part that differs
  const { 'module:Admin': _, ...fewer } = a.parts;
  assert.deepEqual(compare({ ...a, parts: fewer, overall: 'x', model: '0'.repeat(16) }, a).parts, ['module:Admin']);
});

test('fingerprint: the app\'s own mxcli (mxcli.exe on Windows), else the PATH one', () => {
  const d = tmp();
  assert.equal(findMxcli(d, 'win32'), 'mxcli.exe');
  assert.equal(findMxcli(d, 'darwin'), 'mxcli');
  put(d, 'mxcli.exe', '');
  put(d, 'mxcli', '');
  assert.equal(findMxcli(d, 'win32'), path.join(d, 'mxcli.exe'));
  assert.equal(findMxcli(d, 'darwin'), path.join(d, 'mxcli'));
});

test('the template v4 drawing: Studio Pro\'s domain-model colours as --dm-* tokens in light, dark and print, AA for its text; the key drawn with the drawing\'s classes', () => {
  const t = skill('template.html');
  const NAMES = ['--dm-ent', '--dm-ent-fill', '--dm-ent-ink', '--dm-np', '--dm-np-fill', '--dm-np-ink', '--dm-gen', '--dm-gen-ink', '--dm-line', '--dm-red'];
  const sets = [...t.matchAll(/--dm-ent: #[0-9a-f]{6};[^}]*?--dm-red: #[0-9a-f]{6};/g)].map(m => Object.fromEntries([...m[0].matchAll(/(--dm-[a-z-]+): (#[0-9a-f]{6})/g)].map(x => [x[1], x[2]])));
  assert.equal(sets.length, 4, 'light, the two dark blocks, print');
  for (const s of sets) assert.deepEqual(Object.keys(s).sort(), [...NAMES].sort());
  const [light, dark1, dark2, print] = sets;
  assert.deepEqual(dark1, dark2); assert.deepEqual(print, light);
  assert.equal(dark1['--dm-ent'], '#4b4fd6'); assert.equal(dark1['--dm-ent-fill'], '#2b2f52'); assert.equal(dark1['--dm-np'], '#d4a23c'); assert.equal(dark1['--dm-np-fill'], '#4a4430');
  assert.equal(dark1['--dm-gen'], '#5b8def'); assert.equal(dark1['--dm-red'], '#d9534f');
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const s of [light, dark1]) {
    assert.ok(ratio(s['--dm-ent-ink'], s['--dm-ent-fill']) >= 4.5, 'entity text');
    assert.ok(ratio(s['--dm-np-ink'], s['--dm-np-fill']) >= 4.5, 'temporary entity text');
    assert.ok(ratio(s['--dm-gen-ink'], s['--dm-gen']) >= 4.5, 'generalization tag');
  }
  assert.ok(ratio('#ffffff', light['--dm-ent']) >= 4.5, 'the icon\'s "e"');
  const css = /<style>([\s\S]*?)<\/style>/.exec(t)[1];
  for (const c of ['svg .box {', 'svg .hd {', 'svg rect.ico {', 'svg rect.gen {', 'svg circle.mult {', 'svg text.mult {', 'svg rect.label {', 'svg text.label {']) assert.ok(css.includes(c), c);
  assert.match(css, /svg rect\.label \{ fill: var\(--sheet\); stroke: var\(--dm-red\);/);
  assert.doesNotMatch(css, /\.band/, 'no header bands (v3) left');
  const key = /<div class="keycell">[\s\S]*?<\/div><\/div><\/div><\/div>/.exec(t.slice(t.indexOf('<body>')))[0];
  for (const c of ['class="box"', 'class="box np"', 'class="hd"', 'class="ico np"', 'class="gen"', 'circle class="mult"', 'rect class="label"']) assert.ok(key.includes(c), `key sample ${c}`);
  const sk = skill('SKILL.md');
  assert.match(sk, /`Name \(Type\)`: String, Integer, Long, Decimal, Boolean, Date and time, Enumeration/);
  assert.match(sk, /`circle\.mult`/); assert.match(sk, /`rect\.label` \(the red border\)/); assert.match(sk, /`rect\.gen` 14 high/); assert.match(sk, /the entity icon \(`rect\.ico`/);
});
