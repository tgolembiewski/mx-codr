#!/usr/bin/env node
// SCOPE01: a page's data source microflow returns rows the page's role may not read.
//
// A microflow does not apply entity access to its own retrieves, so an access rule that scopes a
// role to its own rows by XPath (`grant Customer on Invoice (read *) where '[...CurrentUser...]'`)
// does not reach the rows a data source microflow hands to that role's page. A DeepSeek session's
// customer portal showed another customer's invoice that way; only its verify test caught it.
//
// Finding: page P is granted to role R and fills a widget from microflow M; M retrieves entity E
// from the database with no constraint that ties it to the user (neither '[%CurrentUser%]' nor an
// object variable such as `= $Customer`); and R's access rule on E carries an XPath constraint.
//
// Usage: check_scope.cjs <app_dir> <Module> [<Module> ...] [--json]
// Exit: 0 no finding, 1 findings, 2 the model could not be read.
'use strict';
const { levelArgs, levelOf } = require('./rulebook.cjs');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const py = require('./py_compat.cjs');
const { re } = py;

const DATASOURCE_RE = re.compile(String.raw`DataSource:\s*microflow\s+([A-Za-z_]\w*\.[A-Za-z_]\w*)`, 'i');
const PAGE_GRANT_RE = re.compile(String.raw`grant\s+view\s+on\s+page\s+\S+\s+to\s+([^;]+);`, 'i');
// A database retrieve: `retrieve $X from Mod.Entity ...;` -- not `from $Obj/Mod.Assoc`, which the
// object scopes already.
const RETRIEVE_RE = re.compile(String.raw`\bretrieve\s+\$\w+\s+from\s+([A-Za-z_]\w*\.[A-Za-z_]\w*)\b([^;]*);`, 'is');
// The rights may hold a member list, `(read (Number, Total))`: one level of nested brackets
// (2026-10-05: `\([^)]*\)` stopped at the inner bracket and such a rule was never counted as scoped).
const ENTITY_GRANT_RE = re.compile(String.raw`grant\s+(\S+)\s+on\s+(\S+)\s*\((?:[^()]|\([^()]*\))*\)\s*where\s+'`, 'i');
// mxcli 0.25 (`mdl 1`): `grant read * on entity Shop.Invoice to Shop.Customer, Shop.Clerk where [ … ]`.
const ENTITY_GRANT_V1_RE = re.compile(String.raw`grant\s+([^;]*?)\s+on\s+entity\s+(\S+)\s+to\s+([^;]*?)\s+where\s+\[`, 'i');

class ModelReadError extends Error {}

function mxcliBinary(appDir) {
  for (const name of ['mxcli', 'mxcli.exe']) if (py.exists(path.join(appDir, name))) return './' + name;
  return './mxcli';
}

// One MDL command's output: text, or the rows of its --json output.
function mxcli(appDir, mpr, command, asJson = false) {
  const args = ['-p', mpr, ...(asJson ? ['--json'] : []), '-c', command];
  const binary = mxcliBinary(appDir);
  const timeout = parseFloat(process.env.MDL_MXCLI_TIMEOUT || '120');
  const result = spawnSync(binary, args, { cwd: appDir, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 1 << 30, windowsHide: true });
  if (result.error) {
    let why;
    if (result.error.code === 'ETIMEDOUT') {
      why = `Command ${py.pyRepr([binary, ...args])} timed out after ${Number.isInteger(timeout) ? timeout.toFixed(1) : timeout} seconds`;
    } else if (result.error.code === 'ENOENT') {
      why = py.WIN ? '[WinError 2] The system cannot find the file specified' : `[Errno 2] No such file or directory: '${binary}'`;
    } else {
      why = result.error.message;
    }
    throw new ModelReadError(`\`${command}\` could not run: ${why}`);
  }
  const stdout = (result.stdout || '').replace(/\r\n?/g, '\n');
  const stderr = (result.stderr || '').replace(/\r\n?/g, '\n');
  if (result.status !== 0) {
    const why = py.splitlines(py.strip(stderr || stdout));
    throw new ModelReadError(`\`${command}\` exited ${result.status === null ? -1 : result.status}: ${why.length ? why[why.length - 1] : 'no output'}`);
  }
  if (!asJson) return stdout;
  let rows;
  try {
    rows = JSON.parse(stdout);
  } catch {
    throw new ModelReadError(`\`${command}\` did not return JSON`);
  }
  if (!Array.isArray(rows)) throw new ModelReadError(`\`${command}\` did not return a list`);
  return rows;
}

const qualified = row => py.pyStr(row['Qualified Name'] || row.QualifiedName || '');

