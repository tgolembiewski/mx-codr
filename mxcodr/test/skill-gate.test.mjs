// The skill gate (lib/skill-gate.mjs, bundle 2026.11.18.2): which project skills a model write or a test file needs,
// what counts as having read one, the deny before and the pass after, failing open, and the installer's wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GATED, MARK, skillsForMdl, modelWrites, skillsForCall, skillRead, markRead, readSkills, statePath, decide, runHook,
  withGateHooks, withoutGateHooks, fileModeCommand, PRE_MATCHER, POST_MATCHER, RESET_EVENT, RESET_MATCHER, clearReads, isCompaction,
} from '../overlay/lib/skill-gate.mjs';
import { installSkillGate, SKILL_GATE } from '../overlay/install.mjs';

// the hooks prefer CLAUDE_PROJECT_DIR (set when this suite runs inside Claude Code): never another folder from here
delete process.env.CLAUDE_PROJECT_DIR;
const GATE = fileURLToPath(new URL('../overlay/lib/skill-gate.mjs', import.meta.url));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-gate-')));
const put = (d, rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
const SKILL = s => `.claude/skills/${s}/SKILL.md`;
/** An app with every gated skill (a 3-line SKILL.md each) and a script. */
function app(skills = Object.keys(GATED)) {
  const d = tmp();
  for (const s of skills) put(d, SKILL(s), `# ${s}\nline two\nline three\n`);
  return d;
}
const bash = (d, command, session = 's1') => ({ session_id: session, cwd: d, tool_name: 'Bash', tool_input: { command } });
const read = (d, s, extra = {}, session = 's1') => ({ session_id: session, cwd: d, tool_name: 'Read', tool_input: { file_path: path.join(d, SKILL(s)), ...extra } });

test('the mapping: each kind of MDL asks for its skills; comments, quoted strings and Java bodies do not count', () => {
  const cases = [
    ['CREATE MODULE "Fleet";', ['module-structure', 'naming-and-captions']],
    ['create persistent entity Fleet.Car (Name: String(200));', ['module-structure', 'naming-and-captions']],
    ['MOVE PAGE Fleet.Car_Overview TO FOLDER \'Pages\';', ['module-structure', 'naming-and-captions']],
    ['CREATE MICROFLOW Fleet.ACT_Save ($Car: Fleet.Car) BEGIN COMMIT $Car; END;', ['module-structure', 'naming-and-captions']],
    ['CREATE MODULE ROLE Fleet.Manager;', ['app-security']],
    ['GRANT EXECUTE ON MICROFLOW Fleet.ACT_Save TO Fleet.Manager;', ['app-security']],
    ['ALTER PROJECT SECURITY LEVEL PRODUCTION;', ['app-security']],
    ['CREATE DEMO USER \'demo\' PASSWORD \'x\' (Manager);', ['app-security']],
    ['ALTER PAGE Fleet.Car_Overview { SET Caption = \'Save\' ON btnSave }', ['naming-and-captions', 'spacing-and-layout']],
    ['CREATE OR MODIFY NAVIGATION Responsive HOME PAGE Fleet.Home;', ['naming-and-captions', 'spacing-and-layout']],
    ['CREATE PERSISTENT ENTITY Fleet.Photo EXTENDS System.Image (Caption: String(100));', ['module-structure', 'naming-and-captions', 'files-and-images']],
    ['ALTER PAGE Fleet.Car_Edit { INSERT AFTER txtName { fileuploader Car_Edit_DocumentUploader (Label: \'Files\') } }', ['naming-and-captions', 'spacing-and-layout', 'files-and-images']],
    ['CREATE JAVA ACTION Fleet.JA_Hash (Text: String) RETURNS String AS $$ return text; $$;', ['module-structure', 'naming-and-captions', 'java-action-docs']],
  ];
  for (const [mdl, want] of cases) assert.deepEqual(skillsForMdl(mdl), want, mdl);
  // read-only MDL, and words that only look like statements, ask for nothing
  for (const mdl of ['SHOW MODULES; DESCRIBE ENTITY System.Image; SHOW DEMO USERS; SHOW PROJECT SECURITY; SHOW MODULE ROLES;',
    "SELECT Name FROM CATALOG.MICROFLOWS WHERE Folder = 'x';",
    "-- create module X\n/** create page Y; grant all */\nSHOW STRUCTURE;",
    "ALTER ENTITY Fleet.Car ADD ATTRIBUTE Note: String(200) DEFAULT 'create page and grant';",
    'CREATE MICROFLOW_NOT; $Car = CREATE Fleet.Car (Name = \'x\');']) assert.deepEqual(skillsForMdl(mdl), [], mdl);
});

test('the commands that write the model: ./mxcodr-live exec, mxcli exec, mxcli -c; check, query and the rest never', () => {
  assert.deepEqual(modelWrites('./mxcodr-live exec mdlsource/fleet.mdl'), [{ file: 'mdlsource/fleet.mdl' }]);
  assert.deepEqual(modelWrites('.\\mxcodr-live.cmd exec mdlsource\\fleet.mdl'), [{ file: 'mdlsource\\fleet.mdl' }]);
  assert.deepEqual(modelWrites('./mxcli exec x.mdl -p App.mpr'), [{ file: 'x.mdl' }]);
  assert.deepEqual(modelWrites('MXCLI_QUIET=1 ./mxcli -p App.mpr exec x.mdl'), [{ file: 'x.mdl' }]);
  assert.deepEqual(modelWrites('./mxcli -p App.mpr -c "CREATE MODULE Fleet"'), [{ mdl: 'CREATE MODULE Fleet' }]);
  assert.deepEqual(modelWrites('./mxcli check x.mdl && ./mxcodr-live exec x.mdl'), [{ file: 'x.mdl' }]);
  assert.deepEqual(modelWrites('sh ./mxcodr-live exec x.mdl'), [{ file: 'x.mdl' }]);
  assert.deepEqual(modelWrites('bash -c "./mxcli exec x.mdl -p A.mpr"'), [{ file: 'x.mdl' }]);
  for (const c of ['./mxcli check x.mdl -p App.mpr --references', './mxcodr-live check x.mdl', './mxcodr-live query "DESCRIBE ENTITY A.B"',
    './mxcodr-live problems', './mxcli syntax page', './mxcli run --local -p App.mpr', 'cat x.mdl', 'git status'])
    assert.deepEqual(modelWrites(c), [], c);
  // a heredoc whose MDL leaves a quote open: the whole command is the MDL
  const here = "cat > s.mdl <<'EOF'\nCREATE PAGE A.B (Title: 'Car's')\nEOF\n./mxcli exec s.mdl -p A.mpr";
  assert.deepEqual(modelWrites(here), [{ mdl: here }]);
});

test('a whole read counts: no limit, or a limit that covers the file; a part, another file or another skill does not', () => {
  const d = app();
  assert.equal(skillRead(read(d, 'module-structure')), 'module-structure');
  assert.equal(skillRead(read(d, 'module-structure', { offset: 1, limit: 2000 })), 'module-structure');
  assert.equal(skillRead(read(d, 'module-structure', { limit: 3 })), 'module-structure', 'a limit of exactly its 3 lines (the last newline ends a line)');
  assert.equal(skillRead(read(d, 'module-structure', { limit: 2 })), null, 'a limit short of the file');
  assert.equal(skillRead(read(d, 'module-structure'), { root: d }), 'module-structure', 'in the app');
  assert.equal(skillRead(read(d, 'module-structure'), { root: tmp() }), null, 'a SKILL.md of another folder does not count here');
  assert.equal(skillRead(read(d, 'module-structure', { offset: 3 })), null, 'from line 3 on');
  assert.equal(skillRead({ tool_name: 'Read', tool_input: { file_path: 'C:\\Apps\\Fleet\\.ai-context\\skills\\app-security\\SKILL.md' } }), 'app-security');
  assert.equal(skillRead({ tool_name: 'Read', tool_input: { file_path: path.join(d, '.claude/skills/create-page/SKILL.md') } }), null, "mxcli's own skill");
  assert.equal(skillRead({ tool_name: 'Read', tool_input: { file_path: path.join(d, '.claude/skills/app-security/reference.md') } }), null);
  assert.equal(skillRead({ tool_name: 'Skill', tool_input: { skill: 'durable-tests' } }), 'durable-tests', 'the Skill tool loads the whole file');
  assert.equal(skillRead({ tool_name: 'Bash', tool_input: { command: `cat ${SKILL('app-security')}` } }), null, 'cat is not a read');
});

test('the gate denies a model change before its skills are read, names each file to read, and lets it run after', () => {
  const d = app();
  put(d, 'mdlsource/fleet.mdl', 'CREATE MODULE "Fleet";\nCREATE PERSISTENT ENTITY Fleet.Car (Name: String(200));\n');
  const call = bash(d, './mxcodr-live exec mdlsource/fleet.mdl');
  const why = decide(call);
  assert.match(why, /^mx-codr skill gate: This model change needs the project skills below, not read yet in this session\./);
  for (const s of ['module-structure', 'naming-and-captions']) assert.ok(why.includes(path.join(d, '.claude', 'skills', s, 'SKILL.md')), s);
  assert.doesNotMatch(why, /app-security/);
  markRead(d, 's1', 'module-structure');
  assert.doesNotMatch(decide(call), /module-structure/, 'only the one still missing');
  assert.match(decide(call), /naming-and-captions/);
  // a partial read is not recorded by the hook
  assert.equal(runHook('post', JSON.stringify(read(d, 'naming-and-captions', { limit: 1 }))).code, 0);
  assert.match(decide(call), /naming-and-captions/);
  assert.equal(runHook('post', JSON.stringify(read(d, 'naming-and-captions'))).code, 0);
  assert.equal(decide(call), null);
  // another session starts from nothing
  assert.match(decide({ ...call, session_id: 's2' }), /module-structure/);
  // read-only and check commands pass untouched
  for (const c of ['./mxcodr-live check mdlsource/fleet.mdl', './mxcodr-live query "SHOW MODULES"', './mxcli -p A.mpr -c "DESCRIBE ENTITY Fleet.Car"'])
    assert.equal(decide({ ...call, session_id: 's3', tool_input: { command: c } }), null, c);
});

test('a test spec needs durable-tests (Write, Edit, MultiEdit); other files and skills the app does not have are never asked for', () => {
  const d = app(['durable-tests', 'module-structure']);
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    const e = { session_id: 's1', cwd: d, tool_name: tool, tool_input: { file_path: path.join(d, 'tests', 'fleet', 'cars.spec.ts') } };
    assert.match(decide(e), /^mx-codr skill gate: This test file needs the project skill below[\s\S]*durable-tests/, tool);
  }
  assert.equal(decide({ session_id: 's1', cwd: d, tool_name: 'Write', tool_input: { file_path: path.join(d, 'tests', 'helpers.ts') } }), null);
  assert.equal(decide({ session_id: 's1', cwd: d, tool_name: 'Write', tool_input: { file_path: path.join(d, 'mdlsource', 'a.mdl') } }), null);
  // naming-and-captions is not in this app (switched off, say): only module-structure is asked for
  assert.deepEqual(skillsForCall(bash(d, './mxcli -p A.mpr -c "CREATE MODULE Fleet"'), d), ['module-structure', 'naming-and-captions']);
  const why = decide(bash(d, './mxcli -p A.mpr -c "CREATE MODULE Fleet"'));
  assert.match(why, /module-structure/);
  assert.doesNotMatch(why, /naming-and-captions/);
});

