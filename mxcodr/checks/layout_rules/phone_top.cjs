// PHONE06: on a phone or tablet the top of a page is one row: Back (when the page has one), the
// title, and who is signed in. Measured on OfflineLab 2026-10-11 (390 x 844): a row holding only
// the signed-in user's name put My jobs' title at 101 px, and a row of Back and that name pushed
// Job's tabs to 117 px and its title, inside the first tab, to 175 px -- an eighth of the screen
// above anything the technician works with. USER01 leaves a phone or tablet page to this rule.
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const { layoutKinds } = require('./phone.cjs');
const { isBackButton, CURRENT_USER_SNIPPET } = require('./page_top.cjs');
const { documentKey } = require('./names.cjs');
const { PAGE_LAYOUT_RE, WIDGET_LINE_RE, BACK_WRAPPERS, pageBlocks, indentOf } = require('./pages.cjs');

const HEADING = /RenderMode:\s*'?(H1|H2|H3)\b/i;
const MARGIN_BOTTOM = /'margin-bottom'\s*:\s*'(S|M|L)'/i;
const BACK_ICON = 'Atlas_Core.Atlas_Filled.chevron-left';

// The full property text of the widget on line <at>: a header can run over several lines.
function propsAt(block, at) {
  let text = block[at];
  for (let i = at + 1; i < block.length && !/[{]\s*$/.test(text) && !/\)\s*;?\s*$/.test(text); i++) text += ' ' + block[i].trim();
  return text;
}

// [{type, name, props, indent, at}] of the widgets on the page that are not layout wrappers.
function widgetsOf(block) {
  const start = block.findIndex(line => /\{\s*$/.test(line)) + 1;
  const out = [];
  for (let at = start; at > 0 && at < block.length; at++) {
    const line = block[at];
    if (line.trim().startsWith('--')) continue;
    const m = WIDGET_LINE_RE.match(line);
    if (!m) continue;
    const type = m.group('type').toLowerCase();
    if (BACK_WRAPPERS.has(type)) continue;
    out.push({ type, name: m.group('name'), props: propsAt(block, at), indent: indentOf(line), at });
  }
  return out;
}

// The data view of a page parameter the widget on line <at> sits in: {name, param}, or null.
function ownerView(block, at) {
  let indent = indentOf(block[at]);
  for (let i = at - 1; i >= 0; i--) {
    if (!block[i].trim() || /^\s*[)\]]/.test(block[i]) || indentOf(block[i]) >= indent) continue;
    indent = indentOf(block[i]);
    const v = /^\s*dataview\s+(\w+)/i.exec(block[i]);
    if (v) {
      const p = /DataSource:\s*\$(\w+)/i.exec(propsAt(block, i));
      return p ? { name: v[1], param: p[1] } : null;
    }
  }
  return null;
}

const isHeading = w => (w.type === 'dynamictext' || w.type === 'text') && HEADING.test(w.props);
const isUser = w => w.type === 'snippetcall' && w.props.includes(CURRENT_USER_SNIPPET);

// The outermost container around the widget on line <at>, below the column, data view or tab it
// sits in: {at, end, head}; null when the widget sits right in one of those.
function topRow(block, at) {
  let indent = indentOf(block[at]), row = null;
  for (let i = at - 1; i >= 0; i--) {
    if (!block[i].trim() || /^\s*[)\]]/.test(block[i]) || indentOf(block[i]) >= indent) continue;
    indent = indentOf(block[i]);
    if (!/^\s*container\s/i.test(block[i])) break;
    row = { at: i, head: propsAt(block, i) };
  }
  if (!row) return null;
  const own = indentOf(block[row.at]);
  const open = block.findIndex((line, i) => i >= row.at && /\{\s*$/.test(line));
  row.end = block.findIndex((line, i) => i > open && line.trim().startsWith('}') && indentOf(line) <= own);
  if (row.end < 0) row.end = block.length;
  return row;
}

const ROW = /'Flex container'\s*:\s*'Horizontal \(row\)'/;
const SPREAD = /'Align items X'\s*:\s*'(Space between|Right)/;
const NOWRAP = /'Disable row wrap'\s*:\s*ON\b/i;

