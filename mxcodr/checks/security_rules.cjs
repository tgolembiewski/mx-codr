#!/usr/bin/env node
// Mendix's own security best practices that a model shows (docs.mendix.com/howto/security/
// best-practices-security, and the Security Findings FAQ), checked on the app's own modules.
// Blocking:
//   CRED01   a constant named for a secret (password, token, API key, ...) has a default value: it ships
//            in every build and backup ("leave constants blank by default; populate values during
//            deployment"); worse when it is exposed to the client
//   ANON01   the anonymous (guest) role may create or write a persistent entity ("do not allow anonymous
//            users to create or write to persistable objects")
//   STRICT01 strict mode is off ("enable strict mode")
//   FILTER01 a page shows a role only its own rows through a list's XPath ([%CurrentUser%]), while that
//            role's access rule on the entity has no XPath: every other way in -- another page, an API,
//            the client API -- reads every row ("do not use widget constraints as a security measure";
//            "visibility does not equal security")
//   SQL01    a microflow builds a SQL or OQL statement by concatenating a variable ("use prepared
//            statements", "avoid injection")
// Warnings:
//   EXTENDS01 an entity specialises System.User or Administration.Account ("do not combine business
//            information with the end-user by specialising System.User"; link them 1-1)
//   ADMIN01  the administrator is still called MxAdmin ("rename the default MxAdmin")
//   XSS01    an HTML Element shows, as HTML, an attribute a user types ("HTMLEncode / XSSanitize")
//   WRITE01  a role may write an attribute none of its pages lets it edit and only server-side flows set
//            (a nanoflow or an @applyentityaccess microflow runs with the user's rights and needs it)
//            ("do not make attributes determined by the system writable")
//   PWD01    the password policy is below a strong one (8+, digit, mixed case, symbol)
//
// Usage: security_rules.cjs <app_dir> <Module>... [--mpr <copy.mpr>] [--no-refresh]
// Prints `FAIL|PASS <summary>`, `  - [CODE] ...` blocking lines, `  ~ [CODE] ...` warnings.
// Exit 0 nothing blocking, 1 blocking findings, 2 the model could not be read.
'use strict';
const fs = require('fs');
const path = require('path');
const { mxcli, ModelReadError } = require('./check_unused.cjs');

const words = text => (String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .toLowerCase().match(/[a-z0-9]+/g) || []);

// A constant whose name says it holds a secret.
function secretName(name) {
  const w = words(String(name).split('.').pop());
  if (w.some(x => ['password', 'passwd', 'pwd', 'secret', 'token', 'credential', 'credentials', 'apikey', 'privatekey'].includes(x))) return true;
  for (let i = 0; i + 1 < w.length; i++) {
    if (['api', 'private', 'access', 'secret', 'signing'].includes(w[i]) && ['key', 'keys'].includes(w[i + 1])) return true;
    if (w[i] === 'client' && w[i + 1] === 'secret') return true;
  }
  return false;
}

// Each `database [from] M.E [where [...]]` source in a page's text: [[entity, xpath or '']].
function databaseSources(text) {
  const out = [];
  const re = /\bdatabase\s+(?:from\s+)?([A-Za-z_]\w*\.[A-Za-z_]\w*)(\s+where\s+\[)?/gi;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) { out.push([m[1], '']); continue; }
    let depth = 1, i = re.lastIndex, quoted = false;
    for (; i < text.length && depth; i++) {
      const c = text[i];
      if (c === "'") quoted = !quoted;
      else if (!quoted && c === '[') depth++;
      else if (!quoted && c === ']') depth--;
    }
    out.push([m[1], text.slice(re.lastIndex - 1, i)]);
  }
  return out;
}

// The property lists `( ... )` of each `<keyword> name (` widget in a page's text, quotes respected.
function widgetBodies(text, keyword) {
  const out = [];
  const re = new RegExp(`\\b${keyword}\\s+[\\w"]+\\s*\\(`, 'gi');
  let m;
  while ((m = re.exec(text))) {
    let depth = 1, i = re.lastIndex, quoted = false;
    for (; i < text.length && depth; i++) {
      const c = text[i];
      if (c === "'") quoted = !quoted;
      else if (!quoted && c === '(') depth++;
      else if (!quoted && c === ')') depth--;
    }
    out.push(text.slice(re.lastIndex, i - 1));
  }
  return out;
}

