// The small jobs the test scripts give to a script: read a scenario's result, check a JSON listing,
// fingerprint the model, decode an OQL answer. One file with one subcommand per job, each the Node
// port of a Python snippet that used to sit inline in tests/*.sh (kept verbatim in the dev repo as
// tests/performance/fixtures/python-reference/shell_snippets.py).
//
//     <stdin> | node shell_helpers.cjs <subcommand> [args]
//
// A subcommand prints what its snippet printed and exits as it did: 0, the snippet's own exit
// code, or 1 where the snippet stopped on an error it did not catch.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const py = require('./py_compat.cjs');
const { re } = py;

// ---- control flow: sys.exit(n) and an uncaught exception ----
class Exit {
  constructor(code) { this.code = code; }
}
class PyError extends Error {
  constructor(type, message) {
    super(message);
    this.pyType = type;
  }
}
const exit = (code = 0) => { throw new Exit(code); };
const raise = (type, message = '') => { throw new PyError(type, message); };

// ---- JSON as Python's json module reads and writes it ----
// Python keeps 1 and 1.0 apart, ints of any size, and object keys in the order they came (JS
// objects put "1", "2" first); JSON.parse does none of that. Values: null, booleans, strings,
// BigInt for an int, PyFloat for a float, arrays, Map for an object.
class PyFloat {
  constructor(value) { this.value = value; }
}
const isMap = v => v instanceof Map;

function jsonError(message) { return new PyError('json.decoder.JSONDecodeError', message); }

