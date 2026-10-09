// The navigation menu: NAV01/NAV02 (a Log out item, last), NAV03 (every role's home page is
// in the menu), NAV05 (an icon on every menu item) and NAV06 (no two entries one role sees share
// an icon).
//
// Part of check_layout.cjs; see its header for inputs and the full rule table.
'use strict';
const py = require('../py_compat.cjs');
const { re } = py;

// `create or replace navigation <Profile>` starts a profile's block in DESCRIBE NAVIGATION output.
const PROFILE_RE = re.compile(String.raw`^\s*create\s+(?:or\s+replace\s+)?navigation\s+(?P<name>\w+)`, 'i');
// One `menu item '<caption>' ...;` line.
const MENU_ITEM_RE = re.compile(String.raw`^\s*menu\s+item\s+'(?P<caption>[^']*)'(?P<rest>.*)$`, 'i');
const SIGN_OUT_RE = re.compile(String.raw`\bsign_out\b`, 'i');

// {profile: [[caption, is sign_out], ...]} in menu order (a Map); profiles without a menu are absent.
function menuItems(navigation) {
  const menus = new Map();
  let profile = '';
  for (const line of py.splitlines(navigation)) {
    const found = PROFILE_RE.match(line);
    if (found) { profile = found.group('name'); continue; }
    const item = MENU_ITEM_RE.match(line);
    if (item && profile) {
      if (!menus.has(profile)) menus.set(profile, []);
      menus.get(profile).push([item.group('caption'), Boolean(SIGN_OUT_RE.search(item.group('rest')))]);
    }
  }
  return menus;
}

const byKey = map => py.sorted([...map.keys()]).map(k => [k, map.get(k)]);

// NAV01 / NAV02: an app whose users sign in needs a way to log out.
function signOutFindings(navigation, otherMdl) {
  const failures = [], warnings = [];
  const buttonElsewhere = Boolean(SIGN_OUT_RE.search(otherMdl));
  for (const [profile, items] of byKey(menuItems(navigation))) {
    const signsOut = [];
    items.forEach(([, isSignOut], index) => { if (isSignOut) signsOut.push(index); });
    if (!signsOut.length) {
      if (!buttonElsewhere) {
        failures.push({
          check: 'NAV01',
          line: 0,
          message: `navigation profile ${profile}: users sign in, but its menu has no way to log` +
            " out -- add `menu item 'Log out' sign_out icon Atlas_Core.Atlas_Filled.logout;`" +
            ` as the last menu item (DESCRIBE NAVIGATION ${profile} first and keep the other items)`,
        });
      }
    } else if (signsOut[signsOut.length - 1] !== items.length - 1) {
      warnings.push({
        check: 'NAV02',
        line: 0,
        message: `navigation profile ${profile}: the Log out item is not the last item of the menu`,
      });
    }
  }
  return [failures, warnings];
}

// `home page Module.Page for Role` in DESCRIBE NAVIGATION output; the default home page has no `for`.
const ROLE_HOME_RE = re.compile(String.raw`^\s*home\s+page\s+(?P<page>[\w.]+)\s+for\s+(?P<role>[\w.]+)`, 'i');
const MENU_PAGE_RE = re.compile(String.raw`^\s*menu\s+item\s+'[^']*'\s+page\s+(?P<page>[\w.]+)`, 'i');

// The one-menu-for-every-role fact the NAV03/NAV04 messages carry, so the fix needs no lookup.
const ONE_MENU = 'one menu serves every role: Mendix hides a menu item from a user who cannot open its page, so' +
  ' give each role its pages with `grant view on page` and list them all in the menu';

// NAV03: a role opens on a page its menu does not offer, so it cannot get back there.
function roleHomeFindings(navigation) {
  const failures = [];
  const homes = new Map();
  const menuPages = new Map();
  let profile = '';
  for (const line of py.splitlines(navigation)) {
    const found = PROFILE_RE.match(line);
    if (found) { profile = found.group('name'); continue; }
    const home = ROLE_HOME_RE.match(line);
    if (home && profile) {
      if (!homes.has(profile)) homes.set(profile, []);
      homes.get(profile).push([home.group('page'), home.group('role')]);
    }
    const item = MENU_PAGE_RE.match(line);
    if (item && profile) {
      if (!menuPages.has(profile)) menuPages.set(profile, new Set());
      menuPages.get(profile).add(item.group('page').toLowerCase());
    }
  }
  for (const [profile, pairs] of byKey(homes)) {
    for (const [page, role] of pairs) {
      if ((menuPages.get(profile) || new Set()).has(page.toLowerCase())) continue;
      failures.push({
        check: 'NAV03',
        line: 0,
        message: `navigation profile ${profile}: role ${role} opens on ${page}, which is not in the menu` +
          ` -- add \`menu item '<caption>' page ${page} icon <icon>;\` before Log out` +
          ` (DESCRIBE NAVIGATION ${profile} first and keep the other items); ${ONE_MENU}`,
      });
    }
  }
  return failures;
}

