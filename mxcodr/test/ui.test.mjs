// The installer's output (overlay/lib/ui.mjs) looks like v1's (install/ui.sh at tag v1-last): the expected
// byte sequences below are lines of a v1 install captured under `script` on a terminal. Off a terminal, with
// NO_COLOR or TERM=dumb: plain lines, no escape codes, no bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeUi } from '../overlay/lib/ui.mjs';
import { runLive } from '../overlay/install.mjs';

const sink = () => { const s = { text: '', write: t => { s.text += t; return true; } }; return s; };
const UTF8 = { LANG: 'en_US.UTF-8', TERM: 'xterm-256color' };
const make = (env, isTTY, columns = 80) => { const out = sink(), err = sink(); let t = 0; const ui = makeUi({ out, err, env, isTTY, columns, clock: () => t }); return { ui, out, err, at: s => { t = s * 1000; } }; };
const ESC = /\x1b/;

// every kind of line the install prints, as main() and summary() call them
function everything(ui) {
  ui.banner('2026.11.01.22');
  ui.target('/apps/Shop', 'the Mendix app Shop.mpr');
  ui.plan(3);
  ui.begin('creating the app (Mendix 11.12.1)');
  ui.toolLine("Executing step 'Extract package'");
  ui.toolLine('Building...');
  ui.done('Mendix app created', 'Shop.mpr (Mendix 11.12.1)');
  ui.note('./mxcli did not run here or was another version; it is mxcli 0.29.0 now');
  ui.begin('installing skills');
  ui.done('skills', `8 ${ui.i.arrow} .claude/skills`);
  ui.head(ui.i.box, 'What landed');
  ui.row('skills', 8, '.claude/skills');
  ui.fail('expected one .mpr in /apps/Shop, found 2', 'install into a folder that holds one Mendix app');
}

test('on a UTF-8 terminal: v1\'s bytes for the done line, the note, the bar, the banner and a summary row', () => {
  const { ui, out, err } = make(UTF8, true, 120);
  everything(ui);
  assert.ok(out.text.includes('\x1b[38;5;39m  ███╗   ███╗██╗  ██╗       ██████╗ ██████╗ ██████╗ ██████╗ \x1b[0m\n'), 'the wordmark, first line blue');
  assert.ok(out.text.includes('\x1b[38;5;44m  ╚═╝     ╚═╝╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝\x1b[0m\n'), 'the last line cyan');
  assert.ok(out.text.includes('\n  \x1b[1mversion:\x1b[0m 2026.11.01.22\n\n'));
  assert.ok(out.text.includes('  \x1b[38;5;245m▪ target\x1b[0m /apps/Shop  \x1b[38;5;245m(the Mendix app Shop.mpr)\x1b[0m\n\n'));
  assert.ok(out.text.includes(`\r\x1b[K  \x1b[38;5;39m${'░'.repeat(24)}\x1b[0m  \x1b[1m  0%\x1b[0m  \x1b[38;5;245mcreating the app (Mendix 11.12.1)\x1b[0m`), 'the empty bar at 0%');
  assert.ok(out.text.includes('\x1b[38;5;245mcreating the app (Mendix 11.12.1) · Extract package\x1b[0m'), 'a phase of mxcli new on the bar');
  assert.ok(out.text.includes('\r\x1b[K  \x1b[38;5;42m✔\x1b[0m Mendix app created         \x1b[38;5;245mShop.mpr (Mendix 11.12.1)\x1b[0m\n'), 'the done line, label padded to 26');
  assert.ok(out.text.includes('\r\x1b[K  \x1b[38;5;214m!\x1b[0m ./mxcli did not run here'), 'the note');
  assert.ok(out.text.includes(`  \x1b[38;5;39m${'█'.repeat(7)}${'░'.repeat(17)}\x1b[0m  \x1b[1m 33%\x1b[0m`), 'one step of three done');
  assert.ok(out.text.includes('\n  \x1b[1m▪ What landed\x1b[0m\n'));
  assert.ok(out.text.includes('     \x1b[38;5;44mskills    \x1b[0m \x1b[1m  8\x1b[0m  .claude/skills\n'));
  assert.equal(err.text, '  \x1b[38;5;203m✘\x1b[0m \x1b[1mexpected one .mpr in /apps/Shop, found 2\x1b[0m\n    install into a folder that holds one Mendix app\n\n');
});

