// The installer (overlay/install.mjs): the project brain, on every install.
import fs from 'node:fs';
import path from 'node:path';

// The project brain must exist on every install (the agent captures requirements, open questions and findings into
// it; with coverage on, tests/coverage.mjs reads its plan): `mxcli brain init` when docs/brain/ is missing, never over
// one that exists. Exported for the Studio Pro extension's setup, which does not run main().
// run(args) runs the pinned mxcli (null: none to run). -> null (there already), or { ok, line }.
export function initBrain(app, mpr, run) {
  if (fs.existsSync(path.join(app, 'docs', 'brain'))) return null;
  if (!run) return { ok: false, line: `no docs/brain/ yet and no mxcli to create it; the agent runs ./mxcli brain init -p ${mpr} first` };
  const r = run(['brain', 'init', '-p', mpr]);
  if (r.status === 0 && fs.existsSync(path.join(app, 'docs', 'brain'))) return { ok: true, line: 'docs/brain/ created (mxcli brain init)' };
  return { ok: false, line: `mxcli brain init failed: ${`${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n').pop() || `exit ${r.status}`}; the agent runs ./mxcli brain init -p ${mpr} first` };
}
