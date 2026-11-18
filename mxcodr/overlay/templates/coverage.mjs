#!/usr/bin/env node
// tests/coverage.mjs: which numbered requirements a test cites. The mx-codr installer writes it on every install
// when coverage is on (it is the bundle's, not the app's: edits are overwritten). Run it from the app folder:
//
//   node tests/coverage.mjs           the report; exit 0 only with 0 missing, no unknown tag and a ledger
//   node tests/coverage.mjs --json    the same as JSON, for a scorer
//
// The requirements are the numbered entries in docs/brain/plan/*.md that mxcli wrote (`./mxcli brain capture
// "R12 ..." --slice 01-<area>`, then `./mxcli brain promote <id>`): a heading `## R12 <text>` followed by mxcli's
// line `Anchors: ... · id `<id>` · <date>`. A heading written by hand without that line is not counted, as mxcli
// does not count it either. The tests are the real titles from `playwright test --list --reporter=json` (after
// describe nesting and template strings; it needs no running app and runs no test, fixture or teardown), and a
// requirement is cited by a tag `[R12]` anywhere in a test's title or in a describe title around it. A skipped
// or fixme test cites nothing. No model reads anything here: a test that cites R12 and asserts nothing still
// counts, so the durable-tests rules ("assert the actual content") stay the defence there.
//
// Exit 1: a requirement with no test (missing), a tag naming no requirement (unknown), a number used twice, a
// requirement with no number, or no numbered requirement at all (an empty ledger is not "0 missing").
// Exit 2: the tests could not be listed (no @playwright/test, a spec that does not compile).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const PLAN_DIR = 'docs/brain/plan';
// mxcli's line under a promoted entry (mxcli 0.29, the same on 0.30): `Anchors: `@A.B` · id `0c4adf` · 2026-11-04[ · OPEN]`
const META = /^Anchors: (.*?) · id `([0-9a-f]+)`(.*)$/;
const NUMBER = /^(R)0*(\d+)\b/;
const TAG = /\[R0*(\d+)\]/g;

// One plan file's text -> its entries: { id, text (after the number), slice, anchored, open, dropped, entry } for
// each heading mxcli wrote, and { id, text (the whole heading), slice, hand: true } for one without mxcli's line.
export function entriesFrom(text, slice) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^## (.+?)\s*$/.exec(lines[i]);
    if (!h) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const m = META.exec(lines[j] || '');
    const num = NUMBER.exec(h[1]);
    if (!m) { out.push({ id: num ? `R${num[2]}` : null, text: h[1], slice, hand: true }); continue; }
    out.push({
      id: num ? `R${num[2]}` : null,
      text: num ? h[1].slice(num[0].length).trim() : h[1],
      slice,
      anchored: m[1].trim() !== 'none',
      open: / · OPEN\b/.test(m[3]),
      dropped: /\(dropped\b/i.test(h[1]),
      entry: m[2],
    });
  }
  return out;
}

// The app's plan -> every entry of every slice, in slice order.
export function readPlan(app) {
  const dir = path.join(app, PLAN_DIR);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch { /* no plan yet */ }
  return files.flatMap(f => entriesFrom(fs.readFileSync(path.join(dir, f), 'utf8'), f.replace(/\.md$/, '')));
}

// `playwright test --list --reporter=json` -> [{ file, line, title, tags, counts }]; title is the describe path
// and the test's own title joined by ' › '; counts is false for a test that is skipped or fixme.
export function testsFromList(json) {
  const out = [];
  const walk = (suite, describes) => {
    for (const spec of suite.specs || []) {
      const title = [...describes, spec.title].join(' › ');
      const tests = spec.tests || [];
      const counts = !tests.length || tests.some(t => (t.expectedStatus || 'passed') === 'passed');
      out.push({ file: spec.file, line: spec.line, title, tags: [...new Set([...title.matchAll(TAG)].map(m => `R${m[1]}`))], counts });
    }
    for (const child of suite.suites || []) walk(child, child.title && child.title !== child.file ? [...describes, child.title] : describes);
  };
  for (const file of json.suites || []) walk(file, []);
  return out;
}

// Entries and tests -> the report. ok is what the exit code says.
export function coverage(entries, tests) {
  const counted = entries.filter(e => !e.hand && !e.open);
  const reqs = counted.filter(e => e.id);
  const byId = new Map();
  const duplicates = [];
  for (const r of reqs) { if (byId.has(r.id)) duplicates.push(r.id); else byId.set(r.id, r); }
  const known = new Set([...byId.keys(), ...entries.filter(e => !e.hand && e.open && e.id).map(e => e.id)]);
  const requirements = [...byId.values()].map(r => {
    const citing = tests.filter(t => t.tags.includes(r.id));
    return { ...r, tests: citing.filter(t => t.counts).map(where), skippedOnly: citing.filter(t => !t.counts).map(t => `${t.file}:${t.line}`) };
  });
  const due = requirements.filter(r => !r.dropped);
  const missing = due.filter(r => !r.tests.length);
  const unknown = [];
  for (const t of tests) for (const id of t.tags) if (!known.has(id)) unknown.push({ id, test: where(t) });
  const unnumbered = counted.filter(e => !e.id).map(e => ({ text: e.text, slice: e.slice }));
  const result = {
    total: due.length,
    tested: due.length - missing.length,
    missing: missing.map(r => ({ id: r.id, text: r.text, slice: r.slice, skippedOnly: r.skippedOnly })),
    unknown,
    duplicates: [...new Set(duplicates)],
    unnumbered,
    dropped: requirements.filter(r => r.dropped).map(r => r.id),
    open: entries.filter(e => !e.hand && e.open).map(e => e.id || e.text),
    unanchored: due.filter(r => !r.anchored).map(r => r.id),
    byHand: entries.filter(e => e.hand).map(e => ({ text: e.text, slice: e.slice })),
    requirements: requirements.map(r => ({ id: r.id, text: r.text, slice: r.slice, anchored: r.anchored, dropped: r.dropped, tests: r.tests })),
  };
  result.empty = due.length === 0;
  result.ok = !result.empty && !missing.length && !unknown.length && !result.duplicates.length && !unnumbered.length;
  return result;
}
const where = t => `${t.file}:${t.line} ${t.title}`;

