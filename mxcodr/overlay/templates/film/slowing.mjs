// Part of tests/film.mjs, the film recorder (its header says what it does and how to run it). The mx-codr installer
// writes it and this folder on every install: they are the bundle's, not the app's, and edits are overwritten.
// Here: the slowing, made afterwards on the video. The test's timeline, the film's plan, its times, and ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULT_PACE, livePace, CARD_MS, MIN_HOLD_MS, holdMs, LIVE_HOLD_MS, MID_HOLD_MS, IDLE_KEEP_S, IDLE_SPEED, LAG_S, HOLD_PICK_S, FPS } from './timing.mjs';

// ---- the slowing: the raw video's timeline -> the film's -------------------------------------------------------

// The calls that act on an element: Playwright shows its annotation (the pointer, the frame) right before each.
const INPUT = /^(Click|Double click|Fill|Check|Uncheck|Set checked|Press|Press sequentially|Type|Hover|Tap|Select option|Set input files|Drag and drop|Clear|Focus|Select text)\b/;

// One test's timeline lines (reporter) and marks (wrapper) -> what the slowing needs, in wall-clock ms:
// { zero (the video's first frame), actions: [{ start, end }], card, end: { at, blank }, blanks: [ms], close }
export function timelineOf(lines, marks, id) {
  const mine = lines.filter(l => l.id === id);
  const steps = mine.filter(l => l.k === 'step');
  const at = s => s && s.start;
  // the video starts with the page (Playwright's recorder starts in "Create page"), else the context
  const zero = at(steps.find(s => s.cat === 'pw:api' && s.title === 'Create page')) ?? at(steps.find(s => s.cat === 'fixture' && /"page"/.test(s.title)))
    ?? at(steps.find(s => s.cat === 'fixture' && /"context"/.test(s.title))) ?? mine.find(l => l.k === 'begin')?.at;
  const m = marks.filter(x => x.id === id);
  const end = m.find(x => x.k === 'end');
  const close = steps.find(s => s.cat === 'pw:api' && s.title === 'Close context');
  return {
    zero,
    actions: steps.filter(s => s.cat === 'pw:api' && INPUT.test(s.title)).map(s => ({ start: s.start, end: s.start + s.ms, title: s.title })).sort((a, b) => a.start - b.start),
    card: m.find(x => x.k === 'card')?.at,
    end: end ? { at: end.at, blank: !!end.blank } : null,
    blanks: m.filter(x => x.k === 'blank').map(x => x.at).sort((a, b) => a - b),
    close: close ? close.start : null,
  };
}

/**
 * The film's plan: the raw video cut into pieces, each { a, b, out } (seconds of the raw video a..b play in `out`
 * seconds of the film; a === b is a held frame, the one just before a, for `out`). Pure, so the film and the step
 * times of the pane's player come from the same numbers. -> { pieces, total, cut } (cut: the raw second the film
 * ends on, then held). Without a timeline the raw video plays as it is and its last frame is held.
 */
