// The installer (overlay/install.mjs), section 4: the always-on rule file, one copy per agent, and the markers of
// AGENTS.md (ours, mxcli's section, the extension's Plan first).
import fs from 'node:fs';
import path from 'node:path';
import { readTemplate, ruleText, mdcText, agentsBlockDir, checkRule, SKILLS_DIR, START, END } from '../lib/rules.mjs';
import { LIVE_RULE_FILE } from '../lib/live.mjs';
import { liveRuleWithoutSkills } from '../lib/skilloff.mjs';
import { rmIf } from './common.mjs';

// ---- 4. the always-on rule file, one copy per agent --------------------------------------------------

const RULE_FILES = { claude: '.claude/rules/mxcodr.md', cursor: '.cursor/rules/mxcodr.mdc' };

// Writes the rule file for each agent and checks what it wrote; removes our copy for agents not chosen.
// coverage: the done sentence of the coverage variant (lib/rules.mjs). Returns the lines to print. Throws when a
// written file fails the format check.
// live: the Studio Pro extension's live mode (lib/live.mjs): the live edits, and .claude/rules/mxcodr-live.md.
// skillsOff: skills switched off in the extension's Rules tab (lib/skilloff.mjs): the texts leave them out; [] =
// what it always wrote.
export function writeRules(app, agents, { coverage = false, live = false, skillsOff = [] } = {}) {
  const out = [];
  const text = readTemplate('mxcodr.md');
  const write = (rel, body, mdc) => {
    const f = path.join(app, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    const errs = checkRule(fs.readFileSync(f, 'utf8'), { mdc });
    if (errs.length) throw new Error(`${rel}: ${errs.join('; ')}`);
    out.push(`rule file -> ${rel}`);
  };
  if (agents.includes('claude')) write(RULE_FILES.claude, ruleText(SKILLS_DIR.claude, text, { coverage, live, skillsOff }), false);
  else rmIf(app, RULE_FILES.claude, out);
  if (live && agents.includes('claude')) {
    const f = path.join(app, LIVE_RULE_FILE);
    fs.writeFileSync(f, liveRuleWithoutSkills(readTemplate('live.md'), skillsOff));
    out.push(`rule file -> ${LIVE_RULE_FILE}`);
  }
  if (agents.includes('cursor')) write(RULE_FILES.cursor, mdcText(text, { coverage, live, skillsOff }), true);
  else rmIf(app, RULE_FILES.cursor, out);
  const agentsMd = path.join(app, 'AGENTS.md');
  const dir = agentsBlockDir(agents);
  let old = fs.existsSync(agentsMd) ? fs.readFileSync(agentsMd, 'utf8') : '';
  if (dir) {
    const block = ruleText(dir, text, { coverage, live, skillsOff });
    const errs = checkRule(block);
    if (errs.length) throw new Error(`AGENTS.md block: ${errs.join('; ')}`);
    // `mxcli init` regenerates an AGENTS.md without its markers whole, and keeps what lies outside them:
    // with no mxcli section here our block would be lost on the next init, so its (empty) markers go first
    if (!old.includes(MXCLI_BEGIN)) {
      old = withMxcliSection(old);
      out.push(`AGENTS.md had no mxcli section; wrote its markers first, so mxcli init keeps our block${fs.existsSync(agentsMd) ? ' and the text already there' : ''}`);
    }
    fs.writeFileSync(agentsMd, fenceText(old, block));
    out.push(`rule text -> AGENTS.md (between ${START} and ${END}, skills in ${dir}/)`);
  } else if (old.includes(START)) {
    fs.writeFileSync(agentsMd, unfence(old, START, END));
    out.push('removed our block from AGENTS.md (no agent that reads it was chosen)');
  }
  return out;
}

// The extension's "Plan first" block in AGENTS.md (translator/src/permissions.mjs, PLAN_START/PLAN_END; bundle
// 2026.11.18.3): generated like our block, so an AGENTS.md with nothing else of the person's still counts as mxcli's.
export const PLAN_START = '<!-- mxcodr-plan:start -->', PLAN_END = '<!-- mxcodr-plan:end -->';

// mxcli's section of AGENTS.md: `mxcli init` replaces what lies between these markers and keeps the rest;
// `mxcli init --sync-skills` fills an empty pair. Put first, before any text the file already had.
export const MXCLI_BEGIN = '<!-- mxcli:begin', MXCLI_END = '<!-- mxcli:end -->';
export const withMxcliSection = old => `${MXCLI_BEGIN} -->\n${MXCLI_END}\n` + (old.trim() ? '\n' + old.trimStart() : '');

// Our block in AGENTS.md, between markers; replaced in place, appended after mxcli's section when missing.
export function fenceText(old, block, start = START, end = END) {
  const body = `${start}\n${block.trimEnd()}\n${end}`;
  const a = old.indexOf(start), b = old.indexOf(end);
  if (a >= 0 && b > a) return old.slice(0, a) + body + old.slice(b + end.length);
  return (old.trimEnd() ? old.trimEnd() + '\n\n' : '') + body + '\n';
}
export function unfence(old, start, end) {
  const a = old.indexOf(start), b = old.indexOf(end);
  if (a < 0 || b < a) return old;
  const rest = (old.slice(0, a).trimEnd() + '\n\n' + old.slice(b + end.length).trimStart()).trim();
  return rest ? rest + '\n' : '';
}
