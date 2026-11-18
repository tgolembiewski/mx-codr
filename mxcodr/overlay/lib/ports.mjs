// Is a TCP port free for an app to listen on? The same probe as the Studio Pro extension's microflow test runs
// (spikes/studio-pro-ext/translator/src/test-ports.mjs); the bundle is installed standalone and cannot import it.
//
// Measured on macOS 2026-11-16: a bind on 127.0.0.1 succeeds while `python -m http.server` holds *:<port> (IPv6
// dual-stack), so a bind alone calls a busy port free. A port is busy when a bind on 127.0.0.1 fails (a listener there,
// or a socket bound and not listening) or something answers a connect on 127.0.0.1 or ::1 (a listener on the wildcard
// address). No bind on the wildcard address: on Windows a program listening on all interfaces is what the firewall's
// "allow access" dialog is known for (not measured; a loopback bind is expected not to raise it). Windows is not
// measured yet.
import net from 'node:net';

/** Binds 127.0.0.1:port for a moment: true when that works. */
function bindsLoopback(port) {
  return new Promise(res => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => res(true)));
  });
}

/** Does anything accept a connect on host:port within ms? Never sends a byte. */
function answers(port, host, ms) {
  return new Promise(res => {
    const s = net.connect({ port, host });
    const done = v => { s.destroy(); res(v); };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Is the port free? The bind first and on its own: a connect while the probe's own listener is up would reach it
 * (measured in the extension: a free port read as busy). Then the two connects at once, each cut at ms. */
export async function portFree(port, { ms = 800 } = {}) {
  if (!(await bindsLoopback(port))) return false;
  const [v4, v6] = await Promise.all([answers(port, '127.0.0.1', ms), answers(port, '::1', ms)]);
  return !v4 && !v6;
}
