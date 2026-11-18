import { readTemplate } from './rules.mjs';

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
];
// requirements-interview: kept trimmed in the bundle, not installed while run so1 is compared with sk2
// (sk2 had no such skill; owner decision 2026-10-31).
export const OPTIONAL_SKILLS = ['requirements-interview'];

// With coverage on (the installer's question, --coverage): requirements-interview is installed too, so the agent
// records numbered requirements, and durable-tests' first finishing step points at tests/coverage.mjs instead of
// a table the agent prints (templates/coverage-durable-tests.md). Coverage off: the list and the text as above.
export const skillsFor = ({ coverage = false } = {}) => (coverage ? [...INSTALLED_SKILLS, ...OPTIONAL_SKILLS] : INSTALLED_SKILLS);
export const TABLE_STEP = /^1\. \*\*Close the suite against the request\.\*\*[\s\S]*?\(allowed and refused\)\.\n/m;
export function durableTestsForCoverage(text) {
  if (!TABLE_STEP.test(text)) throw new Error('durable-tests/SKILL.md no longer has step 1 **Close the suite against the request.** ... (allowed and refused).');
  return text.replace(TABLE_STEP, readTemplate('coverage-durable-tests.md'));
}

// Skills an earlier bundle installed that this one removes from every skills folder.
// film-tests was retired with v1's film.sh and came back in 2026.11.01.16 on the v2 kit (tests/film.mjs).
export const RETIRED_SKILLS = ['test-first-delivery'];
