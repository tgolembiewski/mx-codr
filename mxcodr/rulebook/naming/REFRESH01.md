---
step: naming
level: block
check: check_mdl.cjs#refreshFindings
key: none
---

# REFRESH01 — a pop-up's Save commits with refresh

## What it checks
When the Save button of a pop-up commits an object and closes the pop-up, the commit refreshes the client. Otherwise the list behind the pop-up does not show the new or changed row until the user reloads.

## Fix
`commit $Invoice refresh;`, `change $Invoice (...) commit refresh;` -- blocks DONE.

## Local
# level: block

