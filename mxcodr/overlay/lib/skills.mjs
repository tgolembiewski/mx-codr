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
];
// requirements-interview: kept trimmed in the bundle, not installed while run so1 is compared with sk2
// (sk2 had no such skill; owner decision 2026-10-31).
export const OPTIONAL_SKILLS = ['requirements-interview'];

// Skills an earlier bundle installed that this one removes from every skills folder.
export const RETIRED_SKILLS = ['test-first-delivery', 'film-tests'];
