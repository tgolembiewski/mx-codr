// Which agents the install is for (overlay/lib/agents.mjs): asked on a terminal without --agent, the last
// install's agents as the default, --agent adds, removal only when chosen, a note when nothing was asked, and a
// start line per agent in the summary. A Pi session once ran without the harness because the install defaulted
// to Claude Code without saying so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideAgents, answerAgents, parseAgentList, askAgents, agentStartLines, agentsNote } from '../overlay/lib/agents.mjs';
import { writeRules, copySkills, summary } from '../overlay/install.mjs';
import { makeUi } from '../overlay/lib/ui.mjs';
import { INSTALLED_SKILLS } from '../overlay/lib/skills.mjs';
import { START, AGENTS as RULE_AGENTS } from '../overlay/lib/rules.mjs';
import { AGENTS } from '../overlay/lib/agents.mjs';

const src = fs.readFileSync(new URL('../overlay/install.mjs', import.meta.url), 'utf8');

test('the question is asked only on a terminal, without --agent, --remove-agent or --yes', () => {
  assert.equal(decideAgents({ tty: true }).how, 'ask');
  assert.equal(decideAgents({ tty: false }).how, 'default');
  assert.equal(decideAgents({ tty: true, yes: true }).how, 'default');
  assert.equal(decideAgents({ tty: true, flag: 'pi' }).how, 'flag');
  assert.equal(decideAgents({ tty: true, remove: 'pi', prev: { agents: ['claude', 'pi'] } }).how, 'kept');
  // main() feeds it the real terminal state and the flags, and asks with askAgents before the theme question
  assert.match(src, /const tty = Boolean\(process\.stdin\.isTTY && process\.stdout\.isTTY\)/);
  assert.match(src, /decideAgents\(\{ flag: argv\.includes\('--agent'\)[^\n]*tty, yes: argv\.includes\('--yes'\) \}\)/);
  assert.match(src, /if \(picked\.how === 'ask'\) picked = await askAgents[\s\S]*if \(choice\.how === 'ask'\) choice = \{ name: await askTheme/);
  assert.doesNotMatch(src, /parseAgents\(opt\('--agent'\) \|\| prev\.agents/, 'the old silent default is gone');
});

test('the default: the last install\'s agents, else Claude Code', () => {
  assert.deepEqual(decideAgents({ tty: true }).agents, ['claude']);
  assert.deepEqual(decideAgents({ tty: true, prev: { agents: ['pi'] } }).agents, ['pi']);
  assert.deepEqual(decideAgents({ prev: { agents: ['pi', 'claude'] } }).agents, ['claude', 'pi']);
  assert.deepEqual(answerAgents('', { agents: ['pi'] }).agents, ['pi'], 'Enter keeps the last install\'s');
  assert.deepEqual(answerAgents('').agents, ['claude'], 'Enter on a first install is Claude Code');
});

test('the answer: numbers, names, mixed, spaces; unknown ones are refused', () => {
  assert.deepEqual(parseAgentList('1,5'), ['claude', 'pi']);
  assert.deepEqual(parseAgentList('5, 1'), ['claude', 'pi']);
  assert.deepEqual(parseAgentList('pi'), ['pi']);
  assert.deepEqual(parseAgentList('Pi Claude'), ['claude', 'pi']);
  assert.deepEqual(parseAgentList('Claude Code, 2'), ['claude', 'cursor']);
  assert.deepEqual(parseAgentList('cursor-agent'), ['cursor']);
  assert.deepEqual(parseAgentList('', ['codex']), ['codex']);
  assert.throws(() => parseAgentList('6'), /unknown agent 6/);
  assert.throws(() => parseAgentList('gemini'), /unknown agent gemini/);
  assert.throws(() => decideAgents({ flag: '' }), /--agent needs/);
  assert.deepEqual([...AGENTS].sort(), [...RULE_AGENTS].sort(), 'the question lists every agent the rules know');
});

test('askAgents: the numbered list, the default in brackets, a wrong answer asked again', async () => {
  let text = '';
  const answers = ['7', '1,5'];
  const prompts = [];
  const rl = { question: async p => { prompts.push(p); return answers.shift(); } };
  const r = await askAgents({ rl, write: t => { text += t; }, prev: { agents: ['pi'] } });
  assert.deepEqual(r.agents, ['claude', 'pi']);
  assert.deepEqual(r.added, ['claude']);
  assert.deepEqual(r.removed, []);
  assert.match(text, /Which coding agent\(s\) will work in this app\?/);
  for (const [n, name] of [[1, 'Claude Code'], [2, 'Cursor'], [3, 'Codex'], [4, 'opencode'], [5, 'Pi']]) assert.match(text, new RegExp(`\\n    ${n}  ${name} `));
  assert.match(text, /5  Pi +pi +installed here now/);
  assert.equal(prompts[0], '\n  Agents [5]: ');
  assert.equal(prompts.length, 2);
  assert.match(text, /Type numbers from the list/);
});

test('with --yes or no terminal: a note names the agent and how to add another', () => {
  assert.equal(agentsNote(['claude']), 'installed for Claude Code only; another agent finds nothing here. To add one: ./mxcodr/install.sh --agent pi');
  assert.match(agentsNote(['pi']), /installed for Pi only; .* --agent claude$/);
  assert.match(src, /if \(picked\.how === 'kept' \|\| picked\.how === 'default'\) warn\(agentsNote\(agents\)\)/);
});

test('re-running with another --agent adds it: Claude Code\'s rule and skills stay, Pi\'s block and skills come', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-agents-'));
  fs.writeFileSync(path.join(d, 'App.mpr'), 'mpr');
  const first = decideAgents({ flag: 'claude' });
  writeRules(d, first.agents); copySkills(d, first.agents);
  const again = decideAgents({ flag: 'pi', prev: { agents: first.agents } });
  assert.deepEqual(again.agents, ['claude', 'pi']);
  assert.deepEqual(again.added, ['pi']);
  assert.deepEqual(again.removed, []);
  writeRules(d, again.agents); copySkills(d, again.agents);
  assert.ok(fs.existsSync(path.join(d, '.claude/rules/mxcodr.md')), 'claude\'s rule stays');
  assert.ok(fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8').includes(START), 'Pi\'s block in AGENTS.md');
  for (const s of INSTALLED_SKILLS) {
    assert.ok(fs.existsSync(path.join(d, '.claude/skills', s, 'SKILL.md')), `.claude/skills/${s}`);
    assert.ok(fs.existsSync(path.join(d, '.agents/skills', s, 'SKILL.md')), `.agents/skills/${s}`);
  }
  // removing is explicit: deselecting on the terminal, or --remove-agent
  assert.deepEqual(answerAgents('5', { agents: ['claude', 'pi'] }).removed, ['claude']);
  const rm = decideAgents({ remove: 'claude', prev: { agents: ['claude', 'pi'] } });
  assert.deepEqual([rm.agents, rm.removed], [['pi'], ['claude']]);
  assert.throws(() => decideAgents({ remove: 'pi', prev: { agents: ['pi'] } }), /no agent left/);
});

test('the summary: one start line per agent with its rule and skills, the restart line, added and removed named', () => {
  assert.deepEqual(agentStartLines(['pi', 'claude']), [
    ['claude', 'Claude Code', 'rule .claude/rules/mxcodr.md, skills .claude/skills/'],
    ['pi', 'Pi', 'rule in AGENTS.md (mxcodr block), skills .agents/skills/'],
  ]);
  assert.deepEqual(agentStartLines(['cursor'])[0], ['cursor-agent', 'Cursor', 'rule .cursor/rules/mxcodr.mdc, skills .cursor/skills/ (or open the folder in Cursor)']);
  assert.equal(agentStartLines(['opencode'])[0][2], 'rule in AGENTS.md (mxcodr block), skills .opencode/skills/');
  assert.equal(agentStartLines(['codex'])[0][0], 'codex');
  let text = '';
  const ui = makeUi({ out: { write: t => { text += t; } }, err: { write() {} }, env: {}, isTTY: false });
  summary({ app: '/apps/Shop', mpr: 'Shop.mpr', mxcli: '/bin/mxcli', ruleTargets: ['.claude/rules/mxcodr.md', 'AGENTS.md'], skillDirs: ['.claude/skills/', '.agents/skills/'], kit: { written: [] }, db: 'hsqldb', warnings: [], agents: ['claude', 'pi'], picked: { added: ['pi'], removed: ['cursor'] } }, ui);
  assert.match(text, /\n {7}claude {8}Claude Code  rule \.claude\/rules\/mxcodr\.md, skills \.claude\/skills\/\n/);
  assert.match(text, /\n {7}pi {12}Pi {11}rule in AGENTS\.md \(mxcodr block\), skills \.agents\/skills\/\n/);
  assert.match(text, /A session already open here must be restarted: skills are read when a session starts\./);
  assert.match(text, /agents +2 {2}Claude Code, Pi {2}\(Pi added now\)/);
  assert.match(text, /removed +1 {2}Cursor/);
});
