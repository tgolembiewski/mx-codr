#!/usr/bin/env node
// UNUSED01: a microflow, nanoflow, page, snippet, enumeration or Java action of the project's own
// modules that nothing uses.
//
// Over 34 local apps 67 such documents were left behind: data source microflows replaced by an
// XPath source (DS01), probes (TMP_ProbeB), a reset flow no button called, an enumeration of an
// abandoned design. They pass every check, cost a reader time, and drift from what the app does.
//
// A document is reported only when three proofs agree:
//   1. the model: no reference to it in mxcli's catalog (CATALOG.REFS -- calls, show page, data
//      sources, navigation, settings, scheduled events, published services ...), no attribute or
//      parameter of its enumeration type;
//   2. the text: its name appears in no other document's source or strings (a comment, an OQL
//      query, a caption), nor in javasource/ (proxies aside), javascriptsource/, theme/,
//      themesource/ or tests/*.test.* -- Java, JavaScript and tests can call a document by its
//      name (a test's `# covers:` line is not a use: it only declares what the test covers);
//   3. Mendix: the gate drops them all on a scratch copy and mx check must still report 0 errors
//      (tests/gate/checks.sh, check_unused). This file does proofs 1 and 2.
//
// Usage: check_unused.cjs <app_dir> <Module> [<Module> ...] [--keep Mod.Doc,Mod.Other] [--mpr <copy.mpr>] [--no-refresh]
// --mpr reads the model from a copy: the catalog is written beside the .mpr it reads, and the gate's
// suite refreshes the app's own catalog at the same time (tests/gate/tests.sh).
// Prints PASS/FAIL, one `  - [UNUSED01] ...` line per document, then `drop: <statement>` lines.
// Exit: 0 none, 1 findings, 2 the model could not be read.
'use strict';
const { levelArgs, levelOf } = require('./rulebook.cjs');
const { mxcli, ModelReadError, findMpr } = require('./mxcli_client.cjs');
const fs = require('fs');
const path = require('path');

// catalog table -> [kind as MDL spells it in `drop <kind>`, label]
const TABLES = {
  MICROFLOWS: 'microflow',
  NANOFLOWS: 'nanoflow',
  PAGES: 'page',
  SNIPPETS: 'snippet',
  ENUMERATIONS: 'enumeration',
  JAVA_ACTIONS: 'java action',
};

// Where a name in plain text can call a document: Java (Core.microflowCall("Mod.Flow")),
// JavaScript actions, the theme (login.html calls a nanoflow), and the project's tests -- under
// tests/ only *.test.* files: the harness's own scripts and docs there name example documents.
const TEXT_DIRS = ['javasource', 'javascriptsource', 'theme', 'themesource', 'tests'];
const SKIP_DIRS = new Set(['proxies', 'node_modules', '.git']);
const TEXT_FILE = /\.(java|js|mjs|cjs|ts|tsx|jsx|html?|s?css|json|xml|sh|mdl|md|txt|py|ya?ml)$/i;
const MAX_FILE = 2 * 1024 * 1024;
// A test's `# covers:` line (and the `#` lines under it holding only more names) declares what the
// test covers; the coverage check makes every page and ACT_ flow appear on one. It is not a use:
// counted as one, no page or ACT_ flow could ever be reported. What the test does with it counts.
// The same lines check_test_coverage.cjs reads (its QUALIFIED_LIST).
const QUALIFIED_LIST = String.raw`[\w.]+\.\w+(?:(?:[ \t]*,[ \t]*|[ \t]+)[\w.]+\.\w+)*[ \t]*,?`;
const COVERS_LINES = new RegExp(String.raw`^[ \t]*#[ \t]*covers[ \t]*:.*(?:\n[ \t]*#[ \t]*` + QUALIFIED_LIST + String.raw`[ \t]*$)*`, 'gim');

const shortName = name => name.split('.').pop();
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = name => new RegExp(`(^|[^\\w])${escape(name)}($|[^\\w])`);

// Proof 1: documents of `modules` no reference, attribute or parameter points at.
// tables: {refs: [{SourceName, TargetName}], attributes: [{EnumerationQualifiedName}],
//          parameters: [{ParameterType}], documents: {TABLE: [{QualifiedName, ModuleName}]}}
function unreferenced(tables, modules) {
  const used = new Set();
  for (const r of tables.refs) if (r.SourceName !== r.TargetName && r.TargetName) used.add(r.TargetName);
  for (const r of tables.attributes) if (r.EnumerationQualifiedName) used.add(r.EnumerationQualifiedName);
  for (const r of tables.parameters) {
    const t = (r.ParameterType || '').replace(/^(?:List of|Enumeration\(|enum)\s*/i, '').replace(/\)$/, '').trim();
    if (t) used.add(t);
  }
  const own = new Set(modules);
  const out = [];
  for (const [table, kind] of Object.entries(TABLES)) {
    for (const row of tables.documents[table] || []) {
      const name = row.QualifiedName || '';
      if (!name || !own.has(row.ModuleName) || used.has(name)) continue;
      out.push({ kind, name });
    }
  }
  return out;
}

// Every text file under the directories that can name a document, as [relative path, text].
function textFiles(appDir) {
  const files = [];
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(path.join(appDir, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel); continue; }
      if (!e.isFile() || !TEXT_FILE.test(e.name)) continue;
      if (rel.split(path.sep)[0] === 'tests' && !/\.test\./.test(e.name)) continue;
      try {
        if (fs.statSync(path.join(appDir, rel)).size > MAX_FILE) continue;
        let text = fs.readFileSync(path.join(appDir, rel), 'utf8');
        if (rel.split(path.sep)[0] === 'tests') text = text.replace(COVERS_LINES, '');
        files.push([rel.split(path.sep).join('/'), text]);
      } catch { /* unreadable: skip */ }
    }
  };
  for (const dir of TEXT_DIRS) walk(dir);
  return files;
}

