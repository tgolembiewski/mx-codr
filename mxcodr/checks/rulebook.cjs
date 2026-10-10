#!/usr/bin/env node
// The rulebook: one Markdown card per rule in tests/rulebook/ (the bundle's rulebook/), the one
// place that says what each rule checks, how hard it judges (its level) and which documents the
// person excepted. Read by the gate (tests/gate/*.sh), precheck.sh, the
// checkers (--levels / --except) and tests/rules.sh. The checkers keep their code; a card's
// `check:` names the function that produces its code, and `level:` says what the gate does with it.
//
// A card:
//     ---                                                    (front matter: `key: value` lines
//     step: layout                                            between two `---` lines)
//     level: block
//     check: layout_rules/urls.cjs#urlFindings
//     key: document
//     baseline: names                                        (optional: captions | names | paths)
//     fixed: yes                                             (optional: no level to set)
//     ---
//     # URL01 — every page that can have a URL has one      (then the code and title)
//
//     ## What it checks ...  ## Fix ...                      (documentation, free text)
//
//     ## Local                                               (the person's: level override and
//     level: warn                                             exceptions; the installer keeps this
//     except: Orders.Approval_Task   # why                    section word for word)
//
// Levels: block (fails the step), warn (listed under the gate's warnings), info (counted, not
// listed), off (not checked). The header level is the default; `## Local` overrides it.
// `baseline:` is not a level: it records that the checker keeps a per-DONE baseline for the code
// (warns until the first DONE, then blocks a document new or changed since), as today.
//
// Usage: rulebook.cjs <dir> check            validate every card; exit 1 with file:line per error
//        rulebook.cjs <dir> levels <step>    JSON {CODE: level} of the step's effective levels
//        rulebook.cjs <dir> overrides <step> JSON {CODE: level} of the levels the person changed (what the checkers take as --levels)
//        rulebook.cjs <dir> excepts <step>   JSON {CODE: [key, ...]}
//        rulebook.cjs <dir> level <CODE>     the effective level, one word
//        rulebook.cjs <dir> digest <step>    one hash over the step's effective levels and excepts
//        rulebook.cjs <dir> list [step]      one line per card: code, step, default, effective, excepts
//        rulebook.cjs <dir> explain <CODE>   the card
//        rulebook.cjs <dir> docs <tests-dir> write tests/checks/<step>.md and tests/CHECKS.md from the cards
//        rulebook.cjs <dir> merge <app-dir>  install: new card text, the app's ## Local kept word for word
//        rulebook.cjs <dir> migrate <env>    install: the old MDL_* switches of <env> as ## Local lines
//        rulebook.cjs <dir> retired <env>    the old MDL_* switches set in <env>
// Exit 2 when the directory is missing or a card is broken (the message names the card and line).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEVELS = new Set(['block', 'warn', 'info', 'off']);
const STEPS = new Set(['precheck', 'tests', 'mx', 'catalog', 'coverage', 'naming', 'layout', 'security', 'scope', 'paths', 'folders', 'unused']);
const HEADER_KEYS = new Set(['step', 'level', 'check', 'key', 'baseline', 'fixed', 'scope', 'match', 'message']);
const LOCAL_KEYS = new Set(['level', 'except']);
const CODE_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

class RulebookError extends Error {}

// A comment starts at `#` at the start of a line or after whitespace; a value is taken as written.
function stripComment(text) {
  const m = /(^|\s)#/.exec(text);
  return (m ? text.slice(0, m.index) : text).trim();
}

