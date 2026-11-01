// The starter test kit the installer copies into tests/ (overlay/templates/tests/): generic for any Mendix
// app, every export documented by the Mendix fact it relies on, and the names the durable-tests skill lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../overlay/templates/tests/${p}`, import.meta.url), 'utf8');
const KIT = ['mx.ts', 'mx.teardown.ts', 'playwright.config.ts', 'package.json'];
export const EXPORTS = ['test', 'expect', 'env', 'PASSWORD', 'BASE', 'oql', 'sessionsLeft', 'signIn', 'signOut', 'apiContext', 'marker', 'rowOf', 'cell',
  'filterGrid', 'pickCombo', 'fillInput', 'dialogText', 'dismissDialog', 'menuItems', 'Operation', 'captureOperation', 'forgeOperation', 'retrieveByIds'];
// so2's app vocabulary, and any demo user or module name: none of it belongs in a kit for any app
const APP_WORDS = /\bSales\.|\bOrders?\b|\bInvoices?\b|\bCustomers?\b|\bProducts?\b|demo_|b2bfull|\bShop\b|\bUSERS\b|\bHOME\b/;

test('the kit is four files: mx.ts, its teardown, a config that names the teardown and a package.json pinning Playwright', () => {
  assert.deepEqual(fs.readdirSync(new URL('../overlay/templates/tests/', import.meta.url)).sort(), [...KIT].sort());
  const cfg = read('playwright.config.ts');
  assert.match(cfg, /globalTeardown: '\.\/mx\.teardown\.ts'/);
  assert.match(cfg, /workers: 1,/);
  assert.match(cfg, /fullyParallel: false/);
  assert.match(cfg, /expect: \{ timeout: 15_000 \}/);
  assert.match(cfg, /actionTimeout: 20_000/);
  assert.match(read('mx.teardown.ts'), /sessions left: \$\{n\}/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.devDependencies['@playwright/test'], '1.64.1', 'exact pin: 1.64.1 has --shuffle');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, undefined, 'CommonJS: mx.ts relies on __dirname');
});

test('mx.ts exports the helpers the durable-tests skill lists, and nothing else', () => {
  const names = [...read('mx.ts').matchAll(/^export (?:(?:async function|function|const|type) (\w+)|\{ (\w+) \})/gm)].map(m => m[1] ?? m[2]);
  assert.deepEqual([...names].sort(), [...EXPORTS].sort());
  const skill = fs.readFileSync(new URL('../overlay/skills/durable-tests/SKILL.md', import.meta.url), 'utf8');
  for (const n of EXPORTS.filter(n => n !== 'Operation')) assert.match(skill, new RegExp(`\`${n}\\b`), `durable-tests names ${n}`);
});

test('every export carries a comment on the line before it (the Mendix fact it encodes)', () => {
  const lines = read('mx.ts').split('\n');
  lines.forEach((l, i) => { if (/^export /.test(l)) assert.match(lines[i - 1], /^\/\/ \S/, `mx.ts:${i + 1}: ${l}`); });
});

test('no app vocabulary in the kit: no module, entity, page or user names; the .mpr is found, not named', () => {
  for (const f of KIT) read(f).split('\n').forEach((l, i) => assert.doesNotMatch(l, APP_WORDS, `${f}:${i + 1}: ${l.trim()}`));
  const mx = read('mx.ts');
  assert.doesNotMatch(mx, /['"`][\w-]+\.mpr['"`]/, 'no .mpr file name in the source');
  assert.match(mx, /readdirSync\(APP\)\.filter\(f => f\.endsWith\('\.mpr'\)\)/);
  assert.match(mx, /'--json'/);
});

test('signIn waits 20 s for the home marker or "Sign in failed", and its failure names the sessions alive', () => {
  const mx = read('mx.ts');
  assert.match(mx, /expect\(home\.or\(failed\)\)\.toBeVisible\(\{ timeout: 20_000 \}\)/);
  assert.match(mx, /getByText\('Sign in failed'\)/);
  assert.match(mx, /did not complete in 20 s'\}; \$\{alive\} sessions alive on the server/);
  assert.doesNotMatch(mx, /45_000/);
});

test('signOut never returns silently on a missing token, and a leak names the test and the users', () => {
  const mx = read('mx.ts');
  assert.doesNotMatch(mx, /if \(!token\) return;/);
  assert.match(mx, /throw new Error\(`signOut: could not end the session of the page at \$\{page\.url\(\)\}/);
  assert.match(mx, /data: \{ action: 'logout', params: \{\} \}/, 'logout without params answers 560');
  assert.match(mx, /'x-csrf-token': token/, 'logout without the token answers 200 and keeps the session');
  assert.match(mx, /export const test = base\.extend<\{ sessionCheck: void \}>/);
  assert.match(mx, /\{ auto: true \}/);
  assert.match(mx, /left \$\{extra\.length\} session\(s\) alive on the server, user\(s\): \$\{users\}/);
  assert.match(mx, /"\$\{testInfo\.title\}"/);
  assert.doesNotMatch(mx, /Name != |Name <> |not in \(/, 'no session check ignores a user');
  const td = read('mx.teardown.ts');
  assert.match(td, /sessions left after the run, user\(s\): \$\{users\}/);
  assert.doesNotMatch(td, /Name != |Name <> /);
});
