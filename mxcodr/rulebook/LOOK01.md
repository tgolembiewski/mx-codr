---
step: tests
level: warn
check: gate_helpers.cjs#reviewScreenshots
key: none
---

# LOOK01 — every screenshot the suite took has been reviewed (MDL_VISUAL_REVIEW=agent)

## What it checks
Only when switched on: an AI model has looked at a screenshot of every page.

## Fix
Read each PNG in `.mxcli/visual/review.md`; write `verdicts.json`.

## Local
# level: warn

