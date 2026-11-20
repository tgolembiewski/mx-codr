// Nothing added to or changed in a Marketplace module (2026-11-17: an app's agent added documents to WorkflowCommons
// and edited snippets in it; the module's update deleted them). The texts say so (the rule file, live.md, module-structure,
// reuse-and-snippets) and module-structure's marketplace-check.mjs warns about what is there anyway. No mxcli, no
// network: the diffs are mxcli 0.32's `marketplace diff --json` output as measured on a scratch app (mxcli new 11.12.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copySkills } from '../overlay/install.mjs';
import { ruleText, AGENTS, SKILLS_DIR, checkRule, readTemplate } from '../overlay/lib/rules.mjs';
import { bsonTop, marketplaceModules, classify, check, baselineFrom, report, readBaseline, BASELINE, readTranslated, TRANSLATIONS } from '../overlay/skills/module-structure/marketplace-check.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-mkt-'));
const skill = f => fs.readFileSync(new URL(`../overlay/skills/${f}`, import.meta.url), 'utf8');

// A minimal BSON encoder: strings, booleans, int32, a nested document (skipped by the reader), binary.
function bson(fields) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    const key = Buffer.from(`${k}\0`);
    if (typeof v === 'string') { const s = Buffer.from(`${v}\0`); const l = Buffer.alloc(4); l.writeInt32LE(s.length); parts.push(Buffer.from([2]), key, l, s); }
    else if (typeof v === 'boolean') parts.push(Buffer.from([8]), key, Buffer.from([v ? 1 : 0]));
    else if (typeof v === 'number') { const n = Buffer.alloc(4); n.writeInt32LE(v); parts.push(Buffer.from([16]), key, n); }
    else if (Buffer.isBuffer(v)) { const l = Buffer.alloc(4); l.writeInt32LE(v.length); parts.push(Buffer.from([5]), key, l, Buffer.from([0]), v); }
    else parts.push(Buffer.from([3]), key, bson(v));
  }
  const body = Buffer.concat([...parts, Buffer.from([0])]);
  const len = Buffer.alloc(4); len.writeInt32LE(body.length + 4);
  return Buffer.concat([len, body]);
}
const moduleUnit = (name, extra) => bson({ $ID: Buffer.alloc(16, 1), $Type: 'Projects$ModuleImpl', AppStoreGuid: '', AppStorePackageIdString: '',
  AppStoreVersion: '', FromAppStore: false, IsThemeModule: false, Settings: { Name: 'not the module name' }, Name: name, ...extra });

function fakeApp() {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'App.mpr'), 'mpr');
  const put = (rel, buf) => { const f = path.join(d, 'mprcontents', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };
  put('ab/cd/1.mxunit', moduleUnit('WorkflowCommons', { AppStorePackageIdString: '117066', AppStoreVersion: '3.12.0', FromAppStore: true }));
  put('ab/ce/2.mxunit', moduleUnit('Administration', { AppStorePackageIdString: '23513', AppStoreVersion: '4.3.2', FromAppStore: true }));
  put('ef/01/3.mxunit', moduleUnit('Shop'));
  put('ef/02/4.mxunit', moduleUnit('FromFile', { FromAppStore: true }));
  put('ef/03/5.mxunit', bson({ $Type: 'Pages$Page', Name: 'Projects$ModuleImpl lookalike' }));
  return d;
}

// mxcli 0.32 `marketplace diff --json`, measured 2026-11-17 on a scratch app (Administration 4.3.2, Mendix 11.12.1)
const ok = json => ({ status: 0, stdout: JSON.stringify(json), stderr: '' });
const EDITED = ok({ module: 'Administration', installedVersion: '4.3.2', locallyModified: true, verified: true,
  modified: ['ENTITY Account', 'PAGE Account_Overview', 'SNIPPET ReadMe'], onlyInstalled: ['MICROFLOW ACT_MyAppThing', 'SNIPPET SNIPPET_AppBanner'], unchangedCount: 18 });
