#!/usr/bin/env node
// The testable paths of a model, and whether a test walks each one. Every path comes from the model
// itself, so it holds for any app, whatever it does and whatever its documents are called:
//
//   OUTCOME01  every message a user can be shown (outcome_rules.cjs) is asserted by a test
//   WF01       a microflow completes a workflow user task without checking the user is one of its
//              targets: anyone allowed to run it decides the task
//   WF02       each workflow user task: every outcome is chosen in a test, and a test of it signs in
//              as two users (the one who starts the flow and the one who decides)
//   ISO01      each role that reads an entity through an XPath constraint (row-level access): a test
//              signs in as a user with that role and reads that entity
//   ROLE01     each demo user's role is the user of some test
//   SVC01      each published REST or OData service is called by a test
//
// Only the tests the gate runs count (tests/verify-*.test.sh), and only outside comment lines: a `# covers:` line, or a comment
// quoting a message, walks nothing. A test signs in as a demo user when its text names that user
// (TEST_USER=, sign_in_as('...'), a login form fill).
//
// Old documents do not block: --baseline names a file of {key: hash} from the model as it was when
// the harness was installed (--write-baseline writes it). A finding on a key that is new or changed
// since then fails; one on an unchanged key is a warning, the backlog to clear. No baseline file:
// every finding fails. MDL_UNTESTED (keys, comma-separated) is the person's list of paths that are
// deliberately left without a test.
//
// Usage: check_paths.cjs <app_dir> <Module>... [--mpr <copy.mpr>] [--baseline <file>]
//          [--write-baseline <file>] [--untested Key,Key] [--no-refresh] [--all-fail]
// WF01 is a defect, not a missing test, and blocks whatever the baseline says. Only the installer
// writes the baseline; the guard refuses a session that writes it or runs --write-baseline.
// Prints PASS/FAIL, `  - [CODE] ...` failures, `  ~ [CODE] ...` warnings. Exit 0, 1 findings, 2 broken.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mxcli, ModelReadError, findMpr, moduleRolesOf } = require('./mxcli_client.cjs');
const { levelArgs, levelOf } = require('./rulebook.cjs');
const rules = require('./outcome_rules.cjs');

// A document's version, without its folder: a move (FOLDER01) changes where it is, not what it does,
// and once counted every moved flow as changed -- seven old paths turned into blocking ones (B2B, 2026-10-08).
const withoutFolder = text => String(text || '').replace(/\bfolder\s*:?\s*'(?:[^']|'')*'\s*,?/gi, '');
const hash = text => crypto.createHash('sha1').update(withoutFolder(text)).digest('hex').slice(0, 12);
const short = name => String(name).split('.').pop();

// Everything the rules read, from mxcli's catalog and security listings.
function readModel(appDir, mpr, read = mxcli) {
  const sources = read(appDir, mpr, 'SELECT QualifiedName, ModuleName, ObjectType, SourceText FROM CATALOG.SOURCE', true);
  if (!sources.length) throw new ModelReadError('the catalog holds no MDL source (refresh catalog full source)');
  const permissions = read(appDir, mpr, "SELECT ModuleRoleName, ElementName, XPathConstraint FROM CATALOG.PERMISSIONS WHERE AccessType = 'READ'", true);
  const restServices = read(appDir, mpr, 'SELECT QualifiedName, ModuleName, Path FROM CATALOG.PUBLISHED_REST_SERVICES', true);
  const odataServices = read(appDir, mpr, 'SELECT QualifiedName, ModuleName, Path FROM CATALOG.ODATA_SERVICES', true);
  const demoUsers = read(appDir, mpr, 'SHOW DEMO USERS', true).map(r => ({
    name: r['User Name'] || r.UserName || r.Name || '',
    roles: String(r['User Roles'] || r.UserRoles || '').split(/[,\s]+/).filter(Boolean),
  })).filter(u => u.name);
  const moduleRoles = moduleRolesOf(appDir, mpr, read);
  return { sources, permissions, restServices, odataServices, demoUsers, moduleRoles };
}

