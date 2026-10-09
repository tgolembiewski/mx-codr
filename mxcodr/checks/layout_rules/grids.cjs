// GRID02: a button that changes the rows a data grid shows sits in that grid's own header.
//
// Data Grid 2 has a header above its rows -- `controlbar` in MDL, where the grid-wide filters go.
// A New, Delete-selected or Mark-paid button belongs there, with the rows it changes, not in a
// container above or beside the grid.
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { parse } = require('./pages.cjs');

// The grid's entity: `DataSource: database from Mod.Entity` or `DataSource: microflow Mod.DS_x(...)`.
const DB_SOURCE_RE = re.compile(String.raw`\bDataSource:\s*database\s+(?:from\s+)?(?P<entity>[A-Za-z_]\w*\.[A-Za-z_]\w*)`, 'i');
const FLOW_SOURCE_RE = re.compile(String.raw`\bDataSource:\s*(?:microflow|nanoflow)\s+(?P<flow>[A-Za-z_]\w*\.[A-Za-z_]\w*)`, 'i');
const ACTION_RE = re.compile(String.raw`\bAction:\s*(?P<action>.+)`, 'i');
const CREATE_OBJECT_RE = re.compile(String.raw`^create_object\s+(?P<entity>[A-Za-z_]\w*\.[A-Za-z_]\w*)`, 'i');
const CALL_RE = re.compile(String.raw`^(?:microflow|nanoflow)\s+(?P<flow>[A-Za-z_]\w*\.[A-Za-z_]\w*)`, 'i');
const BUTTONS = new Set(['actionbutton', 'linkbutton', 'container']);

// Flow dumps: one `create [or modify] microflow|nanoflow Mod.Name` per flow.
const FLOW_HEAD_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:microflow|nanoflow)\s+(?P<name>[\w.]+)`, 'im');
const RETURNS_RE = re.compile(String.raw`^\s*returns\s+list\s+of\s+(?P<entity>[\w.]+)`, 'im');
const CALLS_RE = re.compile(String.raw`\bcall\s+(?:microflow|nanoflow)\s+(?P<flow>[A-Za-z_]\w*\.[A-Za-z_]\w*)`, 'i');
const WRITE_RE = re.compile(String.raw`\b(?:change|commit|delete)\s+\$(?P<var>\w+)`, 'i');

// {flow name: its text} (a Map; a later flow of the same name replaces the earlier text).
function flowBodies(flows) {
  const heads = [...FLOW_HEAD_RE.finditer(flows)];
  const bodies = new Map();
  heads.forEach((h, i) => bodies.set(h.group('name'), flows.slice(h.start(), i + 1 < heads.length ? heads[i + 1].start() : flows.length)));
  return bodies;
}

// Variables of the entity (or a list of it) in one flow: parameters, retrieves, creates, loops.
function typed(body, entity) {
  const e = re.escape(entity);
  const found = new Set(re.findall(String.raw`\$(\w+)\s*:\s*(?:list\s+of\s+)?` + e + String.raw`\b`, body, 'i'));
  for (const v of re.findall(String.raw`\bretrieve\s+\$(\w+)\s+from\s+(?:database\s+)?` + e + String.raw`\b`, body, 'i')) found.add(v);
  for (const v of re.findall(String.raw`\$(\w+)\s*=\s*create\s+(?:list\s+of\s+)?` + e + String.raw`\b`, body, 'i')) found.add(v);
  for (const [item, source] of re.findall(String.raw`\bloop\s+\$(\w+)\s+in\s+\$(\w+)`, body, 'i')) {
    if (found.has(source)) found.add(item);
  }
  return found;
}

// Does the flow, or a flow it calls (three deep), create, change, commit or delete the entity?
function writes(flow, entity, bodies, depth = 0, seen = null) {
  seen = seen !== null ? seen : new Set();
  const body = bodies.has(flow) ? bodies.get(flow) : null;
  if (body === null || seen.has(flow) || depth > 3) return false;
  seen.add(flow);
  if (re.search(String.raw`\bcreate\s+(?:list\s+of\s+)?` + re.escape(entity) + String.raw`\b`, body, 'i')) return true;
  const vars = typed(body, entity);
  for (const m of WRITE_RE.finditer(body)) if (vars.has(m.group('var'))) return true;
  for (const m of CALLS_RE.finditer(body)) if (writes(m.group('flow'), entity, bodies, depth + 1, seen)) return true;
  return false;
}

// GRID02: buttons outside a data grid that change the rows it shows.
function headerButtonFindings(lines, flows) {
  const bodies = flowBodies(flows);
  const widgets = parse(lines);
  const failures = [];
  const pages = new Map();
  for (const widget of widgets) {
    if (!pages.has(widget.page)) pages.set(widget.page, []);
    pages.get(widget.page).push(widget);
  }
  for (const [page, items] of pages) {
    const grids = [];   // [grid widget, entity, [start, end) of its subtree]
    items.forEach((widget, i) => {
      if (widget.type !== 'datagrid') return;
      let entity = '';
      const db = DB_SOURCE_RE.search(widget.text);
      if (db) {
        entity = db.group('entity');
      } else {
        const source = FLOW_SOURCE_RE.search(widget.text);
        const returned = source && RETURNS_RE.search(bodies.has(source.group('flow')) ? bodies.get(source.group('flow')) : '');
        entity = returned ? returned.group('entity') : '';
      }
      let end = i + 1;
      while (end < items.length && items[end].indent > widget.indent) end++;
      grids.push([widget, entity, [i, end]]);
    });
    if (!grids.length) continue;
    items.forEach((widget, i) => {
      if (!BUTTONS.has(widget.type) || grids.some(([, , [a, b]]) => i >= a && i < b)) return;
      const found = ACTION_RE.search(widget.text);
      if (!found) return;
      const action = py.strip(found.group('action'));
      for (const [grid, entity] of grids) {
        let why = '';
        const created = CREATE_OBJECT_RE.match(action);
        const called = CALL_RE.match(action);
        if (re.search(String.raw`\$` + re.escape(grid.name) + String.raw`\b`, action)) {
          why = `it acts on ${grid.name}'s selection`;
        } else if (entity && created && created.group('entity').toLowerCase() === entity.toLowerCase()) {
          why = `it creates ${entity} objects, the rows of ${grid.name}`;
        } else if (entity && called && writes(called.group('flow'), entity, bodies)) {
          why = `${called.group('flow')} changes ${entity}, the rows of ${grid.name}`;
        }
        if (!why) continue;
        failures.push({
          check: 'GRID02',
          line: widget.line,
          message: `${page}: ${widget.type} ${widget.name} sits outside data grid ${grid.name}, but ${why}` +
            ` -- move it into the grid's header: \`controlbar ctb${grid.name.startsWith('dg') ? grid.name.slice(2) : grid.name} { ... }\`` +
            ` inside \`datagrid ${grid.name} { }\`, after the columns. The header is not row-scoped:` +
            ` pass the grid's selection as \`$${grid.name}\` or a page parameter; \`$currentObject\`` +
            " and an enclosing data view's name do not resolve there (CE0117)",
        });
        break;
      }
    });
  }
  return failures;
}

module.exports = { headerButtonFindings, flowBodies, writes };
