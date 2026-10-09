// URL01 (a page that is not a pop-up has a URL, whenever Mendix allows one).
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
//
// A page with a URL can be bookmarked, shared, opened in a new tab and reloaded where the user
// was; without one every reload lands on the home page. The person asked for it (2026-10-08) for
// every page of the app's own modules that is not a pop-up, "if it is technically possible".
// Measured with mx check on Mendix 11.12 (InvoiceB2B copy): a URL takes a segment per parameter,
// `{Order/Id}` or `{Order/OrderNumber}` for an object, `{Qty}` for a primitive, several in one URL;
// a parameter left out is CE5601, and a non-persistent entity cannot be in a URL at all (CE5605).
// So a page with a non-persistent parameter is skipped, and so is one whose parameter entity is
// not known to be persistent (an entity of another module this check was not given).
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { PAGE_LAYOUT_RE, pageBlocks } = require('./pages.cjs');

const POPUP_OR_LOGIN_RE = re.compile('popup|login', 'i');
const URL_RE = re.compile(String.raw`\bUrl:\s*'(?P<url>[^']*)'`, 'i');
// `Params: ( $P: M.E )` since mxcli 0.25, `Params: { $P: M.E }` before.
const PARAMS_RE = re.compile(String.raw`\bParams:\s*[({](?P<params>[^)}]*)[)}]`, 'i');
const PARAM_RE = re.compile(String.raw`\$(?P<name>\w+)\s*:\s*(?P<type>[\w.]+)`);
const ENTITY_RE = re.compile(String.raw`^\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?:(?P<kind>persistent|non-persistent|view|external)\s+)?entity\s+(?P<name>[\w."]+)`, 'im');
// Entities of modules a page may take that this check is not given: the platform's own and the
// Administration module's account, all persistent.
const KNOWN_PERSISTENT = new Set(['Administration.Account', 'System.User', 'System.FileDocument', 'System.Image',
  'System.WorkflowUserTask', 'System.Workflow', 'System.UserRole', 'System.Language']);
const PRIMITIVES = new Set(['string', 'integer', 'long', 'decimal', 'boolean', 'datetime', 'date', 'enumeration']);

// {Module.Entity: true when persistent} from `describe entity` dumps.
function persistence(entityText) {
  const out = new Map();
  for (const m of ENTITY_RE.finditer(entityText || '')) {
    const kind = (m.group('kind') || 'persistent').toLowerCase();
    out.set(m.group('name').split('"').join(''), kind === 'persistent' || kind === 'view' || kind === 'external');
  }
  return out;
}

const kebab = name => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_+/g, '-').toLowerCase();

// The URL to suggest: the page's name, then a segment per parameter.
function suggestion(page, params) {
  const segments = params.map(([name, type]) => (PRIMITIVES.has(type.toLowerCase()) ? `{${name}}` : `{${name}/Id}`));
  return [kebab(page.split('.').pop())].concat(segments).join('/');
}

// [{check, line, message}] for each page that could have a URL and has none.
function urlFindings(lines, entityText) {
  const persistent = persistence(entityText);
  const found = [];
  const suggested = new Map();
  for (const [page, block] of pageBlocks(lines)) {
    const end = block.findIndex(line => py.rstrip(line).endsWith('{'));
    const header = block.slice(0, end < 0 ? block.length : end + 1).join(' ');
    const layout = PAGE_LAYOUT_RE.search(header);
    if (layout && POPUP_OR_LOGIN_RE.search(layout.group('layout'))) continue;
    const url = URL_RE.search(header);
    if (url && py.strip(url.group('url'))) continue;
    const paramsText = PARAMS_RE.search(header);
    const params = paramsText ? [...PARAM_RE.finditer(paramsText.group('params'))].map(m => [m.group('name'), m.group('type')]) : [];
    // A non-persistent parameter cannot be in a URL (CE5605); an entity of unknown kind is left alone.
    const possible = params.every(([, type]) => PRIMITIVES.has(type.toLowerCase()) || !type.includes('.')
      || persistent.get(type) === true || KNOWN_PERSISTENT.has(type));
    if (!possible) continue;
    let url_ = suggestion(page, params);
    if (suggested.has(url_)) url_ = kebab(page.split('.')[0]) + '/' + url_;
    suggested.set(url_, page);
    found.push({
      check: 'URL01',
      line: 1,
      document: page,
      message: `${page} has no URL: a reload lands on the home page, and the page cannot be bookmarked, shared or opened ` +
        `in a new tab. Give it one -- alter page ${page} { set Url = '${url_}' }; -- and put the same Url: in the ` +
        `script that creates it, so a re-run keeps it. Every parameter needs its segment (CE5601): {Param/Id} for an object, ` +
        '{Param} for a value',
    });
  }
  return found;
}

module.exports = { urlFindings, persistence, suggestion, kebab };
