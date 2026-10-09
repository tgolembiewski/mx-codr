// Accounts and the template module: ACCOUNT01-03 (Users and My account in the menu, the
// roles that need them), MODULE01 (MyFirstModule removed) and HOME01 (admins start in the app).
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;
const { MENU_ITEM_RE, PROFILE_RE } = require('./navigation.cjs');

// ACCOUNT01-03 ---------------------------------------------------------------------------------
const ADMIN_PAGE = 'Administration.Account_Overview';
const MY_ACCOUNT_FLOW = 'Administration.ManageMyAccount';
const ADMIN_ITEM = `menu item 'Users' page ${ADMIN_PAGE} icon Atlas_Core.Atlas_Filled."user-neutral-shield";`;
const MY_ACCOUNT_ITEM = `menu item 'My account' microflow ${MY_ACCOUNT_FLOW} icon Atlas_Core.Atlas_Filled.user;`;
const USER_ROLE_RE = re.compile(String.raw`^\s*create\s+user\s+role\s+(?P<name>[\w.]+)\s*\((?P<roles>[^)]*)\)`, 'i');

const byKey = map => py.sorted([...map.keys()]).map(k => [k, map.get(k)]);

// {user role: Set of its module roles} (a Map), as `{m.group("name"): {...} for m in ...}` builds it.
function userRoles(text) {
  const roles = new Map();
  for (const line of py.splitlines(text)) {
    const m = USER_ROLE_RE.match(line);
    if (m) roles.set(m.group('name'), new Set(m.group('roles').split(',').map(r => py.strip(r))));
  }
  return roles;
}

// ACCOUNT01-03: user management for administrators, own account and password for everyone.
function accountFindings(navigation, userRoleText, guestRole) {
  const failures = [];
  const targets = new Map();
  let profile = '';
  for (const line of py.splitlines(navigation)) {
    const found = PROFILE_RE.match(line);
    if (found) {
      profile = found.group('name');
      if (!targets.has(profile)) targets.set(profile, '');
      continue;
    }
    if (profile && MENU_ITEM_RE.match(line)) targets.set(profile, targets.get(profile) + line + '\n');
  }
  for (const [p, menu] of byKey(targets)) {
    if (!menu) continue;  // a profile without a menu is not where users navigate
    if (!re.search(String.raw`\bpage\s+` + re.escape(ADMIN_PAGE) + String.raw`\b`, menu, 'i')) {
      failures.push({ check: 'ACCOUNT01', line: 0, message:
        `navigation profile ${p}: no menu item for user management -- add \`${ADMIN_ITEM}\` before` +
        " Log out. It is the Administration module's own page; only Administration.Administrator can" +
        ' open it, so everyone else never sees the item' });
    }
    if (!re.search(String.raw`\bmicroflow\s+` + re.escape(MY_ACCOUNT_FLOW) + String.raw`\b`, menu, 'i')) {
      failures.push({ check: 'ACCOUNT02', line: 0, message:
        `navigation profile ${p}: no menu item for the user's own account and password -- add` +
        ` \`${MY_ACCOUNT_ITEM}\` before Log out. It opens Administration.MyAccount (view the account,` +
        ' change the password) for whoever is signed in; a menu item cannot open MyAccount itself,' +
        ' because the page needs the account as its parameter' });
    }
  }
  const roles = userRoles(userRoleText);
  for (const [name, moduleRoles] of byKey(roles)) {
    if (name === guestRole || moduleRoles.has('Administration.User')) continue;
    failures.push({ check: 'ACCOUNT03', line: 0, message:
      `user role ${name} signs in but lacks Administration.User, so 'My account' is hidden from it and` +
      ` its users cannot change their password -- \`alter user role ${name} add module roles` +
      ' (Administration.User);`' });
  }
  if (roles.size && ![...roles.values()].some(r => r.has('Administration.Administrator'))) {
    failures.push({ check: 'ACCOUNT03', line: 0, message:
      'no user role has Administration.Administrator, so nobody can manage users -- add it to the' +
      " administrators' role: `alter user role Administrator add module roles (Administration.Administrator);`" });
  }
  return failures;
}

// MODULE01 / HOME01 ---------------------------------------------------------------------------
const TEMPLATE_MODULE = 'MyFirstModule';
const TEMPLATE_USE_RE = re.compile(TEMPLATE_MODULE + String.raw`[.][\w.]+`);
const HOME_RE = re.compile(String.raw`^\s*home\s+page\s+(?P<page>[\w.]+)(?:\s+for\s+(?P<role>[\w.]+))?`, 'i');

// User roles that administer the app: Administration.Administrator, or `manage all roles`.
function adminRoles(userRoleText) {
  const found = [];
  for (const line of py.splitlines(userRoleText)) {
    const role = USER_ROLE_RE.match(line);
    if (role && (role.group('roles').includes('Administration.Administrator') || line.toLowerCase().includes('manage all roles'))) {
      found.push(role.group('name'));
    }
  }
  return found;
}

