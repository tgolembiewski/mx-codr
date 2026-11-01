// Playwright config for a Mendix app; yours to change. One runtime, one database and a licence of six
// sessions: every worker holds signed-in sessions, so one worker, in order.
import { defineConfig } from '@playwright/test';
import { BASE } from './mx';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // one worker: more pile up sessions past the trial runtime's six
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  // a Mendix page renders after its data arrives; 15 s covers a cold runtime
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  // prints the sessions left on the server and fails the run when a test leaked one
  globalTeardown: './mx.teardown.ts',
  use: {
    // every page.goto is relative (/p/...), so the suite runs against another port without edits
    baseURL: BASE, // APP_URL from the environment or tests/.env, else http://127.0.0.1:8080
    headless: true,
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 20_000,
  },
});
