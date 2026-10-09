---
step: naming
level: warn
check: check_mdl.cjs#actionFindings
key: none
baseline: captions
---

# CAPTION02 — no activity keeps Mendix's default caption

## What it checks
No activity keeps the caption Mendix gives it by default, like "Retrieve Invoice" or "Commit object".

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block).

## Local
# level: warn