test('a step that runs long shows its time on the bar; a long label is cut with ~', () => {
  const { ui, out, at } = make(UTF8, true);
  ui.plan(2);
  ui.begin('x'.repeat(80));
  at(65);
  ui.bar();
  const last = out.text.split('\r\x1b[K').pop();
  assert.match(last, /x~ · 1m05s\x1b\[0m$/);
  assert.ok([...last.replace(/\x1b\[[0-9;]*m/g, '')].length <= 80, 'fits 80 columns');
});

test('off a terminal: plain lines, no escape codes, no bar; each step is begun and done on its own line', () => {
  const { ui, out, err } = make(UTF8, false);
  everything(ui);
  assert.doesNotMatch(out.text + err.text, ESC);
  assert.doesNotMatch(out.text, /\r/);
  assert.match(out.text, /^ {2}· creating the app \(Mendix 11\.12\.1\)\n {5}· Extract package\n {2}✔ Mendix app created {9}Shop\.mpr \(Mendix 11\.12\.1\)\n {2}! \.\/mxcli did not run/m);
  assert.match(out.text, /^ {2}✔ skills {21}8 → \.claude\/skills$/m);
  assert.match(out.text, /^ {2}███╗/m, 'the wordmark stays, as in v1');
  assert.match(err.text, /^ {2}✘ expected one \.mpr/);
});

test('NO_COLOR and TERM=dumb on a terminal: the same plain lines as off one', () => {
  const plain = make(UTF8, false); everything(plain.ui);
  for (const env of [{ ...UTF8, NO_COLOR: '1' }, { ...UTF8, TERM: 'dumb' }]) {
    const { ui, out, err } = make(env, true);
    everything(ui);
    assert.doesNotMatch(out.text + err.text, ESC);
    assert.equal(out.text, plain.out.text);
  }
});

test('no UTF-8 locale (cmd.exe): ASCII icons and bar, and the plain title instead of the wordmark', () => {
  const { ui, out, err } = make({ TERM: 'xterm' }, true);
  everything(ui);
  assert.match(out.text, /\x1b\[38;5;42m\+\x1b\[0m Mendix app created/);
  assert.match(out.text, /\x1b\[38;5;39m#{7}\.{17}\x1b\[0m/);
  assert.match(out.text, /mx-codr\x1b\[0m {2}2026\.11\.01\.22/);
  assert.doesNotMatch(out.text + err.text, /[█░✔✘·→▪▶]/);
  assert.match(err.text, /\x1b\[38;5;203mx\x1b\[0m/);
  const narrow = make(UTF8, true, 50); narrow.ui.banner('v');
  assert.doesNotMatch(narrow.out.text, /█/, 'under 62 columns: the plain title');
});

test('install.sh through a pipe: banner and a v1-style failure, without one escape code', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-ui-'));
  const sh = fileURLToPath(new URL('../install.sh', import.meta.url));
  const r = spawnSync('bash', [sh, d, '--no-app'], { encoding: 'utf8', env: { ...process.env, ...UTF8, NO_COLOR: '' } });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, ESC);
  assert.match(r.stdout, /version: \d{4}\.\d\d\.\d\d\.\d+/);
  assert.match(r.stderr, /^ {2}✘ no Mendix app \(\.mpr\) in .*, and --no-app was given\n {4}install into the folder of a Mendix app/);
});

test('runLive: the tool runs without blocking, every line reaches onLine, the status comes back', async () => {
  const lines = [];
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  const r = await runLive(process.execPath, ['-e', "console.log(\"Executing step 'Extract package'\"); setTimeout(() => { console.error('done...'); process.exit(3); }, 150)"], { onLine: l => lines.push(l) });
  clearInterval(timer);
  assert.equal(r.status, 3);
  assert.deepEqual(lines, ["Executing step 'Extract package'", 'done...']);
  assert.ok(ticks >= 3, 'the event loop ran while the tool did');
  const missing = await runLive(path.join(os.tmpdir(), 'no-such-tool-mxcodr'), []);
  assert.equal(missing.status, null);
});
