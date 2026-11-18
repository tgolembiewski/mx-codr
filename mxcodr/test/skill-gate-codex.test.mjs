// The skill gate for Codex (lib/skill-gate.mjs, bundle 2026.11.18.6): Codex reads a skill with a shell command
// (exec_command, usually inside a code-mode `exec` cell), so a read counts only when the model saw the whole file:
// one SKILL.md per command, no truncation marker in the command's output, and, inside an `exec` cell, none in the
// cell's output either (the cell has its own 10,000-token budget). Measured with Codex 0.167.0 (2026-11-18):
//   - hooks get tool_name "Bash" for exec_command ({command}) and "apply_patch" ({command: the patch});
//   - PostToolUse's tool_response is the command's output as the model sees it, truncation marker included;
//   - the enclosing `exec` cell (custom_tool_call) is in transcript_path before its nested calls' hooks run, and its
//     output (custom_tool_call_output) before the next cell's hooks run;
//   - exit 2 with the reason on stderr blocks a nested Bash call and an apply_patch ("Command blocked by PreToolUse
//     hook: <reason>").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GATED, shellRead, patchFiles, codexSkillRead, codexDecide, codexDenyMessage, runHook, presentSkills, TRUNCATED } from '../overlay/lib/skill-gate.mjs';

delete process.env.CLAUDE_PROJECT_DIR;
const GATE = fileURLToPath(new URL('../overlay/lib/skill-gate.mjs', import.meta.url));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-cgate-')));
const put = (d, rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
const SKILL = s => `.agents/skills/${s}/SKILL.md`;
const body = s => `# ${s}\nline two\nlast line of ${s}\n`;
/** An app as the extension sets it up for Codex: every gated skill in .agents/skills and .claude/skills. */
function app(skills = Object.keys(GATED)) {
  const d = tmp();
  for (const s of skills) { put(d, SKILL(s), body(s)); put(d, `.claude/skills/${s}/SKILL.md`, body(s)); }
  return d;
}
const TRANSCRIPT = '.codex-rollout.jsonl';
const tline = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
/** The transcript as Codex writes it: an exec cell (code mode), later its output. */
const cell = (d, id, source) => fs.appendFileSync(path.join(d, TRANSCRIPT), tline('response_item', { type: 'custom_tool_call', status: 'completed', call_id: id, name: 'exec', input: source }));
const cellOut = (d, id, text) => fs.appendFileSync(path.join(d, TRANSCRIPT), tline('response_item', { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text }] }));
const ev = (d, tool, command, extra = {}) => ({ session_id: 'th-1', turn_id: 't1', cwd: d, transcript_path: path.join(d, TRANSCRIPT), hook_event_name: extra.tool_response === undefined ? 'PreToolUse' : 'PostToolUse', tool_name: tool, tool_input: { command }, tool_use_id: 'exec-1', ...extra });
const post = (d, command, response) => runHook('post', JSON.stringify(ev(d, 'Bash', command, { tool_response: response })), {}, { agent: 'codex' });
const pre = (d, tool, command, env = {}) => runHook('pre', JSON.stringify(ev(d, tool, command)), env, { agent: 'codex' });
// a page change: needs naming-and-captions and spacing-and-layout
const CREATE_PAGE = `./mxcli -p App.mpr -c "ALTER PAGE Fleet.Car_Overview { SET Caption = 'Save' ON btnSave }"`;

test('shellRead: one command that reads one file, whole or by lines; anything else is not a read', () => {
  const f = '.agents/skills/a/SKILL.md';
  const whole = { file: f, from: 1, to: Infinity };
  for (const line of [`cat ${f}`, `cat -n ${f}`, `cat '${f}'`, `nl -ba ${f}`, `type ${f}`, `Get-Content -Raw ${f}`, `gc ${f}`, `Get-Content -Path "${f}" -Encoding utf8`])
    assert.deepEqual(shellRead(line), whole, line);
  assert.deepEqual(shellRead(`sed -n '1,200p' ${f}`), { file: f, from: 1, to: 200 });
  assert.deepEqual(shellRead(`sed -n 201,400p ${f}`), { file: f, from: 201, to: 400 });
  assert.deepEqual(shellRead(`sed -n '5,$p' ${f}`), { file: f, from: 5, to: Infinity });
  assert.deepEqual(shellRead(`head -n 50 ${f}`), { file: f, from: 1, to: 50 });
  assert.deepEqual(shellRead(`head -80 ${f}`), { file: f, from: 1, to: 80 });
  assert.deepEqual(shellRead(`tail -n +201 ${f}`), { file: f, from: 201, to: Infinity });
  assert.deepEqual(shellRead(`nl -ba ${f} | sed -n '1,120p'`), { file: f, from: 1, to: 120 });
  assert.deepEqual(shellRead(`Get-Content ${f} -TotalCount 100`, { powershell: true }), { file: f, from: 1, to: 100 });
  assert.deepEqual(shellRead(`Get-Content ${f} | Select-Object -Skip 200 -First 200`, { powershell: true }), { file: f, from: 201, to: 400 });
  // Windows paths stay as written in PowerShell
  assert.deepEqual(shellRead('Get-Content -Raw C:\\app\\.agents\\skills\\a\\SKILL.md', { powershell: true }), { file: 'C:\\app\\.agents\\skills\\a\\SKILL.md', from: 1, to: Infinity });
  for (const line of [`cat ${f} .agents/skills/b/SKILL.md`, `cat ${f}; echo done`, `cat ${f} && ./mxcli syntax page`, `cat ${f} | grep Spacing`,
    `sed 's/a/b/' ${f}`, `sed -n '1,10p;20,30p' ${f}`, `head -c 100 ${f}`, `grep -n Spacing ${f}`, `cd .agents && cat skills/a/SKILL.md`, 'cat', ''])
    assert.equal(shellRead(line), null, line);
});