function projectSecurity(text) {
  const field = re => { const m = re.exec(text); return m ? m[1].trim() : ''; };
  return {
    level: field(/Security Level:\s*(.+)/i),
    strict: /^true$/i.test(field(/Strict Mode:\s*(.+)/i)),
    guest: /^true$/i.test(field(/Guest Access:\s*(.+)/i)),
    guestRole: field(/Guest (?:User )?Role:\s*(.+)/i),
    admin: field(/Admin User:\s*(.+)/i),
    minLength: parseInt(field(/Minimum Length:\s*(\d+)/i) || '0', 10),
    digit: /^true$/i.test(field(/Require Digit:\s*(.+)/i)),
    mixed: /^true$/i.test(field(/Require Mixed Case:\s*(.+)/i)),
    symbol: /^true$/i.test(field(/Require Symbol:\s*(.+)/i)),
  };
}

// model: {sources: [{QualifiedName, ModuleName, ObjectType, SourceText}], permissions: [{ModuleRoleName,
// ElementType, ElementName, MemberName, AccessType, XPathConstraint}], constants: [{QualifiedName,
// ModuleName, DataType, DefaultValue, ExposedToClient}], security: projectSecurity(...),
// associations: [{QualifiedName}], moduleRoles: {UserRole: [Module.Role]}}
// -> [{code, blocking, message}]
function findings(model, modules) {
  const own = new Set(modules);
  const mine = name => own.has(String(name).split('.')[0]);
  const out = [];
  const add = (code, blocking, message) => out.push({ code, blocking, message });
  const sec = model.security;

  // CRED01
  for (const c of model.constants) {
    if (!own.has(c.ModuleName) || !/string/i.test(c.DataType || 'String') || !secretName(c.QualifiedName)) continue;
    if (!String(c.DefaultValue || '').length) continue;
    const exposed = String(c.ExposedToClient) === '1' || /^true$/i.test(String(c.ExposedToClient));
    add('CRED01', true, `${c.QualifiedName} holds a secret in its default value${exposed ? ', and it is exposed to the client, so every browser gets it' : ''}: ` +
      'a default ships in every build, package and backup. Set DefaultValue to \'\' in the script that creates the constant ' +
      '(mxcli has no alter constant, and a second create of it elsewhere is SCRIPT01) and exec that script again -- when STALE01 refuses ' +
      'that exec, move the constant into a script of its own and take it out of the old one; give the value per ' +
      `environment: locally in a script of its own, alter settings constant @${c.QualifiedName} value '...' in configuration 'Default'; ` +
      '(a run configuration stays out of the deployment package), on a server at deployment');
  }

  // STRICT01
  if (sec.level && !/^off/i.test(sec.level) && !sec.strict) {
    add('STRICT01', true, 'strict mode is off: the client API can then retrieve and change data in ways the model never offers. ' +
      'Turn it on: alter app security ( StrictMode: TRUE );');
  }

  const persistent = new Set(model.sources.filter(d => d.ObjectType === 'ENTITY' && /\bpersistent\s+entity\b/i.test(d.SourceText || '') &&
    !/\bnon-persistent\s+entity\b/i.test(d.SourceText || '')).map(d => d.QualifiedName));

  // ANON01
  if (sec.guest && sec.guestRole) {
    const roles = new Set(model.moduleRoles[sec.guestRole] || []);
    const seen = new Set();
    for (const p of model.permissions) {
      if (p.ElementType !== 'ENTITY' || !roles.has(p.ModuleRoleName) || !mine(p.ElementName) || !persistent.has(p.ElementName)) continue;
      if (!/^(CREATE|WRITE|MEMBER_WRITE)$/.test(p.AccessType)) continue;
      const key = p.ElementName + '|' + p.ModuleRoleName;
      if (seen.has(key)) continue;
      seen.add(key);
      add('ANON01', true, `the guest role ${sec.guestRole} (${p.ModuleRoleName}) may create or write ${p.ElementName}: anyone on the internet can fill ` +
        'the database. Revoke it (revoke create, write on ...) and let anonymous visitors only read, or take the input through a ' +
        'non-persistent entity and a microflow that validates it');
    }
  }

  // FILTER01
  const pageRoles = {};
  for (const p of model.permissions) {
    if (p.ElementType === 'PAGE' && p.AccessType === 'VIEW') (pageRoles[p.ElementName] = pageRoles[p.ElementName] || new Set()).add(p.ModuleRoleName);
  }
  const reads = {};
  for (const p of model.permissions) {
    if (p.ElementType !== 'ENTITY' || p.AccessType !== 'READ') continue;
    const key = p.ElementName + '|' + p.ModuleRoleName;
    (reads[key] = reads[key] || []).push(p.XPathConstraint || '');
  }
  // A role that also has a page listing every row of the entity sees them all on purpose: its own-rows
  // list is a convenience, not the only thing between it and the rest.
  const listsAll = new Set();
  for (const d of model.sources) {
    if (d.ObjectType !== 'PAGE') continue;
    for (const [entity, xpath] of databaseSources(d.SourceText || '')) {
      if (/CurrentUser/i.test(xpath)) continue;
      for (const role of pageRoles[d.QualifiedName] || []) listsAll.add(entity + '|' + role);
    }
  }
  const flagged = new Set();
  for (const d of model.sources) {
    if (d.ObjectType !== 'PAGE' || !own.has(d.ModuleName)) continue;
    for (const [entity, xpath] of databaseSources(d.SourceText || '')) {
      if (!/CurrentUser/i.test(xpath)) continue;
      for (const role of pageRoles[d.QualifiedName] || []) {
        const rules = reads[entity + '|' + role];
        if (!rules || rules.some(x => x)) continue;   // no read at all, or a scoped rule: not this finding
        if (listsAll.has(entity + '|' + role)) continue;
        const key = entity + '|' + role;
        if (flagged.has(key)) continue;
        flagged.add(key);
        add('FILTER01', true, `${d.QualifiedName} shows ${role} only its own ${entity} rows (${xpath}), but ${role}'s access rule on ` +
          `${entity} reads every row: another page, an API or the client API gets them all -- a filter on a page is not security. ` +
          `Put the same constraint on that rule (describe entity ${entity} shows it) and write the rule again with it: ` +
          `grant read (...) on entity ${entity} to ${role} where ${xpath}; -- a second, constrained rule beside the old one changes nothing, rules add up`);
      }
    }
  }

  // SQL01
  for (const d of model.sources) {
    if (!/^(MICROFLOW|NANOFLOW)$/.test(d.ObjectType) || !own.has(d.ModuleName)) continue;
    const m = /'\s*(select|insert|update|delete|merge)\b[^']*'\s*\+\s*\$[\w/.]+/i.exec(d.SourceText || '');
    if (!m) continue;
    add('SQL01', true, `${d.QualifiedName} builds a query by joining text and a variable (${m[0].slice(0, 60)}...): whoever controls that ` +
      'value controls the query. Use a database connection query with parameters, or OQL parameters, never concatenation');
  }

  // EXTENDS01
  for (const d of model.sources) {
    if (d.ObjectType !== 'ENTITY' || !own.has(d.ModuleName)) continue;
    const m = /\bextends\s+(System\.User|Administration\.Account)\b/i.exec(d.SourceText || '');
    if (m) add('EXTENDS01', false, `${d.QualifiedName} specialises ${m[1]}: business data and the login account in one object. ` +
      'Mendix: keep them apart, a 1-1 association from your entity to the account');
  }

  // ADMIN01
  if (sec.admin && /^MxAdmin$/i.test(sec.admin)) {
    add('ADMIN01', false, 'the administrator is still called MxAdmin, the name every attacker tries first. For the person, before ' +
      'the app goes live: rename it in Studio Pro (App Security > Administrator). mxcli cannot change it -- leave it');
  }

  // XSS01: an HTML Element in innerHTML mode whose template takes an attribute a user can type into.
  const typed = new Set();
  for (const d of model.sources) {
    if (!/^(PAGE|SNIPPET)$/.test(d.ObjectType) || !own.has(d.ModuleName)) continue;
    for (const kind of ['textbox', 'textarea', 'richtext', 'richtexteditor']) {
      for (const body of widgetBodies(d.SourceText || '', kind)) {
        const a = /\bAttribute:\s*"?(\w+)/i.exec(body);
        if (a) typed.add(a[1].toLowerCase());
      }
    }
  }
  for (const d of model.sources) {
    if (!/^(PAGE|SNIPPET)$/.test(d.ObjectType) || !own.has(d.ModuleName)) continue;
    for (const body of widgetBodies(d.SourceText || '', 'htmlelement')) {
      if (!/tagContentMode:\s*'innerHTML'/i.test(body)) continue;
      const attrs = [...body.matchAll(/tagContent(?:Repeat)?HTMLParams:\s*\(([^)]*)\)/gi)].flatMap(p => [...p[1].matchAll(/=\s*"?(\w+)"?/g)].map(a => a[1]))
        .concat([...body.matchAll(/tagContent(?:Repeat)?HTML:\s*'([^']*)'/gi)].flatMap(t => [...t[1].matchAll(/\{([A-Za-z_]\w*)\}/g)].map(a => a[1])));
      const risky = attrs.filter(a => typed.has(a.toLowerCase()));
      const loosened = /sanitizationConfigFull:\s*'[^']+'/i.test(body);
      if (!risky.length && !(loosened && attrs.length)) continue;
      add('XSS01', false, `${d.QualifiedName} puts ${(risky.length ? risky : attrs).join(', ')} into an HTML Element as HTML (innerHTML), ` +
        `and a user types that text${loosened ? ' -- and the widget\'s sanitizer is loosened (sanitizationConfigFull)' : ''}: markup a user wrote runs in ` +
        "every reader's browser. Show it as text (tagContentMode: 'container' with a dynamictext), or clean it on save (CommunityCommons XSSanitize)" +
        (loosened ? ' and drop sanitizationConfigFull' : ''));
    }
  }

  // WRITE01
  // Set by a flow that runs without the user's rights: a microflow without @applyentityaccess. A
  // nanoflow runs in the browser and a microflow with @applyentityaccess applies the user's rules:
  // what they set needs the write right, so it is never this finding.
  const setByFlow = new Set(), setAsUser = new Set();
  for (const d of model.sources) {
    if (!/^(MICROFLOW|NANOFLOW)$/.test(d.ObjectType)) continue;
    const text = d.SourceText || '';
    const asUser = d.ObjectType === 'NANOFLOW' || /@applyentityaccess\b/i.test(text);
    for (const m of text.matchAll(/\b(?:change\s+\$\w+|create\s+[\w.]+)\s*\(([^;]*?)\)\s*;/gi)) {
      for (const a of m[1].matchAll(/"?(\w+)"?\s*=/g)) (asUser ? setAsUser : setByFlow).add(a[1].toLowerCase());
    }
  }
  const pagesOf = {};
  for (const [page, roles] of Object.entries(pageRoles)) for (const r of roles) (pagesOf[r] = pagesOf[r] || []).push(page);
  const pageText = {};
  for (const d of model.sources) if (d.ObjectType === 'PAGE' || d.ObjectType === 'SNIPPET') pageText[d.QualifiedName] = d.SourceText || '';
  const snippets = Object.keys(pageText).filter(n => model.sources.find(d => d.QualifiedName === n && d.ObjectType === 'SNIPPET'));
  const INPUTS = ['textbox', 'textarea', 'checkbox', 'radiobuttons', 'datepicker', 'combobox', 'dropdown', 'richtext', 'richtexteditor'];
  const inputsOf = {};
  const inputs = name => inputsOf[name] || (inputsOf[name] = new Set(INPUTS.flatMap(kind => widgetBodies(pageText[name] || '', kind))
    .map(body => (/\bAttribute:\s*"?(\w+)/i.exec(body) || [])[1]).filter(Boolean).map(a => a.toLowerCase())));
  const editable = (role, attr) => (pagesOf[role] || []).concat(snippets).some(p => inputs(p).has(attr.toLowerCase()));
  // Associations are left out: a page's "new" button sets one from its context, with no input on screen.
  // Non-persistent entities too: what the client writes there stays in its own session.
  const associations = new Set((model.associations || []).map(a => String(a.QualifiedName).split('.').pop().toLowerCase()));
  // WRITE01 is about attributes: the associations the role writes stay. A write (...) list drops what it
  // does not name, and a picker or a "new" button that sets one from its context turns read-only (B2B,
  // 2026-10-08: nine tests), so the finding names every association to keep in it.
  const writes = {}, keep = {};
  for (const p of model.permissions) {
    if (p.ElementType !== 'ENTITY' || p.AccessType !== 'MEMBER_WRITE' || !mine(p.ElementName) || !mine(p.ModuleRoleName) || !p.MemberName) continue;
    if (!persistent.has(p.ElementName)) continue;
    const attr = String(p.MemberName).split('.').pop();
    const key = p.ElementName + '|' + p.ModuleRoleName;
    if (associations.has(attr.toLowerCase())) {
      (keep[key] = keep[key] || []).push(attr);
      continue;
    }
    if (!setByFlow.has(attr.toLowerCase()) || setAsUser.has(attr.toLowerCase()) || editable(p.ModuleRoleName, attr)) continue;
    (writes[key] = writes[key] || []).push(attr);
  }
  for (const [key, attrs] of Object.entries(writes)) {
    const [entity, role] = key.split('|');
    const kept = keep[key] || [];
    add('WRITE01', false, `${role} may write ${entity}'s ${attrs.slice(0, 6).join(', ')}${attrs.length > 6 ? ', ...' : ''}, which no page lets it edit ` +
      'and only server-side flows set: through the client API it can set them itself. Leave them out of the rule\'s write list' +
      (kept.length ? ` -- and a write (...) list drops what it does not name, so keep in it the associations ${kept.join(', ')}: ` +
        'a picker or a "new" button that sets one turns read-only without it (a B2B session broke nine tests that way)' : ''));
  }

  // PWD01
  if (sec.minLength && (sec.minLength < 8 || !sec.digit || !sec.mixed || !sec.symbol)) {
    const missing = [sec.minLength < 8 ? 'at least 8 characters' : '', sec.digit ? '' : 'a digit', sec.mixed ? '' : 'mixed case', sec.symbol ? '' : 'a symbol'].filter(Boolean);
    add('PWD01', false, `the password policy does not require ${missing.join(', ')}: Mendix recommends its strong policy, the same in ` +
      'every environment. For the person: Studio Pro, App Security > Password policy. mxcli cannot change it -- leave it');
  }
  return out;
}

function readModel(appDir, mpr, read = mxcli) {
  const sources = read(appDir, mpr, 'SELECT QualifiedName, ModuleName, ObjectType, SourceText FROM CATALOG.SOURCE', true);
  if (!sources.length) throw new ModelReadError('the catalog holds no MDL source (refresh catalog full source)');
  const permissions = read(appDir, mpr, 'SELECT ModuleRoleName, ElementType, ElementName, MemberName, AccessType, XPathConstraint FROM CATALOG.PERMISSIONS', true);
  const constants = read(appDir, mpr, 'SELECT QualifiedName, ModuleName, DataType, DefaultValue, ExposedToClient FROM CATALOG.CONSTANTS', true);
  const associations = read(appDir, mpr, 'SELECT QualifiedName FROM CATALOG.ASSOCIATIONS', true);
  const security = projectSecurity(read(appDir, mpr, 'show project security;'));
  const moduleRoles = {};
  const userRoles = read(appDir, mpr, 'SHOW USER ROLES', true).map(r => r.Name).filter(Boolean);
  if (userRoles.length) {
    const text = read(appDir, mpr, userRoles.map(r => `DESCRIBE USER ROLE ${r};`).join(' '));
    for (const m of text.matchAll(/user\s+role\s+"?(\w+)"?\s*\(\s*ModuleRoles\s*:\s*\(([^)]*)\)/gi)) {
      moduleRoles[m[1]] = m[2].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    }
  }
  return { sources, permissions, constants, associations, security, moduleRoles };
}

function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  let mpr = '', refresh = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mpr') mpr = argv[++i] || '';
    else if (argv[i] === '--no-refresh') refresh = false;
    else positional.push(argv[i]);
  }
  if (positional.length < 2) { process.stderr.write('usage: security_rules.cjs app_dir Module... [--mpr copy.mpr] [--no-refresh]\n'); return 2; }
  const appDir = positional[0];
  const modules = positional.slice(1).flatMap(m => m.split(/\s+/)).filter(Boolean);
  if (!mpr) { try { mpr = fs.readdirSync(appDir).filter(n => /\.mpr$/i.test(n)).sort()[0] || ''; } catch { /* none */ } }
  else mpr = path.resolve(mpr);
  if (!mpr) { process.stdout.write(`ERROR no .mpr in ${appDir}\n`); return 2; }
  let model;
  try {
    if (refresh) mxcli(appDir, mpr, 'refresh catalog full source');
    model = readModel(appDir, mpr);
  } catch (error) {
    if (!(error instanceof ModelReadError)) throw error;
    process.stdout.write(`ERROR could not read the model -- ${error.message}\n`);
    return 2;
  }
  const found = findings(model, modules);
  const blocking = found.filter(f => f.blocking), warnings = found.filter(f => !f.blocking);
  const lines = [`${blocking.length ? 'FAIL' : 'PASS'}  ${blocking.length} security finding(s) block, ${warnings.length} warning(s)`];
  for (const f of blocking) lines.push(`  - [${f.code}] ${f.message}`);
  for (const f of warnings) lines.push(`  ~ [${f.code}] ${f.message}`);
  process.stdout.write(lines.join('\n') + '\n');
  return blocking.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { secretName, databaseSources, widgetBodies, projectSecurity, findings, readModel };
