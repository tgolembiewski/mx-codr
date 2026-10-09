---
step: naming
level: warn
check: check_mdl.cjs#loopFindings
key: none
baseline: captions
---

# CAPTION06 — every loop has an @annotation saying what it walks

## What it checks
Every loop has an annotation saying what it walks through.

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block).

## Local
# level: warn

