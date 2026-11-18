#!/usr/bin/env node
// Skill cases for app-docs (test-every-new-skill: discovery, effect, negative), run by hand because each case is a
// real Claude Code turn (headless, Sonnet, a few cents) and the effect needs a real app and mxcli:
//   node mxcodr/test/skill-cases/app-docs.mjs <a COPY of an app folder with its .mpr and ./mxcli>
// The copy gets this skill and two other overlay skills in .claude/skills/; the prompts never name the skill.
//   discovery: "write documentation for this app" reads the skill (a Skill call, or a Read of its SKILL.md)
//   effect:    docs/app-docs.html exists, carries the fingerprint meta and at least one element link
//   negative:  a README request does not read it
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skills = path.join(here, '..', '..', 'overlay', 'skills');
const dir = process.argv[2];
if (!dir || !fs.readdirSync(dir).some(f => f.endsWith('.mpr'))) { console.error('usage: app-docs.mjs <a copy of an app folder>'); process.exit(2); }
for (const s of ['app-docs', 'module-structure', 'naming-and-captions']) fs.cpSync(path.join(skills, s), path.join(dir, '.claude', 'skills', s), { recursive: true });

function turn(prompt, maxTurns = 60) {
  const r = spawnSync('claude', ['-p', prompt, '--model', 'sonnet', '--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns),
    '--setting-sources', 'project', '--strict-mcp-config', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Edit,Glob,Grep,Skill,Bash(./mxcli:*),Bash(node:*)'],
  { cwd: dir, encoding: 'utf8', timeout: 1800000, maxBuffer: 1 << 26 });
  const events = (r.stdout ?? '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const uses = events.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? []).filter(c => c.type === 'tool_use');
  const fired = uses.some(u => (u.name === 'Skill' && /app-docs/.test(JSON.stringify(u.input))) || (u.name === 'Read' && /app-docs\/SKILL\.md/.test(u.input?.file_path ?? '')));
  return { fired, uses: uses.map(u => u.name) };
}

const results = [];
const a = turn('Write documentation for this Mendix app that a new developer can read to understand it.');
const out = path.join(dir, 'docs', 'app-docs.html');
const html = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
results.push(['discovery (implicit prompt)', a.fired, `tools ${a.uses.length}`]);
results.push(['effect: docs/app-docs.html with the fingerprint and element links', /<meta name="mxcodr-docs" content='\{/.test(html) && /<a class="mx" href="#" data-mx="\w+\.\w+"/.test(html), `${html.length} bytes`]);
const b = turn('Write a short README.md for this repository saying how to open the app in Studio Pro. Only write the file.', 8);
results.push(['negative (a README)', !b.fired, `tools ${b.uses.join(',')}`]);
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
process.exit(results.every(r => r[1]) ? 0 : 1);
