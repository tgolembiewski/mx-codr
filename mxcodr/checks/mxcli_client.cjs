// How the checkers talk to the project's own ./mxcli, in one place: run one MDL command (text, or the
// rows of its --json output), find the .mpr, read which module roles each user role holds, and the
// command line every catalog checker takes (app_dir Module... [--mpr copy.mpr] [--no-refresh]).
// A model that cannot be read throws ModelReadError; the checkers print `ERROR could not read the
// model -- <why>` and exit 2, so the gate says "could not run", never "pass".
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class ModelReadError extends Error {}

// ./mxcli (./mxcli.exe on Windows) of the project: never one from PATH, which may be another release.
function binary(appDir) {
  for (const name of ['mxcli', 'mxcli.exe']) if (fs.existsSync(path.join(appDir, name))) return './' + name;
  return './mxcli';
}

// mxcli caps one statement's output at 10,000 lines. 0.27 refuses a statement past it (exit 1,
// mendixlabs/mxcli#1425) where 0.26 exited 0: a catalog query over an app with the twelve Marketplace AI
// modules (2,000 permission rows, ~8 lines each in --json) made security, folders, unused and catalog
// "could not run". Such a SELECT is read again in pages small enough for the cap.
const LINE_CAP = /output line limit exceeded/;
const PAGE_ROWS = 500;

// One MDL command: its text, or with asJson the rows of its --json output ([] for an empty table).
// MDL_MXCLI_TIMEOUT (seconds, default 120) bounds every call.
function mxcli(appDir, mpr, command, asJson = false) {
  try {
    return mxcliOnce(appDir, mpr, command, asJson);
  } catch (error) {
    const pageable = asJson && /^\s*select\b/i.test(command) && !/\b(limit|offset)\b/i.test(command);
    if (!(error instanceof ModelReadError) || !LINE_CAP.test(error.message) || !pageable) throw error;
    const rows = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const page = mxcliOnce(appDir, mpr, `${command.replace(/;\s*$/, '')} LIMIT ${PAGE_ROWS} OFFSET ${offset}`, true);
      rows.push(...page);
      if (page.length < PAGE_ROWS) return rows;
    }
  }
}

function mxcliOnce(appDir, mpr, command, asJson) {
  const args = ['-p', mpr, ...(asJson ? ['--json'] : []), '-c', command];
  const timeout = parseFloat(process.env.MDL_MXCLI_TIMEOUT || '120');
  const result = spawnSync(binary(appDir), args, { cwd: appDir, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 1 << 30, windowsHide: true });
  if (result.error) throw new ModelReadError(`\`${command}\` could not run: ${result.error.message}`);
  const stdout = (result.stdout || '').replace(/\r\n?/g, '\n');
  if (result.status !== 0) {
    const lines = ((result.stderr || '') + stdout).trim().split('\n');
    const capped = (result.stderr || '').split('\n').find(line => LINE_CAP.test(line));
    throw new ModelReadError(`\`${command}\` exited ${result.status}: ${capped || lines[lines.length - 1] || 'no output'}`);
  }
  if (!asJson) return stdout;
  // `Found N result(s)` may come before the JSON; an empty table prints no list at all.
  const start = stdout.indexOf('[');
  if (start < 0) {
    if (/Found 0 result|No results/i.test(stdout) || !stdout.trim()) return [];
    throw new ModelReadError(`\`${command}\` did not return JSON`);
  }
  let rows;
  try { rows = JSON.parse(stdout.slice(start)); } catch { throw new ModelReadError(`\`${command}\` did not return JSON`); }
  if (!Array.isArray(rows)) throw new ModelReadError(`\`${command}\` did not return a list`);
  return rows;
}

// The project's .mpr: the first by name in appDir, or '' when there is none.
function findMpr(appDir) {
  try { return fs.readdirSync(appDir).filter(n => /\.mpr$/i.test(n)).sort()[0] || ''; } catch { return ''; }
}

// {UserRole: [Module.Role, ...]} from `describe user role` of every user role.
function moduleRolesOf(appDir, mpr, read = mxcli) {
  const moduleRoles = {};
  const userRoles = read(appDir, mpr, 'SHOW USER ROLES', true).map(r => r.Name).filter(Boolean);
  if (userRoles.length) {
    const text = read(appDir, mpr, userRoles.map(r => `DESCRIBE USER ROLE ${r};`).join(' '));
    for (const m of text.matchAll(/user\s+role\s+"?(\w+)"?\s*\(\s*ModuleRoles\s*:\s*\(([^)]*)\)/gi)) {
      moduleRoles[m[1]] = m[2].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    }
  }
  return moduleRoles;
}

// `app_dir Module... [--mpr copy.mpr] [--no-refresh]` (--levels/--except already taken out by
// rulebook.levelArgs): {appDir, modules, mpr, refresh}, or null when no module was named. mpr is the
// given copy (absolute) or the project's own .mpr; '' when neither exists.
function catalogArgs(argv) {
  const positional = [];
  let mpr = '', refresh = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mpr') mpr = argv[++i] || '';
    else if (argv[i] === '--no-refresh') refresh = false;
    else positional.push(argv[i]);
  }
  if (positional.length < 2) return null;
  const appDir = positional[0];
  const modules = positional.slice(1).flatMap(m => m.split(/\s+/)).filter(Boolean);
  return { appDir, modules, mpr: mpr ? path.resolve(mpr) : findMpr(appDir), refresh };
}

// A document's describe text without its folder: a move (FOLDER01) changes where a document is, not
// what it does. Every version and hash of a document is taken over this text.
const withoutFolder = text => String(text || '').replace(/\bfolder\s*:?\s*'(?:[^']|'')*'\s*,?/gi, '');

module.exports = { ModelReadError, binary, mxcli, findMpr, moduleRolesOf, catalogArgs, withoutFolder };
