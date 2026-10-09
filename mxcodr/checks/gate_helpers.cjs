#!/usr/bin/env node
// What tests/gate.sh needs from a script, one subcommand per job.
//
//     gate_helpers.cjs qualified-names               names from a SHOW ... --json listing on stdin
//     gate_helpers.cjs fingerprint <path>...         one digest over files, meta:<path> and env:NAME=value
//     gate_helpers.cjs secret                        a random 32-hex-digit cache secret
//     gate_helpers.cjs signed-in-users               user names from an M2EE get_logged_in_user_names answer on stdin
//     gate_helpers.cjs recent-refusal [seconds]      timestamp of a session-cap refusal line on stdin, if recent (120)
//     gate_helpers.cjs deployment-age <mpr> <built>  warn when the model is newer than the built deployment
//     gate_helpers.cjs runtime-age <mpr> <lstart>    warn when the model changed after the runtime started
//     gate_helpers.cjs missing-browser <config>      the executablePath a Playwright config names, if it is missing
//     gate_helpers.cjs duplicate-definitions <mdl>... documents these scripts create that another script
//                                                   in the same folder creates too (SCRIPT01)
//     gate_helpers.cjs test-first <app> <mpr> <mdl>... pages and ACT_ microflows these scripts create that
//                                                   no tests/verify-*.test.sh covers yet (TEST01)
//     gate_helpers.cjs watch-state <boot-log>        where a --watch boot is: ready, building, applied or
//                                                   failed; after failed, one line per build error
//     gate_helpers.cjs runtime-errors <runtime.log> <since>
//                                                   the ERROR/CRITICAL lines logged at or after <since>
//                                                   ('YYYY-MM-DD HH:MM:SS'), one per distinct message
//     gate_helpers.cjs visual-report <findings.jsonl> [<scripts-dir>] [--review <dir>]
//                                                   one warning line per page problem look() measured;
//                                                   with --review, the screenshots still to be judged
//     gate_helpers.cjs doc-map                        {qualified name: unit id} from catalog SELECT
//                                                   listings (pages, microflows, nanoflows) on stdin
//     gate_helpers.cjs record-tests-seen <app-dir> <doc-map.json> <test.sh>...
//                                                   remember the model state each of these tests ran on
//     gate_helpers.cjs changed-tests <app-dir> <doc-map.json>
//                                                   RUN <test> -- <why> for each test whose covered
//                                                   documents changed since it last ran (gate.sh --changed)
//
// Exit 0 unless noted: qualified-names exits 1 when stdin is not a JSON list.
// Warnings are printed to stdout, ready to show under the gate's output.
//
// The Node port of gate_helpers.py (2026-10-05): the same output on the same input. JSON is read
// the way Python's json module reads it (an integral float stays 1.0, NaN and Infinity parse), and
// a value of the wrong type stops the subcommand with exit 1, as the Python's exception did.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const py = require('./py_compat.cjs');
const { re } = py;

// ---- Python values: what json.loads returns, and how str(), ==, `in` and iteration treat it ----

// A JSON number with a fraction or an exponent: Python's float, which prints as 1.0, not 1.
class PyFloat {
  constructor(v) { this.v = v; }
}

// An exception the Python raised: exit 1, the last traceback line on stderr.
class PyError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

const isDict = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyFloat);
function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number' || typeof v === 'bigint') return 'int';
  if (v instanceof PyFloat) return 'float';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return 'list';
  return 'dict';
}
const numeric = v => (typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof PyFloat ? v.v : typeof v === 'bigint' ? Number(v) : v);
const isNumber = v => typeof v === 'boolean' || typeof v === 'number' || typeof v === 'bigint' || v instanceof PyFloat;

function truthy(v) {
  if (v === null || v === undefined || v === false || v === '') return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'bigint') return v !== 0n;
  if (v instanceof PyFloat) return v.v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}
const or = (...values) => {
  for (const v of values) if (truthy(v)) return v;
  return values[values.length - 1];
};

// ==, deep as Python compares lists and dicts.
function eq(a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (isNumber(a) && isNumber(b)) {
    if (typeof a === 'bigint' && typeof b === 'bigint') return a === b;
    return numeric(a) === numeric(b);
  }
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, b[i]));
  }
  if (isDict(a) && isDict(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => k in b && eq(a[k], b[k]));
  }
  return false;
}

// The key a value has in a Python set or dict: 1, 1.0 and True are one key; lists and dicts have none.
function hashKey(v) {
  if (v === null || v === undefined) return 'z';
  if (typeof v === 'string') return 's' + v;
  if (isNumber(v)) return 'n' + (typeof v === 'bigint' ? v.toString() : String(numeric(v)));
  throw new PyError('TypeError', `unhashable type: '${typeName(v)}'`);
}

