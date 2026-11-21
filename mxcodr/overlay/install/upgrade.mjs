// The installer (overlay/install.mjs), section 6: upgrade, the earlier bundles' files out.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../lib/cache.mjs';
import { rmIf } from './common.mjs';
import { unfence } from './rules-file.mjs';

// ---- 6. upgrade: the earlier bundles' files out -----------------------------------------------------

// Paths an earlier bundle wrote that this one has no use for (v2 gate, then v1). The app's own tests/*.spec.ts,
// docs/requests/ and docs/brain/ are never touched.
const OLD_PATHS = [
  'mxgate', '.mxgate', '.claude/rules/mxgate.md', '.claude/rules/mdl-skills.md', '.cursor/rules/mdl-skills.mdc',
  'tools/mdl-checks', 'tests/gate.sh', 'tests/gate', 'tests/rulebook', 'tests/checks', 'tests/film.sh',
  '.opencode/plugin/mendix-mdl-harness.js', '.pi/extensions/mendix-mdl-harness.js',
];
// A hook or permission is ours when it names one of these.
const OUR_MARKS = ['.mxgate/', './mxgate', 'tools/mdl-checks/', 'tests/gate.sh'];
const isOurs = s => OUR_MARKS.some(m => String(s).includes(m));

// Takes our entries out of a settings or hooks JSON object; everything else stays as it was. -> true when changed.
export function stripOurs(cfg) {
  let changed = false;
  if (Array.isArray(cfg?.permissions?.allow)) {
    const keep = cfg.permissions.allow.filter(p => !isOurs(p));
    if (keep.length !== cfg.permissions.allow.length) { cfg.permissions.allow = keep; changed = true; }
  }
  const prune = list => list.flatMap(e => {
    if (e && typeof e === 'object' && 'command' in e && isOurs(e.command)) { changed = true; return []; }
    if (e && Array.isArray(e.hooks)) {
      const inner = prune(e.hooks);
      if (e.hooks.length && !inner.length) { changed = true; return []; }
      return [{ ...e, hooks: inner }];
    }
    return [e];
  });
  if (cfg?.hooks && typeof cfg.hooks === 'object') {
    for (const [ev, list] of Object.entries(cfg.hooks)) {
      if (!Array.isArray(list)) continue;
      const kept = prune(list);
      if (kept.length) cfg.hooks[ev] = kept; else { delete cfg.hooks[ev]; changed = true; }
    }
  }
  return changed;
}

// Removes what an earlier bundle installed. Returns what it removed, one line each.
export function upgradeCleanup(app) {
  const out = [];
  for (const rel of OLD_PATHS) rmIf(app, rel, out);
  // rules.local.md was the v2 gate's file for the person's own rules: removed only while empty
  const rl = path.join(app, 'rules.local.md');
  if (fs.existsSync(rl)) { if (!fs.readFileSync(rl, 'utf8').trim()) rmIf(app, 'rules.local.md', out); else out.push('nothing from rules.local.md: it has text, so it stays (the gate that read it is gone)'); }
  for (const rel of ['.claude/settings.local.json', '.codex/hooks.json', '.cursor/hooks.json']) {
    const f = path.join(app, rel);
    const cfg = readJson(f, null);
    if (cfg && stripOurs(cfg)) { fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n'); out.push(`our hooks and permissions from ${rel}`); }
  }
  const agentsMd = path.join(app, 'AGENTS.md');
  if (fs.existsSync(agentsMd)) {
    const t = fs.readFileSync(agentsMd, 'utf8');
    const u = unfence(t, '<!-- mxgate:start -->', '<!-- mxgate:end -->');
    if (u !== t) { fs.writeFileSync(agentsMd, u); out.push('the mxgate block from AGENTS.md'); }
  }
  return out;
}
