# PERF02 — no loop over database rows that only adds them up
step: naming
level: warn
check: perf_rules.cjs#perfFindings
key: none

## What it checks
Points out a loop over database rows that only adds them up or counts them. The database can do that in one query.

## Fix
An OQL view entity computes totals in one query; `count()`/`sum()` after the retrieve is no faster.

## Local
# level: warn