test('patchFiles: the files an apply_patch adds, updates or moves to', () => {
  const p = '*** Begin Patch\n*** Add File: tests/cars.spec.ts\n+x\n*** Update File: mdlsource/a.mdl\n@@\n-a\n+b\n*** Update File: tests/old.spec.ts\n*** Move to: tests/e2e/new.spec.ts\n*** Delete File: tests/gone.spec.ts\n*** End Patch';
  assert.deepEqual(patchFiles(p), ['tests/cars.spec.ts', 'mdlsource/a.mdl', 'tests/old.spec.ts', 'tests/e2e/new.spec.ts']);
  assert.deepEqual(patchFiles('echo hi'), []);
});

test('a whole read in its own command, its output complete, is recorded; .agents/skills and .claude/skills both count', () => {
  const d = app();
  assert.deepEqual(pre(d, 'Bash', CREATE_PAGE).code, 2);
  // no transcript (an older Codex, unreadable): the command's own output decides
  assert.equal(post(d, `cat ${SKILL('spacing-and-layout')}`, body('spacing-and-layout')).code, 0);
  assert.equal(post(d, `cat .claude/skills/naming-and-captions/SKILL.md`, body('naming-and-captions')).code, 0);
  assert.deepEqual(pre(d, 'Bash', CREATE_PAGE), { code: 0 });
});

test('not recorded: a truncated output (both of Codex\'s markers), an output without the file\'s end, two files in one command, a file outside the app', () => {
  const d = app();
  const s = 'spacing-and-layout';
  post(d, `cat ${SKILL(s)}`, `Warning: truncated output (original token count: 12236)\nTotal output lines: 867\n\n${body(s)}`);
  post(d, `cat ${SKILL(s)}`, `# ${s}\nline …2236 tokens truncated… of ${s}\nlast line of ${s}\n`);
  post(d, `cat ${SKILL(s)}`, `# ${s}\nline two\n`);
  post(d, `cat ${SKILL(s)} ${SKILL('naming-and-captions')}`, body(s) + body('naming-and-captions'));
  const out = tmp(); put(out, SKILL(s), body(s));
  post(d, `cat ${path.join(out, SKILL(s))}`, body(s));
  const r = pre(d, 'Bash', CREATE_PAGE);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /spacing-and-layout/);
  assert.ok(TRUNCATED.test('…2236 tokens truncated…') && TRUNCATED.test('Warning: truncated output (original token count: 1)'));
});

test('the CarFleet evidence (2026-11-18): three skills read in one exec cell with Promise.allSettled, the cell\'s output cut at 10,000 tokens: none counts', () => {
  const d = app();
  const skills = ['naming-and-captions', 'reuse-and-snippets', 'spacing-and-layout'];
  put(d, SKILL('reuse-and-snippets'), body('reuse-and-snippets'));
  const src = 'const a=await Promise.allSettled([' + skills.map(s => `"cat .agents/skills/${s}/SKILL.md"`).join(',') + ',"./mxcli syntax page"].map(async cmd=>(await tools.exec_command({cmd,max_output_tokens:7500})).output)); for(const r of a)text(r.value)\n';
  cell(d, 'call_ev', src);
  // each nested command's own output is whole: the hooks see nothing wrong
  for (const s of skills) assert.equal(post(d, `cat ${SKILL(s)}`, body(s)).code, 0);
  cellOut(d, 'call_ev', `Warning: truncated output (original token count: 12236)\nTotal output lines: 867\n\n${body('naming-and-captions')}# reuse…2236 tokens truncated…tribute: Notes)\n`);
  const r = pre(d, 'Bash', CREATE_PAGE);
  assert.equal(r.code, 2);
  for (const s of ['naming-and-captions', 'spacing-and-layout']) assert.ok(r.stderr.includes(path.join(d, SKILL(s))), s);
});

