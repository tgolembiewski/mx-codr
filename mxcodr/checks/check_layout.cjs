#!/usr/bin/env node
// The layout step: the rules for pages, snippets, the menu and the layouts of an app.
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
// What each code checks, its level and its fix: its card, rulebook/layout/<CODE>.md (and
// rulebook/naming/ for NAME01-02). The rules live in layout_rules/, one file per topic; this file
// reads the arguments, runs check() from spacing.cjs and verticalFindings(), then LAYOUT_RULES in
// order. mdl1.cjs rewrites an mxcli v0.25 (`mdl 1`) describe into the v0.24 spelling the rules read.
// --port-parity leaves out the rules newer than the port, for the test that compares this file with
// its frozen copy.
'use strict';
const fs = require('fs');
const path = require('path');
const py = require('./py_compat.cjs');
const { strRepr, readTextReplace } = require('./layout_rules/compat.cjs');
const { USER_ROLE_RE, userRoles, accountFindings, adminHomeFindings, templateModuleFindings } = require('./layout_rules/accounts.cjs');
const { buttonIconFindings } = require('./layout_rules/controls.cjs');
const { hiddenWidgetFindings } = require('./layout_rules/hidden.cjs');
const { rawLabelFindings } = require('./layout_rules/labels.cjs');
const { edgeFindings } = require('./layout_rules/edges.cjs');
const { headerButtonFindings } = require('./layout_rules/grids.cjs');
const { missingFilterFindings } = require('./layout_rules/grid_filters.cjs');
const { textInputFindings, stringLengths } = require('./layout_rules/inputs.cjs');
const { dateColumnFindings } = require('./layout_rules/dates.cjs');
const { listTabsFindings } = require('./layout_rules/list_tabs.cjs');
const { verticalFindings } = require('./layout_rules/vertical.cjs');
const { nameFindings, documentHashes } = require('./layout_rules/names.cjs');
const { urlFindings } = require('./layout_rules/urls.cjs');
const { offlineFindings } = require('./layout_rules/offline.cjs');
const { phoneMenuFindings, webPhoneLayoutFindings, phoneGridFindings, stickyBarFindings, loginWidthFindings, tabsFindings } = require('./layout_rules/phone.cjs');
const { levelArgs } = require('./rulebook.cjs');
const { layoutMenuFindings, oneLayoutFindings } = require('./layout_rules/layouts.cjs');
const { PROFILE_RE, duplicateIconFindings, menuIconFindings, readMenuAccess, roleHomeFindings, signOutFindings } = require('./layout_rules/navigation.cjs');
const { backButtonFindings, currentUserFindings } = require('./layout_rules/page_top.cjs');
const { phoneTopFindings } = require('./layout_rules/phone_top.cjs');
const { listItemFindings } = require('./layout_rules/list_items.cjs');
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
  // Not in USAGE, which stays byte-identical to the frozen reference: the offline rules' inputs.
  '--web-index': { dest: 'web_index', kind: 'path' },
  '--theme-css': { dest: 'theme_css', kind: 'path' },
  '--tests-dir': { dest: 'tests_dir', kind: 'path' },
  '--phone-layouts': { dest: 'phone_layouts', kind: 'append' },
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
    web_index: null, theme_css: null, tests_dir: null, phone_layouts: [],
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

