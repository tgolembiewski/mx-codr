// Part of tests/film.mjs, the film recorder (its header says what it does and how to run it). The mx-codr installer
// writes it and this folder on every install: they are the bundle's, not the app's, and edits are overwritten.
// Here: which tests. The arguments, the list Playwright prints, picking one, the film's file name, grep for
// one test or several, a reporter's title path matched to a test, and a JSON report's results.
import { DEFAULT_PACE } from './timing.mjs';

const USAGE = 'node tests/film.mjs --list | <number | words from the title | file.spec.ts[:line]> | --all | --status | --stop  [--pace <ms>]';

// argv -> { cmd: 'help' | 'list' | 'one' | 'all' | 'all-run' | 'status' | 'stop', pace, query } or { error }
export function parseArgs(argv) {
  const args = [...argv];
  let pace = DEFAULT_PACE;
  const at = args.indexOf('--pace');
  if (at >= 0) {
    const v = args[at + 1];
    if (!/^\d+$/.test(v || '')) return { error: '--pace takes milliseconds, e.g. --pace 1500 (0 = the test\'s own speed)' };
    pace = Number(v);
    args.splice(at, 2);
  }
  if (!args.length || ['-h', '--help'].includes(args[0])) return { cmd: 'help', pace };
  const flags = { '--list': 'list', '--all': 'all', '--all-run': 'all-run', '--status': 'status', '--stop': 'stop' };
  if (flags[args[0]]) return args.length === 1 ? { cmd: flags[args[0]], pace } : { error: `${args[0]} takes nothing after it` };
  const unknown = args.find(a => a.startsWith('--'));
  if (unknown) return { error: `unknown option ${unknown}; ${USAGE}` };
  return { cmd: 'one', pace, query: args.join(' ') };
}

// `playwright test --list --reporter=json` -> [{ n, file, line, describes, title, full }], in the list's order.
export function testsFromList(json) {
  const out = [];
  const walk = (suite, describes) => {
    for (const spec of suite.specs || []) out.push({ file: spec.file, line: spec.line, describes, title: spec.title, full: [...describes, spec.title].join(' › ') });
    for (const child of suite.suites || []) walk(child, child.title && child.title !== child.file ? [...describes, child.title] : describes);
  };
  for (const file of json.suites || []) walk(file, []);
  return out.map((t, i) => ({ n: i + 1, ...t }));
}

// True unless the test's own function takes no page, context or browser (an API or OQL test has nothing to film).
export function needsBrowser(source, line) {
  const text = source.split('\n').slice(Math.max(0, line - 1), line + 3).join(' ');
  const head = text.slice(0, text.indexOf('=>') >= 0 ? text.indexOf('=>') : undefined);
  const params = head.match(/async\s*\(([^)]*)\)\s*$/) || head.match(/function\s*\w*\s*\(([^)]*)\)\s*$/);
  if (!params) return true;
  return /\b(page|context|browser)\b/.test(params[1]);
}

// A query -> { tests } (one, or several for --all) or { error } naming the candidates.
export function pick(tests, query) {
  const q = String(query).trim();
  if (/^\d+$/.test(q)) {
    const t = tests.find(x => x.n === Number(q));
    return t ? { tests: [t] } : { error: `no test number ${q}; there are ${tests.length} (--list shows them)` };
  }
  const loc = q.match(/^(.+\.(?:spec|test)\.[cm]?[jt]s)(?::(\d+))?$/);
  let found;
  if (loc) {
    const file = loc[1].replace(/\\/g, '/').replace(/^(\.\/)?(tests\/)?/, '');
    found = tests.filter(t => (t.file === file || t.file.endsWith('/' + file)) && (!loc[2] || t.line === Number(loc[2])));
  } else {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    found = tests.filter(t => words.every(w => t.full.toLowerCase().includes(w)) || t.full.toLowerCase().includes(q.toLowerCase()));
  }
  if (found.length === 1) return { tests: found };
  if (!found.length) return { error: `no test matches "${q}" (--list shows them)` };
  return { error: `${found.length} tests match "${q}"; name one by its number:\n${found.map(line).join('\n')}` };
}

export const line = t => `${String(t.n).padStart(3)}. ${t.full}  (${t.file}:${t.line})`;

// The film's file name: the test's title, lower case, letters and digits joined by '-', at most 80 characters
// cut at a word's end.
export function slug(t) {
  let s = t.full.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 80) { s = s.slice(0, 81); s = s.slice(0, s.lastIndexOf('-') > 20 ? s.lastIndexOf('-') : 80); }
  return s || `test-${t.n}`;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Playwright matches grep against "<project> <file> <describe...> <title>": the test's own title path, to the end.
export const grepFor = t => `${[...t.describes, t.title].map(escapeRe).join(' ')}$`;
// several tests in one run: any of their title paths
export const grepForAll = tests => (tests.length === 1 ? grepFor(tests[0]) : tests.map(t => `(?:${grepFor(t)})`).join('|'));

// A reporter's title path (['', project, file, ...describes, title]) is this test's
export const isTest = (t, titlePath) => {
  const want = [...t.describes, t.title];
  const p = titlePath || [];
  if (p.length < want.length + 1) return false;
  const tail = p.slice(p.length - want.length);
  const file = String(p[p.length - want.length - 1] || '').replace(/\\/g, '/');
  return tail.every((x, i) => x === want[i]) && (file === t.file || file.endsWith('/' + t.file));
};

// The film run's JSON report -> [{ title, status, video }] for every test that ran.
export function collectResults(report) {
  const out = [];
  const walk = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) for (const r of test.results || []) {
      const video = (r.attachments || []).find(a => a.name === 'video' && a.path);
      out.push({ title: spec.title, status: r.status, video: video && video.path });
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const s of report.suites || []) walk(s);
  return out;
}
