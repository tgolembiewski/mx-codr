---
step: naming
level: warn
check: event_rules.cjs#eventFindings
key: none
---

# EVENT04 — no plain Save button on an entity a before handler can refuse

## What it checks
Points out a plain Save button on an entity whose before-commit event can refuse: the user sees only "An error has occurred". Save through a microflow with a validation message instead.

## Fix
Save through an `ACT_` microflow: `validation feedback $X/Attr message '...';`, then commit; the handler stays as the last guard.

## Local
# level: warn

