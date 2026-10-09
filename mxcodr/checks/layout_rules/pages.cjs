// Reading `describe page` dumps: widgets, their nesting, spacing, and the page blocks the
// other rule modules look at. Rules live in the sibling modules; this one has none of its own.
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;

// Spacing values Atlas Core's design-properties.json defines.
const SPACING_VALUES = new Set(['None', 'S', 'M', 'L']);

// Layout containers never take a margin of their own.
const STRUCTURAL = new Set(['row', 'column', 'region', 'placeholder', 'controlbar', 'header', 'footer']);

// Rendered on one line, so they touch unless spaced; block-level widgets are spaced by the theme.
const INLINE = new Set(['actionbutton', 'linkbutton', 'dynamictext', 'text', 'image', 'staticimage',
  'dynamicimage', 'checkbox', 'radiobuttons']);

// A heading renders as a block, so it never joins a line run; it only needs margin-bottom.
const HEADING_MODE = re.compile(String.raw`RenderMode:\s*(H1|H2|H3)`, 'i');

function isHeading(widget) {
  return (widget.type === 'dynamictext' || widget.type === 'text') && Boolean(HEADING_MODE.search(widget.text));
}

// Split siblings into the runs of inline widgets that share one line.
function runsOf(group) {
  const runs = [];
  let current = [];
  for (const widget of group) {
    if (!INLINE.has(widget.type) || STRUCTURAL.has(widget.type) || isHeading(widget)) {
      if (current.length) runs.push(current);
      current = [];
      continue;
    }
    current.push(widget);
  }
  if (current.length) runs.push(current);
  return runs;
}

// `<indent><type> <name> (` or `{`; name may be "double-quoted".
const WIDGET_RE = re.compile(String.raw`^(?P<indent>\s*)(?P<type>[a-z][a-z0-9_]*)\s+(?P<name>\"[^\"]+\"|[A-Za-z_][\w/]*)\s*[({]`);
// Unnamed widget: `<type> (` or `{`.
const ANON_RE = re.compile(String.raw`^(?P<indent>\s*)(?P<type>[a-z][a-z0-9_]*)\s*[({]`);
// Group "body": the inside of `'Spacing': [ ... ]`.
const SPACING_RE = re.compile(String.raw`'Spacing'\s*:\s*\[(?P<body>[^\]]*)\]`);
// One `'margin-right': 'S'` pair.
const PAIR_RE = re.compile(String.raw`'(?P<key>margin|padding)-(?P<side>top|right|bottom|left)'\s*:\s*'(?P<value>[^']*)'`);

class Widget {
  constructor(wtype, name, line, indent, page) {
    this.type = wtype;
    this.name = py.strip(name, '"');
    this.line = line;
    this.indent = indent;
    this.text = '';
    this.page = page;
  }
}

const indentOf = line => line.length - py.lstrip(line).length;

// Widgets in the dump with their property text; indentation gives the nesting.
function parse(lines) {
  const widgets = [];
  let page = '';
  let openWidget = null;
  lines.forEach((raw, i) => {
    const number = i + 1;
    const line = py.rstrip(raw);
    if (!py.strip(line) || py.lstrip(line).startsWith('--')) return;
    const pageMatch = PAGE_RE.match(py.strip(line));
    if (pageMatch) {
      page = pageMatch.group('name').split('"').join('');
      openWidget = null;
      return;
    }
    const match = WIDGET_RE.match(line) || ANON_RE.match(line);
    if (match && !['create', 'grant', 'layouttype', 'class'].includes(match.group('type'))) {
      const widget = new Widget(match.group('type'), match.groupdict().name || '', number,
        match.group('indent').length, page);
      widget.text = py.strip(line);
      widgets.push(widget);
      openWidget = widget;
      return;
    }
    // Deeper lines (e.g. multi-line DesignProperties) belong to the open widget.
    if (openWidget !== null && indentOf(line) > openWidget.indent) openWidget.text += ' ' + py.strip(line);
  });
  return widgets;
}