// Entities a microflow retrieves from the database with nothing tying them to the user.
function unscopedRetrieves(text) {
  const entities = [];
  for (const [entity, rest] of RETRIEVE_RE.findall(text)) {
    if (rest.includes('CurrentUser') || re.search(String.raw`\$\w+`, rest)) continue;
    entities.push(entity);
  }
  return entities;
}

// Roles whose access rule on the entity carries an XPath constraint.
function scopedRoles(text, entity) {
  const roles = new Set(ENTITY_GRANT_RE.findall(text).filter(([, target]) => target === entity).map(([role]) => role));
  for (const [, target, named] of ENTITY_GRANT_V1_RE.findall(text)) {
    if (target === entity) for (const role of named.split(',')) roles.add(py.strip(role));
  }
  return roles;
}

function findings(appDir, mpr, modules, read = mxcli) {
  const flows = new Map();
  const entities = new Map();
  const found = [];
  for (const module of modules) {
    for (const row of read(appDir, mpr, `SHOW PAGES IN ${module}`, true)) {
      const page = qualified(row);
      if (!page) continue;
      const text = read(appDir, mpr, `DESCRIBE PAGE ${page}`);
      const sources = py.sorted([...new Set(DATASOURCE_RE.findall(text))]);
      if (!sources.length) continue;
      const roles = new Set();
      for (const group of PAGE_GRANT_RE.findall(text)) {
        for (const r of group.split(',')) if (py.strip(r)) roles.add(py.strip(r));
      }
      for (const flow of sources) {
        if (!flows.has(flow)) flows.set(flow, unscopedRetrieves(read(appDir, mpr, `DESCRIBE MICROFLOW ${flow}`)));
        for (const entity of flows.get(flow)) {
          if (!entities.has(entity)) entities.set(entity, read(appDir, mpr, `DESCRIBE ENTITY ${entity}`));
          const scoped = scopedRoles(entities.get(entity), entity);
          for (const role of py.sorted([...roles].filter(r => scoped.has(r)))) {
            found.push(
              `  - [SCOPE01] ${page} shows ${entity} through ${flow} to ${role}: ${role}'s access rule ` +
              `scopes ${entity} by XPath, but a microflow does not apply entity access, so ${flow} ` +
              'returns every row -- constrain its retrieve the same way (e.g. ' +
              "where [...Customer_Account = '[%CurrentUser%]'], or = $TheSignedInCustomer)");
          }
        }
      }
    }
  }
  return found;
}

const USAGE = 'usage: check_scope.cjs [-h] [--json] app_dir modules [modules ...]';
function parseArgs(argv) {
  const positional = [];
  let json = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    else positional.push(a);
  }
  if (positional.length < 2) {
    process.stderr.write(`${USAGE}\ncheck_scope.cjs: error: the following arguments are required: ${positional.length ? 'modules' : 'app_dir, modules'}\n`);
    process.exit(2);
  }
  return { appDir: positional[0], modules: positional.slice(1), json };
}

function main() {
  // --levels: the rulebook's level for SCOPE01 (tests/rulebook/app/SCOPE01.md); `block` fails the step
  // here, which until now tests/gate/steps.sh decided from MDL_SCOPE=error.
  const { levels, rest } = levelArgs(process.argv.slice(2));
  const level = levelOf(levels, 'SCOPE01', 'warn');
  const args = parseArgs(rest);
  let mprs = [];
  try {
    const rx = py.WIN ? /^.*\.mpr$/is : /^.*\.mpr$/s;
    mprs = py.sorted(fs.readdirSync(args.appDir).filter(n => rx.test(n)));
  } catch { /* no directory */ }
  if (!mprs.length) {
    process.stderr.write('FAIL  no .mpr in ' + args.appDir + '\n');
    return 2;
  }
  let found;
  try {
    found = findings(args.appDir, mprs[0], args.modules);
  } catch (error) {
    if (!(error instanceof ModelReadError)) throw error;
    py.print(`could not run -- ${error.message}`);
    return 2;
  }
  if (level === 'off') found = [];
  if (args.json) {
    py.print(py.jsonDumps({ findings: found }, { indent: 2 }));
  } else {
    py.print(`${found.length ? (level === 'block' ? 'FAIL' : 'WARN') : 'PASS'}  ${found.length} data source microflow finding(s)`);
    if (level !== 'info') for (const line of found) py.print(line);
  }
  return found.length ? 1 : 0;
}

// Advice is printed in the spelling of the mxcli the harness is pinned to (mdl1_spelling.cjs).
if (require.main === module) py.setOutputFilter(require('./mdl1_spelling.cjs').advice);
if (require.main === module) process.exitCode = main();
module.exports = { DATASOURCE_RE, PAGE_GRANT_RE, RETRIEVE_RE, ENTITY_GRANT_RE, ENTITY_GRANT_V1_RE, ModelReadError, mxcli, unscopedRetrieves, scopedRoles, findings, main };
