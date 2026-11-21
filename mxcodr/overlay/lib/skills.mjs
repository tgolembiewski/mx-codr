import { readTemplate } from './templates.mjs';

// Which of overlay/skills/ the installer copies into the app. To switch an optional skill on,
// move its name from OPTIONAL_SKILLS to INSTALLED_SKILLS (one place; the tests follow).
export const INSTALLED_SKILLS = [
  'durable-tests',
  'app-security',
  'spacing-and-layout',
  'naming-and-captions',
  'module-structure',
  'reuse-and-snippets',
  'files-and-images',
  'film-tests',
  'java-action-docs',
  // installed always since 2026.11.14.2 (owner decision 2026-11-14; before: only with coverage on), file and live
  // mode: the agent records numbered requirements in the project brain before a bigger new request
  'requirements-interview',
  // installed always since 2026.11.15 (owner decision 2026-11-15), file and live mode: the app documentation
  // (docs/app-docs.html) on request, then updated at the end of every turn that changed the model
  'app-docs',
];
// None today; a skill kept in the bundle but not installed would go here.
export const OPTIONAL_SKILLS = [];

// The skills an install copies: the same list with coverage on or off since 2026.11.14.2. With coverage on only
// durable-tests' first finishing step changes, pointing at tests/coverage.mjs instead of a table the agent prints
// (templates/coverage-durable-tests.md).
export const skillsFor = ({ coverage = false } = {}) => (coverage, INSTALLED_SKILLS);
export const TABLE_STEP = /^1\. \*\*Close the suite against the request\.\*\*[\s\S]*?\(allowed and refused\)\.\n/m;
export function durableTestsForCoverage(text) {
  if (!TABLE_STEP.test(text)) throw new Error('durable-tests/SKILL.md no longer has step 1 **Close the suite against the request.** ... (allowed and refused).');
  return text.replace(TABLE_STEP, readTemplate('coverage-durable-tests.md'));
}

// Skills an earlier bundle installed that this one removes from every skills folder.
// film-tests was retired with v1's film.sh and came back in 2026.11.01.16 on the v2 kit (tests/film.mjs).
export const RETIRED_SKILLS = ['test-first-delivery'];
