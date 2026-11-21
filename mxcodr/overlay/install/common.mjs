// The installer (overlay/install.mjs, whose header says what it does): what its steps share. The overlay folder the
// defaults read the bundle's files from, the app's footprint folder, and the removal of a path the install no longer
// writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the overlay folder (this file's parent's): the defaults of copySkills, copyTestKit, copyFilm, ... read the bundle there
export const OVERLAY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FOOTPRINT = '.mxcodr';

export function rmIf(app, rel, out) {
  const f = path.join(app, rel);
  let there = false; try { fs.lstatSync(f); there = true; } catch { /* absent */ }
  if (!there) return;
  fs.rmSync(f, { recursive: true, force: true });
  out.push(rel);
}
