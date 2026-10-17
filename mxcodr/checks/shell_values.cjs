// Python's values as the shell helpers' snippets saw them: sys.exit and an uncaught exception,
// json.loads/dumps with ints, floats and key order kept, str()/repr(), truth, d.get and d[key],
// os.walk and text-mode reads. The subcommands that use them are in shell_helpers.cjs.
//
// gate_values.cjs is the same idea for the gate's helpers, kept apart on purpose: each mirrors the
// Python of its own snippets, and the two differ where those did.
'use strict';
const fs = require('fs');
const py = require('./py_compat.cjs');

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

module.exports = {
  Exit, PyError, exit, raise, isMap, loads, rawDecode, dumps, pyRepr, pyStr, truthy, or, get, item,
  typeName, strMethod, contains, iterate, print, loadStdin, pyInt, compareTuples, walk, readStrict, readReplace,
};
