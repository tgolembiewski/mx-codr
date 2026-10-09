---
step: naming
level: warn
check: index_rules.cjs#indexFindings
key: none
---

# PERF07 — every query is served by an index

## What it checks
Points out a search on attributes that no index covers. The finding prints the index to add.

## Fix
The line it prints: `alter entity M.E add index if not exists (A, B);`, `=` columns first; a query along an association needs none.

## Local
# level: warn

