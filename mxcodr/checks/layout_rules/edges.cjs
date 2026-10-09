// EDGE01 (a widget outside a layout grid, at the top of a page, touches the edge of the window).
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { PAGE_LAYOUT_RE, parse, spacingOf } = require('./pages.cjs');

// The Atlas_Core layouts give the page no side margin: a heading or a button placed straight on
// the page sits against the menu on the left and the window on the right. A layoutgrid adds the
// gutter. A session built every page with its title and its Back / signed-in row outside the grid.
const DOCUMENT_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?P<kind>page|snippet)\s+(?P<name>[\w.]+)`, 'i');
const SNIPPET_CALL_RE = re.compile(String.raw`\bSnippet:\s*(?P<name>[\w.]+)`);
const LOGIN_PAGE_RE = re.compile(String.raw`^\s*login\s+page\s+(?P<page>[\w.]+)`, 'i');
// Pages whose layout frames them already: a pop-up has its own padding, a login page no menu.
const FRAMED_LAYOUT_RE = re.compile('popup|login', 'i');
// Widgets that only hold others: safe when everything inside them is.
const WRAPPERS = new Set(['container', 'dataview', 'scrollcontainer', 'groupbox']);
const GRID_WRAPPER = 'layoutgrid pageGrid { row row1 { column col1 (DesktopWidth: 12) { ... } } }';

// [[kind, name], [line number of its first line, its lines]] for every page and snippet; a later
// document with the same kind and name takes the place of the first.
function documents(lines) {
  const found = new Map();
  let key = null;
  lines.forEach((line, i) => {
    const head = DOCUMENT_RE.match(line);
    if (head) {
      const pair = [head.group('kind').toLowerCase(), head.group('name')];
      key = JSON.stringify(pair);
      found.set(key, [pair, [i + 1, []]]);
    }
    if (key) found.get(key)[1][1].push(line);
  });
  return [...found.values()];
}

// The widgets at the smallest indent: what sits straight on the page or snippet.
function topLevel(widgets) {
  if (!widgets.length) return [];
  const indent = Math.min(...widgets.map(w => w.indent));
  return widgets.filter(w => w.indent === indent);
}

// The direct children of parent, from the flat widget list parse() returns.
function children(widgets, parent) {
  const start = widgets.indexOf(parent) + 1;
  const inside = [];
  for (const widget of widgets.slice(start)) {
    if (widget.indent <= parent.indent) break;
    inside.push(widget);
  }
  return topLevel(inside);
}

// True when the widget keeps its content off the window's edge.
function edgeSafe(widget, widgets, snippets, depth = 0) {
  if (widget.type === 'layoutgrid') return true;
  const spacing = spacingOf(widget);
  const get = (k) => (spacing.has(k) ? spacing.get(k) : 'None');
  if (get('padding-left') !== 'None' && get('padding-right') !== 'None') return true;
  if (widget.type === 'snippetcall') {
    const called = SNIPPET_CALL_RE.search(widget.text);
    const inner = called && snippets.has(called.group('name')) ? snippets.get(called.group('name')) : null;
    if (inner === null || depth > 3) return true;   // a snippet this run could not read (Atlas_Core's, say) is not judged
    return topLevel(inner).every(top => edgeSafe(top, inner, snippets, depth + 1));
  }
  if (WRAPPERS.has(widget.type)) return children(widgets, widget).every(child => edgeSafe(child, widgets, snippets, depth));
  return false;
}

// EDGE01: a page on an Atlas_Core layout with a widget outside a layoutgrid at its top.
function edgeFindings(lines, snippetText, navigation) {
  const loginPages = new Set();
  for (const line of py.splitlines(navigation)) {
    const m = LOGIN_PAGE_RE.match(line);
    if (m) loginPages.add(m.group('page'));
  }
  const snippets = new Map();
  for (const [[kind, name], [, block]] of documents(py.splitlines(snippetText))) if (kind === 'snippet') snippets.set(name, parse(block));
  for (const [[kind, name], [, block]] of documents(lines)) if (kind === 'snippet') snippets.set(name, parse(block));
  const failures = [];
  for (const [[kind, page], [start, block]] of documents(lines)) {
    if (kind !== 'page' || loginPages.has(page)) continue;
    const layout = PAGE_LAYOUT_RE.search(block.slice(0, 12).join(' '));
    if (!layout || !layout.group('layout').startsWith('Atlas_Core.') || FRAMED_LAYOUT_RE.search(layout.group('layout'))) continue;
    const widgets = parse(block);
    const loose = topLevel(widgets).filter(w => !edgeSafe(w, widgets, snippets));
    if (!loose.length) continue;
    const names = loose.map(w => `${w.type} ${w.name}`).join(', ');
    failures.push({
      check: 'EDGE01',
      line: start + loose[0].line - 1,
      message: `${page}: ${names} sit outside a layout grid, so they touch the edge of the window` +
        ' (Atlas layouts add no side margin; a layoutgrid does) -- put the page\'s widgets,' +
        ` the Back / signed-in row and the heading too, inside ${GRID_WRAPPER}` +
        " (skill spacing-and-layout, 'Structure')",
    });
  }
  return failures;
}

module.exports = { edgeFindings };
