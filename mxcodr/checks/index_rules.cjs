// PERF07: a query the app runs often, with no database index that serves it.
//
//     const { indexFindings } = require('./index_rules.cjs');
//     indexFindings(entityLines, documentLines) -> [[code, message, line]]
//
// <entityLines> is DESCRIBE ENTITY output for the project's own entities; <documentLines> is
// DESCRIBE output for its microflows, nanoflows and pages. Each retrieve and page database source
// wants one index: the attributes its XPath compares with `=` first, then the first one it compares
// with `<`, `>`, `<=`, `>=`, or else the first it sorts by. An existing index whose leading columns
// are those serves it; an index on (A, B) also serves a query on A alone, so a shorter suggestion
// another one starts with is dropped, and an existing (A) that (A, B) would replace is named.
// Measured at 200,000 rows, the newest order of one status: 9.9 ms with no index, 2.6 ms with an
// index on each attribute, 0.01 ms with one (Status, DateCreated). Mendix indexes `id`, every
// association and every attribute with a uniqueness rule by itself (measured on PostgreSQL,
// 2026-10-04); everything else is a full table scan. At 10,000 rows both are under 2 ms, so this
// is a warning. Not reported: booleans (two values, the database scans anyway), `!=` and
// `contains()` (an index does not help them), view and non-persistent entities (no table of
// their own), attributes already first in an index, and seed flows (they run once). A port of
// index_rules.py that gives the same findings.
'use strict';
const py = require('./py_compat.cjs');
const { ONE_TIME, rx } = require('./perf_rules.cjs');

// A dict: no prototype, so an attribute named `constructor` is only itself.
const dict = () => Object.create(null);

const ENTITY_HEAD = rx(String.raw`^\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?P<kind>view\s+|non-persistent\s+|persistent\s+)?` +
  String.raw`entity\s+(?P<name>\w+\.(?:\"[^\"]+\"|\w+))`, 'i');
const ATTRIBUTE = rx(String.raw`^\s*\"?(?P<name>\w+)\"?\s*:\s*(?P<type>\w+)(?P<rest>.*)$`);
const INDEX = rx(String.raw`^\s*index\s+(?:\w+\s+)?(?:on\s+)?\((?P<columns>[^)]*)\)`, 'i');
const DOC_HEAD_PATTERN = String.raw`^\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?:microflow|nanoflow|page|snippet)\s+(?P<name>[\w.]+)`;
const RETRIEVE = rx(String.raw`\bretrieve\s+\$\w+\s+from\s+(?:database\s+)?(?P<entity>\w+\.(?:\"[^\"]+\"|\w+))(?P<tail>[^;]*)`, 'is');
const SOURCE = rx(String.raw`\bdatabase\s+(?:from\s+)?(?P<entity>\w+\.(?:\"[^\"]+\"|\w+))(?P<tail>(?:\s+where\s+(?:\[[^\]]*\]|[^,\n]*?(?=\s+sort\s+by|,|\n)))?` +
  String.raw`(?:\s+sort\s+by\s+[\w.\"]+(?:\s+(?:asc|desc))?(?:\s*,\s*[\w.\"]+(?:\s+(?:asc|desc))?)*)?)`, 'is');
// Scripts write `where [A = 1]`; DESCRIBE prints `where A = 1` up to sort by / limit / the end.
const XPATH = rx(String.raw`where\s*(?:\[(?P<xpath>[^\]]*)\]|(?P<bare>.*?)(?=\s+sort\s+by\b|\s+limit\b|\s+first\b|,\s*\w+\s*:|\)\s*$|$))`, 'is');
const COMPARED = rx(String.raw`(?<![\w./$'\"])\"?(?P<attr>[A-Za-z_]\w*)\"?\s*(?P<op><=|>=|=|<|>)`);
// `[$Wanted = Status]`: the attribute on the right. Not `= true`, `= empty` (no such attribute, so
// wanted() drops them), `= Module.Enum.Value` (a dot follows) or `= $Var/Attr` (starts with $).
const COMPARED_RIGHT = rx(String.raw`(?P<op><=|>=|=|<|>)\s*\"?(?P<attr>[A-Za-z_]\w*)\"?(?![\w.(/'\"$%])`);
const OR = rx(String.raw`\s+or\s+`, 'i');
const SORT = rx(String.raw`sort\s+by\s+(?P<list>[\w.\"]+(?:\s+(?:asc|desc))?(?:\s*,\s*[\w.\"]+(?:\s+(?:asc|desc))?)*)`, 'i');
const GRID = rx(String.raw`\bdatagrid\s+\w+\s*\(\s*DataSource:\s*database\s+(?:from\s+)?(?P<entity>\w+\.(?:\"[^\"]+\"|\w+))`, 'i');
// mxcli v0.24 named a data grid column after its attribute (`column Status (Attribute: Status`),
// quoting a path (`column "Invoice_Customer/Name" (...)`), which this did not read; v0.25 writes
// no name, as Mendix stores none: `column (Attribute: Status, ...)`, a path read alike.
const COLUMN = rx(String.raw`^\s*column\s+(?:\"?\w+\"?\s*\(\s*Attribute:\s*\"?(?P<attr>\w+)|` +
  String.raw`\(\s*Attribute:\s*\"?(?P<bare>\w+)(?![\w/]))`, 'i');
