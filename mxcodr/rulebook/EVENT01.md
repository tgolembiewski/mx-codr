# EVENT01 — an event handler never commits its own object with events
step: naming
level: block
check: event_rules.cjs#eventFindings
key: none

## What it checks
An entity's after-commit event microflow does not commit its own object again with events. That commit starts the same event again: an endless loop.

## Fix
`commit $Order without events;` in an after-commit handler; a before-commit handler only changes attributes -- blocks DONE.

## Local
# level: block

