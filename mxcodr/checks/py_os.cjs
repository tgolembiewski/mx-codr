// Python's os.path, glob, text-mode reads and print(), for the checks' Node ports (behind
// py_compat.cjs): the same answers on every platform, Windows included.
'use strict';
const fs = require('fs');
const { pyStr } = require('./py_strings.cjs');

const WIN = process.platform === 'win32';

// ---- reads ----

// open(path).read() in text mode: \r\n and \r become \n (universal newlines).
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}
// sys.stdin.read(): CPython reads stdin with universal newlines on Windows only (newline=None
// there, "\n" elsewhere). An empty or closed stdin reads as ''.
function readStdin() {
  let text;
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
  return WIN ? text.replace(/\r\n?/g, '\n') : text;
}
// sys.stdin.buffer.read(): the raw bytes.
function readStdinBytes() {
  try {
    return fs.readFileSync(0);
  } catch {
    return Buffer.alloc(0);
  }
}

// ---- os.path and glob ----

function basename(p) {
  if (WIN) return p.replace(/^[A-Za-z]:/, '').split(/[\\/]/).pop();
  return p.slice(p.lastIndexOf('/') + 1);
}
function dirname(p) {
  // os.path.dirname: everything before the last separator, trailing separators dropped unless
  // that would leave nothing but the root.
  let drive = '';
  if (WIN && /^[A-Za-z]:/.test(p)) { drive = p.slice(0, 2); p = p.slice(2); }
  const i = Math.max(p.lastIndexOf('/'), WIN ? p.lastIndexOf('\\') : -1) + 1;
  let head = p.slice(0, i);
  const trimmed = head.replace(WIN ? /[\\/]+$/ : /\/+$/, '');
  if (trimmed) head = trimmed;
  return drive + head;
}
function join(a, ...rest) {
  const sep = WIN ? '\\' : '/';
  let out = a;
  for (const b of rest) {
    if (b.startsWith('/') || (WIN && (/^[A-Za-z]:/.test(b) || b.startsWith('\\')))) { out = b; continue; }
    if (!out || out.endsWith('/') || (WIN && (out.endsWith('\\') || /^[A-Za-z]:$/.test(out)))) out += b;
    else out += sep + b;
  }
  return out;
}
function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }
function lexists(p) { try { fs.lstatSync(p); return true; } catch { return false; } }
function isdir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isfile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