// for x in v
function iter(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  if (isDict(v)) return Object.keys(v);
  throw new PyError('TypeError', `'${typeName(v)}' object is not iterable`);
}
// v[:n]
function head(v, n) {
  if (Array.isArray(v)) return v.slice(0, n);
  if (typeof v === 'string') return [...v].slice(0, n).join('');
  if (isDict(v)) throw new PyError('TypeError', "unhashable type: 'slice'");
  throw new PyError('TypeError', `'${typeName(v)}' object is not subscriptable`);
}
// d.get(key, default) on what must be a dict
function get(d, key, dflt = null) {
  if (!isDict(d)) throw new PyError('AttributeError', `'${typeName(d)}' object has no attribute 'get'`);
  return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : dflt;
}
function needStr(v, method) {
  if (typeof v !== 'string') throw new PyError('AttributeError', `'${typeName(v)}' object has no attribute '${method}'`);
  return v;
}
// sep.join(items): every item a str
function joinStr(sep, items) {
  const list = iter(items);
  list.forEach((x, i) => {
    if (typeof x !== 'string') throw new PyError('TypeError', `sequence item ${i}: expected str instance, ${typeName(x)} found`);
  });
  return list.join(sep);
}
// s[:n] on a str, by code point
const firstChars = (s, n) => [...s].slice(0, n).join('');

