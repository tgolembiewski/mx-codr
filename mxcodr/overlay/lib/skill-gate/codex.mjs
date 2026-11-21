// Part of the skill gate (lib/skill-gate.mjs, whose header says what it does; the file-mode installer copies it to
// .mxcodr/skill-gate.mjs and this folder to .mxcodr/skill-gate/). Self-contained: node: modules and its own parts only.
// Here: Codex's reads and decision (the extension's .codex/hooks.json).
import fs from 'node:fs';
import path from 'node:path';
import { tokenize, prog, isSpec, skillsForCall } from './needs.mjs';
import { SKILL_FILE, lineCount, inside, sid, statePath, stateDir, sessionDir } from './reads.mjs';
import { presentSkills } from './decide.mjs';
import { GATED, readText } from './common.mjs';

// ---- Codex (bundle 2026.11.18.6) -------------------------------------------------------------------------------------
// Measured with Codex 0.167.0 (2026-11-18, a scratch folder): its hooks get tool_name "Bash" for exec_command
// (tool_input {command} only: no max_output_tokens) and "apply_patch" ({command: the patch}); PostToolUse's
// tool_response is the command's output as the model sees it, with Codex's marks when it was cut ("Warning: truncated
// output (original token count: N)", "…N tokens truncated…"). In code mode the model runs those commands from a
// JavaScript `exec` cell, which has its own output budget (10,000 tokens unless its first line is
// `// @exec: {"max_output_tokens": N}`) and gets no hook: CarFleet's session (2026-11-18) read three skills in one cell
// with Promise.allSettled, each command's output whole, the cell's cut at 10,000 tokens. The cell is in the session's
// transcript (transcript_path) before its commands' hooks run, and its output before the next cell's hooks run. So:
//   post  a command that reads one gated SKILL.md, whole or a range of its lines (shellRead), whose output has no
//         truncation mark and ends with the range's last line, is recorded with the cell it ran in;
//   pre   a recorded read counts once its cell's output is in the transcript, without a truncation mark and with that
//         last line (a read and a write in the same cell do not count: the model had not seen the skill yet); ranges
//         count once they cover the file. A transcript that cannot be read: the command's own check decides.
export const CODEX_SKILL_DIRS = ['.agents/skills', '.claude/skills'];
export const TRUNCATED = /…\s*\d+ tokens truncated\s*…|\bWarning: truncated output\b|\boriginal token count: \d+/i;

const intArg = s => (/^\d+$/.test(String(s ?? '')) ? Number(s) : null);
const stripVars = w => { while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1); return w; };

/** A command that prints a whole file: cat, nl, type, Get-Content/gc (-Raw, -Encoding, -Path, -TotalCount N). */
function fileRead(words) {
  const p = prog(words[0] ?? ''), args = words.slice(1);
  if (p === 'cat' || p === 'nl' || p === 'type') {
    const files = args.filter(a => !/^-/.test(a));
    return files.length === 1 && files.length + args.filter(a => /^-[A-Za-z]+$/.test(a)).length === args.length ? { file: files[0], from: 1, to: Infinity } : null;
  }
  if (p !== 'get-content' && p !== 'gc') return null;
  let file = null, to = Infinity;
  for (let i = 0; i < args.length; i++) {
    const a = args[i], low = a.toLowerCase();
    if (low === '-raw') continue;
    if (low === '-encoding') { i++; continue; }
    if (low === '-path' || low === '-literalpath') { if (file !== null) return null; file = args[++i] ?? null; continue; }
    if (low === '-totalcount' || low === '-head' || low === '-first') { to = intArg(args[++i]); if (!to) return null; continue; }
    if (a.startsWith('-') || file !== null) return null;
    file = a;
  }
  return file ? { file, from: 1, to } : null;
}

/** A command that keeps a range of its input's lines: sed -n 'A,Bp' | 'A,$p' | 'Ap', head -n N | -N, tail -n +K,
 * Select-Object -Skip K -First N. -> { range: {from, to}, files: [the other words] } or null. */