export function filmPlan(tl, { pace = DEFAULT_PACE, lag = LAG_S, rawEnd = null } = {}) {
  const pieces = [];
  let at = 0;
  const v = ms => Math.max(0, (ms - tl.zero) / 1000 + lag);
  const idle = len => (pace > 0 && len > IDLE_KEEP_S ? IDLE_KEEP_S + (len - IDLE_KEEP_S) / IDLE_SPEED : len);
  const play = (to, how = 'idle') => { if (to > at + 1e-6) { const len = to - at; pieces.push({ a: at, b: to, out: how === 'cut' ? 0 : how === 'idle' ? idle(len) : len }); at = to; } };
  const freeze = (t, out) => { play(t); pieces.push({ a: at, b: at, out }); };
  const hold = holdMs(pace) / 1000;
  if (!tl || !Number.isFinite(tl.zero)) {
    const end = rawEnd ?? 0;
    if (end > 0) pieces.push({ a: 0, b: end, out: end });
    pieces.push({ a: end, b: end, out: hold });
    return finish(pieces, end);
  }
  // the end: the test's last screen (held LIVE_HOLD_MS while recording: a frame late in that hold), or, when the test
  // signed out itself, the screen before its last sign-out (the kit held it LIVE_HOLD_MS too)
  const blanks = tl.blanks.map(v);
  let endAt;
  if (tl.end && !tl.end.blank) endAt = v(tl.end.at) + LIVE_HOLD_MS / 1000 - HOLD_PICK_S;
  else if (blanks.length) endAt = blanks[blanks.length - 1] - HOLD_PICK_S;
  else if (tl.end) endAt = v(tl.end.at);
  else endAt = tl.close ? v(tl.close) - 0.1 : (rawEnd ?? 0);
  if (rawEnd != null) endAt = Math.min(endAt, rawEnd);
  // the title card: the blank page before it cut, its fade-in played, its full frame held
  if (Number.isFinite(tl.card) && v(tl.card) < endAt) {
    play(v(tl.card), 'cut');
    const full = Math.min(v(tl.card) + 0.4, endAt);
    play(full, 'own');
    pieces.push({ a: at, b: at, out: CARD_MS / 1000 });
  }
  // the actions (each one's annotation: the last livePace before the action ran, and a little of what it did) in
  // slow motion, the sign-outs inside the test held
  const live = livePace(pace) / 1000;
  const events = [];
  if (live > 0) for (const x of tl.actions) {
    const b = v(x.end) + 0.1, a = Math.max(v(x.end) - live - 0.08, v(x.start));
    events.push({ a, b, kind: 'act' });
  }
  for (const t of blanks.slice(0, -1).concat(tl.end && tl.end.blank ? [] : blanks.slice(-1))) events.push({ a: t - HOLD_PICK_S, b: t - HOLD_PICK_S, kind: 'mid' });
  events.sort((x, y) => x.a - y.a);
  for (const e of events) {
    if (e.a >= endAt) break;
    if (e.kind === 'mid') { if (e.a > at) freeze(e.a, MID_HOLD_MS / 1000); continue; }
    play(e.a);
    const b = Math.min(e.b, endAt);
    if (b > at + 1e-6) { const len = b - at; pieces.push({ a: at, b, out: Math.max(len, pace / 1000) }); at = b; }
  }
  play(endAt);
  pieces.push({ a: at, b: at, out: hold });
  return finish(pieces, endAt);
}
const finish = (pieces, cut) => ({ pieces, cut, total: Math.round(pieces.reduce((s, p) => s + p.out, 0) * 1000) / 1000 });

/** A second of the raw video -> the second of the film it shows at (a held frame counts before what follows it). */
export function filmSecond(plan, t) {
  let acc = 0;
  for (const p of plan.pieces) {
    if (p.a === p.b) { if (t >= p.a) { acc += p.out; continue; } break; }
    if (t >= p.b) { acc += p.out; continue; }
    if (t > p.a) acc += ((t - p.a) / (p.b - p.a)) * p.out;
    break;
  }
  return Math.min(acc, plan.total);
}
/** A wall-clock time of the run (ms) -> the film's second, for the steps of the pane's player. */
export const filmTime = (plan, tl, ms, lag = LAG_S) => (tl && Number.isFinite(tl.zero) ? filmSecond(plan, Math.max(0, (ms - tl.zero) / 1000 + lag)) : Math.max(0, (ms - (tl?.zero ?? ms)) / 1000));

const num = x => String(Math.round(x * 10000) / 10000);
// A sum as a balanced tree, ((a+b)+(c+d)): ffmpeg's expression parser refuses a flat a+b+c+... of about 100 terms
// ("Error while parsing expression", ffmpeg 9.0.2: 90 terms parse, 100 do not; a tree of 3000 does), which a test of
// about 50 actions reaches.
export const sumTree = t => (t.length === 1 ? t[0] : `(${sumTree(t.slice(0, t.length >> 1))}+${sumTree(t.slice(t.length >> 1))})`);
/** The ffmpeg filter of a plan: every frame's new time (a sum over the pieces), the film's frame rate, the last
 * frame held past the end (cut at plan.total by -t). */
