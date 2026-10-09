// Values as the original Python read and printed them -- json.loads/dumps (an integral float stays
// 1.0, NaN and Infinity parse), str(), repr(), ==, truthiness, text-mode reads, naive datetimes --
// so gate_helpers' subcommands print what they printed when they were Python. Shared by gate_*.cjs.
'use strict';
const fs = require('fs');
const path = require('path');
const py = require('./py_compat.cjs');

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

module.exports = { PyFloat, PyError, isDict, typeName, numeric, isNumber, truthy, or, eq, hashKey, iter, head, get, needStr, joinStr, firstChars, floatRepr, NOT_PRINTABLE, strRepr, repr, str, JSONError, WS, skipWs, NUMBER, parseString, rawDecode, loads, dumps, dict, universal, readReplace, readStrict, stdinText, statOf, getmtime, abspath, walk, pyInt, daysIn, naive, nowNaive, roundHalfEven, fromTimestamp, WEEKDAYS, MONTHS, LSTART_RE, parseLstart };
