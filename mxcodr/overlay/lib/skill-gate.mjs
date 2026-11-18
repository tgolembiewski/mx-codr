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

/** One command line as simple commands, each a list of words (; && || | & and newlines split; quotes and backslash
 * escapes as sh reads them, plus PowerShell's backtick). Enough to find a program and its arguments, nothing more. */
export function simpleCommands(line) {
  const out = []; let cur = [], word = '', has = false, q = null;
  const endWord = () => { if (has) cur.push(word); word = ''; has = false; };
  const endCmd = () => { endWord(); if (cur.length) out.push(cur); cur = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; else if (q === '"' && c === '\\' && /["\\$`]/.test(line[i + 1] ?? '')) word += line[++i]; else word += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < line.length && line[i + 1] !== '\n' && !/[A-Za-z0-9._-]/.test(line[i + 1])) { word += line[++i]; has = true; continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') { endCmd(); continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c; has = true;
  }
  endCmd();
  return out;
}

const prog = w => path.basename(String(w).replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd|sh|mjs|bat)$/, '');
// mxcli options that take a value as the next word (before the subcommand)
const MXCLI_VALUE_OPTS = new Set(['-p', '--project', '--format', '--config', '-o', '--output']);

const RAW_WRITE = /\bmxcodr-live(?:\.cmd)?\s+exec\s|\bmxcli(?:\.exe)?(?:\s[^\n]*?)?\s(?:exec|-c)\s/i;

/** What a command line writes to the model: [{ file } | { mdl }], [] when it writes nothing (check, query, run...). */
export function modelWrites(line) {
  const out = [];
  line = String(line ?? '');
  for (let words of simpleCommands(line)) {
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1); // VAR=x before the program
    // PowerShell's call operator, node <tool>.mjs, sh|bash ./mxcodr-live ...
    while (words.length > 1 && ['&', 'node', 'sh', 'bash', 'call'].includes(prog(words[0]))) {
      if (words[1] === '-c' && ['sh', 'bash'].includes(prog(words[0]))) { out.push(...modelWrites(words[2] ?? '')); words = []; break; }
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

/** The skills a tool call needs, before it runs. e: the hook input; root: the app folder. */
export function skillsForCall(e, root) {
  const tool = e?.tool_name, input = e?.tool_input ?? {};
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    const f = String(input.file_path ?? '').replace(/\\/g, '/');
    return /(?:^|\/)tests\/(?:.+\/)?[^/]+\.spec\.[cm]?[jt]s$/i.test(f) ? ['durable-tests'] : [];
  }
  if (tool !== 'Bash' && tool !== 'PowerShell') return [];
  const line = String(input.command ?? '');
  const writes = modelWrites(line);
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

const SKILL_FILE = /(?:^|\/)(?:\.claude|\.ai-context)\/skills\/([^/]+)\/SKILL\.md$/i;

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

export function markRead(root, session, name, now = Date.now()) {
  const dir = stateDir(root);
  if (!fs.existsSync(path.join(dir, '.gitignore'))) fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
  const mine = statePath(root, session);
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, name), '');
  // other sessions' records older than a week go
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (!n.startsWith('skills-read-') || p === mine) continue;
    try { if (now - fs.statSync(p).mtimeMs > KEEP_DAYS * 864e5) fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone */ }
  }
  return readSkills(root, session);
}

// ---- the decision ---------------------------------------------------------------------------------------------------

/** The skills the app has (only those can be asked for). */
export const presentSkills = root => Object.keys(GATED).filter(s => fs.existsSync(path.join(root, '.claude', 'skills', s, 'SKILL.md')));

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

/** The hook: mode 'pre' or 'post', input the hook JSON. -> { code, stderr } */
export function runHook(mode, input, env = process.env) {
  try {
    if (env.MXCODR_SKILL_GATE === '0') return { code: 0 };
    const e = JSON.parse(input);
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
    const r = runHook(process.argv[2], input);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.code);
  });
}
