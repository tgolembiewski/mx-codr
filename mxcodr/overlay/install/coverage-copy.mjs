// The installer (overlay/install.mjs), section 5d: the coverage check (coverage on).
import fs from 'node:fs';
import path from 'node:path';
import { OVERLAY, rmIf } from './common.mjs';

// ---- 5d. the coverage check (coverage on) -------------------------------------------------------------------

// tests/coverage.mjs names the numbered requirements in docs/brain/plan/ that no test title cites. Like
// tests/film.mjs it is the bundle's: written on every install while coverage is on, removed when it is switched off.
export const COVERAGE = 'tests/coverage.mjs';
export const PLAN_DIR = 'docs/brain/plan';
export function copyCoverage(app, src = path.join(OVERLAY, 'templates', 'coverage.mjs')) {
  const f = path.join(app, COVERAGE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.rmSync(f, { force: true }); // a link or a read-only copy is replaced, not written through
  fs.copyFileSync(src, f);
  return COVERAGE;
}

// Coverage switched off on a reinstall (it was on last time): tests/coverage.mjs goes; the rule file and the
// skills were written plain already; docs/brain/ is the app's and stays. -> a line to print, or null.
export function coverageOff(app, prev) {
  if (prev.coverage !== true) return null;
  const gone = []; rmIf(app, COVERAGE, gone);
  return `coverage is off now: ${gone.length ? `removed ${COVERAGE}; ` : ''}the rule file and durable-tests are the plain ones again, docs/brain/ stays`;
}
