#!/usr/bin/env node
// Check that page widgets are spaced with Atlas Spacing design properties.
//
// Input: `describe page` dumps (.mdl files or directories), normally from tests/gate.sh;
// optionally `DESCRIBE NAVIGATION` output (--navigation), snippet dumps (--sign-out-sources),
// `describe layout` dumps of the project's own layouts (--layouts) and microflow/nanoflow dumps
// whose `show page` also opens pages (--opened-from), and `describe entity` dumps of the project's
// own entities (--entities), for the length of the text a textbox edits.
// Usage: check_layout.cjs <file.mdl|dir> ... [--navigation nav.mdl] [--sign-out-sources dir]
//                         [--layouts dir] [--opened-from dir] [--entities dir] [--users-sign-in] [--json]
// --json keys: verdict, pages, sources, failures, warnings.
// Exit: 0 no errors (warnings allowed), 1 errors or no MDL found, 2 bad arguments.
//
// The Node port of check_layout.py (2026-10-05): the same output, byte for byte, on the same input.
//
// Rule codes:
//   SPACE01  FAIL  inline sibling (not last) without margin-right, or H1-H3 heading with a sibling below and no margin-bottom
//   SPACE02  FAIL  margin/padding value other than None, S, M, L (mxcli check accepts it; mx check fails with CE6083)
//   SPACE03  FAIL  inline widgets on one line with different top/bottom margins, or none with margin-bottom
//   NAME01   WARN  (--names) a widget name used on more than one page or snippet
//   NAME02   WARN  (--names) a widget name that does not read <Page>_<What><Type>; FAIL with
//                  --names error, and for a page new or changed since --names-baseline
//   SPACE04  FAIL  a button or text right on top of, or right under, a box (data grid, list, gallery,
//                  group box, tab container, a card or a coloured container) with no margin between
//                  them; a button in a grid's controlbar without margin-bottom
//   HEAD01   WARN  page with no H1-H3 text, no header widget and no header/title/masthead snippet
//   NAV01    FAIL  users sign in (--users-sign-in), but a navigation menu has no sign_out item
//                  and no page or snippet has a sign-out button
//   NAV02    WARN  the sign_out item is not the last item of its menu
//   NAV03    FAIL  users sign in, and a role's home page (`home page X for Role`) is not in that
//                  profile's menu
//   GRID01   FAIL  a grid filter in a column with no Attribute (and none of its own): it renders
//                  "Unable to get filter store" and filters nothing
//   GRID02   FAIL  a button outside a data grid changes the rows it shows (creates its entity, acts
//                  on its selection, or calls a flow that writes its entity): it goes in the grid's
//                  header, `controlbar` inside the datagrid
//   LAYOUT01 FAIL  the app's pages (pop-ups, login and phone/tablet pages aside) use more than one
//                  layout: the menu and its open/closed state change from page to page
//   ICON01   FAIL  a button (actionbutton, linkbutton) without an icon; the message suggests one
//                  from its action and caption
//   USER01   FAIL  users sign in, and a page (pop-ups and the login page aside) does not open with
//                  the "who is signed in" snippet, <Module>.SNIPPET_CurrentUser, on the right of its top
//                  row -- first, or right after the Back button in the same container
//   BACK01   FAIL  a page another page or a flow opens (show_page) does not start with a Back
//                  button: close_page, icon chevron-left, top left. Pop-ups are exempt (they have X)
//   ACCOUNT01 FAIL users sign in, the Administration module is there, and the menu has no item for
//                  Administration.Account_Overview (user management; only administrators see it)
//   ACCOUNT02 FAIL ... and no item for microflow Administration.ManageMyAccount (every user's own
//                  account and password; it opens Administration.MyAccount, which needs an account)
//   ACCOUNT03 FAIL a user role that signs in lacks Administration.User, or no role has
//                  Administration.Administrator
//   MODULE01 FAIL  the app has its own module with pages, and the template's MyFirstModule is still
//                  there; lists everything that still uses it and how to remove it
//   HOME01   FAIL  the administrators' role does not open on a page of the app's own modules
//   NAV05    FAIL  a menu item or sub-menu with no icon (the message suggests one for its caption)
//   NAV06    FAIL  two menu entries one user role sees (Mendix hides those whose page or microflow
//                  the role may not open) show the same icon; with security off, any two entries
//   NAV04    FAIL  one of the project's own layouts opens two or more pages from buttons: a menu
//                  built by hand, with no hamburger, no active item and no phone view
//   URL01    FAIL  a page of the app's own modules that is not a pop-up or login page has no URL,
//                  though Mendix allows one (no non-persistent parameter); suggests one with a
//                  segment per parameter
//   ALERT01  WARN  a block class (alert, alert-*, card, well) on a dynamictext or text: it renders
//                  as an inline <span>, so its padding and border overlap the widgets around it
//   EDGE01   FAIL  a page on an Atlas_Core layout (pop-ups and the login page aside) has a widget at
//                  its top level outside a layoutgrid: it touches the edge of the window
//   TEXT01   FAIL  (--entities) a textbox edits a String longer than 500 characters or unlimited:
//                  a one-line box for a long text; the message gives the textarea that replaces it
//   TEXT02   WARN  (--entities) a textbox edits an attribute named like prose (Description, Notes,
//                  Comment, Reason ...) of 100 characters or more, or of unknown length
//
// Where each rule lives, in layout_rules/ next to this file (this file only reads the arguments
// and runs them): mdl1.cjs rewrites an mxcli v0.25 (`mdl 1`) describe into the v0.24 spelling the
// rules read; pages.cjs parses the dumps; spacing.cjs SPACE01-03, HEAD01, ALERT01; controls.cjs
// GRID01, ICON01; grids.cjs GRID02; page_top.cjs BACK01, USER01; layouts.cjs LAYOUT01, NAV04;
// navigation.cjs NAV01-03, NAV05-06; accounts.cjs ACCOUNT01-03, MODULE01, HOME01; edges.cjs EDGE01;
// inputs.cjs TEXT01-02; vertical.cjs SPACE04; names.cjs NAME01-02. --port-parity runs only the rules check_layout.py
// had (SPACE04 is newer), for the test that compares the two.
'use strict';
const fs = require('fs');
const path = require('path');
const py = require('./py_compat.cjs');
const { strRepr, readTextReplace } = require('./layout_rules/compat.cjs');
const { USER_ROLE_RE, userRoles, accountFindings, adminHomeFindings, templateModuleFindings } = require('./layout_rules/accounts.cjs');
const { buttonIconFindings } = require('./layout_rules/controls.cjs');
const { edgeFindings } = require('./layout_rules/edges.cjs');
const { headerButtonFindings } = require('./layout_rules/grids.cjs');
const { textInputFindings, stringLengths } = require('./layout_rules/inputs.cjs');
const { verticalFindings } = require('./layout_rules/vertical.cjs');
const { nameFindings, documentHashes } = require('./layout_rules/names.cjs');
const { urlFindings } = require('./layout_rules/urls.cjs');
const { levelArgs } = require('./rulebook.cjs');
const { layoutMenuFindings, oneLayoutFindings } = require('./layout_rules/layouts.cjs');
const { PROFILE_RE, duplicateIconFindings, menuIconFindings, readMenuAccess, roleHomeFindings, signOutFindings } = require('./layout_rules/navigation.cjs');
const { backButtonFindings, currentUserFindings } = require('./layout_rules/page_top.cjs');
const { pageBlocks } = require('./layout_rules/pages.cjs');
const { check } = require('./layout_rules/spacing.cjs');
const { toMdl0 } = require('./layout_rules/mdl1.cjs');

