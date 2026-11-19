// A kit file an earlier mx-codr wrote and the person never edited is replaced with the current kit on a reinstall or
// setup (copyTestKit, overlay/lib/kit-shipped.json); an edited one stays and is named once. Measured need: 5f8d6bb6
// fixed signOut's anonymous-session leak in tests/mx.ts, and every app installed before kept the leaking copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyTestKit, TEST_KIT } from '../overlay/install.mjs';
import { liveKitText, wireTestsTab, KIT_EDITS } from '../overlay/lib/live.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const SRC = fileURLToPath(new URL('../overlay/templates/tests/', import.meta.url));
const SHIPPED_FILE = new URL('../overlay/lib/kit-shipped.json', import.meta.url);
const kitSource = name => fs.readFileSync(path.join(SRC, name), 'utf8');
const sha = t => crypto.createHash('sha256').update(t.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-kitupd-'));
const put = (d, rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
const get = (d, rel) => fs.readFileSync(path.join(d, rel), 'utf8');
const app = () => { const d = tmp(); put(d, 'App.mpr', 'mpr'); return d; };

// a stand-in for an old kit version: the current text with a line it no longer has
const OLD_MX = kitSource('mx.ts').replace(/\n/, '\n// an older kit line\n');
const OLD_TD = kitSource('mx.teardown.ts') + '// an older teardown line\n';
const shippedFor = (...pairs) => { const o = {}; for (const [rel, text] of pairs) (o[rel] ??= {})[sha(text)] = 'test'; return o; };

test('kit update: a file whose text mx-codr shipped before (never edited) is replaced with the current kit', () => {
  const d = app();
  put(d, 'tests/mx.ts', OLD_MX);
  const r = copyTestKit(d, ['tests/mx.ts'], SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX]) });
  assert.equal(get(d, 'tests/mx.ts'), kitSource('mx.ts'));
  assert.deepEqual(r.updated, ['tests/mx.ts']);
  assert.ok(r.ours.includes('tests/mx.ts'));
  assert.deepEqual(r.edited, []);
  assert.match(r.lines.join('\n'), /test kit: updated tests\/mx\.ts to the current kit \(unchanged since an earlier mx-codr wrote them\)/);
  assert.deepEqual(copyTestKit(d, r.ours, SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX]) }).updated, [], 'the current kit is not rewritten');
});

test('kit update: a file the person edited stays byte for byte, and one line says it is theirs and the fix is not in it', () => {
  const d = app();
  const mine = OLD_MX + '// mine\n';
  put(d, 'tests/mx.ts', mine);
  put(d, 'tests/mx.teardown.ts', OLD_TD + '// mine too\n');
  const r = copyTestKit(d, TEST_KIT, SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX], ['tests/mx.teardown.ts', OLD_TD]) });
  assert.equal(get(d, 'tests/mx.ts'), mine);
  assert.equal(get(d, 'tests/mx.teardown.ts'), OLD_TD + '// mine too\n');
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.edited, ['tests/mx.ts', 'tests/mx.teardown.ts']);
  assert.ok(r.ours.includes('tests/mx.ts'), 'recorded as the kit before: still listed');
  const said = r.lines.filter(l => /yours/.test(l));
  assert.equal(said.length, 1, 'said once, for all edited files');
  assert.match(said[0], /tests\/mx\.ts, tests\/mx\.teardown\.ts are yours \(not a text mx-codr shipped\), kept as they are: the kit's later fixes are not in them/);
});

test('kit update: an absent file is still copied, next to an updated one', () => {
  const d = app();
  put(d, 'tests/mx.ts', OLD_MX);
  const r = copyTestKit(d, [], SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX]) });
  assert.deepEqual(r.written, ['tests/mx-impl.ts', 'tests/mx.teardown.ts', 'tests/playwright.config.ts', 'tests/package.json'], 'an unedited old mx.ts not in the record is the kit: its code, teardown and config are written');
  assert.deepEqual(r.updated, ['tests/mx.ts']);
  for (const rel of TEST_KIT) assert.equal(get(d, rel), kitSource(path.basename(rel)), rel);
  assert.deepEqual(r.ours, TEST_KIT);
});

