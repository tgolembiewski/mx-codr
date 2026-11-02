// Which coding agents the install is for, and what each one needs to start. v1 installed for every agent at once;
// v2 writes one rule file and one skills folder per chosen agent, so the choice matters: an agent that was not
// chosen finds nothing and builds without the harness. On a terminal with no --agent the installer asks
// (numbered list, several allowed, the last install's agents as the default); --agent ADDS to the last install's
// agents, --remove-agent takes one out, and with --yes or no terminal the last install's (else Claude Code) stay
// and a note says how to add another. Removing is only ever an explicit choice.
import { SKILLS_DIR } from './rules.mjs';

// The question's order (Claude Code 1 ... Pi 5): the numbers a person types.
export const AGENTS = ['claude', 'cursor', 'codex', 'opencode', 'pi'];

// The list the question shows: the name a person knows and the command that starts it.
export const AGENT_INFO = {
  claude: { name: 'Claude Code', start: 'claude' },
  cursor: { name: 'Cursor', start: 'cursor-agent', alt: 'or open the folder in Cursor' },
  codex: { name: 'Codex', start: 'codex' },
  opencode: { name: 'opencode', start: 'opencode' },
  pi: { name: 'Pi', start: 'pi' },
};
export const DEFAULT_AGENTS = ['claude'];

// Where each agent's always-on rule lands.
export const RULE_AT = { claude: '.claude/rules/mxcodr.md', cursor: '.cursor/rules/mxcodr.mdc', codex: 'AGENTS.md', opencode: 'AGENTS.md', pi: 'AGENTS.md' };

const order = list => AGENTS.filter(a => list.includes(a));
const bad = msg => Object.assign(new Error(msg), { fix: `use one or more of ${AGENTS.join(', ')} (or their numbers 1-${AGENTS.length})` });

// "claude,pi" / "1,5" / "1 5" / "Claude Code" -> ['claude', 'pi'] in list order; empty -> fallback. Throws on a
// word or number that names no agent.
export function parseAgentList(text, fallback = DEFAULT_AGENTS) {
  const words = String(text ?? '').trim().toLowerCase();
  if (!words) return order(fallback);
  const out = [];
  for (const w of words.replace(/claude code/g, 'claude').split(/[\s,;]+/).filter(Boolean)) {
    const a = /^\d+$/.test(w) ? AGENTS[Number(w) - 1] : AGENTS.find(x => x === w || AGENT_INFO[x].start === w);
    if (!a) throw bad(`unknown agent ${w}`);
    if (!out.includes(a)) out.push(a);
  }
  return order(out);
}

// What the install is for. flag = --agent's value (undefined: not given), remove = --remove-agent's.
// -> { agents, how, added, removed }, how: 'flag' (given), 'ask' (ask on the terminal, agents = the default to
// offer), 'kept' (the last install's, no question), 'default' (Claude Code, no question, no earlier install).
export function decideAgents({ flag, remove, prev = {}, tty = false, yes = false }) {
  const before = Array.isArray(prev.agents) ? order(prev.agents) : [];
  let agents, how;
  if (flag !== undefined) {
    const add = parseAgentList(flag, []);
    if (!add.length) throw bad('--agent needs one or more agents');
    agents = order([...before, ...add]); how = 'flag';
  }
  else if (tty && !yes && remove === undefined) return { agents: before.length ? before : DEFAULT_AGENTS, how: 'ask', added: [], removed: [] };
  else { agents = before.length ? before : DEFAULT_AGENTS; how = before.length ? 'kept' : 'default'; }
  if (remove !== undefined) {
    const gone = parseAgentList(remove, []);
    if (!gone.length) throw bad('--remove-agent needs one or more agents');
    agents = agents.filter(a => !gone.includes(a));
  }
  if (!agents.length) throw Object.assign(new Error('no agent left to install for'), { fix: 'keep at least one agent: --agent claude (or another)' });
  return withChanges(agents, before, how);
}

// The terminal's answer (the set the person wants now) -> the same shape as decideAgents.
export function answerAgents(text, prev = {}) {
  const before = Array.isArray(prev.agents) ? order(prev.agents) : [];
  return withChanges(parseAgentList(text, before.length ? before : DEFAULT_AGENTS), before, 'asked');
}

const withChanges = (agents, before, how) => ({ agents, how, added: before.length ? agents.filter(a => !before.includes(a)) : [], removed: before.filter(a => !agents.includes(a)) });

// The question, in the theme picker's style. rl.question -> the answer; loops until it names agents.
export async function askAgents({ rl, write, prev = {} }) {
  const def = Array.isArray(prev.agents) && prev.agents.length ? order(prev.agents) : DEFAULT_AGENTS;
  const defNums = def.map(a => AGENTS.indexOf(a) + 1).join(',');
  write('\n  Which coding agent(s) will work in this app?\n\n');
  const had = Array.isArray(prev.agents) ? prev.agents : [];
  AGENTS.forEach((a, n) => write(`    ${n + 1}  ${AGENT_INFO[a].name.padEnd(12)} ${AGENT_INFO[a].start.padEnd(13)}${had.includes(a) ? 'installed here now' : ''}`.trimEnd() + '\n'));
  write('\n    Several: 1,5. Each gets its own rule and skills; one not chosen finds nothing here.\n');
  for (;;) {
    // a closed terminal rejects here and ends the install; only a wrong answer is asked again
    const answer = await rl.question(`\n  Agents [${defNums}]: `);
    try { const r = answerAgents(answer, prev); write('\n'); return r; }
    catch { write(`  Type numbers from the list (e.g. 1,5) or names (e.g. claude,pi).\n`); }
  }
}

// The summary's line per agent: [start command, name, where its rule and skills are].
export function agentStartLines(agents) {
  return order(agents).map(a => {
    const i = AGENT_INFO[a];
    const rule = RULE_AT[a] === 'AGENTS.md' ? 'rule in AGENTS.md (mxcodr block)' : `rule ${RULE_AT[a]}`;
    return [i.start, i.name, `${rule}, skills ${SKILLS_DIR[a]}/${i.alt ? ` (${i.alt})` : ''}`];
  });
}

// The note when no question was asked and no --agent given: who it is for, and how to add another.
export function agentsNote(agents) {
  const other = agents.includes('pi') ? AGENTS.find(a => !agents.includes(a)) : 'pi';
  const names = agentNames(agents);
  if (!other) return `installed for ${names}`;
  return `installed for ${names} only; another agent finds nothing here. To add one: ./mxcodr/install.sh --agent ${other}`;
}

export const agentNames = list => order(list).map(a => AGENT_INFO[a].name).join(', ');
