// GRID01 (a grid column filter with nothing to filter on) and ICON01 (a button without an
// icon, with one suggested from its action and caption).
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { strRepr } = require('./compat.cjs');
const { PAGE_RE, WIDGET_LINE_RE } = require('./pages.cjs');

const COLUMN_RE = re.compile(String.raw`^\s*column\s+(?P<name>\"[^\"]*\"|[\w/.]+)`, 'i');
const FILTER_RE = re.compile(String.raw`^\s*(?P<type>textfilter|numberfilter|datefilter|dropdownfilter)\s+(?P<name>\w+)(?P<rest>.*)$`, 'i');
// A filter's own target: `Attribute:`, `attributes: [...]` or `Association:`.
const FILTER_TARGET_RE = re.compile(String.raw`\b(attributes?|association)\s*:`, 'i');

const count = (s, sub) => s.split(sub).length - 1;

// GRID01: a filter only works on the column's attribute; with none, Data Grid 2 shows an error box.
function columnFilterFindings(lines) {
  const failures = [];
  let page = '';
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const found = PAGE_RE.match(line);
    if (found) page = found.group('name');
    const column = COLUMN_RE.match(line);
    if (!column) { index++; continue; }
    // The header runs to the line that opens the body (`{`) or closes without one.
    const header = [], start = index;
    while (index < lines.length) {
      header.push(lines[index]);
      const r = py.rstrip(lines[index]);
      if (r.endsWith('{') || r.endsWith(')')) break;
      index++;
    }
    const opensBody = py.rstrip(header[header.length - 1]).endsWith('{');
    index++;
    if (!opensBody) continue;
    const hasAttribute = Boolean(re.search(String.raw`\bAttribute\s*:`, header.join(' '), 'i'));
    // Scan the body for the column's own filters, then resume right after the header: a
    // layoutgrid column holds whole datagrids whose columns need checking too.
    const bodyStart = index;
    let depth = 1;
    while (index < lines.length && depth > 0) {
      const body = lines[index];
      const flt = FILTER_RE.match(body);
      if (flt && depth === 1 && !hasAttribute) {
        let own = flt.group('rest');
        // A filter's properties may continue on the lines below `name (`.
        let look = index + 1;
        if (py.rstrip(own).endsWith('(')) {
          while (look < lines.length && !py.strip(lines[look]).startsWith(')')) {
            own += ' ' + lines[look];
            look++;
          }
        }
        if (!FILTER_TARGET_RE.search(own)) {
          failures.push({
            check: 'GRID01',
            line: start + 1,
            message: `${page}: column ${column.group('name')} has a ${flt.group('type').toLowerCase()}` +
              ` ${flt.group('name')} but no Attribute -- the filter filters on the column's` +
              ` attribute, so it renders "Unable to get filter store" and filters nothing.` +
              ' Add the attribute it should filter to the column, e.g. `column colCreated' +
              " (Attribute: DateCreated, Caption: 'Created', ShowContentAs: dynamicText, ...)`;" +
              ' the column still shows its Content',
          });
        }
      }
      depth += count(body, '{') - count(body, '}');
      index++;
    }
    index = bodyStart;
  }
  return failures;
}

