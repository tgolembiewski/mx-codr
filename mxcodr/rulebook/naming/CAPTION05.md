---
step: naming
level: warn
check: check_mdl.cjs#decisionFindings
key: none
baseline: captions
---

# CAPTION05 — a decision's caption is a question in words, not the expression

## What it checks
A decision's caption is not the expression itself ($Order/Total > 1000). It says the question in words.

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`MDL_CAPTIONS=error`: all block).

## Local
# level: warn

