// The installer's file placement, on a stub app (a folder with an .mpr and marker files): no mxcli needed.
// The mxcli steps (setup, --sync-skills, boot) are proven by the end-to-end probe, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fenceText, unfence, withMxcliSection, MXCLI_BEGIN, MXCLI_END, writeRules, copySkills, copyTestKit, TEST_KIT, PLAYWRIGHT, upgradeCleanup, migrateBin, stripOurs, ensureLocalMxcli, replaceShim, parseAgents } from '../overlay/install.mjs';
import { parseRule, bodyLines, checkRule, START, END } from '../overlay/lib/rules.mjs';
import { INSTALLED_SKILLS } from '../overlay/lib/skills.mjs';
import { readRequests, saveRequest, sha1 } from '../overlay/lib/requests.mjs';
import { writeAtomic, readJson } from '../overlay/lib/cache.mjs';
import { PIN } from '../overlay/lib/mx.mjs';

const tmp = (p = 'mxcodr-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const get = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => { try { fs.lstatSync(path.join(root, rel)); return true; } catch { return false; } };
const walk = (root, d = root, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(root, p, out) : out.push(path.relative(root, p)); } return out.sort(); };
const MXCLI_AGENTS_MD = '# AGENTS.md\n\n<!-- mxcli:begin -->\nmxcli section\n<!-- mxcli:end -->\n';

