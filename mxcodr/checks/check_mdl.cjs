#!/usr/bin/env node
// Check flow MDL against the naming-and-captions rules (captions, variable names, positions).
//
// Input: .mdl files or directories (searched recursively), normally the `describe` dump from tests/gate.sh.
// Usage: check_mdl.cjs <file.mdl|dir> ... --skill naming [--captions error|warn] [--json]
// --json keys: verdict, warnings, skills, sources, lines, failures.
// Exit: 0 no failures (warnings allowed), 1 failures or no MDL found, 2 bad arguments.
//
// Rule codes (FAIL counts against the run, WARN does not):
//   CAPTION03    FAIL  if/case without @caption
//   CAPTION05    FAIL  decision caption contains $, <, >, != or " = "
//   CAPTION04    FAIL  decision caption does not end in "?"
//   CAPTION08    WARN  case caption equals its expression (mxcli overwrote it)
//   CAPTION07    FAIL  loop/while with @caption (dropped: MDL042 on a loop, silently on a while)
//   CAPTION06    FAIL  loop/while without @annotation
//   CAPTION01    FAIL  retrieve/create/change/commit/delete/set/show page/call without @caption
//   CAPTION02    FAIL  caption is the Mendix default ("Retrieve Invoice", "Commit object")
//   VAR01        FAIL  $Int1, $List2, $tmp, $x ...
//   VAR02        FAIL  name ends in _List, _Object or _Obj
//   REFRESH01    FAIL  a microflow that closes its page commits without `refresh`
//                      (the CAPTION, VAR and REFRESH rules: naming_rules.cjs)
//   PERF02 PERF03 PERF05 PERF06  WARN  a loop that only sums a retrieved list; a database call per row
//                                      in such a loop; a whole table filtered by an `if`; a loop that
//                                      only keeps the largest value (perf_rules.cjs)
//   PERF07       WARN  with --entities: a query (retrieve, page source, grid filter)
//                                      no index serves (index_rules.cjs)
//   PERF08       WARN  with --entities: an index no query in the model needs
//   EVENT01 EVENT02              FAIL  with --entities: a commit handler that commits its own object with
//                                      events (a loop); a before handler without raise error that can
//                                      return false (a silent skip) (event_rules.cjs)
//   DS01         FAIL  with --entities and --pages: a data grid, list view or gallery fed by a
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
const { withoutFolder } = require('./mxcli_client.cjs');
const py = require('./py_compat.cjs');
const { rx } = py;
const naming = require('./naming_rules.cjs');
const { finding, stripComments, checkNamingAndRefresh } = naming;
const { entityHeads, indexFindings, redundantFindings } = require('./index_rules.cjs');
const { eventFindings } = require('./event_rules.cjs');
const { dataSourceFindings } = require('./datasource_rules.cjs');

const CHECKS = { naming: checkNamingAndRefresh };

// The wording rules: a flow runs the same without them. Variable names and loop captions that
// mxcli drops stay failures.
const CAPTION_RULES = new Set(['CAPTION03', 'CAPTION05', 'CAPTION04',
  'CAPTION06', 'CAPTION01', 'CAPTION02']);

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
    const text = withoutFolder(lines.slice(start - 1, end).filter(l => !LAYOUT_ONLY.match(l)).join('\n'));
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

// With --entities: the findings that need the domain model (and --pages, the pages) beside the
// flows -- indexes (PERF07, PERF08), event and error handlers, list data sources (DS01).
// Returns [failures, warnings]; the PERF warnings stay first, the index ones right after them.
function modelFindings(lines, args, failures, warnings) {
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
  return [failures, warnings];
}

// After the first DONE (the gate passes the hashes it kept then), a microflow that is new or
// changed since the last DONE needs its captions; older ones keep them as warnings, a backlog.
// The set of those flows' names; empty without --captions-baseline.
function freshFlows(args, hashes) {
  if (args.captions_baseline === null || !py.isfile(pathStr(args.captions_baseline))) return new Set();
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
  return new Set([...hashes].filter(([name, digest]) =>
    !(Object.prototype.hasOwnProperty.call(baseline, name) && baseline[name] === digest)).map(([name]) => name));
}

