#!/usr/bin/env node
// What tests/gate.sh needs from a script, one subcommand per job.
//
//     gate_helpers.cjs qualified-names               names from a SHOW ... --json listing on stdin
//     gate_helpers.cjs fingerprint <path>...         one digest over files, meta:<path> and env:NAME=value
//     gate_helpers.cjs secret                        a random 32-hex-digit cache secret
//     gate_helpers.cjs signed-in-users               user names from an M2EE get_logged_in_user_names answer on stdin
//     gate_helpers.cjs recent-refusal [seconds]      timestamp of a session-cap refusal line on stdin, if recent (120)
//     gate_helpers.cjs deployment-age <mpr> <built>  warn when the model is newer than the built deployment
//     gate_helpers.cjs runtime-age <mpr> <lstart>    warn when the model changed after the runtime started
//     gate_helpers.cjs missing-browser <config>      the executablePath a Playwright config names, if it is missing
//     gate_helpers.cjs duplicate-definitions <mdl>... documents these scripts create that another script
//                                                   in the same folder creates too (SCRIPT01)
//     gate_helpers.cjs test-first <app> <mpr> <mdl>... pages and ACT_ microflows these scripts create that
//                                                   no tests/verify-*.test.sh covers yet (TEST01)
//     gate_helpers.cjs watch-state <boot-log>        where a --watch boot is: ready, building, applied or
//                                                   failed; after failed, one line per build error
//     gate_helpers.cjs runtime-errors <runtime.log> <since>
//                                                   the ERROR/CRITICAL lines logged at or after <since>
//                                                   ('YYYY-MM-DD HH:MM:SS'), one per distinct message
//     gate_helpers.cjs visual-report <findings.jsonl> [<scripts-dir>] [--review <dir>]
//                                                   one warning line per page problem look() measured;
//                                                   with --review, the screenshots still to be judged
//     gate_helpers.cjs doc-map                        {qualified name: unit id} from catalog SELECT
//                                                   listings (pages, microflows, nanoflows) on stdin
//     gate_helpers.cjs record-tests-seen <app-dir> <doc-map.json> <test.sh>...
//                                                   remember the model state each of these tests ran on
//     gate_helpers.cjs changed-tests <app-dir> <doc-map.json>
//                                                   RUN <test> -- <why> for each test whose covered
//                                                   documents changed since it last ran (gate.sh --changed)
//
// Exit 0 unless noted: qualified-names exits 1 when stdin is not a JSON list.
// Warnings are printed to stdout, ready to show under the gate's output.
//
// The Node port of gate_helpers.py (2026-10-05): the same output on the same input. JSON is read
// the way Python's json module reads it (an integral float stays 1.0, NaN and Infinity parse), and
// a value of the wrong type stops the subcommand with exit 1, as the Python's exception did.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const py = require('./py_compat.cjs');
const { re } = py;
const { PyError, isDict, typeName, truthy, or, head, get, joinStr, strRepr, str, loads, dict, readStrict, stdinText, statOf, walk, pyInt, naive, nowNaive } = require('./gate_values.cjs');
const { definitions, testFirst, duplicateDefinitions } = require('./gate_scripts.cjs');
const { deploymentAge, runtimeAge, watchState, runtimeErrors } = require('./gate_runtime.cjs');
const { fdOpen, visualReport } = require('./gate_visual.cjs');
const { docMap, recordTestsSeen, changedTests } = require('./gate_changed.cjs');

// ---- the subcommands ----

function qualifiedNames() {
  const rows = loads(stdinText());
  if (!Array.isArray(rows)) return 1;
  const names = rows.map(row => or(get(row, 'Qualified Name'), get(row, 'QualifiedName')));
  // The names become MDL statements and file names: anything that is not Module.Name is refused.
  for (const name of names) {
    if (!truthy(name)) continue;
    if (typeof name !== 'string') throw new PyError('TypeError', 'expected string or bytes-like object');
    if (!re.fullmatch(String.raw`[A-Za-z_]\w*\.[A-Za-z_]\w*`, name)) return 1;
  }
  for (const name of names) if (truthy(name)) py.print(name);
  return 0;
}

// Content of each file (size + mtime for meta:<path>), walked in sorted order.
function fingerprint(paths) {
  const digest = crypto.createHash('sha256');
  const add = (p, content) => {
    let st;
    try {
      st = statOf(p);
    } catch {
      digest.update(`missing ${p}\n`);
      return;
    }
    if (st.isDirectory()) {
      for (const [root, dirs, files] of walk(p)) {
        dirs.sort(py.compare);
        for (const name of [...files].sort(py.compare)) add(py.join(root, name), content);
      }
      return;
    }
    if (!content) {
      digest.update(`${p} ${st.size} ${st.mtimeNs}\n`);
      return;
    }
    digest.update(`${p} ${st.size}\n`);
    try {
      digest.update(fs.readFileSync(p));
    } catch {
      digest.update(`unreadable ${p}\n`);
    }
  };
  for (const arg of paths) {
    // A setting read from the environment rather than a file; the caller expands the value, so
    // it counts whether or not it was exported.
    if (arg.startsWith('env:')) digest.update(`${arg}\n`);
    else if (arg.startsWith('meta:')) add(arg.slice(5), false);
    else add(arg, true);
  }
  py.print(digest.digest('hex').slice(0, 24));
  return 0;
}