// ---- pathlib, as far as this file uses it ----

// The parts of Path(text): '' and '.' parts dropped, a leading '/' (or exactly '//') kept.
function pathParts(text) {
  if (py.WIN) {
    const t = text.replace(/\//g, '\\');
    const drive = /^[A-Za-z]:/.test(t) ? t.slice(0, 2) : '';
    const rest = t.slice(drive.length);
    const root = rest.startsWith('\\') ? '\\' : '';
    const parts = rest.split('\\').filter(p => p && p !== '.');
    return (drive || root ? [drive + root] : []).concat(parts);
  }
  let root = '';
  if (text.startsWith('//') && !text.startsWith('///')) root = '//';
  else if (text.startsWith('/')) root = '/';
  const parts = text.split('/').filter(p => p && p !== '.');
  return (root ? [root] : []).concat(parts);
}
// str(Path(...)) from its parts.
function pathStr(parts) {
  if (!parts.length) return '.';
  const sep = py.WIN ? '\\' : '/';
  const [first, ...rest] = parts;
  if (first === '/' || first === '//' || (py.WIN && /[\\:]$/.test(first))) return first + rest.join(sep);
  return parts.join(sep);
}
const fsPath = parts => (parts.length ? pathStr(parts) : '.');
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = p => { try { fs.statSync(p); return true; } catch { return false; } };

const MDL = py.WIN ? /^.*\.mdl$/is : /^.*\.mdl$/s;
// sorted(source.rglob("*.mdl")): every entry named *.mdl at any depth; symlinked directories are
// not entered (Python 3.11); sorted by parts, case-folded on Windows.
function rglob(parts) {
  const found = [];
  const walk = (dirParts) => {
    let entries;
    try {
      entries = fs.readdirSync(fsPath(dirParts), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = dirParts.concat([e.name]);
      if (MDL.test(e.name)) found.push(child);
      let isDirectory = false;
      try { isDirectory = fs.statSync(fsPath(child)).isDirectory(); } catch { /* broken link */ }
      if (isDirectory && !e.isSymbolicLink()) walk(child);
    }
  };
  walk(parts);
  const unique = [...new Map(found.map(p => [JSON.stringify(p), p])).values()];
  return py.sorted(unique, p => (py.WIN ? p.map(s => s.toLowerCase()) : p));
}

// [joined text of every .mdl under sources, the files read (as parts)].
function collect(sources) {
  const chunks = [], used = [];
  for (const source of sources) {
    const where = fsPath(source);
    const files = isDir(where) ? rglob(source) : (exists(where) ? [source] : []);
    for (const file of files) {
      chunks.push(readTextReplace(fsPath(file)));
      used.push(file);
    }
  }
  return [chunks.join('\n'), used];
}

// Text of an optional input file; empty when it was not given or does not exist.
function readOptional(parts) {
  return parts && exists(fsPath(parts)) ? readTextReplace(fsPath(parts)) : '';
}

// ---- argparse, as this file configures it ----
const PROG = 'check_layout.py';
const USAGE = `usage: ${PROG} [-h] [--navigation NAVIGATION] [--sign-out-sources SIGN_OUT_SOURCES] [--layouts LAYOUTS]
                       [--admin-module] [--user-roles USER_ROLES] [--menu-access MENU_ACCESS]
                       [--guest-role GUEST_ROLE] [--own-modules OWN_MODULES] [--template-module]
                       [--opened-from OPENED_FROM] [--entities ENTITIES] [--users-sign-in]
                       [--expect-pages EXPECT_PAGES] [--names {warn,error}]
                       [--page-hashes PAGE_HASHES] [--names-baseline NAMES_BASELINE] [--port-parity] [--json]
                       sources [sources ...]
`;
const OPTIONS = {
  '--navigation': { dest: 'navigation', kind: 'path' },
  '--sign-out-sources': { dest: 'sign_out_sources', kind: 'append' },
  '--layouts': { dest: 'layouts', kind: 'append' },
  '--admin-module': { dest: 'admin_module', kind: 'flag' },
  '--user-roles': { dest: 'user_roles', kind: 'path' },
  '--menu-access': { dest: 'menu_access', kind: 'path' },
  '--guest-role': { dest: 'guest_role', kind: 'str' },
  '--own-modules': { dest: 'own_modules', kind: 'str' },
  '--template-module': { dest: 'template_module', kind: 'flag' },
  '--opened-from': { dest: 'opened_from', kind: 'append' },
  '--entities': { dest: 'entities', kind: 'append' },
  '--users-sign-in': { dest: 'users_sign_in', kind: 'flag' },
  '--expect-pages': { dest: 'expect_pages', kind: 'int' },
  '--port-parity': { dest: 'port_parity', kind: 'flag' },
  '--names': { dest: 'names', kind: 'str' },
  '--page-hashes': { dest: 'page_hashes', kind: 'path' },
  '--names-baseline': { dest: 'names_baseline', kind: 'path' },
  '--json': { dest: 'json', kind: 'flag' },
  '--help': { dest: 'help', kind: 'help' },
  '-h': { dest: 'help', kind: 'help' },
};
function fail(message) {
  process.stderr.write(`${USAGE}${PROG}: error: ${message}\n`);
  process.exit(2);
}
const NEGATIVE = /^-\d+$|^-\d*\.\d+$/;
// The option an argument names (exact, `--x=value`, or an unambiguous prefix), or null for a positional.
function optionOf(arg) {
  if (!arg || arg[0] !== '-' || arg === '-') return null;
  if (OPTIONS[arg]) return [arg, null];
  if (arg.includes('=')) {
    const [name, ...value] = arg.split('=');
    if (OPTIONS[name]) return [name, value.join('=')];
  }
  if (arg.startsWith('--')) {
    const name = arg.split('=')[0];
    const hits = Object.keys(OPTIONS).filter(o => o.startsWith('--') && o.startsWith(name));
    if (hits.length > 1) fail(`ambiguous option: ${name} could match ${hits.join(', ')}`);
    if (hits.length === 1) return [hits[0], arg.includes('=') ? arg.slice(name.length + 1) : null];
  }
  if (NEGATIVE.test(arg)) return null;
  if (arg.includes(' ')) return null;
  return ['?' + arg, null];
}
function parseArgs(argv) {
  const args = {
    sources: [], navigation: null, sign_out_sources: [], layouts: [], admin_module: false, user_roles: null,
    menu_access: null, guest_role: '', own_modules: '', template_module: false, opened_from: [], entities: [],
    users_sign_in: false, expect_pages: 0, port_parity: false, names: '', page_hashes: null, names_baseline: null, json: false,
  };
  const unknown = [];
  let positionalRuns = 0, inRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      for (const rest of argv.slice(i + 1)) { if (positionalRuns && !inRun) unknown.push(rest); else args.sources.push(rest); }
      break;
    }
    const opt = optionOf(arg);
    if (!opt) {
      if (!inRun) { positionalRuns++; inRun = true; }
      if (positionalRuns > 1) unknown.push(arg); else args.sources.push(arg);
      continue;
    }
    inRun = false;
    const [name, inline] = opt;
    if (name.startsWith('?')) { unknown.push(arg); continue; }
    const spec = OPTIONS[name];
    if (spec.kind === 'help') { process.stdout.write(USAGE); process.exit(0); }
    if (spec.kind === 'flag') {
      if (inline !== null) fail(`argument ${name}: ignored explicit argument '${inline}'`);
      args[spec.dest] = true;
      continue;
    }
    let value = inline;
    if (value === null) {
      const next = argv[i + 1];
      if (next === undefined || optionOf(next)) fail(`argument ${name}: expected one argument`);
      value = next;
      i++;
    }
    if (spec.kind === 'int') {
      if (!/^\s*[+-]?\d+(_\d+)*\s*$/.test(value)) fail(`argument ${name}: invalid int value: ${strRepr(value)}`);
      args[spec.dest] = parseInt(value.replace(/_/g, ''), 10);
    } else if (spec.kind === 'append') args[spec.dest].push(pathParts(value));
    else if (spec.kind === 'path') args[spec.dest] = pathParts(value);
    else args[spec.dest] = value;
  }
  if (!args.sources.length) fail('the following arguments are required: sources');
  if (unknown.length) fail(`unrecognized arguments: ${unknown.join(' ')}`);
  args.sources = args.sources.map(pathParts);
  return args;
}

