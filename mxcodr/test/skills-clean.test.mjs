import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLED_SKILLS, OPTIONAL_SKILLS } from '../overlay/lib/skills.mjs';

const dir = fileURLToPath(new URL('../overlay/skills/', import.meta.url));
const files = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? files(path.join(d, e.name), out) : out.push(path.join(d, e.name)); return out; };
const all = files(dir);
const rel = f => path.relative(dir, f);

// The gate is gone: no skill may send the agent to a verdict, a gate script or a scenario DSL.
// `\bgate\b` keeps "navigate" and "aggregate"; `verify-` spares mxcli's own verify-with-oql skill.
const GATE_WORDS = /\bgates?\b|mxgate|\.mxgate|\.mxcodr|tests\/(orient|peek|lib|gate|film|rulebook|checks)|scenario\(|verify-(?!with-oql)|# covers|rulebook|--only\b|journey:/i;
const VERDICT = /\bDONE\b/; // the gate's verdict word, in capitals
// The card codes moved into prose; mxcli's own lint rule names (SEC001, CONV011 ...) and Studio Pro's CE codes may stay.
const CODE = /\b(?!(?:CE|SEC|CONV|MPR|QUAL|ARCH|DESIGN|MOD|REU|UI|CUSTOM)\d)[A-Z]{2,10}\d{2,3}\b/;

test('the bundle holds the planned skills; requirements-interview is in the repo but not installed by default', () => {
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, [...INSTALLED_SKILLS, ...OPTIONAL_SKILLS].sort());
  assert.deepEqual([...INSTALLED_SKILLS].sort(), ['app-security', 'durable-tests', 'files-and-images', 'module-structure', 'naming-and-captions', 'reuse-and-snippets', 'spacing-and-layout']);
  assert.deepEqual(OPTIONAL_SKILLS, ['requirements-interview']);
  for (const gone of ['test-first-delivery', 'film-tests']) assert.ok(!names.includes(gone), gone);
});

test('skills-clean: no gate vocabulary and no card codes in any installed file', () => {
  for (const f of all) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      assert.doesNotMatch(line, GATE_WORDS, `${rel(f)}:${i + 1}: ${line.trim()}`);
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
    } else {
      assert.ok(lines <= 150, `${rel(f)}: ${lines} lines, the cap for a reference file is 150`);
    }
  }
});

test('the rule file names only skills the bundle installs', () => {
  const rule = fs.readFileSync(new URL('../overlay/templates/mxcodr.md', import.meta.url), 'utf8');
  for (const m of rule.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) assert.ok(INSTALLED_SKILLS.includes(m[1]), m[1]);
});
