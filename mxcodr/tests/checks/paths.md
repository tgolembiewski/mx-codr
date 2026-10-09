# paths -- every path a user can take has a test (`check_paths.cjs`)

One line per code of the `paths` step; every code blocks DONE unless marked warning. The card: `tests/rulebook/paths/<CODE>.md`.

| Code | Wants | Fix |
|---|---|---|
| `ISO01` | each row-scoped role reads its entity in a test | As that user, show one of its own rows is there and another user's row is not (`oql_count` with the other user's key = 0, or the API the role reads through). |
| `OUTCOME01` | every message a user can be shown is asserted by a test | Walk the path that shows it and assert four words of it in a row, or all of a shorter one: `await_message(/credit limit exceeded for/i)`; the refusals too, not only the successes. |
| `ROLE01` | every demo user's role is the user of some test | A journey per role: what it sees, and what it is refused. |
| `SVC01` | every published service is called by a test | Each operation as a user who may, the answer asserted, and once without signing in (refused). |
| `WF01` | a flow that completes a workflow task checks the user is one of its targets | Retrieve the task's `System.WorkflowUserTask_TargetUsers`, refuse when `[%CurrentUser%]` is not in it; grant the flow only to the roles the task targets. |
| `WF02` | every workflow task outcome is chosen in a test that signs in as both people | Start the flow as one demo user, `sign_in_as('<the targeted user>')`, choose the outcome, sign back in as the first and assert what they see; one test per outcome. |
