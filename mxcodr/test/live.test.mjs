// Live mode (the Studio Pro extension, lib/live.mjs): the same texts with the live edits. File mode stays as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeRules, copySkills, copyTestKit, copyFilm } from '../overlay/install.mjs';
import { ruleText, checkRule, readTemplate, SKILLS_DIR } from '../overlay/lib/rules.mjs';
import { SKILL_EDITS, RULE_EDITS, LIVE_RULE_FILE } from '../overlay/lib/live.mjs';
import { skillsFor } from '../overlay/lib/skills.mjs';

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-live-')); fs.writeFileSync(path.join(d, 'App.mpr'), 'mpr'); return d; };
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; };
// file-mode commands that must not reach the live texts (a run of the app, or a write to the open .mpr)
const FILE_MODE = [/\.\/mxcli run (--local|stop|restart|wait)/, /\.\/mxcli exec/, /mxcli run --watch/, /\.\/mxcli marketplace install \d/, /mxcli fix widgets -p/, /\.\/mxcli auth status/, /\.\/mxcli oql -p/];
// `./mxcli auth login` stays in the live texts only as the person's step (mxcli's login for the version lookup)

for (const coverage of [false, true]) {
  test(`live rule file (coverage ${coverage}): every edit applied, format check passes, no file-mode run left`, () => {
    const t = ruleText(SKILLS_DIR.claude, readTemplate('mxcodr.md'), { coverage, live: true });
    assert.deepEqual(checkRule(t), []);
    assert.match(t, /`\.\/mxcodr-live app stop`/);
    assert.match(t, /`unknown` only when `\.\/mxcodr-live oql` cannot read Studio Pro's run/);
    for (const re of FILE_MODE) assert.doesNotMatch(t, re);
    // same line count as the file-mode text: the edits change words, not the shape
    assert.equal(t.split('\n').length, ruleText(SKILLS_DIR.claude, readTemplate('mxcodr.md'), { coverage }).split('\n').length);
  });

  test(`live skills (coverage ${coverage}): every edit applies and no file-mode command is left in them`, () => {
    const d = tmp();
    copySkills(d, ['claude'], undefined, { coverage, live: true });
    const root = path.join(d, '.claude/skills');
    for (const [rel, edits] of Object.entries(SKILL_EDITS)) {
      if (!skillsFor({ coverage }).includes(rel.split('/')[0])) continue;
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const [from, to] of edits) { assert.ok(!text.includes(from), `${rel} still has ${from.slice(0, 50)}`); assert.ok(text.includes(to), `${rel} lacks ${to.slice(0, 50)}`); }
    }
    for (const f of walk(root)) for (const re of FILE_MODE) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), re, `${path.relative(root, f)} ${re}`);
  });
}

