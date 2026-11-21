// Part of tests/film.mjs, the film recorder (its header says what it does and how to run it). The mx-codr installer
// writes it and this folder on every install: they are the bundle's, not the app's, and edits are overwritten.
// Here: the timings, the --pace default, the live pace and holds while recording, the holds and speeds on the film.

// --pace: how long each action is on the film, in ms (slow motion around the pointer reaching it and the click)
export const DEFAULT_PACE = 1000;
// How long the recording itself shows each action (Playwright's annotation: the pointer travels in 60% of it, at
// least 80 ms, then the action runs): the only slowing a test gets while it records. 150 ms: the pointer travels in
// 2-3 frames of the 25 fps video and the frame around the element shows in about 4, which the film then plays over
// --pace ms. Measured on a Mendix app (2026-11-21): 250 ms showed the travel better but cost 0.1 s more per action
// (143 actions: 14 s of a 20-test --all); 120 ms showed the pointer only arriving.
export const LIVE_PACE = 150;
export const livePace = pace => (pace > 0 ? Math.min(pace, LIVE_PACE) : 0);
// The title card: shown CARD_LIVE_MS while recording (Playwright fades it in over 300 ms), its full frame held on
// the film for CARD_MS.
export const CARD_LIVE_MS = 700;
export const CARD_MS = 2500;
// The screen a filmed test ends on (passed, or where it failed) stays on the film at least 5 s, and two actions' time
// at a slower pace: its last frame, held on the video. While recording it is held LIVE_HOLD_MS (the video shows a
// screen a little after the page has it), at the test's end and before any of the kit's sign-outs
// (MXCODR_FILM_HOLD_MS); a sign-out inside the test, before the next user signs in, stays MID_HOLD_MS on the film.
export const MIN_HOLD_MS = 5000;
export const holdMs = pace => Math.max(MIN_HOLD_MS, 2 * pace);
export const LIVE_HOLD_MS = 400;
export const MID_HOLD_MS = 1500;
// A wait between actions (a page loading, the server answering) plays at its own speed up to IDLE_KEEP_S, the rest
// IDLE_SPEED times faster; at --pace 0 every wait plays at its own speed.
export const IDLE_KEEP_S = 1.5;
export const IDLE_SPEED = 3;
// A run time -> the raw video's second: (ms - the start of "Create page") / 1000 + LAG_S. Negative: the recorder
// starts inside that call, so a change the page makes shows on the video 0.05-0.09 s earlier than its time from the
// call's start says (16 changes over two runs, 40 ms frames; Playwright 1.64.1, Chromium, a Mac, 2026-11-21).
export const LAG_S = -0.07;
// Where on the short live holds the film's held frame is taken: their middle, so a machine whose video runs a little
// later or earlier still holds the right screen.
export const HOLD_PICK_S = 0.2;
export const FPS = 25;
// what one test takes to film on average (the test's own time, its actions' live pace, the card and the end hold,
// the conversion overlapping the next test): for the --all estimate
export const SECONDS_PER_TEST = 6;
