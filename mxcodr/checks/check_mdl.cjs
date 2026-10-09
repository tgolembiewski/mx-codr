#!/usr/bin/env node
// Check flow MDL against the naming-and-captions rules (captions, variable names, positions).
//
// Input: .mdl files or directories (searched recursively), normally the `describe` dump from tests/gate.sh.
// Usage: check_mdl.cjs <file.mdl|dir> ... --skill naming [--captions error|warn] [--json]
// --json keys: verdict, warnings, skills, sources, lines, failures.
// Exit: 0 no failures (warnings allowed), 1 failures or no MDL found, 2 bad arguments.
// A port of check_mdl.py that prints the same, byte for byte.
//
// Rule codes (FAIL counts against the run, WARN does not):
//   decision-caption             FAIL  if/case without @caption
//   caption-restates-expression  FAIL  decision caption contains $, <, >, != or " = "
//   caption-not-a-question       FAIL  decision caption does not end in "?"
//   case-caption-dropped         WARN  case caption equals its expression (mxcli overwrote it)
//   caption-on-loop              FAIL  loop/while with @caption (dropped: MDL042 on a loop, silently on a while)
//   loop-annotation              FAIL  loop/while without @annotation
//   action-caption               FAIL  retrieve/create/change/commit/delete/set/show page/call without @caption
//   action-caption-is-default    FAIL  caption is the Mendix default ("Retrieve Invoice", "Commit object")
//   placeholder-variable         FAIL  $Int1, $List2, $tmp, $x ...
//   type-echo-variable           FAIL  name ends in _List, _Object or _Obj
//   REFRESH01                    FAIL  a microflow that closes its page commits without `refresh`
//   PERF02 PERF03 PERF05 PERF06  WARN  a loop that only sums a retrieved list; a database call per row
//                                      in such a loop; a whole table filtered by an `if`; a loop that
//                                      only keeps the largest value (perf_rules.cjs)
//   PERF07                       WARN  with --entities: a query (retrieve, page source, grid filter)
//                                      no index serves (index_rules.cjs)
//   PERF08                       WARN  with --entities: an index no query in the model needs
//   EVENT01 EVENT02              FAIL  with --entities: a commit handler that commits its own object with
//                                      events (a loop); a before handler without raise error that can
//                                      return false (a silent skip) (event_rules.cjs)
//   DS01                         FAIL  with --entities and --pages: a data grid, list view or gallery fed by a
//                                      microflow or nanoflow that only retrieves its rows (datasource_rules.cjs)
//   EVENT03 EVENT04 ERR01        WARN  with --entities: without events skipping a commit handler; Save
//                                      changes on an entity a before-commit handler refuses with an error;
//                                      an error handler that nobody would notice
// --captions warn turns the caption rules (CAPTION_RULES) into warnings: the gate passes it by
// default, since 286 of them landed at once on a session with no test green yet.
'use strict';
const { levelArgs } = require('./rulebook.cjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const py = require('./py_compat.cjs');
const { perfFindings, rx } = require('./perf_rules.cjs');
const { entityHeads, indexFindings, redundantFindings } = require('./index_rules.cjs');
const { eventFindings } = require('./event_rules.cjs');
const { dataSourceFindings } = require('./datasource_rules.cjs');

// Any `@word rest`; group 1 is the word (caption, annotation, position).
const ANNOTATION_RE = rx(String.raw`^\s*@(\w+)\s*(.*)$`);
const CAPTION_RE = rx(String.raw`^\s*@caption\s+'(.*)'\s*$`, 'i');
const DECISION_RE = rx(String.raw`^\s*(if|case)\b`, 'i');
// A `while` is a loop, not a decision: mxcli writes no caption for it -- `@caption` passes
// `check` and `exec` and is gone from `describe`, with no MDL042 to say so -- while
// `@annotation` survives. Treated as a decision, it failed decision-caption with no way to pass:
// a Pi session spent 45 minutes on three such findings.
const LOOP_RE = rx(String.raw`^\s*(loop|while)\b`, 'i');
// Activity lines; `create` needs a qualified entity so `create microflow` is not matched.
const ACTION_RE = rx(String.raw`^\s*(?:` +
  String.raw`retrieve\b|` +
  String.raw`change\s+\$|` +
  String.raw`commit\s+\$|` +
  String.raw`delete\s+\$|` +
  String.raw`(?:\$\w+\s*=\s*)?create\s+\w+\.|` +
  String.raw`show\s+page\b|` +
  String.raw`set\s+\$|` +
  String.raw`(?:\$\w+\s*=\s*)?call\s+(?:microflow|nanoflow)\b` +
  ')', 'i');
// Mendix default captions: verb + one name ("Retrieve Invoice") or a fixed phrase ("Commit object").
const DEFAULT_ACTION_CAPTION_RE = rx(String.raw`^(?:` +
  String.raw`(?:Retrieve|Change|Commit|Delete|Create)\s+[A-Z][\w.]*|` +
  'Change variable|' +
  'Commit object|' +
  'Delete object|' +
  String.raw`Show page(?:\s+\S+)?|` +
  String.raw`Call (?:microflow|nanoflow)(?:\s+\S+)?` +
  ')$', 'i');
// Type word plus digits: $Int1, $List2, $Var10.
const PLACEHOLDER_VAR_RE = rx(String.raw`\$(?:int|bool|boolean|str|string|dec|decimal|date|datetime|list|obj|object|var|num|item)\d+\b`, 'i');
const THROWAWAY_VAR_RE = rx(String.raw`\$(?:tmp|temp|foo|bar|x|y|z|aa)\b`, 'i');
const TYPE_ECHO_VAR_RE = rx(String.raw`\$\w+_(?:list|object|obj)\b`, 'i');
// A comparison in a caption: <, >, <=, >=, != or " = ".
const COMPARISON_RE = rx(String.raw`[<>]=?|!=|\s=\s`);

// [regex, rule code, message label] for variable names.
const VARIABLE_RULES = [
  [PLACEHOLDER_VAR_RE, 'placeholder-variable', 'placeholder variable name -- name what it holds, e.g. $OpenInvoiceCount'],
  [THROWAWAY_VAR_RE, 'placeholder-variable', 'throwaway variable name -- name what it holds, e.g. $DueDate'],
  [TYPE_ECHO_VAR_RE, 'type-echo-variable', 'variable name only restates its type -- name what it holds, e.g. $OverdueInvoices'],
];

// A finding: {check, message, line}, in that key order (it is printed as JSON).
const finding = (check, message, line = null) => ({ check, message, line });

// Python's s[:n], by code point.
const head = (s, n) => [...s].slice(0, n).join('');

function stripComments(text) {
  text = py.re.sub(String.raw`/\*.*?\*/`, '', text, 0, 's');
  // Authored scripts quote identifiers, describe output does not; MDL strings use single quotes.
  text = text.split('"').join('');
  const kept = py.splitlines(text).filter(line => !py.lstrip(line).startsWith('--'));
  return kept.join('\n');
}

// [kind, raw line] of the @-annotations directly above lines[index].
function precedingAnnotations(lines, index) {
  const found = [];
  let cursor = index - 1;
  while (cursor >= 0) {
    const line = lines[cursor];
    if (!py.strip(line)) { cursor -= 1; continue; }
    const match = ANNOTATION_RE.match(line);
    if (!match) break;
    found.push([match.group(1).toLowerCase(), line]);
    cursor -= 1;
  }
  return found;
}

// Text of the parsable @caption, else "".
function captionText(annotationLines) {
  for (const [kind, raw] of annotationLines) {
    if (kind === 'caption') {
      const match = CAPTION_RE.match(raw);
      if (match) return match.group(1);
    }
  }
  return '';  // no @caption, or one that does not parse
}

const annotationKinds = annotations => annotations.map(([kind]) => kind);

// `mdl 1;` heads every document mxcli v0.25 describes; v0.24 wrote none.
const MDL1_HEADER = rx(String.raw`^\s*mdl\s+1\s*;\s*$`, 'i');
const isMdl1 = lines => lines.some(line => MDL1_HEADER.match(line));

// The expression of the split at lines[index]: what Mendix shows as its caption by default. An
// `if` runs on to its `then`, over several lines when the expression does.
function splitExpression(lines, index) {
  const first = py.strip(lines[index]);
  let text = py.strip(first.slice(py.split(first)[0].length));
  if (/^(?:if|elsif)\b/i.test(first)) {
    // v0.24 printed a long caption on one line, a line break as \n and a quote doubled.
    for (let k = index + 1; !/\bthen$/i.test(text) && k < lines.length; k++) text += '\\n    ' + py.strip(lines[k]);
    text = py.strip(text.replace(/\s*\bthen$/i, ''));
  }
  return text.split("'").join("''");
}

// v0.25 writes an `if` that is all of an `else` branch as `elsif`; v0.24 wrote the nested `if`,
// with its caption. Under `mdl 1` an `elsif` is that decision.
const ELSIF_RE = rx(String.raw`^\s*elsif\b`, 'i');

// Caption rules for an if/case/while; the bool is false when it has no @caption.
function decisionFindings(lines, index, mdl1 = false) {
  const line = lines[index];
  const annotations = precedingAnnotations(lines, index);
  let text;
  if (!annotationKinds(annotations).includes('caption')) {
    // mxcli v0.25 (`mdl 1`) leaves out a caption that is the split's own expression, as it leaves
    // out every default; v0.24 printed it. A split always has a caption in the model, so a missing
    // one there is that default, judged as v0.24's printed caption was.
    if (!mdl1) {
      return [[finding('decision-caption',
        `decision without @caption -- put @caption '<the question it answers?>' on the line above: ${head(py.strip(line), 70)}`,
        index + 1)], [], false];
    }
    text = splitExpression(lines, index);
  } else {
    text = captionText(annotations);
  }
  if (!text) return [[], [], true];
  const stripped = py.strip(line);
  const expression = py.strip(stripped.slice(py.split(stripped)[0].length));
  const isEnumSplit = stripped.toLowerCase().startsWith('case');
  if (isEnumSplit && py.strip(text) === expression) {
    // mxcli overwrites an enum case's @caption with its expression.
    return [[], [finding('case-caption-dropped',
      "mxcli wrote this split's own expression as its caption " +
      `('${text}'); measured on 11.13.0 it discards both @caption ` +
      "and @annotation on a split, so this is not the author's doing",
      index + 1)], true];
  }
  if (text.includes('$') || COMPARISON_RE.search(text)) {
    return [[finding('caption-restates-expression',
      `caption restates the expression: '${text}' -- write the business question instead, with no $, <, >, != or =, ending in '?'`,
      index + 1)], [], true];
  }
  if (!py.rstrip(text).endsWith('?')) {
    return [[finding('caption-not-a-question',
      `decision caption is not phrased as a question: '${text}' -- end it with '?', e.g. 'Is the invoice overdue?'`,
      index + 1)], [], true];
  }
  return [[], [], true];
}

// A loop or while loop needs @annotation and must not carry @caption.
function loopFindings(lines, index) {
  const line = lines[index];
  const kinds = annotationKinds(precedingAnnotations(lines, index));
  const failures = [];
  if (kinds.includes('caption')) {
    failures.push(finding('caption-on-loop',
      'loop carries @caption, which is dropped (MDL042 on a loop, silently on a while) -- write @annotation \'<why it repeats>\' above it instead',
      index + 1));
  }
  if (!kinds.includes('annotation')) {
    failures.push(finding('loop-annotation',
      `loop without @annotation -- put @annotation '<why it repeats>' on the line above: ${head(py.strip(line), 70)}`,
      index + 1));
  }
  return failures;
}

// An action needs a @caption that is not the Mendix default.
function actionFindings(lines, index) {
  const line = lines[index];
  const annotations = precedingAnnotations(lines, index);
  if (!annotationKinds(annotations).includes('caption')) {
    return [finding('action-caption',
      `action without business-operation @caption -- put @caption '<what it does for the business>' on the line above: ${head(py.strip(line), 70)}`,
      index + 1)];
  }
  const text = captionText(annotations);
  if (text && DEFAULT_ACTION_CAPTION_RE.match(py.strip(text))) {
    return [finding('action-caption-is-default',
      `action caption restates the Mendix default: '${text}' -- say what it does for the business, e.g. 'Load the open invoices'`,
      index + 1)];
  }
  return [];
}

function variableFindings(line, lineNumber) {
  const failures = [];
  for (const [regex, check, label] of VARIABLE_RULES) {
    for (const hit of regex.findall(line)) {
      const at = label.indexOf(' -- ');
      const what = at < 0 ? label : label.slice(0, at), fix = at < 0 ? '' : label.slice(at + 4);
      failures.push(finding(check, `${what}: ${hit}` + (fix ? ` -- ${fix}` : ''), lineNumber));
    }
  }
  return failures;
}

// [failures, warnings] for all naming rules.
function checkNaming(lines) {
  const failures = [], warnings = [];
  const mdl1 = isMdl1(lines);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const stripped = py.strip(line).toLowerCase();
    if (stripped.startsWith('end ') || stripped === 'end') return;
    if (DECISION_RE.match(line) || (mdl1 && ELSIF_RE.match(line))) {
      const [found, warned, hasCaption] = decisionFindings(lines, index, mdl1);
      failures.push(...found);
      warnings.push(...warned);
      if (!hasCaption) return;  // skips the variable-name rules for this line
    } else if (LOOP_RE.match(line)) {
      failures.push(...loopFindings(lines, index));
    } else if (ACTION_RE.match(line)) {
      failures.push(...actionFindings(lines, index));
    }
    failures.push(...variableFindings(line, lineNumber));
  });
  return [failures, warnings];
}

