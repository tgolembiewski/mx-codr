#!/usr/bin/env node
// Rules over the project's own browser tests (tests/verify-*.test.sh), run by the gate's coverage step.
//   WAIT01  a test that waits for time instead of for what happens:
//           - page.waitForTimeout(N) above 500 ms: the N ms are paid on every run, however fast the
//             app answers, and on a slow machine they may not be enough;
//           - a wait that may end in nothing, waitFor({timeout: N}).then(() => true).catch(() => false):
//             every run where the thing does not come pays the full N ms. On InvoiceB2B two tests paid
//             6 s per order they opened this way, retrying a list filter typed too early (2026-10-10).
// Any app: the patterns are Playwright's, not one app's widgets.
//
// Usage: test_rules.cjs <tests-dir> [--levels json] [--except json]   (except: a test file name)
// Prints `PASS|WARN|FAIL <summary>`, `  ~ [WAIT01] ...` warnings, `  - [WAIT01] ...` blocking lines.
// Exit 0 nothing blocking, 1 blocking findings (WAIT01 at block in the rulebook).
'use strict';
const fs = require('fs');
const path = require('path');
const { levelArgs, levelOf } = require('./rulebook.cjs');

const PAUSE_RE = /\bwaitForTimeout\(\s*(\d+)\s*\)/g;
const MAYBE_RE = /\.waitFor\(\s*\{\s*timeout:\s*(\d+)\s*\}\s*\)\s*\.then\(\s*\(\)\s*=>\s*true\s*\)\s*\.catch\(\s*\(\)\s*=>\s*false\s*\)/g;
const PAUSE_LIMIT = 500;
const MAYBE_LIMIT = 1000;

// [{code, key, file, line, message}] for one test's text.
function waitFindings(file, text) {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('#')) return;
    for (const m of raw.matchAll(PAUSE_RE)) {
      const ms = Number(m[1]);
      if (ms <= PAUSE_LIMIT) continue;
      out.push({ code: 'WAIT01', key: file, file, line: i + 1,
        message: `${file}:${i + 1} waits ${ms} ms whatever happens -- await what the last action causes instead `
          + '(await_message for a message, landed for a page, filter_list for a filtered list, a locator for a widget)' });
    }
    for (const m of raw.matchAll(MAYBE_RE)) {
      const ms = Number(m[1]);
      if (ms < MAYBE_LIMIT) continue;
      out.push({ code: 'WAIT01', key: file, file, line: i + 1,
        message: `${file}:${i + 1} waits up to ${ms} ms for something that may not come, and every run where it does not `
          + `pays the ${ms} ms -- a list filter: filter_list('list', 'filter', 'text') answers as soon as the list does; `
          + 'otherwise wait for a sign that is always there' });
    }
  });
  return out;
}

function main() {
  const { levels, excepts, rest } = levelArgs(process.argv.slice(2));
  const dir = rest[0];
  if (!dir) { process.stderr.write('usage: test_rules.cjs <tests-dir> [--levels json] [--except json]\n'); return 2; }
  const level = levelOf(levels, 'WAIT01', 'warn');
  const skip = new Set(excepts.WAIT01 || []);
  let files = [];
  try { files = fs.readdirSync(dir).filter(n => /^verify-.*\.test\.sh$/.test(n)).sort(); } catch { /* no tests */ }
  let found = [];
  if (level !== 'off') {
    for (const name of files) {
      if (skip.has(name)) continue;
      found.push(...waitFindings(name, fs.readFileSync(path.join(dir, name), 'utf8')));
    }
  }
  if (!found.length) { process.stdout.write(`PASS  no test waits for time (${files.length} test script(s))\n`); return 0; }
  const block = level === 'block';
  const lines = [`${block ? 'FAIL' : 'WARN'}  ${found.length} wait(s) for time in the tests`];
  if (level !== 'info') for (const f of found) lines.push(`  ${block ? '-' : '~'} [WAIT01] ${f.message}`);
  process.stdout.write(lines.join('\n') + '\n');
  return block ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { waitFindings, PAUSE_LIMIT, MAYBE_LIMIT };
