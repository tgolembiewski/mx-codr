// The request archive: docs/requests/NN.md, word for word, each file's sha1 kept in installed.json.
// The writer is install.sh --request; nothing decomposes them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha1 = t => crypto.createHash('sha1').update(String(t)).digest('hex');
const dirOf = app => path.join(app, 'docs', 'requests');
const norm = t => String(t).replace(/\r\n/g, '\n').trim();

export function readRequests(app) {
  let files = [];
  try { files = fs.readdirSync(dirOf(app)).filter(f => /^\d+\.md$/.test(f)).sort(); } catch { /* none yet */ }
  return files.map(file => ({ file, raw: fs.readFileSync(path.join(dirOf(app), file), 'utf8') }));
}

// Saves a request as docs/requests/NN.md unless the same text is saved already. Returns the file
// name written, or null. requests: installed.json's map, updated in place.
export function saveRequest(app, text, by, requests) {
  if (!norm(text)) return null;
  const have = readRequests(app);
  if (have.some(r => norm(r.raw) === norm(text))) return null;
  const n = have.reduce((m, r) => Math.max(m, Number(r.file.slice(0, -3))), 0) + 1;
  const file = `${String(n).padStart(2, '0')}.md`;
  fs.mkdirSync(dirOf(app), { recursive: true });
  const raw = norm(text) + '\n';
  fs.writeFileSync(path.join(dirOf(app), file), raw);
  requests[file] = { sha1: sha1(raw), by, at: new Date().toISOString() };
  return file;
}