// A microflow behind a popup's Save: it commits, then `close page`. Without `refresh` the
// client is never told the object changed, so the grid under the popup still shows the old
// rows until a reload -- in every app the harness built (new invoice, new customer). The tests
// missed it: a session reloaded the page in its test (`reopen_app()`) to see the new row.
const MICROFLOW_START_RE = rx(String.raw`^create\s+(?:or\s+(?:modify|replace)\s+)?microflow\s+([\w.]+)`, 'i');
const COMMIT_STATEMENT_RE = rx(String.raw`^\s*(?:commit\s+\$\w+|change\s+\$\w+\b.*\bcommit\b)`, 'is');

// REFRESH01: in a microflow that ends in `close page`, every commit carries `refresh`.
function refreshFindings(lines) {
  const failures = [];
  let name = null, statements = [], closes = false;
  const flush = () => {
    if (!name || !closes) return;
    for (const [lineNumber, statement] of statements) {
      if (COMMIT_STATEMENT_RE.match(statement) && !py.re.search(String.raw`\brefresh\b`, statement, 'i')) {
        const target = py.re.search(String.raw`\$\w+`, statement).group(0);
        failures.push(finding('REFRESH01',
          `${name} closes its page but commits ${target} without refresh -- the grid under the ` +
          `popup keeps showing the old rows until a reload: write \`commit ${target} refresh;\` ` +
          `(or \`change ${target} (...) commit refresh;\`)`,
          lineNumber));
      }
    }
  };
  let current = '', start = null, inBody = false;
  lines.forEach((line, index) => {
    const match = MICROFLOW_START_RE.match(line);
    if (match) {
      flush();
      name = match.group(1); statements = []; closes = false; current = ''; start = null; inBody = false;
      return;
    }
    if (name === null || ANNOTATION_RE.match(line)) return;
    if (!inBody) {
      // the signature and its parameters end at `begin`
      inBody = Boolean(py.re.match(String.raw`^\s*begin\s*$`, line, 'i'));
      return;
    }
    if (py.re.match(String.raw`^end;\s*$`, line)) {
      flush();
      name = null;
      return;
    }
    if (!py.strip(current)) start = index + 1;
    current += ' ' + py.strip(line);
    if (py.rstrip(line).endsWith(';')) {
      const statement = py.strip(current);
      if (py.re.match(String.raw`close\s+page\b`, statement, 'i')) closes = true;
      statements.push([start, statement]);
      current = '';
    }
  });
  flush();
  return failures;
}

