#!/usr/bin/env node
// The skill gate (bundle 2026.11.18.2): Claude Code hooks that hold the agent to the rule file's "read the project
// skill before building that part". Measured in CarFleet (2026-11-18): with the rule as text only, the agent read
// naming-and-captions after it had executed the domain model, never read module-structure (no folders) and never read
// durable-tests although it wrote tests/*.spec.ts.
//
//   node skill-gate.mjs post   PostToolUse on Read|Skill: a whole read of .claude/skills/<name>/SKILL.md (or
//                              .ai-context/skills/<name>/SKILL.md), or the Skill tool loading <name>, records <name>
//                              as read in .mxcodr/state/skills-read-<session>/<name> (an empty file)
//   node skill-gate.mjs pre    PreToolUse on Bash|PowerShell|Write|Edit|MultiEdit: a model write (./mxcodr-live exec,
//                              mxcli exec, mxcli -c) or a test spec write that needs a project skill not read yet in
//                              this session is refused (exit 2, the reason on stderr, which Claude Code shows the agent)
//   node skill-gate.mjs reset  SessionStart with source "compact" (bundle 2026.11.20): the context was compacted, so the
//                              skills read before it are no longer in it; this session's read marks go (others stay)
//
// Which skills an action needs (GATED, only those the app has in .claude/skills/): by the MDL the command runs (the
// script file it names, else the command's own text, e.g. a heredoc), case-insensitive, comments and quoted strings
// left out; see skillsForMdl. Read-only commands (check, query, describe, show) never match.
// It fails open: any error, unreadable input or missing file lets the call through. MXCODR_SKILL_GATE=0 in the
// environment Claude Code runs in switches it off. Self-contained (node: modules and its parts in skill-gate/ only):
// the file-mode installer copies it to .mxcodr/skill-gate.mjs and the parts to .mxcodr/skill-gate/, the Studio Pro
// extension runs it from its verified copy. The parts: needs.mjs (what a call needs), reads.mjs (what the session
// read), decide.mjs (Claude Code's decision), codex.mjs (Codex's), hooks.mjs (their registration), common.mjs; this
// file is the hook (runHook) and re-exports them all.
//
// Codex (bundle 2026.11.18.6, the extension's .codex/hooks.json only): `node skill-gate.mjs pre|post|reset --agent=codex
// [--shell=powershell]` (reset on Codex's PreCompact, bundle 2026.11.20). Codex reads a skill with a shell command,
// so see "Codex" below for what counts as a read.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { skillRead, isCompaction, clearReads, markRead } from './skill-gate/reads.mjs';
import { decide } from './skill-gate/decide.mjs';
import { codexSkillRead, enclosingCell, markCodexRead, codexDecide } from './skill-gate/codex.mjs';
export { stripMdl, skillsForMdl, simpleCommands, modelWrites, skillsForCall } from './skill-gate/needs.mjs';
export { lineCount, skillRead, statePath, readSkills, stateDir, isCompaction, clearReads, markRead } from './skill-gate/reads.mjs';
export { presentSkills, denyMessage, decide } from './skill-gate/decide.mjs';
export { CODEX_SKILL_DIRS, TRUNCATED, shellRead, patchFiles, codexSkillRead, enclosingCell, markCodexRead, codexReadSkills, codexDenyMessage, codexDecide } from './skill-gate/codex.mjs';
export { PRE_MATCHER, POST_MATCHER, RESET_EVENT, RESET_MATCHER, fileModeCommand, withoutGateHooks, withGateHooks } from './skill-gate/hooks.mjs';
export { GATED, MARK, STATE_DIR } from './skill-gate/common.mjs';

/** The hook: mode 'pre' or 'post', input the hook JSON; agent 'codex' for Codex's hooks (powershell: its Windows
 * command line). -> { code, stderr } */
export function runHook(mode, input, env = process.env, { agent = null, powershell = false } = {}) {
  try {
    if (env.MXCODR_SKILL_GATE === '0') return { code: 0 };
    const e = JSON.parse(input);
    if (mode === 'reset') {
      if (isCompaction(e, { agent })) clearReads(agent === 'codex' ? e.cwd || env.CLAUDE_PROJECT_DIR : env.CLAUDE_PROJECT_DIR || e.cwd, e.session_id);
      return { code: 0 };
    }
    if (agent === 'codex') {
      const root = e.cwd || env.CLAUDE_PROJECT_DIR;
      if (!root) return { code: 0 };
      if (mode === 'post') {
        const r = codexSkillRead(e, { root, powershell });
        if (r) markCodexRead(root, e.session_id, { ...r, cell: enclosingCell(e.transcript_path, r.name)?.cell ?? null }, e.tool_use_id);
        return { code: 0 };
      }
      if (mode === 'pre') { const why = codexDecide(e, { root, env, powershell }); return why ? { code: 2, stderr: why + '\n' } : { code: 0 }; }
      return { code: 0 };
    }
    const root = env.CLAUDE_PROJECT_DIR || e.cwd;
    if (!root) return { code: 0 };
    if (mode === 'post') { const s = skillRead(e, { root }); if (s) markRead(root, e.session_id, s); return { code: 0 }; }
    if (mode === 'pre') { const why = decide(e, { root, env }); return why ? { code: 2, stderr: why + '\n' } : { code: 0 }; }
  } catch { /* fail open */ }
  return { code: 0 };
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { input += d; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    const flags = process.argv.slice(3);
    const r = runHook(process.argv[2], input, process.env, { agent: flags.find(a => a.startsWith('--agent='))?.slice(8) ?? null, powershell: flags.includes('--shell=powershell') });
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.code);
  });
}