test('in an exec cell: counted once the cell\'s output is in the transcript, whole; not while the same cell still runs (read and write in one cell)', () => {
  const d = app();
  const s = 'spacing-and-layout', n = 'naming-and-captions';
  cell(d, 'call_1', `// @exec: {"max_output_tokens": 30000}\ntext((await tools.exec_command({cmd:"cat ${SKILL(s)}",max_output_tokens:30000})).output)\n`);
  post(d, `cat ${SKILL(s)}`, body(s));
  // the write in the same cell, before its output exists: the model has not seen the skill yet
  const early = pre(d, 'Bash', CREATE_PAGE);
  assert.equal(early.code, 2);
  assert.ok(early.stderr.includes(path.join(d, SKILL(s))), 'the skill read in the still running cell is asked for');
  cellOut(d, 'call_1', body(s));
  cell(d, 'call_2', `text(await tools.exec_command({cmd:"cat ${SKILL(n)}"}))\n`);
  post(d, `cat ${SKILL(n)}`, body(n));
  // the cell printed the result as JSON: its newlines escaped, still the whole file
  cellOut(d, 'call_2', JSON.stringify({ chunk_id: 'x', output: body(n) }));
  assert.deepEqual(pre(d, 'Bash', CREATE_PAGE), { code: 0 });
});

test('by line ranges: counted once the ranges read cover the file', () => {
  const d = app();
  const s = 'spacing-and-layout';
  post(d, `sed -n '1,2p' ${SKILL(s)}`, `# ${s}\nline two\n`);
  post(d, `cat ${SKILL('naming-and-captions')}`, body('naming-and-captions'));
  assert.equal(pre(d, 'Bash', CREATE_PAGE).code, 2, 'line 3 not read yet');
  post(d, `sed -n '3,200p' ${SKILL(s)}`, `last line of ${s}\n`);
  assert.deepEqual(pre(d, 'Bash', CREATE_PAGE), { code: 0 });
});

test('apply_patch: a test spec added, updated or moved to needs durable-tests; another file does not; a patch through the shell too', () => {
  const d = app();
  const add = '*** Begin Patch\n*** Add File: tests/cars.spec.ts\n+import { test } from "./mx";\n*** End Patch';
  const r = pre(d, 'apply_patch', add);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^mx-codr skill gate: This test file needs the project skill below/);
  assert.ok(r.stderr.includes(path.join(d, SKILL('durable-tests'))));
  assert.equal(pre(d, 'apply_patch', '*** Begin Patch\n*** Update File: tests/e2e/a.spec.ts\n@@\n-a\n+b\n*** End Patch').code, 2);
  assert.equal(pre(d, 'apply_patch', '*** Begin Patch\n*** Update File: notes.md\n*** Move to: tests/b.spec.ts\n*** End Patch').code, 2);
  assert.equal(pre(d, 'Bash', `apply_patch <<'EOF'\n${add}\nEOF`).code, 2);
  assert.deepEqual(pre(d, 'apply_patch', '*** Begin Patch\n*** Add File: tests/helpers.ts\n+x\n*** End Patch'), { code: 0 });
  assert.deepEqual(pre(d, 'apply_patch', '*** Begin Patch\n*** Add File: docs/notes.md\n+x\n*** End Patch'), { code: 0 });
  post(d, `cat ${SKILL('durable-tests')}`, body('durable-tests'));
  assert.deepEqual(pre(d, 'apply_patch', add), { code: 0 });
});

