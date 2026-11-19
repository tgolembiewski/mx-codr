// Which tool the kit's oql() (tests/mx.ts) runs: in a live app the extension's ./mxcodr-live, found by the record
// setup writes (.mxcodr/live-tool.json, its runtime in the person's user folder), with no shell; in a file-mode app
// ./mxcli oql as before. Since live.60 the tool is no longer in <app>/.mxcodr/live/, and a kit that still looked there
// fell back to ./mxcli, which cannot reach Studio Pro's run: every spec using oql() failed (11.12.1, 2026-11-10).
// The TypeScript is stripped by Node itself (Node >= 22.13); execFileSync is a fake that records what it was asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';

const strip = nodeModule.stripTypeScriptTypes;
const skip = strip ? false : 'needs Node >= 22.13 (node:module stripTypeScriptTypes)';

const FAKES = `
export const Page = undefined, Locator = undefined, APIRequestContext = undefined;
export const request = { newContext: async o => ({ options: o }) };
export const expect = () => ({});
export const test = { extend: fixtures => ({ fixtures }) };
export const execFileSync = (file, args, options) => { globalThis.calls.push({ file, args, options }); return '[{"N":"0"}]'; };
`;

let n = 0;
async function kitIn(setupApp) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mxkit-live-'));
  const dir = path.join(app, 'tests');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(app, 'App.mpr'), '');
  fs.writeFileSync(path.join(dir, 'fakes.mjs'), FAKES);
  setupApp(app);
  const src = strip(fs.readFileSync(new URL('../overlay/templates/tests/mx-impl.ts', import.meta.url), 'utf8'))
    .replace(/from '@playwright\/test'/, "from './fakes.mjs'")
    .replace(/from 'node:child_process'/, "from './fakes.mjs'");
  const f = path.join(dir, `mx${n++}.mjs`);
  fs.writeFileSync(f, `const __dirname = ${JSON.stringify(dir)};\n${src}`);
  return { app, kit: await import(pathToFileURL(f).href) };
}
// a runtime as the extension installs it in the person's folder (a path with a space, as on macOS)
function runtime() {
  const rt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr rt-')), 'live75-x');
  for (const [d, f] of [['bin', 'mxcodr-live.mjs'], ['src', 'pw-progress.cjs']]) {
    fs.mkdirSync(path.join(rt, 'live', 'translator', d), { recursive: true });
    fs.writeFileSync(path.join(rt, 'live', 'translator', d, f), '');
  }
  return rt;
}
const record = (app, value) => {
  fs.mkdirSync(path.join(app, '.mxcodr'), { recursive: true });
  fs.writeFileSync(path.join(app, '.mxcodr', 'live-tool.json'), typeof value === 'string' ? value : JSON.stringify(value));
};

test('a live app: oql() runs the extension\'s mxcodr-live.mjs named in .mxcodr/live-tool.json, on this Node, with no shell', { skip }, async () => {
  const rt = runtime();
  const tool = path.join(rt, 'live', 'translator', 'bin', 'mxcodr-live.mjs');
  const { app, kit } = await kitIn(a => record(a, { runtime: rt, tool, progress: path.join(rt, 'live', 'translator', 'src', 'pw-progress.cjs') }));
  globalThis.calls = [];
  const prev = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require /tmp/evil.js';
  try { assert.equal(kit.sessionsLeft(), 0); } finally { if (prev === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = prev; }
  const [c] = globalThis.calls;
  assert.equal(c.file, process.execPath);
  // the query before --json: mxcodr-live's option reader takes the word after --json as its value (11.12.1, 2026-11-10)
  assert.deepEqual(c.args, ['--no-warnings', tool, '--app', app, 'oql', 'select count(s.ID) as N from System.Session as s', '--json']);
  assert.equal(c.options.shell, undefined, 'no shell');
  assert.equal(c.options.cwd, app);
  assert.equal(c.options.env.NODE_OPTIONS, undefined, 'the variables the wrapper clears are cleared here too');
});

test('a file-mode app (no record): oql() runs ./mxcli oql -p <mpr>, as before', { skip }, async () => {
  const { kit } = await kitIn(() => {});
  globalThis.calls = [];
  kit.oql('select 1 as N from System.Session as s');
  const [c] = globalThis.calls;
  assert.equal(c.file, './mxcli');
  assert.deepEqual(c.args, ['oql', '-p', 'App.mpr', '--json', 'select 1 as N from System.Session as s']);
});

test('a record that names no live tool on this computer: oql() says to check setup, and never falls back to ./mxcli', { skip }, async () => {
  const gone = path.join(os.tmpdir(), 'mxcodr-gone', 'live', 'translator', 'bin', 'mxcodr-live.mjs');
  for (const value of [{ tool: gone }, { tool: 'mxcodr-live.mjs' }, { tool: path.join(runtime(), 'live', 'translator', 'src', 'pw-progress.cjs') }, '{bad']) {
    const { kit } = await kitIn(a => record(a, value));
    globalThis.calls = [];
    assert.throws(() => kit.oql('select 1 as N from System.Session as s'), /live-tool\.json.*Setup and agents/s, JSON.stringify(value));
    assert.equal(globalThis.calls.length, 0, JSON.stringify(value));
  }
});