function main() {
  // --levels / --except: what the person changed in the rulebook (tests/rulebook/): a code's level
  // when it differs from the card's default, and the documents excepted. Every other code keeps
  // the behaviour below, so an untouched rulebook changes nothing.
  const { levels, excepts, rest } = levelArgs(process.argv.slice(2));
  const args = parseArgs(rest);

  // mxcli v0.25 describes in mdl 1; the rules read the v0.24 spelling (layout_rules/mdl1.cjs).
  const [described, used] = collect(args.sources);
  const text = toMdl0(described);
  if (!py.strip(text)) {
    process.stderr.write(`FAIL  no MDL found in [${args.sources.map(s => strRepr(pathStr(s))).join(', ')}]\n`);
    return 1;
  }

  // Every input is read once; a missing optional one is empty text.
  const lines = py.splitlines(text);
  const hasNavigation = Boolean(args.navigation && exists(fsPath(args.navigation)));
  const navigation = toMdl0(readOptional(args.navigation));
  const roles = toMdl0(readOptional(args.user_roles));
  const snippets = toMdl0(collect(args.sign_out_sources)[0]);
  const layouts = toMdl0(collect(args.layouts)[0]);
  const flows = toMdl0(collect(args.opened_from)[0]);
  const entityText = collect(args.entities)[0];
  const ownModules = py.split(args.own_modules);

  let [failures, warnings, pages] = check(lines);
  if (!args.port_parity) failures = failures.concat(verticalFindings(lines));
  // Input was described and nothing in it was recognised: a describe format these rules do not
  // read. Every rule would find nothing, and that would be a PASS for a check that saw nothing.
  const unread = [];
  if (args.expect_pages > 0 && !pageBlocks(lines).size) unread.push(`${args.expect_pages} page(s) were described and none was recognised`);
  if (hasNavigation && py.strip(navigation) && !py.splitlines(navigation).some(line => PROFILE_RE.match(line))) {
    unread.push('the navigation was described and no profile was recognised');
  }
  if (py.strip(roles) && !py.splitlines(roles).some(line => USER_ROLE_RE.match(line))) {
    unread.push('the user roles were described and none was recognised');
  }
  if (py.strip(entityText) && !Object.keys(stringLengths(entityText)).length) {
    unread.push('the entities were described and none was recognised');
  }
  if (unread.length) {
    py.print('could not run -- ' + unread.join('; ') + ": this mxcli's describe format is not one check_layout.py reads");
    return 2;
  }
  if (args.users_sign_in && hasNavigation) {
    const [navFailures, navWarnings] = signOutFindings(navigation, text + '\n' + snippets);
    failures = failures.concat(navFailures);
    warnings = warnings.concat(navWarnings);
    failures = failures.concat(roleHomeFindings(navigation));
  }
  if (args.template_module) {
    failures = failures.concat(templateModuleFindings(ownModules, Boolean(pageBlocks(lines).size), navigation, roles, text + '\n' + flows));
  }
  if (args.users_sign_in && ownModules.length && navigation) failures = failures.concat(adminHomeFindings(navigation, roles, ownModules));
  if (args.users_sign_in) failures = failures.concat(currentUserFindings(lines, snippets, navigation, layouts));
  if (args.users_sign_in && args.admin_module && hasNavigation) failures = failures.concat(accountFindings(navigation, roles, args.guest_role));
  if (hasNavigation) {
    failures = failures.concat(menuIconFindings(navigation));
    // NAV06 per user role when security is on and who may open what is known; else for everyone.
    const access = args.users_sign_in && args.menu_access ? readMenuAccess(readOptional(args.menu_access)) : null;
    failures = failures.concat(duplicateIconFindings(navigation, userRoles(roles), access));
  }
  failures = failures.concat(oneLayoutFindings(lines, navigation, layouts));
  failures = failures.concat(buttonIconFindings(lines.concat(py.splitlines(snippets))));
  failures = failures.concat(backButtonFindings(lines, flows, navigation));
  failures = failures.concat(headerButtonFindings(lines, flows));
  failures = failures.concat(edgeFindings(lines, snippets, navigation));
  if (args.layouts.length) failures = failures.concat(layoutMenuFindings(layouts));
  // Widget names: warnings while the app is built; a page new or changed since the last DONE
  // (the hashes the gate kept then) needs them, and --names error makes every one block.
  if (args.names === 'warn' || args.names === 'error') {
    const all = lines.concat(py.splitlines(snippets));
    const hashes = documentHashes(all);
    if (args.page_hashes) fs.writeFileSync(fsPath(args.page_hashes), JSON.stringify(hashes));
    let baseline = null;
    if (args.names_baseline && exists(fsPath(args.names_baseline))) {
      try { baseline = JSON.parse(fs.readFileSync(fsPath(args.names_baseline), 'utf8')); } catch { baseline = null; }
    }
    for (const f of nameFindings(all)) {
      const fresh = baseline && f.check === 'NAME02' && baseline[f.document] !== hashes[f.document];
      const finding = { check: f.check, line: f.line, message: f.message + (fresh ? ` -- ${f.document} is new or changed since the last DONE, so its names are required now` : ''), document: f.document };
      (args.names === 'error' || fresh ? failures : warnings).push(finding);
    }
  }
  if (args.entities.length) {
    const [textFailures, textWarnings] = textInputFindings(lines.concat(py.splitlines(snippets)), entityText);
    failures = failures.concat(textFailures);
    warnings = warnings.concat(textWarnings);
  }
  // URL01 needs to know which parameter entities are persistent; without --entities only pages with
  // no parameter or value parameters are judged.
  if (!args.port_parity) failures = failures.concat(urlFindings(lines, entityText));
  [failures, warnings] = relevel(failures, warnings, levels, excepts);
  const report = {
    verdict: !failures.length ? 'PASS' : 'FAIL',
    pages,
    sources: used.map(pathStr),
    failures,
    warnings,
  };
  if (args.json) {
    py.print(py.jsonDumps(report, { indent: 2 }));
  } else {
    py.print(`${report.verdict}  ${failures.length} failure(s) over ${pages} page(s)`);
    for (const f of failures) py.print(`  - [${f.check}] line ${f.line}: ${f.message}`);
    for (const w of warnings) py.print(`  ! [${w.check}] ${w.message}`);
  }
  return !failures.length ? 0 : 1;
}