test('fail open: bad input, a script that is not there yet, a state that cannot be written, MXCODR_SKILL_GATE=0', () => {
  const d = app();
  assert.deepEqual(runHook('pre', '{not json'), { code: 0 });
  assert.deepEqual(runHook('pre', JSON.stringify({ tool_name: 'Bash' })), { code: 0 }, 'no folder to look in');
  assert.deepEqual(runHook('nonsense', JSON.stringify(bash(d, './mxcli -c "CREATE MODULE A"'))), { code: 0 });
  // the script is missing and the command says nothing more: nothing to classify, it runs
  assert.equal(decide(bash(d, './mxcodr-live exec mdlsource/missing.mdl')), null);
  // the switch
  const create = JSON.stringify(bash(d, './mxcli -p A.mpr -c "CREATE MODULE Fleet"'));
  assert.equal(runHook('pre', create).code, 2);
  assert.deepEqual(runHook('pre', create, { MXCODR_SKILL_GATE: '0' }), { code: 0 });
  // .mxcodr is a link: the read is not recorded, and nothing throws out of the hook
  const e = tmp();
  for (const s of Object.keys(GATED)) put(e, SKILL(s), 'x\n');
  fs.symlinkSync(tmp(), path.join(e, '.mxcodr'));
  assert.deepEqual(runHook('post', JSON.stringify(read(e, 'module-structure'))), { code: 0 });
  assert.deepEqual(readSkills(e, 's1'), []);
  // ... and since no read can be recorded there, nothing is refused there either
  assert.deepEqual(runHook('pre', JSON.stringify(bash(e, './mxcli -p A.mpr -c "CREATE MODULE Fleet"')), {}), { code: 0 });
  // a read-only state folder: the same
  const r = app();
  fs.mkdirSync(path.join(r, '.mxcodr', 'state'), { recursive: true });
  fs.chmodSync(path.join(r, '.mxcodr', 'state'), 0o500);
  try {
    if (process.getuid?.() !== 0) assert.deepEqual(runHook('pre', JSON.stringify(bash(r, './mxcli -p A.mpr -c "CREATE MODULE Fleet"')), {}), { code: 0 });
  } finally { fs.chmodSync(path.join(r, '.mxcodr', 'state'), 0o700); }
});

