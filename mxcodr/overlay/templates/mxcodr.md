# Keep your checks as tests

Every check you make of the running app — a browser flow per role, a refusal, data isolation, a
computed value, an API call — goes into `tests/` as a re-runnable automated test (Playwright for the
browser), never a throwaway script. Each requirement of the request gets a test that asserts its actual
content (the value, the order, the refusal, both sides of a rule), not only that a page opens. Before you
say you are done, run the whole suite once and show it passing.

Write them as plain `@playwright/test` specs on top of `tests/mx.ts` (sign-in and sign-out, dialogs, grids, OQL, forged calls; take `test` and `expect` from `./mx`), with your own helpers beside it, and sign out at the end
of each test (the trial runtime allows six sessions). Prove a refusal by attempting the forbidden action
as that role (a call, a URL, an API request) and asserting that the server refuses it, plus the allowed
side as the permitted role; never add a button, widen access or lower security so a test can see a message.
Write and run the tests yourself in the foreground, never through a background agent, and never end your turn while a test run or an agent is still going. **You are done only
when** you have printed a table `requirement -> test that asserts it` covering every requirement of the
request (write the missing tests first), then run the whole suite once as `npx playwright test --shuffle`
in `tests/` and shown it green with `sessions left: 0`. Never edit `tests/mx.ts` or `tests/mx.teardown.ts`
to silence a check; fix the leaking test. Stop the app with
`./mxcli run stop`, and any other process only by the exact PID you started, never by a name pattern
(`pkill`, `killall`): that also kills the person's own browsers and test runs.

Before building a part, read its project skill in `.claude/skills/` (beside mxcli's): `durable-tests`
what deserves a test; `app-security` sign-in, roles, row isolation; `spacing-and-layout` menu, Back,
signed-in user, icons, spacing; `naming-and-captions` variables, captions, widgets `<Page>_<What><Type>`;
`module-structure` modules and folders; `files-and-images` uploads; `java-action-docs` every Java action's documentation. Read each of these skills whole, one file per read, never through `head`, `cut` or a combined `cat`; of mxcli's own skills in `.ai-context/skills/` read only the section you need.
Marketplace widgets only from publisher Mendix or Mendix Labs.