// The rulebook's say: a code the person raised goes to failures, one lowered to warnings, `info`
// and `off` leave the output, and a finding on an excepted document (NAME01/02, URL01 carry one)
// is dropped. Findings keep their order within each list; `document` never reaches the output.
function relevel(failures, warnings, levels, excepts) {
  const keep = f => !(excepts[f.check] || []).includes(f.document || '');
  const strip = f => { const { document, ...rest } = f; return rest; };
  const out = { failures: [], warnings: [] };
  for (const [list, kind] of [[failures, 'failures'], [warnings, 'warnings']]) {
    for (const f of list) {
      if (!keep(f)) continue;
      const level = Object.prototype.hasOwnProperty.call(levels, f.check) ? levels[f.check] : null;
      if (level === 'off' || level === 'info') continue;
      out[level === 'block' ? 'failures' : level === 'warn' ? 'warnings' : kind].push(strip(f));
    }
  }
  return [out.failures, out.warnings];
}

// Advice is printed in the spelling of the mxcli the harness is pinned to (mdl1_spelling.cjs).
if (require.main === module) py.setOutputFilter(require('./mdl1_spelling.cjs').advice);
if (require.main === module) process.exitCode = main();

// Under the Python names: collect(sources) takes path strings and returns [text, [paths read]].
module.exports = {
  collect: sources => {
    const [text, used] = collect(sources.map(pathParts));
    return [text, used.map(pathStr)];
  },
  read_optional: p => readOptional(p ? pathParts(p) : null),
  main,
};
