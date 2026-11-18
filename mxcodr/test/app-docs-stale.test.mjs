// When the app documentation is out of date (2026-11-18, the owner: "almost every time I open the Docs tab it asks me
// to update, though nothing changed in the app"). Measured on a large real app (Windows, mxcli 0.32): 4 of the 5 stale reports
// in two days named only "app", 3 of them with no model save in between: mx-codr's own add-on modules (MxCodr,
// MxCodrBridge, Type Add-on) carry the package version into `show modules`, and every package update changed it.
// mxcli 0.31 -> 0.32 changed 3 of 6 module hashes on the same model (DESCRIBE's wording). The fix: the model's own
// files are the witness (the .mpr and mprcontents/, the same bytes whatever mxcli reads them); the DESCRIBE parts only
// say which part changed, and only when the witness did. No mxcli: a fake runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as F from '../overlay/skills/app-docs/fingerprint.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-docs-stale-'));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

function fakeModel(over = {}) {
  const m = {
    version: 'mxcli version v0.32.0',
    modules: [{ Module: 'Shop', Source: '', Type: 'App', Version: '1.0.0' }, { Module: 'Atlas_Core', Source: 'Marketplace v4.1.0', Type: 'App', Version: '1.0.0' },
      { Module: 'MxCodr', Source: 'Packaged, Protected AddOn', Type: 'Add-on', Version: '1.82.74' }, { Module: 'System', Source: '', Type: '', Version: '' }],
    Shop: 'create persistent entity Shop.Order (\n  Number: Integer\n);\n',
    nav: 'navigation', sec: 'security', roles: 'roles', settings: 'settings', ...over,
  };
  return args => {
    if (args[0] === '--version') return m.version + '\n';
    if (args[0] === 'describe' && args[1] === 'module') return m[args[2]];
    const stmt = args[args.length - 1];
    return { 'show modules': JSON.stringify(m.modules), 'describe navigation': m.nav, 'show project security': m.sec, 'show user roles': m.roles, 'describe settings': m.settings }[stmt];
  };
}
/** An MPR v2 app on disk: the .mpr and two unit files. */
function app() {
  const d = tmp();
  put(d, 'App.mpr', 'sqlite bytes');
  put(d, 'mprcontents/ab/cd/abcd-1.mxunit', 'unit one');
  put(d, 'mprcontents/ef/01/ef01-2.mxunit', 'unit two');
  return { d, mpr: path.join(d, 'App.mpr') };
}

test('stale: mx-codr\'s own add-on modules (Type Add-on, the package version) are not part of the app; a Marketplace version still is', () => {
  const { mpr } = app();
  const a = F.fingerprint({ mpr, run: fakeModel() });
  const updated = F.fingerprint({ mpr, run: fakeModel({ modules: [{ Module: 'Shop', Source: '', Type: 'App', Version: '1.0.0' }, { Module: 'Atlas_Core', Source: 'Marketplace v4.1.0', Type: 'App', Version: '1.0.0' }, { Module: 'MxCodr', Source: 'Packaged, Protected AddOn', Type: 'Add-on', Version: '1.82.75' }, { Module: 'System', Source: '', Type: '', Version: '' }] }) });
  assert.equal(updated.parts.app, a.parts.app, 'a new mx-codr package changes nothing');
  const atlas = F.fingerprint({ mpr, run: fakeModel({ modules: [{ Module: 'Shop', Source: '', Type: 'App', Version: '1.0.0' }, { Module: 'Atlas_Core', Source: 'Marketplace v4.2.0', Type: 'App', Version: '1.0.0' }, { Module: 'System', Source: '', Type: '', Version: '' }] }) });
  assert.notEqual(atlas.parts.app, a.parts.app, 'the page lists Marketplace modules with their versions');
  assert.ok(!('module:MxCodr' in a.parts), 'an add-on is never an app module');
});