// {code, title, file, header: {k: v}, local: {level, except: [...]}, doc: text} from one card.
function parseCard(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fail = (line, what) => { throw new RulebookError(`${file}:${line}: ${what}`); };
  // Front matter first: `---`, one `key: value` per line, `---`; then the card's `# CODE — title`.
  if ((lines[0] || '').trim() !== '---') fail(1, 'a card starts with `---`, its header, `---`, then `# CODE — title`');
  const header = {}, at = {};
  let i = 1;
  for (; i < lines.length && lines[i].trim() !== '---'; i++) {
    if (!lines[i].trim()) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) fail(i + 1, 'a header line is `key: value`');
    if (!HEADER_KEYS.has(kv[1])) fail(i + 1, `unknown header key "${kv[1]}" (step, level, check, key, baseline, fixed)`);
    header[kv[1]] = kv[1] === 'match' ? kv[2].trim() : stripComment(kv[2]);
    at[kv[1]] = i + 1;
  }
  if (i >= lines.length) fail(1, 'the header has no closing `---`');
  i++;
  while (i < lines.length && !lines[i].trim()) i++;
  const titleAt = i + 1;
  const first = /^#\s+(\S+)\s+(?:—|--)\s+(.*)$/.exec(lines[i] || '');
  if (!first) fail(titleAt, 'after the header comes `# CODE — title`');
  const code = first[1];
  if (!CODE_RE.test(code)) fail(titleAt, `"${code}" is not a rule code (letters, digits, hyphens)`);
  if (path.basename(file, '.md') !== code) fail(titleAt, `the file is named ${path.basename(file)} but the card says ${code}`);
  i++;
  for (const need of ['step', 'level', 'check', 'key']) if (!(need in header)) fail(1, `the header has no ${need}:`);
  if (!STEPS.has(header.step)) fail(at.step, `step "${header.step}" is not a gate step (${[...STEPS].join(', ')})`);
  checkLevel(header.level, at.level, fail);
  if (!['document', 'none'].includes(header.key)) fail(at.key, 'key: is document or none');
  if (header.baseline && !['captions', 'names', 'paths'].includes(header.baseline)) fail(at.baseline, 'baseline: is captions, names or paths');
  const local = { level: null, except: [] };
  const localAt = lines.findIndex(l => /^##\s+Local\s*$/.test(l));
  if (localAt >= 0) {
    for (let j = localAt + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (/^##\s/.test(raw)) fail(j + 1, '## Local is the last section of a card');
      const line = stripComment(raw);
      if (!line) continue;
      const kv = /^([a-z]+):\s*(.*)$/.exec(line);
      if (!kv || !LOCAL_KEYS.has(kv[1])) fail(j + 1, '## Local takes `level: ...` and `except: Module.Document` lines only');
      if (kv[1] === 'level') {
        if (header.fixed === 'yes') fail(j + 1, `${code} has no level to set`);
        checkLevel(kv[2], j + 1, fail);
        local.level = kv[2];
      } else {
        if (header.key === 'none') fail(j + 1, `${code} names no document in its findings, so it takes no except:`);
        if (!kv[2]) fail(j + 1, 'except: names a document');
        local.except.push(kv[2]);
      }
    }
  }
  return { code, title: first[2].trim(), file, header, local, doc: lines.slice(i, localAt >= 0 ? localAt : lines.length).join('\n').trim() };
}

function checkLevel(level, line, fail) {
  if (LEVELS.has(level)) return;
  const hint = level === 'error' ? ' (block?)' : level === 'warning' ? ' (warn?)' : '';
  fail(line, `level "${level}" is not block, warn, info or off${hint}`);
}

// Every card of a directory, by code; throws RulebookError on the first broken one.
// The groups: a folder of the rulebook and a file of tests/checks/ each, by gate step (the steps
// with one or two rules share app/).
const DOC_FILES = [
  ['layout', ['layout'], 'the shape of a signed-in app (skill `spacing-and-layout`)'],
  ['naming', ['naming'], 'microflows and nanoflows (`check_mdl.cjs --skill naming`, skill `naming-and-captions`)'],
  ['security', ['security'], 'the security level and the security rules (`security_rules.cjs`)'],
  ['paths', ['paths'], 'every path a user can take has a test (`check_paths.cjs`)'],
  ['catalog', ['catalog'], 'rules the model catalog answers (`catalog_rules.cjs`); mxcli lint on request'],
  ['folders', ['folders'], 'documents in process folders (`check_folders.cjs`, skill `module-structure`)'],
  ['app', ['mx', 'coverage', 'precheck', 'scope', 'unused', 'tests'], 'mx check, coverage, precheck, scope, unused, the suite, visual and runtime'],
];
// The folder a card of <step> belongs in.
const groupOf = step => (DOC_FILES.find(([, steps]) => steps.includes(step)) || ['app'])[0];

// The card files of a rulebook: <dir>/<group>/<CODE>.md (and, from before the groups, <dir>/<CODE>.md).
function cardFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      for (const name of fs.readdirSync(path.join(dir, entry.name)).sort()) {
        if (name.endsWith('.md') && !name.startsWith('_')) out.push(path.join(dir, entry.name, name));
      }
    } else if (entry.name.endsWith('.md')) out.push(path.join(dir, entry.name));
  }
  return out;
}

