// Live mode: the same rule file and skills, for an app that Studio Pro has open (the mx-codr Studio Pro extension's
// pane). One source of truth: the v2 texts, plus the edits below, applied when the extension sets an app up
// (`live: true` in ruleText / writeRules / copySkills). File mode (the installer, live false) never reads this file,
// so its output stays byte for byte what it was.
//
// What changes in live mode, and why (measured 2026-11-05, harness-eval/results/stage3-live-harness-2026-11-05.md):
//   - a model change goes through `./mxcodr-live exec` (mxcli refuses to write an .mpr Studio Pro has open, and a
//     write behind its back would be lost at its next save);
//   - Studio Pro runs the app (`./mxcodr-live app run|restart|status|stop`): a second runtime from
//     `./mxcli run --local` would collide with Studio Pro's on port 8080;
//   - `./mxcli oql` cannot reach Studio Pro's run (its admin password is Studio Pro's): `./mxcodr-live oql` reads it
//     (live.48: the extension inside Studio Pro asks the runtime's admin API), and so does the kit (tests/mx.ts);
//     the count reads `unknown` only when that fails, and the done condition allows it then;
//   - `./mxcli marketplace install` writes the .mpr: `./mxcodr-live marketplace install` has Studio Pro import the module
//     itself (its internal Marketplace install, harness-eval/results/stage4f-marketplace-live-2026-11-06.md);
//   - MyFirstModule is the person's app's: dropped only after they said yes, renamed only by them in Studio Pro (the
//     live push does not rename a module, measured 2026-11-06).
// Each edit names the exact text it replaces and throws when that text is gone, so a change to a skill that
// breaks an edit fails the bundle's tests instead of silently shipping file-mode advice to live mode.
import fs from 'node:fs';
import path from 'node:path';

// The always-on rule file (templates/mxcodr.md, after the coverage swap when coverage is on).
export const RULE_EDITS = [
  ['shown it green with `sessions left: 0`.', 'shown it green with `sessions left: 0` (`unknown` only when `./mxcodr-live oql` cannot read Studio Pro\'s run).'],
  ['is green with `sessions left: 0`.', 'is green with `sessions left: 0` (`unknown` only when `./mxcodr-live oql` cannot read Studio Pro\'s run).'],
  ['Stop the app with\n`./mxcli run stop`, and', 'Stop the app with\n`./mxcodr-live app stop`, and'],
  // the affected tests instead of the whole suite (hundreds of browser tests must not block the work; the full suite is
  // the person's call: templates/live.md says how to propose it)
  ['then run the whole suite once as `npx playwright test --shuffle`\nin `tests/` and shown it green with',
    'then run `./mxcodr-live tests affected` (never the full suite\nunasked) and shown it green with'],
  ['`npx playwright test --shuffle` in `tests/` is green with', '`./mxcodr-live tests affected` is green (the full suite only when asked) with'],
  ['say you are done, run the whole suite once and show it passing.', 'say you are done, run `./mxcodr-live tests affected` and show it passing (`.claude/rules/mxcodr-live.md`).'],
];
// One edit of each group applies (the plain or the coverage text of the done sentence); every other edit must apply.
const ONE_OF = [new Set([0, 1]), new Set([3, 4])];
// The keep-tests rule (the rule file's first 7 lines, templates/keep-tests.md) as live mode writes it.
export const liveKeepTests = text => text.split(RULE_EDITS[5][0]).join(RULE_EDITS[5][1]);