const PRISTINE = ok({ module: 'Administration', installedVersion: '4.3.2', locallyModified: true, verified: true, modified: ['PAGE Account_Overview'], unchangedCount: 20 });
const CLEAN = ok({ module: 'DataWidgets', installedVersion: '3.5.0', locallyModified: false, verified: true, unchangedCount: 5 });
const UNKNOWN = ok({ module: 'Atlas_Web_Content', installedVersion: '4.1.0', locallyModified: false, verified: false,
  unknown: [{ element: 'PAGE_TEMPLATE Blank', reason: 'no DESCRIBE support' }, { element: 'PAGE_TEMPLATE Grid', reason: 'x' }, { element: 'BUILDING_BLOCK Timeline', reason: 'x' }] });
const NO_LOGIN = { status: 1, stdout: '', stderr: 'auth: no credential for profile "default". Run: mxcli auth login\nhint: run \'mxcli auth login\'\n' };
const NO_VERSION = { status: 1, stdout: '', stderr: 'version "6.0.0" not found; run \'mxcli marketplace versions <id>\' to list available versions\n' };
const ADMIN = { name: 'Administration', id: '23513', version: '4.3.2' };
const BASE = { modules: { Administration: { version: '4.3.2', modified: ['PAGE Account_Overview'] } } };

test('the module list comes from the module units: Marketplace ones with content id and version; own modules, a nested Name and other units ignored', () => {
  const d = fakeApp();
  assert.deepEqual(marketplaceModules(d), [
    { name: 'Administration', id: '23513', version: '4.3.2' },
    { name: 'FromFile', id: '', version: '' },
    { name: 'WorkflowCommons', id: '117066', version: '3.12.0' },
  ]);
  assert.equal(bsonTop(moduleUnit('X')).Name, 'X', 'the top-level Name, not the nested one');
  assert.equal(marketplaceModules(tmp()), null, 'no mprcontents/ (MPR v1): null, the caller asks list modules');
});