const MAGIC = /[*?[]/;
// fnmatch.translate for one path component, as Python 3.11 has it (reversed ranges in a set are
// dropped, not an error); Windows compares case-insensitively (normcase).
function fnmatchRegex(pat) {
  const res = [];
  const STAR = {};
  let i = 0;
  const n = pat.length;
  const esc = c => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  while (i < n) {
    const c = pat[i++];
    if (c === '*') {
      if (!res.length || res[res.length - 1] !== STAR) res.push(STAR);
    } else if (c === '?') res.push('[\\s\\S]');
    else if (c === '[') {
      let j = i;
      if (j < n && pat[j] === '!') j++;
      if (j < n && pat[j] === ']') j++;
      while (j < n && pat[j] !== ']') j++;
      if (j >= n) { res.push('\\['); continue; }
      let stuff = pat.slice(i, j);
      if (!stuff.includes('-')) {
        stuff = stuff.replace(/\\/g, '\\\\');
      } else {
        const chunks = [];
        let k = pat[i] === '!' ? i + 2 : i + 1;
        for (;;) {
          k = pat.indexOf('-', k);
          if (k < 0 || k >= j) break;
          chunks.push(pat.slice(i, k));
          i = k + 1;
          k += 3;
        }
        const chunk = pat.slice(i, j);
        if (chunk) chunks.push(chunk);
        else chunks[chunks.length - 1] += '-';
        // Remove empty ranges -- invalid in RE.
        for (let m = chunks.length - 1; m > 0; m--) {
          const prev = chunks[m - 1], cur = chunks[m];
          if (prev[prev.length - 1] > cur[0]) {
            chunks[m - 1] = prev.slice(0, -1) + cur.slice(1);
            chunks.splice(m, 1);
          }
        }
        stuff = chunks.map(x => x.replace(/\\/g, '\\\\').replace(/-/g, '\\-')).join('-');
      }
      i = j + 1;
      if (!stuff) res.push('(?!)');
      else if (stuff === '!') res.push('[\\s\\S]');
      else {
        if (stuff[0] === '!') stuff = '^' + stuff.slice(1);
        else if (stuff[0] === '^' || stuff[0] === '[') stuff = '\\' + stuff;
        // A ] that Python reads as a member closes a JS set; [ is literal in both.
        res.push('[' + stuff.replace(/(^\^?)\]/, '$1\\]') + ']');
      }
    } else res.push(esc(c));
  }
  const body = res.map(x => (x === STAR ? '[\\s\\S]*' : x)).join('');
  try {
    return new RegExp('^(?:' + body + ')$', WIN ? 'iu' : 'u');
  } catch {
    return new RegExp('^(?:' + body + ')$', WIN ? 'i' : '');
  }
}
// glob.glob(pattern), unsorted as Python returns it (callers sort).
function glob(pattern) {
  return [...iglob(pattern)];
}
function* iglob(pattern) {
  const dirnameOf = p => {
    const i = Math.max(p.lastIndexOf('/'), WIN ? p.lastIndexOf('\\') : -1);
    if (i < 0) return ['', p];
    let head = p.slice(0, i + 1);
    const trimmed = head.replace(WIN ? /[\\/]+$/ : /\/+$/, '');
    if (trimmed && !(WIN && /^[A-Za-z]:$/.test(trimmed))) head = trimmed;
    return [head, p.slice(i + 1)];
  };
  const [dir, base] = dirnameOf(pattern);
  if (!MAGIC.test(pattern)) {
    if (base ? lexists(pattern) : isdir(dir)) yield pattern;
    return;
  }
  if (!dir) { yield* glob1('', base); return; }
  const dirs = dir !== pattern && MAGIC.test(dir) ? iglob(dir) : [dir];
  const one = MAGIC.test(base) ? glob1 : glob0;
  for (const d of dirs) for (const name of one(d, base)) yield join(d, name);
}
function* glob1(dir, pattern) {
  let names;
  try {
    names = fs.readdirSync(dir || '.');
  } catch {
    return;
  }
  if (!pattern.startsWith('.')) names = names.filter(n => !n.startsWith('.'));
  const rx = fnmatchRegex(pattern);
  for (const n of names) if (rx.test(n)) yield n;
}
function* glob0(dir, base) {
  if (!base) { if (isdir(dir)) yield base; }
  else if (lexists(join(dir, base))) yield base;
}

function normpath(p) {
  if (WIN) p = p.replace(/\\/g, '/');
  if (p === '') return '.';
  let drive = '';
  if (WIN && /^[A-Za-z]:/.test(p)) { drive = p.slice(0, 2); p = p.slice(2); }
  let initial = p.startsWith('/') ? 1 : 0;
  if (!WIN && initial && p.startsWith('//') && !p.startsWith('///')) initial = 2;
  const parts = [];
  for (const comp of p.split('/')) {
    if (comp === '' || comp === '.') continue;
    if (comp !== '..' || (!initial && !parts.length) || (parts.length && parts[parts.length - 1] === '..')) parts.push(comp);
    else if (parts.length) parts.pop();
  }
  let out = '/'.repeat(initial) + parts.join('/');
  if (WIN) out = (drive + out).replace(/\//g, '\\');
  return out || '.';
}

// ---- output ----

// sys.stdout.write / print(): synchronous, \n also on Windows (Python wrote \r\n there, which
// leaked a \r into every value a shell read back).
// A checker that prints MDL advice sets a filter (mdl1_spelling.advice) that every write goes through.
let outputFilter = null;
function setOutputFilter(fn) { outputFilter = fn; }
function write(text) {
  if (outputFilter) text = outputFilter(text);
  const buf = Buffer.from(text, 'utf8');
  let at = 0;
  while (at < buf.length) {
    try {
      at += fs.writeSync(1, buf, at);
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error;
    }
  }
}

function print(...items) { write(items.map(pyStr).join(' ') + '\n'); }

module.exports = {
  WIN, readText, readStdin, readStdinBytes,
  basename, dirname, join, exists, lexists, isdir, isfile, glob, iglob, fnmatchRegex, normpath,
  print, write, setOutputFilter,
};
