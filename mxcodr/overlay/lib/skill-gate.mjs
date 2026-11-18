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
//
// Which skills an action needs (GATED, only those the app has in .claude/skills/): by the MDL the command runs (the
// script file it names, else the command's own text, e.g. a heredoc), case-insensitive, comments and quoted strings
// left out; see skillsForMdl. Read-only commands (check, query, describe, show) never match.
// It fails open: any error, unreadable input or missing file lets the call through. MXCODR_SKILL_GATE=0 in the
// environment Claude Code runs in switches it off. Self-contained (node: modules only): the file-mode installer
// copies it to .mxcodr/skill-gate.mjs, the Studio Pro extension runs it from its verified copy.
//
// Codex (bundle 2026.11.18.6, the extension's .codex/hooks.json only): `node skill-gate.mjs pre|post --agent=codex
// [--shell=powershell]`. Codex reads a skill with a shell command, so see "Codex" below for what counts as a read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project skills the gate can ask for, with what each is for (the deny message names it).
export const GATED = {
  'module-structure': 'modules and folders',
  'naming-and-captions': 'names of documents, variables, widgets; captions',
  'app-security': 'sign-in, roles, access, row isolation',
  'spacing-and-layout': 'menu, Back, signed-in user, icons, spacing',
  'files-and-images': 'uploads, files and images',
  'java-action-docs': "every Java action's documentation",
  'durable-tests': 'what deserves a test and how',
};
// The text both hook commands contain, so the installer, the extension and the upgrade cleanup find our entries.
export const MARK = 'skill-gate';
export const STATE_DIR = '.mxcodr/state';
const KEEP_DAYS = 7;

// ---- the MDL a command runs, and the skills it needs ------------------------------------------------------------

/** MDL without what is not a statement: comments (-- to the line's end, block and doc comments), quoted strings
 * (captions, messages: their words are not keywords) and $$ ... $$ bodies (Java code). Lower case. */
export function stripMdl(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '-' && n === '-') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { const j = text.indexOf('*/', i + 2); i = j < 0 ? text.length : j + 1; out += ' '; continue; }
    if (c === '$' && n === '$') { const j = text.indexOf('$$', i + 2); i = j < 0 ? text.length : j + 1; out += ' '; continue; }
    if (c === "'") {
      i++;
      while (i < text.length) { if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue; } break; } i++; }
      out += "''"; continue;
    }
    out += c;
  }
  return out.toLowerCase();
}

