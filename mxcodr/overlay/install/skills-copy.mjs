// The installer (overlay/install.mjs), section 5: our skills, beside mxcli's.
import fs from 'node:fs';
import path from 'node:path';
import { SKILLS_DIR } from '../lib/rules.mjs';
import { INSTALLED_SKILLS, OPTIONAL_SKILLS, RETIRED_SKILLS, skillsFor, durableTestsForCoverage } from '../lib/skills.mjs';
import { liveSkills } from '../lib/live.mjs';
import { offList, SKILLS_OFF_DIR } from '../lib/skilloff.mjs';
import { OVERLAY } from './common.mjs';

// ---- 5. our skills, beside mxcli's ----------------------------------------------------------------

// Every folder an agent reads skills from, plus .ai-context/skills where v1 also put ours.
const ALL_SKILL_DIRS = [...new Set([...Object.values(SKILLS_DIR), '.ai-context/skills'])];
const OURS = [...INSTALLED_SKILLS, ...OPTIONAL_SKILLS, ...RETIRED_SKILLS];

// Removes every skill of ours from every skills folder (mxcli ships none of these names), then copies
// the installed ones into each chosen agent's folder. coverage: requirements-interview too, and durable-tests'
// first finishing step points at tests/coverage.mjs (lib/skills.mjs). Returns the lines to print.
// live: the live edits of lib/live.mjs on the copies (the Studio Pro extension; never the file-mode installer).
// skillsOff: skills switched off in the extension's Rules tab: written to .mxcodr/skills-off/<name>/ (this bundle's
// text, so switching one on again gives the current version) instead of an agent's folder; [] = as always.
export function copySkills(app, agents, src = path.join(OVERLAY, 'skills'), { coverage = false, live = false, skillsOff = [] } = {}) {
  const out = [];
  const off = offList(skillsOff);
  const all = skillsFor({ coverage });
  const skills = all.filter(s => !off.includes(s));
  if (off.length || fs.existsSync(path.join(app, SKILLS_OFF_DIR))) {
    fs.rmSync(path.join(app, SKILLS_OFF_DIR), { recursive: true, force: true });
    for (const s of all.filter(x => off.includes(x))) {
      fs.cpSync(path.join(src, s), path.join(app, SKILLS_OFF_DIR, s), { recursive: true });
      if (live) liveSkills(path.join(app, SKILLS_OFF_DIR), [s]);
    }
    if (off.length) out.push(`${off.length} skills switched off -> ${SKILLS_OFF_DIR}/`);
  }
  for (const d of ALL_SKILL_DIRS) for (const s of OURS) fs.rmSync(path.join(app, d, s), { recursive: true, force: true });
  const dirs = [...new Set(agents.map(a => SKILLS_DIR[a]))];
  for (const d of dirs) {
    for (const s of skills) fs.cpSync(path.join(src, s), path.join(app, d, s), { recursive: true });
    if (coverage) {
      const f = path.join(app, d, 'durable-tests', 'SKILL.md');
      fs.writeFileSync(f, durableTestsForCoverage(fs.readFileSync(f, 'utf8')));
    }
    if (live) liveSkills(path.join(app, d), skills);
    out.push(`${skills.length} skills -> ${d}/`);
  }
  return out;
}
