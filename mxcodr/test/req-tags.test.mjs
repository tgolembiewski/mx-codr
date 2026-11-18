// The requirement tag rule (bundle 2026.11.16.3): durable-tests tells the agent to put `[R<n>]` in the title of a
// test that checks a numbered requirement, so the Studio Pro extension's Brain tab shows the test under it. Present in
// every install shape (file, coverage on, live). That its examples parse with the extension's reader is proven on the
// extension's side (spikes/studio-pro-ext/translator/test/brain.test.mjs), which already imports the bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copySkills } from '../overlay/install.mjs';

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-reqtag-')); fs.writeFileSync(path.join(d, 'App.mpr'), 'mpr'); return d; };

for (const [name, opts] of [['file', {}], ['coverage on', { coverage: true }], ['live', { live: true }], ['live, coverage on', { live: true, coverage: true }]]) {
  test(`requirement tag rule in the installed durable-tests (${name}), once`, () => {
    const d = tmp();
    copySkills(d, ['claude'], undefined, opts);
    const t = fs.readFileSync(path.join(d, '.claude/skills/durable-tests/SKILL.md'), 'utf8');
    const setup = t.slice(t.indexOf('## Setup'), t.indexOf('\n## ', t.indexOf('## Setup') + 1));
    assert.match(setup, /A test that checks a numbered requirement carries its tag `\[R<n>\]` in its title/);
    assert.match(setup, /`test\('\[R3\] a player can ask for a hint', \.\.\.\)`/);
    assert.match(setup, /`@test \[R3\] a hint names one right colour`/);
    assert.match(setup, /No numbered requirement, no tag\./);
    assert.match(setup, /never retag the others\./);
    assert.match(setup, /grep by the words after the tag\./);
    assert.equal(t.split('carries its tag `[R<n>]`').length, 2, 'the rule is stated once');
    fs.rmSync(d, { recursive: true, force: true });
  });
}
