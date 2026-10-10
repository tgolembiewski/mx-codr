---
step: naming
level: warn
check: check_mdl.cjs#decisionFindings
key: none
baseline: captions
---

# CAPTION03 — every decision has a @caption

## What it checks
Every decision has a caption.

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`level: block` on CAPTION01-06: all block).

## Local
# level: warn

