// The installer (overlay/install.mjs), section 5c: the film recorder.
import fs from 'node:fs';
import path from 'node:path';
import { liveFilmText } from '../lib/live.mjs';
import { OVERLAY } from './common.mjs';

// ---- 5c. the film recorder ---------------------------------------------------------------------------

// tests/film.mjs records a test's run as a video when a person asks (the film-tests skill). Unlike the kit it is
// the bundle's, not the app's: written on every install and reinstall, whatever the kit's files are, so a later
// bundle's fix reaches every app. It only adds a temporary config while it films; the app's config is never edited.
export const FILM = 'tests/film.mjs';
// live: the Studio Pro extension's text (lib/live.mjs FILM_EDITS: Studio Pro runs the app).
export function copyFilm(app, src = path.join(OVERLAY, 'templates', 'film.mjs'), { live = false } = {}) {
  const f = path.join(app, FILM);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.rmSync(f, { force: true }); // a link or a read-only copy is replaced, not written through
  if (live) fs.writeFileSync(f, liveFilmText(fs.readFileSync(src, 'utf8')));
  else fs.copyFileSync(src, f);
  return FILM;
}
