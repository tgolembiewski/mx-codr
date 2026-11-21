// Live mode's tests (live.test.mjs, live-kit.test.mjs, live-skillsoff.test.mjs): what they share. A throwaway app, every
// file under a folder, and the file-mode commands no live text may keep.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-live-')); fs.writeFileSync(path.join(d, 'App.mpr'), 'mpr'); return d; };
export const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; };
// file-mode commands that must not reach the live texts (a run of the app, or a write to the open .mpr)
export const FILE_MODE = [/\.\/mxcli run (--local|stop|restart|wait)/, /\.\/mxcli exec/, /mxcli run --watch/, /\.\/mxcli marketplace install \d/, /mxcli fix widgets -p/, /\.\/mxcli auth status/, /\.\/mxcli oql -p/];
// `./mxcli auth login` stays in the live texts only as the person's step (mxcli's login for the version lookup)