test('the deny text names the .agents/skills files and the way to read them; the command it prescribes is recorded', () => {
  const d = app();
  const why = codexDenyMessage(['naming-and-captions', 'spacing-and-layout'], d, 'Bash');
  assert.equal(why, 'mx-codr skill gate: This model change needs the project skills below, not read whole yet in this session. '
    + 'Read each file in its own command, one file per command (never several files in one call, never Promise.all or a loop): '
    + 'in an exec script start with the line // @exec: {"max_output_tokens": 30000} and give exec_command max_output_tokens: 30000 '
    + '(cat <file>; on Windows Get-Content -Raw <file>). If the output says it was truncated, read the rest by line ranges '
    + "(sed -n '1,200p' <file>, then the next lines) before you build. Then check your script against them and run the same call again:\n"
    + `  ${path.join(d, SKILL('naming-and-captions'))}  (${GATED['naming-and-captions']})\n`
    + `  ${path.join(d, SKILL('spacing-and-layout'))}  (${GATED['spacing-and-layout']})\n`
    + "These project skills come before `./mxcli syntax` and before mxcli's own skills in .ai-context/skills/.");
  // exactly what the text says, absolute path and all (Mac form; the Windows form below)
  for (const s of ['naming-and-captions', 'spacing-and-layout']) post(d, `cat ${path.join(d, SKILL(s))}`, body(s));
  assert.deepEqual(pre(d, 'Bash', CREATE_PAGE), { code: 0 });
  const w = app();
  const winPath = s => path.join(w, SKILL(s)).replace(/\//g, '\\');
  for (const s of ['naming-and-captions', 'spacing-and-layout']) {
    const e = ev(w, 'Bash', `Get-Content -Raw ${winPath(s)}`, { tool_response: body(s) });
    if (process.platform !== 'win32') e.tool_input.command = `Get-Content -Raw '${path.join(w, SKILL(s))}'`;
    runHook('post', JSON.stringify(e), {}, { agent: 'codex', powershell: true });
  }
  assert.deepEqual(runHook('pre', JSON.stringify(ev(w, 'Bash', CREATE_PAGE)), {}, { agent: 'codex', powershell: true }), { code: 0 });
});

test('a skill only in .claude/skills (no .agents copy) is named there; a skill in neither is never asked for', () => {
  const d = tmp();
  put(d, '.claude/skills/app-security/SKILL.md', body('app-security'));
  assert.deepEqual(presentSkills(d), ['app-security']);
  const r = pre(d, 'Bash', './mxcli -p A.mpr -c "CREATE MODULE ROLE Fleet.Manager; CREATE MODULE Fleet;"');
  assert.equal(r.code, 2);
  assert.ok(r.stderr.includes(path.join(d, '.claude', 'skills', 'app-security', 'SKILL.md')));
  assert.doesNotMatch(r.stderr, /module-structure/);
});

test('fail open: bad input, MXCODR_SKILL_GATE=0, a transcript that cannot be read counts the command\'s own check, Claude Code\'s Read events ignored', () => {
  const d = app();
  assert.deepEqual(runHook('pre', '{not json', {}, { agent: 'codex' }), { code: 0 });
  assert.deepEqual(pre(d, 'Bash', CREATE_PAGE, { MXCODR_SKILL_GATE: '0' }), { code: 0 });
  assert.equal(codexSkillRead({ tool_name: 'Read', tool_input: { file_path: path.join(d, SKILL('app-security')) }, cwd: d }, { root: d }), null);
  // the transcript is a folder: the read is recorded on the command's own check
  fs.mkdirSync(path.join(d, TRANSCRIPT));
  for (const s of ['naming-and-captions', 'spacing-and-layout']) post(d, `cat ${SKILL(s)}`, body(s));
  assert.equal(codexDecide(ev(d, 'Bash', CREATE_PAGE), { root: d, env: {} }), null);
});

test('the hook as Codex runs it: node skill-gate.mjs pre|post --agent=codex, stdin in, exit 2 and the reason on stderr; 0 once read', () => {
  const d = app();
  const run = (mode, e) => spawnSync(process.execPath, [GATE, mode, '--agent=codex'], { input: JSON.stringify(e), encoding: 'utf8', env: { PATH: process.env.PATH, HOME: os.homedir() }, cwd: d });
  let r = run('pre', ev(d, 'Bash', CREATE_PAGE));
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^mx-codr skill gate: This model change needs the project skills below, not read whole yet in this session\. Read each file in its own command/);
  for (const s of ['naming-and-captions', 'spacing-and-layout']) assert.equal(run('post', ev(d, 'Bash', `cat ${SKILL(s)}`, { tool_response: body(s) })).status, 0);
  r = run('pre', ev(d, 'Bash', CREATE_PAGE));
  assert.equal(r.status, 0, r.stderr);
  // without --agent=codex the same Bash read is Claude Code's, which reads with the Read tool: not recorded
  const c = app();
  const claude = (mode, e) => spawnSync(process.execPath, [GATE, mode], { input: JSON.stringify(e), encoding: 'utf8', env: { PATH: process.env.PATH }, cwd: c });
  for (const s of ['naming-and-captions', 'spacing-and-layout']) claude('post', ev(c, 'Bash', `cat .claude/skills/${s}/SKILL.md`, { tool_response: body(s) }));
  assert.equal(claude('pre', ev(c, 'Bash', CREATE_PAGE)).status, 2);
});