function lineFilter(words) {
  const p = prog(words[0] ?? ''), args = words.slice(1);
  if (p === 'sed') {
    if (!args.includes('-n')) return null;
    const rest = args.filter(a => a !== '-n' && a !== '-e');
    const m = /^(\d+)(?:,(\d+|\$))?p$/.exec(rest[0] ?? '');
    if (!m) return null;
    return { range: { from: Number(m[1]), to: m[2] === '$' ? Infinity : Number(m[2] ?? m[1]) }, files: rest.slice(1) };
  }
  if (p === 'head') {
    let n = 10; const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-n' || a === '--lines') { n = intArg(args[++i]); if (n === null) return null; continue; }
      const m = /^(?:-n|--lines=|-)(\d+)$/.exec(a);
      if (m) { n = Number(m[1]); continue; }
      if (a.startsWith('-')) return null;
      files.push(a);
    }
    return { range: { from: 1, to: n }, files };
  }
  if (p === 'tail') {
    let from = null; const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const v = a === '-n' ? args[++i] : /^-n\+\d+$/.test(a) ? a.slice(2) : a.startsWith('+') ? a : undefined;
      if (v !== undefined) { const m = /^\+(\d+)$/.exec(v ?? ''); if (!m) return null; from = Number(m[1]); continue; }
      if (a.startsWith('-')) return null;
      files.push(a);
    }
    return from ? { range: { from, to: Infinity }, files } : null;
  }
  if (p === 'select-object' || p === 'select') {
    let skip = 0, first = Infinity, any = false;
    for (let i = 0; i < args.length; i++) {
      const low = args[i].toLowerCase(), v = intArg(args[i + 1]);
      if ((low === '-skip' || low === '-first') && v !== null) { i++; any = true; if (low === '-skip') skip = v; else first = v; continue; }
      return null;
    }
    return any ? { range: { from: skip + 1, to: skip + first }, files: [] } : null;
  }
  return null;
}

/** What a shell command line reads, when it is one command reading one file (whole or a range of its lines), or one
 * whole read piped into one line filter: { file, from, to } (to: Infinity for the end); else null. Lines from 1. */
export function shellRead(line, { powershell = false } = {}) {
  const { cmds, seps } = tokenize(String(line ?? ''), { powershell });
  const words = cmds.map(stripVars);
  if (words.length === 1) {
    const whole = fileRead(words[0]);
    if (whole) return whole;
    const f = lineFilter(words[0]);
    return f && f.files.length === 1 ? { file: f.files[0], ...f.range } : null;
  }
  if (words.length === 2 && seps[0] === '|') {
    const r = fileRead(words[0]), f = lineFilter(words[1]);
    if (!r || r.from !== 1 || r.to !== Infinity || !f || f.files.length) return null;
    return { file: r.file, ...f.range };
  }
  return null;
}

/** The files an apply_patch adds, updates or moves to. */
export const patchFiles = text => [...String(text ?? '').matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)].map(m => m[1].trim());

const fileLines = f => (readText(f) ?? '').replace(/\r\n/g, '\n').split('\n');
/** The last non-blank line of lines from..to of f, trimmed ('' when all are blank). */
function lastLine(f, from, to) {
  const l = fileLines(f);
  for (let i = Math.min(to, l.length) - 1; i >= from - 1; i--) if (l[i].trim()) return l[i].trim();
  return '';
}
// the output shows the line: as printed, or inside JSON (a cell that printed the result object)
const shows = (text, line) => !line || text.includes(line) || text.includes(JSON.stringify(line).slice(1, -1));
const outputText = o => (typeof o === 'string' ? o : Array.isArray(o) ? o.map(x => (typeof x?.text === 'string' ? x.text : JSON.stringify(x))).join('\n') : JSON.stringify(o ?? ''));

/** The gated skill a finished Codex shell command read, with the lines it covered and the last one, when the output
 * shows them uncut; else null. */
