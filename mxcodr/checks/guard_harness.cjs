// The decision of hooks/guard-harness-env.sh: may this tool call run?
//
//     <tool call as JSON on stdin> | node guard_harness.cjs
//
// Prints `<kind>\t<path or detail>` when the call is blocked (kind: env, harness, switch, token,
// outside) and nothing when it may run; the hook turns the kind into its message. Exit 0 always.
// The shell is split by Python's shlex (py_compat.cjs), and os.path is mirrored where the two
// runtimes differ.
'use strict';
const fs = require('fs');
const os = require('os');
const { Shlex, shlexSplit, basename } = require('./py_compat.cjs');

const WIN = process.platform === 'win32';

// ---- os.path, as Python has it on this platform ----
function normpath(p) {
  // posixpath.normpath; ntpath's on Windows, whose backslashes the caller turns back into slashes.
  if (WIN) p = p.replace(/\//g, '\\').replace(/\\/g, '/');
  if (p === '') return '.';
  let drive = '';
  if (WIN && /^[A-Za-z]:/.test(p)) { drive = p.slice(0, 2); p = p.slice(2); }
  let initial = p.startsWith('/') ? 1 : 0;
  if (!WIN && initial && p.startsWith('//') && !p.startsWith('///')) initial = 2;
  const parts = [];
  for (const comp of p.split('/')) {
    if (comp === '' || comp === '.') continue;
    if (comp !== '..' || (!initial && !parts.length) || (parts.length && parts[parts.length - 1] === '..')) parts.push(comp);
    else if (parts.length) parts.pop();
  }
  let out = '/'.repeat(initial) + parts.join('/');
  if (WIN) {
    out = drive + out;
    return out || '.';
  }
  return out || '.';
}

function isdir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }

function strip(s, chars) {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}
const pyStrip = s => s.replace(/^\s+|\s+$/g, '');
const rstripSlash = s => s.replace(/\/+$/, '');

// ---- what is guarded ----
const ENV = 'tests/harness.env';
const DIRS = ['tools/mdl-checks/', 'tests/gate/', 'tests/lib/', '.claude/lint-rules/', '.pi/extensions/',
  '.opencode/plugin/', '.mxcli/applied/'];
// The rulebook (tests/rulebook/): the person's levels and exceptions, guarded like harness.env --
// also with MDL_HARNESS_EDITS=allow, since a card changed by a session is a verdict changed.
const RULEBOOK = 'tests/rulebook/';
const HARNESS_FILES = ['.claude/settings.local.json', '.codex/hooks.json', '.cursor/hooks.json', 'tests/gate.sh',
  'tests/lib.sh', 'tests/precheck.sh', 'tests/portable.sh', 'tests/orient.sh', 'tests/rules.sh', '.claude/lint-config.yaml',
  'tests/diagnose.sh', 'tests/peek.sh', 'tests/run-app.sh', 'tests/run-docker.sh',
  'tests/scenario-helpers.js', 'tests/marketplace-login.sh', '.mxcli/marketplace-login-needed',
  // Which paths are old enough to be warnings: the installer's record, not the session's.
  '.mxcli/gate-cache/paths-baseline.json'];
// The gate's switches a session must not set for one run. A rule's level is in its card
// (tests/rulebook/, guarded above), not here.
const SWITCHES = ['MDL_ALLOW_GREEN_FIRST', 'MDL_VISUAL_REVIEW', 'MDL_PRECHECK', 'MDL_GATE_CACHE',
  'MDL_HARNESS_EDITS', 'MDL_MARKETPLACE_LOGIN', 'MDL_DB_RESET', 'MDL_REQUIREMENTS'];
const SEGMENTS = /&&|\|\||[;|\n]/;
const HOME = os.homedir().replace(/\\/g, '/').replace(/\/+$/, '');
const READ_ROOTS = ['/System', '/Applications', '/Library', '/usr', '/opt', HOME + '/.mxcli/mxbuild', HOME + '/.mxcli/runtime'];
const SEARCH_VERBS = ['find', 'rg', 'ag', 'fd', 'fdfind', 'mdfind', 'locate'];
const READ_VERBS = ['cat', 'sed', 'head', 'tail', 'less', 'more', 'strings', 'awk', 'bat'];

// The guarded files of the project in the working directory: the fixed list plus every tests/ file
// the installer recorded (the app's own tests, tests/verify-*, are the session's).
function harnessFiles() {
  const files = new Set(HARNESS_FILES);
  try {
    const recorded = JSON.parse(fs.readFileSync('tools/mdl-checks/INSTALL.json', 'utf8')).files || {};
    for (const f of Object.keys(recorded)) {
      if (f.startsWith('tests/') && !f.startsWith('tests/verify-')) files.add(f);
    }
  } catch { /* not installed */ }
  return files;
}

