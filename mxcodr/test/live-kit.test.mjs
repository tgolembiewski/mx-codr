// Live mode (the Studio Pro extension, lib/live.mjs): the test kit, the film recorder and the Tests tab's wiring of a
// Playwright config, with the live edits; file mode stays as it was. The rule texts and skills: live.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeRules, copySkills, copyTestKit, copyFilm } from '../overlay/install.mjs';
import { tmp, walk, FILE_MODE } from './live-fixture.mjs';

test('live test kit and film: every edit applies, no file-mode run left, file mode unchanged', async () => {
  const { copyTestKit, copyFilm } = await import('../overlay/install.mjs');
  const { KIT_EDITS, FILM_EDITS } = await import('../overlay/lib/live.mjs');
  const live = tmp(), plain = tmp();
  const r = copyTestKit(live, [], undefined, { live: true });
  copyFilm(live, undefined, { live: true });
  copyTestKit(plain); copyFilm(plain);
  assert.equal(r.written.length, 5);
  for (const [name, edits] of Object.entries(KIT_EDITS)) {
    const t = fs.readFileSync(path.join(live, 'tests', name), 'utf8');
    for (const [from, to] of edits) { assert.ok(!t.includes(from) || to.includes(from), `${name} still has ${from.slice(0, 50)}`); assert.ok(t.includes(to), `${name} lacks ${to.slice(0, 50)}`); }
  }
  const film = fs.readFileSync(path.join(live, 'tests', 'film.mjs'), 'utf8');
  for (const [from, to] of FILM_EDITS) { assert.ok(!film.includes(from)); assert.ok(film.includes(to)); }
  for (const f of ['mx-impl.ts', 'mx.ts', 'playwright.config.ts', 'film.mjs']) for (const re of FILE_MODE) assert.doesNotMatch(fs.readFileSync(path.join(live, 'tests', f), 'utf8'), re, `${f} ${re}`);
  const cfg = fs.readFileSync(path.join(live, 'tests', 'playwright.config.ts'), 'utf8');
  assert.match(cfg, /'json', \{ outputFile: path\.join\(MXCODR, 'tests', 'report\.json'\) \}/);
  assert.match(cfg, /screenshot: 'only-on-failure'/);
  // a second live install sees its own edited kit as the kit's (recorded as ours, nothing rewritten)
  const again = copyTestKit(live, [], undefined, { live: true });
  assert.deepEqual(again.written, []);
  assert.equal(again.ours.length, 5);
  // file mode: the template bytes, untouched
  for (const f of ['mx-impl.ts', 'mx.ts', 'mx.teardown.ts', 'playwright.config.ts', 'package.json'])
    assert.equal(fs.readFileSync(path.join(plain, 'tests', f), 'utf8'), fs.readFileSync(new URL(`../overlay/templates/tests/${f}`, import.meta.url), 'utf8'));
  assert.equal(fs.readFileSync(path.join(plain, 'tests', 'film.mjs'), 'utf8'), fs.readFileSync(new URL('../overlay/templates/film.mjs', import.meta.url), 'utf8'));
});