export function codexSkillRead(e, { root = null, lines = lineCount, powershell = false } = {}) {
  if (e?.tool_name !== 'Bash' && e?.tool_name !== 'PowerShell') return null;
  const r = shellRead(e?.tool_input?.command, { powershell });
  if (!r) return null;
  const f = path.resolve(e?.cwd || root || '.', r.file);
  const m = SKILL_FILE.exec(f.replace(/\\/g, '/'));
  if (!m || !(m[1] in GATED) || (root && !inside(root, f)) || !fs.existsSync(f)) return null;
  const out = outputText(e.tool_response);
  if (TRUNCATED.test(out)) return null;
  const from = Math.max(1, r.from), to = Math.min(r.to, lines(f));
  if (from > to) return null;
  const last = lastLine(f, from, to);
  if (!shows(out, last)) return null;
  return { name: m[1], file: f, from, to, last };
}

/** The response items of a transcript (Codex's rollout JSONL), the last `bytes` of it when given; null when unreadable. */
function transcriptItems(file, bytes = null) {
  if (!file) return null;
  let text;
  try {
    if (bytes) {
      const fd = fs.openSync(file, 'r');
      try { const size = fs.fstatSync(fd).size, at = Math.max(0, size - bytes), b = Buffer.alloc(size - at); fs.readSync(fd, b, 0, b.length, at); text = b.toString('utf8'); if (at) text = text.slice(text.indexOf('\n') + 1); } finally { fs.closeSync(fd); }
    } else text = fs.readFileSync(file, 'utf8');
  } catch { return null; }
  const items = [];
  for (const l of text.split('\n')) {
    if (!l.includes('"response_item"')) continue;
    try { const o = JSON.parse(l); if (o?.type === 'response_item' && o.payload) items.push(o.payload); } catch { /* a line being written */ }
  }
  return items;
}

/** The code-mode cell a command reading skill `name` runs in: { cell: call_id }, { cell: null } for a direct call
 * (its own output is what the model saw), or null when the transcript says nothing (unreadable, no call). */
export function enclosingCell(transcript, name) {
  const items = transcriptItems(transcript, 4 << 20);
  if (!items) return null;
  const done = new Set(items.filter(p => /_output$/.test(p.type ?? '')).map(p => p.call_id));
  const open = items.filter(p => (p.type === 'custom_tool_call' || p.type === 'function_call') && !done.has(p.call_id));
  const cells = open.filter(p => p.type === 'custom_tool_call' && p.name === 'exec');
  const mine = cells.filter(p => String(p.input ?? '').includes(name));
  const cell = mine.at(-1) ?? cells.at(-1);
  if (cell) return { cell: cell.call_id };
  return open.length ? { cell: null } : null;
}

/** Records a Codex read: one file per read (its lines, the cell it ran in, the last line it showed). */
export function markCodexRead(root, session, r, id = '') {
  const mine = sessionDir(root, session);
  const key = `${r.name}~${r.from}-${r.to}~${sid(id || Math.random().toString(36).slice(2))}`;
  fs.writeFileSync(path.join(mine, key), JSON.stringify({ file: r.file, from: r.from, to: r.to, last: r.last, cell: r.cell ?? null }));
}

