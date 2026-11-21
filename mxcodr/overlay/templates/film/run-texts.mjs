// Part of tests/film.mjs, the film recorder (its header says what it does and how to run it). The mx-codr installer
// writes it and this folder on every install: they are the bundle's, not the app's, and edits are overwritten.
// Here: the files a film run writes and removes again. The video settings, the temporary config, the
// timeline reporter and the wrapper around each filmed spec.
import { livePace, CARD_LIVE_MS, LIVE_HOLD_MS } from './timing.mjs';

// The video and its annotations while recording: the pointer and a frame around the element for livePace(pace) ms
// per action (no callout: no typed value shows), the test's title at the bottom.
export const HIGHLIGHT = 'outline: 3px solid rgba(255, 140, 0, 0.95); outline-offset: 2px; border-radius: 4px; background: rgba(255, 140, 0, 0.12); animation: none';
export function videoText(pace) {
  const live = livePace(pace);
  const show = live > 0
    ? `{ actions: { duration: ${live}, cursor: 'pointer', style: { title: 'display: none', highlight: ${JSON.stringify(HIGHLIGHT)} } }, test: { level: 'title', position: 'bottom' } }`
    : `{ test: { level: 'title', position: 'bottom' } }`;
  return `{ mode: 'on' as const, size: viewport, show: ${show} }`;
}

// The temporary config: the app's own config spread, plus the video and its annotations, and the reporter that keeps
// each test's timeline (its actions' times) for the slowing afterwards; nothing else changes.
export function filmConfigText({ baseImport, wrapDir, outputDir, timelineReporter, timelineFile, grep, pace }) {
  return `// written by tests/film.mjs for one film run and removed after it; the app's config is not changed
import { defineConfig } from '@playwright/test';
import base from ${JSON.stringify(baseImport)};

const viewport = (base.use && base.use.viewport) || { width: 1280, height: 800 };
const video = ${videoText(pace)};
export default defineConfig({
  ...base,
  testDir: ${JSON.stringify(wrapDir)},
  testMatch: '**/*',
  testIgnore: [],
  grep: new RegExp(${JSON.stringify(grep)}),
  grepInvert: undefined,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  repeatEach: 1,
  timeout: (base.timeout || 30_000) * 3,
  outputDir: ${JSON.stringify(outputDir)},
  reporter: [['list'], [${JSON.stringify(timelineReporter)}, { out: ${JSON.stringify(timelineFile)} }]],
  use: { ...base.use, video },
  projects: base.projects && base.projects.map(p => ({ ...p, use: { ...p.use, video } })),
});
`;
}

// The timeline reporter (a file film.mjs writes next to the config): one JSON line per test begin and end (its
// title path, status, video) and per Playwright call and fixture (start, duration). Times are this machine's clock,
// the same the wrapper's marks use.
export const TIMELINE_REPORTER = `// written by tests/film.mjs: each filmed test's timeline, for the slowing afterwards
const fs = require('node:fs');
class FilmTimeline {
  constructor(o) { this.out = o.out; }
  printsToStdio() { return false; }
  w(o) { try { fs.appendFileSync(this.out, JSON.stringify(o) + '\\n'); } catch { /* the film is then unslowed */ } }
  onTestBegin(test, result) { this.w({ k: 'begin', id: test.id, path: test.titlePath(), at: result.startTime.getTime() }); }
  onStepEnd(test, result, step) {
    if (step.category === 'pw:api' || step.category === 'fixture') this.w({ k: 'step', id: test.id, title: step.title, cat: step.category, start: step.startTime.getTime(), ms: step.duration });
  }
  onTestEnd(test, result) {
    const video = (result.attachments || []).find(a => a.name === 'video' && a.path);
    this.w({ k: 'end', id: test.id, path: test.titlePath(), status: result.status, video: video && video.path, at: Date.now() });
  }
}
module.exports = FilmTimeline;
`;

// One wrapper per filmed spec, named like it (the on-screen title shows the spec's own name): a short title card
// before each test, the marks the slowing needs, the short hold at its end, then the spec itself, imported unchanged.
// The marks (one JSON line each in `marks`): the card's start, every time the page goes to about:blank (the kit's
// sign-out), and the test function's end with whether the page is blank then. The end: Playwright runs the
// afterEach hooks innermost first, and the spec's import is evaluated before the wrapper's own hooks are registered,
// so no afterEach of the wrapper can run before the spec's sign-out. The wrapper's beforeEach adds the end to the
// callbacks Playwright awaits right after the test function ends, passed or failed, before any afterEach (the set its
// own screenshot: 'only-on-failure' uses; internal to Playwright, measured on 1.64.1, so looked for first).
// MXCODR_FILM_HOLD_MS tells the kit's signOut (tests/mx-impl.ts) to hold the same short time before it leaves the
// page; a page held once at its end, or already on about:blank, is not held again. Plain timers, not
// page.waitForTimeout: no step in the report or the trace.
export function wrapperText(importPath, pace, marks) {
  return `// written by tests/film.mjs for one film run and removed after it
import { test } from '@playwright/test';
import { appendFileSync } from 'node:fs';
process.env.MXCODR_FILM_HOLD_MS = '${LIVE_HOLD_MS}';
const held = globalThis[Symbol.for('mxcodr.film.held')] ??= new WeakSet();
const ended = new Set();
const mark = (testInfo, k, extra = {}) => { try { appendFileSync(${JSON.stringify(marks)}, JSON.stringify({ id: testInfo.testId, k, at: Date.now(), ...extra }) + '\\n'); } catch { /* unmarked: held at the video's end */ } };
const hold = async page => {
  if (held.has(page) || page.isClosed() || page.url() === 'about:blank') return;
  held.add(page);
  await new Promise(resolve => setTimeout(resolve, ${LIVE_HOLD_MS}));
};
const end = async (page, testInfo) => {
  if (ended.has(testInfo.testId)) return;
  ended.add(testInfo.testId);
  mark(testInfo, 'end', { blank: page.isClosed() || page.url() === 'about:blank' });
  await hold(page);
};
test.beforeEach(async ({ page }, testInfo) => {
  page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() === 'about:blank') mark(testInfo, 'blank'); });
  mark(testInfo, 'card');
  await page.screencast.showChapter(testInfo.title, { description: testInfo.titlePath.slice(0, -1).join(' › '), duration: ${CARD_LIVE_MS} });
  const atEnd = testInfo._onDidFinishTestFunctionCallbacks;
  if (atEnd && typeof atEnd.add === 'function') atEnd.add(() => end(page, testInfo));
});
// a Playwright without that set (or a beforeEach of the spec that failed before this one): the screen still there
test.afterEach(async ({ page }, testInfo) => { await end(page, testInfo); });
import ${JSON.stringify(importPath)};
`;
}