// MODULE01: once the app has a module of its own, the template's MyFirstModule is dead weight.
function templateModuleFindings(ownModules, hasPages, navigation, userRoleText, ownMdl) {
  if (!ownModules.length || !hasPages) return [];
  let uses = [];
  for (const line of py.splitlines(navigation)) {
    const low = line.toLowerCase();
    if (line.includes(TEMPLATE_MODULE + '.') && (low.includes('home page') || low.includes('menu item'))) {
      uses.push('navigation: ' + py.rstrip(py.strip(line), ';'));
    }
  }
  for (const line of py.splitlines(userRoleText)) {
    const role = USER_ROLE_RE.match(line);
    if (role && role.group('roles').includes(TEMPLATE_MODULE + '.')) uses.push(`user role ${role.group('name')} has ${TEMPLATE_MODULE}.User`);
  }
  let document = '';
  for (const line of py.splitlines(ownMdl)) {
    const head = re.match(String.raw`^\s*create\s+(?:or\s+(?:replace|modify)\s+)?(?:page|snippet|microflow|nanoflow)\s+([\w.]+)`, line, 'i');
    if (head) document = head.group(1);
    const used = TEMPLATE_USE_RE.search(line);
    if (used && document) uses.push(`${document} uses ${used.group(0)}`);
  }
  uses = [...new Set(uses)];
  const main = ownModules[0];
  let steps = [];
  if (uses.some(u => u.startsWith('navigation:'))) {
    steps.push(`point every \`home page\`/\`menu item\` at pages of ${main} -- the administrators get their own` +
      ` home page there (e.g. ${main}.Admin_Home), and the profile keeps a default \`home page` +
      ` ${main}.<Page>\` without \`for\` (without one mx check fails CE0527)`);
  }
  if (uses.some(u => u.includes(' uses '))) steps.push(`move what your pages or flows use from ${TEMPLATE_MODULE} (an image, a flow) into ${main}`);
  if (uses.some(u => u.startsWith('user role'))) steps.push(`\`alter user role <Role> remove module roles (${TEMPLATE_MODULE}.User);\` for each role listed`);
  steps.push(`\`drop module ${TEMPLATE_MODULE};\`, and remove ${TEMPLATE_MODULE} from the scripts in mdlsource/` +
    ' so a re-run does not bring it back');
  steps = steps.map((step, n) => `${n + 1}. ${step}`).join('; ');
  const found = uses.length ? uses.slice(0, 8).join('; ') + (uses.length > 8 ? `; ... ${uses.length - 8} more` : '') : 'nothing';
  return [{ check: 'MODULE01', line: 0, message:
    `${TEMPLATE_MODULE} is the empty template's module and this app has its own (${ownModules.join(', ')})` +
    ` -- remove it. Still using it: ${found}. Steps: ${steps}` }];
}

// HOME01: administrators open on a page of the app itself, not the template's Home_Web.
function adminHomeFindings(navigation, userRoleText, ownModules) {
  const failures = [];
  const dflt = new Map(), byRole = new Map();
  let profile = '';
  for (const line of py.splitlines(navigation)) {
    const found = PROFILE_RE.match(line);
    if (found) { profile = found.group('name'); continue; }
    const home = HOME_RE.match(line);
    if (home && profile) {
      if (home.group('role')) {
        if (!byRole.has(profile)) byRole.set(profile, new Map());
        byRole.get(profile).set(home.group('role'), home.group('page'));
      } else if (!dflt.has(profile)) {
        dflt.set(profile, home.group('page'));
      }
    }
  }
  const main = ownModules.length ? ownModules[0] : '<YourModule>';
  const profiles = py.sorted([...new Set([...dflt.keys(), ...byRole.keys()])]);
  for (const role of adminRoles(userRoleText)) {
    for (const p of profiles) {
      const own = byRole.get(p) || new Map();
      const page = own.has(role) ? own.get(role) : (dflt.has(p) ? dflt.get(p) : '');
      if (page && ownModules.includes(page.split('.')[0])) continue;
      failures.push({ check: 'HOME01', line: 0, message:
        `navigation profile ${p}: role ${role} opens on ${page || 'no page'}, which is not a page of` +
        ` the app's own modules -- create an administrators' home page in ${main} (e.g. ${main}.Admin_Home:` +
        ' what an administrator starts the day with, and links to Users) and add' +
        ` \`home page ${main}.Admin_Home for ${role}\` to the profile` });
    }
  }
  return failures;
}

module.exports = {
  USER_ROLE_RE, userRoles, accountFindings, templateModuleFindings, adminHomeFindings, HOME_RE, adminRoles,
};
