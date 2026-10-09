#!/usr/bin/env node
// The catalog step: rules answered by mxcli's catalog tables on a copy of the project. UI001 and
// SEC007 were the two mxcli lint rules that blocked DONE, ported one to one from their Starlark
// (.claude/lint-rules); the gate does not run mxcli lint itself:
//   UI001   a data grid filtered by hand -- inputs bound to a non-persistent helper entity in a
//           module whose grid has no column filter (ui001_handrolled_grid_filter.star)
//   SEC007  an entity readable by anonymous users with no XPath constraint (DIVD-2022-00019;
//           sec_unconstrained_anon_read.star)
//   LINT01  mxcli's own lint advice: off unless the rulebook says warn or block, then
//           `mxcli lint --format json` runs here and its findings are listed at that level
//
// Usage: catalog_rules.cjs <app_dir> <Module>... [--mpr <copy.mpr>] [--no-refresh] [--levels json] [--except json]
// Prints `FAIL|WARN|PASS <summary>`, `  - [CODE] ...` blocking lines, `  ~ [CODE] ...` warnings.
// Exit 0 nothing blocking, 1 blocking findings, 2 the model could not be read.
'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');
const { mxcli, ModelReadError } = require('./check_unused.cjs');
const { readModel } = require('./security_rules.cjs');
const { levelArgs, levelOf } = require('./rulebook.cjs');

// The grid, and the filter widgets that belong inside its columns (the Starlark's constants).
const GRID_TYPES = new Set(['com.mendix.widget.web.datagrid.Datagrid']);
const FILTER_MARKERS = ['datagriddropdownfilter', 'datagriddatefilter', 'datagridtextfilter', 'datagridnumberfilter'];
const INPUT_TYPES = new Set(['Forms$CheckBox', 'Forms$DatePicker', 'Forms$TextBox', 'Forms$DropDown', 'Forms$RadioButtonGroup',
  'com.mendix.widget.web.combobox.Combobox']);
const MIN_INPUTS = 2;

const entityOfAttribute = ref => { const parts = String(ref || '').split('.'); return parts.length < 3 ? '' : parts.slice(0, -1).join('.'); };

// UI001: [{code, key, message}] -- one per module and helper entity, like the Starlark rule.
function handRolledGridFilter(widgets, entities) {
  const nonPersistent = new Set(entities.filter(e => /non[-_]?persistent/i.test(e.EntityType || e.Type || '')).map(e => e.QualifiedName));
  const grids = {}, filtersSeen = {}, helperInputs = {}, firstInput = {};
  for (const w of widgets) {
    const module = w.ModuleName;
    if (!module) continue;
    const type = w.WidgetType || '', lowered = type.toLowerCase();
    if (FILTER_MARKERS.some(m => lowered.includes(m))) filtersSeen[module] = true;
    if (GRID_TYPES.has(type)) { grids[module] = w; continue; }
    if (!INPUT_TYPES.has(type)) continue;
    const owner = entityOfAttribute(w.AttributeRef);
    if (!owner || !nonPersistent.has(owner)) continue;
    ((helperInputs[module] = helperInputs[module] || {})[owner] = helperInputs[module][owner] || []).push(w.Name);
    if (!firstInput[module + '|' + owner]) firstInput[module + '|' + owner] = w;
  }
  const out = [];
  for (const module of Object.keys(grids)) {
    if (filtersSeen[module]) continue;
    for (const [helper, names] of Object.entries(helperInputs[module] || {})) {
      if (names.length < MIN_INPUTS) continue;
      const w = firstInput[module + '|' + helper];
      out.push({ code: 'UI001', key: w.ContainerQualifiedName,
        message: `'${w.ContainerQualifiedName}' has ${names.length} hand-built filter input(s) bound to the non-persistent entity '${helper}' ` +
          `(${[...names].sort().slice(0, 4).join(', ')}), and data grid '${grids[module].Name}' in this module has no column filter. ` +
          'Put the filter in the column it belongs to and delete the helper entity, its apply microflow and the XPath that reads it: ' +
          'column colStatus (attribute: Status) { dropdownfilter fltStatus }, column colCreated (attribute: DateCreated) { datefilter fltCreated (FilterType: between) }, ' +
          'column colCustomer (attribute: Order_Customer/Name) { dropdownfilter fltCustomer (Association: Module.Order_Customer, datasource: database Module.Customer, CaptionAttribute: Name) }' });
    }
  }
  return out;
}

