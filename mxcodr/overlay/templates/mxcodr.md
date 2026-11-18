# Read the project skill before you build its part

Before you write the plan and before `./mxcli syntax`, read the project skill for each part you will touch,
in `.claude/skills/` (beside mxcli's), each whole and each in its own read or command: never several files in one call
(no combined `cat`, no `Promise.all`, no loop), never `head` or `cut`; Claude Code: the Read tool, no offset or limit.
Codex: one `exec_command` per file with `max_output_tokens: 30000`, and an `exec` script starts with `// @exec: {"max_output_tokens": 30000}`.
- `module-structure`: before the first module, folder, move or new document of any kind
- `naming-and-captions`: before naming anything: documents, variables, widgets `<Page>_<What><Type>`, captions
- `app-security`: before sign-in, module or user roles, grants, access rules, demo users, project security
- `spacing-and-layout`: before any page, snippet, layout or navigation (menu, Back, signed-in user, icons)
- `files-and-images`: before a file or image entity, an upload or an image widget
- `java-action-docs`: before any Java action (its documentation)
- `durable-tests`: before you write or edit a test in `tests/` (what deserves a test)

If an output says it was truncated, read the rest by line ranges before you build. mxcli's "read a skill's section, not the file" holds only for mxcli's own skills in `.ai-context/skills/`.
In Claude Code, and in Codex in Studio Pro's mx-codr pane, a skill gate holds you to this list: a model change or a test file that needs a skill not yet read whole in this session is refused, naming the files to read.

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

Never add a document to a Marketplace module (`list modules`: Source `Marketplace v...`) or change one in it: its next update deletes the addition and undoes the change; the app's documents go in its own module, a changed copy in `<Module>Ext`. Marketplace widgets only from publisher Mendix or Mendix Labs. Once `docs/app-docs.html` exists, update it with the `app-docs` skill at the end of every turn that changed the model, before you report.