// scan_once at <at>: [value, end]. No whitespace is skipped before the value, as raw_decode.
function scanValue(s, at) {
  const c = s[at];
  if (c === '"') return scanString(s, at + 1);
  if (c === '{') return scanObject(s, at + 1);
  if (c === '[') return scanArray(s, at + 1);
  if (c === 'n' && s.startsWith('null', at)) return [null, at + 4];
  if (c === 't' && s.startsWith('true', at)) return [true, at + 4];
  if (c === 'f' && s.startsWith('false', at)) return [false, at + 5];
  if (c === 'N' && s.startsWith('NaN', at)) return [new PyFloat(NaN), at + 3];
  if (c === 'I' && s.startsWith('Infinity', at)) return [new PyFloat(Infinity), at + 8];
  if (c === '-' && s.startsWith('-Infinity', at)) return [new PyFloat(-Infinity), at + 9];
  const m = /^(-?(?:0|[1-9][0-9]*))(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(s.slice(at));
  if (m && m[0]) {
    if (m[2] || m[3]) return [new PyFloat(Number(m[0])), at + m[0].length];
    return [BigInt(m[1]), at + m[0].length];
  }
  throw jsonError('Expecting value');
}
const WS = /[ \t\n\r]*/y;
function skip(s, at) {
  WS.lastIndex = at;
  WS.exec(s);
  return WS.lastIndex;
}
function scanString(s, at) {
  let out = '';
  for (;;) {
    if (at >= s.length) throw jsonError('Unterminated string starting at');
    const c = s[at];
    if (c === '"') return [out, at + 1];
    if (c === '\\') {
      const e = s[at + 1];
      if (e === undefined) throw jsonError('Unterminated string starting at');
      const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
      if (simple !== undefined) { out += simple; at += 2; continue; }
      if (e !== 'u') throw jsonError('Invalid \\escape');
      const hex = s.slice(at + 2, at + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw jsonError('Invalid \\uXXXX escape');
      let code = parseInt(hex, 16);
      at += 6;
      if (code >= 0xd800 && code <= 0xdbff && s[at] === '\\' && s[at + 1] === 'u') {
        const low = s.slice(at + 2, at + 6);
        if (/^[0-9a-fA-F]{4}$/.test(low)) {
          const lowCode = parseInt(low, 16);
          if (lowCode >= 0xdc00 && lowCode <= 0xdfff) {
            out += String.fromCharCode(code, lowCode);
            at += 6;
            continue;
          }
        }
      }
      out += String.fromCharCode(code);
      continue;
    }
    if (c < ' ') throw jsonError('Invalid control character at');
    out += c;
    at++;
  }
}
function scanObject(s, at) {
  const out = new Map();
  at = skip(s, at);
  if (s[at] === '}') return [out, at + 1];
  for (;;) {
    if (s[at] !== '"') throw jsonError('Expecting property name enclosed in double quotes');
    const [key, afterKey] = scanString(s, at + 1);
    at = skip(s, afterKey);
    if (s[at] !== ':') throw jsonError("Expecting ':' delimiter");
    at = skip(s, at + 1);
    const [value, afterValue] = scanValue(s, at);
    out.set(key, value);
    at = skip(s, afterValue);
    if (s[at] === '}') return [out, at + 1];
    if (s[at] !== ',') throw jsonError("Expecting ',' delimiter");
    at = skip(s, at + 1);
  }
}
function scanArray(s, at) {
  const out = [];
  at = skip(s, at);
  if (s[at] === ']') return [out, at + 1];
  for (;;) {
    const [value, after] = scanValue(s, at);
    out.push(value);
    at = skip(s, after);
    if (s[at] === ']') return [out, at + 1];
    if (s[at] !== ',') throw jsonError("Expecting ',' delimiter");
    at = skip(s, at + 1);
  }
}
// json.loads(text)
function loads(text) {
  if (text.startsWith('﻿')) throw jsonError('Unexpected UTF-8 BOM (decode using utf-8-sig)');
  const [value, end] = scanValue(text, skip(text, 0));
  if (skip(text, end) !== text.length) throw jsonError('Extra data');
  return value;
}
// json.JSONDecoder().raw_decode(text)
function rawDecode(text) {
  return scanValue(text, 0);
}

// repr(float): the shortest digits that read back, in Python's layout (1e+16, 1e-05, 3.0).
function floatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mantissa, exponent] = Math.abs(x).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const decpt = Number(exponent) + 1;
  if (decpt <= -4 || decpt > 16) {
    const e = decpt - 1;
    return sign + digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') +
      'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  }
  if (decpt <= 0) return sign + '0.' + '0'.repeat(-decpt) + digits;
  if (decpt >= digits.length) return sign + digits + '0'.repeat(decpt - digits.length) + '.0';
  return sign + digits.slice(0, decpt) + '.' + digits.slice(decpt);
}

// json.dumps(value, ensure_ascii=True[, indent])
function encodeString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c === '\b') out += '\\b';
    else if (c === '\f') out += '\\f';
    else if (code < 0x20 || code > 0x7e) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += c;
  }
  return out + '"';
}
function dumps(value, indent = null) {
  const itemSep = indent === null ? ', ' : ',';
  const enc = (v, level) => {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : floatJson(v);
    if (v instanceof PyFloat) return floatJson(v.value);
    if (typeof v === 'string') return encodeString(v);
    const inner = indent === null ? '' : '\n' + ' '.repeat(indent * (level + 1));
    const outer = indent === null ? '' : '\n' + ' '.repeat(indent * level);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[' + inner + v.map(x => enc(x, level + 1)).join(itemSep + inner) + outer + ']';
    }
    const entries = isMap(v) ? [...v.entries()] : Object.entries(v);
    if (!entries.length) return '{}';
    return '{' + inner + entries.map(([k, x]) => encodeString(k) + ': ' + enc(x, level + 1)).join(itemSep + inner) + outer + '}';
  };
  return enc(value, 0);
}
function floatJson(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  return floatRepr(x);
}

