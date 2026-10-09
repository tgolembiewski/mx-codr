// gate_helpers duplicate-definitions (SCRIPT01) and test-first (TEST01): what MDL scripts create.
'use strict';
const fs = require('fs');
const py = require('./py_compat.cjs');
const { re } = py;
const { or, readReplace, abspath } = require('./gate_values.cjs');

const DEFINITION_RE = re.compile(
  String.raw`^[ \t]*create\s+(?:or\s+(?:modify|replace)\s+)?(?:(?:persistent|non-persistent|view|external)\s+)?` +
  String.raw`(?P<kind>page|snippet|layout|microflow|nanoflow|entity|enumeration|workflow|menu|constant)\s+` +
  String.raw`(?P<name>[\w"]+\.[\w"]+)`, 'im');

// Map of 'kind\0name' -> [kind, name] a script creates.
function definitions(file) {
  const found = new Map();
  let text;
  try {
    text = readReplace(file);
  } catch {
    return found;
  }
  for (const m of DEFINITION_RE.finditer(text)) {
    const kind = m.group('kind').toLowerCase(), name = m.group('name').split('"').join('');
    found.set(kind + '\0' + name, [kind, name]);
  }
  return found;
}

// TEST01: test first. A page or ACT_ microflow these scripts create that the model does not have
// yet, and that no `# covers:` line of tests/verify-*.test.sh names: one per line. The tests came
// last in every session so far -- the skill says test first, the gate checks coverage only at the
// end, and a session built the whole app, then wrote six tests in one go, three of which had never
// failed (InvoiceChaseCodr, 2026-10-05). Blocking the exec here makes the test come before the page,
// when the script that names its widgets is already written. A document that is already in the
// model (a fix to it) passes; so does anything the model cannot be read for -- never a false block.
function testFirst(args) {
  const [app, mpr, ...scripts] = args;
  const wanted = [];
  for (const script of scripts) {
    for (const [kind, name] of definitions(script).values()) {
      const leaf = name.split('.').pop();
      if (kind === 'page' || (kind === 'microflow' && leaf.startsWith('ACT_'))) wanted.push([kind, name]);
    }
  }
  if (!wanted.length) return 0;
  const coverage = require('./check_test_coverage.cjs');
  let every, own, existing, claims;
  try {
    [every, own] = coverage.projectModules(app, mpr);
    existing = new Set([...coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW PAGES')),
      ...coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW MICROFLOWS'))]);
    claims = coverage.covered(py.join(app, 'tests'));
  } catch {
    return 0;
  }
  const seen = new Set();
  for (const [kind, name] of wanted) {
    const module = name.split('.')[0];
    // The project's own modules, or one these scripts create: never a Marketplace module or System.
    // MyFirstModule counts as the project's: projectModules() leaves the template out for coverage,
    // and a session that built its whole screen there walked past this check (Qwen 3.6 Splash,
    // InvoiceChase2, 2026-10-06).
    if (every.has(module) && !own.includes(module) && module !== 'MyFirstModule') continue;
    if (existing.has(name) || claims.has(name) || seen.has(name)) continue;
    seen.add(name);
    py.print(`  - ${kind} ${name}`);
  }
  return 0;
}

// SCRIPT01: a document two scripts create is whatever the last one run says.
// The kinds mxcli 0.25 can patch with `alter <kind>`; a constant or a menu it cannot.
const ALTERABLE = new Set(['entity', 'enumeration', 'page', 'snippet', 'microflow', 'nanoflow', 'workflow']);
function duplicateDefinitions(scripts) {
  const reported = new Set();
  for (const script of scripts) {
    const own = definitions(script);
    if (!own.size) continue;
    const folder = py.dirname(script) || '.';
    // Only the owner scripts in mdlsource/: a one-off elsewhere (tools/once/) is history once it ran,
    // and an older one-off that created the same flow blocked every repair after it -- three times in
    // one InvoiceChase session (2026-10-09). Overwriting newer work is STALE01's to catch.
    if (py.basename(abspath(folder)) !== 'mdlsource') continue;
    const names = fs.readdirSync(folder).sort(py.compare);
    for (const other of names) {
      const file = py.join(folder, other);
      if (!other.endsWith('.mdl') || abspath(file) === abspath(script)) continue;
      const theirs = definitions(file);
      const both = [...own.entries()].filter(([k]) => theirs.has(k)).map(([, v]) => v);
      both.sort((a, b) => py.compare(a[0], b[0]) || py.compare(a[1], b[1]));
      for (const [kind, name] of both) {
        const pair = [abspath(script), abspath(file)].sort(py.compare);
        const key = [kind, name, ...pair].join('\0');
        if (reported.has(key)) continue;
        reported.add(key);
        py.print(`  - ${kind} ${name} is created in ${script} and in ${file}: whichever runs last decides what the ${kind} is, and ` +
          're-running the other silently undoes it. Keep ONE `create` of it, in one script, and ' +
          (ALTERABLE.has(kind) ? `change it there (or with \`alter ${kind}\`).`
            : `change it there and exec that script again -- mxcli has no \`alter ${kind}\`.`));
      }
    }
  }
  return 0;
}

// The lines a --watch boot writes, in the order they can follow one another.

module.exports = { DEFINITION_RE, definitions, testFirst, ALTERABLE, duplicateDefinitions };
