// LAYOUT01 (every page on the same layout, pop-ups and login aside) and NAV04 (a layout of
// the project's own that builds a menu out of buttons).
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { ONE_MENU } = require('./navigation.cjs');
const { PAGE_LAYOUT_RE, pageBlocks } = require('./pages.cjs');

// LAYOUT01 -----------------------------------------------------------------------------------
// Layouts that are rightly different from the app's main one: a pop-up closes with its own X, a
// login page has no menu, and phone/tablet profiles have layouts of their own.
const OWN_KIND_LAYOUT_RE = re.compile('popup|login|phone|tablet', 'i');
const LAYOUT_TYPE_RE = re.compile(String.raw`layouttype:\s*'(?P<type>\w+)'`, 'i');
const LOGIN_PAGE_RE = re.compile(String.raw`^\s*login\s+page\s+(?P<page>[\w.]+)`, 'i');
const LAYOUT_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?layout\s+(?P<name>[\w.]+)`, 'i');
const SHOW_PAGE_RE = re.compile(String.raw`\bshow_page\s+(?P<page>[\w.]+)`, 'i');

// {Module.Layout: layouttype} (a Map) for the project's own layouts.
function layoutTypes(layouts) {
  const types = new Map();
  let layout = '';
  for (const line of py.splitlines(layouts)) {
    const found = LAYOUT_RE.match(line);
    if (found) layout = found.group('name');
    const kind = LAYOUT_TYPE_RE.search(line);
    if (kind && layout && !types.has(layout)) types.set(layout, kind.group('type'));
  }
  return types;
}

function loginPagesOf(navigation) {
  const pages = new Set();
  for (const line of py.splitlines(navigation)) {
    const m = LOGIN_PAGE_RE.match(line);
    if (m) pages.add(m.group('page'));
  }
  return pages;
}

// LAYOUT01: every page of the app is framed by the same layout.
function oneLayoutFindings(lines, navigation, layouts) {
  const types = layoutTypes(layouts);
  const loginPages = loginPagesOf(navigation);
  const byLayout = new Map();
  for (const [page, block] of pageBlocks(lines)) {
    const found = PAGE_LAYOUT_RE.search(block.slice(0, 8).join('\n'));
    if (!found || loginPages.has(page)) continue;
    const layout = found.group('layout');
    if (OWN_KIND_LAYOUT_RE.search(layout) || OWN_KIND_LAYOUT_RE.search(types.has(layout) ? types.get(layout) : '')) continue;
    if (!byLayout.has(layout)) byLayout.set(layout, []);
    byLayout.get(layout).push(page);
  }
  if (byLayout.size < 2) return [];
  const ranked = py.sorted([...byLayout], ([layout, pages]) => [-pages.length, layout]);
  const main = ranked[0][0];
  const summary = ranked.map(([layout, pages]) =>
    `${layout} (${pages.length}: ${pages.slice(0, 4).join(', ')}${pages.length > 4 ? ', ...' : ''})`).join('; ');
  // One statement per module and layout: ALTER PAGES takes a single module.
  const moves = [];
  for (const [layout, pages] of ranked.slice(1)) {
    for (const module of new Set(pages.map(p => p.split('.')[0]))) {
      moves.push(`\`alter pages in ${module} set layout = ${main} where layout = ${layout};\``);
    }
  }
  return [{
    check: 'LAYOUT01',
    line: 0,
    message: `the app's pages use ${ranked.length} layouts, so the menu and whether it is open change from` +
      ` page to page: ${summary} -- pick ONE for every page that is not a pop-up, e.g. the most used,` +
      ` ${main}: ${moves.join(' ')} Then set the same \`Layout:\` in the scripts that create those pages,` +
      ' or re-running them moves the pages back',
  }];
}

// NAV04: a project layout that navigates with buttons instead of the navigation menu.
function layoutMenuFindings(layouts) {
  const targets = new Map();
  let layout = '';
  for (const line of py.splitlines(layouts)) {
    const found = LAYOUT_RE.match(line);
    if (found) { layout = found.group('name'); continue; }
    if (!layout) continue;
    for (const hit of SHOW_PAGE_RE.finditer(line)) {
      if (!targets.has(layout)) targets.set(layout, []);
      const pages = targets.get(layout);
      if (!pages.includes(hit.group('page'))) pages.push(hit.group('page'));
    }
  }
  const failures = [];
  for (const l of py.sorted([...targets.keys()])) {
    const pages = targets.get(l);
    if (pages.length < 2) continue;  // one link, a logo to the home page say, is not a menu
    failures.push({
      check: 'NAV04',
      line: 0,
      message: `layout ${l} is a hand-built menu (buttons to ${pages.slice(0, 4).join(', ')}) -- it has no` +
        ' hamburger, no active item and no phone view. Put those pages in the navigation' +
        ' menu (`create or replace navigation`), move the pages to Atlas_Core.Atlas_Default' +
        ` and drop the layout; ${ONE_MENU}`,
    });
  }
  return failures;
}

module.exports = { layoutTypes, oneLayoutFindings, layoutMenuFindings, LOGIN_PAGE_RE, loginPagesOf };
