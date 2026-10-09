// Performance rules for described microflows: work a database does in one query, done row by
// row in a microflow instead. Part of check_mdl.cjs --skill naming; warnings, never failures.
//
//     PERF02  a loop over a list retrieved from the database only adds up or counts its rows
//     PERF03  inside such a loop, a database call per row: a retrieve from the database or over
//             the row's association, a Java action, or a microflow that reads or writes the database
//     PERF05  a whole table is retrieved and the loop keeps rows with an `if` -- a filter the
//             retrieve's XPath should do
//     PERF06  the loop only keeps the largest or smallest value of its rows (the next number,
//             the latest date) -- one sorted retrieve with `limit 1` returns that row
//
// Measured 2026-10-04 on InvoiceB2B, 10,680 orders and 2,360 invoices of one customer: the
// customer panel computed in loops took 160 ms; the same figures as count()/sum() right after a
// retrieve, 159 ms (each figure its own query through the joins); one OQL view entity, 60 ms. So
// the advice for totals and counts is the view, not the aggregate. One-time seed and demo-data
// flows (ASU_, *Seed*, *Demo*) are not judged: they run once. A port of perf_rules.py that gives
// the same findings.
'use strict';
const py = require('./py_compat.cjs');

// A pattern with Python's meaning (py_compat translates it).
function rx(pattern, flags = '') {
  return py.re.compile(pattern, flags);
}

const FLOW_HEAD = rx(String.raw`^\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?:microflow|nanoflow)\s+(?P<name>[\w.]+)`, 'i');
const RETRIEVE = rx(String.raw`^\s*retrieve\s+\$(?P<var>\w+)\s+from\s+(?:database\s+)?(?P<src>[^\s;]+)(?P<rest>.*)$`, 'i');
const LOOP = rx(String.raw`^\s*loop\s+\$(?P<item>\w+)\s+in\s+\$(?P<list>\w+)`, 'i');
const WHILE = rx(String.raw`^\s*while\b`, 'i');
const END_LOOP = rx(String.raw`^\s*end\s+(?:loop|while)\s*;`, 'i');
// `set` is optional: `$Sum = $Sum + ...` assigns too (Pi wrote it that way and PERF02 missed it).
// Not a line with a string literal: `$Text = $Text + $O/Code + ','` builds a text, it sums nothing.
const ACCUM = rx(String.raw`^\s*(?:set\s+)?\$(?P<var>\w+)\s*=\s*\$(?P=var)\s*[-+][^']*$`, 'i');
const TRAILING_COMMENT = rx(String.raw`^((?:[^'-]|'[^']*'|-(?!-))*?)\s+--.*$`);
const SET = rx(String.raw`^\s*(?:set\s+)?\$\w+\s*=(?!=)`, 'i');
const COMPARE = rx(String.raw`^\s*(?:if|elsif)\s+\$(?P<a>\w+)(?:/\w+)?\s*(?P<op>>=?|<=?)\s*\$(?P<b>\w+)(?:/\w+)?\s+then`, 'i');
const KEEP = rx(String.raw`^\s*(?:set\s+)?\$(?P<to>\w+)\s*=\s*\$(?P<from>\w+)(?:/\w+)?\s*;`, 'i');
const CALL = rx(String.raw`\bcall\s+(?P<kind>microflow|nanoflow|java\s+action)\s+(?P<name>[\w.]+)`, 'i');
const WRITE = rx(String.raw`^\s*(?:\$\w+\s*=\s*)?(change|commit|delete|rollback|create|add|remove|show\s+page|` +
  String.raw`close\s+page|show\s+message|validation\s+feedback|download|send|import|export|` +
  String.raw`execute|call\s+rest|call\s+web)\b`, 'i');
const CONTROL = rx(String.raw`^\s*(if\b|else\b|elsif\b|end\s+if|declare\b|begin\b|end\s*;|return\b|case\b|` +
  String.raw`when\b|end\s+case|log\b)`, 'i');
const IF_ON_ITEM = String.raw`^\s*(?:if|elsif)\b.*\$%s/`;
const ONE_TIME = rx(String.raw`(^|\.)ASU_|seed|demo`, 'i');

const VIEW_FIX = 'compute totals and counts in the database: an OQL view entity returns them in one ' +
  'query (give the view entity access rules with an XPath constraint). Measured at 10k ' +
  'rows: the view 60 ms, this loop 160 ms; count()/sum() right after the retrieve was ' +
  'no faster (159 ms)';

// Map {flow: [[line number, statement]]}: continuation lines joined, annotations dropped.
function statementsOf(lines) {
  const flows = new Map();
  let name = null, buffer = '', start = 0;
  lines.forEach((raw, i) => {
    const index = i + 1;
    // A comment after a statement would hide its `;`, and the next line joined it: a retrieve
    // followed by `loop` on the next line became one statement, and the loop was lost.
    const stripped = TRAILING_COMMENT.sub('\\1', py.strip(raw));
    const head = FLOW_HEAD.match(stripped);
    if (head) {
      name = head.group('name');
      buffer = '';
      flows.set(name, []);
      return;
    }
    if (name === null || !stripped || ['@', '--', '/**', '*', 'grant '].some(p => stripped.startsWith(p))) return;
    if (!buffer) start = index;
    buffer = py.strip(buffer + ' ' + stripped);
    if ([';', 'begin', 'then'].some(e => buffer.endsWith(e)) || py.re.match(String.raw`^(else|end)\b`, buffer, 'i')) {
      flows.get(name).push([start, buffer]);
      buffer = '';
    }
  });
  return flows;
}

