# EVENT02 — a before handler that can refuse raises an error
step: naming
level: block
check: event_rules.cjs#eventFindings
key: none

## What it checks
A before-commit event microflow that can say "no" (return false) is set to raise an error. Otherwise the save is skipped and the user gets no message at all.

## Fix
`... on before commit call M.BCO_X($currentObject) raise error`, or the check in the ACT_ microflow with `validation feedback` -- blocks DONE.

## Local
# level: block

