// The installer's port probe (overlay/lib/ports.mjs), used by the --boot smoke boot to pick its ports. 2026-11-16: a
// bind on 127.0.0.1 alone called a port free while `python -m http.server` held *:<port> on macOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { portFree } from '../overlay/lib/ports.mjs';

const listen = (port, host) => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen({ port, host }, () => res(s)); });
const close = s => new Promise(r => s.close(r));
const freeLoopbackPort = async () => { const s = await listen(0, '127.0.0.1'); const p = s.address().port; await close(s); return p; };

test('a closed port is free, and free again after the probe (the probe leaves no listener behind)', async () => {
  const p = await freeLoopbackPort();
  assert.equal(await portFree(p), true);
  assert.equal(await portFree(p), true);
});

test('a listener on 127.0.0.1 makes the port busy', async () => {
  const p = await freeLoopbackPort();
  const s = await listen(p, '127.0.0.1');
  try { assert.equal(await portFree(p), false); } finally { await close(s); }
  assert.equal(await portFree(p), true, 'free again after close');
});

test('a listener on the wildcard address (as python -m http.server binds) makes the port busy', async () => {
  const p = await freeLoopbackPort();
  let w;
  try { w = await listen(p, '::'); } catch { w = await listen(p, '0.0.0.0'); }
  try { assert.equal(await portFree(p), false); } finally { await close(w); }
  assert.equal(await portFree(p), true, 'free again after close');
});
