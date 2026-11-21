// Part of the skill gate (lib/skill-gate.mjs, whose header says what it does; the file-mode installer copies it to
// .mxcodr/skill-gate.mjs and this folder to .mxcodr/skill-gate/). Self-contained: node: modules and its own parts only.
// Here: what a call needs. The MDL a command runs, the skills that MDL needs, and a test spec's.
import path from 'node:path';
import { GATED, readText } from './common.mjs';

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
export function tokenize(line, { powershell = false } = {}) {
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

export const prog = w => path.basename(String(w).replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd|sh|mjs|bat)$/, '');
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

// a test spec in tests/ (any depth): durable-tests first
const SPEC = /(?:^|\/)tests\/(?:.+\/)?[^/]+\.spec\.[cm]?[jt]s$/i;
export const isSpec = f => SPEC.test(String(f ?? '').replace(/\\/g, '/'));

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