test('the state: one file per session under .mxcodr/state/ (ignored by git), a safe file name, old sessions pruned', () => {
  const d = app();
  assert.equal(path.basename(statePath(d, '../../etc/passwd')), 'skills-read-______etc_passwd');
  assert.equal(path.dirname(statePath(d, '../x')), path.join(d, '.mxcodr', 'state'));
  put(d, '.mxcodr/state/skills-read-old/app-security', '');
  const old = (Date.now() - 8 * 864e5) / 1000;
  fs.utimesSync(path.join(d, '.mxcodr/state/skills-read-old'), old, old);
  put(d, '.mxcodr/state/skills-read-recent/app-security', '');
  assert.deepEqual(markRead(d, 'abc', 'app-security'), ['app-security']);
  assert.deepEqual(markRead(d, 'abc', 'app-security'), ['app-security'], 'once');
  assert.equal(fs.readFileSync(path.join(d, '.mxcodr/state/.gitignore'), 'utf8'), '*\n');
  assert.ok(!fs.existsSync(path.join(d, '.mxcodr/state/skills-read-old')), 'a week-old record goes');
  assert.ok(fs.existsSync(path.join(d, '.mxcodr/state/skills-read-recent/app-security')));
});

test('Reads that run in parallel (the deny\'s files in one batch) are all recorded', async () => {
  const d = app();
  put(d, SKILL_GATE, fs.readFileSync(GATE, 'utf8'));
  const { spawn } = await import('node:child_process');
  const one = s => new Promise(res => {
    const c = spawn(process.execPath, [path.join(d, SKILL_GATE), 'post'], { env: { PATH: process.env.PATH }, cwd: d });
    c.on('close', res);
    c.stdin.end(JSON.stringify(read(d, s, {}, 'batch')));
  });
  const all = Object.keys(GATED);
  assert.deepEqual(await Promise.all([...all, ...all].map(one)), [...all, ...all].map(() => 0));
  assert.deepEqual(readSkills(d, 'batch').sort(), [...all].sort());
});