// The tests as the rules see them: [{name, text (comments out, lower case), users: Set}].
function readTests(files, demoUsers) {
  return files.map(([name, raw]) => {
    const kept = raw.split(/\r?\n/).filter(line => { const t = line.trim(); return !(/^(#|--|\/\/)/.test(t) && !t.startsWith('#!')); }).join('\n');
    const users = new Set(demoUsers.filter(u => new RegExp(`(^|[^\\w])${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`).test(kept)).map(u => u.name));
    return { name, raw: kept, text: kept.toLowerCase(), tokens: tokens(kept), corpus: rules.testCorpus([[name, kept]]), users };
  });
}

// Workflow user tasks from a workflow's source: [{name, caption, page, outcomes: [...]}].
function userTasks(source) {
  const out = [];
  const re = /user\s+task\s+(\w+)\s+'((?:[^']|'')*)'([\s\S]*?)outcomes([\s\S]*?);/gi;
  for (const m of source.matchAll(re)) {
    const page = /\bpage\s+([\w.]+)/i.exec(m[3]);
    const outcomes = [...m[4].matchAll(/'((?:[^']|'')*)'\s*\{/g)].map(o => o[1].replace(/''/g, "'"));
    out.push({ name: m[1], caption: m[2].replace(/''/g, "'"), page: page ? page[1] : '', outcomes });
  }
  return out;
}