// Per skill file (relative to overlay/skills/): [from, to] pairs.
export const SKILL_EDITS = {
  'durable-tests/SKILL.md': [
    // the affected tests, not the whole suite (templates/live.md: the full suite is the person's call)
    ['one worker, the whole suite early;', 'one worker, the affected tests early (the full suite when the person asks);'],
    ['2. **Run the whole suite once, shuffled**: `npx playwright test --shuffle` in `tests/`, in the foreground,\n   with a tool timeout longer than the run. Show its output passing, with `sessions left: 0` as its last\n   line; the random order proves the tests do not depend on order. If a test stays red, say which and why.',
      '2. **Run the affected tests**: `./mxcodr-live tests affected`, in the foreground, with a tool timeout longer\n   than the run. Show its last line, `affected: N run, N passed, 0 failed (M not selected)`, and `sessions left: 0`\n   (or `unknown`) above it; `tests status` shows the latest result of every test across runs, not this run. If a\n   test stays red, say which and why. Then propose the full suite with the line it prints; never start it unasked.'],
    // while working: only the test being worked on, never whole files (a test app, 2026-11-06: after a green
    // tests affected, `npx playwright test mastermind.spec.ts settings.spec.ts` ran 20 tests, 62 s, unasked)
    ['Run one spec file while you work on it (`npx playwright test orders.spec.ts` in `tests/`). ',
      'While you work on a test, run only that test (`./mxcodr-live tests run orders.spec.ts:42`, or `--grep \'<its title>\'`):\nit deploys a changed model first and lists each failure with its error and screenshot. Never a whole spec file or\nseveral; once `./mxcodr-live tests affected` is green, run nothing broader unless the person asks. '],
    ['4. Right after the first whole green run, the finishing steps above.', '4. Right after the first green `./mxcodr-live tests affected`, the finishing steps above.'],
    ['**After the second\nspec file is green, run the whole suite once, and again after every third file**: leaks, coupling between\ntests and order dependence show only across files',
      '**After the second\nspec file is green, run `./mxcodr-live tests affected`, and again after every third file**: leaks and coupling\nbetween tests show only across files'],
    ['checking each\n   script with `./mxcli check` before `exec`, and `./mxcli docker check -p App.mpr` once it compiles.',
      'checking each\n   script with `./mxcodr-live check` before `./mxcodr-live exec`, and `./mxcodr-live app status` (the model\'s errors, as Studio Pro counts them) once it compiles.'],
    ['2. Boot it: `./mxcli run --local` (`./mxcli run status`, `./mxcli run stop`). After a change,\n   `./mxcli exec x.mdl -p App.mpr && ./mxcli run wait -p App.mpr` returns when the change is applied\n   (exit 0) or the build failed (exit 1); entity and association changes make it restart the runtime\n   itself. No `sleep` after it, and none after `./mxcli run restart -p App.mpr` either: `./mxcli run wait\n   -p App.mpr` after it is enough.',
      '2. Studio Pro runs the app: `./mxcodr-live app run` starts it, and after a change updates it in place or\n   restarts it; it returns when the app answers (exit 0) or the deploy failed (exit 1). `./mxcodr-live app\n   status` prints whether it runs, its URL and the model\'s errors; `./mxcodr-live app restart` stops and runs\n   it again. No `sleep` after them. Never `./mxcli run`: a second runtime collides with Studio Pro\'s on port\n   8080. Put the URL `app status` prints into `tests/.env` as `APP_URL`.'],
    ['   Since mxcli 0.29 `docker check` checks the project as stored: a CE0463 "stale widget definition" is fixed\n   with `./mxcli fix widgets -p App.mpr` and then checked again; never use `--update-widgets` to decide it builds.',
      '   A CE0463 "stale widget definition" among those errors: run `./mxcodr-live fix widgets` (Studio Pro\'s own\n   Update all widgets); never `./mxcli fix widgets` (it writes the .mpr, which Studio Pro has open).'],
    ['After each\nfile\'s first green run, `./mxcli oql -p App.mpr --json "select count(s.ID) as N from System.Session as s"`\nanswers `[{"N":"0"}]`, or that file leaks a session.',
      'After each\nfile\'s first green run, `./mxcodr-live oql --json "select count(s.ID) as N from System.Session as s"`\nanswers `[{"N":"0"}]` (it reads Studio Pro\'s run; the teardown\'s `sessions left:` line is the same count), or that file leaks a session.'],
    // Studio Pro has node but no npm: the extension's setup puts Playwright in tests/node_modules
    ['- Install with `npm install` in `tests/` (the kit\'s `package.json` pins `@playwright/test` 1.64.1; do not\n  install another version).',
      '- Playwright is already in `tests/node_modules`: the mx-codr extension\'s setup put it there (1.64.1, the\n  version the kit\'s `package.json` pins; Studio Pro has no npm: never install packages or run `npx`). When it\n  is missing, ask the person to press **Install Playwright** in the Tests tab, or Update mx-codr.'],
    ['If the limit is hit, run `./mxcli run restart -p App.mpr` and then\n`./mxcli run wait -p App.mpr`.',
      'If the limit is hit, run `./mxcodr-live app restart`.'],
    ['- Passwords of demo users are not in the model (`DESCRIBE DEMO USER` masks them); put them in\n  `tests/.env` as `DEMO_PASSWORD=...` (the kit reads it), never in a spec.',
      '- Passwords of demo users are not in the model (`DESCRIBE DEMO USER` masks them). When `tests/.env` has\n  no `DEMO_PASSWORD` (an app from Studio Pro\'s New App: random passwords nobody knows), set one yourself.\n  `./mxcodr-live query "SHOW PROJECT SECURITY"` must say `Demo Users Enabled: true` and a security level\n  other than `Off` (else a sign-in reads `unknown user`: `alter project security demo users on;` and the\n  level as `app-security` says go into the same script). Then generate a random password that meets the policy (`./mxcodr-live query "SHOW PROJECT SECURITY"`), write\n  it to `tests/.env` as `DEMO_PASSWORD=...` (git ignores that file) and set it on every demo user with\n  `./mxcodr-live exec` (`create or modify demo user \'<name>\' ( Password: \'<it>\', Entity: ..., UserRoles:\n  (...) );`, entity and roles as `DESCRIBE DEMO USER` prints them), then `./mxcodr-live app restart` (demo\n  users are written when the app starts). Never ask the person for a password, never print it, never put\n  it in a spec, a script you keep or the chat.'],
  ],
  'files-and-images/SKILL.md': [
    ['**A new app does not have the File Uploader. Install it yourself, now** -- headless, about a\nminute, before the first upload page',
      '**A new app does not have the File Uploader. Install it yourself, now** -- through Studio Pro, a few\nseconds, before the first upload page'],
    ['235351 is the File Uploader (publisher Mendix). The install repairs what a headless install leaves\n(CE0463) itself. It needs mxcli logged in (`./mxcli auth status`). When it is not, the install\nstops with the login message -- ask the person to run `./mxcli auth login` and wait; when nobody\ncan answer (an unattended run), report the upload as not built, with that reason.',
      '235351 is the File Uploader (publisher Mendix). Studio Pro imports it itself (its own Marketplace import:\nthe module, its widget and theme files, no F4). It needs Studio Pro signed in to the Mendix Platform and\nmxcli logged in for the version lookup; when one is missing the install stops and says what the person\nmust do (sign in to Studio Pro, or run `./mxcli auth login` themselves) -- ask them and wait; when nobody\ncan answer (an unattended run), report the upload as not built, with that reason.'],
    ['After an exec that writes a `fileuploader`, run `./mxcli fix widgets -p App.mpr`; without it the\nbuild fails with CE0463.',
      'After an exec that writes a `fileuploader`, `./mxcodr-live app status` counts the model\'s errors: on a\nCE0463 (stale widget definition) run `./mxcodr-live fix widgets` (Studio Pro\'s own Update all widgets;\n`./mxcli fix widgets` writes the .mpr, which Studio Pro has open).'],
    ['```bash\n./mxcli run stop -p App.mpr && ./mxcli marketplace install 235351 -p App.mpr && ./mxcli fix widgets -p App.mpr\n./mxcli run --local --watch --detach -p App.mpr      # boot again before the next test run\n```',
      '```bash\n./mxcodr-live marketplace install 235351     # Studio Pro imports it, then prints its error list\n```\n\nOnly when it refuses (a Studio Pro version it is not measured on, or Studio Pro reports an error): ask the\nperson to add **File Uploader** (publisher Mendix) from Studio Pro\'s Marketplace, wait until they say it\nis in, then go on (`./mxcodr-live query "SHOW MODULES"` shows it). The install refuses a module the app\nalready has; a newer version goes in with `./mxcodr-live marketplace update` (`.claude/rules/mxcodr-live.md`).'],
  ],
  'film-tests/SKILL.md': [
    ['Normal runs are not affected: `npx playwright test` records nothing and is not\nslowed',
      'Normal runs are not affected: `./mxcodr-live tests run` records no film and is not\nslowed'],
    ['- **Install the suite\'s packages first** if `film.mjs` says `@playwright/test`\n  is not installed: `npm install` in `tests/`.',
      '- **Playwright comes from the extension** if `film.mjs` says `@playwright/test`\n  is not installed: ask the person to press **Install Playwright** in the Tests\n  tab, or Update mx-codr (Studio Pro has no npm: never install packages or run `npx`).'],
    ['   with their numbers: ask the person, or pick the number that fits the request.\n4. **Give the path**',
      '   with their numbers: ask the person, or pick the number that fits the request.\n\n   In the mx-codr pane, film one test or a file\'s tests with\n   `./mxcodr-live tests film <file.spec.ts>[:line]` instead (`--pace <ms>` as\n   above): it records against Studio Pro\'s run, refuses while a test run goes\n   on, and the person sees it record in the pane\'s **Tests** tab and watches\n   the film there (**Watch film** opens it in a Studio Pro tab). The film is the\n   same `.mxcli/films/<title>.mp4` (or `.webm`). For every test, `node tests/film.mjs --all`.\n4. **Give the path**'],
    ['start it with\n  `./mxcli run --local --detach -p <app>.mpr` and `./mxcli run wait --ready -p <app>.mpr`,\n  then film.',
      'start it with\n  `./mxcodr-live app run` (Studio Pro\'s run; `./mxcodr-live app status` prints its URL),\n  then film.'],
  ],
  'module-structure/SKILL.md': [
    ['Under\n   `mxcli run --watch` a change to any of those restarts the runtime',
      'In a running app\n   a change to any of those restarts the runtime'],
    // MyFirstModule is in the person's app: ask before it goes, never rename it over the push (stage 4f, 2026-11-06:
    // RENAME MODULE on a copy rewrote 18 references in 4 documents, but push.mjs does not rename a module unit, so
    // Studio Pro would keep the old module and get references to the new name)
    ['## MyFirstModule goes once the app has its own module\n\nA new Mendix app starts with `MyFirstModule`: a `Home_Web` page, a `MyFirstLogic` microflow,\nan image collection and a `User` module role. It is scaffolding. As soon as the app has a\nmodule of its own with pages, remove it, so nothing in the app opens on the template\'s empty\nhome page and no role carries a module role that grants nothing:\n',
      '## MyFirstModule: ask the person before it goes\n\nA new Mendix app starts with `MyFirstModule`: a `Home_Web` page, a `MyFirstLogic` microflow,\nan image collection and a `User` module role. Here the app is the person\'s, open in Studio Pro:\n**never drop or rename `MyFirstModule` without asking them, and never in the turn you ask.**\n\n1. Is it still Mendix\'s untouched starter? All of these hold:\n   - `./mxcodr-live query "list modules"`: its row has 1 page, 1 microflow and 0 of everything else;\n   - `./mxcodr-live query "SHOW STRUCTURE DEPTH 2 IN MyFirstModule"` lists only `MyFirstLogic` and `Home_Web`;\n   - `DESCRIBE MICROFLOW MyFirstModule.MyFirstLogic` holds only its annotation and `return;`, and\n     `DESCRIBE PAGE MyFirstModule.Home_Web` is the template\'s (title `Homepage`, "Welcome to your homepage").\n\n   Anything else, or any doubt: it holds the person\'s work (step 3).\n2. The untouched starter, once the app has a module of its own with pages: ask "MyFirstModule is\n   Mendix\'s empty starter module; may I remove it? Its home page will move to <Module>.<Page>." Only\n   after a yes, in a later turn, remove it as below (`./mxcodr-live check`, then `./mxcodr-live exec`).\n   Without a yes it stays: run the script below without its last three lines (the home pages and the\n   menu still move to your own pages):\n'],
    ['To see what still uses it before the drop: `./mxcli -p app.mpr -c "list references to MyFirstModule.Home_Web"`\n(and the same for its other documents).',
      'To see what still uses it before the drop: `./mxcodr-live query "list references to MyFirstModule.Home_Web"`\n(and the same for its other documents).\n\n3. It holds the person\'s own documents or changes: never drop it. Look at what it holds (its entities,\n   pages, microflows), propose one or two names that fit it and say why (`Orders` for a module with\n   `Order` and `OrderLine`), and ask whether it may be renamed. The rename is the person\'s, in Studio\n   Pro (right-click the module in the App Explorer > Rename), which updates every reference. Never\n   `rename module` through `./mxcodr-live exec`: the push does not rename the module itself, so Studio\n   Pro would get references to a module that does not exist. When they say it is done,\n   `./mxcodr-live query "list modules"` shows the new name.'],
    ['- [ ] `MyFirstModule` is gone, and the administrators open on a page of the app\'s own module',
      '- [ ] `MyFirstModule` removed only after the person said yes (or renamed by them in Studio Pro), and the administrators open on a page of the app\'s own module'],
  ],
  // a newer version through the extension's update (2026-11-17): additions moved out first, edits re-applied
  'module-structure/reference/marketplace-ext.md': [
    ['After a Marketplace update, open the originals once and compare:',
      'A newer version goes in with `./mxcodr-live marketplace update <id|name>` (`.claude/rules/mxcodr-live.md`): it\nmoves what the app added to the module out first and runs its edits again afterwards (`Mode: TWO-WAY`: nothing\nis run again, the differing documents are saved for review). After an update,\nopen the originals once and compare:'],
  ],
  'spacing-and-layout/SKILL.md': [
    ['`./mxcli check` and `./mxcli exec` it (`choose-edit-mode`', '`./mxcodr-live check` and `./mxcodr-live exec` it (`choose-edit-mode`'],
  ],
  // the fingerprint through ./mxcodr-live (Standard allows it; a `node ...` line asks every time): the same
  // fingerprint.mjs, run by the extension on the saved model, as the panel's Docs tab computes it
  'app-docs/SKILL.md': [
    ['6. `node <this skill\'s folder>/fingerprint.mjs -p <app>.mpr`: the hashes', '6. `./mxcodr-live docs fingerprint`: the hashes'],
    ['`node <this skill\'s folder>/fingerprint.mjs -p <app>.mpr --check docs/app-docs.html` names the parts', '`./mxcodr-live docs check` names the parts'],
  ],
};

