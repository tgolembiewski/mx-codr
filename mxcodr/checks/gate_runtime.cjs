// gate_helpers deployment-age, runtime-age, watch-state and runtime-errors: the app's build and runtime.
'use strict';
const py = require('./py_compat.cjs');
const { re } = py;
const { isDict, or, eq, iter, head, get, needStr, firstChars, str, JSONError, rawDecode, dict, readReplace, getmtime, fromTimestamp, parseLstart } = require('./gate_values.cjs');

function deploymentAge(mpr, built) {
  let gap;
  try {
    gap = Math.trunc(getmtime(mpr) - getmtime(built));
  } catch {
    return 0;
  }
  if (gap > 5) {
    py.print(`   !! the model is ${gap}s newer than the built deployment -- this run measures the OLD app`);
    py.print('      rebuild before trusting anything green here');
  }
  return 0;
}

function runtimeAge(mpr, started) {
  const boot = parseLstart(py.split(started).join(' '));
  if (boot === null) return 0;
  let changed;
  try {
    changed = fromTimestamp(getmtime(mpr));
  } catch {
    return 0;     // no .mpr to compare: nothing to say, as deployment-age does
  }
  const gap = (changed - boot) / 1e6;
  if (gap > 5) {
    py.print(`   !! the model changed ${Math.trunc(gap)}s after the runtime started and nothing applied it` +
      ' (no --watch reload or restart logged) -- this run measures the old app:');
    py.print('      bash tests/gate.sh --restart');
  }
  return 0;
}


const WATCH_EVENTS = [['Watching model', 'ready'], ['Change detected, rebuilding', 'building'],
  ['applied via', 'applied'], ['build failed', 'failed']];

function watchState(file) {
  let lines;
  try {
    lines = py.splitlines(readReplace(file));
  } catch {
    return 0;
  }
  let state = '', at = 0;
  lines.forEach((line, index) => {
    for (const [marker, name] of WATCH_EVENTS) {
      if (line.includes(marker)) { state = name; at = index; }
    }
  });
  py.print(state);
  if (state === 'failed') for (const error of watchBuildErrors(lines.slice(at))) py.print(error);
  return 0;
}

// "CE0116 <message> (Page 'X', Action button 'y')" per error in the problems JSON under a
// "build failed" line; the "build failed" line itself when there is no JSON to read.
function watchBuildErrors(lines) {
  const text = lines.join('\n');
  const start = text.indexOf('{');
  let report = null;
  if (start >= 0) {
    try {
      report = rawDecode(text.slice(start), 0)[0];
    } catch (error) {
      if (!(error instanceof JSONError)) throw error;
      report = null;
    }
  }
  const problems = get(or(report, dict()), 'problems', dict());
  const errors = [];
  for (const problem of isDict(problems) ? iter(get(problems, 'problems', [])) : []) {
    if (!eq(get(problem, 'severity'), 'Error')) continue;
    const where = head(get(problem, 'locations', []), 1);
    const parts = iter(where).map(place => `${str(get(place, 'document', ''))}, ${str(get(place, 'element', ''))}`);
    const whereText = parts.join('; ');
    const code = str(or(get(problem, 'errorCode'), ''));
    const message = py.strip(needStr(get(problem, 'message', ''), 'strip'));
    errors.push(`${code} ${message}${whereText ? ` (${whereText})` : ''}`);
  }
  return errors.length ? errors : [py.strip(lines[0])];
}

// --- runtime-errors: what the server logged while the tests ran ---

const LOG_LINE_RE = re.compile(String.raw`^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.\d+ (ERROR|CRITICAL) - (.*)$`);
// What a restart or a client re-bundle logs on its own, not something a test did.
const LOG_NOISE_RE = re.compile(String.raw`Connector: 404 - file not found for file: dist|M2EE: An error occurred while ` +
  String.raw`executing action 'shutdown'|M2EE: An exception occurred during Runtime shutdown|` +
  String.raw`Maximum number of sessions exceeded`);
// "LivePreview: null" is an OQL query over the admin API that failed; the query is on a following line.
const OQL_REQUEST_RE = re.compile(String.raw`GetRequest \(depth = -?\d+\): (.*)$`);

function runtimeErrors(file, since) {
  const seen = new Map(), order = [];
  let lines;
  try {
    lines = py.splitlines(readReplace(file));
  } catch {
    return 0;
  }
  lines.forEach((line, index) => {
    const found = LOG_LINE_RE.match(py.rstrip(line));
    if (!found || py.compare(found.group(1), since) < 0 || LOG_NOISE_RE.search(found.group(3))) return;
    let message = found.group(3);
    if (py.strip(message) === 'LivePreview: null') {
      let query = '';
      for (const l of lines.slice(index + 1, index + 4)) {
        const m = OQL_REQUEST_RE.search(l);
        if (m) { query = m.group(1); break; }
      }
      message = "an OQL query over the admin API failed (mxcli oql, a test's data check)" + (query ? ': ' + query : '');
    }
    message = firstChars(re.sub(String.raw`\s+`, ' ', message), 200);
    if (!seen.has(message)) order.push(message);
    seen.set(message, (seen.get(message) || 0) + 1);
  });
  for (const message of order.slice(0, 6)) {
    const times = seen.get(message) > 1 ? ` (${seen.get(message)} times)` : '';
    py.print(`   - [RUNTIME01] the server logged while the tests ran: ${message}${times}`);
  }
  if (order.length > 6) py.print(`   - [RUNTIME01] ... and ${order.length - 6} more distinct errors in the runtime log`);
  return 0;
}

// The widget names a script declares, per page: `create ... page Module.Name` up to the next create.

module.exports = { deploymentAge, runtimeAge, WATCH_EVENTS, watchState, watchBuildErrors, LOG_LINE_RE, LOG_NOISE_RE, OQL_REQUEST_RE, runtimeErrors };
