// The installer's source as one text, for the tests that pin how main() and its steps are wired: overlay/install.mjs
// (main()) and its steps in overlay/install/ (round 2 of the readability refactor moved them there), in that order.
import fs from 'node:fs';

const overlay = new URL('../overlay/', import.meta.url);
export const installerSource = () => [
  fs.readFileSync(new URL('install.mjs', overlay), 'utf8'),
  ...fs.readdirSync(new URL('install/', overlay)).filter(f => f.endsWith('.mjs')).sort().map(f => fs.readFileSync(new URL(`install/${f}`, overlay), 'utf8')),
].join('\n');
