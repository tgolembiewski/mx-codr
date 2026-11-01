// The always-on rule file, one text (templates/mxcodr.md) in three shapes:
//   Claude Code  .claude/rules/mxcodr.md   the template as it is
//   Cursor       .cursor/rules/mxcodr.mdc  four frontmatter lines (alwaysApply) + the text
//   Codex, opencode, Pi  a block in AGENTS.md, between <!-- mxcodr:start --> and <!-- mxcodr:end -->
// Only the skills folder named in the text changes per agent. "(beside mxcli's)" is true only where
// mxcli writes its own skills (.claude/skills/, .opencode/skills/); elsewhere it is dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const templates = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
export const readTemplate = name => fs.readFileSync(path.join(templates, name), 'utf8');

// The skills folder each agent reads; mxcli writes its own skills only into the first two.
export const SKILLS_DIR = { claude: '.claude/skills', opencode: '.opencode/skills', cursor: '.cursor/skills', codex: '.agents/skills', pi: '.agents/skills' };
export const AGENTS = Object.keys(SKILLS_DIR);
const MXCLI_WRITES = new Set(['.claude/skills', '.opencode/skills']);

export const START = '<!-- mxcodr:start -->', END = '<!-- mxcodr:end -->';
export const MDC_HEAD = '---\ndescription: Project rules for building this Mendix app\nalwaysApply: true\n---\n';

// The rule text with `dir` (e.g. '.cursor/skills') as the skills folder.
export function ruleText(dir, text = readTemplate('mxcodr.md')) {
  const from = '`.claude/skills/` (beside mxcli\'s)';
  if (!text.includes(from)) throw new Error('templates/mxcodr.md no longer names `.claude/skills/` (beside mxcli\'s)');
  return text.replace(from, MXCLI_WRITES.has(dir) ? `\`${dir}/\` (beside mxcli's)` : `\`${dir}/\``);
}

export const mdcText = (text = readTemplate('mxcodr.md')) => MDC_HEAD + ruleText(SKILLS_DIR.cursor, text);

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
  const first7 = body.split('\n').slice(0, 7).join('\n') + '\n';
  if (first7 !== keepTests) errs.push('the first 7 lines of the body are not the keep-tests rule');
  return errs;
}
