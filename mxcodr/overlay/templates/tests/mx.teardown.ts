// Runs once after the whole run (globalTeardown in playwright.config.ts): a test that did not sign out
// leaves its session alive on the server, and the trial runtime allows six, so the run's last line names a leak.
// When the app is not running (oql reads the running app) the count is unknown and the run is left as it was.
import { sessionsLeft, oql } from './mx';

// Prints `sessions left: N` and throws when N > 0: Playwright reports the error and exits 1 even when every
// test passed.
export default async function teardown() {
  let n: number;
  try { n = sessionsLeft(); } catch (e) {
    console.log(`sessions left: unknown (oql failed: ${(e as Error).message.split('\n')[0]})`);
    return;
  }
  console.log(`sessions left: ${n}`);
  if (n === 0) return;
  let users = 'unknown';
  try {
    users = oql('select u.Name as UserName from System.Session as s left join s/System.Session_User/System.User as u')
      .map(r => r.UserName || '(anonymous)').join(', ');
  } catch { /* the count above is the finding */ }
  // a spec that imports test from './mx' names its own leak; one that imports it from @playwright/test does not
  throw new Error(`${n} sessions left after the run, user(s): ${users}: a test leaked its session (signOut in test.afterEach; `
    + `import { test, expect } from './mx' to name the test). Fix the test; never silence this check.`);
}