// Every card of a directory, by code; throws RulebookError on the first broken one, on a code that is
// in two files, and on a card in the folder of another group (URL01 is a layout rule: layout/URL01.md).
function load(dir) {
  if (!fs.existsSync(dir)) throw new RulebookError(`${dir}: no rulebook directory`);
  const cards = {};
  for (const file of cardFiles(dir)) {
    const card = parseCard(file);
    if (cards[card.code]) throw new RulebookError(`${file}:1: ${card.code} is also ${cards[card.code].file}; a rule has one card`);
    const folder = path.basename(path.dirname(file));
    if (path.resolve(path.dirname(file)) !== path.resolve(dir) && folder !== groupOf(card.header.step)) {
      throw new RulebookError(`${file}:1: ${card.code} is a ${card.header.step} rule; its card goes in ${groupOf(card.header.step)}/`);
    }
    cards[card.code] = card;
  }
  return cards;
}

const effective = card => card.local.level || card.header.level;

function levels(cards, step) {
  const out = {};
  for (const c of Object.values(cards)) if (!step || c.header.step === step) out[c.code] = effective(c);
  return out;
}

function excepts(cards, step) {
  const out = {};
  for (const c of Object.values(cards)) if ((!step || c.header.step === step) && c.local.except.length) out[c.code] = c.local.except.slice();
  return out;
}

// Only what the person changed: codes whose effective level differs from the card's default. The
// checkers take these as --levels and keep their own behaviour for every other code, so an
// untouched rulebook changes nothing. A baseline card (the paths cards: `level: block` with
// `baseline: paths`) blocks only what is new since the baseline; an explicit `level: block` in its
// ## Local means every finding blocks, as MDL_PATHS=error did, so it is passed on too.
const overridden = c => c.local.level && (c.local.level !== c.header.level || (c.header.baseline && c.local.level === 'block'));
function overrides(cards, step) {
  const out = {};
  for (const c of Object.values(cards)) if ((!step || c.header.step === step) && overridden(c)) out[c.code] = c.local.level;
  return out;
}

function digest(cards, step) {
  return crypto.createHash('sha256').update(JSON.stringify([levels(cards, step), excepts(cards, step), overrides(cards, step)])).digest('hex').slice(0, 16);
}

// What the person changed, for the step's summary line: "2 excepted (UNUSED01 Orders.X), WRITE01 raised to block".
function changes(cards, step) {
  const parts = [];
  const ex = [];
  for (const c of Object.values(cards)) {
    if (step && c.header.step !== step) continue;
    for (const k of c.local.except) ex.push(`${c.code} ${k}`);
    if (c.local.level && c.local.level !== c.header.level) {
      const up = ['off', 'info', 'warn', 'block'];
      parts.push(`${c.code} ${up.indexOf(c.local.level) > up.indexOf(c.header.level) ? 'raised' : 'lowered'} to ${c.local.level}`);
    } else if (overridden(c)) {
      parts.push(`${c.code} at block for every finding, old ones too`);
    }
  }
  if (ex.length) parts.unshift(`${ex.length} excepted (${ex.join(', ')})`);
  return parts.join(', ');
}

// For the checkers: `--levels '{CODE: level}'` and `--except '{CODE: [key]}'` out of argv (the gate
// passes the step's effective levels); returns {levels, excepts, rest} with the two flags removed.
function levelArgs(argv) {
  const rest = [], out = { levels: {}, excepts: {}, rest };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--levels') out.levels = JSON.parse(argv[++i] || '{}');
    else if (argv[i] === '--except') out.excepts = JSON.parse(argv[++i] || '{}');
    else rest.push(argv[i]);
  }
  return out;
}
// The level the gate wants for a code, or the checker's own default.
const levelOf = (levels, code, fallback) => (Object.prototype.hasOwnProperty.call(levels, code) ? levels[code] : fallback);


