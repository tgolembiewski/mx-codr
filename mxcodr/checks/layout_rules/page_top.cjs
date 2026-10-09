// The top row of a page: BACK01 (a page you navigate to opens with a Back button) and USER01
// (who is signed in, on the right of that row).
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { HOME_RE } = require('./accounts.cjs');
const { loginPagesOf, layoutTypes } = require('./layouts.cjs');
const { MENU_PAGE_RE } = require('./navigation.cjs');
const { PAGE_LAYOUT_RE, SHOW_PAGE_ANY_RE, WIDGET_LINE_RE, firstWidget, leadingWidgets, pageBlocks, indentOf } = require('./pages.cjs');

// USER01 -------------------------------------------------------------------------------------
const SNIPPET_DEF_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?snippet\s+(?P<name>[\w.]+)`, 'i');

const BACK_ICON = 'Atlas_Core.Atlas_Filled.chevron-left';
const BACK_BUTTON = `actionbutton btnBack (Caption: 'Back', Action: CLOSE_PAGE, Icon: '${BACK_ICON}',` +
  " DesignProperties: ['Spacing': ['margin-bottom': 'M']])";

// The "who is signed in" snippet, on the right of every page's top row (USER01).
const CURRENT_USER_SNIPPET = 'SNIPPET_CurrentUser';
const ROW_RIGHT_PROPS = "['Flex container': 'Horizontal (row)', 'Align items X': 'Right']";

// The container around the current-user snippet lays out as a row that puts it at the right edge.
function rowPushesRight(block) {
  const lines = block;
  const at = lines.findIndex(line => line.includes('snippetcall') && line.includes(CURRENT_USER_SNIPPET));
  if (at < 0) return false;
  const indent = indentOf(lines[at]);
  for (let i = at - 1; i >= 0; i--) {
    const line = lines[i];
    const own = indentOf(line);
    if (own < indent && re.match(String.raw`^\s*container\s`, line)) {
      let head = line;
      let j = i + 1;
      while (!py.rstrip(head).endsWith('{') && j < at) {
        head += ' ' + py.strip(lines[j]);
        j++;
      }
      return head.includes('Flex container') && re.search(String.raw`Align items X'\s*:\s*'(Right|Space between)`, head) !== null;
    }
    if (own < indent && WIDGET_LINE_RE.match(line)) return false;  // directly in a column or data view: nothing aligns it
  }
  return false;
}

function isBackButton(wtype, props) {
  return (wtype === 'actionbutton' || wtype === 'linkbutton') && re.search('close_page', props, 'i') !== null &&
    props.includes('chevron-left');
}

// USER01: every page shows who is signed in, in the same place -- its first widget, top right.
function currentUserFindings(lines, snippets, navigation, layouts) {
  const defined = [];
  for (const line of py.splitlines(snippets)) {
    const m = SNIPPET_DEF_RE.match(line);
    if (m && m.group('name').endsWith('.' + CURRENT_USER_SNIPPET)) defined.push(m.group('name'));
  }
  const types = layoutTypes(layouts);
  const loginPages = loginPagesOf(navigation);
  const missing = [], unaligned = [], failures = [];
  const isUser = w => w[0] === 'snippetcall' && w[1].includes(CURRENT_USER_SNIPPET);
  for (const [page, block] of pageBlocks(lines)) {
    const layout = PAGE_LAYOUT_RE.search(block.slice(0, 8).join('\n'));
    const name = layout ? layout.group('layout') : '';
    if (loginPages.has(page) || re.search('popup|login', name + ' ' + (types.has(name) ? types.get(name) : ''), 'i')) continue;
    const lead = leadingWidgets(block);
    // First on the page, or right after the Back button in the same row.
    if (lead.length && (isUser(lead[0]) || (lead.length === 2 && isBackButton(lead[0][0], lead[0][1]) &&
        isUser(lead[1]) && lead[0][2] === lead[1][2]))) {
      if (!rowPushesRight(block)) unaligned.push(page);
      continue;
    }
    missing.push(page);
  }
  if (unaligned.length) {
    failures.push({ check: 'USER01', line: 0, message:
      `${unaligned.length} page(s) show the signed-in user on the left: ${unaligned.slice(0, 6).join(', ')} -- the` +
      ` row around it needs ${ROW_RIGHT_PROPS}, or 'Space between (only for horizontal containers)'` +
      ' instead of \'Right\' when the Back button is in it' });
  }
  if (!missing.length) return failures;
  const module = missing[0].split('.')[0];
  const snippet = defined.length ? defined[0] : `${module}.${CURRENT_USER_SNIPPET}`;
  const shown = missing.slice(0, 6).join(', ') + (missing.length > 6 ? ` and ${missing.length - 6} more` : '');
  const missingSnippet = defined.length ? '' : ` (${snippet} does not exist yet: the skill has it)`;
  return [...failures, { check: 'USER01', line: 0, message:
    `${missing.length} page(s) lack the signed-in user top right: ${shown} -- start each with \`container` +
    ` ctPageTop (DesignProperties: ${ROW_RIGHT_PROPS}) { snippetcall scCurrentUser (Snippet: ${snippet}) }\`;` +
    ' on a page with Back, Back goes first in that row and \'Right\' becomes \'Space between (only for' +
    ` horizontal containers)'${missingSnippet}. Skill spacing-and-layout, 'Who is signed in'` }];
}