// str(value) and repr(value) for the values json.loads makes.
function pyRepr(v) {
  if (typeof v === 'string') {
    const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
    let out = '';
    for (const c of v) {
      const code = c.codePointAt(0);
      if (c === '\\') out += '\\\\';
      else if (c === quote) out += '\\' + c;
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0)) out += '\\x' + code.toString(16).padStart(2, '0');
      else if (c !== ' ' && /^[\p{C}\p{Zl}\p{Zp}\p{Zs}]$/u.test(c)) {
        out += code < 0x100 ? '\\x' + code.toString(16).padStart(2, '0')
          : code < 0x10000 ? '\\u' + code.toString(16).padStart(4, '0') : '\\U' + code.toString(16).padStart(8, '0');
      } else out += c;
    }
    return quote + out + quote;
  }
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
  if (isMap(v)) return '{' + [...v.entries()].map(([k, x]) => pyRepr(k) + ': ' + pyRepr(x)).join(', ') + '}';
  return pyStr(v);
}
function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : floatRepr(v);
  if (v instanceof PyFloat) return floatRepr(v.value);
  if (typeof v === 'string') return v;
  return pyRepr(v);
}
// Python's truth value.
function truthy(v) {
  if (v === null || v === undefined || v === false || v === '' || v === 0 || v === 0n) return false;
  if (v instanceof PyFloat) return v.value !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isMap(v)) return v.size > 0;
  return true;
}
const or = (a, b) => (truthy(a) ? a : b);
// d.get(key[, default]) on a dict; any other value has no .get.
function get(d, key, dflt = null) {
  if (!isMap(d)) raise('AttributeError', `'${typeName(d)}' object has no attribute 'get'`);
  return d.has(key) ? d.get(key) : dflt;
}
// d[key]
function item(d, key) {
  if (isMap(d)) {
    if (!d.has(key)) raise('KeyError', pyRepr(key));
    return d.get(key);
  }
  if (Array.isArray(d) || typeof d === 'string') {
    if (typeof key !== 'number') raise('TypeError', 'indices must be integers or slices');
    const at = key < 0 ? d.length + key : key;
    if (at < 0 || at >= d.length) raise('IndexError', 'index out of range');
    return d[at];
  }
  raise('TypeError', `'${typeName(d)}' object is not subscriptable`);
}
function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'bigint') return 'int';
  if (v instanceof PyFloat) return 'float';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return 'list';
  if (isMap(v)) return 'dict';
  return 'object';
}
// v.strip() / v.lower(): only a str has them.
function strMethod(v, name) {
  if (typeof v !== 'string') raise('AttributeError', `'${typeName(v)}' object has no attribute '${name}'`);
  return v;
}
// x in container, for the containers these snippets test.
function contains(container, x) {
  if (typeof container === 'string') {
    if (typeof x !== 'string') raise('TypeError', "'in <string>' requires string as left operand");
    return container.includes(x);
  }
  if (Array.isArray(container)) return container.some(y => equal(x, y));
  if (isMap(container)) return typeof x === 'string' && container.has(x);
  raise('TypeError', 'argument of type is not iterable');
}
// ==, for a JSON value against a str
function equal(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a === b;
}
// iter(v): the items Python's `for` walks.
function iterate(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  if (isMap(v)) return [...v.keys()];
  raise('TypeError', `'${typeName(v)}' object is not iterable`);
}

const print = (...items) => py.print(...items.map(pyStr));
// json.load(sys.stdin)
const loadStdin = () => loads(py.readStdin());

// int(text) for a str: surrounding whitespace, a sign, underscores between digits.
function pyInt(text) {
  if (typeof text !== 'string') raise('AttributeError', 'not a str');
  const m = /^[\s]*([+-]?)([0-9]+(?:_[0-9]+)*)[\s]*$/.exec(text);
  if (!m) raise('ValueError', `invalid literal for int() with base 10: ${pyRepr(text)}`);
  return BigInt(m[1] + m[2].replace(/_/g, ''));
}
function compareTuples(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

// os.walk(top), top-down, in the directory's own order (Node's readdir sorts, Python's does not).
function* walk(top) {
  let dir;
  try {
    dir = fs.opendirSync(top);
  } catch {
    return;
  }
  const dirs = [], files = [];
  try {
    for (let entry; (entry = dir.readSync());) {
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try { isDir = fs.statSync(py.join(top, entry.name)).isDirectory(); } catch { isDir = false; }
      }
      (isDir ? dirs : files).push(entry.name);
    }
  } catch {
    return;
  } finally {
    try { dir.closeSync(); } catch { /* closed */ }
  }
  yield [top, dirs, files];
  for (const name of dirs) {
    const next = py.join(top, name);
    let link = false;
    try { link = fs.lstatSync(next).isSymbolicLink(); } catch { /* gone */ }
    if (!link) yield* walk(next);
  }
}

// Read a file as open(path).read() does in text mode: strict UTF-8, universal newlines.
function readStrict(file) {
  const bytes = fs.readFileSync(file);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return text.replace(/\r\n?/g, '\n');
}
// open(path, errors="replace").read()
function readReplace(file) {
  return fs.readFileSync(file).toString('utf8').replace(/\r\n?/g, '\n');
}

