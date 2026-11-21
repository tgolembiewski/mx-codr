// Part of the skill gate (lib/skill-gate.mjs, whose header says what it does; the file-mode installer copies it to
// .mxcodr/skill-gate.mjs and this folder to .mxcodr/skill-gate/). Self-contained: node: modules and its own parts only.
// Here: what its parts share. The skills it can ask for, its mark in the hooks, its state folder, a file's text.
import fs from 'node:fs';

// The project skills the gate can ask for, with what each is for (the deny message names it).
export const GATED = {
  'module-structure': 'modules and folders',
  'naming-and-captions': 'names of documents, variables, widgets; captions',
  'app-security': 'sign-in, roles, access, row isolation',
  'spacing-and-layout': 'menu, Back, signed-in user, icons, spacing',
  'files-and-images': 'uploads, files and images',
  'java-action-docs': "every Java action's documentation",
  'durable-tests': 'what deserves a test and how',
};
// The text both hook commands contain, so the installer, the extension and the upgrade cleanup find our entries.
export const MARK = 'skill-gate';
export const STATE_DIR = '.mxcodr/state';

export const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