function checkNamingAndRefresh(lines) {
  const [failures, warnings] = checkNaming(lines);
  // Performance (PERF02/03/05/06, perf_rules.cjs): warnings, listed before the caption warnings.
  const perf = perfFindings(lines).map(([code, message, line]) => finding(code, message, line));
  return [[...failures, ...refreshFindings(lines)], [...perf, ...warnings]];
}

const CHECKS = { naming: checkNamingAndRefresh };

// The wording rules: a flow runs the same without them. Variable names and loop captions that
// mxcli drops stay failures.
const CAPTION_RULES = new Set(['decision-caption', 'caption-restates-expression', 'caption-not-a-question',
  'loop-annotation', 'action-caption', 'action-caption-is-default']);

const FLOW_START = rx(String.raw`^\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?:microflow|nanoflow)\s+(?P<name>[\w.]+)`, 'i');
const LAYOUT_ONLY = rx(String.raw`^\s*@(?:position|anchor|merge)\b`, 'i');

// [flow, first line, last line], 1-based, for every microflow and nanoflow in the dump.
function flowBlocks(lines) {
  const starts = [];
  lines.forEach((line, i) => {
    const m = FLOW_START.match(line);
    if (m) starts.push([i + 1, m.group('name')]);
  });
  return starts.map(([start, name], k) => [name, start, k + 1 < starts.length ? starts[k + 1][0] - 1 : lines.length]);
}