test('the hook as Claude Code runs it (file mode): sh, node on PATH, stdin in, exit 2 and the reason out; 0 once read', () => {
  const d = app();
  put(d, 'mdlsource/sec.mdl', 'CREATE MODULE ROLE Fleet.Manager;\nGRANT EXECUTE ON MICROFLOW Fleet.ACT_Save TO Fleet.Manager;\n');
  put(d, SKILL_GATE, fs.readFileSync(GATE, 'utf8'));
  const env = { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, CLAUDE_PROJECT_DIR: d, HOME: os.homedir() };
  const run = (mode, input) => spawnSync('sh', ['-c', fileModeCommand(mode)], { input, encoding: 'utf8', env, cwd: d });
  const call = JSON.stringify(bash(d, './mxcodr-live exec mdlsource/sec.mdl'));
  let r = run('pre', call);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stderr, `mx-codr skill gate: This model change needs the project skill below, not read yet in this session. Read each file whole with the Read tool (no offset or limit, one file per read, never cat or head), then check your script against it and run the same call again:\n  ${path.join(d, '.claude', 'skills', 'app-security', 'SKILL.md')}  (sign-in, roles, access, row isolation)\nThese project skills come before \`./mxcli syntax\` and before mxcli's own skills in .ai-context/skills/.\n`);
  assert.equal(run('post', JSON.stringify(read(d, 'app-security'))).status, 0);
  r = run('pre', call);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(run('pre', 'garbage').status, 0, 'fails open');
});