// A sub-menu line: `menu '<caption>' [icon ...] (`.
const SUB_MENU_RE = re.compile(String.raw`^\s*menu\s+'(?P<caption>[^']*)'(?P<rest>.*)$`, 'i');
const ICON_RE = re.compile(String.raw`\bicon\b`, 'i');
// Caption words -> an Atlas_Filled icon that shows the same thing; first match wins.
const ICON_HINTS = [
  [['log out', 'logout', 'sign out'], 'logout'],
  [['home', 'start'], 'home'],
  [['dashboard', 'overview', 'kpi'], 'dashboard'],
  [['report', 'analytic', 'statistic', 'chart'], 'analytics-bars'],
  [['invoice', 'bill'], 'cash-payment-bill'],
  [['payment', 'credit'], 'credit-card'],
  [['order', 'cart', 'purchase'], 'shopping-cart'],
  [['shipment', 'delivery', 'product', 'stock'], 'shipment-box'],
  [['my account', 'profile'], 'user'],
  // User management gets its own icon, so a Customers item next to it never shares one (NAV06).
  [['user', 'account'], 'user-neutral-shield'],
  [['customer', 'client', 'contact', 'people', 'employee'], 'user-neutral-group'],
  [['task', 'todo', 'approval', 'inbox'], 'task-list-multiple'],
  [['document', 'file', 'contract'], 'document'],
  [['calendar', 'schedule', 'planning'], 'calendar'],
  [['mail', 'message', 'email'], 'email'],
  [['setup', 'setting', 'config', 'admin'], 'cog'],
  [['search', 'find'], 'search'],
];

function suggestedIcon(caption) {
  const low = caption.toLowerCase();
  for (const [words, icon] of ICON_HINTS) {
    if (words.some(word => low.includes(word))) {
      return !icon.includes('-') ? `Atlas_Core.Atlas_Filled.${icon}` : `Atlas_Core.Atlas_Filled."${icon}"`;
    }
  }
  return '';
}

// NAV05: every menu entry carries an icon that shows what it opens.
function menuIconFindings(navigation) {
  const failures = [];
  let profile = '';
  for (const line of py.splitlines(navigation)) {
    const found = PROFILE_RE.match(line);
    if (found) { profile = found.group('name'); continue; }
    const entry = MENU_ITEM_RE.match(line) || SUB_MENU_RE.match(line);
    if (!entry || !profile || ICON_RE.search(entry.group('rest'))) continue;
    const caption = entry.group('caption');
    const icon = suggestedIcon(caption);
    const fix = icon ? `\`icon ${icon}\``
      : 'an icon that shows what it opens, from `DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled`';
    failures.push({
      check: 'NAV05',
      line: 0,
      message: `navigation profile ${profile}: menu entry '${caption}' has no icon -- add ${fix} at the end` +
        ' of its line; with the sidebar collapsed the icon is all a user sees',
    });
  }
  return failures;
}

// --- NAV06: the entries one role sees never share an icon ------------------------------------

const ICON_REF_RE = re.compile(String.raw`\bicon\s+(?P<icon>[^;()]+?)\s*(?:;|\(|$)`, 'i');
const TARGET_RE = re.compile(String.raw`\b(?P<kind>page|microflow)\s+(?P<name>[\w]+\.[\w]+)`, 'i');
const CLOSE_RE = re.compile(String.raw`^\s*\)\s*;?\s*$`);

class MenuEntry {
  constructor(caption, icon, shownIcon, target) {
    this.caption = caption;
    this.icon = icon;            // normalised: no quotes, lower case; "" when there is none
    this.shown_icon = shownIcon; // as written, for the message
    this.target = target;        // "page Mod.Page" / "microflow Mod.Flow"; null for sign_out, URL, sub-menu
    this.children = [];
  }
}

function iconOf(rest) {
  const found = ICON_REF_RE.search(rest);
  if (!found) return ['', ''];
  const shown = py.strip(found.group('icon'));
  return [shown.split('"').join('').toLowerCase(), shown];
}

// {profile: every entry of its menu, sub-menus and the items inside them alike} (a Map).
function menuEntries(navigation) {
  const menus = new Map();
  let profile = '', stack = [];
  for (const line of py.splitlines(navigation)) {
    const found = PROFILE_RE.match(line);
    if (found) { profile = found.group('name'); stack = []; continue; }
    if (!profile) continue;
    const item = MENU_ITEM_RE.match(line);
    const sub = item ? null : SUB_MENU_RE.match(line);
    if (item || sub) {
      const rest = (item || sub).group('rest');
      const [icon, shown] = iconOf(rest);
      const target = item ? TARGET_RE.search(rest) : null;
      const entry = new MenuEntry((item || sub).group('caption'), icon, shown,
        target ? `${target.group('kind').toLowerCase()} ${target.group('name')}` : null);
      if (stack.length) stack[stack.length - 1].children.push(entry);
      if (!menus.has(profile)) menus.set(profile, []);
      menus.get(profile).push(entry);
      if (sub && py.rstrip(rest).endsWith('(')) stack.push(entry);
    } else if (CLOSE_RE.match(line) && stack.length) {
      stack.pop();
    }
  }
  return menus;
}

