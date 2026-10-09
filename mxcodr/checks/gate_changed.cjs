// gate_helpers doc-map, record-tests-seen and changed-tests: the tests a change touched (gate.sh --changed).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const py = require('./py_compat.cjs');
const { PyFloat, PyError, isDict, typeName, numeric, truthy, or, eq, hashKey, iter, get, joinStr, str, JSONError, rawDecode, loads, dumps, dict, readStrict, stdinText, statOf, walk } = require('./gate_values.cjs');

// --- gate.sh --changed: the tests a change touched ---
// A document (page, microflow, nanoflow) is one .mxunit under mprcontents/, named by its id; the
// catalog maps a qualified name to that id. After a run, each test remembers the state of the
// units its `# covers:` line names, plus one digest over every unit no test can name.
const SEEN_FILE = py.join('.mxcli', 'gate-cache', 'tests-seen.json');

// Stdin: catalog SELECT listings, each 'Found N result(s)' then a JSON list with Id and
// QualifiedName. Prints {qualified name: unit id}.
function docMap() {
  // A dict keyed by any hashable name: 1, 1.0 and True are one key, the first one inserted kept.
  const mapping = new Map();
  const text = stdinText();
  let at = 0;
  // Every JSON list in the text, wherever the "Found N result(s)" lines fall around it.
  for (;;) {
    at = text.indexOf('[', at);
    if (at < 0) break;
    let rows;
    try {
      [rows, at] = rawDecode(text, at);
    } catch (error) {
      if (!(error instanceof JSONError)) throw error;
      at += 1;
      continue;
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = or(get(row, 'QualifiedName'), get(row, 'Qualified Name'));
      const unit = get(row, 'Id');
      if (truthy(name) && truthy(unit)) {
        const key = hashKey(name);
        if (mapping.has(key)) mapping.get(key)[1] = unit;
        else mapping.set(key, [name, unit]);
      }
    }
  }
  // json.dumps(sort_keys=True): keys of one kind only (str, or numbers), numbers written as JSON keys.
  const entries = [...mapping.values()];
  const strings = entries.filter(([k]) => typeof k === 'string');
  const others = entries.filter(([k]) => typeof k !== 'string');
  if (strings.length && others.length) throw new PyError('TypeError', "'<' not supported between instances of 'int' and 'str'");
  if (others.length > 1 && others.some(([k]) => k === null)) throw new PyError('TypeError', "'<' not supported between instances of 'NoneType' and 'int'");
  const out = dict();
  if (others.length) {
    others.sort((a, b) => numeric(a[0]) - numeric(b[0]));
    // Written by hand: a JS object would put the key "5" before "1.0".
    const keyText = k => (k === null ? 'null' : k === true ? 'true' : k === false ? 'false'
      : k instanceof PyFloat ? dumps(k, null, false) : str(k));
    py.print('{\n' + others.map(([k, v]) => dumps(keyText(k), null, false) + ': ' + dumps(v, 0, true).split('\n').join('\n')).join(',\n') + '\n}');
    return 0;
  }
  for (const [k, v] of strings) out[k] = v;
  py.print(dumps(out, 0, true));
  return 0;
}

// {unit id: 'size:mtime_ns'} for every .mxunit under mprcontents/.
function unitStates(appDir) {
  const states = dict();
  for (const [folder, , files] of walk(py.join(appDir, 'mprcontents'))) {
    for (const name of files) {
      if (!name.endsWith('.mxunit')) continue;
      let st;
      try {
        st = statOf(py.join(folder, name));
      } catch {
        continue;
      }
      states[name.slice(0, -'.mxunit'.length)] = `${st.size}:${st.mtimeNs}`;
    }
  }
  return states;
}

function fileState(p) {
  try {
    const st = statOf(p);
    return `${st.size}:${st.mtimeNs}`;
  } catch {
    return 'missing';
  }
}

// One digest over the units no document name reaches.
function modelWideDigest(states, mapping) {
  const named = new Set(Object.keys(mapping).map(k => hashKey(mapping[k])));
  const digest = crypto.createHash('sha256');
  for (const unit of Object.keys(states).sort(py.compare)) {
    if (!named.has('s' + unit)) digest.update(`${unit} ${states[unit]}\n`);
  }
  return digest.digest('hex');
}

// The covers: lines, read by check_test_coverage's parser (the one the coverage check uses); a read
// error surfaces as Python's would, as it did when this file had its own copy.
function covered(testsDir) {
  try {
    return require('./check_test_coverage.cjs').covered(testsDir);
  } catch (error) {
    if (error instanceof PyError || !error.code) throw error;
    throw new PyError(error.code === 'EISDIR' ? 'IsADirectoryError' : 'OSError', String(error.message));
  }
}