// repr(float), the shortest digits that read back, in Python's layout (1e-05, 1e+16, 1.0).
function floatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mantissa, exp] = x.toExponential().split('e');
  const n = Number(exp);
  const sign = mantissa.startsWith('-') ? '-' : '';
  const digits = mantissa.replace('-', '').replace('.', '');
  if (n < -4 || n >= 16) {
    const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
    return `${sign}${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  let fixed;
  if (n < 0) fixed = '0.' + '0'.repeat(-n - 1) + digits;
  else if (digits.length > n + 1) fixed = digits.slice(0, n + 1) + '.' + digits.slice(n + 1);
  else fixed = digits + '0'.repeat(n + 1 - digits.length) + '.0';
  return sign + fixed;
}

const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
function strRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const c of s) {
    const code = c.codePointAt(0);
    if (c === '\\') out += '\\\\';
    else if (c === quote) out += '\\' + c;
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
    else if (code >= 0x80 && c !== ' ' && NOT_PRINTABLE.test(c)) {
      if (code <= 0xff) out += '\\x' + code.toString(16).padStart(2, '0');
      else if (code <= 0xffff) out += '\\u' + code.toString(16).padStart(4, '0');
      else out += '\\U' + code.toString(16).padStart(8, '0');
    } else out += c;
  }
  return quote + out + quote;
}
function repr(v) {
  if (typeof v === 'string') return strRepr(v);
  if (Array.isArray(v)) return '[' + v.map(repr).join(', ') + ']';
  if (isDict(v)) return '{' + Object.keys(v).map(k => strRepr(k) + ': ' + repr(v[k])).join(', ') + '}';
  return str(v);
}
// str(v)
function str(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof PyFloat) return floatRepr(v.v);
  if (typeof v === 'string') return v;
  return repr(v);
}

// ---- json, as Python's json module reads and writes it ----

class JSONError extends PyError {
  constructor(message) { super('json.decoder.JSONDecodeError', message); }
}
const WS = ' \t\n\r';
const skipWs = (s, i) => { while (i < s.length && WS.includes(s[i])) i++; return i; };
const NUMBER = /(-?(?:0|[1-9][0-9]*))(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;

function parseString(s, i) {
  // s[i] is the opening quote.
  let out = '';
  i++;
  for (;;) {
    if (i >= s.length) throw new JSONError('Unterminated string starting at');
    const c = s[i];
    if (c === '"') return [out, i + 1];
    if (c === '\\') {
      const e = s[i + 1];
      if (e === undefined) throw new JSONError('Unterminated string starting at');
      const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
      if (simple !== undefined) { out += simple; i += 2; continue; }
      if (e === 'u') {
        const hex = s.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JSONError('Invalid \\uXXXX escape');
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      throw new JSONError('Invalid \\escape');
    }
    if (c.charCodeAt(0) < 0x20) throw new JSONError('Invalid control character at');
    out += c;
    i++;
  }
}

// json.JSONDecoder().raw_decode(s, i): [value, end]; no whitespace skipped before the value.
function rawDecode(s, i) {
  const c = s[i];
  if (c === '"') return parseString(s, i);
  if (c === '{') {
    const obj = Object.create(null);
    i = skipWs(s, i + 1);
    if (s[i] === '}') return [obj, i + 1];
    for (;;) {
      if (s[i] !== '"') throw new JSONError('Expecting property name enclosed in double quotes');
      const [key, afterKey] = parseString(s, i);
      i = skipWs(s, afterKey);
      if (s[i] !== ':') throw new JSONError("Expecting ':' delimiter");
      i = skipWs(s, i + 1);
      const [value, afterValue] = rawDecode(s, i);
      obj[key] = value;
      i = skipWs(s, afterValue);
      if (s[i] === '}') return [obj, i + 1];
      if (s[i] !== ',') throw new JSONError("Expecting ',' delimiter");
      i = skipWs(s, i + 1);
    }
  }
  if (c === '[') {
    const list = [];
    i = skipWs(s, i + 1);
    if (s[i] === ']') return [list, i + 1];
    for (;;) {
      const [value, after] = rawDecode(s, i);
      list.push(value);
      i = skipWs(s, after);
      if (s[i] === ']') return [list, i + 1];
      if (s[i] !== ',') throw new JSONError("Expecting ',' delimiter");
      i = skipWs(s, i + 1);
    }
  }
  if (c === 'n' && s.startsWith('null', i)) return [null, i + 4];
  if (c === 't' && s.startsWith('true', i)) return [true, i + 4];
  if (c === 'f' && s.startsWith('false', i)) return [false, i + 5];
  NUMBER.lastIndex = i;
  const m = NUMBER.exec(s);
  if (m) {
    if (m[2] || m[3]) return [new PyFloat(parseFloat(m[0])), i + m[0].length];
    const n = Number(m[1]);
    return [Number.isSafeInteger(n) ? (n === 0 ? 0 : n) : BigInt(m[1]), i + m[0].length];
  }
  if (c === 'N' && s.startsWith('NaN', i)) return [new PyFloat(NaN), i + 3];
  if (c === 'I' && s.startsWith('Infinity', i)) return [new PyFloat(Infinity), i + 8];
  if (c === '-' && s.startsWith('-Infinity', i)) return [new PyFloat(-Infinity), i + 9];
  throw new JSONError('Expecting value');
}

// json.loads(s)
function loads(s) {
  if (s.startsWith('\ufeff')) throw new JSONError('Unexpected UTF-8 BOM (decode using utf-8-sig)');
  const [value, end] = rawDecode(s, skipWs(s, 0));
  if (skipWs(s, end) !== s.length) throw new JSONError('Extra data');
  return value;
}

// json.dumps(value, indent=..., sort_keys=...) with ensure_ascii.
function dumps(value, indent, sortKeys) {
  const pad = indent == null ? null : ' '.repeat(indent);
  const [itemSep, keySep] = pad == null ? [', ', ': '] : [',', ': '];
  const quote = s => JSON.stringify(s).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const enc = (v, level) => {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof PyFloat) {
      if (Number.isNaN(v.v)) return 'NaN';
      if (!Number.isFinite(v.v)) return v.v > 0 ? 'Infinity' : '-Infinity';
      return floatRepr(v.v);
    }
    if (typeof v === 'string') return quote(v);
    const inner = pad == null ? '' : '\n' + pad.repeat(level + 1);
    const outer = pad == null ? '' : '\n' + pad.repeat(level);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[' + inner + v.map(x => enc(x, level + 1)).join(itemSep + inner) + outer + ']';
    }
    let keys = Object.keys(v);
    if (!keys.length) return '{}';
    if (sortKeys) keys = keys.sort(py.compare);
    return '{' + inner + keys.map(k => quote(k) + keySep + enc(v[k], level + 1)).join(itemSep + inner) + outer + '}';
  };
  return enc(value, 0);
}
// A plain object for a Python dict built here (null prototype, like the parsed ones).
const dict = () => Object.create(null);

// ---- reading, as Python's text mode reads ----

const universal = text => text.replace(/\r\n?/g, '\n');
// open(path, encoding="utf-8", errors="replace").read()
function readReplace(file) {
  return universal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(fs.readFileSync(file)));
}
// open(path, encoding="utf-8").read(): a byte that is not UTF-8 raises.
function readStrict(file) {
  const bytes = fs.readFileSync(file);
  try {
    return universal(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new PyError('UnicodeDecodeError', "'utf-8' codec can't decode bytes");
  }
}
// sys.stdin.read(): strict UTF-8; universal newlines on Windows only, as CPython sets it up.
function stdinText() {
  let bytes;
  try {
    bytes = fs.readFileSync(0);
  } catch {
    bytes = Buffer.alloc(0);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new PyError('UnicodeDecodeError', "'utf-8' codec can't decode bytes");
  }
  return py.WIN ? universal(text) : text;
}
const statOf = p => fs.statSync(p, { bigint: true });
// os.path.getmtime: seconds as Python's float has them, sec + nsec * 1e-9.
function getmtime(p) {
  const ns = statOf(p).mtimeNs;
  return Number(ns / 1000000000n) + Number(ns % 1000000000n) * 1e-9;
}
// os.path.abspath on this platform.
function abspath(p) {
  if (path.isAbsolute(p)) return py.normpath(p);
  return py.normpath(process.cwd() + (py.WIN ? '\\' : '/') + p);
}

// os.walk(top) with followlinks=False: [root, dirs, files]; dirs may be sorted in place.
function* walk(top) {
  let entries;
  try {
    entries = fs.readdirSync(top, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = [], files = [];
  for (const entry of entries) {
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(py.join(top, entry.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    (isDir ? dirs : files).push(entry.name);
  }
  yield [top, dirs, files];
  for (const name of dirs) {
    const next = py.join(top, name);
    let link = false;
    try { link = fs.lstatSync(next).isSymbolicLink(); } catch { link = false; }
    if (!link) yield* walk(next);
  }
}

// int(text) for an argument: surrounding whitespace, a sign, digits with single underscores.
function pyInt(text) {
  const t = py.strip(text);
  if (!/^[+-]?[0-9]+(?:_[0-9]+)*$/.test(t)) throw new PyError('ValueError', `invalid literal for int() with base 10: ${strRepr(text)}`);
  return Number(t.replace(/_/g, ''));
}

// ---- datetime, naive local time as Python's datetime has it ----

const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
// A naive date and time as a count of microseconds, or null when datetime() would raise.
function naive(y, mo, d, h, mi, s, us = 0) {
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, 0);
  return t.getTime() * 1000 + us;
}
// datetime.now()
function nowNaive() {
  const t = new Date();
  return naive(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds() * 1000);
}
// round(x) half to even
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
// datetime.fromtimestamp(t), naive local
function fromTimestamp(t) {
  let whole = Math.trunc(t);
  let us = roundHalfEven((t - whole) * 1e6);
  if (us >= 1e6) { us -= 1e6; whole += 1; } else if (us < 0) { us += 1e6; whole -= 1; }
  const d = new Date(whole * 1000);
  return naive(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), us);
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// strptime(text, "%a %b %d %H:%M:%S %Y") in the C locale, or null where it raises ValueError.
const LSTART_RE = new RegExp('^(?:' + WEEKDAYS.join('|') + ')\\s+(' + MONTHS.join('|') + ')\\s+' +
  '(3[01]|[12][0-9]|0[1-9]|[1-9]| [1-9])\\s+(2[0-3]|[0-1][0-9]|[0-9]):([0-5][0-9]|[0-9]):(6[0-1]|[0-5][0-9]|[0-9])\\s+([0-9]{4})$', 'i');
function parseLstart(text) {
  const m = LSTART_RE.exec(text);
  if (!m) return null;
  return naive(Number(m[6]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

// ---- the subcommands ----

function qualifiedNames() {
  const rows = loads(stdinText());
  if (!Array.isArray(rows)) return 1;
  const names = rows.map(row => or(get(row, 'Qualified Name'), get(row, 'QualifiedName')));
  // The names become MDL statements and file names: anything that is not Module.Name is refused.
  for (const name of names) {
    if (!truthy(name)) continue;
    if (typeof name !== 'string') throw new PyError('TypeError', 'expected string or bytes-like object');
    if (!re.fullmatch(String.raw`[A-Za-z_]\w*\.[A-Za-z_]\w*`, name)) return 1;
  }
  for (const name of names) if (truthy(name)) py.print(name);
  return 0;
}

// Content of each file (size + mtime for meta:<path>), walked in sorted order.
function fingerprint(paths) {
  const digest = crypto.createHash('sha256');
  const add = (p, content) => {
    let st;
    try {
      st = statOf(p);
    } catch {
      digest.update(`missing ${p}\n`);
      return;
    }
    if (st.isDirectory()) {
      for (const [root, dirs, files] of walk(p)) {
        dirs.sort(py.compare);
        for (const name of [...files].sort(py.compare)) add(py.join(root, name), content);
      }
      return;
    }
    if (!content) {
      digest.update(`${p} ${st.size} ${st.mtimeNs}\n`);
      return;
    }
    digest.update(`${p} ${st.size}\n`);
    try {
      digest.update(fs.readFileSync(p));
    } catch {
      digest.update(`unreadable ${p}\n`);
    }
  };
  for (const arg of paths) {
    // A setting read from the environment rather than a file; the caller expands the value, so
    // it counts whether or not it was exported.
    if (arg.startsWith('env:')) digest.update(`${arg}\n`);
    else if (arg.startsWith('meta:')) add(arg.slice(5), false);
    else add(arg, true);
  }
  py.print(digest.digest('hex').slice(0, 24));
  return 0;
}

function secret() {
  py.print(crypto.randomBytes(16).toString('hex'));
  return 0;
}

function signedInUsers() {
  let feedback;
  try {
    feedback = get(loads(stdinText()), 'feedback', dict());
  } catch {
    return 0;
  }
  const users = or(get(feedback, 'users'), []);
  if (truthy(users)) py.print(joinStr(',', users));
  return 0;
}

function recentRefusal(seconds) {
  const line = py.strip(stdinText());
  const stamp = line ? re.match(String.raw`(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`, line) : null;
  if (!stamp) return 0;
  const text = stamp.group(1);
  const m = /^([0-9]{4})-(1[0-2]|0[1-9])-(3[01]|[12][0-9]|0[1-9]) (2[0-3]|[0-1][0-9]):([0-5][0-9]):(6[0-1]|[0-5][0-9])$/.exec(text);
  const when = m && naive(...m.slice(1, 7).map(Number));
  if (when === null || when === undefined) throw new PyError('ValueError', `time data ${strRepr(text)} does not match format '%Y-%m-%d %H:%M:%S'`);
  if ((nowNaive() - when) / 1e6 <= seconds) py.print(text);
  return 0;
}

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

function missingBrowser(config) {
  let options;
  try {
    const data = loads(readStrict(config));
    const index = (v, k) => {
      if (isDict(v) && Object.prototype.hasOwnProperty.call(v, k)) return v[k];
      throw new Error('missing');
    };
    options = index(index(data, 'browser'), 'launchOptions');
  } catch {
    return 0;
  }
  const p = get(options, 'executablePath');
  if (!truthy(p)) return 0;
  if (typeof p !== 'string') {
    if (typeof p === 'number' || typeof p === 'boolean' || typeof p === 'bigint') {
      if (!fdOpen(p)) py.print(str(p));
      return 0;
    }
    throw new PyError('TypeError', `stat: path should be string, bytes, os.PathLike or integer, not ${typeName(p)}`);
  }
  if (!py.exists(p)) py.print(p);
  return 0;
}

// `create [or modify|or replace] [persistent|...] <kind> Module.Name` at the start of a line.
const DEFINITION_RE = re.compile(
  String.raw`^[ \t]*create\s+(?:or\s+(?:modify|replace)\s+)?(?:(?:persistent|non-persistent|view|external)\s+)?` +
  String.raw`(?P<kind>page|snippet|layout|microflow|nanoflow|entity|enumeration|workflow|menu|constant)\s+` +
  String.raw`(?P<name>[\w"]+\.[\w"]+)`, 'im');

// Map of 'kind\0name' -> [kind, name] a script creates.
function definitions(file) {
  const found = new Map();
  let text;
  try {
    text = readReplace(file);
  } catch {
    return found;
  }
  for (const m of DEFINITION_RE.finditer(text)) {
    const kind = m.group('kind').toLowerCase(), name = m.group('name').split('"').join('');
    found.set(kind + '\0' + name, [kind, name]);
  }
  return found;
}

// TEST01: test first. A page or ACT_ microflow these scripts create that the model does not have
// yet, and that no `# covers:` line of tests/verify-*.test.sh names: one per line. The tests came
// last in every session so far -- the skill says test first, the gate checks coverage only at the
// end, and a session built the whole app, then wrote six tests in one go, three of which had never
// failed (InvoiceChaseCodr, 2026-10-05). Blocking the exec here makes the test come before the page,
// when the script that names its widgets is already written. A document that is already in the
// model (a fix to it) passes; so does anything the model cannot be read for -- never a false block.
function testFirst(args) {
  const [app, mpr, ...scripts] = args;
  const wanted = [];
  for (const script of scripts) {
    for (const [kind, name] of definitions(script).values()) {
      const leaf = name.split('.').pop();
      if (kind === 'page' || (kind === 'microflow' && leaf.startsWith('ACT_'))) wanted.push([kind, name]);
    }
  }
  if (!wanted.length) return 0;
  const coverage = require('./check_test_coverage.cjs');
  let every, own, existing, claims;
  try {
    [every, own] = coverage.projectModules(app, mpr);
    existing = new Set([...coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW PAGES')),
      ...coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW MICROFLOWS'))]);
    claims = coverage.covered(py.join(app, 'tests'));
  } catch {
    return 0;
  }
  const seen = new Set();
  for (const [kind, name] of wanted) {
    const module = name.split('.')[0];
    // The project's own modules, or one these scripts create: never a Marketplace module or System.
    // MyFirstModule counts as the project's: projectModules() leaves the template out for coverage,
    // and a session that built its whole screen there walked past this check (Qwen 3.6 Splash,
    // InvoiceChase2, 2026-10-06).
    if (every.has(module) && !own.includes(module) && module !== 'MyFirstModule') continue;
    if (existing.has(name) || claims.has(name) || seen.has(name)) continue;
    seen.add(name);
    py.print(`  - ${kind} ${name}`);
  }
  return 0;
}

// SCRIPT01: a document two scripts create is whatever the last one run says.
// The kinds mxcli 0.25 can patch with `alter <kind>`; a constant or a menu it cannot.
const ALTERABLE = new Set(['entity', 'enumeration', 'page', 'snippet', 'microflow', 'nanoflow', 'workflow']);
function duplicateDefinitions(scripts) {
  const reported = new Set();
  for (const script of scripts) {
    const own = definitions(script);
    if (!own.size) continue;
    const folder = py.dirname(script) || '.';
    // Only the owner scripts in mdlsource/: a one-off elsewhere (tools/once/) is history once it ran,
    // and an older one-off that created the same flow blocked every repair after it -- three times in
    // one InvoiceChase session (2026-10-09). Overwriting newer work is STALE01's to catch.
    if (py.basename(abspath(folder)) !== 'mdlsource') continue;
    const names = fs.readdirSync(folder).sort(py.compare);
    for (const other of names) {
      const file = py.join(folder, other);
      if (!other.endsWith('.mdl') || abspath(file) === abspath(script)) continue;
      const theirs = definitions(file);
      const both = [...own.entries()].filter(([k]) => theirs.has(k)).map(([, v]) => v);
      both.sort((a, b) => py.compare(a[0], b[0]) || py.compare(a[1], b[1]));
      for (const [kind, name] of both) {
        const pair = [abspath(script), abspath(file)].sort(py.compare);
        const key = [kind, name, ...pair].join('\0');
        if (reported.has(key)) continue;
        reported.add(key);
        py.print(`  - ${kind} ${name} is created in ${script} and in ${file}: whichever runs last decides what the ${kind} is, and ` +
          're-running the other silently undoes it. Keep ONE `create` of it, in one script, and ' +
          (ALTERABLE.has(kind) ? `change it there (or with \`alter ${kind}\`).`
            : `change it there and exec that script again -- mxcli has no \`alter ${kind}\`.`));
      }
    }
  }
  return 0;
}

// The lines a --watch boot writes, in the order they can follow one another.
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
const PAGE_START_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:modify|replace)\s+)?page\s+(?P<name>[\w."]+)`, 'im');
const WIDGET_NAME_RE = re.compile(String.raw`^\s*[a-z][a-z0-9_]*\s+(?P<name>[A-Za-z_]\w*)\s*[({]`, 'm');

const VISUAL_FIX = {
  VIS01: 'a box class on inline text (alert, card) or a negative margin is the usual cause',
  VIS02: 'a fixed width or a long unbroken value is the usual cause; check the page at phone width',
  VIS03: 'the text needs room: a wider column, wrapping, or an ellipsis on purpose',
  VIS04: 'give the chart a height that fits the screen (its Height in pixels, or a percentage of its width) and no fixed width wider than its column; a chart split over two scrolls cannot be read',
};

const RUBRIC = [
  'Does anything overlap or sit on top of something else?',
  'Is everything aligned to the grid: left edges, columns, the top row (Back and the user)?',
  'Is the spacing between blocks even, with no cramped or oversized gaps?',
  'Is any text, button or value cut off, wrapped badly or truncated?',
  'Do badges, alerts and buttons sit where a user expects them, in the right size?',
  'Does the heading hierarchy read right (page title, section headings)?',
  'Are empty, zero or odd states shown sensibly (empty grids, 0.00, missing values)?',
  'Is all text readable (contrast, size) against its background?',
];

// Map of page -> Set of widget names, from the .mdl scripts in folder.
function pagesByWidgets(folder) {
  const found = new Map();
  let names;
  try {
    names = fs.readdirSync(folder).sort(py.compare);
  } catch {
    return found;
  }
  for (const name of names) {
    if (!name.endsWith('.mdl')) continue;
    let text;
    try {
      text = readReplace(py.join(folder, name));
    } catch {
      continue;
    }
    const starts = [...PAGE_START_RE.finditer(text)];
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1].start() : text.length;
      let block = text.slice(start.end(), end);
      const next = re.search(String.raw`^\s*(?:create|grant|alter)\b`, block, 'im');
      if (next) block = block.slice(0, next.start());
      const page = start.group('name').split('"').join('');
      found.set(page, new Set([...WIDGET_NAME_RE.finditer(block)].map(m => 's' + m.group('name'))));
    });
  }
  return found;
}

// The page whose widgets best match what look() saw, else the browser title.
function pageOf(look, pages) {
  const seen = new Set(iter(or(get(look, 'widgets'), [])).map(hashKey));
  const ranked = [...pages].map(([page, widgets]) => [[...widgets].filter(w => seen.has(w)).length, page]);
  ranked.sort((a, b) => (b[0] - a[0]) || py.compare(b[1], a[1]));
  // The page with the most of the measured widget names, when no other page ties with it.
  if (ranked.length && ranked[0][0] >= 2 && (ranked.length === 1 || ranked[1][0] < ranked[0][0])) return ranked[0][1];
  return `page "${needStr(or(get(look, 'title'), '?'), 'replace').split('Mendix - ').join('')}"`;
}

function fileSha(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

// sorted(values) for the widget names of a finding: one type, or a TypeError as Python raises.
function sortedValues(values) {
  const list = [...iter(values)];
  if (list.length < 2) return list;
  if (list.every(v => typeof v === 'string')) return list.sort(py.compare);
  if (list.every(isNumber)) return list.sort((a, b) => numeric(a) - numeric(b));
  throw new PyError('TypeError', "'<' not supported between instances");
}

// os.path.exists(<int>) asks whether that file descriptor is open in the Python process: only
// stdin, stdout and stderr are by then. Node keeps descriptors of its own open, so it is not asked.
const fdOpen = n => [0, 1, 2].includes(Number(numeric(n)));

// os.path.exists(<shot>)
function shotExists(shot) {
  if (typeof shot === 'string') return py.exists(shot);
  if (typeof shot === 'number' || typeof shot === 'boolean' || typeof shot === 'bigint') {
    return fdOpen(shot);
  }
  throw new PyError('TypeError', `stat: path should be string, bytes, os.PathLike or integer, not ${typeName(shot)}`);
}

function visualReport(findingsPath, scriptsDir = '', reviewDir = '') {
  const looks = [];
  let text = null;
  try {
    text = readStrict(findingsPath);
  } catch (error) {
    if (error instanceof PyError) throw error;
  }
  if (text !== null) {
    // `for line in f`: lines keep their \n.
    for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
      try {
        looks.push(loads(line));
      } catch (error) {
        if (!(error instanceof JSONError)) throw error;
      }
    }
  }
  const pages = scriptsDir ? pagesByWidgets(scriptsDir) : new Map();
  const seen = new Set();
  for (const look of looks) {
    const where = pageOf(look, pages);
    for (const finding of iter(or(get(look, 'findings'), []))) {
      const key = [hashKey(where), hashKey(get(finding, 'code')), ...sortedValues(or(get(finding, 'widgets'), [])).map(hashKey)].join('\0');
      if (seen.has(key)) continue;
      seen.add(key);
      const code = get(finding, 'code', 'VIS');
      hashKey(code);
      const fix = typeof code === 'string' && Object.prototype.hasOwnProperty.call(VISUAL_FIX, code) ? VISUAL_FIX[code] : '';
      py.print(`   - [${str(code)}] ${where} (${str(get(look, 'test', '?'))}): ${str(get(finding, 'message', ''))} -- ${fix}`);
    }
  }
  if (reviewDir) reviewScreenshots(looks, pages, reviewDir);
  return 0;
}

// Writes <folder>/review.md; prints a line per screenshot not approved in verdicts.json.
function reviewScreenshots(looks, pages, folder) {
  const shots = [], listed = new Set();
  for (const look of looks) {
    const shot = or(get(look, 'shot'), '');
    if (truthy(shot) && !listed.has(hashKey(shot)) && shotExists(shot)) {
      listed.add(hashKey(shot));
      shots.push([shot, typeof shot === 'string' ? fileSha(shot) : '', pageOf(look, pages), look]);
    }
  }
  if (!shots.length) return;
  let verdicts;
  try {
    verdicts = loads(readStrict(py.join(folder, 'verdicts.json')));
  } catch (error) {
    if (!(error instanceof PyError) && !(error && error.code)) throw error;
    verdicts = dict();
  }
  const lines = ['# Screenshots to review', '',
    'Open each PNG (Read it), answer every question for it, then write verdicts.json in this',
    'folder: {"<sha256>": {"verdict": "approve" | "reject", "answers": {"1": "...", ...},',
    '"fix": "what to change, if rejected"}}. A changed page has a new sha256 and is asked again.',
    '', 'Questions:', ...RUBRIC.map((q, i) => `${i + 1}. ${q}`), ''];
  let pending = 0;
  for (const [shot, sha, where, look] of shots) {
    const verdict = isDict(verdicts) ? get(verdicts, sha) : null;
    const measured = joinStr('; ', iter(or(get(look, 'findings'), [])).map(f => get(f, 'message', ''))) || 'nothing measured';
    lines.push(`## ${where} (${str(get(look, 'test', '?'))})`, '', `- file: ${str(shot)}`, `- sha256: ${sha}`,
      `- measured: ${measured}`, '');
    const answers = isDict(verdict) ? get(verdict, 'answers') : null;
    const complete = isDict(answers) && RUBRIC.every((_, i) => py.strip(str(get(answers, String(i + 1), ''))));
    const said = isDict(verdict) ? get(verdict, 'verdict') : null;
    if (!isDict(verdict) || !(eq(said, 'approve') || eq(said, 'reject')) || !complete) {
      pending++;
    } else if (eq(said, 'reject')) {
      py.print(`   - [LOOK02] ${where} (${str(get(look, 'test', '?'))}): rejected in review -- ` +
        firstChars(str(or(get(verdict, 'fix'), 'no fix given')), 200));
    }
  }
  try {
    fs.writeFileSync(py.join(folder, 'review.md'), lines.join('\n') + '\n');
  } catch { /* the folder is gone: nothing to write */ }
  if (pending) {
    py.print(`   - [LOOK01] ${pending} screenshot(s) not reviewed yet: open ${py.join(folder, 'review.md')}, read each PNG, answer every` +
      ' question and write verdicts.json there');
  }
}

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

const DOC = 'The work tests/gate.sh needs from a script, one subcommand per job; see the head of gate_helpers.cjs.';

function main(argv) {
  if (argv.length < 1) {
    process.stderr.write(DOC + '\n');
    return 2;
  }
  const [command, ...rest] = argv;
  let args = rest;
  if (command === 'qualified-names') return qualifiedNames();
  if (command === 'fingerprint') return fingerprint(args);
  if (command === 'secret') return secret();
  if (command === 'signed-in-users') return signedInUsers();
  if (command === 'recent-refusal') return recentRefusal(args.length ? pyInt(args[0]) : 120);
  if (command === 'deployment-age' && args.length === 2) return deploymentAge(...args);
  if (command === 'runtime-age' && args.length === 2) return runtimeAge(...args);
  if (command === 'duplicate-definitions') return duplicateDefinitions(args);
  if (command === 'test-first' && args.length >= 3) return testFirst(args);
  if (command === 'runtime-errors' && args.length === 2) return runtimeErrors(...args);
  if (command === 'visual-report' && args.length) {
    let review = '';
    const at = args.indexOf('--review');
    if (at >= 0) {
      review = at + 1 < args.length ? args[at + 1] : '';
      args = [...args.slice(0, at), ...args.slice(at + 2)];
    }
    if (!args.length) throw new PyError('IndexError', 'list index out of range');
    return visualReport(args[0], args.length > 1 ? args[1] : '', review);
  }
  if (command === 'watch-state' && args.length === 1) return watchState(args[0]);
  if (command === 'missing-browser' && args.length === 1) return missingBrowser(args[0]);
  if (command === 'doc-map') return docMap();
  if (command === 'record-tests-seen' && args.length >= 2) return recordTestsSeen(args[0], args[1], args.slice(2));
  if (command === 'changed-tests' && args.length === 2) return changedTests(...args);
  process.stderr.write(`unknown or incomplete command: ${argv.join(' ')}\n`);
  return 2;
}

// The CLI; the functions are exported under their Python names for the audit tests.
function cli(argv) {
  try {
    return main(argv);
  } catch (error) {
    // What a Python traceback ends with: the exception type and its message.
    const type = error instanceof PyError ? error.type : error && error.code === 'ENOENT' ? 'FileNotFoundError' : 'OSError';
    process.stderr.write(`Traceback (most recent call last):\n${type}: ${error && error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = cli(process.argv.slice(2));

module.exports = {
  qualified_names: qualifiedNames, fingerprint, secret, signed_in_users: signedInUsers, recent_refusal: recentRefusal,
  deployment_age: deploymentAge, runtime_age: runtimeAge, missing_browser: missingBrowser,
  DEFINITION_RE, definitions, duplicate_definitions: duplicateDefinitions,
  WATCH_EVENTS, watch_state: watchState, watch_build_errors: watchBuildErrors,
  LOG_LINE_RE, LOG_NOISE_RE, OQL_REQUEST_RE, runtime_errors: runtimeErrors,
  PAGE_START_RE, WIDGET_NAME_RE, VISUAL_FIX, RUBRIC, pages_by_widgets: pagesByWidgets, page_of: pageOf, file_sha: fileSha,
  visual_report: visualReport, review_screenshots: reviewScreenshots,
  SEEN_FILE, doc_map: docMap, unit_states: unitStates, file_state: fileState, model_wide_digest: modelWideDigest,
  covered, test_claims: testClaims, load_json: loadJson, record_tests_seen: recordTestsSeen, changed_tests: changedTests,
  main: cli,
  // the Python-value helpers the port is built on
  PyFloat, PyError, loads, raw_decode: rawDecode, dumps, str, repr, float_repr: floatRepr,
};
