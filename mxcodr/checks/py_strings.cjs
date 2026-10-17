// Python's str and its order, for the checks' Node ports (behind py_compat.cjs): whitespace as
// str.isspace() has it, strip/split/splitlines, str() and repr(), json.dumps, sorted().
'use strict';

// str.isspace(): bidi WS/B/S or category Zs.
const SPACE_CHARS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const SPACE = new RegExp('[' + SPACE_CHARS + ']', 'u');
const isSpace = c => SPACE.test(c);

function strip(s, chars) {
  return rstrip(lstrip(s, chars), chars);
}
function lstrip(s, chars) {
  let a = 0;
  const test = chars == null ? isSpace : c => chars.includes(c);
  while (a < s.length && test(s[a])) a++;
  return s.slice(a);
}
function rstrip(s, chars) {
  let b = s.length;
  const test = chars == null ? isSpace : c => chars.includes(c);
  while (b > 0 && test(s[b - 1])) b--;
  return s.slice(0, b);
}

// str.split() with no separator: runs of whitespace, no empty strings. With a separator and a
// maxsplit, Python keeps the rest in the last item (JS drops it).
function split(s, sep, maxsplit = -1) {
  if (sep == null) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      while (i < s.length && isSpace(s[i])) i++;
      if (i >= s.length) break;
      if (maxsplit >= 0 && out.length === maxsplit) { out.push(rstrip(s.slice(i))); break; }
      let j = i;
      while (j < s.length && !isSpace(s[j])) j++;
      out.push(s.slice(i, j));
      i = j;
    }
    return out;
  }
  const parts = s.split(sep);
  if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts;
  return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(sep)];
}

// str.splitlines(): every line boundary Python knows, no trailing empty line.
function splitlines(s, keepends = false) {
  const out = [];
  const re = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/g;
  let at = 0, m;
  while ((m = re.exec(s))) {
    out.push(s.slice(at, keepends ? m.index + m[0].length : m.index));
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

// str(value) for the JSON values a check prints.
function pyStr(value) {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return pyNumber(value);
  if (typeof value === 'string') return value;
  return pyRepr(value);
}
function pyNumber(n) {
  if (Number.isInteger(n) && !Object.is(n, -0) && Math.abs(n) < 1e16) return String(n);
  if (Number.isInteger(n)) return Math.abs(n) < 1e16 ? n.toFixed(1) : String(n).replace('e+', 'e+');
  return String(n);
}
function pyRepr(value) {
  if (typeof value === 'string') {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let out = '';
    for (const c of value) {
      if (c === '\\') out += '\\\\';
      else if (c === quote) out += '\\' + c;
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c < ' ' || c === '\x7f') out += '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0');
      else out += c;
    }
    return quote + out + quote;
  }
  if (Array.isArray(value)) return '[' + value.map(pyRepr).join(', ') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).map(([k, v]) => pyRepr(k) + ': ' + pyRepr(v)).join(', ') + '}';
  }
  return pyStr(value);
}

// json.dumps with Python's defaults: ensure_ascii, separators (', ', ': ') or (',', ': ') with an
// indent, sort_keys on request.
function jsonDumps(value, { indent = null, sortKeys = false, ensureAscii = true, separators = null } = {}) {
  const [itemSep, keySep] = separators || (indent == null ? [', ', ': '] : [',', ': ']);
  const pad = typeof indent === 'number' ? ' '.repeat(indent) : indent;
  const str = s => {
    let out = JSON.stringify(s);
    if (ensureAscii) out = out.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    return out;
  };
  const enc = (v, level) => {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return 'NaN';
      if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
      return pyNumber(v);
    }
    if (typeof v === 'string') return str(v);
    const inner = pad == null ? '' : '\n' + pad.repeat(level + 1);
    const outer = pad == null ? '' : '\n' + pad.repeat(level);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[' + inner + v.map(x => enc(x, level + 1)).join(itemSep + inner) + outer + ']';
    }
    let keys = Object.keys(v);
    if (!keys.length) return '{}';
    if (sortKeys) keys = keys.sort(compare);
    return '{' + inner + keys.map(k => str(k) + keySep + enc(v[k], level + 1)).join(itemSep + inner) + outer + '}';
  };
  return enc(value, 0);
}

// Python's string order (by code point), for sort comparators.
function compare(a, b) {
  if (a === b) return 0;
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
  }
  return x.length - y.length;
}
// Tuple order: compare item by item (numbers as numbers, strings by code point).
function compareTuples(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (Array.isArray(x)) { const c = compareTuples(x, y); if (c) return c; continue; }
    if (typeof x === 'number') return x < y ? -1 : x > y ? 1 : 0;
    if (typeof x === 'boolean') return (x ? 1 : 0) - (y ? 1 : 0);
    const c = compare(String(x), String(y));
    if (c) return c;
  }
  return a.length - b.length;
}
// sorted(items, key=..., reverse=...): stable, like Python's.
function sorted(items, key = null, reverse = false) {
  const decorated = [...items].map((item, i) => [key ? key(item) : item, i, item]);
  decorated.sort((p, q) => {
    const c = cmpAny(p[0], q[0]);
    return (reverse ? -c : c) || p[1] - q[1];
  });
  return decorated.map(d => d[2]);
}
function cmpAny(x, y) {
  if (Array.isArray(x)) return compareTuples(x, y);
  if (typeof x === 'number' || typeof x === 'boolean') return x < y ? -1 : x > y ? 1 : 0;
  return compare(String(x), String(y));
}

module.exports = {
  SPACE_CHARS, isSpace, strip, lstrip, rstrip, split, splitlines,
  pyStr, pyRepr, jsonDumps, compare, compareTuples, sorted,
};
