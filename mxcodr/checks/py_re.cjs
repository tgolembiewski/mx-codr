// Python's re module, for the checks' Node ports (behind py_compat.cjs): a Python pattern is
// translated to a JS one with the same meaning (Unicode \w, \b, \s; `$` before a final newline).
'use strict';
const { SPACE_CHARS, isSpace } = require('./py_strings.cjs');

const WORD = '\\p{L}\\p{N}_';             // \w for str patterns: str.isalnum() or '_'
const DIGIT = '\\p{Nd}';                   // \d
const SYNTAX = '^$\\.*+?()[]{}|/';
const cache = new Map();

// Translate a Python pattern to an equivalent JS one (flag u, never m or s: anchors and `.` are
// written out). Flags: a string of Python flag letters (i, m, s, x).
function translate(source, flags = '') {
  let i = 0;
  let pyFlags = flags;
  // Leading inline flags, (?im) and the like.
  for (let m; (m = /^\(\?([aiLmsux]+)\)/.exec(source.slice(i)));) { pyFlags += m[1]; i += m[0].length; }
  const multiline = pyFlags.includes('m'), dotall = pyFlags.includes('s'), verbose = pyFlags.includes('x');
  let out = '';
  const n = source.length;
  const NOT_WORD_AHEAD = `(?![${WORD}])`, WORD_AHEAD = `(?=[${WORD}])`;
  const NOT_WORD_BEHIND = `(?<![${WORD}])`, WORD_BEHIND = `(?<=[${WORD}])`;
  const classEscape = c => {
    switch (c) {
      case 'w': return WORD;
      case 'd': return DIGIT;
      case 's': return SPACE_CHARS;
      case 'W': case 'D': case 'S': throw new Error('negated class escape inside a set: \\' + c);
      default: return null;
    }
  };
  while (i < n) {
    const c = source[i];
    if (verbose && isSpace(c)) { i++; continue; }
    if (verbose && c === '#') { while (i < n && source[i] !== '\n') i++; continue; }
    if (c === '\\') {
      const e = source[i + 1];
      i += 2;
      if (e === 'w') out += `[${WORD}]`;
      else if (e === 'W') out += `[^${WORD}]`;
      else if (e === 'd') out += `[${DIGIT}]`;
      else if (e === 'D') out += `[^${DIGIT}]`;
      else if (e === 's') out += `[${SPACE_CHARS}]`;
      else if (e === 'S') out += `[^${SPACE_CHARS}]`;
      else if (e === 'b') out += `(?:${NOT_WORD_BEHIND}${WORD_AHEAD}|${WORD_BEHIND}${NOT_WORD_AHEAD})`;
      else if (e === 'B') out += `(?:${WORD_BEHIND}${WORD_AHEAD}|${NOT_WORD_BEHIND}${NOT_WORD_AHEAD})`;
      else if (e === 'A') out += '^';
      else if (e === 'Z') out += '$';
      else if (e === 'x') { out += '\\x' + source.slice(i, i + 2); i += 2; }
      else if (e === 'u') { out += '\\u' + source.slice(i, i + 4); i += 4; }
      else if (/[0-9]/.test(e)) {
        let num = e;
        while (i < n && /[0-9]/.test(source[i]) && num.length < 2) num += source[i++];
        out += '\\' + num;
      } else if ('nrtfv'.includes(e)) out += '\\' + e;
      else if (e === 'a') out += '\\x07';
      else if (SYNTAX.includes(e)) out += '\\' + e;
      else out += e.replace(/[\s\S]/u, ch => (SYNTAX.includes(ch) ? '\\' + ch : ch));
      continue;
    }
    if (c === '[') {
      // A set: copy it, translating escapes; a leading ] is literal in Python.
      let j = i + 1, set = '[';
      if (source[j] === '^') { set += '^'; j++; }
      if (source[j] === ']') { set += '\\]'; j++; }
      while (j < n && source[j] !== ']') {
        const d = source[j];
        if (d === '\\') {
          const e = source[j + 1];
          const cls = classEscape(e);
          if (cls) set += cls;
          else if (e === 'x') { set += '\\x' + source.slice(j + 2, j + 4); j += 2; }
          else if (e === 'u') { set += '\\u' + source.slice(j + 2, j + 6); j += 4; }
          else if ('nrtfv'.includes(e)) set += '\\' + e;
          else if (/[\w]/.test(e) && !/[0-9]/.test(e)) set += e;
          // Flag u allows only syntax characters and - to be escaped in a set; the rest are literal.
          else if (SYNTAX.includes(e) || e === '-') set += '\\' + e;
          else set += e;
          j += 2;
          continue;
        }
        if (d === '[' || d === '/' || d === '{' || d === '}' || d === '(' || d === ')' || d === '|') set += '\\' + d;
        else set += d;
        j++;
      }
      out += set + ']';
      i = j + 1;
      continue;
    }
    if (c === '(' && source[i + 1] === '?') {
      if (source[i + 2] === 'P' && source[i + 3] === '<') { out += '(?<'; i += 4; continue; }
      if (source[i + 2] === 'P' && source[i + 3] === '=') {
        const close = source.indexOf(')', i);
        out += '\\k<' + source.slice(i + 4, close) + '>';
        i = close + 1;
        continue;
      }
      if (source[i + 2] === '#') { i = source.indexOf(')', i) + 1; continue; }
    }
    if (c === '{') {
      const m = /^\{(\d*)(,?)(\d*)\}/.exec(source.slice(i));
      if (m && (m[1] || m[3])) { out += '{' + (m[1] || '0') + m[2] + m[3] + '}'; i += m[0].length; continue; }
      out += '\\{'; i++; continue;
    }
    if (c === '}') { out += '\\}'; i++; continue; }
    if (c === '.') { out += dotall ? '[\\s\\S]' : '[^\\n]'; i++; continue; }
    if (c === '^') { out += multiline ? '(?<![^\\n])' : '^'; i++; continue; }
    if (c === '$') { out += multiline ? '(?=\\n|$)' : '(?=\\n?$)'; i++; continue; }
    if (c === '/') { out += '\\/'; i++; continue; }
    out += c;
    i++;
  }
  return { source: out, ignoreCase: pyFlags.includes('i') };
}

