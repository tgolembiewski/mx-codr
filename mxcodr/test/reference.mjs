// The frozen copy the harness's parity test compares with (parity.test.mjs; spikes/studio-pro-ext/docs/readability/
// node.md, "Round 2"): the bundle (mxcodr/) at REF_COMMIT, read from git into a scratch folder once per test process.
// null when git or the commit is not there (a mirror of this repository has other commit ids: the parity test skips).
// A commit that changes what the bundle does, between two refactor steps, moves REF_COMMIT instead of listing changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// the readability refactor's round 2, harness area: the bundle at its start (c478827d), moved to 8efe6368 after the
// step that split tests/film.mjs and the skill gate into parts (bundle 2026.11.21.3, the app's file set changed)
// live.104: moved to the last commit of the red-team fixes (bundle 2026.11.21.4: tests/film.mjs runs ffmpeg and taskkill
// by their full paths)
// live.105: moved to the unsaved-changes bar's commit (bundle 2026.11.21.5: the live rule's conflict and save bullets),
// then to its follow-up (91a36b84: the save bullet a pointer only)
// live.106: moved to the drift commit (bundle 2026.11.21.6: the live rule's no change / drift / verify bullet)
export const REF_COMMIT = 'a843e353';
export const BUNDLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let made;
/** The frozen bundle's folder (it holds overlay/, test/, install.sh), or null. */
export function reference() {
  if (made === undefined) made = extract(REF_COMMIT);
  return made;
}
function extract(commit) {
  const top = spawnSync('git', ['-C', BUNDLE_DIR, 'rev-parse', '--show-prefix'], { encoding: 'utf8' });
  if (top.status !== 0) return null;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-harness-ref-')));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } });
  const tar = path.join(dir, 'ref.tar');
  const a = spawnSync('git', ['-C', BUNDLE_DIR, 'archive', '-o', tar, commit, '--', `:(top)${top.stdout.trim()}`]);
  if (a.status !== 0) return null;
  const out = path.join(dir, 'mxcodr');
  fs.mkdirSync(out);
  const x = spawnSync('tar', ['-xf', tar, '-C', out]); // git archive run from the bundle leaves its prefix out
  fs.rmSync(tar, { force: true });
  return x.status === 0 && fs.existsSync(path.join(out, 'overlay', 'install.mjs')) ? out : null;
}
