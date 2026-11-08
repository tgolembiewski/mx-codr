#!/usr/bin/env node
// Skill cases for java-action-docs (test-every-new-skill: discovery, effect, negative), run by hand because each
// case is a real Claude Code turn (headless, Sonnet, a few cents):
//   node mxcodr/test/skill-cases/java-action-docs.mjs
// A scratch folder gets this skill and two other overlay skills in .claude/skills/; each prompt never names the skill.
//   discovery: the skill is read (a Skill call for it, or a Read of its SKILL.md)
//   effect:    the script it writes documents the action, each parameter and the return value's name
//   negative:  a page request does not read it
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skills = path.join(here, '..', '..', 'overlay', 'skills');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxcodr-skillcase-'));
for (const s of ['java-action-docs', 'module-structure', 'naming-and-captions']) fs.cpSync(path.join(skills, s), path.join(dir, '.claude', 'skills', s), { recursive: true });
fs.mkdirSync(path.join(dir, 'mdlsource'));

function turn(prompt) {
  const r = spawnSync('claude', ['-p', prompt, '--model', 'sonnet', '--output-format', 'stream-json', '--verbose', '--max-turns', '12',
    '--setting-sources', 'project', '--strict-mcp-config', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Edit,Glob,Grep,Skill'],
  { cwd: dir, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  const events = (r.stdout ?? '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const uses = events.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? []).filter(c => c.type === 'tool_use');
  const fired = uses.some(u => (u.name === 'Skill' && /java-action-docs/.test(JSON.stringify(u.input))) || (u.name === 'Read' && /java-action-docs\/SKILL\.md/.test(u.input?.file_path ?? '')));
  const usage = events.find(e => e.type === 'result')?.usage;
  return { fired, uses: uses.map(u => u.name), tokens: usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : null };
}

const results = [];
const a = turn('Write mdlsource/discount.mdl: an MDL script that creates a Java action Sales.JA_ApplyDiscount that takes an Order (entity Sales.Order) and a percentage and returns the order\'s new total. Only write the file; do not run anything.');
const script = fs.existsSync(path.join(dir, 'mdlsource', 'discount.mdl')) ? fs.readFileSync(path.join(dir, 'mdlsource', 'discount.mdl'), 'utf8') : '';
const docBeforeCreate = /\/\*\*[\s\S]*?\*\/\s*create\s+(or\s+modify\s+)?java\s+action/i.test(script);
const paramDocs = (script.match(/\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*\w+\s*:/g) ?? []).length;
const returnName = /returns\s+\w+(\(\d+\))?\s+as\s+\$\w+/i.test(script);
const sideEffects = /side effect/i.test(script);
results.push(['discovery (implicit prompt)', a.fired, `tools ${a.uses.join(',')}; ${a.tokens} tokens`]);
results.push(['effect: documented action, parameters, return name, side effects', docBeforeCreate && paramDocs >= 2 && returnName && sideEffects, `doc ${docBeforeCreate}, param docs ${paramDocs}, return name ${returnName}, side effects ${sideEffects}`]);
const b = turn('Write mdlsource/customers.mdl: an MDL script that creates a page Sales.Customer_Overview listing customers in a data grid. Only write the file; do not run anything.');
results.push(['negative (a page)', !b.fired, `tools ${b.uses.join(',')}; ${b.tokens} tokens`]);
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
console.log(`scratch: ${dir}`);
process.exit(results.every(r => r[1]) ? 0 : 1);