class Pattern {
  constructor(source, flags = '') {
    const t = translate(source, flags);
    this.pattern = source;
    this.js = t.source;
    this.jsFlags = 'du' + (t.ignoreCase ? 'i' : '');
    this.re = new RegExp(this.js, this.jsFlags + 'g');
    this.sticky = new RegExp(this.js, this.jsFlags + 'y');
  }
  search(s, pos = 0) {
    this.re.lastIndex = pos;
    return wrap(this.re.exec(s));
  }
  match(s, pos = 0) {
    this.sticky.lastIndex = pos;
    return wrap(this.sticky.exec(s));
  }
  fullmatch(s) {
    const re = new RegExp('(?:' + this.js + ')$', this.jsFlags + 'y');
    re.lastIndex = 0;
    return wrap(re.exec(s));
  }
  *finditer(s) {
    const re = new RegExp(this.js, this.jsFlags + 'g');
    let m;
    while ((m = re.exec(s))) {
      yield wrap(m);
      if (m[0] === '') re.lastIndex += s.codePointAt(m.index) > 0xffff ? 2 : 1;
    }
  }
  findall(s) {
    const out = [];
    for (const m of this.finditer(s)) {
      const groups = m.raw.length - 1;
      if (groups === 0) out.push(m.group(0));
      else if (groups === 1) out.push(m.group(1) ?? '');
      else out.push(m.groups().map(g => g ?? ''));
    }
    return out;
  }
  sub(repl, s, count = 0) {
    let out = '', at = 0, done = 0;
    for (const m of this.finditer(s)) {
      if (count && done >= count) break;
      out += s.slice(at, m.start()) + (typeof repl === 'function' ? repl(m) : expand(repl, m));
      at = m.end();
      done++;
    }
    return out + s.slice(at);
  }
  split(s, maxsplit = 0) {
    const out = [];
    let at = 0, done = 0;
    for (const m of this.finditer(s)) {
      if (maxsplit && done >= maxsplit) break;
      out.push(s.slice(at, m.start()), ...m.raw.slice(1).map(g => (g === undefined ? null : g)));
      at = m.end();
      done++;
    }
    out.push(s.slice(at));
    return out;
  }
}

// The replacement template of re.sub: \1, \g<1>, \g<name>, \n and friends.
function expand(template, m) {
  return template.replace(/\\(g<([^>]+)>|\d{1,2}|[nrt\\])/g, (all, what, name) => {
    if (name !== undefined) return (/^\d+$/.test(name) ? m.group(Number(name)) : m.group(name)) ?? '';
    if (/^\d/.test(what)) return m.group(Number(what)) ?? '';
    return { n: '\n', r: '\r', t: '\t', '\\': '\\' }[what];
  });
}

class Match {
  constructor(raw) { this.raw = raw; }
  group(...which) {
    if (which.length > 1) return which.map(w => this.group(w));
    const w = which.length ? which[0] : 0;
    const v = typeof w === 'number' ? this.raw[w] : (this.raw.groups || {})[w];
    return v === undefined ? null : v;
  }
  groups(dflt = null) { return this.raw.slice(1).map(g => (g === undefined ? dflt : g)); }
  groupdict() {
    const out = {};
    for (const [k, v] of Object.entries(this.raw.groups || {})) out[k] = v === undefined ? null : v;
    return out;
  }
  span(g = 0) {
    const at = typeof g === 'number' ? this.raw.indices[g] : (this.raw.indices.groups || {})[g];
    return at ? [at[0], at[1]] : [-1, -1];
  }
  start(g = 0) { return this.span(g)[0]; }
  end(g = 0) { return this.span(g)[1]; }
  get string() { return this.raw.input; }
}
const wrap = raw => (raw ? new Match(raw) : null);

function compile(source, flags = '') {
  const key = flags + '\0' + source;
  let p = cache.get(key);
  if (!p) { p = new Pattern(source, flags); cache.set(key, p); }
  return p;
}
const re = {
  compile,
  search: (p, s, f = '') => compile(p, f).search(s),
  match: (p, s, f = '') => compile(p, f).match(s),
  fullmatch: (p, s, f = '') => compile(p, f).fullmatch(s),
  findall: (p, s, f = '') => compile(p, f).findall(s),
  finditer: (p, s, f = '') => compile(p, f).finditer(s),
  sub: (p, r, s, count = 0, f = '') => compile(p, f).sub(r, s, count),
  split: (p, s, maxsplit = 0, f = '') => compile(p, f).split(s, maxsplit),
  // re.escape since Python 3.7: only the characters with a meaning in a pattern.
  escape: s => s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, c => '\\' + c),
};
// A pattern with Python's meaning: shorthand for re.compile, used by the rule files.
function rx(pattern, flags = '') {
  return re.compile(pattern, flags);
}

module.exports = { re, rx, translate };
