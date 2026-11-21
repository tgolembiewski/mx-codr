// The always-on rule file, one text (templates/mxcodr.md; with coverage on, its done sentence from
// templates/coverage-done.md; then the brain rule, templates/brain.md) in three shapes:
//   Claude Code  .claude/rules/mxcodr.md   the template as it is
//   Cursor       .cursor/rules/mxcodr.mdc  four frontmatter lines (alwaysApply) + the text
//   Codex, opencode, Pi  a block in AGENTS.md, between <!-- mxcodr:start --> and <!-- mxcodr:end -->
// Only the skills folder named in the text changes per agent. "(beside mxcli's)" is true only where
// mxcli writes its own skills (.claude/skills/, .opencode/skills/); elsewhere it is dropped.
import { liveRuleText, liveKeepTests } from './live.mjs';
import { ruleWithoutSkills, SKILLS_HEADING } from './skilloff.mjs';
import { readTemplate } from './templates.mjs';

export { readTemplate };

// The skills folder each agent reads; mxcli writes its own skills only into the first two.
export const SKILLS_DIR = { claude: '.claude/skills', opencode: '.opencode/skills', cursor: '.cursor/skills', codex: '.agents/skills', pi: '.agents/skills' };
export const AGENTS = Object.keys(SKILLS_DIR);
const MXCLI_WRITES = new Set(['.claude/skills', '.opencode/skills']);

export const START = '<!-- mxcodr:start -->', END = '<!-- mxcodr:end -->';
export const MDC_HEAD = '---\ndescription: Project rules for building this Mendix app\nalwaysApply: true\n---\n';

// The done sentence, and its coverage variant (templates/coverage-done.md): with coverage on, the agent is done
// when tests/coverage.mjs shows 0 missing instead of after a table it prints itself. Same number of lines, so the
// template part stays 25 lines and differs only in this sentence.
export const DONE_SENTENCE = /\*\*You are done only\s+when\*\*[\s\S]*?`sessions left: 0`\./;
export function withCoverageDone(text) {
  if (!DONE_SENTENCE.test(text)) throw new Error('templates/mxcodr.md no longer has the sentence **You are done only when** ... `sessions left: 0`.');
  return text.replace(DONE_SENTENCE, readTemplate('coverage-done.md').trimEnd());
}

// The brain rule (templates/brain.md): when the agent captures into the project brain, what it never does, and the
// MXCODR_PANEL=1 switch (the Studio Pro extension's panel approves; without it the person approves in the chat).
// Appended to every shape of the rule text, after the edits above, so the live edits and the skills paragraph
// (lib/live.mjs, lib/skilloff.mjs) never see it. It is read every session by every agent: keep it short.
export const BRAIN_RULE = 'brain.md';

// The rule text with `dir` (e.g. '.cursor/skills') as the skills folder; coverage: the coverage done sentence;
// live: the Studio Pro extension's live mode (lib/live.mjs), never set by the file-mode installer.
// skillsOff: skills switched off in the Studio Pro extension's Rules tab (lib/skilloff.mjs); [] changes nothing.
export function ruleText(dir, text = readTemplate('mxcodr.md'), { coverage = false, live = false, skillsOff = [] } = {}) {
  const from = '`.claude/skills/` (beside mxcli\'s)';
  if (!text.includes(from)) throw new Error('templates/mxcodr.md no longer names `.claude/skills/` (beside mxcli\'s)');
  if (coverage) text = withCoverageDone(text);
  if (live) text = liveRuleText(text);
  text = ruleWithoutSkills(text, skillsOff);
  return text.replace(from, MXCLI_WRITES.has(dir) ? `\`${dir}/\` (beside mxcli's)` : `\`${dir}/\``) + '\n' + readTemplate(BRAIN_RULE);
}

export const mdcText = (text = readTemplate('mxcodr.md'), opts = {}) => MDC_HEAD + ruleText(SKILLS_DIR.cursor, text, opts);

// The AGENTS.md block: opencode's own folder when opencode is the only AGENTS.md reader, else .agents/skills.
export function agentsBlockDir(agents) {
  const readers = agents.filter(a => ['codex', 'opencode', 'pi'].includes(a));
  if (!readers.length) return null;
  return readers.every(a => a === 'opencode') ? SKILLS_DIR.opencode : SKILLS_DIR.codex;
}

// Frontmatter as Claude Code and Cursor read it: `---\n` at byte 0 opens it, the next `\n---\n` closes it.
export function parseRule(text) {
  if (!text.startsWith('---\n')) return { frontmatter: null, body: text };
  const close = text.indexOf('\n---\n', 3);
  if (close < 0) return { frontmatter: null, body: text };
  const fm = text.slice(4, close).split('\n').filter(l => /^[A-Za-z_]+:/.test(l)).map(l => l.split(':')[0]);
  return { frontmatter: fm, body: text.slice(close + 5) };
}
export const bodyLines = body => body.split('\n').filter(l => l.trim()).length;

// The installer's own check of what it wrote. Returns the problems found (none: []).
export function checkRule(text, { mdc = false, keepTests = readTemplate('keep-tests.md') } = {}) {
  const errs = [];
  const { frontmatter, body } = parseRule(text);
  if (mdc) {
    if (!frontmatter || !frontmatter.includes('alwaysApply')) errs.push('the .mdc has no alwaysApply frontmatter');
  } else {
    if (text[0] !== '#') errs.push('the first byte is not #');
    if (frontmatter) errs.push('the file opens a frontmatter block');
  }
  if (body.split('\n').some(l => l.trim() === '---')) errs.push('a line in the body equals ---');
  if (bodyLines(body) < 10) errs.push(`the body has ${bodyLines(body)} lines`);
  // bundle 2026.11.18.2: the body opens with the project-skills section (lib/skilloff.mjs drops it when every skill
  // in it is switched off), then the keep-tests rule, its 7 lines whole; live mode (lib/live.mjs) writes the latter
  // with its last sentence pointing at `./mxcodr-live tests affected`
  const keep = [keepTests, liveKeepTests(keepTests)];
  const at = body.startsWith(SKILLS_HEADING) ? body.indexOf('\n# ') + 1 : 0;
  if (!at && body.startsWith(SKILLS_HEADING)) errs.push('the project-skills section is not followed by the keep-tests rule');
  else if (!keep.some(k => body.startsWith(k, at))) errs.push(`the keep-tests rule (7 lines) does not ${at ? 'follow the project-skills section' : 'open the body'}`);
  return errs;
}
