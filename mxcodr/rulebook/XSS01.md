# XSS01 — no user-typed attribute shown as HTML
step: security
level: warn
check: security_rules.cjs#findings
key: document

## What it checks
Points out an HTML widget that shows text a user typed as HTML. Someone could type a script that runs in other users' browsers.

## Fix
Show it as text (`tagContentMode: 'container'` and a dynamictext), or clean it on save (CommunityCommons `XSSanitize`); never loosen `sanitizationConfigFull`.

## Local
# level: warn
# except: Module.Document   # why