test('kit update: CRLF counts as LF; an unedited CRLF file is replaced keeping CRLF, a current CRLF file is left as it is', () => {
  const crlf = t => t.replace(/\n/g, '\r\n');
  const d = app();
  put(d, 'tests/mx.ts', crlf(OLD_MX));
  put(d, 'tests/mx.teardown.ts', crlf(kitSource('mx.teardown.ts')));
  const r = copyTestKit(d, TEST_KIT, SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX]) });
  assert.deepEqual(r.updated, ['tests/mx.ts']);
  assert.equal(get(d, 'tests/mx.ts'), crlf(kitSource('mx.ts')));
  assert.equal(get(d, 'tests/mx.teardown.ts'), crlf(kitSource('mx.teardown.ts')), 'already the kit: not rewritten');
  assert.deepEqual(r.edited, []);
  assert.ok(r.ours.includes('tests/mx.teardown.ts'));
});

test('kit update, live: an unedited old live kit file gets the current live text', () => {
  const d = app();
  const oldLive = liveKitText('mx.ts', OLD_MX);
  put(d, 'tests/mx.ts', oldLive);
  const r = copyTestKit(d, TEST_KIT, SRC, { live: true, shipped: shippedFor(['tests/mx.ts', oldLive]) });
  assert.deepEqual(r.updated, ['tests/mx.ts']);
  assert.equal(get(d, 'tests/mx.ts'), liveKitText('mx.ts', kitSource('mx.ts')));
});

test('kit update: a link is never written through, even when its target holds a shipped text', () => {
  const d = app(), outside = tmp();
  put(outside, 'mx.ts', OLD_MX);
  fs.mkdirSync(path.join(d, 'tests'));
  fs.symlinkSync(path.join(outside, 'mx.ts'), path.join(d, 'tests/mx.ts'));
  const r = copyTestKit(d, TEST_KIT, SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX]) });
  assert.deepEqual(r.updated, []);
  assert.equal(get(outside, 'mx.ts'), OLD_MX);
  assert.ok(fs.lstatSync(path.join(d, 'tests/mx.ts')).isSymbolicLink());
});

test('kit update: an unedited teardown is held back when the person\'s edited mx.ts lacks a name it imports', () => {
  const d = app();
  put(d, 'tests/mx.ts', 'export async function sessionsLeft() { return 0; }\n');   // no oql
  put(d, 'tests/mx.teardown.ts', OLD_TD);
  const r = copyTestKit(d, TEST_KIT, SRC, { shipped: shippedFor(['tests/mx.teardown.ts', OLD_TD]) });
  assert.equal(get(d, 'tests/mx.teardown.ts'), OLD_TD);
  assert.deepEqual(r.updated, []);
  assert.ok(!r.lines.some(l => /^test kit: kept /.test(l)), 'held back is said once, not also as kept');
  assert.match(r.lines.join('\n'), /test kit: not updated tests\/mx\.teardown\.ts \(imports oql\): your tests\/mx\.ts does not export what the current kit imports; kept as before/);
  put(d, 'tests/mx.ts', 'export async function sessionsLeft() { return 0; }\nexport const oql = 1;\n');
  assert.deepEqual(copyTestKit(d, TEST_KIT, SRC, { shipped: shippedFor(['tests/mx.teardown.ts', OLD_TD]) }).updated, ['tests/mx.teardown.ts'], 'with both names it is updated');
});

// The data file is generated (mxcodr/tools/kit-shipped.mjs). A kit change that forgets to rerun it fails here, so the
// version it replaces is never left out of the list and apps that hold it still get the next fix.
test('kit-shipped.json holds the current kit: plain, live and the plain config as setup wires it', () => {
  const files = JSON.parse(fs.readFileSync(SHIPPED_FILE, 'utf8')).files;
  assert.deepEqual(Object.keys(files).sort(), [...TEST_KIT].sort());
  const rerun = 'rerun node mxcodr/tools/kit-shipped.mjs and commit overlay/lib/kit-shipped.json';
  for (const rel of TEST_KIT) {
    const name = path.basename(rel);
    assert.ok(files[rel][sha(kitSource(name))], `${rel}: the current template is missing; ${rerun}`);
    assert.ok(files[rel][sha(liveKitText(name, kitSource(name)))], `${rel}: the current live kit (KIT_EDITS) is missing; ${rerun}`);
    for (const h of Object.keys(files[rel])) assert.match(h, /^[0-9a-f]{64}$/);
  }
  const wired = wireTestsTab(kitSource('playwright.config.ts'));
  if (wired.changed) assert.ok(files['tests/playwright.config.ts'][sha(wired.text)], `the plain config wired by setup is missing; ${rerun}`);
});