// --captions warn: a caption finding in a flow that is not fresh becomes a warning; one in a fresh
// flow stays a failure and says why. Returns [failures, warnings, how many were demoted].
function demoteCaptions(lines, failures, warnings, fresh) {
  const blocks = flowBlocks(lines);
  const flowAt = line => {
    const found = blocks.find(([, start, end]) => start <= (line || 0) && (line || 0) <= end);
    return found ? found[0] : '';
  };
  for (const failure of failures) {
    if (CAPTION_RULES.has(failure.check) && fresh.has(flowAt(failure.line))) {
      failure.message += ` -- ${flowAt(failure.line)} is new or changed since the last DONE, ` +
        'so its captions are required now';
    }
  }
  const demoted = failures.filter(f => CAPTION_RULES.has(f.check) && !fresh.has(flowAt(f.line)));
  failures = failures.filter(f => !(CAPTION_RULES.has(f.check) && !fresh.has(flowAt(f.line))));
  warnings.push(...demoted.map(f => finding(f.check, f.message, f.line)));
  return [failures, warnings, demoted.length];
}

// --levels: a code the person raised or lowered in the rulebook moves to its level; off and info
// drop out. Returns [failures, warnings].
function applyLevels(levels, failures, warnings) {
  const all = failures.map(f => [f, 'fail']).concat(warnings.map(w => [w, 'warn']));
  failures = []; warnings = [];
  for (const [f, kind] of all) {
    const level = Object.prototype.hasOwnProperty.call(levels, f.check) ? levels[f.check] : null;
    if (level === 'off' || level === 'info') continue;
    (level === 'block' || (level === null && kind === 'fail') ? failures : warnings).push(f);
  }
  return [failures, warnings];
}

function printReport(report, captionWarnings) {
  const { failures, warnings } = report;
  const perf = warnings.filter(w => w.check.startsWith('PERF')).length;
  const extra = (perf ? `, ${perf} performance warning(s)` : '') + (captionWarnings ? `, ${captionWarnings} caption warning(s)` : '');
  py.print(`${report.verdict}  ${failures.length} failure(s) over ${report.lines} lines${extra}`);
  for (const failure of failures) {
    const location = failure.line ? `line ${failure.line}` : '-';
    py.print(`  - [${failure.check}] ${location}: ${failure.message}`);
  }
  for (const warning of warnings) {
    const location = warning.line ? `line ${warning.line}` : '-';
    py.print(`  ! [${warning.check}] ${location}: ${warning.message}`);
  }
}

function main() {
  // --levels: the codes the person raised or lowered in the rulebook (tests/rulebook/); every other
  // code keeps the behaviour below (--captions, the baseline), so an untouched rulebook changes nothing.
  const { levels, rest } = levelArgs(process.argv.slice(2));
  const args = parseArgs(rest);
  const sources = args.sources.map(pathStr);

  const [text, used] = collectText(sources);
  if (!py.strip(text)) {
    const message = `no MDL found in ${py.pyRepr(sources)}`;
    process.stderr.write(`FAIL  ${message}\n`);
    // --json promises a report on stdout; a caller that parses it gets the failure, not empty text.
    if (args.json) {
      py.print(py.jsonDumps({ verdict: 'FAIL', warnings: [], skills: args.skill, sources: [], lines: 0, failures: [message] },
        { indent: 2 }));
    }
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
    [failures, warnings] = modelFindings(lines, args, failures, warnings);
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
  const fresh = freshFlows(args, hashes);

  let captionWarnings = 0;
  if (args.captions === 'warn') [failures, warnings, captionWarnings] = demoteCaptions(lines, failures, warnings, fresh);
  if (Object.keys(levels).length) [failures, warnings] = applyLevels(levels, failures, warnings);

  const report = {
    verdict: !failures.length ? 'PASS' : 'FAIL',
    warnings,
    skills: args.skill,
    sources: used.map(pathStr),
    lines: lines.length,
    failures,
  };
  if (args.json) py.print(py.jsonDumps(report, { indent: 2 }));
  else printReport(report, captionWarnings);
  return !failures.length ? 0 : 1;
}

// Advice is printed in the spelling of the mxcli the harness is pinned to (mdl1_spelling.cjs).
if (require.main === module) py.setOutputFilter(require('./mdl1_spelling.cjs').advice);
if (require.main === module) process.exitCode = main();

// The rules of naming_rules.cjs, and this file's own. CAPTION_RULES (a set in Python) comes back as
// a sorted array; finding builds the finding objects.
module.exports = {
  ...naming,
  FLOW_START, LAYOUT_ONLY, CHECKS, CAPTION_RULES: [...CAPTION_RULES].sort(),
  flowBlocks, flowHashes, collectText, main,
};
