import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLED_SKILLS, OPTIONAL_SKILLS, RETIRED_SKILLS, durableTestsForCoverage } from '../overlay/lib/skills.mjs';

const dir = fileURLToPath(new URL('../overlay/skills/', import.meta.url));
const files = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? files(path.join(d, e.name), out) : out.push(path.join(d, e.name)); return out; };
const all = files(dir);
const rel = f => path.relative(dir, f);

// The gate is gone: no skill may send the agent to a verdict, a gate script or a scenario DSL.
// `\bgate\b` keeps "navigate" and "aggregate"; `verify-` spares mxcli's own verify-with-oql skill.
const GATE_WORDS = /\bgates?\b|mxgate|\.mxgate|\.mxcodr|tests\/(orient|peek|lib|gate|film\.sh|rulebook|checks)|scenario\(|verify-(?!with-oql)|# covers|rulebook|--only\b|journey:/i;
// A script beside a skill (run, never read as advice) may keep its data in the app's .mxcodr/ folder, as the
// installer does (module-structure/marketplace-check.mjs: its baseline, owner decision 2026-11-17); the skill texts may not.
const scriptPaths = (file, line) => (file.endsWith('.mjs') ? line.replace(/\.mxcodr\//g, '') : line);
const VERDICT = /\bDONE\b/; // the gate's verdict word, in capitals
// The card codes moved into prose; mxcli's own lint rule names (SEC001, CONV011 ...) and Studio Pro's CE codes may stay.
const CODE = /\b(?!(?:CE|SEC|CONV|MPR|QUAL|ARCH|DESIGN|MOD|REU|UI|CUSTOM)\d)[A-Z]{2,10}\d{2,3}\b/;

test('the bundle holds the planned skills; requirements-interview installed always since 2026.11.14.2, app-docs since 2026.11.15', () => {
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, [...INSTALLED_SKILLS, ...OPTIONAL_SKILLS].sort());
  assert.deepEqual([...INSTALLED_SKILLS].sort(), ['app-security', 'durable-tests', 'files-and-images', 'module-structure', 'naming-and-captions', 'reuse-and-snippets', 'spacing-and-layout', 'film-tests', 'java-action-docs', 'requirements-interview', 'app-docs'].sort());
  assert.deepEqual(OPTIONAL_SKILLS, []);
  assert.ok(!names.includes('test-first-delivery'));
  // film-tests came back in 2026.11.01.16 on the v2 kit: installed, never removed as retired
  assert.deepEqual(RETIRED_SKILLS, ['test-first-delivery']);
});

test('skills-clean: no gate vocabulary and no card codes in any installed file', () => {
  for (const f of all) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      assert.doesNotMatch(scriptPaths(f, line), GATE_WORDS, `${rel(f)}:${i + 1}: ${line.trim()}`);
      assert.doesNotMatch(line, VERDICT, `${rel(f)}:${i + 1}: ${line.trim()}`);
      assert.doesNotMatch(line, CODE, `${rel(f)}:${i + 1}: a card code: ${line.trim()}`);
    });
  }
});

test('every SKILL.md has frontmatter name (= its folder) and description, and a body; size caps hold', () => {
  for (const f of all) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.trimEnd().split('\n').length;
    if (path.basename(f) === 'SKILL.md') {
      const m = text.match(/^---\nname: ([\w-]+)\ndescription: (.+)\n---\n([\s\S]*)$/);
      assert.ok(m, `${rel(f)}: frontmatter name + description`);
      assert.equal(m[1], path.basename(path.dirname(f)));
      assert.ok(m[2].length > 80, `${rel(f)}: a description that names its trigger`);
      assert.match(m[2], /\bUse (before|when|after)\b/, `${rel(f)}: the description says when to use it`);
      assert.ok(m[3].trim().length > 500, `${rel(f)}: a body`);
      assert.ok(lines <= 300, `${rel(f)}: ${lines} lines, the cap is 300`);
    } else if (path.basename(f) === 'template.html') {
      // app-docs' page skeleton (2026-11-15): copied whole into the app and filled in, never read in parts; its CSS
      // and the two scripts the panel runs make it longer than a reference file, so its own cap
      assert.ok(lines <= 200, `${rel(f)}: ${lines} lines, the cap for a page template is 200`);
    } else {
      assert.ok(lines <= 150, `${rel(f)}: ${lines} lines, the cap for a reference file is 150`);
    }
  }
});

test('the rule file names only skills the bundle installs', () => {
  const rule = fs.readFileSync(new URL('../overlay/templates/mxcodr.md', import.meta.url), 'utf8');
  for (const m of rule.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) assert.ok(INSTALLED_SKILLS.includes(m[1]), m[1]);
});

test('durable-tests with coverage on: step 1 replaced, nothing else; skills-clean holds; the plain file is untouched by the swap', () => {
  const f = path.join(dir, 'durable-tests', 'SKILL.md');
  const plain = fs.readFileSync(f, 'utf8');
  const cov = durableTestsForCoverage(plain);
  const step = fs.readFileSync(new URL('../overlay/templates/coverage-durable-tests.md', import.meta.url), 'utf8');
  assert.ok(cov.includes(step));
  assert.doesNotMatch(cov, /Print a table `requirement -> test/);
  assert.equal(cov.replace(step, ''), plain.replace(/^1\. \*\*Close the suite against the request\.\*\*[\s\S]*?\(allowed and refused\)\.\n/m, ''));
  cov.split('\n').forEach((line, i) => {
    assert.doesNotMatch(line, GATE_WORDS, `coverage durable-tests:${i + 1}`);
    assert.doesNotMatch(line, VERDICT, `coverage durable-tests:${i + 1}`);
    assert.doesNotMatch(line, CODE, `coverage durable-tests:${i + 1}`);
  });
  assert.ok(cov.trimEnd().split('\n').length <= 300);
  assert.throws(() => durableTestsForCoverage('# no step 1\n'), /no longer has step 1/);
});

test('requirements-interview: numbered captures, promoted by the agent itself in the same turn, slices by area', () => {
  const t = fs.readFileSync(path.join(dir, 'requirements-interview', 'SKILL.md'), 'utf8');
  assert.match(t, /Promote them yourself in the same turn; nobody will\./);
  assert.match(t, /brain capture "R12 /);
  assert.match(t, /--slice 01-invoices/);
  assert.match(t, /continues after the highest number already in `docs\/brain\/plan\/`/);
  assert.match(t, /\(dropped: <the reason>\)/);
  assert.match(t, /`\.\/mxcli brain promote <id> -p <app>\.mpr && \.\/mxcli brain promote <id>/, 'promote takes one id: chained');
  assert.doesNotMatch(t, /brain promote <id> <id>/);
  assert.match(t, /node tests\/coverage\.mjs/);
});
