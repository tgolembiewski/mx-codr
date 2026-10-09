---
step: naming
level: warn
check: perf_rules.cjs#perfFindings
key: none
---

# PERF06 — no loop that only keeps the largest or smallest value

## What it checks
Points out a loop that only looks for the highest or lowest value. One sorted retrieve of the first row does it.

## Fix
`retrieve $Last from M.E where [...] sort by M.E.Attr desc first;`.

## Local
# level: warn