// The layout rules after check() and verticalFindings(), in the order their findings print. Each runs
// when `when` holds; `into` is where its findings go (failures by default; 'both' for a rule that
// returns [failures, warnings]). `newerThanPort`: left out under --port-parity, which compares the
// checkers with their frozen copy from before the rule existed.
const LAYOUT_RULES = [
  { when: c => c.args.users_sign_in && c.hasNavigation, into: 'both', run: c => signOutFindings(c.navigation, c.text + '\n' + c.snippets) },
  { when: c => c.args.users_sign_in && c.hasNavigation, run: c => roleHomeFindings(c.navigation) },
  { when: c => c.args.template_module, run: c => templateModuleFindings(c.ownModules, Boolean(pageBlocks(c.lines).size), c.navigation, c.roles, c.text + '\n' + c.flows) },
  { when: c => c.args.users_sign_in && c.ownModules.length && c.navigation, run: c => adminHomeFindings(c.navigation, c.roles, c.ownModules) },
  { when: c => c.args.users_sign_in, run: c => currentUserFindings(c.lines, c.snippets, c.navigation, c.layouts, c.phone) },
  { when: c => c.args.users_sign_in && c.args.admin_module && c.hasNavigation, run: c => accountFindings(c.navigation, c.roles, c.args.guest_role) },
  { when: c => c.hasNavigation, run: c => menuIconFindings(c.navigation) },
  // NAV06 per user role when security is on and who may open what is known; else for everyone.
  { when: c => c.hasNavigation, run: c => duplicateIconFindings(c.navigation, userRoles(c.roles),
    c.args.users_sign_in && c.args.menu_access ? readMenuAccess(readOptional(c.args.menu_access)) : null) },
  { run: c => oneLayoutFindings(c.lines, c.navigation, c.layouts) },
  { run: c => buttonIconFindings(c.withSnippets) },
  { newerThanPort: true, run: c => hiddenWidgetFindings(c.withSnippets) },        // HIDDEN01
  { newerThanPort: true, run: c => rawLabelFindings(c.withSnippets) },            // LABEL01
  { run: c => backButtonFindings(c.lines, c.flows, c.navigation) },
  { run: c => headerButtonFindings(c.lines, c.flows) },
  { newerThanPort: true, run: c => missingFilterFindings(c.withSnippets, c.entityText) },  // GRID03
  { newerThanPort: true, run: c => dateColumnFindings(c.withSnippets)[0] },               // DATE01
  { newerThanPort: true, run: c => listTabsFindings(c.lines, c.entityText) },             // TABS02, KPI01
  { run: c => edgeFindings(c.lines, c.snippets, c.navigation) },
  { run: c => listItemFindings(c.withSnippets) },                                         // LIST01
  { when: c => c.args.layouts.length, run: c => layoutMenuFindings(c.layouts) },
  // Offline and phone: OFFLINE01-03, PHONE01-06, TABS01 (a warning).
  { when: c => c.hasNavigation, run: c => offlineFindings(c.navigation, readOptional(c.args.web_index), c.args.tests_dir ? fsPath(c.args.tests_dir) : '') },
  { when: c => c.args.phone_layouts.length, run: c => phoneMenuFindings(c.lines, c.phone) },
  { when: c => c.args.phone_layouts.length && c.hasNavigation, run: c => webPhoneLayoutFindings(c.navigation, c.lines, c.phone) },
  { when: c => c.args.phone_layouts.length, run: c => phoneGridFindings(c.lines, c.phone) },
  { when: c => c.args.phone_layouts.length, run: c => stickyBarFindings(c.lines, c.phone, readOptional(c.args.theme_css)) },
  { when: c => c.args.phone_layouts.length, run: c => loginWidthFindings(c.lines, c.phone, readOptional(c.args.theme_css)) },
  { when: c => c.args.phone_layouts.length, run: c => phoneTopFindings(c.lines, c.phone, c.snippets) },
  { when: c => c.args.phone_layouts.length, into: 'warnings', run: c => tabsFindings(c.lines, c.phone) },
];

// Widget names: a page or snippet that was not in the app when the harness was installed (the
// --names-baseline the installer wrote) needs them; one that was keeps them as warnings, so an app
// that grew in Studio Pro is not renamed wholesale. --names error makes every one block. The
// precheck asks for them before each exec already; this is the backstop.
function nameFindingsInto(ctx, failures, warnings) {
  const { args } = ctx;
  if (args.names !== 'warn' && args.names !== 'error') return;
  const all = ctx.withSnippets;
  const hashes = documentHashes(all);
  if (args.page_hashes) fs.writeFileSync(fsPath(args.page_hashes), JSON.stringify(hashes));
  let baseline = null;
  if (args.names_baseline && exists(fsPath(args.names_baseline))) {
    try { baseline = JSON.parse(fs.readFileSync(fsPath(args.names_baseline), 'utf8')); } catch { baseline = null; }
  }
  for (const f of nameFindings(all)) {
    const fresh = baseline && f.check === 'NAME02' && !Object.prototype.hasOwnProperty.call(baseline, f.document);
    const finding = { check: f.check, line: f.line, message: f.message + (fresh ? ` -- ${f.document} is new since the harness was installed, so its names are required` : ''), document: f.document };
    (args.names === 'error' || fresh ? failures : warnings).push(finding);
  }
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
  const ctx = {
    args, lines, text, navigation, roles, snippets, layouts, flows, entityText, ownModules, hasNavigation,
    withSnippets: lines.concat(py.splitlines(snippets)),
    phone: args.phone_layouts.length ? collect(args.phone_layouts)[0] : '',
  };
  for (const rule of LAYOUT_RULES) {
    if (args.port_parity && rule.newerThanPort) continue;
    if (rule.when && !rule.when(ctx)) continue;
    const found = rule.run(ctx);
    if (rule.into === 'both') {
      failures = failures.concat(found[0]);
      warnings = warnings.concat(found[1]);
    } else if (rule.into === 'warnings') {
      warnings = warnings.concat(found);
    } else {
      failures = failures.concat(found);
    }
  }
  nameFindingsInto(ctx, failures, warnings);
  if (args.entities.length) {
    const [textFailures, textWarnings] = textInputFindings(ctx.withSnippets, entityText);
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
  main,
};
