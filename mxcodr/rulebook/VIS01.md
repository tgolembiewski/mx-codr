---
step: tests
level: warn
check: scenario-helpers.js#visual_findings
key: none
---

# VIS01 — no two widgets overlap on the page a test ends on

## What it checks
On the page a test ends on, no two widgets lie on top of each other.

## Fix
Usually a box class on inline text or a negative margin; a chart needs a height that fits (`MDL_VISUAL=error` blocks).

## Local
# level: warn