// A trace of every test: `./mxcodr-live tests affected` maps each test to the pages, microflows and entities it
// touched from it (the network with snapshots on: about +12% run time, 0.4 MB a test, measured 2026-11-06).
const TRACE_MARK = "./mxcodr-live tests affected";
const TRACE_LINES = `    // a trace of every test: what each test opens and calls, for ${TRACE_MARK}\n    trace: { mode: 'on', screenshots: false, snapshots: true, sources: false },\n`;

// The starter test kit (templates/tests/<file>) and tests/film.mjs: what they tell the agent to run, and the kit's
// config writes the reports the pane's Tests tab reads (.mxcodr/tests/), so the agent's own runs show up there.
// The live kit's progress reporter (playwright.config.ts): its path read from the record setup writes, since live.60
// put the extension's tools in the person's user folder and setup deletes <app>/.mxcodr/live. OLD_PROGRESS_LINE is
// what configs wired before bundle 2026.11.10.3 have (it never finds the reporter now); wireTestsTab puts PROGRESS_LINE there.
export const PROGRESS_LINE = "const PROGRESS = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(MXCODR, 'live-tool.json'), 'utf8')).progress ?? ''); } catch { return ''; } })();";
const OLD_TAB_TAIL = "\n// folder, ignored by git); without the extension the progress reporter is not there and is left out.\nconst MXCODR = path.join(__dirname, '..', '.mxcodr');\n" + "const PROGRESS = path.join(MXCODR, 'live', 'translator', 'src', 'pw-progress.cjs');";
export const OLD_PROGRESS_LINE = "const PROGRESS = path.join(MXCODR, 'live', 'translator', 'src', 'pw-progress.cjs');";
export const KIT_EDITS = {
  'mx.ts': [
    ['restart the runtime with ./mxcli run restart -p ${mprFile()})', 'restart the app with ./mxcodr-live app restart)'],
  ],
  'package.json': [
    ['"The app\'s Playwright suite. Run npm install here; the version is pinned (1.64.1 has --shuffle)."',
      '"The app\'s Playwright suite. The mx-codr extension\'s setup puts Playwright in node_modules (no npm needed); the version is pinned (1.64.1 has --shuffle)."'],
  ],
  'playwright.config.ts': [
    ["import { defineConfig } from '@playwright/test';\nimport { BASE } from './mx';",
      "import { defineConfig } from '@playwright/test';\nimport * as fs from 'node:fs';\nimport * as path from 'node:path';\nimport { BASE } from './mx';\n\n// The mx-codr pane's Tests tab reads each run's report and progress from <app>/.mxcodr/tests/ (the extension's\n// folder, ignored by git). The progress reporter is the extension's, in its own copy in the person's user folder:\n// setup names it in .mxcodr/live-tool.json; without the extension there is no record and it is left out.\nconst MXCODR = path.join(__dirname, '..', '.mxcodr');\n" + PROGRESS_LINE],
    ["  reporter: [['list']],",
      "  reporter: [['list'], ['json', { outputFile: path.join(MXCODR, 'tests', 'report.json') }], ...(fs.existsSync(PROGRESS) ? [[PROGRESS] as [string]] : [])],"],
    ["    actionTimeout: 20_000,\n  },",
      "    actionTimeout: 20_000,\n    // what the Tests tab shows for a failed test (its own runs also keep the failed test's video)\n    screenshot: 'only-on-failure',\n" + TRACE_LINES + "  },"],
  ],
};
export const FILM_EDITS = [
  ['so a normal `npx playwright test` records nothing and is not slowed.', 'so a normal run (`./mxcodr-live tests run`) records nothing and is not slowed.'],
  ["fail(`@playwright/test is not installed next to ${where.config}; run npm install in ${path.relative(process.cwd(), where.configDir) || '.'} first`);",
    "fail(`@playwright/test is not installed next to ${where.config}: press Install Playwright in the mx-codr pane's Tests tab, or Update mx-codr (Studio Pro has no npm)`);"],
  ['fail(`no app answers at ${url}; start it first: ./mxcli run --local --detach -p ${mpr} (then ./mxcli run wait --ready -p ${mpr})`);',
    'fail(`no app answers at ${url}; Studio Pro runs it: ./mxcodr-live app run (./mxcodr-live app status prints its URL; ${mpr})`);'],
];
export const liveKitText = (name, text) => (KIT_EDITS[name] ? apply(text, KIT_EDITS[name], `templates/tests/${name}`) : text);
export const liveFilmText = text => apply(text, FILM_EDITS, 'templates/film.mjs');