/** The gated skills this Codex session has read whole (see above); a read whose cell output was cut is forgotten. */
export function codexReadSkills(root, session, transcript) {
  const mine = statePath(root, session);
  let names; try { names = fs.readdirSync(mine); } catch { return []; }
  const done = new Set(names.filter(n => n in GATED));
  const recs = [];
  for (const n of names) {
    const name = n.split('~')[0];
    if (!n.includes('~') || !(name in GATED) || done.has(name)) continue;
    try { recs.push({ n, name, ...JSON.parse(fs.readFileSync(path.join(mine, n), 'utf8')) }); } catch { /* half written */ }
  }
  const cells = new Set(recs.map(r => r.cell).filter(Boolean));
  let outs = null;
  if (cells.size) {
    const items = transcriptItems(transcript);
    if (items) outs = new Map(items.filter(p => /_output$/.test(p.type ?? '') && cells.has(p.call_id)).map(p => [p.call_id, outputText(p.output)]));
  }
  const ranges = {};
  for (const r of recs) {
    if (r.cell && outs) {
      const t = outs.get(r.cell);
      if (t === undefined) continue; // the cell still runs: the model has not seen its output yet
      if (TRUNCATED.test(t) || !shows(t, r.last)) { try { fs.rmSync(path.join(mine, r.n), { force: true }); } catch { /* gone */ } continue; }
    }
    (ranges[r.name] ??= []).push(r);
  }
  for (const [name, rs] of Object.entries(ranges)) {
    const n = lineCount(rs[0].file);
    let upTo = 0;
    for (const r of rs.sort((a, b) => a.from - b.from)) { if (r.from > upTo + 1) break; upTo = Math.max(upTo, r.to); }
    if (upTo < n) continue;
    done.add(name);
    try { fs.writeFileSync(path.join(mine, name), ''); } catch { /* counted now, recounted next time */ }
  }
  return Object.keys(GATED).filter(s => done.has(s));
}

/** The skills a Codex tool call needs: a model write in a shell command, a test spec in an apply_patch (or a patch
 * given to a shell command). -> { skills, model } (model: a model write asked for them). */
function codexNeeds(e, root, opts) {
  const tool = e?.tool_name, cmd = String(e?.tool_input?.command ?? '');
  const need = new Set();
  if ((tool === 'apply_patch' || cmd.includes('*** Begin Patch')) && patchFiles(cmd).some(isSpec)) need.add('durable-tests');
  let model = false;
  if (tool === 'Bash' || tool === 'PowerShell') {
    const s = skillsForCall({ ...e, tool_name: 'Bash' }, root, opts);
    model = s.length > 0;
    for (const x of s) need.add(x);
  }
  return { skills: Object.keys(GATED).filter(s => need.has(s)), model };
}

/** Where a Codex agent finds a skill: .agents/skills when the app has it there, else .claude/skills. */
const codexSkillPath = (root, s) => path.join(root, ...(fs.existsSync(path.join(root, '.agents', 'skills', s, 'SKILL.md')) ? ['.agents', 'skills'] : ['.claude', 'skills']), s, 'SKILL.md');

export function codexDenyMessage(missing, root, tool, model = tool === 'Bash' || tool === 'PowerShell') {
  const what = model ? 'This model change' : 'This test file';
  return `mx-codr skill gate: ${what} needs the project skill${missing.length > 1 ? 's' : ''} below, not read whole yet in this session. `
    + 'Read each file in its own command, one file per command (never several files in one call, never Promise.all or a loop): '
    + 'in an exec script start with the line // @exec: {"max_output_tokens": 30000} and give exec_command max_output_tokens: 30000 '
    + '(cat <file>; on Windows Get-Content -Raw <file>). If the output says it was truncated, read the rest by line ranges '
    + "(sed -n '1,200p' <file>, then the next lines) before you build. "
    + `Then check your ${model ? 'script' : 'test'} against ${missing.length > 1 ? 'them' : 'it'} and run the same call again:\n`
    + missing.map(s => `  ${codexSkillPath(root, s)}  (${GATED[s]})`).join('\n')
    + "\nThese project skills come before `./mxcli syntax` and before mxcli's own skills in .ai-context/skills/.";
}

/** Codex's PreToolUse: null (let it run) or the deny reason. */
export function codexDecide(e, { root = e?.cwd, env = process.env, powershell = false } = {}) {
  if (env.MXCODR_SKILL_GATE === '0' || !root) return null;
  const { skills, model } = codexNeeds(e, root, { powershell });
  const have = new Set(presentSkills(root, CODEX_SKILL_DIRS));
  const asked = skills.filter(s => have.has(s));
  if (!asked.length) return null;
  const read = new Set(codexReadSkills(root, e?.session_id, e?.transcript_path));
  const missing = asked.filter(s => !read.has(s));
  if (!missing.length) return null;
  try { stateDir(root); } catch { return null; }
  return codexDenyMessage(missing, root, e?.tool_name, model);
}