// Map {flow: hash of its text}; where its boxes sit on the canvas does not count.
function flowHashes(lines) {
  const hashes = new Map();
  for (const [name, start, end] of flowBlocks(lines)) {
    // Its folder does not count either: a move (FOLDER01) changes where a flow is, not what it does.
    const text = lines.slice(start - 1, end).filter(l => !LAYOUT_ONLY.match(l)).join('\n')
      .replace(/\bfolder\s*:?\s*'(?:[^']|'')*'\s*,?/gi, '');
    hashes.set(name, crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16));
  }
  return hashes;
}

// ---- pathlib, as check_mdl.py used it ----

// str(Path(p)): repeated and trailing separators and `.` parts dropped; backslashes on Windows.
function pathStr(p) {
  let s = py.WIN ? p.replace(/\//g, '\\') : p;
  const sep = py.WIN ? '\\' : '/';
  let drive = '';
  if (py.WIN && /^[A-Za-z]:/.test(s)) { drive = s.slice(0, 2); s = s.slice(2); }
  let root = '';
  if (s.startsWith(sep)) {
    root = !py.WIN && s.startsWith('//') && !s.startsWith('///') ? '//' : sep;
  }
  const parts = s.split(sep).filter(x => x && x !== '.');
  const out = drive + root + parts.join(sep);
  return out || '.';
}

const partsOf = p => p.split(py.WIN ? /[\\/]/ : '/').filter(Boolean);

// sorted(Path.rglob("*.mdl")): every .mdl below <dir>, not through symlinked directories, sorted
// as pathlib sorts paths (part by part; case-insensitively on Windows).
function rglobMdl(dir) {
  const found = [];
  const rx2 = py.WIN ? /^.*\.mdl$/is : /^.*\.mdl$/s;
  const walk = d => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Path(d) / name: `.` drops out, a separator is not doubled.
      const sep = py.WIN ? '\\' : '/';
      const full = d === '.' ? entry.name : d.endsWith(sep) ? d + entry.name : d + sep + entry.name;
      if (rx2.test(entry.name)) found.push(full);
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) isDir = false;
      if (isDir) walk(full);
    }
  };
  walk(dir);
  const key = p => partsOf(p).map(x => (py.WIN ? x.toLowerCase() : x));
  return py.sorted(found, key);
}

