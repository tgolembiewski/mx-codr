// install.sh with no folder named, --help, --no-app, and creating the app when the folder has none (as v1 did).
// mxcli is never run: install.sh stops at --no-app before it is looked for, and createApp gets a fake runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newAppPlan, createApp, mergeInto, shortList, windowsStudioPros, DEFAULT_MX_VERSION } from '../overlay/install.mjs';

const bundle = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (p = 'newapp-test-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const walk = (root, d = root, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(root, p, out) : out.push(path.relative(root, p)); } return out.sort(); };
// an empty project folder holding a copy of the bundle, as the person sets it up
function project(name = 'proj') {
  const d = path.join(tmp(), name);
  fs.mkdirSync(d);
  fs.cpSync(bundle, path.join(d, 'mxcodr'), { recursive: true, filter: s => !s.includes(`${path.sep}test${path.sep}fixtures`) });
  return d;
}
const sh = (cwd, ...args) => spawnSync('bash', [path.join(cwd.split(`${path.sep}mxcodr`)[0], 'mxcodr', 'install.sh'), ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: process.env.PATH } });

test('install.sh --help prints the usage and exits 0', () => {
  const d = project();
  const r = sh(d, '--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: bash install\.sh \[<app folder>\]/);
  assert.match(r.stdout, /--no-app/);
});

test('install.sh is executable in git, so ./mxcodr/install.sh runs', () => {
  const r = spawnSync('git', ['ls-files', '-s', 'install.sh'], { cwd: bundle, encoding: 'utf8' });
  assert.match(r.stdout, /^100755 /);
});

test('no folder named: the current folder; --no-app on an empty one stops, says so and writes nothing', () => {
  const d = project();
  const before = walk(d);
  const r = sh(d, '--no-app');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`no Mendix app \\(\\.mpr\\) in ${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, and --no-app was given`));
  assert.deepEqual(walk(d), before);
});

test('no folder named, run from inside mxcodr/: the folder the bundle sits in', () => {
  const d = project();
  for (const cwd of [path.join(d, 'mxcodr'), path.join(d, 'mxcodr', 'overlay', 'lib')]) {
    const r = sh(cwd, '--no-app', '--yes');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(`no Mendix app (.mpr) in ${d},`), r.stderr);
  }
});

test('a named folder still comes first (the eval runner names it)', () => {
  const d = project(), other = tmp();
  const r = spawnSync('bash', [path.join(d, 'mxcodr', 'install.sh'), other, '--no-app'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(`no Mendix app (.mpr) in ${other},`), r.stderr);
});

test('more than one .mpr is still an error', () => {
  const d = project();
  put(d, 'A.mpr', ''); put(d, 'B.mpr', '');
  const r = sh(d);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /expected one \.mpr .* found 2/);
});

test('new app plan: name from the folder (App in front of a digit), 11.12.1 unless MX_VERSION, APP_NAME wins', () => {
  assert.deepEqual(newAppPlan('/x/38Coder-b2b Full', { env: {}, platform: 'darwin' }), { name: 'App38Coderb2bFull', version: DEFAULT_MX_VERSION });
  assert.equal(DEFAULT_MX_VERSION, '11.12.1');
  assert.deepEqual(newAppPlan('/x/Shop', { env: { MX_VERSION: '11.15.0', APP_NAME: 'Orders' }, platform: 'linux' }), { name: 'Orders', version: '11.15.0' });
  assert.throws(() => newAppPlan('/x/Shop', { env: { MX_VERSION: 'latest' }, platform: 'darwin' }), /not a Mendix version/);
  assert.throws(() => newAppPlan('/x/Shop', { env: { APP_NAME: 'my app' }, platform: 'darwin' }), /not a Mendix app name/);
});

// a stubbed Windows filesystem: Program Files has 11.12.1 and 11.15.0, the per-user folder 11.14.0, plus one without mx.exe
const winFs = {
  env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
  list: d => ({ 'C:\\Program Files\\Mendix': ['11.15.0.98765', '11.12.1.12345', '11.13.0.1'], 'C:\\Users\\me\\AppData\\Local\\Programs\\Mendix': ['11.14.0.555'] })[d] ?? (() => { throw new Error('ENOENT'); })(),
  exists: f => !f.includes('11.13.0') && f.endsWith('mx.exe'),
};

test('Windows: the installed Studio Pros are found in Program Files and per user, oldest first, only with mx.exe', () => {
  assert.deepEqual(windowsStudioPros(winFs).map(s => [s.version, s.perUser]), [['11.12.1', false], ['11.14.0', true], ['11.15.0', false]]);
});

