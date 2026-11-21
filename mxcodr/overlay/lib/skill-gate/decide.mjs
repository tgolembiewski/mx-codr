// Part of the skill gate (lib/skill-gate.mjs, whose header says what it does; the file-mode installer copies it to
// .mxcodr/skill-gate.mjs and this folder to .mxcodr/skill-gate/). Self-contained: node: modules and its own parts only.
// Here: Claude Code's decision. The skills the app has, the deny message, and decide.
import fs from 'node:fs';
import path from 'node:path';
import { skillsForCall } from './needs.mjs';
import { readSkills, stateDir } from './reads.mjs';
import { GATED } from './common.mjs';

// ---- the decision ---------------------------------------------------------------------------------------------------

/** The skills the app has in one of `dirs` (only those can be asked for). */
export const presentSkills = (root, dirs = ['.claude/skills']) => Object.keys(GATED).filter(s => dirs.some(d => fs.existsSync(path.join(root, d, s, 'SKILL.md'))));

export function denyMessage(missing, root, tool) {
  const what = tool === 'Bash' || tool === 'PowerShell' ? 'This model change' : 'This test file';
  return `mx-codr skill gate: ${what} needs the project skill${missing.length > 1 ? 's' : ''} below, not read yet in this session. `
    + 'Read each file whole with the Read tool (no offset or limit, one file per read, never cat or head), '
    + `then check your ${what === 'This model change' ? 'script' : 'test'} against ${missing.length > 1 ? 'them' : 'it'} and run the same call again:\n`
    + missing.map(s => `  ${path.join(root, '.claude', 'skills', s, 'SKILL.md')}  (${GATED[s]})`).join('\n')
    + "\nThese project skills come before `./mxcli syntax` and before mxcli's own skills in .ai-context/skills/.";
}

/** -> null (let it run) or the deny reason. */
export function decide(e, { root = e?.cwd, env = process.env } = {}) {
  if (env.MXCODR_SKILL_GATE === '0' || !root) return null;
  const need = skillsForCall(e, root);
  if (!need.length) return null;
  const have = new Set(presentSkills(root));
  const read = new Set(readSkills(root, e?.session_id));
  const missing = need.filter(s => have.has(s) && !read.has(s));
  if (!missing.length) return null;
  // a read could not be recorded here (a link, a read-only folder): never refuse what reading cannot unlock
  try { stateDir(root); } catch { return null; }
  return denyMessage(missing, root, e?.tool_name);
}