test("a kept Playwright config gets the Tests tab's reporters (wireTestsTab): the plain kit becomes the live kit, the person's edits stay", async () => {
  const { wireTestsTab, liveKitText } = await import('../overlay/lib/live.mjs');
  const plain = fs.readFileSync(new URL('../overlay/templates/tests/playwright.config.ts', import.meta.url), 'utf8');
  // the plain kit (an app set up before the live kit edits, a test app, 2026-11-06): exactly the live kit
  const a = wireTestsTab(plain);
  assert.equal(a.changed, true);
  assert.equal(a.text, liveKitText('playwright.config.ts', plain));
  // the live kit, and a second pass: unchanged
  assert.deepEqual(wireTestsTab(a.text), { text: a.text, changed: false });
  // the kit with the person's own changes elsewhere: they stay, the reporters come in
  const own = plain.replace('workers: 1', 'workers: 2').replace('timeout: 90_000', 'timeout: 120_000');
  const b = wireTestsTab(own);
  assert.equal(b.changed, true);
  assert.match(b.text, /workers: 2,/);
  assert.match(b.text, /timeout: 120_000,/);
  assert.match(b.text, /\['json', \{ outputFile: path\.join\(MXCODR, 'tests', 'report\.json'\) \}\]/);
  // the person's own actionTimeout (the kit's 20_000 before bundle 2026.11.20.6): kept, the screenshot lines still come in
  const slow = own.replace('actionTimeout: 10_000,', 'actionTimeout: 20_000,');
  const s = wireTestsTab(slow);
  assert.equal(s.changed, true);
  assert.match(s.text, /actionTimeout: 20_000,\n    \/\/ what the Tests tab shows for a failed test[^\n]*\n    screenshot: 'only-on-failure',\n/);
  assert.doesNotMatch(s.text, /actionTimeout: 10_000/);
  assert.equal(s.text, b.text.replace('actionTimeout: 10_000,', 'actionTimeout: 20_000,'), 'the same wiring as with the kit\'s own value');
  // their own one-line reporter list: kept, ours appended; imports after their last import
  const theirs = own.replace("reporter: [['list']],", "reporter: [['list'], ['html', { open: 'never' }]],").replace("import { BASE } from './mx';", "import { BASE } from './mx';\nimport { OTHER } from './other';");
  const c = wireTestsTab(theirs);
  assert.equal(c.changed, true);
  assert.match(c.text, /reporter: \[\['list'\], \['html', \{ open: 'never' \}\], \['json', \{ outputFile: path\.join\(MXCODR, 'tests', 'report\.json'\) \}\], \.\.\.\(fs\.existsSync\(PROGRESS\)/);
  assert.match(c.text, /import \{ OTHER \} from '\.\/other';\nimport \* as fs from 'node:fs';\nimport \* as path from 'node:path';\n/);
  assert.equal(c.text.replace(/\nimport \* as fs[\s\S]*?catch \{ return ''; \} \}\)\(\);\n/, '\n').replace(/, \['json'.*\] : \[\]\)\]/, ']').replace(/\n    \/\/ a trace of every test.*\n    trace: .*/, ''), theirs, 'nothing else changed');
  assert.equal(wireTestsTab(c.text).changed, false);
  // one reporter by name
  assert.match(wireTestsTab(theirs.replace(/reporter: .*\n/, "reporter: 'line',\n")).text, /reporter: \[\['line'\], \['json'/);
  // what it cannot edit safely: unchanged, with the reason
  const multi = theirs.replace(/reporter: .*\n/, "reporter: [\n    ['list'],\n  ],\n");
  const d = wireTestsTab(multi);
  assert.equal(d.changed, false); assert.equal(d.text, multi); assert.match(d.reason, /not a one-line list/);
  const fsOwn = "import * as fs from 'node:fs';\n" + plain;
  assert.match(wireTestsTab(fsOwn).reason, /own fs, path/);
  assert.equal(wireTestsTab(fsOwn).text, fsOwn);
});

// Since live.60 the extension's tools are in its runtime in the person's user folder, and setup deletes <app>/.mxcodr/live:
// a config that looked for the progress reporter there silently left it out (11.12.1, 2026-11-10). The live kit reads the
// reporter's path from the record setup writes (.mxcodr/live-tool.json); a config wired with the old path is moved over.
test("the live kit's progress reporter comes from .mxcodr/live-tool.json; a config wired with the old .mxcodr/live path gets the new line", async () => {
  const { wireTestsTab, liveKitText } = await import('../overlay/lib/live.mjs');
  const plain = fs.readFileSync(new URL('../overlay/templates/tests/playwright.config.ts', import.meta.url), 'utf8');
  const live = liveKitText('playwright.config.ts', plain);
  assert.ok(!live.includes("'live', 'translator'"), 'no path into the app\'s old .mxcodr/live');
  const line = live.split('\n').find(l => l.startsWith('const PROGRESS = '));
  assert.ok(line, live);
  const progressOf = mxcodr => new Function('fs', 'path', 'MXCODR', `${line}\nreturn PROGRESS;`)(fs, path, mxcodr);
  const app = tmp();
  const mxcodr = path.join(app, '.mxcodr');
  assert.equal(progressOf(mxcodr), '', 'no record (no extension): no reporter');
  fs.mkdirSync(mxcodr);
  const reporter = path.join(app, 'rt', 'live', 'translator', 'src', 'pw-progress.cjs');
  fs.writeFileSync(path.join(mxcodr, 'live-tool.json'), JSON.stringify({ progress: reporter }));
  assert.equal(progressOf(mxcodr), reporter);
  fs.writeFileSync(path.join(mxcodr, 'live-tool.json'), '{bad');
  assert.equal(progressOf(mxcodr), '', 'an unreadable record: no reporter, the run goes on');
  // a config wired before (the old line, the person's edits around it): only that line changes, once
  const OLD = "// folder, ignored by git); without the extension the progress reporter is not there and is left out.\nconst MXCODR = path.join(__dirname, '..', '.mxcodr');\nconst PROGRESS = path.join(MXCODR, 'live', 'translator', 'src', 'pw-progress.cjs');";
  const NEW = live.slice(live.indexOf('// folder, ignored by git)'), live.indexOf(line) + line.length);
  const old = live.replace(NEW, OLD).replace('workers: 1', 'workers: 3');
  assert.ok(old.includes(OLD), 'the old block as live setup wrote it before bundle 2026.11.10.3');
  const r = wireTestsTab(old);
  assert.equal(r.changed, true);
  assert.deepEqual(r.what, ['progress']);
  assert.equal(r.text, live.replace('workers: 1', 'workers: 3'));
  assert.deepEqual(wireTestsTab(r.text), { text: r.text, changed: false });
  // the old line under a comment the person changed: the line still moves over, the comment stays theirs
  const own = old.replace('is left out.', 'is left out (ours).');
  assert.equal(wireTestsTab(own).text, own.split(OLD.split('\n')[2]).join(line));
});