// {test script name: [qualified names its # covers: line names]}.
function testClaims(appDir) {
  const byTest = new Map();
  for (const [element, scripts] of covered(py.join(appDir, 'tests'))) {
    for (const script of scripts) {
      if (!byTest.has(script)) byTest.set(script, []);
      byTest.get(script).push(element);
    }
  }
  return byTest;
}

function loadJson(file) {
  let data;
  try {
    data = loads(readStrict(file));
  } catch (error) {
    if (!(error instanceof PyError) && !(error && error.code)) throw error;
    return dict();
  }
  return isDict(data) ? data : dict();
}

function recordTestsSeen(appDir, docmapPath, scripts) {
  const mapping = loadJson(docmapPath), states = unitStates(appDir);
  const claims = testClaims(appDir), seen = loadJson(py.join(appDir, SEEN_FILE));
  const model = modelWideDigest(states, mapping);
  for (const script of scripts) {
    const name = py.basename(script);
    const covers = claims.get(name) || [];
    const units = dict();
    for (const e of covers) {
      if (!Object.prototype.hasOwnProperty.call(mapping, e)) continue;
      const unit = mapping[e];
      hashKey(unit);
      units[str(unit)] = typeof unit === 'string' && Object.prototype.hasOwnProperty.call(states, unit) ? states[unit] : 'missing';
    }
    seen[name] = Object.assign(dict(), {
      script: fileState(py.join(appDir, 'tests', name)), model, covers, units,
    });
  }
  seen._units = states;
  const file = py.join(appDir, SEEN_FILE);
  fs.mkdirSync(py.dirname(file), { recursive: true });
  fs.writeFileSync(file, dumps(seen, 0, true));
  return 0;
}

// d.get(key) on what must be a dict, for a key that may be any JSON value.
function lookup(d, key) {
  if (!isDict(d)) throw new PyError('AttributeError', `'${typeName(d)}' object has no attribute 'get'`);
  hashKey(key);
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
}

function changedTests(appDir, docmapPath) {
  const mapping = loadJson(docmapPath), states = unitStates(appDir);
  const claims = testClaims(appDir), seen = loadJson(py.join(appDir, SEEN_FILE));
  const model = modelWideDigest(states, mapping);
  const testsDir = py.join(appDir, 'tests');
  const scripts = py.isdir(testsDir)
    ? fs.readdirSync(testsDir).filter(n => n.startsWith('verify-') && n.endsWith('.test.sh')).sort(py.compare) : [];
  for (const name of scripts) {
    const label = name.slice(0, -'.test.sh'.length);
    const record = get(seen, name);
    if (!truthy(record)) {
      py.print(`RUN ${label} -- never ran under this gate`);
      continue;
    }
    if (!eq(get(record, 'script'), fileState(py.join(testsDir, name)))) {
      py.print(`RUN ${label} -- the test script changed`);
      continue;
    }
    if (!eq(get(record, 'model'), model)) {
      py.print(`RUN ${label} -- a change no test can name: the domain model, security, navigation or an enumeration`);
      continue;
    }
    const moved = [];
    for (const element of iter(get(record, 'covers', []))) {
      const unit = lookup(mapping, element);
      const before = truthy(unit) ? lookup(get(record, 'units', dict()), unit) : null;
      const now = truthy(unit) ? lookup(states, unit) : null;
      if (!eq(before, now)) moved.push(element);
    }
    if (moved.length) py.print(`RUN ${label} -- changed: ${joinStr(', ', moved)}`);
  }
  // A changed document no test names: coverage will say so; one line here saves the surprise.
  const beforeUnits = get(seen, '_units', dict());
  const named = new Set();
  for (const elements of claims.values()) for (const e of elements) named.add(e);
  const orphans = [];
  for (const name of Object.keys(mapping)) {
    const unit = mapping[name];
    if (!eq(lookup(states, unit), lookup(beforeUnits, unit)) && !named.has(name) && truthy(beforeUnits)) orphans.push(name);
  }
  orphans.sort(py.compare);
  if (orphans.length) py.print(`NOTE changed, and no test covers them: ${orphans.slice(0, 8).join(', ')}`);
  return 0;
}

module.exports = { SEEN_FILE, docMap, unitStates, fileState, modelWideDigest, covered, testClaims, loadJson, recordTestsSeen, lookup, changedTests };