// The Tests tab's reporters in a Playwright config the app already has. copyTestKit writes a kit file when it is absent
// and replaces it only while its text is one mx-codr shipped (lib/kit-shipped.json), so an app whose
// tests/playwright.config.ts was written before KIT_EDITS existed (or in file mode) and then edited kept a config
// without them: the agent's own `npx playwright test` then wrote nothing the tab reads, and the tab showed
// a new spec as not run after the agent had run it green (a test app, 2026-11-06). Live setup wires them in:
//   - the kit's anchors are there (the plain kit, or the kit with the person's or agent's own changes elsewhere):
//     KIT_EDITS' import and reporter edits, the screenshot edit when its anchor is there too; the plain kit becomes
//     exactly the live kit text;
//   - else one single-line `reporter:` (an array or one name) and single-line imports: the same two reporters
//     spliced into that line, the same constants after the last import;
//   - else (a multi-line reporter, names that would collide): unchanged, with the reason (the setup prints it);
//   - and the trace line (TRACE_LINES) in its one-line `use: {` block, also in a config wired before it existed;
//     a config that sets its own `trace` keeps it (the map then comes from the tab's runs only), with the reason.
//   - and, in a config wired before bundle 2026.11.10.3, the old PROGRESS line (a path into <app>/.mxcodr/live) becomes PROGRESS_LINE.
// Everything else in the file stays as it was. -> { text, changed, what: ['progress', 'reporters', 'trace'], reason?, traceNote? }
const TAB_BLOCK = "\n// The mx-codr pane's Tests tab reads each run's report and progress from <app>/.mxcodr/tests/ (the extension's\n// folder, ignored by git). The progress reporter is the extension's, in its own copy in the person's user folder:\n// setup names it in .mxcodr/live-tool.json; without the extension there is no record and it is left out.\nconst MXCODR = path.join(__dirname, '..', '.mxcodr');\n" + PROGRESS_LINE;
const TAB_REPORTERS = "['json', { outputFile: path.join(MXCODR, 'tests', 'report.json') }], ...(fs.existsSync(PROGRESS) ? [[PROGRESS] as [string]] : [])";
export function wireTestsTab(text) {
  let out = text;
  const what = [];
  if (out.includes(OLD_PROGRESS_LINE)) { // wired before bundle 2026.11.10.3: the old comment too, when it is still there as written
    out = out.split(OLD_TAB_TAIL).join(TAB_BLOCK.slice(TAB_BLOCK.indexOf('\n// folder'))).split(OLD_PROGRESS_LINE).join(PROGRESS_LINE);
    what.push('progress');
  }
  if (!text.includes('.mxcodr')) {
    const r = wireReporters(text);
    if (!r.changed) return r;
    out = r.text;
    what.push('reporters');
  }
  const t = wireTrace(out);
  if (t.changed) { out = t.text; what.push('trace'); }
  if (!what.length) return t.reason ? { text, changed: false, traceNote: t.reason } : { text, changed: false };
  return { text: out, changed: true, what, ...(t.reason ? { traceNote: t.reason } : {}) };
}

