// The bundle's text templates (overlay/templates/), read by name. A leaf: rules.mjs (which re-exports it) and
// skills.mjs both read templates, and skills.mjs importing it from rules.mjs closed the cycle
// rules.mjs -> skilloff.mjs -> skills.mjs -> rules.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const templates = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
export const readTemplate = name => fs.readFileSync(path.join(templates, name), 'utf8');
