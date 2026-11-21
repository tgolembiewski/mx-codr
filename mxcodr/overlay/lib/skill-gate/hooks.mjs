// Part of the skill gate (lib/skill-gate.mjs, whose header says what it does; the file-mode installer copies it to
// .mxcodr/skill-gate.mjs and this folder to .mxcodr/skill-gate/). Self-contained: node: modules and its own parts only.
// Here: the hooks' registration in .claude/settings.local.json.
import { MARK } from './common.mjs';

// ---- the hooks' registration (.claude/settings.local.json: mxcli init overwrites settings.json, not this) ----------

export const PRE_MATCHER = 'Bash|PowerShell|Write|Edit|MultiEdit', POST_MATCHER = 'Read|Skill';
// bundle 2026.11.20: SessionStart's matcher is the source; "compact" fires after a compaction (manual or auto)
export const RESET_EVENT = 'SessionStart', RESET_MATCHER = 'compact';
const GATE_EVENTS = ['PreToolUse', 'PostToolUse', RESET_EVENT];
/** The file-mode installer's commands: the copy in the app, run by the Node on PATH (the installer needs it). */
export const fileModeCommand = mode => `node "$CLAUDE_PROJECT_DIR/.mxcodr/skill-gate.mjs" ${mode}`;
const isGate = h => JSON.stringify(h ?? '').includes(MARK);

/** Settings (a parsed settings JSON object) without our gate entries; the person's hooks stay. Changes cfg. */
export function withoutGateHooks(cfg) {
  if (!cfg?.hooks || typeof cfg.hooks !== 'object') return cfg;
  for (const ev of GATE_EVENTS) {
    if (!Array.isArray(cfg.hooks[ev])) continue;
    const kept = cfg.hooks[ev].filter(e => !isGate(e));
    if (kept.length) cfg.hooks[ev] = kept; else delete cfg.hooks[ev];
  }
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
  return cfg;
}

/** Settings with our three entries, in place of any earlier ones: command(mode) -> the command for 'pre' / 'post' /
 * 'reset' (the person's own SessionStart hooks, e.g. mxcli's bootstrap in settings.json, are not touched). */
export function withGateHooks(cfg, command = fileModeCommand) {
  withoutGateHooks(cfg);
  cfg.hooks = cfg.hooks ?? {};
  cfg.hooks.PreToolUse = [...(cfg.hooks.PreToolUse ?? []), { matcher: PRE_MATCHER, hooks: [{ type: 'command', command: command('pre'), timeout: 15 }] }];
  cfg.hooks.PostToolUse = [...(cfg.hooks.PostToolUse ?? []), { matcher: POST_MATCHER, hooks: [{ type: 'command', command: command('post'), timeout: 15 }] }];
  cfg.hooks[RESET_EVENT] = [...(cfg.hooks[RESET_EVENT] ?? []), { matcher: RESET_MATCHER, hooks: [{ type: 'command', command: command('reset'), timeout: 15 }] }];
  return cfg;
}
