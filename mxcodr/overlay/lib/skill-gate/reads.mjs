// Part of the skill gate (lib/skill-gate.mjs, whose header says what it does; the file-mode installer copies it to
// .mxcodr/skill-gate.mjs and this folder to .mxcodr/skill-gate/). Self-contained: node: modules and its own parts only.
// Here: what this session has read, as marks in .mxcodr/state/, cleared on a compaction.
import fs from 'node:fs';
import path from 'node:path';
import { GATED, STATE_DIR, readText } from './common.mjs';

const KEEP_DAYS = 7;

// ---- what this session has read ----------------------------------------------------------------------------------

// .agents/skills: where Codex (and Pi) find the project skills (lib/rules.mjs SKILLS_DIR)
export const SKILL_FILE = /(?:^|\/)(?:\.claude|\.agents|\.ai-context)\/skills\/([^/]+)\/SKILL\.md$/i;

// a file's lines as the Read tool counts them: a last newline ends a line, it does not start one
export const lineCount = f => { const t = readText(f) ?? ''; return t.split('\n').length - (t.endsWith('\n') ? 1 : 0); };
export const inside = (root, f) => {
  const norm = x => { const r = path.resolve(x); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const rel = path.relative(norm(root), norm(f));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The gated skill a finished Read or Skill call took in whole, else null; a file read must lie in root (the app),
 * when root is given. lineCount(file) -> its number of lines. */
export function skillRead(e, { root = null, lines = lineCount } = {}) {
  const input = e?.tool_input ?? {};
  if (e?.tool_name === 'Skill') {
    const name = String(input.skill ?? input.name ?? input.command ?? '').replace(/^\//, '').split(':').pop().trim();
    return name in GATED ? name : null;
  }
  if (e?.tool_name !== 'Read') return null;
  const f = String(input.file_path ?? '');
  const m = SKILL_FILE.exec(f.replace(/\\/g, '/'));
  if (!m || !(m[1] in GATED)) return null;
  if (root && !inside(root, f)) return null;
  const offset = Number(input.offset ?? 0), limit = input.limit == null ? null : Number(input.limit);
  if (offset > 1) return null;
  if (limit !== null && !(limit >= lines(f))) return null;
  return m[1];
}

export const sid = s => (String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'unknown');
/** A session's record: a folder with one empty file per skill read (no read-modify-write, so Reads that run in
 * parallel, as a batch of the deny's files does, all count). */
export const statePath = (root, session) => path.join(root, STATE_DIR, `skills-read-${sid(session)}`);
export function readSkills(root, session) {
  try { return fs.readdirSync(statePath(root, session)).filter(n => n in GATED); } catch { return []; }
}

/** The state folder, made when missing; throws when it cannot be used (a link on the way, not writable). */
export function stateDir(root) {
  const dir = path.join(root, STATE_DIR);
  // never through a link (a repository could plant .mxcodr -> somewhere else)
  for (const d of [path.join(root, '.mxcodr'), dir]) { try { if (fs.lstatSync(d).isSymbolicLink()) throw new Error(`${d} is a link`); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  return dir;
}

/** This session's folder, made when missing (its parent ignored by git); other sessions' records older than a week go. */
export function sessionDir(root, session, now = Date.now()) {
  const dir = stateDir(root);
  if (!fs.existsSync(path.join(dir, '.gitignore'))) fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
  const mine = statePath(root, session);
  fs.mkdirSync(mine, { recursive: true });
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (!n.startsWith('skills-read-') || p === mine) continue;
    try { if (now - fs.statSync(p).mtimeMs > KEEP_DAYS * 864e5) fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone */ }
  }
  return mine;
}

/** Compaction (bundle 2026.11.20): after it the model has only a summary, not the skills it read, so the gate counted
 * them as read while they were gone. A compaction clears this session's marks (its folder); other sessions keep theirs.
 * Measured with Claude Code 2.1.326 (`/compact` on a resumed `claude -p` session): PreCompact {trigger}, then
 * SessionStart {source: "compact"}, then PostCompact {trigger, compact_summary}, all with the same session_id. Nothing
 * is written to stdout: SessionStart's becomes context for the model, PreCompact's instructions for the summary.
 * -> true when the event is a compaction (whether or not there was anything to clear). */
// Codex (0.167.0) registers it on PreCompact only; its event name is not measured there, so a Codex input without
// one counts too, and the spelling may be pre_compact.
export function isCompaction(e, { agent = null } = {}) {
  const name = String(e?.hook_event_name ?? '').replace(/_/g, '').toLowerCase();
  if (!name) return agent === 'codex';
  return name === 'precompact' || name === 'postcompact' || (name === 'sessionstart' && e?.source === 'compact');
}
export function clearReads(root, session) {
  if (!root || session == null || session === '') return false;
  // never through a link (as stateDir)
  for (const d of [path.join(root, '.mxcodr'), path.join(root, STATE_DIR)]) { try { if (fs.lstatSync(d).isSymbolicLink()) return false; } catch { return false; } }
  const mine = statePath(root, session);
  try { if (fs.lstatSync(mine).isSymbolicLink()) { fs.unlinkSync(mine); return true; } } catch { return false; }
  fs.rmSync(mine, { recursive: true, force: true });
  return true;
}

export function markRead(root, session, name, now = Date.now()) {
  fs.writeFileSync(path.join(sessionDir(root, session, now), name), '');
  return readSkills(root, session);
}