// The joined text of every .mdl under sources, and the files read; missing paths are skipped.
function collectText(sources) {
  const chunks = [], used = [];
  for (const source of sources) {
    let files;
    if (py.isdir(source)) files = rglobMdl(source);
    else files = py.exists(source) ? [source] : [];
    for (const file of files) {
      chunks.push(fs.readFileSync(file).toString('utf8').replace(/\r\n?/g, '\n'));
      used.push(file);
    }
  }
  return [chunks.join('\n'), used];
}

// ---- argparse, as check_mdl.py configured it ----

const PROG = 'check_mdl.cjs';
const USAGE = `usage: ${PROG} [-h] --skill {naming} [--captions {error,warn}] [--entities ENTITIES] [--pages PAGES]\n` +
  '                    [--expect-flows EXPECT_FLOWS] [--format FORMAT] [--flow-hashes FLOW_HASHES]\n' +
  '                    [--captions-baseline CAPTIONS_BASELINE] [--json]\n' +
  '                    sources [sources ...]';
function usageError(message) {
  process.stderr.write(`${USAGE}\n${PROG}: error: ${message}\n`);
  process.exit(2);
}

const OPTIONS = {
  '--skill': 'value', '--captions': 'value', '--entities': 'value', '--pages': 'value',
  '--expect-flows': 'value', '--format': 'value', '--flow-hashes': 'value', '--captions-baseline': 'value',
  '--json': 'flag', '--help': 'flag',
};