test('stale: the brain part is the requirements the page cites (docs/brain/plan/); a decision captured elsewhere in the brain changes nothing', () => {
  const { d, mpr } = app();
  put(d, 'docs/brain/project.md', '- decision one\n');
  put(d, 'docs/brain/plan/01-orders.md', '## R1 Orders\n');
  const a = F.fingerprint({ mpr, run: fakeModel() });
  put(d, 'docs/brain/project.md', '- decision one\n- decision two\n');
  put(d, 'docs/brain/modules/Shop.md', '- a Shop decision\n');
  const b = F.fingerprint({ mpr, run: fakeModel() });
  assert.equal(b.parts.brain, a.parts.brain);
  assert.deepEqual(F.compare(a, b), { current: true, parts: [], mxcli: false });
  put(d, 'docs/brain/plan/01-orders.md', '## R1 Orders\n## R2 Invoices\n');
  assert.deepEqual(F.compare(a, F.fingerprint({ mpr, run: fakeModel() })).parts, ['brain']);
});

test('stale: the model\'s own files are the witness: format 2, the same for any mxcli, any change of the .mpr or a unit changes it', () => {
  const { d, mpr } = app();
  const a = F.fingerprint({ mpr, run: fakeModel() });
  assert.equal(a.v, 2);
  assert.match(a.model, /^[0-9a-f]{16}$/);
  assert.equal(F.fingerprint({ mpr, run: fakeModel({ version: 'mxcli version v0.40.0' }) }).model, a.model, 'mxcli does not enter the witness');
  put(d, '.mxcli/widgets/x.def.json', '{}');
  put(d, 'docs/app-docs.html', '<html>');
  assert.equal(F.fingerprint({ mpr, run: fakeModel() }).model, a.model, 'mxcli\'s cache and the page are not the model');
  put(d, 'mprcontents/ef/01/ef01-2.mxunit', 'unit two, saved again');
  assert.notEqual(F.fingerprint({ mpr, run: fakeModel() }).model, a.model);
  const v1 = tmp(); put(v1, 'Old.mpr', 'one file'); const one = F.fingerprint({ mpr: path.join(v1, 'Old.mpr'), run: fakeModel() });
  put(v1, 'Old.mpr', 'one file, saved'); assert.notEqual(F.fingerprint({ mpr: path.join(v1, 'Old.mpr'), run: fakeModel() }).model, one.model, 'MPR v1: the .mpr is the whole model');
  assert.ok(!JSON.stringify(a).includes('legacy'), 'only the stored fields reach the meta');
});

test('stale: another mxcli with the same model is current (no bar, no rewrite); a changed model under another mxcli says so without guessing the parts', () => {
  const { d, mpr } = app();
  const written = F.fingerprint({ mpr, run: fakeModel({ version: 'mxcli version v0.31.0', Shop: 'call microflow wording of 0.31' }) });
  const same = F.fingerprint({ mpr, run: fakeModel({ Shop: 'wording of 0.32' }) });
  assert.deepEqual(F.compare(written, same), { current: true, parts: [], mxcli: true });
  put(d, 'mprcontents/ab/cd/abcd-1.mxunit', 'unit one, changed');
  const changed = F.fingerprint({ mpr, run: fakeModel({ Shop: 'wording of 0.32' }) });
  assert.deepEqual(F.compare(written, changed), { current: false, parts: ['model'], mxcli: true });
});

test('stale: the same mxcli: an unchanged model is current whatever DESCRIBE says now (a widget definition, a cache); a saved change names its parts; layout only stays current', () => {
  const { d, mpr } = app();
  const written = F.fingerprint({ mpr, run: fakeModel() });
  const noise = F.fingerprint({ mpr, run: fakeModel({ Shop: "pluggablewidget 'com.mendix.widget.web.fileuploader.FileUploader' up (" }) });
  assert.notEqual(noise.parts['module:Shop'], written.parts['module:Shop']);
  assert.deepEqual(F.compare(written, noise), { current: true, parts: [], mxcli: false });
  put(d, 'mprcontents/ab/cd/abcd-1.mxunit', 'unit one, a box moved');
  assert.deepEqual(F.compare(written, F.fingerprint({ mpr, run: fakeModel() })), { current: true, parts: [], mxcli: false });
  const attr = F.fingerprint({ mpr, run: fakeModel({ Shop: 'create persistent entity Shop.Order (\n  Number: Integer,\n  Total: Decimal\n);\n' }) });
  assert.deepEqual(F.compare(written, attr), { current: false, parts: ['module:Shop'], mxcli: false });
});