const tools = {
  // tests/portable.sh mdl_json_object
  'json-object'(...a) {
    const d = new Map();
    for (let i = 0; i + 1 < a.length; i += 2) d.set(a[i], a[i + 1]);
    print(dumps(d));
  },
  // tests/portable.sh mdl_json_string
  'json-string'(text) {
    if (text === undefined) raise('IndexError', 'list index out of range');
    print(dumps(text));
  },
  // tests/portable.sh mdl_check_install_freshness: drift against tools/mdl-checks/INSTALL.json.
  'install-freshness'(app, manifestPath) {
    if (app === undefined || manifestPath === undefined) raise('ValueError', 'not enough values to unpack');
    let manifest;
    try {
      manifest = loads(readStrict(manifestPath));
    } catch {
      exit(0);
    }
    const installed = get(manifest, 'version', '?');
    const files = or(get(manifest, 'files'), new Map());
    if (!isMap(files)) raise('AttributeError', `'${typeName(files)}' object has no attribute 'items'`);
    const changed = [], missing = [];
    for (const relative of py.sorted([...files.keys()])) {
      const expected = files.get(relative);
      let actual;
      try {
        // A rulebook card is hashed without its ## Local section, as record_install.cjs recorded it.
        let bytes = fs.readFileSync(py.join(app, ...relative.split('/')));
        if (relative.startsWith('tests/rulebook/')) bytes = Buffer.from(require('./rulebook.cjs').withoutLocal(bytes.toString('utf8')));
        actual = crypto.createHash('sha256').update(bytes).digest('hex');
      } catch {
        missing.push(relative);
        continue;
      }
      if (actual !== expected) changed.push(relative);
    }
    const nameSome = (paths, limit) => {
      let shown = paths.slice(0, limit).join(', ');
      if (paths.length > limit) shown += ` and ${paths.length - limit} more`;
      return shown;
    };
    const ordered = version => {
      try {
        return strMethod(version, 'split').split('.').map(pyInt);
      } catch (error) {
        if (error instanceof PyError && (error.pyType === 'AttributeError' || error.pyType === 'ValueError')) return [];
        throw error;
      }
    };
    const name = ['mxcodr', 'dist'].find(n => py.exists(py.join(app, n, 'VERSION')));
    const bundle = name ? py.join(app, name, 'VERSION') : '';
    if (bundle) {
      let available;
      try {
        available = py.strip(readStrict(bundle));
      } catch (error) {
        if (error instanceof TypeError) throw error;
        available = '';
      }
      if (available && compareTuples(ordered(available), ordered(installed)) > 0) {
        print(`   !! the harness installed here is ${pyStr(installed)}; ${name}/ holds a newer one (${available}).`);
        print(`      An out-of-date checker passes what the current one fails:  bash ${name}/install.sh .`);
      }
    }
    if (missing.length) {
      print(`   !! ${missing.length} harness file(s) gone since install: ${nameSome(missing, 3)}`);
      print('      re-run the installer to put them back');
    }
    if (changed.length) {
      print(`   !! differs from the installed harness (${pyStr(installed)}): ${nameSome(changed, 4)}`);
      print('      either these were edited here, and the next install overwrites them -- send a');
      print('      real fix upstream -- or newer files were copied in and the VERSION stamp is stale');
    }
  },
  // tests/portable.sh mdl_user_modules: exit 1 when the listing is not a JSON list.
  'user-modules'() {
    let rows;
    try {
      rows = loadStdin();
    } catch {
      exit(1);
    }
    if (!Array.isArray(rows)) exit(1);
    for (const row of rows) {
      const source = or(get(row, 'Source'), '');
      if (!py.strip(strMethod(source, 'strip')) && !contains(['System', 'MyFirstModule', 'MxTest'], get(row, 'Module'))) {
        print(item(row, 'Module'));
      }
    }
  },
  // tests/lib/results.sh field
  field(key) {
    const raw = py.strip(py.readStdin());
    let data;
    try {
      data = loads(raw);
    } catch {
      print('');
      exit(0);
    }
    if (typeof data === 'string') data = loads(data);
    if (key === undefined) raise('IndexError', 'list index out of range');
    const value = get(data, key, '');
    print(typeof value === 'string' ? value : dumps(value));
  },
  // tests/lib/results.sh fields
  fields(...keys) {
    const raw = py.strip(py.readStdin());
    let data;
    try {
      data = loads(raw);
      if (typeof data === 'string') data = loads(data);
    } catch {
      data = new Map();
    }
    for (const key of keys) {
      const value = get(data, key, '');
      print(typeof value === 'string' ? value : dumps(value));
    }
  },
  // tests/lib/results.sh oql: the first JSON value of mxcli's answer.
  'oql-decode'() {
    const text = py.readStdin();
    const start = text.indexOf('[');
    if (start < 0) exit(1);
    let value;
    try {
      [value] = rawDecode(text.slice(start));
    } catch {
      exit(1);
    }
    print(dumps(value));
  },
  // tests/lib/results.sh oql_qualified: entities after FROM/JOIN as Module."Entity".
  'oql-qualified'(query) {
    if (!('MODULE' in process.env)) raise('KeyError', "'MODULE'");
    const module = process.env.MODULE;
    if (query === undefined) raise('IndexError', 'list index out of range');
    const entity = found => {
      const keyword = found.group(1);
      let name = found.group(2).split('"').join(''), owner;
      if (name.includes('.')) {
        const at = name.lastIndexOf('.');
        owner = name.slice(0, at);
        name = name.slice(at + 1);
      } else if (module) owner = module;
      else return found.group(0);
      return `${keyword} ${owner}."${name}"`;
    };
    // The snippet writes \" inside the set; the same pattern without the escape (py_compat's
    // translation rejects an escaped quote in a set).
    print(re.sub(String.raw`\b(FROM|JOIN)\s+("[\w.]+"|[A-Za-z_][\w.]*(?![\w."/]))`, entity, query, 0, 'i'));
  },
  // tests/lib/results.sh oql_count
  'oql-count'() {
    const rows = loadStdin();
    print(truthy(rows) ? get(item(rows, 0), 'Total', 0n) : 0n);
  },
  // tests/lib/results.sh oql_value
  'oql-value'(attribute) {
    const rows = loadStdin();
    if (!truthy(rows)) {
      print('no-such-row');
      return;
    }
    if (attribute === undefined) raise('IndexError', 'list index out of range');
    const value = get(item(rows, 0), attribute);
    if (value === null || value === '') print('empty');
    else if (typeof value === 'boolean') print(value ? 'true' : 'false');
    else print(value);
  },
  // tests/lib/scenario.sh _mdl_scenario_result: look()'s measurements to findings.jsonl.
  'scenario-result'(findingsPath, testName) {
    const raw = py.strip(py.readStdin());
    let value;
    try {
      value = loads(raw);
      if (typeof value === 'string') value = loads(value);
    } catch {
      print(raw);
      exit(0);
    }
    if (!isMap(value) || !value.has('__visual')) {
      print(raw);
      exit(0);
    }
    const seen = value.get('__visual');
    value.delete('__visual');
    if (findingsPath === undefined) raise('IndexError', 'list index out of range');
    let fd = null;
    try {
      fd = fs.openSync(findingsPath, 'a');
    } catch {
      fd = null;
    }
    if (fd !== null) {
      try {
        for (const look of iterate(seen)) {
          if (!isMap(look)) raise('TypeError', `'${typeName(look)}' object does not support item assignment`);
          if (testName === undefined) raise('IndexError', 'list index out of range');
          look.set('test', testName);
          fs.writeSync(fd, dumps(look) + '\n');
        }
      } catch (error) {
        if (!error.code) throw error;   // an OSError while writing: the snippet's `except OSError: pass`
      } finally {
        fs.closeSync(fd);
      }
    }
    print(dumps(value));
  },
  // tests/lib/sessions.sh _licence_refusal: a session refusal logged in the last 2 minutes.
  'licence-refusal'() {
    const line = py.strip(py.readStdin());
    if (!line) exit(1);
    const stamp = re.match(String.raw`(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`, line);
    if (!stamp) exit(1);
    const parts = /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/.exec(stamp.group(1));
    if (!parts) raise('ValueError', 'unconverted data');
    const [y, mo, d, h, mi, s] = parts.slice(1).map(Number);
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    // strptime's %S takes 60 and 61, but datetime() then refuses them: both raise ValueError.
    if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > days || h > 23 || mi > 59 || s > 59) {
      raise('ValueError', `time data ${pyRepr(stamp.group(1))} does not match format '%Y-%m-%d %H:%M:%S'`);
    }
    // Naive datetimes: wall-clock minus wall-clock, as Python subtracts them.
    const when = Date.UTC(y, mo - 1, d, h, mi, s);
    const n = new Date();
    const now = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds(), n.getMilliseconds());
    if ((now - when) / 1000 > 120) exit(1);
    print('the runtime refused a session: Maximum number of sessions exceeded (developer/trial licence caps concurrent sessions). Close leftover test browsers and developer tabs, or restart the runtime');
  },
  // tests/diagnose.sh persistent_entities
  'persistent-entities'() {
    for (const row of iterate(loadStdin())) {
      const name = or(get(row, 'Entity'), '');
      if (truthy(name) && !strMethod(or(get(row, 'Type'), ''), 'lower').toLowerCase().includes('non-persistent')) print(name);
    }
  },
  // tests/diagnose.sh row_count
  'row-count'() {
    const text = py.readStdin();
    const start = text.indexOf('[');
    let rows;
    try {
      [rows] = rawDecode(start < 0 ? text.slice(-1) : text.slice(start));
    } catch (error) {
      if (error instanceof Exit) throw error;
      rows = [];
    }
    print(truthy(rows) ? get(item(rows, 0), 'n', '?') : 0n);
  },
  // tests/diagnose.sh sessions_section: who is signed in, from the admin API's answer.
  'signed-in'() {
    let line;
    try {
      const f = item(loadStdin(), 'feedback');
      const users = iterate(or(get(f, 'users'), []));
      if (users.some(u => typeof u !== 'string')) raise('TypeError', 'sequence item: expected str instance');
      line = `   signed in: ${users.join(', ') || 'nobody'} (${pyStr(get(f, 'count', 0n))})`;
    } catch (error) {
      if (error instanceof Exit) throw error;
      line = '   admin port did not answer';
    }
    print(line);
  },
  // tests/precheck.sh: the key of a passed precheck -- the scripts, and mprcontents' names, sizes, times.
  'precheck-fingerprint'(...paths) {
    const h = crypto.createHash('sha256');
    for (const p of paths) h.update(fs.readFileSync(p));
    for (const [root, , files] of walk('mprcontents')) {
      for (const name of py.sorted(files)) {
        const st = fs.statSync(py.join(root, name), { bigint: true });
        h.update(Buffer.from(`${root}/${name} ${st.size} ${st.mtimeNs}\n`, 'utf8'));
      }
    }
    print(h.digest('hex').slice(0, 24));
  },
  // tests/precheck.sh: the errors the scripts add, or that name what they touch.
  'new-errors'(oldPath, ...scripts) {
    if (oldPath === undefined) raise('IndexError', 'list index out of range');
    const old = new Set(py.splitlines(readStrict(oldPath)));
    const text = scripts.map(readReplace).join(' ');
    for (const line of py.splitlines(py.readStdin())) {
      if (!line) continue;
      const names = re.findall(String.raw`'([A-Za-z_]\w*\.[A-Za-z_]\w*)'`, line);
      if (!old.has(line) || names.some(name => text.includes(name))) print(line);
    }
  },
  // tests/gate/preflight.sh log_age: whole seconds since the file last changed.
  'log-age'(file) {
    if (file === undefined) raise('IndexError', 'list index out of range');
    const mtime = fs.statSync(file).mtimeMs / 1000;
    print(BigInt(Math.trunc(Date.now() / 1000 - mtime)));
  },
  // tests/gate/checks.sh: the user role names of SHOW USER ROLES --json.
  'role-names'() {
    const rows = loadStdin();
    if (!Array.isArray(rows)) exit(1);
    for (const row of rows) print(get(row, 'Name', ''));
  },
  // tests/gate/checks.sh entity_names: exit 1 on a name that is not Module.Entity.
  'entity-names'() {
    const rows = loadStdin();
    if (!Array.isArray(rows)) exit(1);
    for (const row of rows) {
      let name = get(row, 'Entity');
      if (!truthy(name)) name = get(row, 'Qualified Name');
      if (!truthy(name)) name = get(row, 'QualifiedName');
      if (!truthy(name)) continue;
      if (typeof name !== 'string') raise('TypeError', 'expected string or bytes-like object');
      if (!re.fullmatch(String.raw`[A-Za-z_]\w*\.[A-Za-z_]\w*`, name)) exit(1);
      print(name);
    }
  },
  // tests/gate/checks.sh describe_entities_into: one file per entity from one describe.
  'split-entities'(allPath, dir) {
    if (allPath === undefined) raise('IndexError', 'list index out of range');
    const text = readStrict(allPath);
    const lines = text.split(/(?<=\n)/).filter(Boolean);
    const out = new Map();
    let current = null, pending = [];
    const head = re.compile(String.raw`\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?:\S+\s+)?entity\s+([\w.]+)`, 'i');
    for (const line of lines) {
      const m = head.match(line);
      if (m) {
        current = m.group(1);
        out.set(current, pending);
        pending = [];
      }
      // An entity also ends where the next description's `mdl 1;` header starts: mxcli 0.25
      // writes no `/`, and the doc comment under the header belongs to the next entity.
      if (current && !m && /^mdl\s+\d+\s*;$/.test(py.strip(line))) current = null;
      if (current) {
        out.get(current).push(line);
        if (py.strip(line) === '/') current = null;
      } else {
        pending.push(line); // the doc comment and position above the next entity
      }
    }
    for (const [name, chunk] of out) {
      if (dir === undefined) raise('IndexError', 'list index out of range');
      fs.writeFileSync(dir + '/' + name + '.mdl', chunk.join(''));
    }
  },
  // tests/run-app.sh point_config_at_postgres
  'point-config'(...args) {
    if (args.length < 6) raise('ValueError', 'not enough values to unpack');
    const [app, host, name, user, password, port] = args;
    const file = py.join(app, 'deployment', 'model', 'config.json');
    const cfg = loads(readStrict(file));
    const configuration = item(cfg, 'Configuration');
    if (!isMap(configuration)) raise('AttributeError', `'${typeName(configuration)}' object has no attribute 'update'`);
    for (const [k, v] of [['DatabaseType', 'PostgreSQL'], ['DatabaseHost', host], ['DatabaseName', name],
      ['DatabaseUserName', user], ['DatabasePassword', password], ['ApplicationRootUrl', `http://localhost:${port}/`]]) {
      configuration.set(k, v);
    }
    fs.writeFileSync(file, dumps(cfg, 2));
  },
  // tests/run-app.sh config_json: the admin API's update_configuration request.
  'config-json'(...args) {
    if (args.length < 7) raise('ValueError', 'not enough values to unpack');
    const [base, runtime, port, host, name, user, password] = args;
    print(dumps(new Map([['action', 'update_configuration'], ['params', new Map([
      ['BasePath', base], ['RuntimePath', runtime], ['DTAPMode', 'D'],
      ['DatabaseType', 'PostgreSQL'], ['DatabaseHost', host], ['DatabaseName', name],
      ['DatabaseUserName', user], ['DatabasePassword', password],
      ['ApplicationRootUrl', `http://localhost:${port}/`],
      ['MicroflowConstants', new Map([
        ['FeedbackModule.LocalStorageKey', 'mxfeedback-form-data'],
        ['FeedbackModule.ClientIdentifier', 'Feedback Module 4.0.2']])],
    ])]])));
  },
  // examples/verify-customer-unpaid.test.sh: the Total of the first row, 0 when none.
  // tests/gate/tests.sh syntax_notes: `scenario '...'` bodies an apostrophe cut short. Bash ends the
  // single-quoted body at the first ' -- `// the customer's order` in a comment -- and the rest of
  // the JS runs as shell words; the file can still parse, and the scenario then "returns nothing".
  // Prints `<line>: <the text around it>` for a closing quote followed straight by a letter.
  'scenario-quotes'(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    const re = /\bscenario\s+'/g;
    let m;
    while ((m = re.exec(text))) {
      const close = text.indexOf("'", m.index + m[0].length);
      if (close < 0) break;
      if (/[A-Za-z0-9_]/.test(text[close + 1] || '')) {
        const line = text.slice(0, close).split('\n').length;
        const from = text.lastIndexOf('\n', close) + 1;
        print(`${line}: ${text.slice(from, text.indexOf('\n', close) < 0 ? undefined : text.indexOf('\n', close)).trim().slice(0, 120)}`);
      }
      re.lastIndex = close + 1;
    }
  },
  'oql-total'() {
    const rows = loadStdin();
    print(truthy(rows) ? item(item(rows, 0), 'Total') : 0n);
  },
};

const [name, ...args] = process.argv.slice(2);
if (!Object.prototype.hasOwnProperty.call(tools, name)) {
  process.stderr.write(`shell_helpers.cjs: no subcommand ${name}; one of ${Object.keys(tools).join(', ')}\n`);
  process.exit(2);
}
try {
  tools[name](...args);
} catch (error) {
  if (error instanceof Exit) {
    process.exitCode = error.code;
  } else {
    // What Python printed for an exception it did not catch: a traceback, exit 1.
    const type = error instanceof PyError ? error.pyType : error.code === 'ENOENT' ? 'FileNotFoundError' : error.name;
    process.stderr.write(`Traceback (most recent call last):\n${type}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
