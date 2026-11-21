// The installer (overlay/install.mjs): ports. Three free ones for the smoke boot, and whether Postgres answers.
import net from 'node:net';
import { portFree } from '../lib/ports.mjs';
import { die } from './screen.mjs';

// Ports for the smoke boot only (the agent boots the app itself later, on mxcli's defaults).
export async function bootPorts() {
  const free = p => portFree(p); // bind on 127.0.0.1, then connect on 127.0.0.1 and ::1 (lib/ports.mjs)
  if (await free(8080) && await free(8090) && await free(6543)) return { dflt: true };
  for (let p = 18080; p < 18980; p += 3) if (await free(p) && await free(p + 1) && await free(p + 2)) return { app: p, admin: p + 1, serve: p + 2 };
  die('no three free ports for the smoke boot', 'install without --boot');
}

export function reachable(port) {
  return new Promise(res => { const s = net.connect({ port, host: '127.0.0.1' }); s.setTimeout(800); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); s.once('timeout', () => { s.destroy(); res(false); }); });
}