test('the live kit traces every test (the map of tests affected); wireTestsTab adds the trace to a config wired before it, and keeps a config\'s own trace', async () => {
  const { wireTestsTab, liveKitText } = await import('../overlay/lib/live.mjs');
  const plain = fs.readFileSync(new URL('../overlay/templates/tests/playwright.config.ts', import.meta.url), 'utf8');
  const kit = liveKitText('playwright.config.ts', plain);
  const TRACE = /\n    \/\/ a trace of every test: what each test opens and calls, for \.\/mxcodr-live tests affected\n    trace: \{ mode: 'on', screenshots: false, snapshots: true, sources: false \},/;
  assert.match(kit, TRACE);
  // an app wired by live.9 (the reporters, no trace): the trace goes into its use block, nothing else changes
  const live9 = kit.replace(TRACE, '');
  const a = wireTestsTab(live9);
  assert.equal(a.changed, true);
  assert.deepEqual(a.what, ['trace']);
  assert.match(a.text, /  use: \{\n    \/\/ a trace of every test: what each test opens and calls, for \.\/mxcodr-live tests affected\n    trace: \{ mode: 'on'/);
  assert.equal(a.text.replace(/\n    \/\/ a trace of every test.*\n    trace: .*/, ''), live9);
  assert.deepEqual(wireTestsTab(a.text), { text: a.text, changed: false });
  // their own trace: kept, with the reason; one that records the network already: kept, nothing to say
  const own = live9.replace('    headless: true,', "    headless: true,\n    trace: 'retain-on-failure',");
  assert.deepEqual(wireTestsTab(own), { text: own, changed: false, traceNote: 'it sets its own trace' });
  const on = live9.replace('    headless: true,', "    trace: 'on',\n    headless: true,");
  assert.deepEqual(wireTestsTab(on), { text: on, changed: false });
});

// Studio Pro brings node but no npm (the person installs nothing besides the extension; Windows has no npx): nothing
// live mode installs may tell the agent to run `npx playwright` or `npm install`. Tests run through ./mxcodr-live
// tests run <file:line | --grep> / tests affected; Playwright comes from the extension's setup. File mode keeps them.
for (const coverage of [false, true]) {
  test(`live mode (coverage ${coverage}): no rule, skill, kit or film text says npx playwright or npm install; file mode still does`, () => {
    const texts = live => {
      const d = tmp();
      writeRules(d, ['claude'], { coverage, live });
      copySkills(d, ['claude'], undefined, { coverage, live });
      copyTestKit(d, [], undefined, { live });
      copyFilm(d, undefined, { live });
      return walk(d).filter(f => !f.endsWith('App.mpr')).map(f => [path.relative(d, f), fs.readFileSync(f, 'utf8')]);
    };
    const liveTexts = texts(true);
    assert.ok(liveTexts.some(([f]) => f.endsWith('mxcodr-live.md')), 'the live rule file is among them');
    for (const [f, t] of liveTexts) {
      assert.doesNotMatch(t, /npx playwright/, f);
      assert.doesNotMatch(t, /npm install/, f);
    }
    const fileTexts = texts(false).map(([, t]) => t).join('\n');
    assert.match(fileTexts, /npx playwright test --shuffle/);
    assert.match(fileTexts, /npm install/);
    // the live texts name the runner instead, with file:line or --grep only
    const all = liveTexts.map(([, t]) => t).join('\n');
    assert.match(all, /\.\/mxcodr-live tests run orders\.spec\.ts:42/);
  });
}
