// docs/harness-rules.html and docs/harness-wiring.html match the bundle: what the generator (tools/docsgen/gen.mjs)
// writes between its markers (bundle, mxcli pin, the rule file and the brain rule line by line, the counts) is what is
// committed, and the pages name every installed skill and starter kit file. Only in the development repository:
// mxcodr/ copied alone into an app, or the published mx-codr copy without tools/docsgen/, skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gen = path.join(repo, 'tools', 'docsgen', 'gen.mjs');
const here = fs.existsSync(gen) && fs.existsSync(path.join(repo, 'docs', 'harness-rules.html')) && fs.existsSync(path.join(repo, 'docs', 'harness-wiring.html'));
const SKIP = here ? false : 'needs tools/docsgen/gen.mjs and docs/ beside mxcodr/ (the development repository)';

test('the docs pages are what tools/docsgen/gen.mjs writes from this bundle', { skip: SKIP }, async () => {
  const { render, PAGES } = await import(pathToFileURL(gen).href);
  const { pages, problems, facts } = render(repo);
  for (const p of PAGES) {
    const committed = fs.readFileSync(path.join(repo, p), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(committed === pages[p], `${p} differs from the generator's output for bundle ${facts.bundle}: run node tools/docsgen/gen.mjs (node tools/docsgen/gen.mjs --check names the first difference)`);
  }
  assert.deepEqual(problems, [], 'the pages miss what the bundle has');
});

test('the generator catches a stale region and a skill the pages do not name', { skip: SKIP }, async () => {
  const { fill, regions, problems, facts, PAGES } = await import(pathToFileURL(gen).href);
  const f = facts(repo);
  const page = '<p>bundle <!--gen:bundle-->2000.01.01.1<!--/gen:bundle--></p>';
  assert.equal(fill('x', page, regions(f)), `<p>bundle <!--gen:bundle-->${f.bundle}<!--/gen:bundle--></p>`);
  assert.throws(() => fill('x', '<!--gen:nope-->1<!--/gen:nope-->', regions(f)), /unknown region nope/);
  assert.throws(() => fill('x', '<!--gen:pin-->1', regions(f)), /has no partner/);
  const pages = Object.fromEntries(PAGES.map(p => [p, fs.readFileSync(path.join(repo, p), 'utf8')]));
  const extra = { ...f, skills: [...f.skills, 'a-skill-nobody-wrote'], kit: [...f.kit, 'new-kit-file.ts'] };
  const found = problems(pages, extra);
  assert.ok(found.some(l => l.includes('a-skill-nobody-wrote')), found.join('\n'));
  assert.ok(found.some(l => l.includes('tests/new-kit-file.ts')), found.join('\n'));
});
