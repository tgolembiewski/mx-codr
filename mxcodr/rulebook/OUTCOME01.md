# OUTCOME01 — every message a user can be shown is asserted by a test
step: paths
level: block
check: check_paths.cjs#findings
key: document
baseline: paths

## What it checks
Every message the app can show (a success message, a validation error, a "credit limit exceeded" refusal) is checked by a test: the test makes the message appear and reads it on the screen.

## Fix
Walk the path that shows it and assert four words of it in a row, or all of a shorter one: `await_message(/credit limit exceeded for/i)`; the refusals too, not only the successes.

## Local
# level: block
# except: Module.Document   # why