// A card without its ## Local section: what the installer hashes (record_install.cjs) and compares
// (shell_helpers.cjs install-freshness), so the person's level and exceptions are never "drift".
function withoutLocal(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex(l => /^##\s+Local\s*$/.test(l));
  return (at < 0 ? lines : lines.slice(0, at)).join('\n').replace(/\n+$/, '') + '\n';
}
// The ## Local section of a card as written, or '' without one.
function localOf(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex(l => /^##\s+Local\s*$/.test(l));
  return at < 0 ? '' : lines.slice(at).join('\n').replace(/\n+$/, '') + '\n';
}

// merge <bundle rulebook> into <app>/tests/rulebook: every bundle card's text replaces the installed
// one up to ## Local, and the installed ## Local (the person's) is kept word for word; a card the
// bundle does not have (the team's own) is left alone. Files starting with _ (appendices) are copied.
// Returns {written, kept, left}.
function merge(src, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  const out = { written: 0, kept: 0, left: 0 };
  // The installed cards by code, wherever they are: flat (bundles before the groups) or in a folder.
  const installed = new Map();
  for (const file of fs.existsSync(dstDir) ? cardFiles(dstDir) : []) installed.set(path.basename(file, '.md'), file);
  const bundle = new Set();
  for (const file of cardFiles(src)) {
    const code = path.basename(file, '.md');
    bundle.add(code);
    const text = fs.readFileSync(file, 'utf8');
    const target = path.join(dstDir, path.relative(src, file));
    const old = installed.get(code);
    const local = old ? localOf(fs.readFileSync(old, 'utf8')) : '';
    const merged = local ? withoutLocal(text) + '\n' + local : text;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || merged !== fs.readFileSync(target, 'utf8')) fs.writeFileSync(target, merged);
    // A card that moved into its group's folder: the old file goes, its ## Local came along.
    if (old && path.resolve(old) !== path.resolve(target)) fs.rmSync(old, { force: true });
    out.written++;
    // Kept: a ## Local with a line of the person's own (the bundle's template holds comments only).
    if (local.split('\n').slice(1).some(l => stripComment(l))) out.kept++;
  }
  // The appendix bundle 2026.10.09.2-.3 put here is checks/docs/hints.md now: not a card, not the person's.
  fs.rmSync(path.join(dstDir, '_app-appendix.md'), { force: true });
  for (const code of installed.keys()) if (!bundle.has(code)) out.left++;
  return out;
}

// The tests/harness.env switches that set a rule's level before the rulebook (bundles up to
// 2026.10.10.2), as `## Local` lines: {KEY: {value: [[CODE, 'level', level], ...]}}. A value not
// listed (the default, or one the switch never had) moves nothing.
const VISUAL = ['VIS01', 'VIS02', 'VIS03', 'VIS04', 'LOOK01', 'LOOK02', 'ALERT01'];
const CAPTIONS = ['CAPTION01', 'CAPTION02', 'CAPTION03', 'CAPTION04', 'CAPTION05', 'CAPTION06'];
const PATHS = ['OUTCOME01', 'ROLE01', 'ISO01', 'SVC01', 'WF01', 'WF02'];
const SWITCHES = {
  MDL_VISUAL: { error: VISUAL.map(c => [c, 'block']), 0: VISUAL.map(c => [c, 'off']) },
  MDL_RUNTIME_ERRORS: { error: [['RUNTIME01', 'block']], 0: [['RUNTIME01', 'off']] },
  MDL_SCOPE: { error: [['SCOPE01', 'block']] },
  MDL_CAPTIONS: { error: CAPTIONS.map(c => [c, 'block']) },
  MDL_WIDGET_NAMES: { error: [['NAME02', 'block']], 0: [['NAME01', 'off'], ['NAME02', 'off']], off: [['NAME01', 'off'], ['NAME02', 'off']] },
  MDL_PATHS: { error: PATHS.map(c => [c, 'block']) },
  MDL_REQUIRE_PRODUCTION: { 0: [['PRODUCTION01', 'off']] },
  MDL_TEST_FIRST: { 0: [['TEST01', 'off']] },
};
// MDL_UNTESTED=key,key: the card whose findings have that key's shape (check_paths.cjs joins every
// paths card's except: lines, so the card only says where a reader looks).
const untestedCard = key => key.startsWith('role:') ? 'ROLE01' : key.includes('|') ? 'ISO01' : /[/#]/.test(key) ? 'WF02' : 'OUTCOME01';
const RETIRED = [...Object.keys(SWITCHES), 'MDL_UNTESTED', 'MDL_KEEP_UNUSED'];

// KEY=value lines of a harness.env (one layer of quotes, as portable.sh reads it).
function envValues(file) {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// migrate: the retired switches of <env-file> become `## Local` lines of the app's cards. A card whose
// ## Local already sets a level keeps it; an except: already there is not repeated. Returns the
// lines written, as "CODE: level: x" / "CODE: except: y", for the install summary.
function migrate(dir, envFile) {
  const env = envValues(envFile);
  const want = [];   // [code, 'level'|'except', value, from]
  for (const [key, byValue] of Object.entries(SWITCHES)) {
    if (!(key in env)) continue;
    for (const [code, level] of byValue[env[key]] || []) want.push([code, 'level', level, key]);
  }
  const list = v => String(v || '').split(/[,\s]+/).filter(Boolean);
  for (const k of list(env.MDL_UNTESTED)) want.push([untestedCard(k), 'except', k, 'MDL_UNTESTED']);
  for (const d of list(env.MDL_KEEP_UNUSED)) want.push(['UNUSED01', 'except', d, 'MDL_KEEP_UNUSED']);
  const files = {};
  for (const file of fs.existsSync(dir) ? cardFiles(dir) : []) files[path.basename(file, '.md')] = file;
  const written = [];
  for (const [code, kind, value, from] of want) {
    const file = files[code];
    if (!file) continue;
    const card = parseCard(file);
    if (kind === 'level' && card.local.level) continue;
    if (kind === 'except' && card.local.except.includes(value)) continue;
    let text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!/^##\s+Local\s*$/m.test(text)) text += '\n\n## Local';
    text += `\n${kind}: ${value}   # moved from ${from} in tests/harness.env\n`;
    fs.writeFileSync(file, text);
    written.push(`${code}: ${kind}: ${value}`);
  }
  return written;
}

const section = (card, name) => { const m = new RegExp('^## ' + name + '\\n([\\s\\S]*?)(?=\\n## |$)', 'm').exec(card.doc); return m ? m[1].trim().replace(/\s*\n\s*/g, ' ') : ''; };
const levelNote = card => card.header.fixed === 'yes' || card.header.level === 'block' ? '' : card.header.level === 'warn' ? 'warning: ' : card.header.level === 'info' ? 'info: ' : 'off unless the rulebook turns it on: ';

function docs(cards, dir, testsDir) {
  const checksDir = path.join(testsDir, 'checks');
  fs.mkdirSync(checksDir, { recursive: true });
  const index = [];
  for (const [file, steps, what] of DOC_FILES) {
    const rows = Object.values(cards).filter(c => steps.includes(c.header.step));
    // app.md also carries the hints (checks/docs/hints.md): what the gate says in a situation that
    // is not a rule -- a CE error's fix, a stale client bundle, Studio Pro holding the model. Ours,
    // kept beside this generator, never in the person's rulebook.
    const hints = path.join(__dirname, 'docs', 'hints.md');
    const extra = file === 'app' && fs.existsSync(hints) ? fs.readFileSync(hints, 'utf8').replace(/\r\n?/g, '\n').trim() : '';
    const lines = [`# ${file} -- ${what}`, '',
      `One line per code of the \`${steps.join('`, `')}\` step${steps.length > 1 ? 's' : ''}; every code blocks DONE unless marked warning. The card: \`tests/rulebook/${file}/<CODE>.md\`.`,
      '', '| Code | Wants | Fix |', '|---|---|---|'];
    for (const c of rows) lines.push(`| \`${c.code}\` | ${levelNote(c)}${c.title} | ${section(c, 'Fix')} |`);
    if (extra) lines.push('', '## Hints: what the gate says when...', '', '| Situation | Wants | Fix |', '|---|---|---|', ...extra.split('\n'));
    fs.writeFileSync(path.join(checksDir, `${file}.md`), lines.join('\n') + '\n');
    const codes = rows.map(c => c.code).concat(extra ? [...new Set(extra.match(/`(CE\d{4})`/g) || [])].map(c => c.replace(/`/g, '')) : []);
    index.push(`| ${steps.join(', ')} | \`tests/checks/${file}.md\` | ${codes.join(', ')} |`);
  }
  const head = ['# What each check code wants, and its fix', '',
    'One file per gate step; the gate names the file for the step that failed. Read that file, not',
    '`tests/gate/*.sh` or the checkers: the finding already says what to change, the file says why.',
    'Every code blocks DONE unless its line says "warning". A rule\'s card, with its level and the person\'s',
    'exceptions: `tests/rulebook/<group>/<CODE>.md`; all of them: `bash tests/rules.sh list`. Generated from the cards.',
    '', '| step | file | codes |', '|---|---|---|'];
  fs.writeFileSync(path.join(testsDir, 'CHECKS.md'), head.concat(index).join('\n') + '\n');
  return DOC_FILES.length;
}

function main() {
  const [dir, cmd, arg] = process.argv.slice(2);
  if (!dir || !cmd) { process.stderr.write('usage: rulebook.cjs <dir> check|levels|excepts|level|digest|changes|list|explain [step|CODE]\n'); return 2; }
  let cards;
  try { cards = load(dir); } catch (e) {
    if (!(e instanceof RulebookError)) throw e;
    process.stdout.write(`rulebook: ${e.message}\n`); return 2;
  }
  switch (cmd) {
    case 'check': process.stdout.write(`rulebook: ${Object.keys(cards).length} card(s) OK\n`); return 0;
    case 'levels': process.stdout.write(JSON.stringify(levels(cards, arg)) + '\n'); return 0;
    case 'overrides': process.stdout.write(JSON.stringify(overrides(cards, arg)) + '\n'); return 0;
    case 'excepts': process.stdout.write(JSON.stringify(excepts(cards, arg)) + '\n'); return 0;
    case 'level': {
      if (!cards[arg]) { process.stdout.write(`rulebook: no card ${arg}\n`); return 2; }
      process.stdout.write(effective(cards[arg]) + '\n'); return 0;
    }
    case 'digest': process.stdout.write(digest(cards, arg) + '\n'); return 0;
    case 'changes': process.stdout.write(changes(cards, arg) + '\n'); return 0;
    case 'list': {
      const rows = Object.values(cards).filter(c => !arg || c.header.step === arg);
      const w = Math.max(...rows.map(c => c.code.length));
      for (const c of rows) {
        const eff = effective(c), def = c.header.level;
        process.stdout.write(`${c.code.padEnd(w)}  ${c.header.step.padEnd(9)} ${(eff === def ? eff : `${eff} (default ${def})`).padEnd(22)} ${c.local.except.length ? 'except ' + c.local.except.join(', ') + '  ' : ''}${c.title}\n`);
      }
      return 0;
    }
    case 'explain': {
      if (!cards[arg]) { process.stdout.write(`rulebook: no card ${arg}\n`); return 2; }
      process.stdout.write(fs.readFileSync(cards[arg].file, 'utf8')); return 0;
    }
    case 'docs': {
      if (!arg) { process.stderr.write('usage: rulebook.cjs <dir> docs <tests-dir>\n'); return 2; }
      process.stdout.write(`rulebook: ${docs(cards, dir, arg)} file(s) and CHECKS.md written under ${arg}\n`); return 0;
    }
    case 'migrate': {
      // rulebook.cjs <app>/tests/rulebook migrate <old harness.env>
      for (const line of migrate(dir, arg)) process.stdout.write(`moved ${line}\n`);
      return 0;
    }
    case 'retired': {
      // The retired switches set in <harness.env>, space-separated (the installer drops them).
      process.stdout.write(RETIRED.filter(k => k in envValues(arg)).join(' ') + '\n'); return 0;
    }
    case 'merge': {
      if (!arg) { process.stderr.write('usage: rulebook.cjs <dir> merge <app-dir>\n'); return 2; }
      const r = merge(dir, path.join(arg, 'tests', 'rulebook'));
      process.stdout.write(`rulebook: ${r.written} card(s) installed, ${r.kept} with a ## Local kept, ${r.left} of the project's own left alone\n`); return 0;
    }
    default: process.stderr.write(`rulebook: unknown command ${cmd}\n`); return 2;
  }
}

// `rulebook.cjs ... list | head` closes stdout early: not an error.
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
if (require.main === module) process.exitCode = main();
module.exports = { migrate, envValues, RETIRED, parseCard, load, cardFiles, groupOf, levels, overrides, excepts, digest, changes, effective, levelArgs, levelOf, withoutLocal, localOf, merge, docs, RulebookError, LEVELS, STEPS };