const FILTER = rx(String.raw`^\s*(?P<kind>dropdownfilter|datefilter|numberfilter)\b`, 'i');
const VIEW_HEAD = rx(String.raw`^\s*create\s+(?:or\s+(?:modify|replace)\s+)?view\s+entity\s+(?P<name>[\w.]+)`, 'i');
// `from Orders.Invoice as i`, `inner join Orders.Order_Customer/Orders."Order" as o`: the alias of an entity.
const OQL_SOURCE = rx(String.raw`\b(?:from|join)\s+(?:[\w.\"]+/)*(?P<entity>\w+\.(?:\"[^\"]+\"|\w+))\s+as\s+(?P<alias>\w+)`, 'i');
const OQL_ORDER = rx(String.raw`\border\s+by\s+(?P<list>[^;)]*)`, 'i');
// `[Orders.Order_Customer = $Customer]`, `[A/B.C/D.E = $x]`: a query that follows an association,
// whose own index (Mendix makes one) narrows the rows before any attribute is read.
const ASSOCIATION = rx(String.raw`(?<![\w.$'\"])\w+\.\w+(?:/[\w.\"]+)*\s*=(?!=)`);
const SKIP_TYPES = new Set(['boolean', 'binary', 'hashstring', 'autonumber']);

const plain = name => name.split('"').join('');
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const lowerAll = columns => columns.map(n => n.toLowerCase());

// How many `create ... entity` heads the text has, of any kind.
function entityHeads(lines) {
  return lines.filter(line => ENTITY_HEAD.match(line)).length;
}

// {entity: {attributes: {lower: [name, type]}, indexes: [[lower columns...]], explicit:
// [[columns, spelled]]}}; a unique attribute counts as an index of its own (Mendix creates one).
function entities(lines) {
  const found = dict();
  let current = null;
  for (const line of lines) {
    const head = ENTITY_HEAD.match(line);
    if (head) {
      const kind = py.strip(head.group('kind') || 'persistent').toLowerCase();
      current = kind === 'persistent' ? plain(head.group('name')) : null;
      if (current) found[current] = { attributes: dict(), indexes: [], explicit: [] };
      continue;
    }
    if (current === null) continue;
    if (py.strip(line) === '/') { current = null; continue; }
    if (py.re.match(String.raw`^\s*(grant|@|/\*\*|\*)`, line)) continue;
    const index = INDEX.match(line);
    if (index) {
      const columns = index.group('columns').split(',').map(part => plain(py.split(py.strip(part))[0]).toLowerCase());
      found[current].indexes.push(columns);
      found[current].explicit.push([columns, py.strip(index.group('columns'))]);
      continue;
    }
    const attribute = ATTRIBUTE.match(line);
    if (attribute) {
      const name = attribute.group('name');
      found[current].attributes[name.toLowerCase()] = [name, attribute.group('type').toLowerCase()];
      if (py.re.search(String.raw`\bunique\b`, attribute.group('rest'), 'i')) found[current].indexes.push([name.toLowerCase()]);
    }
  }
  return found;
}

