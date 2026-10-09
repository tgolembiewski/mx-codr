# USER01 — who is signed in, top right, on every page
step: layout
level: block
check: layout_rules/page_top.cjs#currentUserFindings
key: none

## What it checks
With login: every page shows who is signed in, top right. Pop-ups and the login page don't need it.

## Fix
The page starts with `container ctPageTop (DesignProperties: ('Flex container': 'Horizontal (row)', 'Align items X': 'Right'))` holding `snippetcall scCurrentUser (Snippet: <Module>.SNIPPET_CurrentUser)`.

## Local
# level: block

