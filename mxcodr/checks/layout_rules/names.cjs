// NAME01 (a widget name used in more than one page or snippet) and NAME02 (a widget name that does
// not read <Page>_<What><Type>).
//
// Part of check_layout.cjs (--names); see its header. Written for Node after the Python port.
//
// Mendix keeps a widget name unique on its page only, and Studio Pro names them textBox1,
// actionButton2. A test's `.mx-name-btnBack`, a failure message and a log line then point at a
// dozen pages: InvoiceB2B had `heading` on 18 pages, `ctPageTop` on 17, and `k1Value`..`k4Value`
// that say nothing of what they show. The scheme, readable with no legend:
//
//   OrderDetail_GenerateInvoiceButton   <page name, no module or underscore>_<business words><type word>
//   CurrentUserSnippet_AccountButton    a snippet: its name without SNIPPET_, plus "Snippet"
//
// The page part makes the name unique in the app (a module goes in front only when two modules
// have a page of the same name). The suggestion comes from the widget itself -- its attribute, its
// caption, its data source; where nothing says what it shows (a KPI tile), the finding asks for it.
'use strict';
const crypto = require('crypto');
const { withoutFolder } = require('../mxcli_client.cjs');

const TYPE_WORD = {
  actionbutton: 'Button', linkbutton: 'Link', textbox: 'Input', textarea: 'Input', combobox: 'Picker',
  referenceselector: 'Picker', datepicker: 'Date', checkbox: 'Choice', radiobuttons: 'Choice',
  dynamictext: 'Text', text: 'Text', datagrid: 'Grid', listview: 'List', gallery: 'List', dataview: 'Form',
  container: 'Box', groupbox: 'Box', customcontainer: 'Box', scrollcontainer: 'Box', layoutgrid: 'Layout',
  image: 'Image', staticimage: 'Image', dynamicimage: 'Image', snippetcall: 'Snippet',
  textfilter: 'Filter', numberfilter: 'Filter', datefilter: 'Filter', dropdownfilter: 'Filter',
  tabcontainer: 'Tabs', tabpage: 'Tab', navigationlist: 'Menu',
};
// Words an older name or a type already says: dropped from the business part.
const OLD_PREFIX = /^(btn|lnk|txt|ta|dt|cmb|dp|cb|rb|img|dg|dv|lv|gal|ct|lg|gb|tc|tp|sc|flt|nl|tb|lbl|cbx|ddl|chk|tabs?)(?=[A-Z0-9])/;
const TYPE_ECHO = { layoutgrid: /Grid$/, tabcontainer: /^Tabs?|Tabs?$/, snippetcall: /^Snippet|Snippet$/, datagrid: /Grid$/ };
// The name may be quoted, whole or in part ("Rooms"."SNIPPET_CurrentUser", Rooms."X"): read as
// `Rooms.`, the widget's page part came out empty and the suggestion wrong (room-booking n1, 2026-10-14).
const DOCUMENT = /^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(page|snippet)\s+(["\w.]+)/i;
const WIDGET = /^\s*([a-z]+)\s+([A-Za-z_]\w*)\s*([({].*)?$/;

// A code in place of a word: K1, A0 (one capital and a number), Kpi3, Box2 (a generic word and a
// number). InvoiceB2B renamed k1Value to AdminHome_K1ValueText: the pattern held, the name still
// said nothing. A number inside a real word stays (Top10CustomersGrid).
const CODE = /(?:^|[a-z0-9])[A-Z]\d|(?:^|[a-z])(?:Kpi|Box|Item|Row|Col|Tile|Card|Value|Label|Tab|Field)\d/;
const pascal = text => (String(text).match(/[A-Za-z0-9]+/g) || []).map(w => w[0].toUpperCase() + w.slice(1)).join('');
const plural = word => (/s$/.test(word) ? word : /[^aeiou]y$/.test(word) ? word.slice(0, -1) + 'ies' : word + 's');

// The page part of a widget name: Order_Detail -> OrderDetail, SNIPPET_CurrentUser -> CurrentUserSnippet.
function documentKey(kind, qualified) {
  const name = qualified.split('.').pop();
  if (kind === 'snippet') return pascal(name.replace(/^snippet_?/i, '')) + 'Snippet';
  return pascal(name);
}

// The business words of a widget, from what it binds, says or shows; '' when nothing does.
function businessWords(type, name, props) {
  const value = key => {
    const quoted = new RegExp(`\\b${key}\\s*:\\s*'([^']*)'`, 'i').exec(props);
    return quoted ? quoted[1] : '';
  };
  const attr = /\b(?:Attribute|Association)\s*:\s*"?([\w./]+)/i.exec(props);
  const last = path => path.split('/').pop().split('.').pop();
  if (['textbox', 'textarea', 'datepicker', 'combobox', 'referenceselector', 'checkbox', 'radiobuttons'].includes(type) && attr) {
    return pascal(last(attr[1]).replace(/_/g, ' '));
  }
  if (type.endsWith('filter') && attr) return pascal(last(attr[1]));
  if (type === 'actionbutton' || type === 'linkbutton') {
    if (value('Caption').trim()) return pascal(value('Caption'));
    if (/close\s*page/i.test(props)) return 'Back';
  }
  if (type === 'dynamictext' || type === 'text') {
    if (/RenderMode\s*:\s*H[1-3]\b/i.test(props) && !/ContentParams/i.test(props)) return 'Title';
    const words = (value('Content') || value('Caption')).replace(/\{\d+\}/g, ' ').match(/[A-Za-z]+/g) || [];
    if (words.length) return pascal(words.slice(0, 3).join(' '));
  }
  if (['datagrid', 'listview', 'gallery', 'dataview'].includes(type)) {
    const src = /DataSource\s*:\s*(?:database\s+(?:from\s+)?|microflow\s+|\$\w+\/)?([\w.]+)/i.exec(props);
    if (src) {
      const entity = pascal(last(src[1]).replace(/^(DS|SUB|ACT)_/, '').replace(/_/g, ' '));
      return type === 'dataview' ? entity : plural(entity);
    }
  }
  if (type === 'snippetcall') {
    const sn = /\bSnippet\s*:\s*([\w.]+)/i.exec(props);
    if (sn) return pascal(last(sn[1]).replace(/^snippet_?/i, ''));
  }
  if (/^[a-z]+[A-Z]?[a-z]*\d+$/.test(name)) return '';   // textBox1, container3: says nothing
  const bare = name.replace(OLD_PREFIX, '');
  return /\d$/.test(bare) ? '' : pascal(bare[0].toUpperCase() + bare.slice(1));
}

// <key>_<words><Type>, the type word not said twice.
function suggestion(key, type, words) {
  const word = TYPE_WORD[type];
  let what = words;
  // An old name that already starts with the page (Booking_NewEdit_FormLayout) keeps the page once.
  if (what.startsWith(key) && what.length > key.length) what = what.slice(key.length);
  if (TYPE_ECHO[type]) what = what.replace(TYPE_ECHO[type], '');
  if (what.endsWith(word)) what = what.slice(0, -word.length);
  return `${key}_${what}${word}`;
}

// [documents]: {kind, name, start, lines, widgets: [{type, name, line, props}]}.
function documentsOf(lines) {
  const docs = [];
  let doc = null;
  lines.forEach((line, i) => {
    const head = DOCUMENT.exec(line);
    if (head) { doc = { kind: head[1].toLowerCase(), name: head[2].replace(/"/g, ''), start: i + 1, lines: [], widgets: [] }; docs.push(doc); }
    if (!doc) return;
    doc.lines.push(line);
    const w = WIDGET.exec(line);
    if (!w || !TYPE_WORD[w[1].toLowerCase()]) return;
    let props = line;
    if (/\(\s*$/.test(line)) {
      for (let j = i + 1; j < lines.length && !/^\s*\)/.test(lines[j]); j++) props += ' ' + lines[j].trim();
    }
    doc.widgets.push({ type: w[1].toLowerCase(), name: w[2], line: i + 1, props });
  });
  return docs;
}

// {document: hash} of every page and snippet: a changed page is one whose text changed.
function documentHashes(lines) {
  const out = {};
  // Without its folder: a move (FOLDER01) is not a change to the page.
  for (const doc of documentsOf(lines)) {
    const text = withoutFolder(doc.lines.join('\n'));
    out[doc.name] = crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
  }
  return out;
}

// [findings]: {check, line, message, document}. NAME01 once per repeated name; NAME02 per widget.
function nameFindings(lines) {
  const docs = documentsOf(lines);
  const keys = new Map();
  for (const doc of docs) {
    const key = documentKey(doc.kind, doc.name);
    keys.set(key, (keys.get(key) || new Set()).add(doc.name.split('.')[0]));
  }
  const findings = [];
  const uses = new Map();
  for (const doc of docs) {
    let key = documentKey(doc.kind, doc.name);
    // Two modules with a page of the same name: the module goes in front.
    if (keys.get(key).size > 1) key = `${pascal(doc.name.split('.')[0])}_${key}`;
    const taken = new Set(doc.widgets.map(w => w.name));
    // What each widget would be called, so two never get the same suggestion.
    const proposed = new Map();
    for (const w of doc.widgets) {
      const words = businessWords(w.type, w.name, w.props);
      if (words) {
        const name = suggestion(key, w.type, words);
        proposed.set(name, (proposed.get(name) || 0) + 1);
      }
    }
    for (const w of doc.widgets) {
      if (!uses.has(w.name)) uses.set(w.name, []);
      uses.get(w.name).push([doc.name, w.line]);
      const word = TYPE_WORD[w.type];
      const rest = w.name.startsWith(`${key}_`) ? w.name.slice(key.length + 1) : null;
      const what = rest !== null && rest.endsWith(word) ? rest.slice(0, -word.length) : '';
      const fits = what !== '' && /^[A-Z][A-Za-z0-9]*$/.test(what) && !/\d$/.test(what) && !CODE.test(what);
      if (fits) continue;
      // Already <Page>_..._<Type> but with a code in it: the words are what is missing, not the form.
      const coded = what !== '' && /^[A-Z][A-Za-z0-9]*$/.test(what);
      let words = coded ? '' : businessWords(w.type, w.name, w.props);
      // A suggestion must itself pass: no leading digit, no code left over from the old name.
      if (!/^[A-Z]/.test(words) || CODE.test(words) || /\d$/.test(words)) words = '';
      let name = words ? suggestion(key, w.type, words) : '';
      if (name && ((name !== w.name && taken.has(name)) || proposed.get(name) > 1)) name = '';
      const tests = ` Rename it wherever a test names it too: \`.mx-name-${w.name}\` and the name passed to landed(), row_action(), fill(), menu().` +
        (['datagrid', 'listview', 'gallery'].includes(w.type) ? ` Its selection variable is renamed with it: a button that passes \`$${w.name}\` must pass the new name.` : '');
      findings.push({
        check: 'NAME02', line: w.line, document: doc.name,
        message: `${doc.name}: ${w.type} '${w.name}' ` + (coded ? 'has a code where the words for what it shows belong -- ' :
          'does not read <Page>_<What><Type>, so the name says nothing about where it is or what it does -- ') +
          (name ? `name it '${name}'.` : `name it '${key}_<what it shows>${word}', in business words for what it shows -- not a code like K1 or Kpi3 (e.g. '${key}_OverdueInvoices${word}').`) + tests,
      });
    }
  }
  for (const [name, where] of uses) {
    const docsUsing = [...new Set(where.map(([d]) => d))];
    if (docsUsing.length < 2) continue;
    findings.push({
      check: 'NAME01', line: where[0][1], document: docsUsing[0],
      message: `widget name '${name}' is used on ${docsUsing.length} pages and snippets (${docsUsing.slice(0, 4).join(', ')}${docsUsing.length > 4 ? ', ...' : ''}): ` +
        'a test, a failure or a log line that names it points at all of them. Each gets its own <Page>_<What><Type> name (NAME02 gives it).',
    });
  }
  return findings;
}

module.exports = { nameFindings, documentHashes, documentKey, businessWords, suggestion, TYPE_WORD };