// The report a person or an agent reads; the last line is the count. panel: the agent runs in mx-codr's panel
// (MXCODR_PANEL=1), where the person promotes the captured requirements, never the agent (the brain rule).
export function format(r, { panel = process.env.MXCODR_PANEL === '1' } = {}) {
  const out = [];
  const req = '`./mxcli brain capture "R<n> <text>" --slice 01-<area> -a @Module.Document -p <app>.mpr --json`, then '
    + (panel ? "the person saves them in mx-codr's panel (they count from then on; never promote them yourself)" : '`./mxcli brain promote <id> -p <app>.mpr`');
  if (r.empty) {
    out.push(`no numbered requirement in ${PLAN_DIR}/: record them first (skill requirements-interview): ${req}`);
    if (r.byHand.length) out.push(`  ${r.byHand.length} heading(s) there were written by hand and are not counted; mxcli writes them on promote`);
    return out.join('\n');
  }
  if (r.missing.length) {
    out.push('missing (no test cites it; write the test, its title naming [R<n>]):');
    for (const m of r.missing) out.push(`  ${m.id}  ${m.text}  (${m.slice}${m.skippedOnly.length ? `; only a skipped test cites it: ${m.skippedOnly.join('; ')}` : ''})`);
  }
  if (r.unknown.length) {
    out.push('unknown (a tag that names no requirement):');
    for (const u of r.unknown) out.push(`  [${u.id}]  ${u.test}`);
  }
  if (r.duplicates.length) out.push(`used twice: ${r.duplicates.join(', ')}; numbers are global and never reused (a later request continues after the highest)`);
  if (r.unnumbered.length) {
    out.push(`no number (each requirement starts "R<n> "; edit the heading in ${PLAN_DIR}/, keep the line under it):`);
    for (const u of r.unnumbered) out.push(`  ${u.slice}: ${u.text}`);
  }
  const info = [];
  if (r.unanchored.length) info.push(`unanchored, so \`./mxcli brain plan\` cannot count them as built: ${r.unanchored.join(', ')}`);
  if (r.dropped.length) info.push(`dropped, no test needed: ${r.dropped.join(', ')}`);
  if (r.open.length) info.push(`open questions, not counted: ${r.open.join(', ')}`);
  if (r.byHand.length) info.push(`written by hand, not counted (no mxcli line under the heading; record it with ${req}): ${r.byHand.map(b => `${b.slice}: ${b.text}`).join('; ')}`);
  if (info.length) { out.push('information:'); for (const l of info) out.push(`  ${l}`); }
  const extra = [r.unknown.length && `${r.unknown.length} unknown tag${r.unknown.length === 1 ? '' : 's'}`, r.duplicates.length && `${r.duplicates.length} used twice`, r.unnumbered.length && `${r.unnumbered.length} without a number`].filter(Boolean);
  out.push(`${r.total} requirements, ${r.tested} tested, ${r.missing.length} missing${extra.length ? `; ${extra.join(', ')}` : ''}`);
  return out.join('\n');
}

// ---- running it ----------------------------------------------------------------------------------------------

const fail = s => { console.error(`coverage: ${s}`); process.exit(2); };

// The Playwright config in use: tests/ first, then the app folder (as tests/film.mjs finds it).
export function locate(testsDir) {
  const app = path.dirname(testsDir);
  const names = ['ts', 'js', 'mjs', 'cjs'].map(e => `playwright.config.${e}`);
  for (const dir of [testsDir, app]) for (const n of names) if (fs.existsSync(path.join(dir, n))) return { app, testsDir, configDir: dir, config: n };
  return { app, testsDir, configDir: null, config: null };
}

function listTests(where) {
  if (!where.config) fail('no playwright.config.* in tests/ or the app folder: there is no suite to read');
  let cli;
  try { cli = createRequire(path.join(where.configDir, 'noop.js')).resolve('@playwright/test/cli'); } catch {
    fail(`@playwright/test is not installed next to ${where.config}; run npm install in ${path.relative(process.cwd(), where.configDir) || '.'} first`);
  }
  const r = spawnSync(process.execPath, [cli, 'test', '-c', where.config, '--list', '--reporter=json'], { cwd: where.configDir, encoding: 'utf8', maxBuffer: 64 << 20 });
  const text = r.stdout || '';
  let json;
  try { json = JSON.parse(text.slice(text.indexOf('{'))); } catch { fail(`playwright could not list the tests:\n${(r.stderr || text).trim().split('\n').slice(-5).join('\n')}`); }
  if (json.errors?.length) fail(`playwright could not list the tests (fix this first; until then no title counts):\n${json.errors.map(e => String(e.message || e).split('\n').slice(0, 4).join('\n')).join('\n')}`);
  return json;
}

async function main() {
  const args = process.argv.slice(2);
  const bad = args.find(a => a !== '--json');
  if (bad) fail(`unknown option ${bad}; usage: node tests/coverage.mjs [--json]`);
  const where = locate(path.dirname(fileURLToPath(import.meta.url)));
  const r = coverage(readPlan(where.app), testsFromList(listTests(where)));
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else console.log(format(r));
  process.exitCode = r.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();