// Python's int() of a command-line string: optional sign, digits, underscores between digits.
function pyInt(text) {
  const t = py.strip(text);
  if (!/^[+-]?\d+(?:_\d+)*$/.test(t)) return null;
  return Number(t.replace(/_/g, ''));
}

function parseArgs(argv) {
  const args = { sources: [], skill: [], captions: 'error', entities: null, pages: null, expect_flows: 0,
    format: '', flow_hashes: null, captions_baseline: null, json: false };
  const runs = [];       // positional runs, as argparse sees them
  let current = null;
  let i = 0;
  let onlyPositional = false;
  while (i < argv.length) {
    const a = argv[i];
    if (onlyPositional || a === '-' || !a.startsWith('-') || /^-\d+$|^-\d*\.\d+$/.test(a)) {
      if (!current) { current = []; runs.push(current); }
      current.push(a);
      i++;
      continue;
    }
    current = null;
    if (a === '--') { onlyPositional = true; i++; continue; }
    if (a === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    let name = a, value = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) { name = a.slice(0, eq); value = a.slice(eq + 1); }
    // argparse accepts any unambiguous prefix of a long option.
    let matches = Object.keys(OPTIONS).filter(o => o === name);
    if (!matches.length && name.startsWith('--')) matches = Object.keys(OPTIONS).filter(o => o.startsWith(name));
    if (matches.length > 1) usageError(`ambiguous option: ${name} could match ${matches.join(', ')}`);
    if (!matches.length) {
      usageError(`unrecognized arguments: ${argv.slice(i).join(' ')}`);
    }
    const option = matches[0];
    if (option === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    if (OPTIONS[option] === 'flag') {
      if (value !== null) usageError(`argument ${option}: ignored explicit argument '${value}'`);
      args.json = true;
      i++;
      continue;
    }
    if (value === null) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-' && !/^-\d+$|^-\d*\.\d+$/.test(next))) {
        usageError(`argument ${option}: expected one argument`);
      }
      value = next;
      i += 2;
    } else i++;
    const dest = option.slice(2).replace(/-/g, '_');
    if (option === '--skill') {
      if (value !== 'naming') usageError(`argument --skill: invalid choice: '${value}' (choose from 'naming')`);
      args.skill.push(value);
    } else if (option === '--captions') {
      if (!['error', 'warn'].includes(value)) usageError(`argument --captions: invalid choice: '${value}' (choose from 'error', 'warn')`);
      args.captions = value;
    } else if (option === '--expect-flows') {
      const n = pyInt(value);
      if (n === null) usageError(`argument --expect-flows: invalid int value: '${value}'`);
      args.expect_flows = n;
    } else {
      args[dest] = value;
    }
  }
  if (!runs.length) usageError('the following arguments are required: sources, --skill');
  if (!args.skill.length) usageError('the following arguments are required: --skill');
  if (runs.length > 1) usageError(`unrecognized arguments: ${runs.slice(1).flat().join(' ')}`);
  args.sources = runs[0];
  return args;
}

