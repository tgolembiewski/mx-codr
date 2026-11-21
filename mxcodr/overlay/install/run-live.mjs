// The installer (overlay/install.mjs): running a slow tool without blocking, so the bar keeps moving.
import { spawn } from 'node:child_process';

// Runs a tool without blocking the event loop (the bar is redrawn meanwhile); every output line goes to onLine.
// -> Promise<{ status, stdout, stderr }>, status null when it could not start or ran past the timeout (then it is
// stopped by its own PID). After the tool exits its pipes get 2 s to close: a daemon it left behind may hold them
// (MxBuild's Gradle on Windows held mxcli's, v1).
export function runLive(cmd, args, { cwd, env = process.env, timeout = 600000, onLine = () => {} } = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', buf = '', finished = false, grace = null;
    let child;
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { resolve({ status: null, stdout: '', stderr: e.message }); return; }
    const feed = chunk => {
      buf += chunk;
      let n;
      while ((n = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, n);
        buf = buf.slice(buf[n] === '\r' && buf[n + 1] === '\n' ? n + 2 : n + 1);
        if (line.trim()) onLine(line);
      }
    };
    const killer = setTimeout(() => { child.kill(); }, timeout);
    const finish = status => {
      if (finished) return;
      finished = true;
      clearTimeout(killer); clearTimeout(grace);
      if (buf.trim()) onLine(buf);
      resolve({ status, stdout, stderr });
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { stdout += d; feed(d); });
    child.stderr.on('data', d => { stderr += d; feed(d); });
    child.on('error', e => { stderr += e.message; finish(null); });
    child.on('exit', (code, signal) => { grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(signal ? null : code); }, 2000); });
    child.on('close', (code, signal) => finish(signal ? null : code));
  });
}