// ICON01 -------------------------------------------------------------------------------------
const BUTTON_TYPES = ['actionbutton', 'linkbutton'];
const DOCUMENT_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:page|snippet)\s+(?P<name>[\w.]+)`, 'i');
const CAPTION_RE = re.compile(String.raw`\bCaption:\s*'(?P<caption>[^']*)'`, 'i');
const ACTION_RE = re.compile(String.raw`\bAction:\s*(?P<action>[a-z_]+(?:\s+close_page)?)`, 'i');
const BUTTON_ICON_RE = re.compile(String.raw`\bIcon:`, 'i');
// What the button does -> an Atlas_Filled icon that shows it. The action decides first (a Back
// button is close_page whatever its caption), then words in the caption; first match wins.
const ACTION_ICONS = [
  ['delete', 'trash-can'],
  ['save_changes', 'floppy-disk'],
  ['cancel_changes', 'remove'],
  ['sign_out', 'logout'],
  ['close_page', 'chevron-left'],
];
const CAPTION_ICONS = [
  [['back'], 'chevron-left'],
  [['advance', 'next', 'move to', 'forward', 'proceed', 'start'], 'arrow-right'],
  [['discard'], 'trash-can'],
  [['reset', 'restore'], 'refresh'],
  [['new', 'add', 'create'], 'add'],
  [['edit', 'change', 'modify', 'update'], 'pencil'],
  [['delete', 'remove'], 'trash-can'],
  [['save'], 'floppy-disk'],
  [['cancel', 'close'], 'remove'],
  [['search', 'find'], 'search'],
  [['pdf'], 'file-pdf'],
  [['invoice', 'bill'], 'cash-payment-bill'],
  [['download', 'export'], 'download-bottom'],
  [['upload', 'import'], 'upload-bottom'],
  [['print'], 'print'],
  [['send', 'email', 'mail', 'remind', 'notify'], 'email'],
  [['refresh', 'reload', 'sync'], 'refresh'],
  [['copy', 'duplicate'], 'copy'],
  [['approve', 'confirm', 'accept', 'submit', 'complete', 'done'], 'checkmark'],
  [['reject', 'decline', 'deny'], 'thumbs-down'],
  [['filter'], 'filter'],
  [['pay'], 'credit-card'],
  [['ship', 'deliver'], 'shipment-box'],
  [['order', 'cart'], 'shopping-cart'],
  [['setting', 'setup', 'config'], 'cog'],
  [['view', 'open', 'detail', 'show'], 'view'],
  [['log out', 'logout', 'sign out'], 'logout'],
];

function buttonIcon(action, caption) {
  action = action.toLowerCase();
  caption = caption.toLowerCase();
  for (const [key, icon] of ACTION_ICONS) {
    if (action.includes(key) && !(key === 'close_page' && (action.includes('save') || action.includes('cancel')))) return icon;
  }
  for (const [words, icon] of CAPTION_ICONS) {
    if (words.some(word => re.search(String.raw`\b` + re.escape(word), caption))) return icon;
  }
  return '';
}

// ICON01: every button carries an icon that shows what it does.
function buttonIconFindings(lines) {
  const failures = [];
  let document = '';
  lines.forEach((line, index) => {
    const found = DOCUMENT_RE.match(line);
    if (found) { document = found.group('name'); return; }
    const widget = WIDGET_LINE_RE.match(line);
    if (!widget || !BUTTON_TYPES.includes(widget.group('type').toLowerCase())) return;
    let props = line;
    if (py.rstrip(line).endsWith('(')) {
      let look = index + 1;
      while (look < lines.length && !py.strip(lines[look]).startsWith(')')) {
        props += ' ' + py.strip(lines[look]);
        look++;
      }
    }
    if (BUTTON_ICON_RE.search(props)) return;
    const caption = CAPTION_RE.search(props);
    const action = ACTION_RE.search(props);
    const icon = buttonIcon(action ? action.group('action') : '', caption ? caption.group('caption') : '');
    const fix = icon ? 'an icon that shows what it does, e.g. ' + `\`Icon: 'Atlas_Core.Atlas_Filled.${icon}'\``
      : 'an icon that shows what it does, from `DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled`';
    failures.push({
      check: 'ICON01',
      line: index + 1,
      message: `${document}: ${widget.group('type').toLowerCase()} ${widget.group('name')}` +
        `${caption ? ' (' + strRepr(caption.group('caption')) + ')' : ''} has no icon -- add ${fix}` +
        ' to its properties; every button shows what it does with an icon',
    });
  });
  return failures;
}

module.exports = { columnFilterFindings, buttonIcon, buttonIconFindings, DOCUMENT_RE };