// MDL_HARNESS_EDITS=allow in tests/harness.env: the person lets the session change the harness.
function editsAllowed() {
  try {
    return /^\s*MDL_HARNESS_EDITS\s*=\s*["']?allow/m.test(fs.readFileSync(ENV, 'utf8').replace(/\r\n?/g, "\n"));
  } catch { /* no harness.env */ }
  return false;
}

// ---- the rule ----
// ctx: { root, files, allowEdits } of the project the call runs in.

function rel(ctx, path) {
  path = strip(pyStrip(path), '"\'').replace(/\\/g, '/');
  if (path.toLowerCase().startsWith(ctx.root.toLowerCase() + '/')) path = path.slice(ctx.root.length + 1);
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

function kind(ctx, path) {
  const p = rel(ctx, path);
  const low = p.toLowerCase();
  if (low === ENV || low.endsWith('/' + ENV)) return 'env';
  if (p.startsWith(RULEBOOK) || p.includes('/' + RULEBOOK)) return 'rulebook';
  if (ctx.allowEdits) return null;
  for (const f of ctx.files) if (p === f || p.endsWith('/' + f)) return 'harness';
  for (const d of DIRS) if (p.startsWith(d) || p.includes('/' + d)) return 'harness';
  return null;
}

function shellTargets(ctx, command) {
  const targets = [];
  let here = '';
  const placed = (path) => {
    path = strip(pyStrip(path), '"\'');
    if (!here || /^[/~$]/.test(path) || /^[A-Za-z]:/.test(path)) return path;
    return normpath(here + '/' + path).replace(/\\/g, '/');
  };
  for (const segment of command.split(SEGMENTS)) {
    for (const m of segment.matchAll(/>>?\s*([^\s;&|<>]+)/g)) targets.push(placed(m[1]));
    let words;
    try {
      words = shlexSplit(segment);
    } catch {
      words = segment.split(/\s+/).filter(Boolean);
    }
    words = words.filter(w => w !== '>' && w !== '>>');
    if (!words.length) continue;
    const verb = basename(words[0]);
    const operands = words.slice(1).filter(w => !w.startsWith('-'));
    if (verb === 'cd' && operands.length === 1) {
      here = rel(ctx, placed(operands[0]));
    } else if (['tee', 'rm', 'truncate', 'shred', 'unlink'].includes(verb)) {
      targets.push(...operands.map(placed));
    } else if ((verb === 'sed' || verb === 'perl') && words.slice(1).some(w => w.startsWith('-i') || w === '--in-place')) {
      targets.push(...operands.map(placed));
    } else if (verb === 'ln' && operands.length) {
      targets.push(...operands.map(placed));
    } else if (['cp', 'mv', 'install', 'rsync'].includes(verb) && operands.length) {
      const destination = placed(operands[operands.length - 1]);
      targets.push(destination);
      if (destination.endsWith('/') || isdir(destination)) {
        for (const o of operands.slice(0, -1)) targets.push(rstripSlash(destination) + '/' + basename(rstripSlash(o)));
      }
    } else if (verb === 'dd') {
      for (const w of words) if (w.startsWith('of=')) targets.push(placed(w.slice(3)));
    } else if (/^(python[\d.]*|node|ruby|perl|php)\n?$/.test(verb) && words.slice(1).some(w => w === '-c' || w === '-e')) {
      const code = words.slice(1).join(' ');
      if (/write|append|open\s*\([^)]*["'][wa]|>/.test(code)) {
        if (code.includes('harness.env')) targets.push(ENV);
        const m = /tests[/\\]rulebook[/\\]([\w.-]+)/.exec(code);
        if (m) targets.push(RULEBOOK + m[1]);
      }
    }
  }
  return targets;
}

function expand(path) {
  path = strip(pyStrip(path), '"\'').replace(/\\/g, '/');
  if (path === '~' || path.startsWith('~/')) path = HOME + path.slice(1);
  return path.split('$HOME').join(HOME).split('${HOME}').join(HOME);
}

function outside(ctx, path) {
  const p = expand(path);
  if (p.startsWith('/dev/')) return false;
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) {
    return !(p.toLowerCase() === ctx.root.toLowerCase() || p.toLowerCase().startsWith(ctx.root.toLowerCase() + '/'));
  }
  return p === '..' || p.startsWith('../');
}

function tmpCheckout(path) {
  const p = expand(path);
  const m = /^(\/private\/tmp|\/tmp|\/System\/Volumes\/Data\/private\/tmp)\/(.+)\n?$/.exec(p);
  if (!m) return false;
  const base = m[1], rest = m[2].split('/');
  for (let depth = 1; depth < rest.length; depth++) {
    const folder = base + '/' + rest.slice(0, depth).join('/');
    if (['.git', 'go.mod', 'package.json'].some(marker => exists(folder + '/' + marker))) return true;
  }
  return false;
}

function commandWords(command) {
  try {
    const lex = new Shlex(command, '();<>|&\n');
    lex.whitespace = ' \t\r';
    lex.whitespaceSplit = true;
    const out = [];
    let cur = [];
    for (const tok of lex.all()) {
      if (tok && [...tok].every(c => ';|&\n()'.includes(c))) {
        if (cur.length) out.push(cur);
        cur = [];
      } else {
        cur.push(tok);
      }
    }
    if (cur.length) out.push(cur);
    return out;
  } catch {
    return command.split(SEGMENTS).map(segment => segment.split(/\s+/).filter(Boolean));
  }
}

function outsideTarget(ctx, command) {
  for (const words of commandWords(command)) {
    if (!words.length) continue;
    const verb = basename(words[0]);
    const rest = words.slice(1);
    if (verb === 'mdfind' || verb === 'locate') return verb;
    if (SEARCH_VERBS.includes(verb)) {
      let roots = [];
      for (const w of rest) {
        if (w.startsWith('-')) {
          if (verb === 'find') break;
          continue;
        }
        roots.push(w);
      }
      if (verb !== 'find') roots = roots.slice(1);
      for (const r of roots) if (outside(ctx, r)) return r;
    } else if (['grep', 'egrep', 'fgrep'].includes(verb) && rest.some(w =>
        w === '--recursive' || w === '--dereference-recursive' ||
        (w.startsWith('-') && !w.startsWith('--') && (w.slice(1).includes('r') || w.slice(1).includes('R'))))) {
      const operands = rest.filter(w => !w.startsWith('-'));
      for (const r of operands.slice(1)) if (outside(ctx, r)) return r;
    } else if (READ_VERBS.includes(verb)) {
      let skip = false;
      for (const w of rest) {
        if (w === '>' || w === '>>' || w === '<') {
          skip = w !== '<';
          continue;
        }
        if (skip || w.startsWith('>') || w.startsWith('-')) {
          skip = false;
          continue;
        }
        const p = expand(w);
        if (READ_ROOTS.some(r => p === r || p.startsWith(r + '/')) || tmpCheckout(w)) return w;
      }
    }
  }
  return null;
}

function tokenRead(command) {
  if (/\.mxcli[/\\]auth\.json/.test(command)) return '~/.mxcli/auth.json';
  if (/\$\{?MENDIX_PAT|printenv\s+MENDIX_PAT/.test(command)) return 'MENDIX_PAT';
  if (process.env.MENDIX_PAT) {
    for (const words of commandWords(command)) {
      if (!words.length) continue;
      const verb = basename(words[0]), rest = words.slice(1);
      if ((verb === 'env' || verb === 'printenv') && rest.every(w => w.startsWith('-'))) return 'the environment (MENDIX_PAT is set)';
      if (verb === 'set' && !rest.length) return 'the environment (MENDIX_PAT is set)';
      if ((verb === 'export' || verb === 'declare') && rest.length && rest.every(w => ['-p', '-x', '-px', '-xp'].includes(w))) {
        return 'the environment (MENDIX_PAT is set)';
      }
    }
  }
  return null;
}

// [kind, detail] for a shell command that is blocked, or null.
function bashHit(ctx, command) {
  for (const target of shellTargets(ctx, command)) {
    const k = kind(ctx, target);
    if (k) return [k, rel(ctx, target)];
  }
  if (/tests[/\\](gate|precheck)\.sh/.test(command) &&
      new RegExp('(^|[\\s;&|(])(export\\s+)?(' + SWITCHES.join('|') + ')=').test(command)) {
    return ['switch', ''];
  }
  // Rewriting the paths baseline would turn every untested path into an old one, a warning.
  if (/--write-baseline\b/.test(command)) return ['harness', '.mxcli/gate-cache/paths-baseline.json'];
  const secret = tokenRead(command);
  if (secret) return ['token', secret];
  const away = outsideTarget(ctx, command);
  if (away) return ['outside', away];
  return null;
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) process.exit(0);
  const tool = String(data.tool_name || '').toLowerCase();
  const args = (data.tool_input && typeof data.tool_input === 'object') ? data.tool_input : {};
  // Read from the working directory, the project the call runs in.
  const ctx = {
    root: process.cwd().replace(/\\/g, '/').replace(/\/+$/, ''),
    files: harnessFiles(),
    allowEdits: editsAllowed(),
  };
  let hit = null;
  if (tool === 'bash') {
    hit = bashHit(ctx, String(args.command || ''));
  } else if (['edit', 'write', 'multiedit', 'notebookedit', 'patch', 'apply_patch'].includes(tool)) {
    const path = String(args.file_path || args.filePath || args.notebook_path || args.path || '');
    const k = path ? kind(ctx, path) : null;
    if (k) hit = [k, rel(ctx, path)];
  }
  if (hit) process.stdout.write(hit[0] + '\t' + hit[1] + '\n');
}

if (require.main === module) main();