function main() {
  // --levels: the codes the person raised or lowered in the rulebook (tests/rulebook/); every other
  // code keeps the behaviour below (--captions, the baseline), so an untouched rulebook changes nothing.
  const { levels, rest } = levelArgs(process.argv.slice(2));
  const args = parseArgs(rest);
  const sources = args.sources.map(pathStr);

  const [text, used] = collectText(sources);
  if (!py.strip(text)) {
    process.stderr.write(`FAIL  no MDL found in ${py.pyRepr(sources)}\n`);
    return 1;
  }

  const lines = py.splitlines(stripComments(text));

  let failures = [], warnings = [];
  for (const skill of args.skill) {
    const [skillFailures, skillWarnings] = CHECKS[skill](lines);
    failures.push(...skillFailures);
    warnings.push(...skillWarnings);
  }
  // A Path is never false: `--entities ''` is Path('.'), and counts.
  if (args.entities !== null && args.skill.includes('naming')) {
    const [entityText] = collectText([pathStr(args.entities)]);
    const [pageText] = args.pages !== null ? collectText([pathStr(args.pages)]) : ['', []];
    const documents = [...lines, ...py.splitlines(stripComments(pageText))];
    let indexes;
    if (py.strip(entityText) && !entityHeads(py.splitlines(entityText))) {
      indexes = [finding('PERF07', 'not checked: no entity was recognised in the describe text ' +
        '(a describe format index_rules.py does not read)', null)];
    } else {
      indexes = [...indexFindings(py.splitlines(entityText), documents), ...redundantFindings(py.splitlines(entityText), documents)]
        .map(([code, message, line]) => finding(code, message, line));
    }
    const perf = warnings.filter(w => w.check.startsWith('PERF'));
    warnings = [...perf, ...indexes, ...warnings.filter(w => !w.check.startsWith('PERF'))];
    // Event handlers and error handlers: the loop and the silent skip fail, the rest warn.
    for (const [code, message, line] of eventFindings(lines, entityText, pageText)) {
      (code === 'EVENT01' || code === 'EVENT02' ? failures : warnings).push(finding(code, message, line));
    }
    // A list widget fed by a flow that only retrieves its rows: a database source pages them (DS01).
    for (const [code, message, line] of dataSourceFindings(lines, pageText)) failures.push(finding(code, message, line));
  }
  const hashes = flowHashes(lines);
  // Documents were described and not one head was recognised: a describe format these rules do
  // not read. Zero findings would be a PASS for a check that saw nothing.
  if (args.expect_flows > 0 && !hashes.size) {
    py.print(`could not run -- ${args.expect_flows} microflow(s) and nanoflow(s) were described and ` +
      "none was recognised in the text: this mxcli's describe format is not one check_mdl.py reads");
    return 2;
  }
  if (args.flow_hashes !== null) {
    const record = Object.fromEntries(hashes);
    record._format = args.format;
    fs.writeFileSync(pathStr(args.flow_hashes), py.jsonDumps(record, { indent: 0, sortKeys: true }));
  }
  // After the first DONE (the gate passes the hashes it kept then), a microflow that is new or
  // changed since the last DONE needs its captions; older ones keep them as warnings, a backlog.
  let fresh = new Set();
  if (args.captions_baseline !== null && py.isfile(pathStr(args.captions_baseline))) {
    let baseline;
    try {
      baseline = JSON.parse(fs.readFileSync(pathStr(args.captions_baseline)).toString('utf8'));
    } catch {
      baseline = {};
    }
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) baseline = {};   // a damaged file is no baseline, not a crash
    // Another mxcli describes the same microflow in other words: every hash would differ and
    // the whole caption backlog would block at once. The next DONE keeps a new baseline.
    const format = Object.prototype.hasOwnProperty.call(baseline, '_format') ? baseline._format : '';
    if (format !== args.format) baseline = Object.fromEntries(hashes);
    fresh = new Set([...hashes].filter(([name, digest]) =>
      !(Object.prototype.hasOwnProperty.call(baseline, name) && baseline[name] === digest)).map(([name]) => name));
  }
  const blocks = flowBlocks(lines);
  const flowAt = line => {
    const found = blocks.find(([, start, end]) => start <= (line || 0) && (line || 0) <= end);
    return found ? found[0] : '';
  };

  let captionWarnings = 0;
  if (args.captions === 'warn') {
    for (const failure of failures) {
      if (CAPTION_RULES.has(failure.check) && fresh.has(flowAt(failure.line))) {
        failure.message += ` -- ${flowAt(failure.line)} is new or changed since the last DONE, ` +
          'so its captions are required now';
      }
    }
    const demoted = failures.filter(f => CAPTION_RULES.has(f.check) && !fresh.has(flowAt(f.line)));
    failures = failures.filter(f => !(CAPTION_RULES.has(f.check) && !fresh.has(flowAt(f.line))));
    warnings.push(...demoted.map(f => finding(f.check, f.message, f.line)));
    captionWarnings = demoted.length;
  }

  if (Object.keys(levels).length) {
    const all = failures.map(f => [f, 'fail']).concat(warnings.map(w => [w, 'warn']));
    failures = []; warnings = [];
    for (const [f, kind] of all) {
      const level = Object.prototype.hasOwnProperty.call(levels, f.check) ? levels[f.check] : null;
      if (level === 'off' || level === 'info') continue;
      (level === 'block' || (level === null && kind === 'fail') ? failures : warnings).push(f);
    }
  }
  const report = {
    verdict: !failures.length ? 'PASS' : 'FAIL',
    warnings,
    skills: args.skill,
    sources: used.map(pathStr),
    lines: lines.length,
    failures,
  };

  if (args.json) {
    py.print(py.jsonDumps(report, { indent: 2 }));
  } else {
    const perf = warnings.filter(w => w.check.startsWith('PERF')).length;
    const extra = (perf ? `, ${perf} performance warning(s)` : '') + (captionWarnings ? `, ${captionWarnings} caption warning(s)` : '');
    py.print(`${report.verdict}  ${failures.length} failure(s) over ${lines.length} lines${extra}`);
    for (const failure of failures) {
      const location = failure.line ? `line ${failure.line}` : '-';
      py.print(`  - [${failure.check}] ${location}: ${failure.message}`);
    }
    for (const warning of warnings) {
      const location = warning.line ? `line ${warning.line}` : '-';
      py.print(`  ! [${warning.check}] ${location}: ${warning.message}`);
    }
  }
  return !failures.length ? 0 : 1;
}