// Map {list var: [entity, whole table]} for retrieves from the database (not over a path).
function dbLists(statements) {
  const found = new Map();
  for (const [, text] of statements) {
    const match = RETRIEVE.match(text);
    if (match && !match.group('src').startsWith('$')) {
      found.set(match.group('var'), [match.group('src'), !py.re.search(String.raw`\bwhere\b`, text, 'i')]);
    }
  }
  return found;
}

// [line, item, list, body statements] for every loop, nested ones included.
function* loops(statements) {
  for (let index = 0; index < statements.length; index++) {
    const [line, text] = statements[index];
    const match = LOOP.match(text);
    if (!match) continue;
    let depth = 0;
    const body = [];
    for (const inner of statements.slice(index + 1)) {
      if (LOOP.match(inner[1]) || WHILE.match(inner[1])) depth += 1;
      if (END_LOOP.match(inner[1])) {
        if (depth === 0) break;
        depth -= 1;
      }
      body.push(inner[1]);
    }
    yield [line, match.group('item'), match.group('list'), body];
  }
}

function touchesDb(statements) {
  return statements.some(([, t]) => {
    const r = RETRIEVE.match(t);
    return (r && !r.group('src').startsWith('$')) || py.re.match(String.raw`^\s*(commit|delete)\b`, t, 'i');
  });
}

// True when an `if $a > $b then` is followed by `$b = $a` (or the other way round).
function keepsExtreme(body) {
  for (let index = 0; index < body.length; index++) {
    const compare = COMPARE.match(body[index]);
    if (!compare) continue;
    const pair = new Set([compare.group('a').toLowerCase(), compare.group('b').toLowerCase()]);
    for (const after of body.slice(index + 1, index + 3)) {
      const keep = KEEP.match(after);
      if (keep) {
        const other = new Set([keep.group('to').toLowerCase(), keep.group('from').toLowerCase()]);
        if (other.size === pair.size && [...other].every(x => pair.has(x))) return true;
      }
    }
  }
  return false;
}

// [code, message, line] for every finding.
function perfFindings(lines) {
  const flows = statementsOf(lines);
  const findings = [];
  for (const [name, statements] of flows) {
    if (ONE_TIME.search(name)) continue;
    const where = py.re.search(String.raw`(^|\.)DS_`, name)
      ? " -- it is a page's data source, so this runs every time the page opens" : '';
    const lists = dbLists(statements);
    for (const [line, item, lst, body] of loops(statements)) {
      if (!lists.has(lst)) continue;
      const [entity, whole] = lists.get(lst);
      const accumulated = py.sorted([...new Set(body.filter(t => ACCUM.match(t)).map(t => ACCUM.match(t).group('var')))]);
      const writes = body.filter(t => WRITE.match(t));
      const perRow = [];
      for (const text of body) {
        const retrieve = RETRIEVE.match(text);
        if (retrieve && retrieve.group('src').startsWith('$' + item + '/')) perRow.push('retrieves over ' + retrieve.group('src'));
        else if (retrieve && !retrieve.group('src').startsWith('$')) perRow.push('retrieves from ' + retrieve.group('src'));
        const call = CALL.search(text);
        if (call) {
          const callee = flows.get(call.group('name'));
          if (call.group('kind').toLowerCase().startsWith('java')) perRow.push('calls Java action ' + call.group('name'));
          else if (callee !== undefined && touchesDb(callee)) perRow.push('calls ' + call.group('name') + ', which reads or writes the database');
        }
      }
      const others = body.filter(t => !(ACCUM.match(t) || SET.match(t) || CONTROL.match(t) || CALL.search(t) || RETRIEVE.match(t)));
      if (accumulated.length && !writes.length && !others.length && !perRow.length) {
        findings.push(['PERF02',
          `${name}: the loop over $${lst} (${entity}) only adds up ` +
          `${accumulated.map(v => '$' + v).join(', ')}: every row is read into memory to be ` +
          `summed -- ${VIEW_FIX}${where}`, line]);
      }
      if (perRow.length) {
        findings.push(['PERF03',
          `${name}: the loop over $${lst} (${entity}) ${py.sorted([...new Set(perRow)]).join('; ')} for every ` +
          'row -- one database call per row (N+1). Get what the loop needs in one retrieve ' +
          `before it (an XPath over the association), or compute it in an OQL view${where}`, line]);
      }
      if (!accumulated.length && !writes.length && !others.length && !perRow.length && keepsExtreme(body)) {
        findings.push(['PERF06',
          `${name}: the loop over $${lst} (${entity}) reads every row to keep the largest or ` +
          `smallest value -- retrieve only that row, sorted: \`retrieve $Last from ${entity} ` +
          `where [...] sort by ${entity}.<Attr> desc limit 1;\` (\`asc\` for the smallest)${where}`, line]);
      }
      if (whole && body.some(t => py.re.match(IF_ON_ITEM.replace('%s', py.re.escape(item)), t, 'i'))) {
        findings.push(['PERF05',
          `${name}: retrieves all of ${entity} and keeps rows with an \`if\` in the loop -- put ` +
          `that condition in the retrieve: \`retrieve $${lst} from ${entity} where [...];\`, so ` +
          `the database returns only those rows${where}`, line]);
      }
    }
  }
  return findings;
}

// The names perf_rules.py defines. Dicts come back as plain objects, tuples as arrays.
module.exports = {
  FLOW_HEAD, RETRIEVE, LOOP, WHILE, END_LOOP, ACCUM, TRAILING_COMMENT, SET, COMPARE, KEEP, CALL, WRITE, CONTROL,
  IF_ON_ITEM, ONE_TIME, VIEW_FIX,
  statementsOf, perfFindings, rx,
};
