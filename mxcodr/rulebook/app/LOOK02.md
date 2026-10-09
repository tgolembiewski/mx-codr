---
step: tests
level: warn
check: gate_visual.cjs#reviewScreenshots
key: none
---

# LOOK02 — no reviewed screenshot was rejected (MDL_VISUAL_REVIEW=agent)

## What it checks
Only when switched on: none of those screenshots was judged to look wrong.

## Fix
Read each PNG in `.mxcli/visual/review.md`; write `verdicts.json`.

## Local
# level: warn