test('positive: an added document is always a warning; a changed one is a warning once the baseline knows the module version', () => {
  const r = classify(ADMIN, EDITED, BASE);
  assert.equal(r.status, 'warning');
  assert.deepEqual(r.added, ['MICROFLOW ACT_MyAppThing', 'SNIPPET SNIPPET_AppBanner']);
  assert.deepEqual(r.changed, ['ENTITY Account', 'SNIPPET ReadMe'], 'Account_Overview was already in the baseline');
  const text = report({ modules: [r], warnings: 4, notChecked: 0, baseline: true });
  assert.match(text, /warning {2}Administration 4\.3\.2: added SNIPPET SNIPPET_AppBanner -- the next Marketplace update deletes it; move it to the app's own module/);
  assert.match(text, /warning {2}Administration 4\.3\.2: changed SNIPPET ReadMe -- the next update undoes it; make the change in AdministrationExt/);
  assert.doesNotMatch(text, /Account_Overview/);
  const noBase = classify(ADMIN, EDITED, null);
  assert.deepEqual([noBase.added.length, noBase.changed.length], [2, 0], 'without a baseline additions still warn');
});

test('negative: a module as the package shipped it is ok, with no warning', () => {
  const r = classify({ name: 'DataWidgets', id: '116540', version: '3.5.0' }, CLEAN, null);
  assert.equal(r.status, 'ok');
  assert.match(report({ modules: [r], warnings: 0, notChecked: 0, baseline: false }), /^ok {7}DataWidgets 3\.5\.0$/m);
});

test('false-positive guard: what a fresh app already differs in is a note without a fix, never a warning', () => {
  const r = classify(ADMIN, PRISTINE, null);
  assert.equal(r.status, 'ok');
  assert.deepEqual([r.changed, r.differs], [[], ['PAGE Account_Overview']]);
  const text = report({ modules: [r], warnings: 0, notChecked: 0, baseline: false });
  assert.match(text, /^note {5}Administration 4\.3\.2: differs from the package: PAGE Account_Overview \(no baseline/m);
  assert.doesNotMatch(text, /^warning|restore|move it/m);
  assert.equal(classify(ADMIN, PRISTINE, BASE).status, 'ok', 'in the baseline: nothing to say');
  const other = classify(ADMIN, PRISTINE, { modules: { Administration: { version: '4.2.0', modified: [] } } });
  assert.deepEqual([other.changed, other.differs], [[], ['PAGE Account_Overview']], 'a baseline of another version is no baseline');
  const unk = classify({ name: 'Atlas_Web_Content', id: '117183', version: '4.1.0' }, UNKNOWN, null);
  assert.equal(unk.status, 'ok');
  assert.match(report({ modules: [unk], warnings: 0, notChecked: 0, baseline: false }), /not compared \(mxcli cannot describe them\): 1 BUILDING_BLOCK, 2 PAGE_TEMPLATE/);
});

test('not checked is never clean: no login, a version no longer listed, no content id, mxcli missing', () => {
  for (const [run, why] of [[NO_LOGIN, /mxcli auth login/], [NO_VERSION, /version "6\.0\.0" not found/], [{ status: -1, stdout: '', stderr: 'spawnSync mxcli ENOENT' }, /ENOENT/],
    [{ status: 0, stdout: 'not json', stderr: '' }, /not json/]]) {
    const r = classify(ADMIN, run, BASE);
    assert.equal(r.status, 'not checked');
    assert.match(r.reason, why);
    assert.doesNotMatch(report({ modules: [r], warnings: 0, notChecked: 1, baseline: true }), /^ok/m);
  }
  assert.match(classify({ name: 'FromFile', id: '', version: '' }, null, null).reason, /no Marketplace content id/);
});

test('check(): one diff per Marketplace module with its content id and --module, the baseline beside the .mpr; --baseline keeps additions out', () => {
  const d = fakeApp();
  assert.equal(BASELINE, '.mxcodr/marketplace-baseline.json', 'in the app\'s .mxcodr/ folder (owner decision 2026-11-17)');
  fs.mkdirSync(path.join(d, '.mxcodr'));
  fs.writeFileSync(path.join(d, BASELINE), JSON.stringify(BASE));
  const calls = [];
  const run = args => { calls.push(args); return args[2] === '23513' ? EDITED : ok({ module: 'WorkflowCommons', installedVersion: '3.12.0', verified: true, unchangedCount: 40 }); };
  const mpr = path.join(d, 'App.mpr');
  const res = check({ mpr, run });
  assert.deepEqual(calls, [['marketplace', 'diff', '23513', '--module', 'Administration', '-p', mpr, '--json'], ['marketplace', 'diff', '117066', '--module', 'WorkflowCommons', '-p', mpr, '--json']]);
  assert.deepEqual([res.warnings, res.notChecked, res.baseline], [4, 1, true]);
  assert.match(report(res), /marketplace check: 3 Marketplace module\(s\), 4 warning\(s\), 1 not checked$/);
  assert.equal(check({ mpr, run, only: 'WorkflowCommons' }).modules.length, 1);
  const b = baselineFrom(res, BASE, new Date('2026-11-17T00:00:00Z'));
  assert.deepEqual(b.modules.Administration, BASE.modules.Administration, 'an existing entry is never widened: a later --baseline cannot clear its own changes');
  assert.deepEqual(b.modules.WorkflowCommons, { version: '3.12.0', modified: [] });
  assert.ok(!('FromFile' in b.modules), 'a module not checked gets no entry');
  const bare = path.join(fakeApp(), 'App.mpr');
  const first = baselineFrom(check({ mpr: bare, run: () => EDITED, only: 'Administration' }), null);
  assert.ok(first, 'no baseline yet: recorded');
  assert.deepEqual(first.modules.Administration.modified, ['ENTITY Account', 'PAGE Account_Overview', 'SNIPPET ReadMe']);
  assert.ok(!JSON.stringify(first).includes('ACT_MyAppThing'), 'an addition is never baselined');
  assert.equal(baselineFrom(check({ mpr: bare, run: () => NO_LOGIN }), null), null, 'nothing checked (no login): no baseline file at all');
  assert.equal(baselineFrom(check({ mpr, run, only: 'Administration' }), BASE), null, 'nothing new to record');
  const old = fakeApp();
  fs.writeFileSync(path.join(old, 'marketplace-baseline.json'), JSON.stringify(BASE));
  assert.deepEqual(readBaseline(old), BASE, 'bundle .17.2/.3 kept it beside the .mpr: still read');
  fs.mkdirSync(path.join(old, '.mxcodr'));
  fs.writeFileSync(path.join(old, BASELINE), JSON.stringify({ modules: {} }));
  assert.deepEqual(readBaseline(old), { modules: {} }, '.mxcodr/ wins');
});

test('the script is installed with module-structure for every agent, file and live mode', () => {
  for (const live of [false, true]) {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'App.mpr'), 'mpr');
    copySkills(d, AGENTS, undefined, { live });
    for (const dir of new Set(Object.values(SKILLS_DIR))) {
      assert.ok(fs.existsSync(path.join(d, dir, 'module-structure', 'marketplace-check.mjs')), `${dir} live=${live}`);
      assert.match(fs.readFileSync(path.join(d, dir, 'module-structure', 'SKILL.md'), 'utf8'), /node <this skill's folder>\/marketplace-check\.mjs -p app\.mpr/);
    }
  }
});

test('the texts: the rule (every shape, still 38 lines), live.md, module-structure and its reference, reuse-and-snippets', () => {
  const SENTENCE = 'Never add a document to a Marketplace module (`list modules`: Source `Marketplace v...`) or change one in it';
  assert.equal(readTemplate('mxcodr.md').split('\n').length - 1, 38);
  for (const dir of new Set(Object.values(SKILLS_DIR)))
    for (const opts of [{}, { coverage: true }, { live: true }, { live: true, skillsOff: ['module-structure'] }]) {
      const t = ruleText(dir, undefined, opts);
      assert.ok(t.includes(SENTENCE), `${dir} ${JSON.stringify(opts)}`);
      assert.deepEqual(checkRule(t), []);
    }
  assert.match(readTemplate('live.md'), /Never add a document to an installed Marketplace module or\s+change one in it/);
  const ms = skill('module-structure/SKILL.md');
  assert.match(ms, /^description: .*Nothing is added to or changed in a Marketplace module/m);
  assert.match(ms, /\*\*Never create a document in one\.\*\*/);
  assert.match(ms, /\*\*Use what the module offers for this\*\*/);
  assert.match(ms, /copy it into a module of your own named `<Module>Ext`/);
  assert.match(ms, /- \[ \] No document in a Marketplace module was added or changed/);
  const ref = skill('module-structure/reference/marketplace-ext.md');
  assert.match(ref, /\*\*Never add a document to a Marketplace module, and never edit one inside it\.\*\*/);
  assert.match(ref, /\*\*Already added a document to the module\?\*\*/);
  assert.match(ref, /never write or edit it yourself/);
  assert.doesNotMatch(ref + ms, /--baseline/, "the baseline is the installer's or the extension's, never the agent's");
  assert.match(skill('reuse-and-snippets/SKILL.md'), /Never in a Marketplace module, even when it shows\nthat module's data/);
});

// bundle 2026.11.20.1: the situational Marketplace, CE and Data grid steps moved out of the always-loaded live rule into
// what the commands print (translator: ide-problems.mjs, live-exec.mjs, marketplace-update.mjs, translations.mjs; their
// tests pin those lines). The rule keeps one pointer per topic: what the agent needs before it runs the command.
test('live mode: a build failing in a Marketplace module\'s Java -> update it, never edit it; marketplace outdated (bundle 2026.11.17.7, short since 2026.11.20.1)', () => {
  const live = readTemplate('live.md');
  const run = live.slice(live.indexOf('## Running the app and testing it'));
  assert.match(run, /A failed build lists its Java errors by module\. When\n {2}they are in a Marketplace module's Java \(`Java in Marketplace module \.\.\.`\), update that module with the\n {2}`marketplace update` command the reason names \(`--plan-only` first, then ask the person\); never edit a\n {2}Marketplace module's Java, the update overwrites it\./);
  assert.match(run, /Errors in the app's own modules: fix them in their Java\./);
  assert.match(live, /After the\n {2}app's Mendix version changed, or after a failed build, `\.\/mxcodr-live marketplace outdated`\./);
  assert.match(live, /Each prints its next\n {2}steps and the person's steps: follow them, and pass the person's on word for word\./);
  // file mode never reads live.md: its rule file says nothing of ./mxcodr-live
  assert.doesNotMatch(readTemplate('mxcodr.md'), /marketplace outdated/);
});

test('live mode: CE codes, the legacy Data grid and the review steps are in the commands\' output, the rule only points there (bundle 2026.11.20.1)', () => {
  const live = readTemplate('live.md');
  const problems = live.slice(live.indexOf('- After every exec that lands'), live.indexOf('\n- ', live.indexOf('- After every exec that lands') + 3));
  assert.match(problems, /Under the list it prints a fix line for the codes that need\n {2}one \(CE0463, CE6087, CE4899, CE7247, \.\.\.\): run what it names\. Never `\.\/mxcli fix \.\.\.` while Studio Pro has the app\n {2}open\. A PERSON ACTION line, from any command: ask the person, in its words\./);
  for (const gone of [/Datagrid\.mpk/, /'Can hide'/, /Forms\$DataGrid/, /bson dump/, /Reviewing those files/, /MOVE GUARD/, /`Mode: TWO-WAY`/, /undo-moves/, /Update all renamed design properties/])
    assert.doesNotMatch(live, gone);
  assert.doesNotMatch(readTemplate('mxcodr.md'), /CE7247|bson dump|Forms\$DataGrid/);
});

test('live mode: an update runs in the background until its notification, never twice at once (bundle 2026.11.17.10)', () => {
  const live = readTemplate('live.md');
  assert.match(live, /An update \(`--plan-only` too\)\n {2}takes minutes: run it as a background command \(Claude Code: the Bash tool's `run_in_background`\) and wait for its\n {2}completion notification: no polling, no second update, and no other `query`, `check`, `exec` or `mxcheck` until\n {2}then\./);
});

test('live mode: a newer version through ./mxcodr-live marketplace update (bundle 2026.11.17.5); file mode keeps its texts', () => {
  const live = readTemplate('live.md');
  assert.match(live, /`\.\/mxcodr-live marketplace update <id\|name>\n {2}--plan-only` first: tell the person what the plan prints and ask; the real run only after their yes\./);
  assert.doesNotMatch(live, /an update is the person's/);
  for (const live of [false, true]) {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'App.mpr'), 'mpr');
    copySkills(d, ['claude'], undefined, { live });
    const ref = fs.readFileSync(path.join(d, SKILLS_DIR.claude, 'module-structure', 'reference', 'marketplace-ext.md'), 'utf8');
    const files = fs.readFileSync(path.join(d, SKILLS_DIR.claude, 'files-and-images', 'SKILL.md'), 'utf8');
    if (live) {
      assert.match(ref, /A newer version goes in with `\.\/mxcodr-live marketplace update <id\|name>` \(`--plan-only` first, then ask the\nperson\)/);
      assert.doesNotMatch(ref + files, /mxcodr-live\.md/, 'the steps are in the command\'s output, not the rule (2026.11.20.1)');
      assert.match(ref, /`Mode: TWO-WAY`: nothing\nis run again/);
      assert.match(files, /a newer version goes in with `\.\/mxcodr-live marketplace update`/);
      assert.doesNotMatch(files, /An installed module is never updated/);
    } else {
      assert.equal(ref, skill('module-structure/reference/marketplace-ext.md'), 'file mode: the reference as written');
      assert.doesNotMatch(ref + files, /mxcodr-live/);
    }
  }
});

// bundle 2026.11.17.15: ./mxcodr-live translate writes the default-language texts CE4899 needs into Marketplace modules
// (the text must be in the module's own documents). marketplace diff then reads those documents as changed (DESCRIBE
// prints the default language's text: measured on WorkflowCommons.TaskDashboard after a de_CH fill). The map below is
// the translator's own format (src/translations.mjs updateMaps), the contract between the two.
const MAP = { format: 1, module: 'Administration', lang: 'de_CH', marketplace: true, updatedAt: '2026-11-17T23:00:00.000Z',
  note: 'Written by ./mxcodr-live translate', entries: [{ src: 'Accounts', from: 'en_US', ctx: 'page title', to: 'Konten' }],
  elements: ['PAGE Account_Overview', 'SNIPPET ReadMe'] };

test('translated texts: a document ./mxcodr-live translate wrote into is a note, never a warning; another changed document still warns; a broken map is no exception', () => {
  const d = fakeApp();
  fs.mkdirSync(path.join(d, TRANSLATIONS), { recursive: true });
  assert.equal(TRANSLATIONS, '.mxcodr/translations');
  fs.writeFileSync(path.join(d, TRANSLATIONS, 'Administration.de_CH.json'), JSON.stringify(MAP));
  fs.writeFileSync(path.join(d, TRANSLATIONS, 'broken.de_CH.json'), '{ not json');
  fs.writeFileSync(path.join(d, BASELINE.replace('marketplace-baseline.json', '') + 'marketplace-baseline.json'), JSON.stringify({ modules: { Administration: { version: '4.3.2', modified: [] } } }));
  assert.deepEqual(Object.fromEntries(Object.entries(readTranslated(d)).map(([k, v]) => [k, [...v].sort()])), { Administration: ['PAGE Account_Overview', 'SNIPPET ReadMe'] });
  const res = check({ mpr: path.join(d, 'App.mpr'), run: args => (args[2] === '23513' ? EDITED : CLEAN), only: 'Administration' });
  const r = res.modules[0];
  assert.deepEqual(r.translated, ['PAGE Account_Overview', 'SNIPPET ReadMe']);
  assert.deepEqual(r.changed, ['ENTITY Account'], 'a changed document the map does not name still warns');
  assert.equal(res.warnings, 3, 'the two additions and the entity; the translated ones are no warning');
  const text = report(res);
  assert.match(text, /note {5}Administration 4\.3\.2: texts translated by \.\/mxcodr-live translate \(allowed; another edit in these documents is not told apart here: \.\/mxcodr-live marketplace update --plan-only compares without the translations\): PAGE Account_Overview, SNIPPET ReadMe/);
  // without a baseline: a translated document is not among the "differs" notes either
  const nb = classify(ADMIN, EDITED, null, new Set(MAP.elements));
  assert.deepEqual([nb.differs, nb.translated], [['ENTITY Account'], ['PAGE Account_Overview', 'SNIPPET ReadMe']]);
  // a module as shipped with only translated documents: no warning, no "ok" line either (it says what was written)
  const only = classify(ADMIN, ok({ module: 'Administration', installedVersion: '4.3.2', locallyModified: true, verified: true, modified: ['PAGE Account_Overview'] }), { modules: { Administration: { version: '4.3.2', modified: [] } } }, new Set(MAP.elements));
  assert.equal(only.status, 'ok');
  assert.doesNotMatch(report({ modules: [only], warnings: 0, notChecked: 0, baseline: true }), /^ok /m);
  assert.deepEqual(classify(ADMIN, EDITED, null).translated, [], 'no map: nothing is an exception');
});

test('live mode: CE4899 -> ./mxcodr-live translate (the agent translates), the one exception in Marketplace modules (bundle 2026.11.17.15, short since 2026.11.20.1)', () => {
  const live = readTemplate('live.md');
  assert.match(live, /- Texts in another language \(CE4899, CW0263, or the person asks for the app in another language\): you translate,\n {2}Studio Pro's Batch translate only copies\. Run `\.\/mxcodr-live translate status` and follow its `next:` lines\.\n {2}Never write translations with `exec`, `create translations` or `\.\/mxcli` while Studio Pro has the app open\./);
  assert.match(live, /an update deletes the one and\n {2}undoes the other \(the one exception: texts written by `\.\/mxcodr-live translate`\)\./);
  assert.ok(live.indexOf('- Texts in another language') > live.indexOf('- After every exec that lands') && live.indexOf('- Texts in another language') < live.indexOf("This replaces what `CLAUDE.md` says about `mx`"));
  assert.doesNotMatch(readTemplate('mxcodr.md'), /mxcodr-live translate/);
});
