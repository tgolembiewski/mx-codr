// Atomic file writes and JSON reads.
import fs from 'node:fs';
import path from 'node:path';

export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export function readJson(file, dflt = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; }
}
