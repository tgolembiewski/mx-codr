---
step: naming
level: warn
check: event_rules.cjs#eventFindings
key: none
---

# EVENT03 — no without events on an entity whose handler does work

## What it checks
Points out a commit "without events" on an entity whose event microflow sets or checks something: that work is silently skipped.

## Fix
Set those values in the flow, or drop `without events`; inside the entity's own handler it is the fix, not a finding.

## Local
# level: warn

