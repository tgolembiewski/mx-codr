# ERR01 — every error handler is noticed
step: naming
level: warn
check: event_rules.cjs#eventFindings
key: none

## What it checks
Points out an error handler that nobody would notice: it should log, show a message, raise the error again or return.

## Fix
`log error 'Saving failed: ' + $latestError/Message;` and `raise error;`; `on error continue` is mxcli's lint CONV014.

## Local
# level: warn