// [entity, attributes compared with =, compared with < > <= >=, sorted on, document, line,
// follows an association] for every retrieve, page database source and grid filter.
function queries(lines) {
  const text = lines.join('\n');
  const starts = [...py.re.finditer(DOC_HEAD_PATTERN, text, 'im')].map(m => [m.start(), m.group('name')]);
  const documentAt = offset => {
    let name = '';
    for (const [start, doc] of starts) {
      if (start > offset) break;
      name = doc;
    }
    return name;
  };
  const countNewlines = end => {
    let n = 0;
    for (let i = text.indexOf('\n'); i >= 0 && i < end; i = text.indexOf('\n', i + 1)) n++;
    return n;
  };
  const found = [];
  for (const pattern of [RETRIEVE, SOURCE]) {
    for (const match of pattern.finditer(text)) {
      const tail = match.group('tail');
      let sort = [], through = false;
      // One (equal, ranged) pair per `or` branch: `[A = 1 or B = 2]` is two lookups, each
      // wanting its own index, not one on (A, B).
      const branches = [];
      for (const xpath of XPATH.finditer(tail)) {
        // contains(Attr, ...) and starts-with(...) are left out: an index does not help them.
        const condition = xpath.group('xpath') !== null ? xpath.group('xpath') : xpath.group('bare');
        let cleaned = py.re.sub(String.raw`\b(contains|starts-with|ends-with)\s*\([^)]*\)`, '', condition, 0, 'i');
        cleaned = py.re.sub(String.raw`'[^']*'`, "''", cleaned);       // a literal is not an attribute
        through = through || Boolean(ASSOCIATION.search(cleaned));
        for (const branch of OR.split(cleaned)) {
          const equal = [], ranged = [];
          for (const compared of [...COMPARED.finditer(branch), ...COMPARED_RIGHT.finditer(branch)]) {
            (compared.group('op') === '=' ? equal : ranged).push(compared.group('attr'));
          }
          branches.push([equal, ranged]);
        }
      }
      for (const sortedBy of SORT.finditer(tail)) {
        sort = sort.concat(sortedBy.group('list').split(',').map(item => plain(py.split(py.strip(item))[0]).split('.').pop()));
      }
      // A combo box lists its options in caption order: `CaptionAttribute: Name` on a database
      // source sorts on Name. PERF08 called a picker's (Name) index unused (B2B, 2026-10-07).
      if (pattern === SOURCE && !sort.length) {
        const head = text.lastIndexOf('(', match.start());
        const widget = /\b(combobox|referenceselector|referencesetselector|inputreferencesetselector)\s+[\w"]+\s*$/i.exec(text.slice(Math.max(0, head - 120), head));
        const caption = /CaptionAttribute:\s*"?(\w+)"?/i.exec(text.slice(match.end(), match.end() + 400).split(/\)\s*(?:\{|$)/m)[0]);
        if (widget && caption) sort = [caption[1]];
      }
      const alone = branches.length <= 1;
      for (const [equal, ranged] of (branches.length ? branches : [[[], []]])) {
        // A sort belongs to the query as a whole; with `or` no single index gives the order.
        found.push([plain(match.group('entity')), equal, ranged, alone ? sort : [],
          documentAt(match.start()), countNewlines(match.start()) + 1, through]);
      }
    }
  }
  // A data grid's column filter is a query too: a drop-down filter compares with `=`, a date or
  // number filter with a range. A text filter is `contains()`, which an index does not help.
  let grid = null, column = null, offset = 0, gridOpen = false;
  py.splitlines(text).forEach((line, i) => {
    const number = i + 1;
    const at = offset;
    offset = offset + line.length + 1;
    const source = GRID.search(line);
    if (source) { grid = plain(source.group('entity')); gridOpen = false; return; }
    // mxcli 0.25 puts a grid's properties on their own lines: `datagrid X (`, then `DataSource: ...`.
    if (/^\s*datagrid\s+\S+\s*\(\s*$/i.test(line)) { gridOpen = true; grid = null; return; }
    if (gridOpen) {
      const own = /^\s*DataSource:\s*database\s+(?:from\s+)?(\w+\.(?:"[^"]+"|\w+))/i.exec(line);
      if (own) { grid = plain(own[1]); gridOpen = false; return; }
      if (/^\s*\)/.test(line)) gridOpen = false;
    }
    const attribute = COLUMN.search(line);
    if (attribute) { column = attribute.group('attr') || attribute.group('bare'); return; }
    const widget = FILTER.search(line);
    if (widget && grid && column) {
      const kind = widget.group('kind').toLowerCase();
      const [equal, ranged] = kind === 'dropdownfilter' ? [[column], []] : [[], [column]];
      found.push([grid, equal, ranged, [], documentAt(at), number, false]);
      column = null;
    }
  });
  return found;
}

// The queries in view entities' OQL, one per alias of an entity it reads: `i.Status = 'x'`
// compares with `=`, `i.DueDate < ...` with a range, `order by i.Date` sorts. A view's query
// runs every time a page or a retrieve reads the view. Pi kept a (DueDate) index that two views
// filter on, and PERF08 called it unused because it read no OQL (2026-10-04).
function oqlQueries(entityLines) {
  const found = [];
  let view = null, body = [], start = 0;
  [...entityLines, '/'].forEach((line, i) => {
    const number = i + 1;
    const head = VIEW_HEAD.match(line);
    if (head || py.strip(line) === '/' || ENTITY_HEAD.match(line)) {
      if (view && body.length) {
        const text = body.join('\n');
        for (const source of OQL_SOURCE.finditer(text)) {
          const alias = py.re.escape(source.group('alias'));
          const equal = [], ranged = [];
          let sort = [];
          for (const compared of py.re.finditer(String.raw`(?<![\w.])${alias}\.\"?(?P<attr>\w+)\"?\s*(?P<op><=|>=|=|<|>)`, text)) {
            (compared.group('op') === '=' ? equal : ranged).push(compared.group('attr'));
          }
          for (const order of OQL_ORDER.finditer(text)) {
            sort = sort.concat([...py.re.finditer(String.raw`(?<![\w.])${alias}\.\"?(\w+)`, order.group('list'))].map(m => m.group(1)));
          }
          const through = Boolean(py.re.search(String.raw`(?<![\w.])${alias}/\w+\.`, text));
          found.push([plain(source.group('entity')), equal, ranged, sort, view, start, through]);
        }
      }
      if (head) { view = head.group('name'); body = []; start = number; } else { view = null; body = []; start = 0; }
      return;
    }
    if (view) body.push(line);
  });
  return found;
}

// The index one query wants: its `=` attributes first, then its first range or sort attribute
// (a B-tree serves equality on the leading columns, then one range or the order). At most three.
function wanted(info, equal, ranged, sort) {
  const usable = names => {
    const out = [];
    for (const attr of names) {
      const entry = info.attributes[attr.toLowerCase()];
      if (entry && !SKIP_TYPES.has(entry[1]) && !out.includes(entry[0])) out.push(entry[0]);
    }
    return out;
  };
  const columns = usable(equal);
  const firstRange = usable(ranged).slice(0, 1);
  const tail = firstRange.length ? firstRange : usable(sort).slice(0, 1);
  for (const name of tail) if (!columns.includes(name)) columns.push(name);
  return columns.slice(0, 3);
}

function indexFindings(entityLines, documentLines) {
  const known = entities(entityLines);
  const places = new Map();      // key -> {entity, columns, documents}
  const firstLine = new Map();
  const keyOf = (entity, columns) => JSON.stringify([entity, columns]);
  for (const [entity, equal, ranged, sort, document, line, through] of [...queries(documentLines), ...oqlQueries(entityLines)]) {
    const info = known[entity];
    // A query along an association is served by the association's index: Mendix model indexes
    // cannot include it, and an attribute index adds little after it.
    if (!info || through || (document && ONE_TIME.search(document))) continue;
    const columns = wanted(info, equal, ranged, sort);
    if (!columns.length) continue;
    const key = keyOf(entity, columns);
    if (!places.has(key)) places.set(key, { entity, columns, documents: [] });
    if (document && !places.get(key).documents.includes(document)) places.get(key).documents.push(document);
    if (!firstLine.has(key)) firstLine.set(key, line);
  }

  const covered = (entity, columns) => known[entity].indexes.some(index => same(index.slice(0, columns.length), lowerAll(columns)));
  let keys = [...places.values()].filter(p => !covered(p.entity, p.columns));
  // An index on (A, B) also serves a query on A alone: drop a suggestion another one starts with.
  keys = keys.filter(({ entity, columns }) => !keys.some(o => o.entity === entity && o.columns.length > columns.length &&
    same(o.columns.slice(0, columns.length), columns)));
  const findings = [];
  for (const { entity, columns } of py.sorted(keys, p => [p.entity, p.columns])) {
    const documents = [...places.get(keyOf(entity, columns)).documents];
    for (const other of places.values()) {     // the places of the queries this index also serves
      if (other.entity === entity && other.columns.length < columns.length && same(columns.slice(0, other.columns.length), other.columns)) {
        for (const d of other.documents) if (!documents.includes(d)) documents.push(d);
      }
    }
    const where = documents.slice(0, 3).join(', ') + (documents.length > 3 ? ` and ${documents.length - 3} more` : '');
    const listed = columns.join(', ');
    const add = `\`alter entity ${entity} add index if not exists (${listed});\``;
    let message;
    if (columns.length === 1) {
      message = `${entity}.${columns[0]} is filtered or sorted on (${where || 'a retrieve'}) and no index ` +
        `starts with it: every such query reads the whole table. ${add} -- measured at 200k rows: ` +
        'the latest row by date 35 ms -> 0.01 ms, one status 9.7 -> 2.0 ms. An index costs a ' +
        'little on every commit, so index what is filtered or sorted, not every attribute';
    } else {
      // Only an index the model declares can be dropped: a `unique` attribute has one Mendix
      // made itself, and "drop index (Code)" for it named an index nobody created.
      const replaced = known[entity].explicit.map(([index]) => index)
        .filter(index => index.length < columns.length && same(lowerAll(columns).slice(0, index.length), index));
      const drop = replaced.map(index =>
        ` then \`alter entity ${entity} drop index if exists (${columns.slice(0, index.length).join(', ')});\`, which it replaces.`).join('');
      message = `${entity} is filtered on ${columns.slice(0, -1).join(', ')} and filtered or sorted on ${columns[columns.length - 1]} in ` +
        `one query (${where || 'a retrieve'}): one index (${listed}) serves it, the \`=\` attributes ` +
        `first -- ${add}${drop} Measured at 200k rows, the newest order of one status: 9.9 ms with no ` +
        'index, 2.6 ms with an index on each attribute, 0.01 ms with one (Status, DateCreated). It ' +
        `also serves queries on ${columns[0]} alone`;
    }
    findings.push(['PERF07', message, firstLine.get(keyOf(entity, columns))]);
  }
  return findings;
}

// How many leading columns of <index> the query that wants <want> can use.
function matchLength(index, want) {
  let length = 0;
  for (let i = 0; i < Math.min(index.length, want.length); i++) {
    if (index[i] !== want[i]) break;
    length += 1;
  }
  return length;
}

// PERF08: an index of the model that no query needs. Another index that starts with the same
// columns serves everything it does; or no retrieve, page data source or grid filter uses it
// better than another index. Pi kept (CapturedOn) and (DueDate) after adding (Currency,
// CapturedOn) and (PaymentStatus, DueDate) for the same queries: each slows every commit.
function redundantFindings(entityLines, documentLines) {
  const known = entities(entityLines);
  const wants = new Map();
  for (const [entity, equal, ranged, sort, document] of [...queries(documentLines), ...oqlQueries(entityLines)]) {
    const info = known[entity];
    if (!info || (document && ONE_TIME.search(document))) continue;
    const columns = wanted(info, equal, ranged, sort);
    if (columns.length) {
      if (!wants.has(entity)) wants.set(entity, []);
      wants.get(entity).push(lowerAll(columns));
    }
  }
  // No query recognised anywhere is not "no query needs an index": it is a describe format this
  // file does not read, and every index of the model would be called unneeded.
  if (!wants.size) return [];
  const findings = [];
  for (const [entity, info] of py.sorted(Object.entries(known), e => e[0])) {
    const explicit = info.explicit;
    explicit.forEach(([columns, spelled], position) => {
      const longer = explicit.filter(([other], i) => i !== position && same(other.slice(0, columns.length), columns) &&
        (other.length > columns.length || i < position)).map(([, otherSpelled]) => otherSpelled);
      const drop = `\`alter entity ${entity} drop index if exists (${spelled});\``;
      let reason;
      if (longer.length) {
        reason = `the index (${longer[0]}) starts with the same columns and serves every ` +
          'query this one does';
      } else {
        // Every other index: the explicit ones but this, and the unique attributes' own.
        const explicitColumns = explicit.map(([e]) => e);
        const others = [...explicit.filter((_, i) => i !== position).map(([o]) => o),
          ...info.indexes.filter(index => !explicitColumns.some(e => same(e, index)))];
        const needed = (wants.get(entity) || []).some(want => {
          const mine = matchLength(columns, want);
          return mine > 0 && mine >= Math.max(...(others.length ? others.map(o => matchLength(o, want)) : [0]));
        });
        if (needed) return;
        reason = 'no retrieve, page data source, grid filter or view entity in the model needs it: another index ' +
          'serves each query that touches these columns, or none does';
      }
      findings.push(['PERF08',
        `${entity} has the index (${spelled}), but ${reason}. It only slows every commit: ${drop} ` +
        '-- keep it if Java, an OQL query outside a view or an external client filters on it', 0]);
    });
  }
  return findings;
}

const DOC_HEAD = rx(DOC_HEAD_PATTERN, 'i');

// The names index_rules.py defines. Dicts come back as null-prototype objects, tuples as arrays;
// SKIP_TYPES (a set in Python) as a sorted array.
module.exports = {
  ENTITY_HEAD, ATTRIBUTE, INDEX, DOC_HEAD, RETRIEVE, SOURCE, XPATH, COMPARED, COMPARED_RIGHT, OR, SORT, GRID, COLUMN,
  FILTER, VIEW_HEAD, OQL_SOURCE, OQL_ORDER, ASSOCIATION, SKIP_TYPES: [...SKIP_TYPES].sort(), ONE_TIME,
  entities, queries, wanted, entityHeads, oqlQueries, indexFindings, matchLength, redundantFindings,
};
