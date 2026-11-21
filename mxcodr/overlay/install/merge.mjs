// The installer (overlay/install.mjs), section 0: moving a new app into a folder that already holds files.
import fs from 'node:fs';
import path from 'node:path';
import { START, END } from '../lib/rules.mjs';
import { FOOTPRINT } from './common.mjs';
import { PLAN_START, PLAN_END, MXCLI_BEGIN, MXCLI_END, unfence } from './rules-file.mjs';

// Which of the folder's files, at a path the fresh scaffold also has, are leftovers of an earlier mxcli
// new/init here (the folder has no .mpr, so they belong to no app) and are replaced by the new copy. The rule:
// only what mxcli itself writes and nobody edits by hand -- .ai-context/, mxcli's skills, commands and lint
// rules under .claude/, .claude/settings.json, lint-config.yaml and bootstrap-mxcli.sh, .mxcli/,
// .devcontainer/, .playwright/, .mendix-cache/, .classpath, .project; CLAUDE.md and AGENTS.md only when
// nothing but mxcli's section (and our block) is in them; .gitignore only when every line of it is in the
// new one. Everything else at a shared path is the person's and is kept (.claude/rules/, README.md, a
// CLAUDE.md with their own text, a .gitignore they added lines to...): when in doubt, keep.
const SCAFFOLD_DIRS = ['.ai-context/', '.claude/skills/', '.claude/commands/', '.claude/lint-rules/', '.mxcli/', '.devcontainer/', '.playwright/', '.mendix-cache/'];
const SCAFFOLD_FILES = '.claude/settings.json .claude/lint-config.yaml .claude/bootstrap-mxcli.sh .classpath .project'.split(' ');
export function isScaffoldLeftover(rel, theirs, fresh) {
  if (SCAFFOLD_FILES.includes(rel) || SCAFFOLD_DIRS.some(d => rel.startsWith(d))) return true;
  const text = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  if (rel === 'CLAUDE.md' || rel === 'AGENTS.md') {
    const t = text(theirs);
    return t !== null && t.includes(MXCLI_BEGIN) && !unfence(unfence(unfence(t, MXCLI_BEGIN, MXCLI_END), START, END), PLAN_START, PLAN_END).trim();
  }
  if (rel === '.gitignore') {
    const t = text(theirs), n = text(fresh);
    if (t === null || n === null) return false;
    const ok = new Set(n.split(/\r?\n/).map(l => l.trim()));
    return t.split(/\r?\n/).every(l => !l.trim() || ok.has(l.trim()));
  }
  return false;
}

// Moves the new app (src) into dst. A name dst lacks is moved in; a folder on both sides is merged; a file on
// both sides is replaced when isScaffoldLeftover says so, else kept (the scaffold's copy dropped). A leftover
// mprcontents/ (no .mpr beside it) is moved aside whole: units of two apps must never mix.
// All-or-nothing: everything is planned first, the .mpr moves last, and a failure part-way undoes every move
// (the replaced leftovers come back from .mxcodr/merge-backup/), so a failed run never leaves scaffold files
// without an app (createApp holds Ctrl-C off until the moves are over).
// -> { kept, replaced, setAside: [[from, to]] }, paths relative to dst.
export function mergeInto(src, dst, { move = moveEntry } = {}) {
  const kept = [], replaced = [], setAside = [], steps = [];
  const plan = (rel) => {
    for (const n of fs.readdirSync(path.join(src, rel))) {
      const r = rel ? `${rel}/${n}` : n, s = path.join(src, r), d = path.join(dst, r);
      let there = null; try { there = fs.lstatSync(d); } catch { /* absent */ }
      const sDir = fs.lstatSync(s).isDirectory();
      if (!there) steps.push({ s, d, r });
      else if (r === 'mprcontents' && sDir) {
        let to = 'mprcontents.old', k = 1;
        while (fs.existsSync(path.join(dst, to))) to = `mprcontents.old${++k}`;
        steps.push({ s: d, d: path.join(dst, to), r: to, aside: true }, { s, d, r });
        setAside.push(['mprcontents/', `${to}/`]);
      } else if (there.isDirectory() && !there.isSymbolicLink() && sDir) plan(r);
      else if (!there.isDirectory() && !sDir && isScaffoldLeftover(r, d, s)) { steps.push({ s, d, r, replace: true }); replaced.push(r); }
      else kept.push(r);
    }
  };
  plan('');
  // the app last: mprcontents/, then the .mpr, so an app is either whole or not there
  const rank = st => (st.aside ? 0 : st.r === 'mprcontents' ? 1 : /^[^/]+\.mpr$/.test(st.r) ? 2 : 0);
  steps.sort((a, b) => rank(a) - rank(b));
  const backup = path.join(dst, FOOTPRINT, 'merge-backup');
  const done = [];
  try {
    for (const st of steps) {
      if (st.replace) {
        const b = path.join(backup, st.r);
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.renameSync(st.d, b);
        done.push({ undo: () => fs.renameSync(b, st.d) });
      }
      const copied = move(st.s, st.d);
      done.push({ undo: () => { if (copied) fs.rmSync(st.d, { recursive: true, force: true }); else fs.renameSync(st.d, st.s); } });
    }
  } catch (e) {
    for (const st of done.reverse()) { try { st.undo(); } catch { /* best effort: keep undoing the rest */ } }
    fs.rmSync(backup, { recursive: true, force: true });
    try { fs.rmdirSync(path.join(dst, FOOTPRINT)); } catch { /* not empty, or absent: fine */ }
    throw Object.assign(new Error(`moving the new app into the folder failed (${e.code || e.message}); every move was undone`), { fix: 'free the folder (no file open or locked in it) and run the installer again' });
  }
  fs.rmSync(backup, { recursive: true, force: true });
  try { fs.rmdirSync(path.join(dst, FOOTPRINT)); } catch { /* not empty, or absent: fine */ }
  return { kept, replaced, setAside };
}

// src -> dst by rename, by copy across volumes (EXDEV); -> true when it was copied (src still there)
function moveEntry(s, d) {
  try { fs.renameSync(s, d); return false; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  try { fs.cpSync(s, d, { recursive: true, verbatimSymlinks: true }); } catch (e) { fs.rmSync(d, { recursive: true, force: true }); throw e; }
  return true;
}