const FLOW_HEAD_RE = String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:microflow|nanoflow)\s+(?P<name>[\w.]+)`;

// BACK01: every page reached from another page or a flow starts with a way back. A menu item
// or home page is a top-level page even when a flow shows it again (back to My Orders after
// placing an order): a Back there leads nowhere, and a session deleted the flow's `show page`
// to quiet the rule.
function backButtonFindings(lines, openedFrom, navigation = '') {
  const blocks = pageBlocks(lines);
  const topLevel = new Set();
  for (const line of py.splitlines(navigation)) {
    for (const found of [MENU_PAGE_RE.match(line), HOME_RE.match(line)]) if (found) topLevel.add(found.group('page').toLowerCase());
  }
  const openers = new Map();
  const add = (page, source) => {
    if (!openers.has(page)) openers.set(page, []);
    openers.get(page).push(source);
  };
  for (const [page, block] of blocks) {
    for (const hit of SHOW_PAGE_ANY_RE.finditer(block.slice(1).join('\n'))) {
      if (hit.group('page') !== page) add(hit.group('page'), page);
    }
  }
  let flow = '';
  for (const line of py.splitlines(openedFrom)) {
    const head = re.match(FLOW_HEAD_RE, line, 'i');
    if (head) flow = head.group('name');
    for (const hit of SHOW_PAGE_ANY_RE.finditer(line)) add(hit.group('page'), flow || 'a flow');
  }
  const failures = [];
  for (const page of py.sorted([...openers.keys()])) {
    const sources = openers.get(page);
    const block = blocks.get(page);
    if (!block || !block.length) continue;  // not one of this project's pages
    if (topLevel.has(page.toLowerCase())) continue;  // reached from the menu: the menu is the way back
    const layout = PAGE_LAYOUT_RE.search(block.slice(0, 8).join('\n'));
    if (layout && layout.group('layout').toLowerCase().includes('popup')) continue;  // a pop-up closes with its own X
    const [wtype, props] = firstWidget(block);
    if (isBackButton(wtype, props)) continue;
    const hasClose = re.search('close_page', block.join('\n'), 'i') !== null;
    const where = [...new Set(sources)].join(', ');
    let problem;
    if (!hasClose) problem = 'has no Back button';
    else if ((wtype !== 'actionbutton' && wtype !== 'linkbutton') || !re.search('close_page', props, 'i')) {
      problem = 'has a close button, but not as its first widget';
    } else problem = 'starts with a Back button without the chevron-left icon';
    failures.push({
      check: 'BACK01',
      line: 0,
      message: `${page} (opened from ${where}) ${problem} -- its first widget must be \`${BACK_BUTTON}\`` +
        " (skill spacing-and-layout, 'Back, top left')",
    });
  }
  return failures;
}

module.exports = { currentUserFindings, backButtonFindings, isBackButton, CURRENT_USER_SNIPPET };