// json.loads for one answer: Python also takes NaN and Infinity; anything else that JSON.parse
// refuses is a ValueError there too.
function loadsJson(text) {
  return JSON.parse(text);
}

// `<kind> <Mod.Name><TAB><SHOW ACCESS --json>` lines -> {"page Mod.Name": Set{"Mod.Role", ...}} (a Map).
// A target whose answer cannot be read is left out: it then counts as visible to every role.
function readMenuAccess(text) {
  const access = new Map();
  for (const line of py.splitlines(text)) {
    const tab = line.indexOf('\t');
    const key = tab < 0 ? line : line.slice(0, tab);
    const answer = tab < 0 ? '' : line.slice(tab + 1);
    let rows;
    try {
      rows = loadsJson(answer);
    } catch {
      continue;
    }
    if (Array.isArray(rows)) {
      const k = py.strip(key);
      const sp = k.indexOf(' ');
      const kind = sp < 0 ? k : k.slice(0, sp), name = sp < 0 ? '' : k.slice(sp + 1);
      const roles = new Set();
      for (const row of rows) {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          roles.add(`${py.pyStr('Module' in row ? row.Module : '')}.${py.pyStr('Role' in row ? row.Role : '')}`);
        }
      }
      access.set(`${kind.toLowerCase()} ${py.strip(name)}`, roles);
    }
  }
  return access;
}

function visible(entry, moduleRoles, access) {
  if (entry.children.length) return entry.children.some(child => visible(child, moduleRoles, access));
  if (access === null || entry.target === null || !access.has(entry.target)) return true;
  for (const r of access.get(entry.target)) if (moduleRoles.has(r)) return true;
  return false;
}

// NAV06: with the sidebar collapsed the icon is all a user sees, so the entries one user role
// sees -- Mendix hides those whose page or microflow the role may not open -- never share one.
// Without access (security off) everyone sees every entry. roles: Map role -> Set of module roles.
function duplicateIconFindings(navigation, roles, access) {
  const viewers = access !== null && roles.size ? roles : new Map([['', new Set()]]);
  const clashes = new Map();
  for (const [profile, entries] of byKey(menuEntries(navigation))) {
    for (const [role, moduleRoles] of byKey(viewers)) {
      const first = new Map();
      for (const entry of entries) {
        if (!entry.icon || !visible(entry, moduleRoles, access)) continue;
        if (!first.has(entry.icon)) first.set(entry.icon, entry);
        const seen = first.get(entry.icon);
        if (seen !== entry) {
          const key = JSON.stringify([profile, seen.caption, entry.caption, entry.shown_icon]);
          if (!clashes.has(key)) clashes.set(key, [[profile, seen.caption, entry.caption, entry.shown_icon], []]);
          clashes.get(key)[1].push(role);
        }
      }
    }
  }
  const failures = [];
  const ordered = py.sorted([...clashes.values()], ([k]) => k);
  for (const [[profile, one, two, icon], who] of ordered) {
    const normal = icon.split('"').join('').toLowerCase();
    let change = two, other = suggestedIcon(two);
    if (!other || other.split('"').join('').toLowerCase() === normal) {
      change = one;
      other = suggestedIcon(one);
    }
    let fix;
    if (other && other.split('"').join('').toLowerCase() !== normal) fix = `give '${change}' its own icon, e.g. \`icon ${other}\``;
    else fix = `give '${change}' its own icon, from \`DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled\``;
    const whom = who.length === 1 && who[0] === '' ? 'every user' : (who.length === 1 ? 'role ' : 'roles ') + who.join(', ');
    failures.push({
      check: 'NAV06',
      line: 0,
      message: `navigation profile ${profile}: '${one}' and '${two}' both show icon ${icon} for ${whom}` +
        ` -- ${fix} (DESCRIBE NAVIGATION ${profile} first and keep the other items);` +
        ' with the sidebar collapsed the icon is all a user sees',
    });
  }
  return failures;
}

module.exports = {
  PROFILE_RE, MENU_ITEM_RE, SIGN_OUT_RE, menuItems, signOutFindings, ROLE_HOME_RE, MENU_PAGE_RE, ONE_MENU,
  roleHomeFindings, SUB_MENU_RE, suggestedIcon, menuIconFindings, menuEntries, readMenuAccess,
  duplicateIconFindings,
};
