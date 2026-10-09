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

// One MDL command: its text, or with asJson the rows of its --json output ([] for an empty table).
// MDL_MXCLI_TIMEOUT (seconds, default 120) bounds every call.
function mxcli(appDir, mpr, command, asJson = false) {
  const args = ['-p', mpr, ...(asJson ? ['--json'] : []), '-c', command];
  const timeout = parseFloat(process.env.MDL_MXCLI_TIMEOUT || '120');
  const result = spawnSync(binary(appDir), args, { cwd: appDir, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 1 << 30, windowsHide: true });
  if (result.error) throw new ModelReadError(`\`${command}\` could not run: ${result.error.message}`);
  const stdout = (result.stdout || '').replace(/\r\n?/g, '\n');
  if (result.status !== 0) {
    const lines = ((result.stderr || '') + stdout).trim().split('\n');
    throw new ModelReadError(`\`${command}\` exited ${result.status}: ${lines[lines.length - 1] || 'no output'}`);
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

module.exports = { ModelReadError, binary, mxcli, findMpr, moduleRolesOf, catalogArgs };
