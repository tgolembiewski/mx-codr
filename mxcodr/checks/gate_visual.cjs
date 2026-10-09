// gate_helpers visual-report: the page problems look() measured, and the screenshots to review.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const py = require('./py_compat.cjs');
const { re } = py;
const { PyError, isDict, typeName, numeric, isNumber, truthy, or, eq, hashKey, iter, get, needStr, joinStr, firstChars, str, JSONError, loads, dict, readReplace, readStrict } = require('./gate_values.cjs');

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

module.exports = { PAGE_START_RE, WIDGET_NAME_RE, VISUAL_FIX, RUBRIC, pagesByWidgets, pageOf, fileSha, sortedValues, fdOpen, shotExists, visualReport, reviewScreenshots };
