// Live mode (the Studio Pro extension): skills switched off in the Rules tab (lib/skilloff.mjs) leave the rule texts
// and wait in .mxcodr/skills-off/. The other live texts: live.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeRules, copySkills } from '../overlay/install.mjs';
import { ruleText, checkRule, readTemplate } from '../overlay/lib/rules.mjs';
import { LIVE_RULE_FILE } from '../overlay/lib/live.mjs';
import { tmp } from './live-fixture.mjs';

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
