# mx-codr harness (v2, skills only)

Bundle **2026.11.01.16** (`overlay/lib/mx.mjs`, `BUNDLE`), pinned to mxcli **0.29.0** (`PIN`). The design is
`docs/plans/open/plan-harness-v2-skills-only.md` (owner decision 2026-10-31: the gate goes).

- Since 2026.11.01.16: `film-tests` is back as the eighth skill, with `tests/film.mjs` on the v2 kit, written on
  every install (see *Film a test*).
- Since 2026.11.01.12 (v1 features back): the installer offers six looks again (`--theme <name>`, or asked
  once on a terminal; `node .mxcodr/theme.mjs` changes it later; no terminal or `--yes` leaves the look
  as `mxcli new` made it). `spacing-and-layout` spells out the stacked-lists-in-tabs rule (the heading
  becomes the tab caption; side-by-side columns and lists already in a tab do not count; a phone form with
  its related list) and gives every chart `heightUnit: 'pixels', height: 360`.
- Since 2026.11.01.11 (installer probes of 2026-11-01): an `AGENTS.md` with no mxcli section (absent, or
  written by hand) gets mxcli's empty markers first and our block after them, and `mxcli init --sync-skills`
  now runs after our files so it fills that section; a later `mxcli init` keeps our block (and the text that was
  there). `installed.json` `testKit` lists the kit files that are the kit's, kept ones included (a reinstall
  wrote `[]`). With the person's own `tests/mx.ts` the kit's teardown and config, which import from it, are not
  written, and one line says so. A kept `tests/package.json` pinning another Playwright gets the pin hint.
- Since 2026.11.01.10 (after so4): the rule file ends on a hard finish condition (a table `requirement -> test
  that asserts it`, then one `npx playwright test --shuffle` run shown green with `sessions left: 0`, never
  silencing the kit); `signOut` never returns silently; specs that import `test` and `expect` from `./mx` get a
  per-test session check naming the leaking test and its users; `apiContext` stays plain (Basic-auth calls create
  no session, measured); `durable-tests` opens with the finishing steps; `app-security` no longer asks for a REST
  client document (CE7247).

A person installs this into a Mendix app once. From then on the coding agent that builds in the app reads
one short rule file on every turn and finds our skills next to mxcli's. It builds with mxcli, checks its own
work, keeps those checks as plain Playwright tests and shapes the app the way the skills describe.
**Nothing runs behind the agent's back**: no hooks, no refusals, no verdict, no settings edits.

## What is in the bundle

    install.sh                     checks Node >= 20, then runs overlay/install.mjs
    overlay/install.mjs            the installer
    overlay/lib/                   mx.mjs (PIN, BUNDLE), rules.mjs (rule file text and its format check),
                                   skills.mjs (which skills are installed), requests.mjs, cache.mjs,
                                   theme.mjs (the looks; copied into the app as .mxcodr/theme.mjs)
    overlay/themes/                catalog.json, per theme <name>.css (tokens) and <name>.skin.scss (frame),
                                   logos/<name>/, the preview page and its screenshots
    overlay/templates/mxcodr.md    the always-on rule file, 25 lines
    overlay/templates/keep-tests.md its first 7 lines, byte for byte the sk2 rule
    overlay/templates/tests/       the starter test kit
    overlay/templates/film.mjs     the film recorder, installed as tests/film.mjs
    overlay/skills/                our skills
    test/                          the bundle's own tests (node --test)

## What is installed, per agent

