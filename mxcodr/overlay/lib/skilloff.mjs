// Switched-off skills (the Studio Pro extension's Rules tab): the rule texts without what points at them. A skill
// switched off lives in .mxcodr/skills-off/<name>/ instead of the agent's skills folder (an agent only finds skills
// there), and the always-on rule file and the live rule file no longer name it. With no skill switched off every
// function here returns its input unchanged, so the file-mode installer (which never switches one off) writes
// byte for byte what it did.
import { INSTALLED_SKILLS, OPTIONAL_SKILLS } from './skills.mjs';

// Our skills: the only ones that can be switched off (never mxcli's own). A function: skills.mjs imported rules.mjs,
// which imports this file, so the lists are read when called, not when this module loads (round 2 of the readability
// refactor broke that cycle: skills.mjs reads templates through templates.mjs; the function stays, an export's kind).
export const switchable = () => [...INSTALLED_SKILLS, ...OPTIONAL_SKILLS];
export const SKILLS_OFF_DIR = '.mxcodr/skills-off';
export const offList = list => [...new Set((Array.isArray(list) ? list : []).filter(s => switchable().includes(s)))];

// templates/mxcodr.md's first section (bundle 2026.11.18.2): its heading, then one list line per skill,
// "- `name`: before ...". A switched-off skill's line goes; with none left the whole section goes (up to the next heading).
export const SKILLS_HEADING = '# Read the project skill before you build its part\n';
const ITEM = /^- `([a-z]+(?:-[a-z]+)*)`: .*\n/gm;

// templates/mxcodr.md's sentence pointing at app-docs (the end-of-turn update of docs/app-docs.html)
export const DOCS_SENTENCE = ' Once `docs/app-docs.html` exists, update it with the `app-docs` skill at the end of every turn that changed the model, before you report.';

/** The always-on rule text without the switched-off skills: their lines leave the section naming the skills (the
 * section goes when none is left); the coverage done sentence's "record them first, skill `requirements-interview`"
 * goes with that skill, the app-docs sentence with app-docs. */
export function ruleWithoutSkills(text, off = []) {
  off = offList(off);
  if (!off.length) return text;
  const at = text.indexOf(SKILLS_HEADING);
  if (at < 0) throw new Error('templates/mxcodr.md no longer has the section naming the project skills ("# Read the project skill ...")');
  const next = text.indexOf('\n# ', at + SKILLS_HEADING.length);
  const sectionEnd = next < 0 ? text.length : next + 1;
  const section = text.slice(at, sectionEnd);
  const kept = section.replace(ITEM, (line, name) => (off.includes(name) ? '' : line));
  let out = text.slice(0, at) + ([...kept.matchAll(ITEM)].length ? kept : '') + text.slice(sectionEnd);
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
