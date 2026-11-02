---
name: film-tests
description: "Record a video of a browser test's run, one test or all of them in the background, slowed so a person can follow it: a pointer travels to each element, each action is paced, and a title card names the test. Lists every test first so the person can choose. Use when someone asks to see, film, record or show a test, how a test works, or how the app works. Never film on your own initiative."
---

# Film a test

`tests/film.mjs` records the browser while a test runs. The test itself is
unchanged: a temporary Playwright config spreads the app's own
`playwright.config.ts` and adds only video recording with Playwright's own
annotations. On the film:

- a **title card** names the test (and its file) for three seconds before it starts;
- an animated **pointer** travels to each element before it is clicked or filled;
- every action is **paced** (1000 ms by default), so a person can follow it;
- the test's title stays in a small label at the bottom while it runs.

Typed values never appear as captions (Playwright's action callouts are switched
off); a password field shows dots, as it does on screen.

Normal runs are not affected: `npx playwright test` records nothing and is not
slowed, because the app's config is never edited. Only `tests/film.mjs` films.

## Steps

1. **List the tests** and show the person the list as it prints:

   ```bash
   node tests/film.mjs --list
   ```

   Each line is a number, the test's full title and its `file:line`. A test that
   opens no browser (an API or OQL check) says "no browser: nothing to film".
2. **Ask which one**, unless the request already names it: one test, or all.
3. **Record:**

   ```bash
   node tests/film.mjs 7                     # number 7 of the list
   node tests/film.mjs order approval        # the one test whose title holds these words
   node tests/film.mjs orders.spec.ts:57     # the test at that line
   node tests/film.mjs --pace 1500 7         # slower (ms per action; 0 = the test's own speed)
   node tests/film.mjs --all                 # every test with a browser, in the background
   ```

   When the words match more than one test, `film.mjs` prints the candidates
   with their numbers: ask the person, or pick the number that fits the request.
4. **Give the path** it prints: `.mxcli/films/<title>.mp4` when ffmpeg is
   installed, else `.mxcli/films/<title>.webm`. On a Mac `open <file>` plays the
   `.mp4`; a `.webm` opens in Chrome or Firefox (QuickTime cannot play it), or
   `brew install ffmpeg` and film again for an `.mp4`. A failing test keeps its
   film, which shows where it stopped: say that it failed.

## All of them: say how long it takes, and let it run in the background

A whole suite, slowed to be watched, takes about 40 s a test (20 tests: about
14 minutes). `node tests/film.mjs --all` returns at once and prints the
estimate: **tell the person that number** and that it records in the
background, one film per test. Then:

- `node tests/film.mjs --status` shows how far it is (`filming 4/17 ...`,
  PASS/FAIL so far); check it when the person asks, not in a loop;
- when it says `done:`, give the folder `.mxcli/films/` and the films in it;
- if it says `stopped: the app stopped answering`, the app ran past its
  unlicensed run time: start it again and film the tests it lists one by one;
- `node tests/film.mjs --stop` ends it early.

This is the one run you leave going when your turn ends: it is the person's
film, not your test run. Do not wait for it with `sleep` or a loop over
`--status`, and do not run the suite yourself while it records (the trial
runtime allows six sessions at a time).

## Rules

- **The app must be up.** If `film.mjs` says no app answers, start it with
  `./mxcli run --local --detach -p <app>.mpr` and `./mxcli run wait --ready -p <app>.mpr`,
  then film. It reads the address the tests use (`APP_URL`, from the
  environment or `tests/.env`, else `http://127.0.0.1:8080`).
- **Install the suite's packages first** if `film.mjs` says `@playwright/test`
  is not installed: `npm install` in `tests/`.
- **Never edit a test to make a better film.** The film shows the test as it is.
- **Never edit `tests/film.mjs`.** The installer writes it again on every
  install; a change there is lost.
- **Films are not committed.** They live under `.mxcli/films/`, which git
  ignores.
- **Do not film on your own.** Film only when the person asks to see, film,
  record or show a test; a film is for them, not a check of your work.
