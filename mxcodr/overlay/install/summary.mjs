// The installer (overlay/install.mjs): the summary it prints at the end.
import { PIN, BUNDLE } from '../lib/mx.mjs';
import { skillsFor } from '../lib/skills.mjs';
import { agentNames, agentStartLines, AGENT_INFO } from '../lib/agents.mjs';
import { FOOTPRINT } from './common.mjs';
import { ui } from './screen.mjs';
import { COVERAGE, PLAN_DIR } from './coverage-copy.mjs';

// ---- the summary: what landed, what to do now (v1's summary.sh, with v2's content) --------------------

// out: the ui to print with (the tests pass their own)
// brain: what initBrain returned (null: docs/brain/ was there already; undefined: not said, no row)
export function summary({ app, mpr, newApp, mxcli, downloaded, ruleTargets, skillDirs, kit, theme, db, dbName, request, warnings, agents, picked = { added: [], removed: [] }, coverage = false, brain }, out = ui) {
  const ui = out;
  const { c, i } = ui;
  const note = s => `${c.grey}${s}${c.reset}`;
  ui.clear();
  ui.line(`\n  ${c.green}${i.ok} Installed mx-codr ${BUNDLE}${c.reset}`);
  ui.line(`  ${c.grey}  ${i.arrow} ${app}${c.reset}`);

  ui.head(i.box, 'What landed');
  if (newApp) ui.row('app', 1, `${newApp.name}.mpr  ${note(`(created empty, Mendix ${newApp.version})`)}`);
  ui.row('mxcli', 1, `${mxcli}  ${note(`(${PIN}${downloaded ? ', downloaded' : ''}; ./mxcli is this one)`)}`);
  ui.row('agents', agents.length, `${agentNames(agents)}${picked.added.length ? `  ${note(`(${agentNames(picked.added)} added now)`)}` : ''}`);
  if (picked.removed.length) ui.row('removed', picked.removed.length, `${agentNames(picked.removed)}  ${note('(deselected: its rule and our skills were taken out)')}`);
  ui.row('rule', ruleTargets.length, `${ruleTargets.join('  ')}  ${note('(every session)')}`);
  ui.row('skills', skillsFor({ coverage }).length, `${skillDirs.join('  ')}  ${note("(beside mxcli's own)")}`);
  const upd = kit.updated?.length || 0;
  if (kit.written.length || upd) ui.row('test kit', kit.written.length + upd, `tests/  ${note(`(${upd ? `${upd} unedited from an earlier install updated; ` : ''}a file you edit is never overwritten)`)}`);
  else ui.row('test kit', 0, `tests/ already had them, nothing overwritten${kit.edited?.length ? `  ${note(`(${kit.edited.join(', ')} yours: the kit's fixes not in it)`)}` : ''}`);
  ui.row('film', 1, `tests/film.mjs  ${note('(node tests/film.mjs --list)')}`);
  if (brain !== undefined) ui.row('brain', brain && !brain.ok ? 0 : 1, brain && !brain.ok ? 'docs/brain/ not created  ' + note('(the agent runs ./mxcli brain init first)') : `docs/brain/  ${note(`(${brain ? 'created by mxcli brain init' : 'kept as it was'}; the app's, never overwritten)`)}`);
  if (coverage) ui.row('coverage', 'on', `${PLAN_DIR} + ${COVERAGE}  ${note('(a test per numbered requirement; 0 missing before done)')}`);
  ui.row('theme', theme && theme !== 'as-is' ? 1 : 0, `${theme && theme !== 'as-is' ? theme : 'as mxcli new made it'}  ${note('(node .mxcodr/theme.mjs changes it)')}`);
  ui.row('database', 1, `${db === 'postgres' ? `postgres, ${dbName}` : 'hsqldb'}  ${note('(MxBuild and the runtime cached)')}`);
  if (request) ui.row('request', 1, `${request}  ${note('(word for word)')}`);
  ui.row('record', 1, `${FOOTPRINT}/installed.json  ${note(`(bundle ${BUNDLE})`)}`);

  for (const w of warnings) ui.line(`\n  ${c.yellow}${i.warn}${c.reset} ${w}`);

  // the one thing to do now, first: the agent works in the app folder
  ui.head(i.play, 'Now');
  ui.line(`     ${c.bold}Start ${agents.length > 1 ? 'one of your agents' : 'your agent'} in the app folder and ask it for a feature:${c.reset}`);
  ui.line(`       cd "${app}"`);
  for (const [cmd, name, where] of agentStartLines(agents)) ui.line(`       ${cmd.padEnd(13)} ${name.padEnd(12)} ${note(where)}`);
  ui.line(`     ${c.bold}A session already open here must be restarted:${c.reset} skills are read when a session starts.`);

  const nextRows = [
    ['cd tests && npx playwright test', 'the suite the agent keeps (--shuffle before done)'],
    ['node tests/film.mjs --list', 'film a test, slowed so a person can follow'],
    ['node .mxcodr/theme.mjs', "change the app's look in seconds"],
    [`./mxcli run --local${db === 'hsqldb' ? ' --db-type hsqldb' : ''} -p ${mpr}`, 'boot the app yourself; ./mxcli run stop ends it'],
  ];
  // v1's column is 38 wide; a longer command (a long app name) widens it so the descriptions stay aligned
  const width = Math.max(38, ...nextRows.map(([cmd]) => cmd.length));
  ui.head(i.play, 'Next');
  for (const [cmd, what] of nextRows) ui.line(`     ${cmd.padEnd(width)} ${note(what)}`);

  ui.head(i.dot, 'Good to know');
  ui.line("     Why the restart: an agent's skill list is fixed when its session starts, so the skills this installer");
  ui.line('     just wrote are invisible to the session that ran it. Measured: a session that installed');
  ui.line('     and then built without restarting read twelve SKILL.md files by hand -- 216k characters,');
  ui.line('     36 commands, 6.5 minutes -- before its first real command. After a restart: 8 commands.');
  ui.line('     The agent reads the rule file by itself. One thing runs while it builds, in Claude Code only: the skill');
  ui.line('     gate refuses a model write or a test file until the project skill for it was read whole');
  ui.line(`     (${c.bold}MXCODR_SKILL_GATE=0${c.reset} in the environment Claude Code starts in switches it off).`);
  if (agents.includes('cursor')) ui.line(`     Cursor reads ${c.bold}.cursor/rules/mxcodr.mdc${c.reset} (alwaysApply); restart an open session to pick it up.`);
  if (agents.some(a => ['codex', 'opencode', 'pi'].includes(a))) ui.line(`     Codex, opencode and Pi read our block in ${c.bold}AGENTS.md${c.reset}, after mxcli's section.`);
  ui.line(`     Another agent: ${c.bold}bash mxcodr/install.sh --agent <name>${c.reset} adds it (${Object.keys(AGENT_INFO).join(', ')}); --remove-agent <name> takes one out.`);
  ui.line(`     Run ${c.bold}bash mxcodr/install.sh${c.reset} again to repair or upgrade; your tests/ files stay.`);
  ui.line('');
}