// Group widgets by (page, parent line, indent): [[page, parentLine, indent], group] in first-seen order.
function siblings(widgets) {
  const groups = new Map();
  widgets.forEach((widget, index) => {
    let parentLine = 0;
    for (let j = index - 1; j >= 0; j--) {
      const earlier = widgets[j];
      if (earlier.page === widget.page && earlier.indent < widget.indent) {
        parentLine = earlier.line;
        break;
      }
    }
    const key = JSON.stringify([widget.page, parentLine, widget.indent]);
    if (!groups.has(key)) groups.set(key, [[widget.page, parentLine, widget.indent], []]);
    groups.get(key)[1].push(widget);
  });
  return [...groups.values()];
}

// Spacing as {"margin-right": "S", ...}; unset sides are absent. A Map, in the order written.
function spacingOf(widget) {
  const found = SPACING_RE.search(widget.text);
  const out = new Map();
  if (!found) return out;
  for (const m of PAIR_RE.finditer(found.group('body'))) out.set(`${m.group('key')}-${m.group('side')}`, m.group('value'));
  return out;
}
const PAGE_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?page\s+(?P<name>[\w.]+)`, 'i');

// BACK01 -------------------------------------------------------------------------------------
const SHOW_PAGE_ANY_RE = re.compile(String.raw`\bshow[_ ]page\s+(?P<page>[A-Za-z_]\w*\.[A-Za-z_]\w*)`, 'i');
const PAGE_LAYOUT_RE = re.compile(String.raw`\bLayout:\s*(?P<layout>[\w.]+)`, 'i');
const WIDGET_LINE_RE = re.compile(String.raw`^\s*(?P<type>[a-z]+)\s+(?P<name>\"[^\"]*\"|[\w.]+)\s*(?P<rest>[({].*)?$`, 'i');
// Containers a Back button may sit inside and still be the first thing on the page.
const BACK_WRAPPERS = new Set(['layoutgrid', 'row', 'column', 'container', 'dataview', 'scrollcontainer', 'region', 'header']);

// {page: its describe lines}, in dump order (a Map).
function pageBlocks(lines) {
  const blocks = new Map();
  let page = '';
  for (const line of lines) {
    const found = PAGE_RE.match(line);
    if (found) {
      page = found.group('name');
      blocks.set(page, []);
    }
    if (page) blocks.get(page).push(line);
  }
  return blocks;
}

function bodyStart(block) {
  const i = block.findIndex(line => py.rstrip(line).endsWith('{'));
  return i < 0 ? block.length : i + 1;
}

function propsOf(block, index) {
  const line = block[index];
  let props = line;
  if (py.rstrip(line).endsWith('(')) {
    let look = index + 1;
    while (look < block.length && !py.strip(block[look]).startsWith(')')) {
      props += ' ' + py.strip(block[look]);
      look++;
    }
  }
  return props;
}

// [type, full property text] of the first widget that is not a container.
function firstWidget(block) {
  // The page header (`create page X (` ... `) {`) ends at its first line ending in `{`.
  for (let index = bodyStart(block); index < block.length; index++) {
    const line = block[index];
    if (py.strip(line).startsWith('--')) continue;
    const found = WIDGET_LINE_RE.match(line);
    if (!found || BACK_WRAPPERS.has(found.group('type').toLowerCase())) continue;
    return [found.group('type').toLowerCase(), propsOf(block, index)];
  }
  return ['', ''];
}

// [type, property text, indent] of the first <count> widgets that are not containers.
function leadingWidgets(block, count = 2) {
  const found = [];
  for (let index = bodyStart(block); index < block.length; index++) {
    const line = block[index];
    const widget = WIDGET_LINE_RE.match(line);
    if (py.strip(line).startsWith('--') || !widget || BACK_WRAPPERS.has(widget.group('type').toLowerCase())) continue;
    found.push([widget.group('type').toLowerCase(), propsOf(block, index), indentOf(line)]);
    if (found.length === count) break;
  }
  return found;
}

module.exports = {
  SPACING_VALUES, STRUCTURAL, INLINE, isHeading, runsOf, WIDGET_RE, ANON_RE, Widget, parse, siblings, spacingOf,
  PAGE_RE, SHOW_PAGE_ANY_RE, PAGE_LAYOUT_RE, WIDGET_LINE_RE, BACK_WRAPPERS, pageBlocks, firstWidget, leadingWidgets,
  indentOf,
};