// Words of a text, with identifiers taken apart: ApprovalTask_RejectButton is approval task reject
// button. A widget named after an outcome, as NAME02 names them, chooses that outcome.
const tokens = text => ' ' + (String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ') + ' ';

// All findings: [{code, key, version, message}]. key + version decide old (warning) or new (failure).
function findings(model, tests, modules) {
  const own = new Set(modules);
  const ownDocs = model.sources.filter(d => own.has(d.ModuleName));
  const out = [];
  const all = tests.map(t => t.corpus).join(' ');

  // OUTCOME01
  const list = rules.outcomes(model.sources, modules);
  for (const o of rules.untested(list, all)) {
    const doc = model.sources.find(d => d.QualifiedName === o.document);
    out.push({ code: 'OUTCOME01', key: o.document, version: hash(doc && doc.SourceText),
      message: `${o.document} can show "${o.text}" (${o.kind}) and no test asserts it: walk the path that shows it and assert at least four words of it (or all of a shorter one), e.g. await_message(/${(rules.words(o.text).slice(0, 4).join(' ') || o.text).replace(/\//g, '\\/')}/i)` });
  }

  // WF01
  for (const d of ownDocs.filter(d => /^(MICROFLOW|NANOFLOW)$/.test(d.ObjectType))) {
    const src = d.SourceText || '';
    if (!/\bset\s+task\s+outcome\b|\bcomplete\s+user\s+task\b/i.test(src)) continue;
    if (/TargetUsers/i.test(src)) continue;
    out.push({ code: 'WF01', key: d.QualifiedName, version: hash(src),
      message: `${d.QualifiedName} completes a workflow user task without checking that the signed-in user is one of the task's targets: everyone allowed to run it decides the task, whoever the workflow asked. Before \`set task outcome\`, retrieve the task's System.WorkflowUserTask_TargetUsers and refuse (a message, then return) when [%CurrentUser%] is not among them; grant it only to the roles the task targets` });
  }

  // WF02
  for (const d of ownDocs.filter(d => d.ObjectType === 'WORKFLOW')) {
    for (const task of userTasks(d.SourceText || '')) {
      const has = (t, name) => { const w = tokens(name).trim(); return !!w && t.tokens.includes(' ' + w + ' '); };
      const about = tests.filter(t => (task.page && has(t, short(task.page))) || has(t, task.caption) || task.outcomes.some(o => has(t, o)));
      const unchosen = task.outcomes.filter(o => !about.some(t => has(t, o)));
      const twoUsers = about.some(t => t.users.size >= 2);
      const key = `${d.QualifiedName}/${task.name}`;
      if (unchosen.length) {
        out.push({ code: 'WF02', key, version: hash(d.SourceText),
          message: `workflow ${d.QualifiedName}, user task ${task.name} ('${task.caption}'): no test chooses its outcome(s) ${unchosen.map(o => `'${o}'`).join(', ')} -- each outcome is a path: one test per outcome, asserting what it leads to` });
      }
      if (!twoUsers) {
        out.push({ code: 'WF02', key: key + '#users', version: hash(d.SourceText),
          message: `workflow ${d.QualifiedName}, user task ${task.name} ('${task.caption}'): no test of it signs in as two users -- start the flow as one demo user, then sign_in_as() the user it targets, decide, and come back to assert what the first user sees` });
      }
    }
  }

  // ISO01
  const usersWith = role => model.demoUsers.filter(u => u.roles.some(r => (model.moduleRoles[r] || []).includes(role)));
  for (const p of model.permissions) {
    if (!p.XPathConstraint || !own.has(String(p.ElementName).split('.')[0]) || !own.has(String(p.ModuleRoleName).split('.')[0])) continue;
    const holders = usersWith(p.ModuleRoleName).map(u => u.name);
    if (!holders.length) continue;   // no demo user to test it with: the security check's matter
    const entity = short(p.ElementName);
    const ok = tests.some(t => holders.some(h => t.users.has(h)) && t.tokens.includes(' ' + tokens(entity).trim() + ' '));
    if (!ok) {
      out.push({ code: 'ISO01', key: `${p.ElementName}|${p.ModuleRoleName}`, version: hash(p.XPathConstraint),
        message: `${p.ModuleRoleName} reads ${p.ElementName} only where ${p.XPathConstraint}: no test signs in as ${holders.join(' or ')} and reads ${entity} -- prove both sides, one of the user's own rows is there and another user's row is not (oql_count as that user, or the API the role reads through)` });
    }
  }

  // ROLE01
  const usedRoles = new Set();
  for (const u of model.demoUsers) if (tests.some(t => t.users.has(u.name))) u.roles.forEach(r => usedRoles.add(r));
  const byRole = {};
  for (const u of model.demoUsers) for (const r of u.roles) (byRole[r] = byRole[r] || []).push(u.name);
  for (const [role, users] of Object.entries(byRole)) {
    if (usedRoles.has(role)) continue;
    out.push({ code: 'ROLE01', key: `role:${role}`, version: hash(users.join(',')),
      message: `no test signs in as a ${role} (${users.join(', ')}): every role has a journey -- what it sees, and what it is refused` });
  }

  // SVC01
  for (const s of [...model.restServices, ...model.odataServices]) {
    if (!own.has(s.ModuleName) || !s.Path) continue;
    const p = String(s.Path).replace(/^\/+|\/+$/g, '').toLowerCase();
    if (tests.some(t => t.text.includes(p))) continue;
    out.push({ code: 'SVC01', key: s.QualifiedName, version: hash(s.Path),
      message: `the published service ${s.QualifiedName} (/${p}) is called by no test: call each operation as a user who may, assert the answer, and call it once without signing in (refused)` });
  }
  return out;
}

const USAGE = 'usage: check_paths.cjs app_dir Module... [--mpr copy.mpr] [--baseline file] [--write-baseline file] [--untested Key,...] [--no-refresh] [--all-fail]';

function parseArgs(argv) {
  const a = { positional: [], mpr: '', baseline: '', writeBaseline: '', untested: [], refresh: true, allFail: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--mpr') a.mpr = argv[++i] || '';
    else if (x === '--baseline') a.baseline = argv[++i] || '';
    else if (x === '--write-baseline') a.writeBaseline = argv[++i] || '';
    else if (x === '--untested') a.untested = (argv[++i] || '').split(/[,\s]+/).filter(Boolean);
    else if (x === '--no-refresh') a.refresh = false;
    else if (x === '--all-fail') a.allFail = true;
    else if (x === '-h' || x === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    else a.positional.push(x);
  }
  if (a.positional.length < 2) { process.stderr.write(USAGE + '\n'); process.exit(2); }
  a.appDir = a.positional[0];
  a.modules = a.positional.slice(1).flatMap(m => m.split(/\s+/)).filter(Boolean);
  return a;
}

// {key: version} of everything the rules would look at, for --write-baseline.
function baselineOf(model, modules) {
  const own = new Set(modules);
  const out = {};
  for (const d of model.sources) if (own.has(d.ModuleName)) out[d.QualifiedName] = hash(d.SourceText);
  for (const d of model.sources.filter(d => d.ObjectType === 'WORKFLOW' && own.has(d.ModuleName))) {
    for (const t of userTasks(d.SourceText || '')) { out[`${d.QualifiedName}/${t.name}`] = hash(d.SourceText); out[`${d.QualifiedName}/${t.name}#users`] = hash(d.SourceText); }
  }
  for (const p of model.permissions) if (p.XPathConstraint) out[`${p.ElementName}|${p.ModuleRoleName}`] = hash(p.XPathConstraint);
  const byRole = {};
  for (const u of model.demoUsers) for (const r of u.roles) (byRole[r] = byRole[r] || []).push(u.name);
  for (const [r, users] of Object.entries(byRole)) out[`role:${r}`] = hash(users.join(','));
  for (const s of [...model.restServices, ...model.odataServices]) out[s.QualifiedName] = hash(s.Path);
  return out;
}

function main() {
  // --levels / --except from the rulebook (tests/rulebook/): `block` on a code is today's --all-fail
  // for it, `warn` keeps the baseline behaviour, `off` skips it; except: keys join --untested.
  const { levels, excepts, rest } = levelArgs(process.argv.slice(2));
  const a = parseArgs(rest);
  for (const keys of Object.values(excepts)) a.untested.push(...keys);
  let mpr = a.mpr ? path.resolve(a.mpr) : '';
  if (!mpr) mpr = findMpr(a.appDir);
  if (!mpr || (a.mpr && !fs.existsSync(mpr))) { process.stdout.write(`ERROR no .mpr in ${a.mpr || a.appDir}\n`); return 2; }
  let model;
  try {
    if (a.refresh) mxcli(a.appDir, mpr, 'refresh catalog full source');
    model = readModel(a.appDir, mpr);
  } catch (error) {
    if (!(error instanceof ModelReadError)) throw error;
    process.stdout.write(`ERROR could not read the model -- ${error.message}\n`);
    return 2;
  }
  if (a.writeBaseline) {
    fs.mkdirSync(path.dirname(a.writeBaseline), { recursive: true });
    fs.writeFileSync(a.writeBaseline, JSON.stringify(baselineOf(model, a.modules), null, 1) + '\n');
    process.stdout.write(`PASS  baseline written: ${a.writeBaseline}\n`);
    return 0;
  }
  const tests = readTests(rules.testFiles(a.appDir), model.demoUsers);
  let baseline = null;
  if (a.baseline) { try { baseline = JSON.parse(fs.readFileSync(a.baseline, 'utf8')); } catch { baseline = null; } }
  const skip = new Set(a.untested);
  const failures = [], warnings = [];
  for (const f of findings(model, tests, a.modules)) {
    if (skip.has(f.key) || skip.has(f.key.split('#')[0])) continue;
    const level = levelOf(levels, f.code, f.code === 'WF01' ? 'block' : 'baseline');
    if (level === 'off' || level === 'info') continue;
    // A task anyone can decide is a defect, not a missing test: WF01 blocks whatever its age.
    // `baseline` (the default): old paths warn, new or changed ones block; `block`: every one blocks.
    const old = level === 'baseline' && !a.allFail && f.code !== 'WF01' && baseline && baseline[f.key] === f.version;
    (old || level === 'warn' ? warnings : failures).push(f);
  }
  const lines = [failures.length
    ? `FAIL  ${failures.length} finding(s) block (new or changed since the harness was installed, or WF01), ${warnings.length} older path(s) without a test`
    : `PASS  every new path has a test, ${warnings.length} older path(s) without one`];
  for (const f of failures) lines.push(`  - [${f.code}] ${f.message}`);
  for (const f of warnings) lines.push(`  ~ [${f.code}] ${f.message}`);
  process.stdout.write(lines.join('\n') + '\n');
  return failures.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { tokens, readModel, readTests, userTasks, findings, baselineOf, hash };