export function filterText(plan, fps = FPS) {
  const terms = [];
  for (const p of plan.pieces) {
    if (p.out <= 0) continue;
    if (p.a === p.b) terms.push(`${num(p.out)}*gte(T,${num(p.a)})`);
    else terms.push(`${num(p.out)}*clip((T-${num(p.a)})/${num(p.b - p.a)},0,1)`);
  }
  return `setpts='${terms.length ? sumTree(terms) : '0'}/TB',fps=${fps},tpad=stop_mode=clone:stop_duration=${num(holdMs(0) / 1000 + 1)},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
}

// ffmpeg's arguments for a film (H.264 in an mp4 that starts playing before it is all loaded). A long filter goes in a
// file: `-/vf <file>` (ffmpeg 7.1 and later), else `-filter_script:v <file>` (earlier ones; 9 has no such option).
export function ffmpegArgs(raw, mp4, plan, { filterFile = null, form = 'slash' } = {}) {
  const f = filterText(plan);
  const vf = filterFile ? (form === 'slash' ? ['-/vf', filterFile] : ['-filter_script:v', filterFile]) : ['-vf', f];
  return ['-v', 'error', '-y', '-i', raw, ...vf, '-t', num(plan.total), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4];
}

function run(cmd, args, onChild) {
  return new Promise(resolve => {
    let err = '';
    const c = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    onChild?.(c);
    c.stderr.on('data', d => { err += d; });
    c.on('error', e => resolve({ status: 127, err: e.message }));
    c.on('close', code => resolve({ status: code ?? 1, err }));
  });
}

// No timeline (the test's marks or calls were not found): the recording converted as it is, its last frame held.
export const plainArgs = (raw, mp4) => ['-v', 'error', '-y', '-i', raw, '-vf', `tpad=stop_mode=clone:stop_duration=${num(MIN_HOLD_MS / 1000)},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4];

/**
 * The raw video -> the film: the plan's slowing with ffmpeg (`ffmpeg`: its path, or null when there is none), into
 * `out` (.mp4). -> { file, plan, slowed, converted } — file is the slowed .mp4 (slowed, plan: its plan); without a
 * timeline the .mp4 of the recording as it is (converted, plan null); else (no ffmpeg, or it failed) the raw .webm
 * moved to `out`'s name. Without a plan the steps keep the raw video's times.
 */
export async function makeFilm({ raw, out, tl, pace, ffmpeg, work, onChild }) {
  const webm = out.replace(/\.mp4$/, '.webm');
  for (const f of [out, webm]) fs.rmSync(f, { force: true });
  if (ffmpeg && !(tl && Number.isFinite(tl.zero))) {
    const r = await run(ffmpeg, plainArgs(raw, out), onChild);
    if (r.status === 0 && fs.existsSync(out)) { fs.rmSync(raw, { force: true }); return { file: out, plan: null, slowed: false, converted: true }; }
    fs.rmSync(out, { force: true });
  } else if (ffmpeg) {
    const plan = filmPlan(tl, { pace });
    const text = filterText(plan);
    const long = text.length > 6000;
    const filterFile = long ? path.join(work, `filter-${process.pid}-${Date.now()}.txt`) : null;
    if (long) fs.writeFileSync(filterFile, text);
    let r = await run(ffmpeg, ffmpegArgs(raw, out, plan, { filterFile }), onChild);
    if (r.status !== 0 && long) r = await run(ffmpeg, ffmpegArgs(raw, out, plan, { filterFile, form: 'script' }), onChild);
    if (filterFile) fs.rmSync(filterFile, { force: true });
    if (r.status === 0 && fs.existsSync(out)) { fs.rmSync(raw, { force: true }); return { file: out, plan, slowed: true }; }
    fs.rmSync(out, { force: true });
  }
  fs.renameSync(raw, webm);
  return { file: webm, plan: null, slowed: false, converted: false };
}