function wireTrace(text) {
  if (text.includes(TRACE_MARK)) return { text, changed: false };
  if (/\btrace\s*:\s*(['"]on['"]|\{[^}\n]*\bmode\s*:\s*['"]on['"][^}\n]*\bsnapshots\s*:\s*true)/.test(text)) return { text, changed: false }; // theirs records the network already
  if (/\btrace\s*:/.test(text)) return { text, changed: false, reason: 'it sets its own trace' };
  const uses = [...text.matchAll(/^([ \t]*)use\s*:\s*\{[ \t]*$/gm)];
  if (uses.length !== 1) return { text, changed: false, reason: uses.length ? 'it has more than one use block' : 'it has no one-line `use: {`' };
  const [line, indent] = uses[0];
  const lines = TRACE_LINES.split('\n').filter(Boolean).map(l => `${indent}  ${l.trimStart()}`).join('\n');
  const at = uses[0].index + line.length;
  return { text: `${text.slice(0, at)}\n${lines}${text.slice(at)}`, changed: true };
}

function wireReporters(text) {
  if (/\b(MXCODR|PROGRESS)\b/.test(text) || /^\s*(import|const|let|var)\b[^\n]*\b(fs|path)\b/m.test(text)) return { text, changed: false, reason: 'it already has its own fs, path, MXCODR or PROGRESS' };
  const [imp, rep, shot] = KIT_EDITS['playwright.config.ts'];
  if (text.includes(imp[0]) && text.split(rep[0]).length === 2) {
    let out = text.replace(imp[0], imp[1]).replace(rep[0], rep[1]);
    if (out.includes(shot[0]) && !/\bscreenshot\s*:/.test(text)) out = out.replace(shot[0], shot[1]);
    return { text: out, changed: true };
  }
  const reps = [...text.matchAll(/^([ \t]*)reporter\s*:\s*(.*?),?[ \t]*$/gm)];
  if (reps.length !== 1) return { text, changed: false, reason: reps.length ? 'it names more than one reporter setting' : 'it has no reporter line' };
  const [line, indent, expr] = reps[0];
  let list;
  if (/^\[.*\]$/.test(expr)) list = /^\[\s*\]$/.test(expr) ? `[${TAB_REPORTERS}]` : `${expr.replace(/\s*,?\s*\]$/, '')}, ${TAB_REPORTERS}]`;
  else if (/^(['"])[a-z-]+\1$/.test(expr)) list = `[[${expr}], ${TAB_REPORTERS}]`;
  else return { text, changed: false, reason: `its reporter is not a one-line list (${expr.slice(0, 40)})` };
  const imports = [...text.matchAll(/^import\b[^\n]*;[ \t]*$/gm)];
  if (!imports.length) return { text, changed: false, reason: 'it has no one-line import' };
  const lastImport = imports[imports.length - 1];
  const at = lastImport.index + lastImport[0].length;
  const head = "import * as fs from 'node:fs';\nimport * as path from 'node:path';";
  let out = `${text.slice(0, at)}\n${head}\n${TAB_BLOCK}${text.slice(at)}`;
  out = out.replace(line, `${indent}reporter: ${list},`);
  return { text: out, changed: true };
}

function apply(text, edits, where, groups = []) {
  let out = text;
  const hit = groups.map(() => false);
  const groupOf = i => groups.findIndex(g => g.has(i));
  edits.forEach(([from, to], i) => {
    const g = groupOf(i);
    if (!out.includes(from)) {
      if (g >= 0) return;
      throw new Error(`${where} no longer has the text live mode replaces: ${JSON.stringify(from.slice(0, 80))}`);
    }
    if (g >= 0) hit[g] = true;
    out = out.split(from).join(to);
  });
  if (hit.some(h => !h)) throw new Error(`${where}: none of the done-sentence edits applied`);
  return out;
}

export const liveRuleText = text => apply(text, RULE_EDITS, 'templates/mxcodr.md', ONE_OF);

// The live edits of one copied skills folder (<app>/<dir>/<skill>/...).
export function liveSkills(skillsRoot, skills) {
  for (const [rel, edits] of Object.entries(SKILL_EDITS)) {
    if (!skills.includes(rel.split('/')[0])) continue;
    const f = path.join(skillsRoot, rel);
    fs.writeFileSync(f, apply(fs.readFileSync(f, 'utf8'), edits, `skills/${rel}`));
  }
}

// The second rule file in live mode: how to work while Studio Pro has the app open (templates/live.md).
export const LIVE_RULE_FILE = '.claude/rules/mxcodr-live.md';
