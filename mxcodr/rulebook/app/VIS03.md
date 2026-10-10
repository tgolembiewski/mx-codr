---
step: tests
level: warn
check: scenario-helpers.js#visual_findings
key: none
---

# VIS03 — no text is cut off by its box

## What it checks
No text is cut off because its box is too small.

## Fix
A fixed height on a text box, or a box class on inline text (`level: block` in ## Local blocks).

## Local
# level: warn