// The real history: the tests/mx.ts before 5f8d6bb6 (signOut left an anonymous session) is a shipped text, and an app
// holding it, plain or live, gets the fixed one from the bundle's own data file.
test('the signOut fix reaches an app with the mx.ts from before 5f8d6bb6, plain and live', { skip: spawnSync('git', ['-C', repo, 'cat-file', '-e', '5f8d6bb6^']).status !== 0 && 'no git history here' }, () => {
  const before = spawnSync('git', ['-C', repo, 'show', '5f8d6bb6^:mxcodr/overlay/templates/tests/mx.ts'], { encoding: 'utf8' }).stdout;
  assert.ok(before.length > 1000 && before !== kitSource('mx.ts'));
  const d = app();
  put(d, 'tests/mx.ts', before);
  const r = copyTestKit(d, TEST_KIT);
  assert.deepEqual(r.updated, ['tests/mx.ts']);
  assert.deepEqual(r.written.slice(0, 1), ['tests/mx-impl.ts'], 'the split kit (bundle 2026.11.20.1): mx.ts beside its code');
  assert.equal(get(d, 'tests/mx.ts'), kitSource('mx.ts'));
  assert.equal(get(d, 'tests/mx-impl.ts'), kitSource('mx-impl.ts'));
  const beforeLive = spawnSync('git', ['-C', repo, 'show', '5f8d6bb6^:mxcodr/overlay/lib/live.mjs'], { encoding: 'utf8' }).stdout;
  assert.ok(beforeLive.includes('KIT_EDITS'));
  const e = app();
  // the live edit of the old one-file mx.ts (KIT_EDITS for it did not change in 5f8d6bb6; it is mx-impl.ts's since 2026.11.20.1)
  const [from, to] = KIT_EDITS['mx-impl.ts'][0];
  assert.ok(before.includes(from));
  put(e, 'tests/mx.ts', before.split(from).join(to));
  assert.deepEqual(copyTestKit(e, TEST_KIT, SRC, { live: true }).updated, ['tests/mx.ts']);
  assert.equal(get(e, 'tests/mx.ts'), liveKitText('mx.ts', kitSource('mx.ts')));
  assert.equal(get(e, 'tests/mx-impl.ts'), liveKitText('mx-impl.ts', kitSource('mx-impl.ts')));
  assert.match(get(e, 'tests/mx-impl.ts'), /restart the app with \.\/mxcodr-live app restart/);
});

test('kit split: a tests/mx-impl.ts the kit did not write keeps the old mx.ts (never a thin mx.ts over a foreign impl); its own impl updates', () => {
  const d = app();
  put(d, 'tests/mx.ts', OLD_MX);
  put(d, 'tests/mx-impl.ts', 'export const somethingElse = 1;\n');
  const r = copyTestKit(d, [], SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX]) });
  assert.equal(get(d, 'tests/mx.ts'), OLD_MX);
  assert.equal(get(d, 'tests/mx-impl.ts'), 'export const somethingElse = 1;\n');
  assert.ok(!r.updated.includes('tests/mx.ts'));
  assert.match(r.lines.join('\n'), /not updated tests\/mx\.ts \(tests\/mx-impl\.ts is not the kit's\): the kit's tests\/mx\.ts imports tests\/mx-impl\.ts; move yours aside and install again/);
  // the kit's own impl, edited by nobody, from an earlier split kit: updated with mx.ts
  const e = app();
  const oldImpl = kitSource('mx-impl.ts') + '// an older impl line\n';
  put(e, 'tests/mx.ts', OLD_MX);
  put(e, 'tests/mx-impl.ts', oldImpl);
  const r2 = copyTestKit(e, [], SRC, { shipped: shippedFor(['tests/mx.ts', OLD_MX], ['tests/mx-impl.ts', oldImpl]) });
  assert.deepEqual(r2.updated, ['tests/mx-impl.ts', 'tests/mx.ts']);
  assert.equal(get(e, 'tests/mx-impl.ts'), kitSource('mx-impl.ts'));
});
