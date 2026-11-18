// Switched-off skills (the Studio Pro extension's Rules tab): the rule texts without what points at them. A skill
// switched off lives in .mxcodr/skills-off/<name>/ instead of the agent's skills folder (an agent only finds skills
// there), and the always-on rule file and the live rule file no longer name it. With no skill switched off every
// function here returns its input unchanged, so the file-mode installer (which never switches one off) writes
// byte for byte what it did.
import { INSTALLED_SKILLS, OPTIONAL_SKILLS } from './skills.mjs';

// Our skills: the only ones that can be switched off (never mxcli's own). A function: skills.mjs imports rules.mjs,
// which imports this file, so the lists are read when called, not when this module loads.
export const switchable = () => [...INSTALLED_SKILLS, ...OPTIONAL_SKILLS];
export const SKILLS_OFF_DIR = '.mxcodr/skills-off';
export const offList = list => [...new Set((Array.isArray(list) ? list : []).filter(s => switchable().includes(s)))];

// templates/mxcodr.md's paragraph naming each skill and what it is for: "...read its project skill in <dir>: `a`
// what; `b` what; ... `f` what. Read each of these skills whole, ...; of mxcli's own skills ... you need."
const LIST = /Before building a part, read its project skill in (`[^`]+`(?: \(beside mxcli's\))?): ([\s\S]*?)\. Read each of these skills whole, one file per read, never through `head`, `cut` or a combined `cat`; of mxcli's/;

// Re-wraps one paragraph's text at `width` columns.
const wrap = (text, width = 104) => {
  const out = []; let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > width) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.join('\n');
};

// templates/mxcodr.md's sentence pointing at app-docs (the end-of-turn update of docs/app-docs.html)
export const DOCS_SENTENCE = ' Once `docs/app-docs.html` exists, update it with the `app-docs` skill at the end of every turn that changed the model, before you report.';

/** The always-on rule text without the switched-off skills: their items leave the paragraph naming the skills (the
 * paragraph goes when none is left, keeping what it says about mxcli's own skills); the coverage done sentence's
 * "record them first, skill `requirements-interview`" goes with that skill. */
export function ruleWithoutSkills(text, off = []) {
  off = offList(off);
  if (!off.length) return text;
  const m = LIST.exec(text);
  if (!m) throw new Error('templates/mxcodr.md no longer has the paragraph naming the project skills ("Before building a part, ...")');
  const items = m[2].replace(/\s+/g, ' ').split('; ').filter(it => !off.includes((/^`([^`]+)`/.exec(it) ?? [])[1]));
  const start = text.lastIndexOf('\n', m.index) + 1;
  const tail = text.slice(m.index + m[0].length); // " own skills in ..." up to the end
  const end = m.index + m[0].length + tail.indexOf('\n');
  const rest = text.slice(m.index + m[0].length, end); // the rest of that last line
  const para = items.length
    ? `Before building a part, read its project skill in ${m[1]}: ${items.join('; ')}. Read each of these skills whole, one file per read, never through \`head\`, \`cut\` or a combined \`cat\`; of mxcli's${rest}`
    : `Of mxcli's${rest}`;
  let out = text.slice(0, start) + wrap(para) + text.slice(end);
  if (off.includes('requirements-interview')) out = out.replace('; record them first, skill `requirements-interview`)', ')');
  if (off.includes('app-docs')) out = out.replace(DOCS_SENTENCE, '');
  return out;
}

/** The live rule file (templates/live.md) without the switched-off skills: the films bullet goes with film-tests,
 * "as the `durable-tests` skill says" with durable-tests. */
export function liveRuleWithoutSkills(text, off = []) {
  off = offList(off);
  if (!off.length) return text;
  let out = text;
  if (off.includes('film-tests')) out = out.replace(/^- A film of a test, only when the person asks for one \(the `film-tests` skill\):[\s\S]*?(?=^- )/m, '');
  if (off.includes('durable-tests')) out = out.replace(' as the `durable-tests` skill says (', ' (');
  return out;
}
