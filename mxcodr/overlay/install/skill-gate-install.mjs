// The installer (overlay/install.mjs), section 5a: the skill gate (Claude Code only).
import fs from 'node:fs';
import path from 'node:path';
import { withGateHooks, withoutGateHooks } from '../lib/skill-gate.mjs';
import { OVERLAY, FOOTPRINT, copyParts } from './common.mjs';

// ---- 5a. the skill gate (Claude Code only) -------------------------------------------------------------------

export const SKILL_GATE = `${FOOTPRINT}/skill-gate.mjs`;
// bundle 2026.11.21.3: its parts (lib/skill-gate/, beside the script), copied to .mxcodr/skill-gate/ and removed with it
const SKILL_GATE_PARTS = `${FOOTPRINT}/skill-gate`;

/** Claude Code's skill gate (lib/skill-gate.mjs): the script copied to .mxcodr/skill-gate.mjs (its parts to
 * .mxcodr/skill-gate/) and its two hooks in .claude/settings.local.json (mxcli init overwrites settings.json, never
 * this file), in place of earlier ones; the person's own settings stay. Without Claude Code among the agents both go.
 * -> what it wrote, or null. */
export function installSkillGate(app, agents, src = path.join(OVERLAY, 'lib', 'skill-gate.mjs')) {
  const f = path.join(app, '.claude', 'settings.local.json');
  let cfg = null;
  if (fs.existsSync(f)) { try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { throw new Error(`${f} is not valid JSON; fix it, then install again`); } }
  if (!agents.includes('claude')) {
    fs.rmSync(path.join(app, SKILL_GATE), { force: true });
    fs.rmSync(path.join(app, SKILL_GATE_PARTS), { recursive: true, force: true });
    if (cfg) { const before = JSON.stringify(cfg); withoutGateHooks(cfg); if (JSON.stringify(cfg) !== before) fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n'); }
    return null;
  }
  fs.mkdirSync(path.join(app, FOOTPRINT), { recursive: true });
  copyParts(path.join(path.dirname(src), 'skill-gate'), path.join(app, SKILL_GATE_PARTS));
  fs.copyFileSync(src, path.join(app, SKILL_GATE));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(withGateHooks(cfg ?? {}), null, 2) + '\n');
  return `${SKILL_GATE} (hooks in .claude/settings.local.json)`;
}