function stubApp() {
  const d = tmp('mxcodr-app-');
  put(d, 'App.mpr', 'mpr');
  put(d, '.claude/settings.json', '{"permissions":{"allow":["Bash(./mxcli:*)"]}}\n');
  put(d, '.claude/skills/create-page/SKILL.md', 'mxcli own skill');
  put(d, 'CLAUDE.md', '<!-- mxcli:begin -->\nmxcli\n<!-- mxcli:end -->\n');
  put(d, 'AGENTS.md', MXCLI_AGENTS_MD);
  return d;
}
const install = (d, agents) => { const before = new Set(walk(d)); writeRules(d, agents); copySkills(d, agents); return walk(d).filter(f => !before.has(f)); };
const skillFiles = dir => INSTALLED_SKILLS.flatMap(s => walk(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'overlay', 'skills', s)).map(f => `${dir}/${s}/${f}`));
const GATE = /\bgates?\b|mxgate|\.mxgate|tests\/(orient|peek|lib|gate|film)|scenario\(|# covers|rulebook|\bDONE\b/;

test('Claude Code: .claude/rules/mxcodr.md and the seven skills in .claude/skills/, nothing else; AGENTS.md untouched', () => {
  const d = stubApp();
  const written = install(d, ['claude']);
  assert.deepEqual(written, ['.claude/rules/mxcodr.md', ...skillFiles('.claude/skills')].sort());
  assert.equal(get(d, 'AGENTS.md'), MXCLI_AGENTS_MD);
  assert.ok(!exists(d, '.claude/skills/requirements-interview'), 'requirements-interview is not installed by default');
  assert.equal(get(d, '.claude/skills/create-page/SKILL.md'), 'mxcli own skill');
});

test('Cursor alone: .cursor/rules/mxcodr.mdc and .cursor/skills/, no AGENTS.md block (owner: no double read)', () => {
  const d = stubApp();
  const written = install(d, ['cursor']);
  assert.deepEqual(written, ['.cursor/rules/mxcodr.mdc', ...skillFiles('.cursor/skills')].sort());
  assert.equal(get(d, 'AGENTS.md'), MXCLI_AGENTS_MD);
});

test('Codex, opencode and Pi: one AGENTS.md block after mxcli\'s section, skills in .agents/skills and .opencode/skills', () => {
  const d = stubApp();
  const written = install(d, ['codex', 'opencode', 'pi']);
  assert.deepEqual(written, [...skillFiles('.agents/skills'), ...skillFiles('.opencode/skills')].sort());
  const md = get(d, 'AGENTS.md');
  assert.ok(md.startsWith(MXCLI_AGENTS_MD.trimEnd()), 'mxcli\'s section stays first and whole');
  assert.equal(md.split(START).length, 2);
  const block = md.slice(md.indexOf(START) + START.length, md.indexOf(END));
  assert.deepEqual(checkRule(block.trimStart()), []);
  assert.match(block, /`\.agents\/skills\/`: `durable-tests`/);
  install(d, ['codex', 'opencode', 'pi']);
  assert.equal(get(d, 'AGENTS.md'), md, 'a second install changes nothing');
  install(d, ['claude']);
  assert.equal(get(d, 'AGENTS.md'), MXCLI_AGENTS_MD, 'switching to Claude Code alone takes the block out again');
  assert.ok(!exists(d, '.agents/skills/durable-tests'));
});

test('the installed rule files parse: a non-empty body, no stray frontmatter (.md), only Cursor\'s own (.mdc)', () => {
  const d = stubApp();
  install(d, ['claude', 'cursor']);
  const md = parseRule(get(d, '.claude/rules/mxcodr.md'));
  assert.equal(md.frontmatter, null);
  assert.equal(get(d, '.claude/rules/mxcodr.md')[0], '#');
  assert.equal(bodyLines(md.body), 22);
  assert.doesNotMatch(md.body, /^---$/m);
  const mdc = parseRule(get(d, '.cursor/rules/mxcodr.mdc'));
  assert.deepEqual(mdc.frontmatter, ['description', 'alwaysApply']);
  assert.equal(bodyLines(mdc.body), 22);
  assert.doesNotMatch(mdc.body, /^---$/m);
  assert.match(mdc.body, /^# Keep your checks as tests\n/);
});

test('skills-clean on the installed copies: no gate vocabulary in any file an agent can open', () => {
  const d = stubApp();
  install(d, ['claude', 'cursor', 'codex', 'opencode']);
  for (const dir of ['.claude/skills', '.cursor/skills', '.agents/skills', '.opencode/skills'])
    for (const s of INSTALLED_SKILLS) for (const f of walk(path.join(d, dir, s)))
      get(path.join(d, dir, s), f).split('\n').forEach((l, i) => assert.doesNotMatch(l, GATE, `${dir}/${s}/${f}:${i + 1}`));
});

test('upgrade over a v2-gate install: ./mxgate, .mxgate/ and our entries go; the person\'s settings, tests and requests stay', () => {
  const d = stubApp();
  // what bundle 2026.10.31.8 left behind
  put(d, 'mxgate', '#!/usr/bin/env node\nimport(".mxgate/mxgate.mjs")\n');
  put(d, '.mxgate/installed.json', JSON.stringify({ bundle: '2026.10.31.8', mxcli: { path: path.join(d, '.mxgate/bin/mxcli'), version: PIN }, ports: { app: 8080 }, db: 'hsqldb', agents: ['claude'], requests: { '01.md': { sha1: 'x' } } }));
  put(d, '.mxgate/bin/mxcli', 'BINARY');
  put(d, '.mxgate/mxgate.mjs', 'gate'); put(d, '.mxgate/cards/RULE01.md', 'card'); put(d, '.mxgate/cache/facts.json', '{}');
  fs.symlinkSync(path.join(d, '.mxgate/bin/mxcli'), path.join(d, 'mxcli'));
  put(d, '.claude/rules/mxgate.md', '# Keep your checks as tests\n');
  put(d, '.claude/rules/person.md', 'my own rule\n');
  put(d, 'rules.local.md', '');
  const personHook = { type: 'command', command: 'echo mine' };
  put(d, '.claude/settings.local.json', JSON.stringify({
    permissions: { allow: ['Bash(npm test)', 'Bash(./mxgate:*)', 'Bash(./mxgate *)'], deny: ['Bash(rm -rf /)'] },
    hooks: {
      UserPromptSubmit: [{ hooks: [personHook] }, { hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.mxgate/hooks/request.mjs"' }] }],
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash tools/mdl-checks/hooks/after-mxcli-exec.sh' }, { type: 'command', command: 'echo also mine' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash tools/mdl-checks/hooks/before-mxcli-exec.sh' }] }],
    },
    model: 'sonnet',
  }, null, 2));
  put(d, 'AGENTS.md', MXCLI_AGENTS_MD + '\n<!-- mxgate:start -->\n## mxgate\nThis app is judged by the mxgate overlay\n<!-- mxgate:end -->\n');
  put(d, 'tools/mdl-checks/VERSION', 'v1'); put(d, 'tests/gate.sh', 'v1'); put(d, '.claude/skills/test-first-delivery/SKILL.md', 'v1 gate words');
  put(d, '.ai-context/skills/spacing-and-layout/SKILL.md', 'v1 copy'); put(d, '.ai-context/skills/create-page/SKILL.md', 'mxcli own');
  put(d, 'tests/orders.spec.ts', 'the agent\'s test'); put(d, 'docs/requests/01.md', 'the request'); put(d, 'docs/brain/project.md', 'brain');
  put(d, 'CLAUDE.local.md', 'person notes');
  const settingsBefore = get(d, '.claude/settings.json');

  const prev = readJson(path.join(d, '.mxgate/installed.json'));
  assert.equal(migrateBin(d, prev), true);
  const removed = upgradeCleanup(d);
  writeRules(d, ['claude']); copySkills(d, ['claude']);

  for (const gone of ['mxgate', '.mxgate', '.claude/rules/mxgate.md', 'rules.local.md', 'tools/mdl-checks', 'tests/gate.sh', '.claude/skills/test-first-delivery', '.ai-context/skills/spacing-and-layout'])
    assert.ok(!exists(d, gone), `${gone} is removed`);
  assert.ok(removed.includes('mxgate') && removed.includes('.mxgate'));
  // the downloaded mxcli moved with ./mxcli following it
  assert.equal(get(d, '.mxcodr/bin/mxcli'), 'BINARY');
  assert.equal(fs.readlinkSync(path.join(d, 'mxcli')), path.join(d, '.mxcodr/bin/mxcli'));
  assert.equal(get(d, 'mxcli'), 'BINARY');
  assert.equal(prev.mxcli.path, path.join(d, '.mxcodr/bin/mxcli'));
  // the person's own settings, untouched apart from our entries
  const sl = JSON.parse(get(d, '.claude/settings.local.json'));
  assert.deepEqual(sl.permissions, { allow: ['Bash(npm test)'], deny: ['Bash(rm -rf /)'] });
  assert.deepEqual(sl.hooks, { UserPromptSubmit: [{ hooks: [personHook] }], PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo also mine' }] }] });
  assert.equal(sl.model, 'sonnet');
  assert.equal(get(d, '.claude/settings.json'), settingsBefore);
  assert.equal(get(d, 'AGENTS.md'), MXCLI_AGENTS_MD);
  for (const [f, t] of [['.claude/rules/person.md', 'my own rule\n'], ['tests/orders.spec.ts', 'the agent\'s test'], ['docs/requests/01.md', 'the request'], ['docs/brain/project.md', 'brain'], ['CLAUDE.local.md', 'person notes'], ['.ai-context/skills/create-page/SKILL.md', 'mxcli own'], ['CLAUDE.md', '<!-- mxcli:begin -->\nmxcli\n<!-- mxcli:end -->\n']])
    assert.equal(get(d, f), t, f);
  // and the new install is in place
  assert.ok(exists(d, '.claude/rules/mxcodr.md') && exists(d, '.claude/skills/durable-tests/SKILL.md'));
  // a second run finds nothing more to remove
  assert.deepEqual(upgradeCleanup(d), []);
});

test('rules.local.md with the person\'s text stays; settings without our entries are not rewritten', () => {
  const d = stubApp();
  put(d, 'rules.local.md', 'never use red\n');
  const raw = '{\n "permissions": {"allow": ["Bash(ls)"]}\n}';
  put(d, '.claude/settings.local.json', raw);
  upgradeCleanup(d);
  assert.equal(get(d, 'rules.local.md'), 'never use red\n');
  assert.equal(get(d, '.claude/settings.local.json'), raw);
  const cursor = { version: 1, hooks: { stop: [{ command: 'bash tools/mdl-checks/hooks/stop-gate-cursor.sh' }], sessionStart: [{ command: 'echo hi' }] } };
  assert.equal(stripOurs(cursor), true);
  assert.deepEqual(cursor, { version: 1, hooks: { sessionStart: [{ command: 'echo hi' }] } });
});

test('./mxcli: the shim of an earlier bundle, a link to nowhere or a binary that does not run becomes the pinned mxcli; a wrapper script stays', () => {
  const d = tmp('mxcodr-shim-');
  const real = path.join(d, 'real-mxcli'); fs.writeFileSync(real, 'BINARY');
  const ok = () => PIN, broken = () => null;
  fs.writeFileSync(path.join(d, 'mxcli'), "#!/usr/bin/env node\nimport(pathToFileURL(path.join(app, '.mxgate', 'shim.mjs')).href)\n");
  assert.equal(replaceShim(d, real), true);
  assert.equal(get(d, 'mxcli'), 'BINARY');
  assert.equal(ensureLocalMxcli(d, real, ok), null, 'a link to the pinned binary stays');
  fs.rmSync(path.join(d, 'mxcli')); fs.symlinkSync(path.join(d, 'gone'), path.join(d, 'mxcli'));
  assert.match(ensureLocalMxcli(d, real, ok), /leads nowhere/);
  fs.rmSync(path.join(d, 'mxcli')); fs.writeFileSync(path.join(d, 'mxcli'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  assert.match(ensureLocalMxcli(d, real, broken), /did not run here/);
  assert.equal(get(d, 'mxcli'), 'BINARY');
  const e = tmp('mxcodr-shim-');
  fs.writeFileSync(path.join(e, 'mxcli'), '#!/bin/sh\nexec /opt/mxcli "$@"\n');
  assert.equal(ensureLocalMxcli(e, real, broken), null, 'someone else\'s wrapper stays');
});

test('AGENTS.md fence: appended once, replaced in place, the rest kept; unfence takes it out', () => {
  const a = fenceText('# mxcli\ntext\n', 'block one');
  assert.equal(a, `# mxcli\ntext\n\n${START}\nblock one\n${END}\n`);
  const b = fenceText(a + 'after\n', 'block two');
  assert.equal(b.split(START).length, 2);
  assert.match(b, /block two/); assert.doesNotMatch(b, /block one/); assert.match(b, /after\n$/);
  assert.equal(unfence(a, START, END), '# mxcli\ntext\n');
});

test('installed.json holds bundle, mxcli, db, agents, skills and requests; no ports, manifest, hook or permission', () => {
  const src = fs.readFileSync(new URL('../overlay/install.mjs', import.meta.url), 'utf8');
  for (const k of ['bundle: BUNDLE', 'mxcli: { path', 'db,', 'agents,', 'skills: INSTALLED_SKILLS', 'testKit: kit.ours', 'requests:']) assert.ok(src.includes(k), k);
  const inst = src.split('\n').find(l => l.includes('const inst = {'));
  assert.doesNotMatch(inst, /\bports\b|manifest|points/, 'installed.json carries no ports, manifest or points');
  for (const k of [/manifest/, /UserPromptSubmit/, /permissions\.allow\.push/, /decompose/, /settings\.json'/]) assert.doesNotMatch(src, k, `the installer no longer writes ${k}`);
  assert.deepEqual(parseAgents('claude, Cursor,claude'), ['claude', 'cursor']);
});

test('the request archive (--request): saved once, numbered, hashed; atomic writes leave no temporary file', () => {
  const d = tmp('mxcodr-req-');
  const requests = {};
  const prompt = 'Build a B2B ordering app: Employees create orders, Managers approve orders above 50,000 PLN gross.';
  assert.equal(saveRequest(d, prompt, 'install', requests), '01.md');
  assert.equal(saveRequest(d, prompt + '\n', 'install', requests), null, 'the same text is not saved twice');
  assert.equal(saveRequest(d, 'A second turn.', 'install', requests), '02.md');
  assert.equal(requests['01.md'].sha1, sha1(prompt + '\n'));
  assert.deepEqual(readRequests(d).map(r => r.file), ['01.md', '02.md']);
  const f = path.join(d, '.mxcodr', 'installed.json');
  writeAtomic(f, { a: 1 }); writeAtomic(f, { a: 2 });
  assert.deepEqual(readJson(f), { a: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['installed.json']);
});

const kitSource = name => fs.readFileSync(new URL(`../overlay/templates/tests/${name}`, import.meta.url), 'utf8');

test('test kit, absent: tests/mx.ts, mx.teardown.ts, playwright.config.ts and package.json are copied from the bundle', () => {
  const d = stubApp();
  const { written, lines } = copyTestKit(d);
  assert.deepEqual(written, TEST_KIT);
  assert.deepEqual(TEST_KIT, ['tests/mx.ts', 'tests/mx.teardown.ts', 'tests/playwright.config.ts', 'tests/package.json']);
  assert.equal(JSON.parse(get(d, 'tests/package.json')).devDependencies['@playwright/test'], PLAYWRIGHT);
  assert.equal(PLAYWRIGHT, '1.64.1');
  for (const rel of TEST_KIT) assert.equal(get(d, rel), kitSource(path.basename(rel)), rel);
  assert.match(lines.join('\n'), /test kit -> tests\/mx\.ts/);
  assert.deepEqual(copyTestKit(d).written, [], 'a second install writes nothing');
});

test('test kit, present: the app\'s own files, specs and helpers.ts stay byte for byte; only the absent ones are added', () => {
  const d = stubApp();
  put(d, 'tests/mx.ts', '// the agent edited this\n');
  put(d, 'tests/playwright.config.ts', 'export default { workers: 1 };\n');
  put(d, 'tests/helpers.ts', 'export const mine = 1;\n');
  put(d, 'tests/package.json', '{"devDependencies":{"@playwright/test":"1.55.1"}}\n');
  put(d, 'tests/orders.spec.ts', 'the agent\'s test');
  const before = walk(d);
  const { written, lines } = copyTestKit(d, ['tests/mx.ts', 'tests/playwright.config.ts']); // the agent edited the kit's mx.ts
  assert.deepEqual(written, ['tests/mx.teardown.ts']);
  assert.deepEqual(walk(d), [...before, 'tests/mx.teardown.ts'].sort());
  assert.equal(get(d, 'tests/mx.ts'), '// the agent edited this\n');
  assert.equal(get(d, 'tests/playwright.config.ts'), 'export default { workers: 1 };\n');
  assert.equal(get(d, 'tests/helpers.ts'), 'export const mine = 1;\n');
  assert.equal(get(d, 'tests/package.json'), '{"devDependencies":{"@playwright/test":"1.55.1"}}\n', 'the app\'s own package.json stays');
  assert.equal(get(d, 'tests/orders.spec.ts'), 'the agent\'s test');
  assert.match(lines.join('\n'), /kept the app's own tests\/mx\.ts, tests\/playwright\.config\.ts/);
});

test('test kit: a Playwright config at the app root means no second config in tests/', () => {
  const d = stubApp();
  put(d, 'playwright.config.ts', 'export default {};\n');
  const { written, lines } = copyTestKit(d);
  assert.deepEqual(written, ['tests/mx.ts', 'tests/mx.teardown.ts']);
  assert.ok(!exists(d, 'tests/playwright.config.ts'));
  assert.match(lines.join('\n'), /the app has playwright\.config\.ts; name globalTeardown/);
  assert.ok(!exists(d, 'tests/package.json'));
  assert.match(lines.join('\n'), /no tests\/package\.json, the app has playwright\.config\.ts at its root; pin @playwright\/test there: npm install -D -E @playwright\/test@1\.64\.1/);
});

test('test kit: a package.json at the app root means no second one in tests/, and a line to pin Playwright there', () => {
  const d = stubApp();
  put(d, 'package.json', '{"name":"app"}\n');
  const { written, lines } = copyTestKit(d);
  assert.deepEqual(written, ['tests/mx.ts', 'tests/mx.teardown.ts', 'tests/playwright.config.ts']);
  assert.ok(!exists(d, 'tests/package.json'));
  assert.equal(get(d, 'package.json'), '{"name":"app"}\n');
  assert.match(lines.join('\n'), /no tests\/package\.json, the app has package\.json at its root; pin @playwright\/test there: npm install -D -E @playwright\/test@1\.64\.1/);
});

test('test kit: upgradeCleanup leaves it alone', () => {
  const d = stubApp();
  copyTestKit(d);
  upgradeCleanup(d);
  for (const rel of TEST_KIT) assert.ok(exists(d, rel), rel);
});

// D1 (probe 2026-11-01): an AGENTS.md the installer created held only our block, and `mxcli init` regenerated it whole.
test('AGENTS.md without mxcli\'s section: its markers go first, then our block; text already there stays outside them', () => {
  const d = stubApp();
  fs.rmSync(path.join(d, 'AGENTS.md'));
  const lines = writeRules(d, ['codex']);
  const md = get(d, 'AGENTS.md');
  assert.ok(md.startsWith(`${MXCLI_BEGIN} -->\n${MXCLI_END}\n\n${START}\n`), md.slice(0, 120));
  assert.match(lines.join('\n'), /AGENTS\.md had no mxcli section; wrote its markers first/);
  assert.deepEqual(writeRules(d, ['codex']).filter(l => /no mxcli section/.test(l)), [], 'a second install adds no second pair');
  assert.equal(get(d, 'AGENTS.md'), md);
  put(d, 'AGENTS.md', '# Our notes\n\nkeep me\n');
  writeRules(d, ['pi']);
  const md2 = get(d, 'AGENTS.md');
  assert.ok(md2.indexOf(MXCLI_END) < md2.indexOf('keep me') && md2.indexOf('keep me') < md2.indexOf(START), md2.slice(0, 200));
  assert.equal(withMxcliSection(''), `${MXCLI_BEGIN} -->\n${MXCLI_END}\n`);
  const c = stubApp(); fs.rmSync(path.join(c, 'AGENTS.md'));
  writeRules(c, ['claude']);
  assert.ok(!exists(c, 'AGENTS.md'), 'no AGENTS.md reader chosen: no AGENTS.md written');
});

// D2: a reinstall recorded "testKit": [] because the kept files were not listed.
test('test kit record: a reinstall lists the kit files kept from before, not only the ones written now', () => {
  const d = stubApp();
  const first = copyTestKit(d);
  assert.deepEqual(first.ours, TEST_KIT);
  put(d, 'tests/mx.ts', '// the agent edited the kit\n');
  const again = copyTestKit(d, first.ours);
  assert.deepEqual(again.written, []);
  assert.deepEqual(again.ours, TEST_KIT, 'recorded before, or still the bundle\'s text');
  assert.deepEqual(copyTestKit(d, []).ours, TEST_KIT.filter(r => r !== 'tests/mx.ts'), 'an edited file nobody recorded is not claimed');
});

// D3: the teardown and config import BASE, sessionsLeft and oql from ./mx.
test('test kit: with the person\'s own tests/mx.ts the teardown and config are not written, and one line says why', () => {
  const d = stubApp();
  put(d, 'tests/mx.ts', 'export const mine = 1;\n');
  const { written, ours, lines } = copyTestKit(d);
  assert.deepEqual(written, ['tests/package.json']);
  assert.ok(!exists(d, 'tests/mx.teardown.ts') && !exists(d, 'tests/playwright.config.ts'));
  assert.deepEqual(ours, ['tests/package.json']);
  assert.match(lines.join('\n'), /skipped tests\/mx\.teardown\.ts, tests\/playwright\.config\.ts: tests\/mx\.ts is the app's own .*move tests\/mx\.ts aside and install again/);
  const e = stubApp();
  put(e, 'tests/mx.ts', kitSource('mx.ts'));
  assert.deepEqual(copyTestKit(e).written, ['tests/mx.teardown.ts', 'tests/playwright.config.ts', 'tests/package.json'], 'the bundle\'s own mx.ts is the kit');
});

// D4: the finish condition runs npx playwright test --shuffle, which needs 1.64.1.
test('test kit: a kept tests/package.json with another or no Playwright pin gets the pin hint; 1.64.1 gets none', () => {
  const hint = /tests\/package\.json pins @playwright\/test 1\.40\.0; .*npm install -D -E @playwright\/test@1\.64\.1/;
  const d = stubApp();
  put(d, 'tests/package.json', '{"devDependencies":{"@playwright/test":"1.40.0"}}\n');
  assert.match(copyTestKit(d).lines.join('\n'), hint);
  assert.equal(get(d, 'tests/package.json'), '{"devDependencies":{"@playwright/test":"1.40.0"}}\n', 'kept as it was');
  const e = stubApp();
  put(e, 'tests/package.json', '{"name":"t"}\n');
  assert.match(copyTestKit(e).lines.join('\n'), /tests\/package\.json does not pin @playwright\/test/);
  const f = stubApp();
  copyTestKit(f);
  assert.doesNotMatch(copyTestKit(f, TEST_KIT).lines.join('\n'), /pin/, 'the kit\'s own package.json needs no hint');
});