test('Windows: 11.12.1 by default when its Studio Pro is there; another version only through MX_VERSION; none installed stops with the list', () => {
  const sp = () => windowsStudioPros(winFs);
  const p = newAppPlan('C:\\Apps\\Shop', { env: {}, platform: 'win32', studioPros: sp });
  assert.equal(p.version, '11.12.1');
  assert.equal(p.studioPro.mx, 'C:\\Program Files\\Mendix\\11.12.1.12345\\modeler\\mx.exe');
  assert.equal(newAppPlan('C:\\Apps\\Shop', { env: { MX_VERSION: '11.14.0' }, platform: 'win32', studioPros: sp }).studioPro.perUser, true);
  let err;
  try { newAppPlan('C:\\Apps\\Shop', { env: { MX_VERSION: '11.16.0' }, platform: 'win32', studioPros: sp }); } catch (e) { err = e; }
  assert.match(err.message, /no Studio Pro 11\.16\.0 installed/);
  assert.match(err.fix, /installed here: 11\.12\.1, 11\.14\.0, 11\.15\.0; run again with MX_VERSION=/);
  assert.throws(() => newAppPlan('C:\\Apps\\Shop', { env: {}, platform: 'win32', studioPros: () => [] }), e => /never installs it/.test(e.fix));
});

// a fake mxcli new: the scaffold in --output-dir, with names the folder may already have
const fakeNew = calls => (args, cwd) => {
  calls.push({ args, cwd });
  const out = args[args.indexOf('--output-dir') + 1];
  put(out, `${args[1]}.mpr`, 'mpr'); put(out, 'mprcontents/a.mxunit', 'u');
  put(out, 'README.md', 'scaffold readme'); put(out, '.claude/settings.json', '{}'); put(out, 'mxcli', 'linux binary');
  return { status: 0, stdout: '', stderr: '' };
};