// Advice is printed in the spelling of the mxcli the harness is pinned to (mdl1_spelling.cjs).
if (require.main === module) py.setOutputFilter(require('./mdl1_spelling.cjs').advice);
if (require.main === module) process.exitCode = main();

// The names check_mdl.py defines (and imports). Dicts come back as plain objects, tuples as arrays;
// CAPTION_RULES (a set in Python) as a sorted array. Failure and Warning_ build the finding objects.
module.exports = {
  ANNOTATION_RE, CAPTION_RE, DECISION_RE, LOOP_RE, ACTION_RE, DEFAULT_ACTION_CAPTION_RE, PLACEHOLDER_VAR_RE,
  THROWAWAY_VAR_RE, TYPE_ECHO_VAR_RE, COMPARISON_RE, VARIABLE_RULES, MICROFLOW_START_RE, COMMIT_STATEMENT_RE,
  FLOW_START, LAYOUT_ONLY, CHECKS, CAPTION_RULES: [...CAPTION_RULES].sort(),
  Failure: finding, Warning_: finding,
  strip_comments: stripComments, preceding_annotations: precedingAnnotations, caption_text: captionText,
  annotation_kinds: annotationKinds, decision_findings: decisionFindings, loop_findings: loopFindings,
  action_findings: actionFindings, variable_findings: variableFindings, check_naming: checkNaming,
  refresh_findings: refreshFindings, check_naming_and_refresh: checkNamingAndRefresh, flow_blocks: flowBlocks,
  flow_hashes: lines => Object.fromEntries(flowHashes(lines)), collect_text: collectText, main,
  perf_findings: perfFindings, entity_heads: entityHeads, index_findings: indexFindings,
  redundant_findings: redundantFindings,
};