// SEC007: a READ rule with no XPath on a persistent entity, for a module role of the guest user role.
function anonymousUnconstrainedRead(model, entities) {
  const sec = model.security;
  if (!sec.guest || !sec.guestRole) return [];
  const anon = new Set(model.moduleRoles[sec.guestRole] || []);
  if (!anon.size) return [];
  const persistent = new Set(entities.filter(e => /^persistent$/i.test(e.EntityType || e.Type || '')).map(e => e.QualifiedName));
  const out = [], seen = new Set();
  for (const p of model.permissions) {
    if (p.ElementType !== 'ENTITY' || p.AccessType !== 'READ' || p.XPathConstraint || !anon.has(p.ModuleRoleName) || !persistent.has(p.ElementName)) continue;
    const key = p.ElementName + '|' + p.ModuleRoleName;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: 'SEC007', key: p.ElementName,
      message: `Entity '${p.ElementName}' is readable by anonymous users (via role '${p.ModuleRoleName}') with no XPath constraint — all rows exposed to unauthenticated users. ` +
        `(DIVD-2022-00019) Add an XPath constraint to the access rule for '${p.ModuleRoleName}', or remove the grant if this data should not be public.` });
  }
  return out;
}

// LINT01: mxcli lint's findings, each as one line, when the rulebook asks for them. The JSON (mxcli
// 0.25): {violations: [{ruleId, severity, message, module, document, documentType, suggestion}], summary}.
function lintFindings(appDir, mpr) {
  const bin = ['mxcli', 'mxcli.exe'].map(n => path.join(appDir, n)).find(p => fs.existsSync(p)) || 'mxcli';
  const result = spawnSync(bin, ['lint', '-p', mpr, '--format', 'json'], { cwd: appDir, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
  return parseLint(result.stdout || '');
}
function parseLint(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new ModelReadError('`mxcli lint --format json` printed no JSON');
  let parsed;
  try { parsed = JSON.parse(text.slice(start)); } catch { throw new ModelReadError('`mxcli lint --format json` printed no JSON'); }
  const list = Array.isArray(parsed) ? parsed : (parsed && parsed.violations) || [];
  return list.map(v => {
    const where = v.module ? `${v.module}.${v.document || ''}` : (v.document || '');
    return { code: 'LINT01', key: where, severity: String(v.severity || '').toLowerCase(),
      message: `[${v.ruleId || '?'}] ${v.message || ''}${where ? ` (at ${where})` : ''}${v.suggestion ? ` -- ${v.suggestion}` : ''}` };
  });
}

function main() {
  const { levels, excepts, rest: argv } = levelArgs(process.argv.slice(2));
  const positional = [];
  let mpr = '', refresh = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mpr') mpr = argv[++i] || '';
    else if (argv[i] === '--no-refresh') refresh = false;
    else positional.push(argv[i]);
  }
  if (positional.length < 2) { process.stderr.write('usage: catalog_rules.cjs app_dir Module... [--mpr copy.mpr] [--no-refresh] [--levels json] [--except json]\n'); return 2; }
  const appDir = positional[0];
  const modules = new Set(positional.slice(1).flatMap(m => m.split(/\s+/)).filter(Boolean));
  if (!mpr) { try { mpr = fs.readdirSync(appDir).filter(n => /\.mpr$/i.test(n)).sort()[0] || ''; } catch { /* none */ } }
  else mpr = path.resolve(mpr);
  if (!mpr) { process.stdout.write(`ERROR no .mpr in ${appDir}\n`); return 2; }
  const level = code => levelOf(levels, code, code === 'LINT01' ? 'off' : 'block');
  let found = [];
  try {
    if (refresh) mxcli(appDir, mpr, 'refresh catalog full source');
    const entities = mxcli(appDir, mpr, 'SELECT QualifiedName, ModuleName, EntityType FROM CATALOG.ENTITIES', true);
    if (level('UI001') !== 'off') {
      const widgets = mxcli(appDir, mpr, 'SELECT Name, WidgetType, AttributeRef, ContainerQualifiedName, ContainerType, ModuleName FROM CATALOG.WIDGETS', true);
      found.push(...handRolledGridFilter(widgets.filter(w => modules.has(w.ModuleName)), entities));
    }
    if (level('SEC007') !== 'off') found.push(...anonymousUnconstrainedRead(readModel(appDir, mpr), entities.filter(e => modules.has(e.ModuleName))));
    if (level('LINT01') !== 'off') found.push(...lintFindings(appDir, mpr));
  } catch (error) {
    if (!(error instanceof ModelReadError)) throw error;
    process.stdout.write(`ERROR could not read the model -- ${error.message}\n`);
    return 2;
  }
  found = found.filter(f => !(excepts[f.code] || []).includes(f.key || ''));
  // LINT01 at `warn` lists every lint finding as a warning; at `block` lint's own errors block.
  const blocking = found.filter(f => level(f.code) === 'block' && (f.code !== 'LINT01' || f.severity === 'error'));
  const warnings = found.filter(f => !blocking.includes(f) && level(f.code) !== 'info');
  const lines = [`${blocking.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS'}  ${blocking.length} catalog finding(s) block, ${warnings.length} warning(s)`];
  for (const f of blocking) lines.push(`  - [${f.code}] ${f.message}`);
  for (const f of warnings) lines.push(`  ~ [${f.code}] ${f.message}`);
  process.stdout.write(lines.join('\n') + '\n');
  return blocking.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { handRolledGridFilter, anonymousUnconstrainedRead, parseLint };
