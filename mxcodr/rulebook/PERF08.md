---
step: naming
level: warn
check: index_rules.cjs#redundantFindings
key: none
---

# PERF08 — no index that no query needs

## What it checks
Points out an index that no search in the app uses. It only slows down saving.

## Fix
The `drop index if exists (...)` it prints, spelled as written; keep it if Java, other OQL or an outside client filters on it.

## Local
# level: warn

