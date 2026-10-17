// What gate_helpers.cjs's script subcommands read in MDL scripts: duplicate-definitions (SCRIPT01),
// widget-names (NAME02), captions (CAPTION01-07), test-first (TEST01), new-features (REQ01),
// unanchored-features (REQ03), near-icons and error-sources.
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
// The pages and ACT_ microflows these scripts create that the model does not have yet, in the
// project's own modules: [[kind, name]...], or null when the model cannot be read (never a false block).
function newFeatures(app, mpr, scripts, coverage = require('./check_test_coverage.cjs')) {
  const wanted = [];
  for (const script of scripts) {
    for (const [kind, name] of definitions(script).values()) {
      const leaf = name.split('.').pop();
      if (kind === 'page' || (kind === 'microflow' && leaf.startsWith('ACT_'))) wanted.push([kind, name]);
    }
  }
  if (!wanted.length) return [];
  let every, own, existing;
  try {
    [every, own] = coverage.projectModules(app, mpr);
    existing = new Set([...coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW PAGES')),
      ...coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW MICROFLOWS'))]);
  } catch {
    return null;
  }
  const seen = new Set();
  return wanted.filter(([, name]) => {
    const module = name.split('.')[0];
    // The project's own modules, or one these scripts create: never a Marketplace module or System.
    // MyFirstModule counts as the project's: projectModules() leaves the template out for coverage,
    // and a session that built its whole screen there walked past this check (Qwen 3.6 Splash,
    // InvoiceChase2, 2026-10-06).
    if (every.has(module) && !own.includes(module) && module !== 'MyFirstModule') return false;
    if (existing.has(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function testFirst(args) {
  const [app, mpr, ...scripts] = args;
  const coverage = require('./check_test_coverage.cjs');
  const fresh = newFeatures(app, mpr, scripts, coverage);
  if (!fresh || !fresh.length) return 0;
  let claims;
  try {
    claims = coverage.covered(py.join(app, 'tests'));
  } catch {
    return 0;
  }
  for (const [kind, name] of fresh) if (!claims.has(name)) py.print(`  - ${kind} ${name}`);
  return 0;
}

// REQ01: the first page or ACT_ microflow of an app waits for the requirements. B2B part 1
// (InvoiceB2BG1, 2026-10-12): the session never opened the interview, built the whole app, and after
// a warning captured seven requirements for a nine-section request -- the dates and amounts it
// asked for in DD/MM/YYYY and with a thousands separator were in none, so no test asked for them and
// the gate said DONE. Prints what these scripts would add; the caller decides whether the plan is empty.
// Only while the app has no page of its own yet: an app that grew without a brain gets the after-exec
// warning instead, not a block on its next page.
function newFeaturesCommand(args) {
  const [app, mpr, ...scripts] = args;
  const coverage = require('./check_test_coverage.cjs');
  const fresh = newFeatures(app, mpr, scripts, coverage);
  if (!fresh || !fresh.length) return 0;
  try {
    const own = coverage.projectModules(app, mpr)[1];
    const pages = coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW PAGES'));
    if ([...pages].some(name => own.includes(name.split('.')[0]))) return 0;
  } catch {
    return 0;
  }
  for (const [kind, name] of fresh) py.print(`  - ${kind} ${name}`);
  return 0;
}

// REQ03: a later request's new page or ACT_ microflow is anchored by one of its requirements. The
// first build records its requirements (REQ01); a later request did not, so what it asked for and did
// not build left no trace for the next session: a B2B run with a fresh session per part skipped the
// payment-reminder agent of part 4 and nothing showed it as open (2026-10-15). Prints the new pages and
// ACT_ microflows that no requirement in docs/brain/plan/ (or the staged queue) names with @, once the
// app has pages of its own and its plan has requirements; the caller blocks on any line.
function unanchoredFeaturesCommand(args) {
  const [app, mpr, ...scripts] = args;
  const coverage = require('./check_test_coverage.cjs');
  const plan = py.join(app, 'docs', 'brain', 'plan');
  let anchors = '';
  try {
    for (const file of fs.readdirSync(plan)) if (file.endsWith('.md')) anchors += fs.readFileSync(py.join(plan, file), 'utf8') + '\n';
  } catch {
    return 0;
  }
  if (!/^## /m.test(anchors)) return 0;
  try { anchors += fs.readFileSync(py.join(app, '.mxcli', 'brain', 'staged.jsonl'), 'utf8'); } catch { /* no queue */ }
  const fresh = newFeatures(app, mpr, scripts, coverage);
  if (!fresh || !fresh.length) return 0;
  try {
    const own = coverage.projectModules(app, mpr)[1];
    const pages = coverage.qualifiedNames(coverage.mxcliJson(app, mpr, 'SHOW PAGES'));
    if (![...pages].some(name => own.includes(name.split('.')[0]))) return 0;   // the first build: REQ01's
  } catch {
    return 0;
  }
  const named = name => new RegExp('@' + name.replace(/\./g, '\\.') + '(?![\\w.])').test(anchors);
  for (const [kind, name] of fresh) if (!named(name)) py.print(`  - ${kind} ${name}`);
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

// The icons of a collection closest to a name that is not in it, from `describe icon collection`
// on stdin: a session guessed "chart-bar", "user-badge" and "shopping-bag" in Atlas_Filled and was
// refused three times, each time told only that the name does not exist (InvoiceB2BG1, 2026-10-12).
// Words shared with the guess count most, then a guess word inside an icon word ("chart" in
// "analytics-graph-bar" does not match; "bar" does). At most six, best first; none when nothing is near.
function nearIcons(name, listing) {
  const icons = [...new Set([...String(listing).matchAll(/^\|\s*([A-Za-z0-9][\w-]*)\s*\|/gm)].map(m => m[1]))]
    .filter(icon => icon !== 'Icon');
  const words = t => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const want = words(name);
  const scored = icons.map(icon => {
    const have = words(icon);
    let score = 0;
    for (const w of want) {
      if (have.includes(w)) score += 3;
      else if (w.length >= 3 && have.some(h => h.startsWith(w) || w.startsWith(h) && h.length >= 3)) score += 1;
    }
    return [score, icon];
  }).filter(([score]) => score > 0);
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || (a[1] < b[1] ? -1 : 1));
  return scored.slice(0, 6).map(([, icon]) => icon);
}

function nearIconsCommand(args) {
  const listing = fs.readFileSync(0, 'utf8');
  py.print(nearIcons(args[0] || '', listing).join(' '));
  return 0;
}

// Where each build error sits in the scripts: mxbuild names the activity or widget ("Error(s) in
// expression." at Change variable activity 'Write the buyer block') but never the expression, and a
// session read the script back to find it, error after error -- CE0117 eleven times in one run
// (InvoiceB2BG2, 2026-10-12). For each error line on stdin, the first script line naming it: a
// `@caption '<name>'` with the statement under it, or the widget or document of that name.
function errorSources(scripts, errors) {
  const files = scripts.map(script => {
    try { return [script, fs.readFileSync(script, 'utf8').split(/\r?\n/)]; } catch { return [script, []]; }
  });
  const out = [], seen = new Set();
  for (const error of String(errors).split(/\r?\n/)) {
    const m = /\] .* at [^']*'([^']+)'/.exec(error);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const name = m[1], quoted = "'" + name.replace(/'/g, "''") + "'";
    const word = new RegExp('(^|[^\\w.])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\w]|$)');
    found: for (const [script, lines] of files) {
      for (let n = 0; n < lines.length; n++) {
        const line = lines[n];
        const caption = /^\s*@caption\s/i.test(line) && line.includes(quoted);
        if (!caption && !(/\w/.test(name) && !name.includes(' ') && word.test(line))) continue;
        let shown = `     ${script}:${n + 1}: ${line.trim()}`;
        if (caption) {
          let k = n + 1;
          while (k < lines.length && (!lines[k].trim() || /^\s*@/.test(lines[k]))) k++;
          if (k < lines.length) shown += `\n     ${script}:${k + 1}: ${lines[k].trim()}`;
        }
        out.push(`  '${name}':\n${shown}`);
        break found;
      }
    }
    if (out.length >= 8) break;
  }
  return out;
}

function errorSourcesCommand(args) {
  const lines = errorSources(args, fs.readFileSync(0, 'utf8'));
  if (lines.length) py.print('  where they are in the scripts:\n' + lines.join('\n'));
  return 0;
}

// NAME02 before the exec: the widgets of each page or snippet a script creates are named
// <Page>_<What><Type> (layout_rules/names.cjs, the gate's own rule). After the first DONE a page
// changed later had to have all of its names put right at once -- eleven renames and three test
// fixes for one grid column (room booking r3, 2026-10-13); named right when written, nothing cascades.
// CAPTION01-07 at the exec: a microflow or nanoflow a script creates or modifies has its business
// captions before it reaches the model, as a page has its NAME02 names. Found only at the gate, the
// captions came back as "the full gate would refuse CAPTION01" on 9-23 --only runs and 3-7 red full
// gates per B2B run (2026-10-15). A suggestion per action, from what the line does, so the fix is a
// paste. Prints `  <script>:<line>: <message>` lines; nothing when every flow is captioned.
const CAPTION_AT_EXEC = /^CAPTION0[1-7]$/;
const words = name => String(name).split('.').pop().replace(/^(ACT|SUB|DS|VAL|SCH|ASU|BCO|ACO|BDE|ADE|IVK|NF)_/i, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
const article = w => (w ? 'the ' + w : '');
function suggestCaption(line) {
  const t = line.trim();
  let m;
  if ((m = /^retrieve\s+\$\w+\s+from\s+(?:database\s+)?(?:\$\w+\/)?(?:["\w]+\.)*(["\w]+)/i.exec(t))) return `Find ${article(words(m[1]))}`;
  if ((m = /^\$\w+\s*=\s*create\s+(?:list\s+of\s+)?["\w.]*\.(["\w]+)/i.exec(t))) return `Start a new ${words(m[1])}`;
  if ((m = /^change\s+\$(\w+)/i.exec(t))) return `Update ${article(words(m[1]))}`;
  if ((m = /^commit\s+\$(\w+)/i.exec(t))) return `Save ${article(words(m[1]))}`;
  if ((m = /^delete\s+\$(\w+)/i.exec(t))) return `Remove ${article(words(m[1]))}`;
  if ((m = /^(?:\$\w+\s*=\s*)?call\s+(?:microflow|nanoflow|java\s+action|javascript\s+action)\s+["\w.]*\.(["\w]+)/i.exec(t))) return words(m[1]).replace(/^./, c => c.toUpperCase());
  if ((m = /^show\s+page\s+["\w.]*\.(["\w]+)/i.exec(t))) return `Open ${article(words(m[1]).replace(/\s+(new ?edit|overview|detail|view)$/, ''))} page`;
  if (/^show\s+message/i.test(t)) return 'Tell the user what happened';
  if (/^close\s+page/i.test(t)) return 'Close the page';
  if (/^(set|declare)\s+\$/i.test(t)) return 'Work out the value';
  if (/^(if|case|while)\b/i.test(t)) return 'Is it ...?';
  if (/^loop\b/i.test(t)) return 'One row at a time';
  return '';
}
function captionFindings(scripts) {
  const { CHECKS } = require('./check_mdl.cjs');
  const out = [];
  for (const script of scripts) {
    let text;
    try { text = fs.readFileSync(script, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    if (!/^\s*create\s+(?:or\s+(?:modify|replace)\s+)?(?:microflow|nanoflow)\b/im.test(text)) continue;
    const [failures] = CHECKS.naming(lines);
    for (const f of failures) {
      if (!CAPTION_AT_EXEC.test(f.check)) continue;
      const hint = /^CAPTION0[1356]$/.test(f.check) ? suggestCaption(lines[f.line - 1] || '') : '';
      const kind = f.check === 'CAPTION06' ? '@annotation' : '@caption';
      out.push(`  ${script}:${f.line}: [${f.check}] ${f.message}${hint ? ` -- e.g. ${kind} '${hint.replace(/'/g, "''")}'` : ''}`);
    }
  }
  if (out.length) process.stdout.write(out.join('\n') + '\n');
}

function widgetNameFindings(scripts) {
  const { nameFindings } = require('./layout_rules/names.cjs');
  const out = [];
  for (const script of scripts) {
    let text;
    try { text = fs.readFileSync(script, 'utf8'); } catch { continue; }
    for (const f of nameFindings(text.split(/\r?\n/))) {
      if (f.check === 'NAME02') out.push(`  ${script}:${f.line}: ${f.message}`);
    }
  }
  if (out.length) process.stdout.write(out.join('\n') + '\n');
}

module.exports = { unanchoredFeaturesCommand, DEFINITION_RE, definitions, testFirst, newFeatures, newFeaturesCommand, nearIcons, nearIconsCommand, errorSources, errorSourcesCommand, ALTERABLE, duplicateDefinitions, widgetNameFindings, captionFindings, suggestCaption };
