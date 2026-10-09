# PERF05 — no whole table retrieved and then filtered with an if
step: naming
level: warn
check: perf_rules.cjs#perfFindings
key: none

## What it checks
Points out a retrieve of a whole table followed by an if that keeps some rows. Filter in the retrieve's XPath instead.

## Fix
The condition in the retrieve's XPath.

## Local
# level: warn

