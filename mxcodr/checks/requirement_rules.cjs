// REQ02, the requirements step of check_paths.cjs.
// REQ02: each requirement the person agreed (docs/brain/plan/<slice>.md, skill requirements-interview)
// is named by a test -- `# requirement: <id>` under its `# covers:` line. Two of three InvoiceChase runs
// (2026-10-12) recorded a requirement, built around it, and dropped it with the gate green: nothing
// tied a test to it. An open question (an assumption) is not a requirement yet; a test naming an id
// the plan does not have is a stale link.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withoutFolder } = require('./mxcli_client.cjs');

// A requirement's version: the same hash check_paths.cjs takes of a document.
const hash = text => crypto.createHash('sha1').update(withoutFolder(text)).digest('hex').slice(0, 12);

const PLAN_ENTRY_RE = /^## (.+)\n\nAnchors: (.*)$/gm;
// Words too common to show a requirement was checked.
const STOP = new Set(['that', 'this', 'with', 'from', 'when', 'than', 'then', 'them', 'they', 'their', 'there', 'each', 'every',
  'only', 'into', 'onto', 'must', 'have', 'shows', 'show', 'sees', 'user', 'users', 'page', 'pages', 'list', 'can', 'cannot',
  'which', 'what', 'where', 'while', 'after', 'before', 'other', 'others', 'same', 'also', 'more', 'less', 'least', 'most',
  'never', 'always', 'should', 'will', 'would', 'does', 'done', 'checked', 'check', 'test', 'tests', 'button', 'screen']);
// The forms of a requirement's word a test may write instead: its stem (places -> place, coloured ->
// colour) and the American spelling (colour -> color). Two Mastermind runs wrote "coloured" in the
// requirement and "color" in the test, and went round REQ02 three times each (2026-10-14).
function spellings(word) {
  const out = new Set([word]);
  for (const end of ['ing', 'ed', 'es', 'd', 's']) {
    if (word.endsWith(end) && !word.endsWith('ss') && word.length - end.length >= 4) out.add(word.slice(0, -end.length));
  }
  for (const w of [...out]) if (/our/.test(w)) out.add(w.replace(/our/g, 'or'));
  for (const w of [...out]) if (/is(e|ed|ing)?$/.test(w)) out.add(w.replace(/is(e|ed|ing)?$/, 'iz$1'));
  return [...out];
}

// The brain's queue (.mxcli/brain/staged.jsonl): [{id, title}], [] when none.
function stagedEntries(appDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(appDir, '.mxcli', 'brain', 'staged.jsonl'), 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e && /^[0-9a-f]{4,}$/.test(String(e.id || '')));
}

// MDL_REQUIREMENTS from tests/harness.env (the last line wins), else the environment, else ask.
function requirementsMode(appDir) {
  let mode = process.env.MDL_REQUIREMENTS || 'ask';
  try {
    for (const m of fs.readFileSync(path.join(appDir, 'tests', 'harness.env'), 'utf8').matchAll(/^\s*MDL_REQUIREMENTS="?(\w+)"?\s*$/gm)) mode = m[1];
  } catch { /* no harness.env: the environment's */ }
  return mode;
}
// The agreed requirements of docs/brain/plan/<slice>.md, [{id, text, slice}], and the ids of its
// open questions (assumptions).
function readPlan(appDir) {
  const dir = path.join(appDir, 'docs', 'brain', 'plan');
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort(); } catch { names = []; }
  const requirements = [], open = new Set();
  for (const name of names) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of text.matchAll(PLAN_ENTRY_RE)) {
      const id = (m[2].match(/id `([0-9a-f]+)`/) || [])[1];
      if (id && /OPEN\s*$/.test(m[2])) open.add(id);
      if (!id || /OPEN\s*$/.test(m[2])) continue;
      requirements.push({ id, text: m[1].trim(), slice: name });
    }
  }
  return { requirements, open };
}

