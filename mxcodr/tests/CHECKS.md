# What each check code wants, and its fix

One file per gate step; the gate names the file for the step that failed. Read that file, not
`tests/gate/*.sh` or the checkers: the finding already says what to change, the file says why.
Every code blocks DONE unless its line says "warning". A rule's card, with its level and the person's
exceptions: `tests/rulebook/<CODE>.md`; all of them: `bash tests/rules.sh list`. Generated from the cards.

| step | file | codes |
|---|---|---|
| layout | `tests/checks/layout.md` | ACCOUNT01, ACCOUNT02, ACCOUNT03, ALERT01, BACK01, EDGE01, GRID01, GRID02, HEAD01, HOME01, ICON01, LAYOUT01, MODULE01, NAME01, NAME02, NAV01, NAV02, NAV03, NAV04, NAV05, NAV06, SPACE01, SPACE02, SPACE03, SPACE04, TEXT01, TEXT02, URL01, USER01 |
| naming | `tests/checks/naming.md` | DS01, ERR01, EVENT01, EVENT02, EVENT03, EVENT04, PERF02, PERF03, PERF05, PERF06, PERF07, PERF08, REFRESH01, action-caption-is-default, action-caption, caption-not-a-question, caption-on-loop, caption-restates-expression, case-caption-dropped, decision-caption, loop-annotation, placeholder-variable, type-echo-variable |
| security | `tests/checks/security.md` | ADMIN01, ANON01, CRED01, EXTENDS01, FILTER01, PRODUCTION01, PWD01, SQL01, STRICT01, VIEW01, WRITE01, XSS01 |
| paths | `tests/checks/paths.md` | ISO01, OUTCOME01, ROLE01, SVC01, WF01, WF02 |
| catalog | `tests/checks/catalog.md` | LINT01, SEC007, UI001 |
| folders | `tests/checks/folders.md` | FOLDER01 |
| mx, coverage, precheck, scope, unused, tests | `tests/checks/app.md` | COVERAGE01, LOOK01, LOOK02, MX01, RUNTIME01, SCOPE01, SCRIPT01, STALE01, TEST01, TESTS01, UNUSED01, VIS01, VIS02, VIS03, VIS04, CE0582, CE0106, CE0557, CE0007, CE0117, CE0161, CE0642, CE1613, CE2729, CE7247 |