| agent (`--agent`) | always-on rule | our skills |
|---|---|---|
| Claude Code (`claude`, the default) | `.claude/rules/mxcodr.md` | `.claude/skills/<name>/` (beside mxcli's) |
| Cursor (`cursor`) | `.cursor/rules/mxcodr.mdc` (`alwaysApply: true`) | `.cursor/skills/<name>/` |
| Codex (`codex`), Pi (`pi`) | a block in `AGENTS.md` between `<!-- mxcodr:start -->` and `<!-- mxcodr:end -->`, after mxcli's section | `.agents/skills/<name>/` |
| opencode (`opencode`) | the same `AGENTS.md` block | `.opencode/skills/<name>/` (beside mxcli's) |

- **The rule file** (`overlay/templates/mxcodr.md`): the 7-line keep-tests rule, then how to write the suite
  on `tests/mx.ts`, prove a refusal as the wrong role without weakening the app, run the whole suite in the
  foreground, finish only after a table `requirement -> test that asserts it` and one green `--shuffle` run
  with `sessions left: 0` (never silencing the kit's checks), and stop processes only with `./mxcli run stop` or
  their own PID; last, one paragraph naming the skills by trigger word. The `.mdc` and the `AGENTS.md` block
  are made from it in `overlay/lib/rules.mjs`. The installer checks every file it writes: first byte `#`, no
  frontmatter (the `.mdc`: only Cursor's own), no body line equal to `---`, the first 7 body lines equal to
  the keep-tests rule. The `AGENTS.md` block is written only for Codex, opencode or Pi.
- **The skills** (`overlay/skills/`, the list in `overlay/lib/skills.mjs`):
  - `durable-tests`: what deserves a test, on the kit, one worker, the whole suite shuffled at the end;
    `reference/mendix-dom.md`, how Mendix renders for tests
  - `app-security`: Production security, roles, demo users, row isolation, refusals proven by attempt
  - `spacing-and-layout`: Atlas spacing, one layout, menu per role, Back, signed-in user, icons,
    stacked lists in tabs, totals as tiles, charts 360 px high
  - `naming-and-captions`: variable names, captions in business words, widgets `<Page>_<What><Type>`
  - `module-structure`: which module, the starting folders, `<Module>Ext` for Marketplace changes
  - `reuse-and-snippets`: reuse a microflow, share a page, extract a snippet
  - `files-and-images`: uploads, images, documents, a generated PDF
  - `film-tests`: lists the tests and films the one the person picks (or all), only when asked

  `requirements-interview` is in the bundle but **not installed**; to switch it on, move it from
  `OPTIONAL_SKILLS` to `INSTALLED_SKILLS`.
- **The starter test kit** (`overlay/templates/tests/`): `tests/mx.ts` (sign-in and sign-out that never leak
  a session, `test`/`expect` with a per-test session check that names the leaking test, `oql()` over `./mxcli oql --json`, `sessionsLeft`, grid rows, cells and filters, Combobox,
  inputs, dialogs, the menu, `apiContext`, recording and forging a button's call, `retrieveByIds`; each
  helper commented with the Mendix fact it relies on, no app names), `tests/mx.teardown.ts` (prints
  `sessions left: N`, fails the run on a leak and names the users), `tests/playwright.config.ts` (one worker, `baseURL` from
  `APP_URL`, the teardown) and `tests/package.json` (`@playwright/test` pinned to 1.64.1, which has
  `--shuffle`). Each file is written **only when absent** and is the app's own from then on. No
  `tests/playwright.config.ts` when the app has a Playwright config at its root, and no `tests/package.json`
  when it has a `package.json` or Playwright config there (the installer prints the pin to add instead).
  When `tests/mx.ts` is the person's own (not in the last `installed.json` and not the kit's text), the teardown
  and config, which import from it, are not written either; the installer says so (move `tests/mx.ts` aside and
  install again to get the kit). A kept `tests/package.json` that pins another `@playwright/test` gets the pin
  hint (`npm install -D -E @playwright/test@1.64.1` in `tests/`).
- **The film recorder** (`overlay/templates/film.mjs`): `tests/film.mjs`, written on **every** install and
  reinstall (unlike the kit it is the bundle's, so an edit there is replaced; it is written also when the kit is
  the app's own). v1's `tests/film.sh` is removed on upgrade.
- **`.mxcodr/`** holds `installed.json` (bundle, mxcli path and version, db, agents, skills, the kit files
  that are the kit's, written now or kept from before, `theme`, requests), `theme.mjs` and `themes/` (to
  change the look later) and `bin/mxcli` when mxcli had to be downloaded.

All of these survive `./mxcli init --all-tools` and `./mxcli init --sync-skills` (mxcli 0.29.0 rewrites
`settings.json`, `.cursorrules`, `opencode.json` and the inside of its own markers, none of which we touch).
`mxcli init` regenerates an `AGENTS.md` without its markers whole, so when the file is absent or has none the
installer writes mxcli's empty markers first and our block after them; `--sync-skills` then fills the section.
`test/init-survival.test.mjs` proves both when mxcli is on PATH.

## What the installer does

    bash mxcodr/install.sh <app folder> [--db hsqldb|postgres] [--agent claude[,cursor,codex,opencode,pi]] [--theme <name>] [--yes] [--boot] [--request <file>]

The app folder must already hold one `.mpr` (`mxcli new` makes one). On Windows, run it from Git Bash.

1. **mxcli**: a found mxcli 0.29.0 (the recorded one, PATH, the app's `./mxcli`), else a download into
   `.mxcodr/bin/`. `./mxcli` becomes that binary when it is an earlier bundle's shim, a link to nowhere, or a
   binary that does not run here (`mxcli new` on macOS can leave a Linux one); someone else's wrapper stays.
2. **Database**: `--db`, else the last install's, else postgres when port 5432 answers, else hsqldb.
3. **The app's look** (`overlay/lib/theme.mjs`): `--theme <number|name>`, else the last install's (its
   frame refreshed, the app's logo kept), else asked once when stdin is a terminal (the list in colour,
   the preview page opened, Enter = atlas). No terminal or `--yes`: nothing is applied and `installed.json`
   records `"theme": "as-is"`, so unattended eval runs keep `mxcli new`'s look. Whatever is recorded is
   not asked again on a later install; `--theme` or `node .mxcodr/theme.mjs` chooses then. Only files under
   `theme/` change, never the model; a failing mxcli is said, never fatal. See *Change the look later*.
4. **Caches**: `mxcli setup mxbuild` and `mxcli run --local --setup`, so the agent's first boot is fast.
5. **Upgrade cleanup**: removes what earlier bundles installed: the v2 gate (`./mxgate`, `.mxgate/`, whose
   downloaded mxcli moves to `.mxcodr/bin/` first), v1's rule files, `tools/mdl-checks/`, `tests/gate.sh`,
   `tests/gate/`, `tests/rulebook/`, `tests/checks/`, v1's opencode and Pi plugins, an empty `rules.local.md`,
   the `mxgate` block in `AGENTS.md`, and only our hooks and permissions in `.claude/settings.local.json`,
   `.codex/hooks.json` and `.cursor/hooks.json`. The app's tests, `docs/requests/` and `docs/brain/` are
   never touched.
6. **Rule file and skills** per agent, as in the table; every skill of ours is first removed from every skills
   folder (the retired `test-first-delivery` included). Then the starter test kit and `tests/film.mjs`, then
   `mxcli init --sync-skills .`, so mxcli's own skills and its sections of `CLAUDE.md`/`AGENTS.md` match the
   pinned binary (after our files: it fills the mxcli markers step 6 may have written). Then
   `.mxcodr/theme.mjs` and `.mxcodr/themes/`.
7. **`--request <file>`**: the request saved word for word as `docs/requests/NN.md`.
8. **`--boot`**: `mxcli run --local --detach` (Mendix's default ports when free, else three free ones from
   18080), `mxcli run wait --ready`, `mxcli run stop`.

## Film a test

A person who wants to *see* a test asks the agent in plain words: "film the order approval test", "show me
how the customer test works", "record all the tests". The `film-tests` skill has the agent list the tests
(`node tests/film.mjs --list`), ask which one unless the request names it, and film it. The agent never
films on its own.

The film is the test as it is, slowed: a title card names the test for three seconds, an animated pointer
travels to each element before it is clicked or filled, each action waits 1000 ms, and the test's title
stays in a small label at the bottom. Typed values never show as captions (Playwright's action callouts are
off). By hand, in the app folder, with the app running:

    node tests/film.mjs --list                # every test, numbered, with file:line
    node tests/film.mjs 7                     # test 7; or words of its title, or orders.spec.ts:57
    node tests/film.mjs --pace 1500 7         # slower (ms per action; 0 = the test's own speed)
    node tests/film.mjs --all                 # every test with a browser, in the background (--status, --stop)

The video lands in `.mxcli/films/<title>.mp4` (ffmpeg converts it; without ffmpeg there is only the `.webm`,
which opens in Chrome or Firefox, not QuickTime). `.mxcli/` is in mxcli's `.gitignore`. A failing test keeps
its film, which shows where it stopped.

Normal runs are unaffected: `tests/playwright.config.ts` has no video or slow-down. While it films,
`film.mjs` writes a temporary `.film.config.ts` beside the app's config (spreading it and adding only
`use.video` with `show.actions` and `show.test`) and one wrapper per spec in `.film/` (a `beforeEach` that
shows the title card, then the spec imported unchanged), and removes both afterwards.

## Change the look later

Six themes (`overlay/themes/catalog.json`): **atlas** (Mendix's own Atlas: `mxcli theme remove` takes
away mxcli's theme), **navy**, **teal**, **amber**, **plum**, **forest**. Each but atlas is created once with
`mxcli theme create <name> --from <name>.css --base signal`; its frame (`<name>.skin.scss`: top bar, active
menu item, outline buttons, control heights; only Atlas variables, so an Atlas update keeps working) is
written into the scaffold's partial, replacing an earlier bundle's, then `mxcli theme apply <name>
--variant light`. The mx-codr mark in the theme's colours replaces Mendix's logo and icons in `theme/web/`.

    node .mxcodr/theme.mjs              # the themes, each as a slice of the app in its colours, and the one now
    node .mxcodr/theme.mjs preview      # every theme on a real app, in the browser
    node .mxcodr/theme.mjs <n|name>     # apply it; installed.json records it, so a reinstall keeps it

Run it in the app folder. Under `mxcli run --local --watch` the new look shows after a reload.

## Develop

    node --test 'mxcodr/test/*.test.mjs'   # rule format, skills-clean, install placement, test kit, film recorder, themes, init survival (mxcli on PATH)

A change: edit `overlay/`, raise `BUNDLE` in `overlay/lib/mx.mjs` (`YYYY.MM.DD.N`), run the tests, then
install into an app with `install.sh` and measure with `harness-eval/bin/run.sh`.

v1 (the gate, hooks, checkers and rulebook) was removed on 2026-11-01. It is in the tags `v1-best-hb1`
(bundle 2026.10.25.13, best b2b-full result) and `v1-last`: `git worktree add ../mxcodr-v1 v1-best-hb1`.