function secret() {
  py.print(crypto.randomBytes(16).toString('hex'));
  return 0;
}

function signedInUsers() {
  let feedback;
  try {
    feedback = get(loads(stdinText()), 'feedback', dict());
  } catch {
    return 0;
  }
  const users = or(get(feedback, 'users'), []);
  if (truthy(users)) py.print(joinStr(',', users));
  return 0;
}

function recentRefusal(seconds) {
  const line = py.strip(stdinText());
  const stamp = line ? re.match(String.raw`(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`, line) : null;
  if (!stamp) return 0;
  const text = stamp.group(1);
  const m = /^([0-9]{4})-(1[0-2]|0[1-9])-(3[01]|[12][0-9]|0[1-9]) (2[0-3]|[0-1][0-9]):([0-5][0-9]):(6[0-1]|[0-5][0-9])$/.exec(text);
  const when = m && naive(...m.slice(1, 7).map(Number));
  if (when === null || when === undefined) throw new PyError('ValueError', `time data ${strRepr(text)} does not match format '%Y-%m-%d %H:%M:%S'`);
  if ((nowNaive() - when) / 1e6 <= seconds) py.print(text);
  return 0;
}

function missingBrowser(config) {
  let options;
  try {
    const data = loads(readStrict(config));
    const index = (v, k) => {
      if (isDict(v) && Object.prototype.hasOwnProperty.call(v, k)) return v[k];
      throw new Error('missing');
    };
    options = index(index(data, 'browser'), 'launchOptions');
  } catch {
    return 0;
  }
  const p = get(options, 'executablePath');
  if (!truthy(p)) return 0;
  if (typeof p !== 'string') {
    if (typeof p === 'number' || typeof p === 'boolean' || typeof p === 'bigint') {
      if (!fdOpen(p)) py.print(str(p));
      return 0;
    }
    throw new PyError('TypeError', `stat: path should be string, bytes, os.PathLike or integer, not ${typeName(p)}`);
  }
  if (!py.exists(p)) py.print(p);
  return 0;
}

// `create [or modify|or replace] [persistent|...] <kind> Module.Name` at the start of a line.
const DOC = 'The work tests/gate.sh needs from a script, one subcommand per job; see the head of gate_helpers.cjs.';

function main(argv) {
  if (argv.length < 1) {
    process.stderr.write(DOC + '\n');
    return 2;
  }
  const [command, ...rest] = argv;
  let args = rest;
  if (command === 'qualified-names') return qualifiedNames();
  if (command === 'fingerprint') return fingerprint(args);
  if (command === 'secret') return secret();
  if (command === 'signed-in-users') return signedInUsers();
  if (command === 'recent-refusal') return recentRefusal(args.length ? pyInt(args[0]) : 120);
  if (command === 'deployment-age' && args.length === 2) return deploymentAge(...args);
  if (command === 'runtime-age' && args.length === 2) return runtimeAge(...args);
  if (command === 'duplicate-definitions') return duplicateDefinitions(args);
  if (command === 'test-first' && args.length >= 3) return testFirst(args);
  if (command === 'runtime-errors' && args.length === 2) return runtimeErrors(...args);
  if (command === 'visual-report' && args.length) {
    let review = '';
    const at = args.indexOf('--review');
    if (at >= 0) {
      review = at + 1 < args.length ? args[at + 1] : '';
      args = [...args.slice(0, at), ...args.slice(at + 2)];
    }
    if (!args.length) throw new PyError('IndexError', 'list index out of range');
    return visualReport(args[0], args.length > 1 ? args[1] : '', review);
  }
  if (command === 'watch-state' && args.length === 1) return watchState(args[0]);
  if (command === 'missing-browser' && args.length === 1) return missingBrowser(args[0]);
  if (command === 'doc-map') return docMap();
  if (command === 'record-tests-seen' && args.length >= 2) return recordTestsSeen(args[0], args[1], args.slice(2));
  if (command === 'changed-tests' && args.length === 2) return changedTests(...args);
  process.stderr.write(`unknown or incomplete command: ${argv.join(' ')}\n`);
  return 2;
}

// The CLI; the functions are exported under their Python names for the audit tests.
function cli(argv) {
  try {
    return main(argv);
  } catch (error) {
    // What a Python traceback ends with: the exception type and its message.
    const type = error instanceof PyError ? error.type : error && error.code === 'ENOENT' ? 'FileNotFoundError' : 'OSError';
    process.stderr.write(`Traceback (most recent call last):\n${type}: ${error && error.message}\n`);
    return 1;
  }
}


if (require.main === module) process.exitCode = cli(process.argv.slice(2));

module.exports = { main: cli };