test('installSkillGate: the script in .mxcodr/, two hooks in settings.local.json in place of earlier ones; the person\'s settings kept; gone without Claude Code', () => {
  const d = tmp();
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };
  put(d, '.claude/settings.local.json', JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [mine] } }));
  assert.equal(installSkillGate(d, ['claude']), '.mxcodr/skill-gate.mjs (hooks in .claude/settings.local.json)');
  installSkillGate(d, ['claude', 'codex']);
  assert.equal(fs.readFileSync(path.join(d, SKILL_GATE), 'utf8'), fs.readFileSync(GATE, 'utf8'));
  const s = JSON.parse(fs.readFileSync(path.join(d, '.claude/settings.local.json'), 'utf8'));
  assert.deepEqual(s.permissions, { allow: ['Bash(npm test)'] });
  assert.deepEqual(s.hooks.PreToolUse, [mine, { matcher: PRE_MATCHER, hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.mxcodr/skill-gate.mjs" pre', timeout: 15 }] }], 'once, after the person\'s');
  assert.deepEqual(s.hooks.PostToolUse, [{ matcher: POST_MATCHER, hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.mxcodr/skill-gate.mjs" post', timeout: 15 }] }]);
  assert.deepEqual(s.hooks.SessionStart, [{ matcher: 'compact', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.mxcodr/skill-gate.mjs" reset', timeout: 15 }] }], 'bundle 2026.11.20: the reset after a compaction, once');
  assert.ok(fileModeCommand('pre').includes(MARK));
  // Claude Code no longer chosen: the script and the hooks go, the person's stay
  assert.equal(installSkillGate(d, ['codex']), null);
  assert.ok(!fs.existsSync(path.join(d, SKILL_GATE)));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, '.claude/settings.local.json'), 'utf8')), { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [mine] } });
  // a settings file that is not JSON is never overwritten
  put(d, '.claude/settings.local.json', '{bad');
  assert.throws(() => installSkillGate(d, ['claude']), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(d, '.claude/settings.local.json'), 'utf8'), '{bad');
  // the extension's commands replace the file mode's (one marker in both)
  const ext = withGateHooks(withGateHooks({}), m => `sh '/rt/live/translator/bin/guard.sh' ${MARK} ${m}`);
  assert.equal(ext.hooks.PreToolUse.length, 1);
  assert.equal(ext.hooks.SessionStart.length, 1);
  assert.match(ext.hooks.PreToolUse[0].hooks[0].command, /guard\.sh' skill-gate pre$/);
  assert.match(ext.hooks.SessionStart[0].hooks[0].command, /guard\.sh' skill-gate reset$/);
  assert.deepEqual(withoutGateHooks(ext), {});
});

test('the installer wires it: one bar step, the summary says what runs while the agent builds', () => {
  const src = fs.readFileSync(new URL('../overlay/install.mjs', import.meta.url), 'utf8');
  assert.match(src, /ui\.begin\('installing the skill gate'\);\n\s*let gate = null, gateErr = null;\n\s*try \{ gate = installSkillGate\(app, agents\); \}/);
  assert.doesNotMatch(src, /no hooks, no gate/);
  assert.match(src, /MXCODR_SKILL_GATE=0/);
});

// bundle 2026.11.20: after a compaction the model has only a summary of the skills it read; the gate counted them as read
test('a compaction clears this session\'s read skills (SessionStart source compact; PreCompact, PostCompact); other sessions and other SessionStarts keep them', () => {
  const d = app();
  for (const sess of ['s1', 's2']) for (const sk of ['app-security', 'durable-tests']) assert.equal(runHook('post', JSON.stringify(read(d, sk, {}, sess))).code, 0);
  assert.deepEqual(readSkills(d, 's1').sort(), ['app-security', 'durable-tests']);
  const start = (source, sess = 's1') => JSON.stringify({ session_id: sess, cwd: d, hook_event_name: 'SessionStart', source });
  for (const source of ['startup', 'resume', 'clear', 'fork']) {
    assert.deepEqual(runHook('reset', start(source)), { code: 0 });
    assert.equal(readSkills(d, 's1').length, 2, `${source} keeps them`);
  }
  assert.deepEqual(runHook('reset', start('compact')), { code: 0 }, 'nothing on stdout or stderr');
  assert.deepEqual(readSkills(d, 's1'), [], 'this session: read again');
  assert.ok(!fs.existsSync(statePath(d, 's1')));
  assert.deepEqual(readSkills(d, 's2').sort(), ['app-security', 'durable-tests'], 'another session keeps its own');
  // the gate asks again after the compaction
  put(d, 'mdlsource/sec.mdl', 'GRANT EXECUTE ON MICROFLOW Fleet.ACT_Save TO Fleet.Manager;\n');
  assert.equal(runHook('pre', JSON.stringify(bash(d, './mxcodr-live exec mdlsource/sec.mdl'))).code, 2);
  assert.equal(runHook('pre', JSON.stringify(bash(d, './mxcodr-live exec mdlsource/sec.mdl', 's2'))).code, 0);
  for (const ev of ['PreCompact', 'PostCompact']) {
    runHook('post', JSON.stringify(read(d, 'app-security', {}, 's3')));
    runHook('reset', JSON.stringify({ session_id: 's3', cwd: d, hook_event_name: ev, trigger: 'auto' }));
    assert.deepEqual(readSkills(d, 's3'), [], ev);
  }
  // Codex (its PreCompact hook): pre_compact, or no event name at all
  runHook('post', JSON.stringify(read(d, 'app-security', {}, 's4')));
  assert.equal(runHook('reset', JSON.stringify({ session_id: 's4', cwd: d }), process.env, { agent: 'codex' }).code, 0);
  assert.deepEqual(readSkills(d, 's4'), []);
  assert.equal(isCompaction({ hook_event_name: 'pre_compact' }), true);
  assert.equal(isCompaction({}), false, 'Claude Code: an input without an event name is not a compaction');
  assert.equal(isCompaction({ hook_event_name: 'UserPromptSubmit' }, { agent: 'codex' }), false);
});

test('reset fails open: bad input, no session, no state yet, a link, MXCODR_SKILL_GATE=0: exit 0, nothing removed outside', () => {
  const d = app();
  for (const input of ['garbage', '', 'null', '[]', JSON.stringify({ cwd: d, hook_event_name: 'SessionStart', source: 'compact' })]) assert.deepEqual(runHook('reset', input), { code: 0 }, input);
  assert.equal(clearReads(d, 's1'), false, 'no state folder yet');
  assert.equal(clearReads(null, 's1'), false);
  // a planted link for .mxcodr is never followed
  const elsewhere = tmp();
  put(elsewhere, 'state/skills-read-s1/keep', '');
  const linked = tmp();
  fs.symlinkSync(elsewhere, path.join(linked, '.mxcodr'));
  runHook('reset', JSON.stringify({ session_id: 's1', cwd: linked, hook_event_name: 'SessionStart', source: 'compact' }));
  assert.ok(fs.existsSync(path.join(elsewhere, 'state/skills-read-s1/keep')));
  // switched off: nothing happens
  runHook('post', JSON.stringify(read(d, 'app-security')));
  runHook('reset', JSON.stringify({ session_id: 's1', cwd: d, hook_event_name: 'SessionStart', source: 'compact' }), { MXCODR_SKILL_GATE: '0' });
  assert.deepEqual(readSkills(d, 's1'), ['app-security']);
  // as Claude Code runs it: sh, node, stdin; exit 0 and nothing printed, also for garbage
  put(d, SKILL_GATE, fs.readFileSync(GATE, 'utf8'));
  const env = { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, CLAUDE_PROJECT_DIR: d, HOME: os.homedir() };
  for (const input of ['garbage', JSON.stringify({ session_id: 's1', cwd: d, hook_event_name: 'SessionStart', source: 'compact' })]) {
    const r = spawnSync('sh', ['-c', fileModeCommand('reset')], { input, encoding: 'utf8', env, cwd: d });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
  }
  assert.deepEqual(readSkills(d, 's1'), [], 'the program cleared it');
  assert.equal(RESET_EVENT, 'SessionStart'); assert.equal(RESET_MATCHER, 'compact');
});

test('reinstall does not duplicate the reset; the person\'s own SessionStart hooks stay, and stay when ours go', () => {
  const mine = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo hello' }] };
  let cfg = { hooks: { SessionStart: [mine] } };
  cfg = withGateHooks(withGateHooks(withGateHooks(cfg)));
  assert.equal(cfg.hooks.SessionStart.length, 2);
  assert.deepEqual(cfg.hooks.SessionStart[0], mine);
  assert.equal(cfg.hooks.SessionStart.filter(e => JSON.stringify(e).includes(MARK)).length, 1);
  assert.deepEqual(withoutGateHooks(cfg), { hooks: { SessionStart: [mine] } });
});