test('stale: a page written before format 2 (the old formulas, no witness): modules and the whole brain compared as then, app not (it held the add-on versions); no bar on first open', () => {
  const { d, mpr } = app();
  put(d, 'docs/brain/project.md', '- decision one\n'); // a large real app: a brain without plan/
  const run = fakeModel();
  const now = F.fingerprint({ mpr, run });
  // the page as format 1 wrote it: the module list with Version and the add-ons, every file of docs/brain/
  const mods = JSON.parse(run(['-p', mpr, '--json', '-c', 'show modules']));
  const oldApp = F.hash([run(['-c', 'describe navigation']), run(['-c', 'show project security']), run(['-c', 'show user roles']), run(['-c', 'describe settings']),
    mods.map(m => `${m.Module} ${m.Source || ''} ${m.Version || ''}`).join('\n')].join('\n--\n'));
  const oldParts = { 'module:Shop': now.parts['module:Shop'], app: oldApp, brain: F.brainHash(path.join(d, 'docs', 'brain')) };
  const old = { mxcli: now.mxcli, generatedAt: 'then', overall: F.hash(Object.keys(oldParts).sort().map(k => `${k}=${oldParts[k]}`).join('\n')), parts: oldParts };
  assert.notEqual(oldApp, now.parts.app);
  assert.deepEqual(F.compare(old, now), { current: true, parts: [], mxcli: false });
  put(d, 'docs/brain/project.md', '- decision one\n- decision two\n');
  assert.deepEqual(F.compare(old, F.fingerprint({ mpr, run })).parts, ['brain'], 'such a page cited the whole brain');
  put(d, 'docs/brain/project.md', '- decision one\n');
  assert.deepEqual(F.compare({ ...old, parts: { ...old.parts, 'module:Shop': 'y' } }, now).parts, ['module:Shop']);
  assert.ok(!JSON.stringify(now).includes(oldParts.brain), 'the old brain hash is never stored');
});

test('stale: stamp (Mark as current) writes the new fingerprint into the meta, every section\'s data-hash and the footer, and nothing else', () => {
  const { mpr } = app();
  const old = F.fingerprint({ mpr, run: fakeModel({ nav: 'old navigation' }) });
  const now = F.fingerprint({ mpr, run: fakeModel() });
  const page = `<!DOCTYPE html><html><head>\n<meta name="mxcodr-docs" content='${JSON.stringify(old)}'>\n</head><body>\n`
    + `<header class="top" data-src="app" data-hash="${old.parts.app}">Shop app</header>\n`
    + `<section id="model-Shop" class="page wide" data-src="module:Shop" data-hash="${old.parts['module:Shop']}"><p>Orders</p></section>\n`
    + `<section id="build" class="page" data-src="all" data-hash="${old.overall}"></section>\n`
    + `<section id="reqs" class="page" data-src="brain" data-hash="${old.parts.brain}"></section>\n`
    + `<footer>English. Fingerprint <span class="mono">${old.overall}</span>.</footer></body></html>\n`;
  const out = F.stamp(page, now);
  assert.deepEqual(F.readMeta(out), JSON.parse(JSON.stringify(now)));
  assert.match(out, new RegExp(`data-src="app" data-hash="${now.parts.app}"`));
  assert.match(out, new RegExp(`data-src="module:Shop" data-hash="${now.parts['module:Shop']}"`));
  assert.match(out, new RegExp(`data-src="all" data-hash="${now.overall}"`));
  assert.match(out, new RegExp(`data-src="brain" data-hash="${now.parts.brain}"`));
  assert.match(out, new RegExp(`Fingerprint <span class="mono">${now.overall}</span>`));
  assert.ok(!out.includes(old.overall));
  assert.equal(out.replace(/<meta name="mxcodr-docs"[^>]*>/, '').replace(/[0-9a-f]{16}/g, 'H'), page.replace(/<meta name="mxcodr-docs"[^>]*>/, '').replace(/[0-9a-f]{16}/g, 'H'), 'only the hashes changed');
  assert.equal(F.stamp('<html><head></head></html>', now), null, 'no meta: nothing to stamp');
});