test('createApp: mxcli new in a temporary folder, moved in; mxcodr/ and the folder\'s own files stay as they were', async () => {
  const d = project('38probe');
  put(d, 'README.md', 'mine'); put(d, '.claude/rules/own.md', 'own rule');
  const bundleBefore = walk(path.join(d, 'mxcodr'));
  const calls = [];
  const plan = newAppPlan(d, { env: {}, platform: 'darwin' });
  const lines = await createApp(d, plan, fakeNew(calls));
  assert.deepEqual(calls[0].args.slice(0, 4), ['new', 'App38probe', '--version', '11.12.1']);
  assert.ok(!calls[0].args.includes('--skip-build'));
  assert.ok(!calls[0].args[5].startsWith(d), 'created outside the folder');
  assert.equal(fs.readFileSync(path.join(d, 'App38probe.mpr'), 'utf8'), 'mpr');
  assert.ok(fs.existsSync(path.join(d, 'mprcontents/a.mxunit')));
  assert.equal(fs.readFileSync(path.join(d, 'README.md'), 'utf8'), 'mine');
  assert.equal(fs.readFileSync(path.join(d, '.claude/rules/own.md'), 'utf8'), 'own rule');
  assert.ok(fs.existsSync(path.join(d, '.claude/settings.json')), 'a folder on both sides is merged');
  assert.deepEqual(walk(path.join(d, 'mxcodr')), bundleBefore);
  assert.ok(!fs.existsSync(path.dirname(calls[0].args[5])), 'the temporary folder is gone');
  assert.match(lines.join('\n'), /Mendix app created: App38probe\.mpr \(Mendix 11\.12\.1\)/);
  assert.match(lines.join('\n'), /kept 1 file already in the folder \(the new app's copy left out\): README\.md$/m);
});

test('createApp: a failing mxcli new stops with its last lines and leaves the folder as it was', async () => {
  const d = project();
  const before = walk(d);
  await assert.rejects(createApp(d, { name: 'Shop', version: '11.12.1' }, () => ({ status: 1, stdout: '', stderr: 'mxbuild download failed: 404' })), /mxcli new failed: mxbuild download failed: 404/);
  assert.deepEqual(walk(d), before);
});

test('createApp on Windows: --skip-build with a Program Files Studio Pro; a per-user one creates with its mx.exe, then mxcli init', async () => {
  const d = project();
  const calls = [];
  await createApp(d, { name: 'Shop', version: '11.12.1', studioPro: { mx: 'C:\\PF\\mx.exe', perUser: false } }, fakeNew(calls));
  assert.ok(calls[0].args.includes('--skip-build'));
  const e = project(), mx = [], runs = [];
  await createApp(e, { name: 'Shop', version: '11.14.0', studioPro: { mx: 'C:\\Local\\mx.exe', perUser: true } }, (args, cwd) => { runs.push(args); return { status: 0 }; }, {
    runMx: (exe, args) => { mx.push([exe, ...args]); put(args[args.indexOf('--output-dir') + 1], 'Shop.mpr', 'mpr'); return { status: 0 }; },
  });
  assert.deepEqual(mx[0].slice(0, 4), ['C:\\Local\\mx.exe', 'create-project', '--app-name', 'Shop']);
  assert.equal(runs[0][0], 'init');
  assert.ok(fs.existsSync(path.join(e, 'Shop.mpr')));
});

// a fuller fake mxcli new: what it writes beside the app (skills, commands, settings, Eclipse files, CLAUDE.md...)
const MXCLI_MD = name => `<!-- mxcli:begin generated -->\n# Mendix Project: ${name}\n<!-- mxcli:end -->\n`;
const fakeScaffold = calls => (args, cwd) => {
  calls?.push({ args, cwd });
  const out = args[args.indexOf('--output-dir') + 1];
  put(out, `${args[1]}.mpr`, 'mpr'); put(out, 'mprcontents/new.mxunit', 'new unit');
  for (const s of ['agents', 'alter-page', 'create-page']) { put(out, `.ai-context/skills/${s}/SKILL.md`, `new ${s}`); put(out, `.claude/skills/${s}/SKILL.md`, `new ${s}`); }
  put(out, '.claude/commands/lint.md', 'new lint'); put(out, '.claude/settings.json', '{"new":1}');
  put(out, '.classpath', 'new classpath'); put(out, '.project', 'new project'); put(out, '.mxcli/widgets/a.json', 'new');
  put(out, '.gitignore', '# Mendix project\n/deployment/\n.mxcli/\n');
  put(out, 'CLAUDE.md', MXCLI_MD(args[1])); put(out, 'AGENTS.md', MXCLI_MD(args[1])); put(out, 'README.md', 'scaffold readme');
  for (let i = 0; i < 12; i++) put(out, `notes/n${i}.txt`, 'scaffold');
  return { status: 0, stdout: '', stderr: '' };
};
// the 38Coderb2bFull case: an earlier scaffold's dot-files left behind with no .mpr, plus files of the person's own
function leftoverFolder() {
  const d = project('38left');
  for (const s of ['agents', 'alter-page', 'create-page', 'retired-skill']) { put(d, `.ai-context/skills/${s}/SKILL.md`, `old ${s}`); put(d, `.claude/skills/${s}/SKILL.md`, `old ${s}`); }
  put(d, '.claude/commands/lint.md', 'old lint'); put(d, '.claude/settings.json', '{"old":1}');
  put(d, '.classpath', 'old classpath'); put(d, '.project', 'old project'); put(d, '.mxcli/widgets/a.json', 'old');
  put(d, '.gitignore', '# Mendix project\n.mxcli/\n');
  put(d, 'CLAUDE.md', MXCLI_MD('Old'));
  put(d, 'AGENTS.md', `${MXCLI_MD('Old')}\nMy own note for agents.\n`);
  put(d, '.claude/rules/own.md', 'own rule'); put(d, 'README.md', 'mine');
  for (let i = 0; i < 12; i++) put(d, `notes/n${i}.txt`, 'mine');
  return d;
}
const plan38 = { name: 'App38left', version: '11.12.1' };

test('createApp over an earlier scaffold\'s leftovers: mxcli\'s files get the new copies, own files stay, two short lines and the full list in .mxcodr/install.log', async () => {
  const d = leftoverFolder();
  const lines = await createApp(d, plan38, fakeScaffold());
  const read = rel => fs.readFileSync(path.join(d, rel), 'utf8');
  for (const s of ['agents', 'alter-page', 'create-page']) { assert.equal(read(`.ai-context/skills/${s}/SKILL.md`), `new ${s}`); assert.equal(read(`.claude/skills/${s}/SKILL.md`), `new ${s}`); }
  assert.equal(read('.claude/commands/lint.md'), 'new lint');
  assert.equal(read('.claude/settings.json'), '{"new":1}');
  assert.equal(read('.classpath'), 'new classpath');
  assert.equal(read('.mxcli/widgets/a.json'), 'new');
  assert.match(read('.gitignore'), /\/deployment\//, 'a .gitignore with only mxcli\'s lines is the new one');
  assert.match(read('CLAUDE.md'), /App38left/, 'a CLAUDE.md holding only mxcli\'s section is the new one');
  // the person's
  assert.match(read('AGENTS.md'), /My own note/);
  assert.equal(read('.claude/rules/own.md'), 'own rule');
  assert.equal(read('README.md'), 'mine');
  assert.equal(read('notes/n7.txt'), 'mine');
  assert.equal(read('.ai-context/skills/retired-skill/SKILL.md'), 'old retired-skill', 'a file only the folder has is left alone');
  assert.equal(read('App38left.mpr'), 'mpr');
  assert.ok(!fs.existsSync(path.join(d, '.mxcodr/merge-backup')));
  // the screen: no wall
  const text = lines.join('\n');
  for (const l of lines) assert.ok(l.length < 200, `short line: ${l}`);
  assert.match(text, /^replaced 13 files an earlier mxcli scaffold left here with the new app's copies \(list in \.mxcodr\/install\.log\)$/m);
  assert.match(text, /^kept 14 files already in the folder \(the new app's copy left out\): AGENTS\.md, README\.md, notes\/n0\.txt, notes\/n1\.txt, notes\/n10\.txt and 9 more \(list in \.mxcodr\/install\.log\)$/m);
  assert.doesNotMatch(text, /\.ai-context/);
  const log = read('.mxcodr/install.log');
  for (const rel of ['.ai-context/skills/agents/SKILL.md', '.classpath', '.gitignore', 'CLAUDE.md', 'notes/n11.txt', 'AGENTS.md']) assert.ok(log.includes(`  ${rel}\n`), rel);
});

test('createApp: a .gitignore with lines of the person\'s own, and a CLAUDE.md with their text, are kept', async () => {
  const d = leftoverFolder();
  put(d, '.gitignore', '# Mendix project\n.mxcli/\nmy-secrets/\n');
  put(d, 'CLAUDE.md', `${MXCLI_MD('Old')}\nAlways answer in Polish.\n`);
  const lines = await createApp(d, plan38, fakeScaffold());
  assert.match(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), /my-secrets/);
  assert.match(fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8'), /Polish/);
  assert.match(lines.join('\n'), /kept 16 files/);
});

test('createApp: a leftover mprcontents/ with no .mpr is moved aside whole, never mixed with the new app\'s units', async () => {
  const d = leftoverFolder();
  put(d, 'mprcontents/old.mxunit', 'old unit');
  const lines = await createApp(d, plan38, fakeScaffold());
  assert.deepEqual(fs.readdirSync(path.join(d, 'mprcontents')), ['new.mxunit']);
  assert.equal(fs.readFileSync(path.join(d, 'mprcontents.old/old.mxunit'), 'utf8'), 'old unit');
  assert.match(lines.join('\n'), /moved mprcontents\/ to mprcontents\.old\//);
});

test('mergeInto: the app moves last (mprcontents/, then the .mpr); a failure part-way undoes every move and restores the replaced leftovers', async () => {
  const d = leftoverFolder();
  const before = walk(d).map(rel => [rel, fs.readFileSync(path.join(d, rel), 'utf8')]);
  const top = fs.readdirSync(d).sort();
  const order = [];
  const failing = (s, dst) => mergeInto(s, dst, { move: (a, b) => { order.push(path.relative(dst, b)); if (b.endsWith('.mpr')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); fs.renameSync(a, b); return false; } });
  await assert.rejects(createApp(d, plan38, fakeScaffold(), { merge: failing }), /moving the new app into the folder failed \(EBUSY\); every move was undone/);
  assert.equal(order.at(-1), 'App38left.mpr');
  assert.equal(order.at(-2), 'mprcontents');
  assert.ok(order.length > 10);
  assert.deepEqual(walk(d).map(rel => [rel, fs.readFileSync(path.join(d, rel), 'utf8')]), before, 'the folder is exactly as it was');
  assert.deepEqual(fs.readdirSync(d).sort(), top, 'no empty folder left behind either');
});

test('createApp: Ctrl-C during the moves waits for them, then ends the run (130) with the app whole', () => {
  const d = leftoverFolder();
  const script = `
    import fs from 'node:fs';
    import { createApp, mergeInto } from ${JSON.stringify(new URL('../overlay/install.mjs', import.meta.url).href)};
    const put = (f, t) => { fs.mkdirSync(f.slice(0, f.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(f, t); };
    let sent = false;
    const merge = (s, d) => mergeInto(s, d, { move: (a, b) => { if (!sent) { sent = true; process.kill(process.pid, 'SIGINT'); } fs.renameSync(a, b); return false; } });
    await createApp(${JSON.stringify(d)}, { name: 'App38left', version: '11.12.1' }, args => {
      const out = args[args.indexOf('--output-dir') + 1];
      put(out + '/App38left.mpr', 'mpr'); put(out + '/mprcontents/u.mxunit', 'u');
      for (let i = 0; i < 50; i++) put(out + '/.ai-context/skills/s' + i + '/SKILL.md', 'new');
      return { status: 0 };
    }, { merge });
    console.log('not interrupted');
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 130, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /not interrupted/);
  assert.ok(fs.existsSync(path.join(d, 'App38left.mpr')), 'the app is whole');
  assert.ok(fs.existsSync(path.join(d, '.ai-context/skills/s49/SKILL.md')));
});

test('shortList: five names, then how many more and where the rest is', () => {
  assert.equal(shortList(['a', 'b'], 'x'), 'a, b');
  assert.equal(shortList(['1', '2', '3', '4', '5', '6', '7'], 'list in .mxcodr/install.log'), '1, 2, 3, 4, 5 and 2 more (list in .mxcodr/install.log)');
});