// snippets: the project's snippet describes, for the name of the "who is signed in" one.
function phoneTopFindings(pageLines, layoutText, snippets = '') {
  const kinds = layoutKinds(layoutText);
  const defined = [...String(snippets).matchAll(/^\s*create\s+(?:or\s+(?:replace|modify)\s+)?snippet\s+([\w.]+)/gim)]
    .map(m => m[1]).filter(n => n.split('.').pop().startsWith(CURRENT_USER_SNIPPET));
  const out = [];
  const usedOnSmall = new Set();
  for (const [page, block] of pageBlocks(pageLines)) {
    const layout = PAGE_LAYOUT_RE.search(block.slice(0, 8).join('\n'));
    const name = layout ? layout.group('layout') : '';
    const kind = kinds.get(name) || '';
    if (!/^(phone|tablet)$/i.test(kind) || /login/i.test(name)) continue;
    const widgets = widgetsOf(block);
    if (!widgets.length) continue;
    const back = isBackButton(widgets[0].type, widgets[0].props) ? widgets[0] : null;
    const h = widgets.findIndex(isHeading);
    const heading = h >= 0 ? widgets[h] : null;
    const user = widgets.find(isUser);
    for (const w of widgets.filter(isUser)) usedOnSmall.add((/Snippet:\s*([\w.]+)/.exec(w.props) || [])[1]);
    // Fine: the first row holds [Back,] the title and the user, nothing else before the title,
    // the row lays them out side by side, and Back adds no margin under itself.
    const row = topRow(block, widgets[0].at);
    const inRow = w => w && row && w.at > row.at && w.at < row.end;
    const before = h >= 0 && widgets.slice(0, h).every(w => w === back || w === user);
    const ok = heading && before && row && ROW.test(row.head) && SPREAD.test(row.head) && NOWRAP.test(row.head) && inRow(heading) && inRow(user) &&
      !(back && MARGIN_BOTTOM.test(back.props));
    if (ok) continue;

    const key = documentKey('page', page);
    const lower = kind.toLowerCase();
    const title = (/\bTitle:\s*'([^']*)'/.exec(block.slice(0, 8).join(' ')) || [])[1] || page.split('.').pop();
    const snippet = user ? (/Snippet:\s*([\w.]+)/.exec(user.props) || [])[1] : (defined.find(n => /Offline$/.test(n)) || defined[0] ||
      `${page.split('.')[0]}.${CURRENT_USER_SNIPPET}`);
    const view = heading && ownerView(block, heading.at);
    const tabbed = heading && /^\s*tabpage\b/im.test(block.slice(0, heading.at).join('\n'));
    const headingText = heading ? `<${heading.name}${tabbed ? ', moved out of its tab: the title goes above the tabs' : ', moved here'}>`
      : `dynamictext ${key}_HeadingText (Content: '${title}', RenderMode: H1)`;
    const userText = user ? `<${user.name}, moved here>` : `snippetcall ${key}_CurrentUserSnippet (Snippet: ${snippet})`;
    // The row's own gap spaces Back from the title: a margin under or beside it only makes the row taller or wider.
    const backText = back ? `actionbutton ${back.name} (Caption: 'Back', Action: close page, Icon: '${BACK_ICON}') ` : '';
    // The title in a box of its own, so nothing sits 'under' the heading (SPACE01 reads a row's widgets as stacked).
    const left = `container ${key}_TitleBox (DesignProperties: ('Flex container': 'Horizontal (row)', 'Align items Y':` +
      ` 'Center', 'Disable row wrap': ON)) { ${backText}${headingText} }`;
    let top = `container ${key}_PageTopBox (DesignProperties: ('Flex container': 'Horizontal (row)', 'Align items X': 'Space` +
      ` between (only for horizontal containers)', 'Align items Y': 'Center', 'Disable row wrap': ON, 'Spacing': ('margin-bottom': 'M'))) { ${left} ${userText} }`;
    // A title that shows the object (Job JOB-1001) reads it through a data view: the row gets one of its own.
    if (view) top = `dataview ${key}_TitleForm (DataSource: $${view.param}) { ${top} } -- a data view of its own, since the title reads` +
      ` $${view.param} (it leaves ${view.name})`;
    const parts = [back && 'Back', 'its title', 'who is signed in'].filter(Boolean);
    const why = !heading ? 'has no title' : !user ? 'does not show who is signed in' : `does not open with ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')} in one row`;
    out.push({ check: 'PHONE06', line: 0, message: `${page} (a ${lower} page) ${why}: on a ${lower} every row above the page's own` +
      ' work is screen the user does not get back.' +
      ` Put ${back ? 'Back, ' : ''}the title and who is signed in in one row, as the page's first widget: ${top}.` +
      ' Without \'Disable row wrap\' Atlas wraps the row and the name drops onto a line of its own (measured: Back, an H1' +
      ' "Job JOB-1001" and the name need 375 px of a phone\'s 358); with it a long title wraps inside its own box.' +
      ' A test that reads the title still finds it by its name' });
  }
  // The name as a list view card (16 px padding, a white tile) makes the row 69 px tall for one line of text.
  for (const snip of defined) {
    const text = String(snippets).split(/^(?=\s*create\s+(?:or\s+(?:replace|modify)\s+)?snippet\s)/im)
      .find(part => new RegExp(`snippet\\s+${snip.replace('.', '\\.')}\\b`, 'i').test(part)) || '';
    const list = /^\s*listview\s+(\w+)/im.exec(text);
    if (!list || /'Style'\s*:\s*'No styling'/i.test(text) || !usedOnSmall.has(snip)) continue;
    out.push({ check: 'PHONE06', line: 0, message: `${snip} shows the name as a list view card (16 px padding, a white tile)` +
      ` on a phone or tablet page, so the title's row is 69 px tall for one line of text: give ${list[1]}` +
      ` DesignProperties: ('Style': 'No styling') -- the name then reads as text beside the title` });
  }
  return out;
}

module.exports = { phoneTopFindings };
