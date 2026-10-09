---
step: naming
level: warn
check: perf_rules.cjs#perfFindings
key: none
---

# PERF03 — no database call per row inside such a loop

## What it checks
Points out a database call for every row inside such a loop (a retrieve, a Java action, a sub-microflow that reads data): with 10,000 rows, 10,000 calls.

## Fix
One retrieve before the loop (XPath over the association), or an OQL view.

## Local
# level: warn

