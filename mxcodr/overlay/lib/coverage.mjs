// Whether the agent is held to a test per requirement (plan docs/plans/built/plan-coverage-stage1.md). Off is the
// install as it was; on adds four things: the rule file's done sentence becomes "node tests/coverage.mjs shows
// 0 missing", requirements-interview is installed (numbered requirements in the project brain, promoted by the
// agent itself), durable-tests' first finishing step points at tests/coverage.mjs, and tests/coverage.mjs is
// written on every install. Asked once on a terminal, after the agent question; --coverage / --no-coverage
// decide without asking; no terminal and no flag: off. A choice made (asked or by flag) is recorded in
// installed.json and kept on a reinstall unless a flag changes it; an install that defaulted to off records
// nothing, so its installed.json is the one it always was.

// flag: --coverage, noFlag: --no-coverage. -> { on, how }: how 'flag', 'kept' (installed.json), 'ask' (on the
// terminal, on = the default offered), 'default' (off, not recorded).
export function decideCoverage({ flag = false, noFlag = false, prev = {}, tty = false, yes = false }) {
  if (flag && noFlag) throw Object.assign(new Error('--coverage and --no-coverage both given'), { fix: 'give one of them' });
  if (flag || noFlag) return { on: flag, how: 'flag' };
  if (typeof prev.coverage === 'boolean') return { on: prev.coverage, how: 'kept' };
  if (tty && !yes) return { on: false, how: 'ask' };
  return { on: false, how: 'default' };
}

// y/yes -> true, n/no/Enter -> false, else null (asked again).
export function answerCoverage(text) {
  const a = String(text ?? '').trim().toLowerCase();
  if (!a || a === 'n' || a === 'no') return false;
  if (a === 'y' || a === 'yes') return true;
  return null;
}

// The question, in the agent question's style. rl.question -> the answer; loops until it is yes or no.
export async function askCoverage({ rl, write }) {
  write('  Hold the agent to a test per requirement? (numbered requirements in the project brain,\n');
  write('  `node tests/coverage.mjs` must show 0 missing before it is done)\n');
  for (;;) {
    // a closed terminal rejects here and ends the install; only a wrong answer is asked again
    const on = answerCoverage(await rl.question('\n  Coverage [y/N]: '));
    if (on !== null) { write('\n'); return { on, how: 'asked' }; }
    write('  Type y or n (Enter is n).\n');
  }
}

// What installed.json records: the choice when one was made, nothing when it defaulted to off.
export const coverageRecord = c => (c.how === 'default' ? {} : { coverage: c.on });