// Proof 2: drop every candidate whose name another document or a file names. A Java action's own
// class (javasource/<module>/actions/<Name>.java) names it too, and does not count.
// sources: [{QualifiedName, SourceText}], strings: [{QualifiedName, StringValue}], files: [[rel, text]]
function namedElsewhere(candidates, sources, strings, files) {
  const kept = [];
  for (const c of candidates) {
    const re = wordRe(shortName(c.name));
    const module = c.name.split('.')[0].toLowerCase();
    const own = `javasource/${module}/actions/${shortName(c.name)}.java`.toLowerCase();
    const named = sources.some(r => r.QualifiedName !== c.name && re.test(r.SourceText || ''))
      || strings.some(r => r.QualifiedName !== c.name && re.test(r.StringValue || ''))
      || files.some(([rel, text]) => rel.toLowerCase() !== own && re.test(text));
    if (!named) kept.push(c);
  }
  return kept;
}

const dropStatement = c => `drop ${c.kind} ${c.name};`;

function findings(appDir, mpr, modules, { keep = [], refresh = true, read = mxcli, files = textFiles } = {}) {
  if (refresh) read(appDir, mpr, 'refresh catalog full source');
  const tables = {
    refs: read(appDir, mpr, 'SELECT SourceName, TargetName FROM CATALOG.REFS', true),
    attributes: read(appDir, mpr, 'SELECT EnumerationQualifiedName FROM CATALOG.ATTRIBUTES', true),
    parameters: read(appDir, mpr, 'SELECT ParameterType FROM CATALOG.MICROFLOW_PARAMETERS', true),
    documents: {},
  };
  for (const table of Object.keys(TABLES)) {
    tables.documents[table] = read(appDir, mpr, `SELECT QualifiedName, ModuleName FROM CATALOG.${table}`, true);
  }
  const kept = new Set(keep);
  let candidates = unreferenced(tables, modules).filter(c => !kept.has(c.name));
  if (!candidates.length) return [];
  const sources = read(appDir, mpr, 'SELECT QualifiedName, SourceText FROM CATALOG.SOURCE', true);
  const strings = read(appDir, mpr, 'SELECT QualifiedName, StringValue FROM CATALOG.STRINGS', true);
  // The catalog read no source at all: the text proof would pass everything. Not a pass.
  if (!sources.length) throw new ModelReadError('the catalog holds no MDL source (refresh catalog full source)');
  candidates = namedElsewhere(candidates, sources, strings, files(appDir));
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

const USAGE = 'usage: check_unused.cjs app_dir Module [Module ...] [--keep Mod.Doc,...] [--mpr copy.mpr] [--no-refresh]';

function parseArgs(argv) {
  const positional = [];
  let keep = [], refresh = true, mpr = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') keep = (argv[++i] || '').split(/[,\s]+/).filter(Boolean);
    else if (a === '--no-refresh') refresh = false;
    else if (a === '--mpr') mpr = argv[++i] || '';
    else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    else positional.push(a);
  }
  if (positional.length < 2) { process.stderr.write(USAGE + '\n'); process.exit(2); }
  // A module list may arrive as one argument, one name per line (zsh does not split $modules).
  return { appDir: positional[0], modules: positional.slice(1).flatMap(m => m.split(/\s+/)).filter(Boolean), keep, refresh, mpr };
}

function main() {
  // --levels / --except from the rulebook (tests/rulebook/UNUSED01.md): except: documents are kept
  // (the same as --keep), `off` skips the check, `warn` lists instead of blocking.
  const { levels, excepts, rest } = levelArgs(process.argv.slice(2));
  const level = levelOf(levels, 'UNUSED01', 'block');
  const args = parseArgs(rest);
  args.keep = (args.keep || []).concat(excepts.UNUSED01 || []);
  let mprs = args.mpr ? [path.resolve(args.mpr)] : [];
  if (!mprs.length && findMpr(args.appDir)) mprs = [findMpr(args.appDir)];
  if (!mprs.length || (args.mpr && !fs.existsSync(mprs[0]))) { process.stdout.write(`ERROR no .mpr in ${args.mpr || args.appDir}\n`); return 2; }
  let found;
  try {
    found = findings(args.appDir, mprs[0], args.modules, { keep: args.keep, refresh: args.refresh });
  } catch (error) {
    if (!(error instanceof ModelReadError)) throw error;
    process.stdout.write(`ERROR could not read the model -- ${error.message}\n`);
    return 2;
  }
  if (level === 'off') found = [];
  if (!found.length) { process.stdout.write('PASS  no unused document\n'); return 0; }
  const lines = [`${level === 'block' ? 'FAIL' : 'WARN'}  ${found.length} document(s) nothing uses`];
  if (level !== 'info') for (const c of found) {
    lines.push(`  ${level === 'block' ? '-' : '~'} [UNUSED01] ${c.kind} ${c.name}: nothing calls, shows or names it`);
  }
  for (const c of found) lines.push(`drop: ${dropStatement(c)}`);
  process.stdout.write(lines.join('\n') + '\n');
  return 1;
}

if (require.main === module) process.exitCode = main();
module.exports = { TABLES, ModelReadError, mxcli, unreferenced, namedElsewhere, textFiles, dropStatement, findings, main };