const OPT = String.raw`(?:or\s+(?:replace|modify)\s+)?`;
// a new document of any kind (not `$x = create Module.Entity (...)` in a microflow: no kind word follows there)
const KINDS = [
  'module(?!\\s+role)', 'folder', '(?:persistent\\s+|non-persistent\\s+|view\\s+|external\\s+)?entit(?:y|ies)', 'enumeration', 'association',
  'microflow', 'nanoflow', 'page', 'snippet', 'layout', 'constant', 'workflow', 'java\\s*action', 'javascript\\s*action',
  '(?:validation\\s+)?rule', 'regular\\s+expression', 'image\\s+collection', 'json\\s+structure', '(?:import|export)\\s+mapping',
  '(?:consumed|published)\\s+(?:rest|odata)', 'rest\\s+client', 'odata\\s+(?:client|service)', 'business\\s+event\\s+service',
  'database\\s+connection', 'scheduled\\s+event', 'task\\s+queue', 'message\\s+definition', 'agent', 'knowledge\\s+base',
];
const RULES = [
  // modules, folders, moves, any new document
  [['module-structure', 'naming-and-captions'], [
    new RegExp(String.raw`(?<!=\s*)\bcreate\s+${OPT}(?:${KINDS.join('|')})\b`),
    /\balter\s+module\b(?!\s+role)/, /\bmove\s+[a-z]/, /\b(?:alter|drop|rename)\s+folder\b/,
  ]],
  // roles, access, project security, demo users
  [['app-security'], [new RegExp(String.raw`\b(?:create|alter|drop)\s+${OPT}(?:module\s+role|user\s+role|demo\s+user|access\s+rule)\b`),
    /\b(?:grant|revoke)\s/, /\balter\s+project\s+security\b/]],
  // pages, snippets, layouts, navigation
  [['spacing-and-layout', 'naming-and-captions'], [new RegExp(String.raw`\b(?:create|alter)\s+${OPT}(?:page|snippet|layout|navigation)\b`)]],
  // files and images: the System generalizations, upload and image widgets
  [['files-and-images'], [/\bextends\s+"?system"?\s*\.\s*"?(?:filedocument|image)\b/, /\bcreate\b[^;]*?\bsystem\.(?:filedocument|image)\b/,
    /\b(?:fileuploader|imageuploader|filemanager|image|staticimage|dynamicimage|imageviewer)\s+"?[a-z_]\w*"?\s*\(/]],
  // Java actions
  [['java-action-docs'], [new RegExp(String.raw`\bcreate\s+${OPT}java\s*action\b`)]],
];

/** The project skills MDL text needs, in GATED's order (none for read-only MDL). */
export function skillsForMdl(text) {
  const t = stripMdl(String(text ?? ''));
  const need = new Set();
  for (const [skills, res] of RULES) if (res.some(re => re.test(t))) for (const s of skills) need.add(s);
  return Object.keys(GATED).filter(s => need.has(s));
}

/** One command line as simple commands, each a list of words, and the separators between them (; && || | & and
 * newlines split; quotes and backslash escapes as sh reads them; powershell: a backslash is a plain character and the
 * backtick escapes). Enough to find a program and its arguments, nothing more. */
function tokenize(line, { powershell = false } = {}) {
  const cmds = [], seps = []; let cur = [], word = '', has = false, q = null, sep = '';
  const endWord = () => { if (has) cur.push(word); word = ''; has = false; };
  const endCmd = () => { endWord(); if (cur.length) { if (cmds.length) seps.push(sep); cmds.push(cur); sep = ''; } cur = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else if (q === '"' && !powershell && c === '\\' && /["\\$`]/.test(line[i + 1] ?? '')) word += line[++i];
      else if (q === '"' && powershell && c === '`' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (powershell && c === '`' && i + 1 < line.length) { word += line[++i]; has = true; continue; }
    if (!powershell && c === '\\' && i + 1 < line.length && line[i + 1] !== '\n' && !/[A-Za-z0-9._-]/.test(line[i + 1])) { word += line[++i]; has = true; continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') { endCmd(); sep += c; continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c; has = true;
  }
  endCmd();
  return { cmds, seps };
}
export const simpleCommands = (line, opts) => tokenize(line, opts).cmds;

const prog = w => path.basename(String(w).replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd|sh|mjs|bat)$/, '');
// mxcli options that take a value as the next word (before the subcommand)
const MXCLI_VALUE_OPTS = new Set(['-p', '--project', '--format', '--config', '-o', '--output']);

const RAW_WRITE = /\bmxcodr-live(?:\.cmd)?\s+exec\s|\bmxcli(?:\.exe)?(?:\s[^\n]*?)?\s(?:exec|-c)\s/i;

/** What a command line writes to the model: [{ file } | { mdl }], [] when it writes nothing (check, query, run...). */
export function modelWrites(line, opts = {}) {
  const out = [];
  line = String(line ?? '');
  for (let words of simpleCommands(line, opts)) {
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1); // VAR=x before the program
    // PowerShell's call operator, node <tool>.mjs, sh|bash ./mxcodr-live ...
    while (words.length > 1 && ['&', 'node', 'sh', 'bash', 'call'].includes(prog(words[0]))) {
      if (words[1] === '-c' && ['sh', 'bash'].includes(prog(words[0]))) { out.push(...modelWrites(words[2] ?? '', opts)); words = []; break; }
      words = words.slice(1);
    }
    const p = prog(words[0] ?? '');
    const args = words.slice(1);
    if (p === 'mxcodr-live') { if (args[0] === 'exec') out.push({ file: args.slice(1).find(a => !a.startsWith('-')) ?? null }); continue; }
    if (p !== 'mxcli') continue;
    const c = args.findIndex(a => a === '-c' || a === '--command');
    if (c >= 0) { out.push({ mdl: args[c + 1] ?? '' }); continue; }
    let i = 0;
    while (i < args.length && args[i].startsWith('-')) i += MXCLI_VALUE_OPTS.has(args[i]) ? 2 : 1;
    if (args[i] === 'exec') out.push({ file: args.slice(i + 1).find((a, k, rest) => !a.startsWith('-') && !MXCLI_VALUE_OPTS.has(rest[k - 1])) ?? null });
  }
  // the words did not show it (a quote left open in a heredoc's MDL, say), the text does: the whole line is the MDL
  if (!out.length && RAW_WRITE.test(line)) out.push({ mdl: line });
  return out;
}

const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// a test spec in tests/ (any depth): durable-tests first
const SPEC = /(?:^|\/)tests\/(?:.+\/)?[^/]+\.spec\.[cm]?[jt]s$/i;
const isSpec = f => SPEC.test(String(f ?? '').replace(/\\/g, '/'));

/** The skills a tool call needs, before it runs. e: the hook input; root: the app folder. */
export function skillsForCall(e, root, opts = {}) {
  const tool = e?.tool_name, input = e?.tool_input ?? {};
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return isSpec(input.file_path) ? ['durable-tests'] : [];
  if (tool !== 'Bash' && tool !== 'PowerShell') return [];
  const line = String(input.command ?? '');
  const writes = modelWrites(line, opts);
  if (!writes.length) return [];
  const need = new Set();
  const dirs = [...new Set([e?.cwd, root].filter(Boolean))];
  for (const w of writes) {
    let text = w.mdl;
    if (text === undefined) {
      text = w.file ? dirs.map(d => readText(path.resolve(d, w.file))).find(t => t !== null) ?? null : null;
      // a script written in the same command (a heredoc), or a file that is not there yet: the command's own text
      if (text === null) text = line;
    }
    for (const s of skillsForMdl(text)) need.add(s);
  }
  return Object.keys(GATED).filter(s => need.has(s));
}

// ---- what this session has read ----------------------------------------------------------------------------------

// .agents/skills: where Codex (and Pi) find the project skills (lib/rules.mjs SKILLS_DIR)
const SKILL_FILE = /(?:^|\/)(?:\.claude|\.agents|\.ai-context)\/skills\/([^/]+)\/SKILL\.md$/i;

// a file's lines as the Read tool counts them: a last newline ends a line, it does not start one
export const lineCount = f => { const t = readText(f) ?? ''; return t.split('\n').length - (t.endsWith('\n') ? 1 : 0); };
const inside = (root, f) => {
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

const sid = s => (String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'unknown');
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
function sessionDir(root, session, now = Date.now()) {
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

export function markRead(root, session, name, now = Date.now()) {
  fs.writeFileSync(path.join(sessionDir(root, session, now), name), '');
  return readSkills(root, session);
}

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

// ---- the hooks' registration (.claude/settings.local.json: mxcli init overwrites settings.json, not this) ----------

export const PRE_MATCHER = 'Bash|PowerShell|Write|Edit|MultiEdit', POST_MATCHER = 'Read|Skill';
/** The file-mode installer's commands: the copy in the app, run by the Node on PATH (the installer needs it). */
export const fileModeCommand = mode => `node "$CLAUDE_PROJECT_DIR/.mxcodr/skill-gate.mjs" ${mode}`;
const isGate = h => JSON.stringify(h ?? '').includes(MARK);

/** Settings (a parsed settings JSON object) without our gate entries; the person's hooks stay. Changes cfg. */
export function withoutGateHooks(cfg) {
  if (!cfg?.hooks || typeof cfg.hooks !== 'object') return cfg;
  for (const ev of ['PreToolUse', 'PostToolUse']) {
    if (!Array.isArray(cfg.hooks[ev])) continue;
    const kept = cfg.hooks[ev].filter(e => !isGate(e));
    if (kept.length) cfg.hooks[ev] = kept; else delete cfg.hooks[ev];
  }
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
  return cfg;
}

/** Settings with our two entries, in place of any earlier ones: command(mode) -> the command for 'pre' / 'post'. */
export function withGateHooks(cfg, command = fileModeCommand) {
  withoutGateHooks(cfg);
  cfg.hooks = cfg.hooks ?? {};
  cfg.hooks.PreToolUse = [...(cfg.hooks.PreToolUse ?? []), { matcher: PRE_MATCHER, hooks: [{ type: 'command', command: command('pre'), timeout: 15 }] }];
  cfg.hooks.PostToolUse = [...(cfg.hooks.PostToolUse ?? []), { matcher: POST_MATCHER, hooks: [{ type: 'command', command: command('post'), timeout: 15 }] }];
  return cfg;
}

/** The hook: mode 'pre' or 'post', input the hook JSON; agent 'codex' for Codex's hooks (powershell: its Windows
 * command line). -> { code, stderr } */
export function runHook(mode, input, env = process.env, { agent = null, powershell = false } = {}) {
  try {
    if (env.MXCODR_SKILL_GATE === '0') return { code: 0 };
    const e = JSON.parse(input);
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