// At `requirements: assume` nobody else promotes what waits in the queue: two Sonnet runs
// (invoice-chase c2 and n4, 2026-10-14) captured their requirements, left them staged, and
// reached DONE with no requirement tied to a test -- REQ02 reads only the plan.
function stagedFindings(appDir) {
  const staged = stagedEntries(appDir);
  if (!staged.length || requirementsMode(appDir) !== 'assume') return [];
  return [{ code: 'REQ02', key: 'staged', version: staged.map(e => e.id).join(','),
    message: `${staged.length} requirement(s) wait in the brain's queue (${staged.map(e => e.id).join(', ')}), where no check ` +
      'reads them: at requirements: assume nobody else promotes them -- ' +
      `${staged.map(e => `./mxcli brain promote ${e.id}`).join('; ')} (skill requirements-interview), then name each in a test` }];
}

// Where each id is named, and the test code under it: from its `# requirement:` line (or a run of
// them) to the next one, comments left out. {id: {file, code}}, the code lower-cased.
function namedRequirements(testFiles) {
  const named = new Map();
  for (const [file, text] of testFiles) {
    let pending = [], code = [], sawCode = false;
    const flush = () => {
      const block = code.join('\n').toLowerCase();
      for (const id of pending) {
        const seen = named.get(id) || { file, code: '' };
        seen.code += '\n' + block;
        named.set(id, seen);
      }
      pending = []; code = []; sawCode = false;
    };
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*#\s*requirements?\s*:\s*(.+)$/i.exec(line);
      if (m) {
        if (sawCode) flush();
        pending.push(...(m[1].match(/[0-9a-f]{6,}/g) || []));
        continue;
      }
      if (/^\s*(#|\/\/)/.test(line)) continue;
      if (pending.length && line.trim()) { code.push(line); sawCode = true; }
    }
    flush();
  }
  return named;
}

// A test that names an id but checks nothing of it passed: one B2B test named thirteen requirements
// on one line, the date and amount formats among them, and asserted no format -- the grid showed
// 10/6/2026 and 19190.829 under a gate that said DONE (InvoiceB2BG2, 2026-10-12). So a requirement
// counts as tested when the code under its name holds one of its own words that few other
// requirements share -- a selector, a value, an OQL column, or the fail message that says what is checked.
function judgeRequirements(requirements, open, named) {
  const out = [];
  const words = t => new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length >= 4 && !STOP.has(w)));
  const df = new Map();
  for (const r of requirements) for (const w of words(r.text)) df.set(w, (df.get(w) || 0) + 1);
  const rare = Math.max(1, Math.floor(requirements.length / 3));
  const known = new Set(requirements.map(r => r.id));
  for (const r of requirements) {
    const where = named.get(r.id);
    if (!where) {
      out.push({ code: 'REQ02', key: r.id, version: hash(r.text),
        message: `requirement ${r.id} (docs/brain/plan/${r.slice}) has no test: "${r.text}" -- write the test that ` +
          `checks its "checked when" and name it there, a line \`# requirement: ${r.id}\` above the step that checks it` });
      continue;
    }
    const own = [...words(r.text)].filter(w => df.get(w) <= rare).slice(0, 8);
    if (!own.length || own.some(w => spellings(w).some(v => where.code.includes(v)))) continue;
    out.push({ code: 'REQ02', key: r.id, version: hash(r.text),
      message: `${where.file} names requirement ${r.id} but its code checks none of it: "${r.text}" -- under ` +
        `\`# requirement: ${r.id}\`, assert what it says, with a fail message in its words (one of: ${own.join(', ')})` });
  }
  for (const [id, { file }] of named) {
    // An assumption (open, in assume mode) a test checks is welcome, not a stale link: Opus named
    // three and was sent back to drop them (mastermind, 2026-10-14).
    if (known.has(id) || open.has(id)) continue;
    out.push({ code: 'REQ02', key: `stale:${id}`, version: id,
      message: `${file} names requirement ${id}, which docs/brain/plan does not have (an open question, dropped, or a typo) -- name an id ./mxcli brain plan lists, or drop the line` });
  }
  return out;
}

// The REQ02 findings: {code, key, version, message}, as check_paths.cjs's other rules give them.
function requirementFindings(appDir, testFiles) {
  const out = stagedFindings(appDir);
  const { requirements, open } = readPlan(appDir);
  if (!requirements.length) return out;
  return out.concat(judgeRequirements(requirements, open, namedRequirements(testFiles)));
}

module.exports = { spellings, stagedEntries, requirementsMode, readPlan, stagedFindings, namedRequirements,
  judgeRequirements, requirementFindings };