test('live skills: the agent installs a Marketplace module itself and asks before MyFirstModule goes', () => {
  const d = tmp();
  copySkills(d, ['claude'], undefined, { live: true });
  const fi = fs.readFileSync(path.join(d, '.claude/skills/files-and-images/SKILL.md'), 'utf8');
  assert.match(fi, /`\.\/mxcodr-live marketplace install 235351`|\.\/mxcodr-live marketplace install 235351 /);
  assert.match(fi, /Install it yourself, now/);
  assert.doesNotMatch(fi, /ask the person to add\n?\s*\*\*File Uploader\*\* \(publisher Mendix\) from Studio Pro's Marketplace, wait until they say it is in, then\ngo on \(/, 'asking the person is the fallback only');
  for (const l of fi.split('\n').filter(l => /auth login/.test(l))) assert.match(l, /run `\.\/mxcli auth login` themselves/, l);
  const ms = fs.readFileSync(path.join(d, '.claude/skills/module-structure/SKILL.md'), 'utf8');
  assert.match(ms, /## MyFirstModule: ask the person before it goes/);
  assert.match(ms, /never drop or rename `MyFirstModule` without asking them, and never in the turn you ask/);
  assert.match(ms, /may I remove it\? Its home page will move to <Module>\.<Page>/);
  assert.match(ms, /never drop it\. Look at what it holds/);
  assert.match(ms, /Never\n\s*`rename module` through `\.\/mxcodr-live exec`/);
  assert.doesNotMatch(ms, /MyFirstModule goes once the app has its own module|`MyFirstModule` is gone,/);
  const plain = tmp();
  copySkills(plain, ['claude']);
  assert.match(fs.readFileSync(path.join(plain, '.claude/skills/module-structure/SKILL.md'), 'utf8'), /## MyFirstModule goes once the app has its own module/);
});

test('live writeRules: mxcodr.md (live edits) and mxcodr-live.md; file mode writes no live file', () => {
  const d = tmp();
  writeRules(d, ['claude'], { live: true });
  assert.match(fs.readFileSync(path.join(d, '.claude/rules/mxcodr.md'), 'utf8'), /mxcodr-live app stop/);
  const lr = fs.readFileSync(path.join(d, LIVE_RULE_FILE), 'utf8');
  assert.equal(lr, readTemplate('live.md'));
  assert.equal(lr[0], '#');
  assert.ok(!lr.split('\n').some(l => l.trim() === '---'));
  for (const must of ['./mxcodr-live marketplace install', 'publishers Mendix or Mendix Labs only', '`MyFirstModule` is the person', './mxcodr-live exec', './mxcodr-live app run', './mxcodr-live test', 'APP_URL', 'Never run `mxcli init`', 'Only the person commits', 'commit in Studio Pro: Version\nControl > Commit', 'Upload to Version Control Server', 'Run only read-only git', 'Every other git command is the person\'s']) assert.ok(lr.includes(must), must);
  assert.doesNotMatch(lr, /Close App and open the app again/, 'live.26: the reopen was only for our own git init');
  // live.36: the look is the person's (the Look tab); theme classes and variables, never hard-coded colours
  assert.match(lr, /## The app's look[\s\S]*\.\/mxcodr-live look[\s\S]*never hard-coded colours/);
  // 2026.11.15.3 (owner decision, warn only): Atlas first, own SCSS from theme variables; one sentence, the details in
  // spacing-and-layout's reference/own-styles.md, the list from ./mxcodr-live styles
  const look = lr.slice(lr.indexOf("## The app's look"), lr.indexOf('\n## ', lr.indexOf("## The app's look") + 3));
  assert.match(look, /Style with what Atlas gives\nfirst \(classes, design properties\); own SCSS only where that is not enough, with colours, corners, fonts, spacing\nand shadows from theme variables/);
  assert.match(look, /`spacing-and-layout`, `reference\/own-styles\.md`; `\.\/mxcodr-live styles` lists them\)\./);
  assert.equal((look.match(/Style with/g) || []).length, 1, 'one sentence about styling');
  assert.ok(look.split('\n').length <= 9, 'the section stays short');
  assert.ok(fs.existsSync(new URL('../overlay/skills/spacing-and-layout/reference/own-styles.md', import.meta.url)), 'the rule points at a file the skill ships');
  // live.33: a task list for 3+ steps (the pane's step bar); the plan-first rule is its own file, switched in the pane
  assert.match(lr, /## Task list[\s\S]*three or more steps[\s\S]*TaskCreate[\s\S]*TaskUpdate[\s\S]*After an approved plan/);
  const plan = fs.readFileSync(new URL('../overlay/templates/plan-first.md', import.meta.url), 'utf8');
  assert.match(plan, /EnterPlanMode[\s\S]*ExitPlanMode[\s\S]*Small changes \(a caption, one field,\sa bug fix\) go straight ahead/);
  const f = tmp();
  writeRules(f, ['claude']);
  assert.ok(!fs.existsSync(path.join(f, LIVE_RULE_FILE)));
  assert.match(fs.readFileSync(path.join(f, '.claude/rules/mxcodr.md'), 'utf8'), /`\.\/mxcli run stop`/);
});

test('a live edit whose text is gone fails loudly', async () => {
  const { liveRuleText } = await import('../overlay/lib/live.mjs');
  assert.throws(() => liveRuleText('# x\nno such sentences\n'), /no longer has the text live mode replaces|none of the done-sentence edits/);
  assert.ok(RULE_EDITS.length >= 3);
});

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

test('live durable-tests: the demo users\' password is set by the agent, never asked for', () => {
  const d = tmp();
  copySkills(d, ['claude'], undefined, { live: true });
  const t = fs.readFileSync(path.join(d, '.claude/skills/durable-tests/SKILL.md'), 'utf8');
  assert.match(t, /generate a random password/);
  assert.match(t, /Demo Users Enabled: true` and a security level\n  other than `Off`/);
  assert.match(t, /create or modify demo user/);
  assert.match(t, /Never ask the person for a password, never print it/);
  assert.match(t, /\.\/mxcodr-live app restart` \(demo\n  users are written when the app starts\)/);
});

test('live rule file overrides CLAUDE.md on mx: problems and mxcheck, never a hand-built mxbuild path', () => {
  const t = fs.readFileSync(new URL('../overlay/templates/live.md', import.meta.url), 'utf8');
  assert.match(t, /This replaces what `CLAUDE\.md` says about `mx`/);
  assert.match(t, /`\.\/mxcodr-live mxcheck`/);
  assert.match(t, /never call `mx` by a\n  path under `~\/\.mxcli\/mxbuild\/` or a glob/);
});

test('live.74 live rule file: what a turn changed comes from ./mxcodr-live changes, never git; Studio Pro\'s regenerated files are named', () => {
  const t = fs.readFileSync(new URL('../overlay/templates/live.md', import.meta.url), 'utf8');
  assert.match(t, /`\.\/mxcodr-live changes list`/);
  assert.match(t, /`\.\/mxcodr-live changes show --turn <id>`, never git \(the app may not be a repository\)/);
  assert.match(t, /`"by":\n  "studio-pro"` are actions Studio Pro regenerated when it built the app, not yours/);
});

test('live films: the rule file and the film-tests skill name ./mxcodr-live tests film and the Tests tab; file mode does not', () => {
  const t = fs.readFileSync(new URL('../overlay/templates/live.md', import.meta.url), 'utf8');
  assert.match(t, /`\.\/mxcodr-live tests film\n  <file>\[:line\]`/);
  assert.match(t, /\*\*Watch film\*\*/);
  assert.match(t, /A film never changes a test's result\./);
  const d = tmp();
  copySkills(d, ['claude'], undefined, { coverage: false, live: true });
  const live = fs.readFileSync(path.join(d, '.claude/skills/film-tests/SKILL.md'), 'utf8');
  assert.match(live, /`\.\/mxcodr-live tests film <file\.spec\.ts>\[:line\]` instead/);
  assert.match(live, /\*\*Watch film\*\* opens it in a Studio Pro tab/);
  assert.match(live, /fits the request\.\n\n   In the mx-codr pane[\s\S]*--all`\.\n4\. \*\*Give the path\*\*/);
  const f = tmp();
  copySkills(f, ['claude'], undefined, { coverage: false });
  assert.equal(fs.readFileSync(path.join(f, '.claude/skills/film-tests/SKILL.md'), 'utf8'), fs.readFileSync(new URL('../overlay/skills/film-tests/SKILL.md', import.meta.url), 'utf8'));
});

// The Rules tab (Studio Pro extension): skills switched off leave the rule texts; none switched off changes nothing.
test('skillsOff: the section naming the skills loses their lines, the format check passes, [] is byte for byte the same', async () => {
  const { ruleWithoutSkills, liveRuleWithoutSkills } = await import('../overlay/lib/skilloff.mjs');
  for (const live of [false, true]) for (const coverage of [false, true]) {
    const base = ruleText('.claude/skills', undefined, { live, coverage });
    assert.equal(ruleText('.claude/skills', undefined, { live, coverage, skillsOff: [] }), base);
    const t = ruleText('.claude/skills', undefined, { live, coverage, skillsOff: ['app-security', 'files-and-images', 'film-tests', 'not-ours'] });
    assert.deepEqual(checkRule(t), []);
    assert.doesNotMatch(t, /`app-security`|`files-and-images`/);
    assert.match(t, /\n- `naming-and-captions`: [^\n]*\n- `spacing-and-layout`: [^\n]*\n- `java-action-docs`: /, 'the lines around them stay, in order');
    assert.match(t, /^# Read the project skill before you build its part\n[\s\S]*`\.ai-context\/skills\/`/);
    const none = ruleText('.claude/skills', undefined, { live, coverage, skillsOff: ['durable-tests', 'app-security', 'spacing-and-layout', 'naming-and-captions', 'module-structure', 'files-and-images', 'java-action-docs', 'requirements-interview'] });
    assert.deepEqual(checkRule(none), []);
    assert.doesNotMatch(none, /# Read the project skill|skill gate/, 'no skill left: the section goes');
    assert.match(none, /^# Keep your checks as tests\n/);
    if (coverage) assert.doesNotMatch(none, /requirements-interview/);
  }
  const live = readTemplate('live.md');
  assert.equal(liveRuleWithoutSkills(live, []), live);
  const l = liveRuleWithoutSkills(live, ['film-tests', 'durable-tests']);
  assert.doesNotMatch(l, /A film of a test|film-tests|`durable-tests`/);
  assert.match(l, /set one yourself \(a random one in/);
  assert.match(l, /- Microflow tests: /, 'the next bullet stays');
});

test('skillsOff in writeRules and copySkills: the switched-off skill waits in .mxcodr/skills-off/ (live text), the rule files leave it out', () => {
  const d = tmp();
  writeRules(d, ['claude'], { live: true, skillsOff: ['film-tests'] });
  copySkills(d, ['claude'], undefined, { live: true, skillsOff: ['film-tests'] });
  assert.ok(!fs.existsSync(path.join(d, '.claude/skills/film-tests')));
  const parked = fs.readFileSync(path.join(d, '.mxcodr/skills-off/film-tests/SKILL.md'), 'utf8');
  assert.match(parked, /\.\/mxcodr-live tests film/, 'the live edits are applied to the parked copy');
  assert.ok(fs.existsSync(path.join(d, '.claude/skills/durable-tests/SKILL.md')));
  assert.doesNotMatch(fs.readFileSync(path.join(d, LIVE_RULE_FILE), 'utf8'), /A film of a test/);
  // switched on again (skillsOff []): back in the skills folder, the parked copy gone
  copySkills(d, ['claude'], undefined, { live: true });
  assert.ok(fs.existsSync(path.join(d, '.claude/skills/film-tests/SKILL.md')) && !fs.existsSync(path.join(d, '.mxcodr/skills-off')));
  // file mode never makes the folder
  const f = tmp();
  copySkills(f, ['claude'], undefined, {});
  assert.ok(!fs.existsSync(path.join(f, '.mxcodr/skills-off')));
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

// Hundreds of browser tests must not block the work (2026-11-06): live mode runs the affected tests, and the full
// suite is a proposal to the person, never started unasked. File mode keeps the whole suite.
for (const coverage of [false, true]) {
  test(`live rule file (coverage ${coverage}): tests affected instead of the whole suite; file mode keeps the whole suite`, () => {
    const t = ruleText(SKILLS_DIR.claude, readTemplate('mxcodr.md'), { coverage, live: true });
    assert.doesNotMatch(t, /whole suite|npx playwright test --shuffle/);
    assert.equal(t.match(/`\.\/mxcodr-live tests affected`/g).length, 2);
    assert.match(t, coverage ? /`\.\/mxcodr-live tests affected` is green \(the full suite only when asked\)/ : /then run `\.\/mxcodr-live tests affected` \(never the full suite\nunasked\) and shown it green/);
    const plain = ruleText(SKILLS_DIR.claude, readTemplate('mxcodr.md'), { coverage });
    assert.match(plain, /run the whole suite once and show it passing/);
    assert.match(plain, /npx playwright test --shuffle/);
    assert.doesNotMatch(plain, /tests affected/);
  });
}

test('live mxcodr-live.md: the full suite is a proposal with count, estimate and last run; whole-app changes get a strong recommendation', () => {
  const lr = readTemplate('live.md');
  assert.match(lr, /\*\*Run the affected tests, never the full suite unasked\.\*\*/);
  assert.match(lr, /run `\.\/mxcodr-live tests affected` instead/);
  assert.match(lr, /Its last line, `affected: N run, N passed, 0 failed \(M not selected\)`, is the\n  result to report; `tests status` shows the latest result of every test across runs, not this run/);
  assert.match(lr, /While you\n  work on a test, run only that test \(`\.\/mxcodr-live tests run <file>:<line>` or `--grep`\), never whole spec\n  files; once `tests affected` is green, run no broader Playwright run unless the person asks\. Never run\n  Playwright itself \(Studio Pro has no npm, so `npx` fails here\): always through `\.\/mxcodr-live tests`\./);
  assert.match(lr, /deploy a model saved since the last deploy first \(one `app run`; when it fails nothing\n  runs\), stop after 2 failures, and list each failed test with its error lines, screenshot and error context:\n  read those instead of running the test again to see the error/);
  assert.match(lr, /plus one smoke test per spec file \(`--thorough`: all\)/);
  assert.match(lr, /only when its own code \(or the file's shared code, or a helper it imports\) changed since\n  it last ran, committed or not/);
  assert.match(lr, /propose the full suite to the person with the line `tests affected` prints \(how many\n  tests, about how long, when it last ran whole\)/);
  for (const w of ['project or module security', 'user roles', 'access rules', 'navigation or menus', 'after-startup microflow', 'a layout', 'the theme']) assert.ok(lr.includes(w), w);
  assert.match(lr, /recommend\n  the full suite strongly in your summary; still their call/);
});

test('live durable-tests: the finishing run and the runs between files are tests affected; file mode keeps the shuffled whole suite', () => {
  const d = tmp(), f = tmp();
  copySkills(d, ['claude'], undefined, { live: true });
  copySkills(f, ['claude']);
  const t = fs.readFileSync(path.join(d, '.claude/skills/durable-tests/SKILL.md'), 'utf8');
  assert.doesNotMatch(t, /whole suite|--shuffle|whole green run/);
  assert.match(t, /2\. \*\*Run the affected tests\*\*: `\.\/mxcodr-live tests affected`/);
  assert.match(t, /propose the full suite with the line it prints; never start it unasked/);
  assert.match(t, /Show its last line, `affected: N run, N passed, 0 failed \(M not selected\)`/);
  // while working only the test worked on; nothing broader after a green tests affected; file mode keeps its text
  assert.doesNotMatch(t, /Run one spec file while you work on it/);
  assert.match(t, /While you work on a test, run only that test \(`\.\/mxcodr-live tests run orders\.spec\.ts:42`, or `--grep '<its title>'`\):\nit deploys a changed model first and lists each failure with its error and screenshot\. Never a whole spec file or\nseveral; once `\.\/mxcodr-live tests affected` is green, run nothing broader unless the person asks\./);
  assert.match(t, /spec file is green, run `\.\/mxcodr-live tests affected`, and again after every third file/);
  const p = fs.readFileSync(path.join(f, '.claude/skills/durable-tests/SKILL.md'), 'utf8');
  assert.match(p, /Run one spec file while you work on it \(`npx playwright test orders\.spec\.ts` in `tests\/`\)/);
  assert.match(p, /2\. \*\*Run the whole suite once, shuffled\*\*/);
  assert.doesNotMatch(p, /tests affected/);
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

test('1.75.11 live rule file: script files are written with the Write or Edit tool, never by shell redirection (that asks every time)', () => {
  const t = fs.readFileSync(new URL('../overlay/templates/live.md', import.meta.url), 'utf8');
  assert.match(t, /Create or change files \(`mdlsource\/\*\.mdl`, tests\) with the Write or Edit tool, never with shell redirection,\n  `printf`, `echo >` or heredocs: those ask the person every time\. Write creates the folder too \(no `mkdir`\)\./);
});

// bundle 2026.11.18.4: Codex, asked to "use Mendix Studio Pro 11.15.0 ... build a working app", created a new Mendix
// project instead of building in the app open in Studio Pro; nothing said the open app is the only target
test('live mxcodr-live.md: the app open in Studio Pro is the only app built in; no reach: stop and tell the person', () => {
  const d = tmp();
  writeRules(d, ['claude'], { live: true });
  const lr = fs.readFileSync(path.join(d, LIVE_RULE_FILE), 'utf8');
  assert.match(lr, /- The app open in Studio Pro is the only app you build in\. Never create another Mendix project or `\.mpr`\n  \(`mxcli new`, a copy of the app, a scratch project\), not even when the request names another Studio Pro version\n  or asks for "a new app": build in this app, and when the request names a different Studio Pro version than this\n  app's \(`\.\/mxcodr-live status` says it\), say so in your summary\./);
  assert.match(lr, /- When you cannot reach Studio Pro \(`\.\/mxcodr-live status` fails\), stop and tell the person what is wrong \(the\n  pane's checklist, its own instruction word for word\) instead of building elsewhere\./);
  assert.ok(lr.indexOf('only app you build in') < lr.indexOf('./mxcodr-live exec <script.mdl>'), 'near the top, before how to write a change');
});

// bundle 2026.11.18.8 (owner, 2026-11-19, Windows, Codex): the agent reported "74/100" from `mxcli report` while the
// pane's Quality tab showed 86/100. The live rule (Claude Code's file, and Codex's AGENTS.md live block, which setup
// copies from it) names the tab's number and overrides mxcli's own report texts by name.
test('live mxcodr-live.md: the app\'s quality score is ./mxcodr-live quality\'s first line (the Quality tab), never mxcli report\'s', () => {
  const d = tmp();
  writeRules(d, ['claude', 'codex'], { live: true });
  const lr = fs.readFileSync(path.join(d, LIVE_RULE_FILE), 'utf8');
  const at = lr.indexOf("- **The app's quality score is the Quality tab's.**");
  assert.ok(at > 0, 'the bullet is there');
  const b = lr.slice(at, lr.indexOf('\n- ', at + 3) > 0 ? lr.indexOf('\n- ', at + 3) : lr.indexOf('\n\n', at));
  assert.match(b, /run `\.\/mxcodr-live quality` after your last model change/);
  assert.match(b, /give its first line,\s+`Best practices N\/100 \(\.\.\.\)`/);
  assert.match(b, /the number the person sees in the pane's Quality tab/);
  assert.match(b, /Never give the score of `\.\/mxcli report`/);
  assert.match(b, /the `assess-quality` skill/);
  assert.match(b, /CLAUDE\.md's\s+"Best Practices Report"/);
  assert.match(b, /only labelled as mxcli's own score/);
  // Codex reads AGENTS.md only up to its project-doc size cap (32 KiB by default); CarFleetCodexSol's AGENTS.md is
  // 36,233 bytes, its live block from byte 12,891, cut inside the tests bullets: the bullet stays near the top
  assert.ok(at < lr.indexOf('- After every exec that lands'), 'early in the list, before problems and the tests bullets');
  assert.ok(at < 6000, `within the first 6,000 characters of the live rule (at ${at})`);
  assert.ok(!/\.\/mxcodr-live quality (intend|unintend|rule-off|rule-on)/.test(lr), 'marking findings stays the person\'s');
});

// bundle 2026.11.18.3 (CarFleetCodexSol, Codex): Plan first for the agents that read AGENTS.md, in their words; the
// extension writes it between its own markers, and an AGENTS.md with nothing else of the person's stays generated
test('plan-first-agents.md: the plan rule without Claude Code\'s tools; its AGENTS.md block counts as generated', async () => {
  const { isScaffoldLeftover, PLAN_START, PLAN_END, MXCLI_BEGIN, MXCLI_END } = await import('../overlay/install.mjs');
  const t = fs.readFileSync(new URL('../overlay/templates/plan-first-agents.md', import.meta.url), 'utf8');
  assert.match(t, /present the plan as your message[\s\S]*end your turn there\. Change nothing until the person approves it\./);
  assert.match(t, /Small changes \(a caption, one\sfield, a bug fix\) go straight ahead/);
  assert.match(t, /task\slist first \(Task list in mx-codr's live rules\)/);
  assert.doesNotMatch(t, /EnterPlanMode|ExitPlanMode|TaskCreate|TodoWrite/);
  // bundle 2026.11.18.5 (owner, Windows, Codex): the plan wrapped in two marker lines of its own, which the pane's
  // bridges turn into the plan card; nothing after the closing line, no approval asked in words
  const lines = t.split('\n');
  assert.ok(lines.includes('<!-- mxcodr:plan -->') && lines.includes('<!-- mxcodr:plan-end -->'), 'both marker lines, each on its own');
  assert.ok(lines.indexOf('<!-- mxcodr:plan -->') < lines.indexOf('<!-- mxcodr:plan-end -->'));
  assert.match(t, /Write nothing after the closing line/);
  assert.match(t, /Requirement and Decision lines/);
  assert.doesNotMatch(t, /mxcodr-plan:(start|end)/, 'never the AGENTS.md block markers inside the block');
  // the extension's source is not in the public repository: compare the markers only where it is
  const permsUrl = new URL('../../spikes/studio-pro-ext/translator/src/permissions.mjs', import.meta.url);
  if (fs.existsSync(permsUrl)) {
    const perms = fs.readFileSync(permsUrl, 'utf8');
    assert.ok(perms.includes(`PLAN_START = "${PLAN_START}", PLAN_END = "${PLAN_END}"`), 'the same markers as the extension writes');
    const cfg = fs.readFileSync(new URL('../../spikes/studio-pro-ext/translator/src/codex-config.mjs', import.meta.url), 'utf8');
    assert.ok(cfg.includes('PLAN_OPEN = "<!-- mxcodr:plan -->", PLAN_CLOSE = "<!-- mxcodr:plan-end -->"'), 'the same plan markers as the bridges read');
  }
  const f = path.join(tmp(), 'AGENTS.md');
  fs.writeFileSync(f, `${MXCLI_BEGIN} -->\nmxcli\n${MXCLI_END}\n\n${PLAN_START}\n${t.trim()}\n${PLAN_END}\n`);
  assert.equal(isScaffoldLeftover('AGENTS.md', f, null), true);
  fs.appendFileSync(f, '\nMine.\n');
  assert.equal(isScaffoldLeftover('AGENTS.md', f, null), false, 'text of the person\'s own still counts');
});

// 2026-11-19 (faster model reads, items 2 and 3): the model on disk (.mxcodr/model/, written by the extension's
// translator, src/model-dump.mjs) is where the agent greps and reads; query is for a fresh read before a change, the
// catalog and a dump that lags; several statements in one query; a long result is read from its file, never re-run.
// One bullet in the live rule, which setup copies into AGENTS.md's live block for Codex and Pi: early, and short.
// 2026-11-20 (A/B of the read changes: Claude Code's tokens did not fall, it read whole files): one `grep -rn`, then
// only the lines around the hits; a whole file only when all of it is needed.
test('live mxcodr-live.md: reading the model is a grep -rn of .mxcodr/model/ and the lines around the hits; query only for fresh reads and the catalog', () => {
  const d = tmp();
  writeRules(d, ['claude', 'codex'], { live: true });
  const lr = fs.readFileSync(path.join(d, LIVE_RULE_FILE), 'utf8');
  const at = lr.indexOf('- Reading the model:');
  assert.ok(at > 0, 'the bullet is there');
  const b = lr.slice(at, lr.indexOf('\n- ', at + 3));
  assert.match(b, /`\.mxcodr\/model\/` has one file per document \(`INDEX\.tsv` lists them\)/);
  assert.match(b, /Find what you need with one `grep -rn` \(several names in one pattern\), then read only the lines around the hits/);
  assert.match(b, /\(Read\s+with offset and limit, or `sed -n 40,90p` on several files in one command\); a whole file only when you need all of\s+it/);
  assert.match(b, /never grep `mprcontents\/`/);
  assert.match(b, /read a document fresh before you change it/);
  assert.match(b, /`search '<text>'`,\s+`show references to M\.Name`, `show context of M\.Name`/);
  assert.match(b, /`INDEX\.tsv`'s\s+state line or\s+`\.\/mxcodr-live model status` says it lags/);
  assert.match(b, /Several statements in one query, never a loop/);
  assert.match(b, /never re-run\s+one to page it: read the `\.mxcodr\/out\/` file it names/);
  assert.match(b, /Check a script first with `\.\/mxcodr-live check <script\.mdl>`/);
  assert.ok(b.split('\n').length <= 7, `short: ${b.split('\n').length} lines`);
  assert.ok(!/DESCRIBE ENTITY Module\.Entity"` \(or `SHOW \.\.\.`\)/.test(lr), 'the old one-line read advice is gone');
  // before the bullets Codex's AGENTS.md size cap can cut (the live block comes last there)
  assert.ok(at < lr.indexOf("- **The app's quality score is the Quality tab's.**") && at < 4000, `early (at ${at})`);
});
