---
step: coverage
level: warn
check: test_rules.cjs#waitFindings
key: document
---

# WAIT01 — a test waits for events, not for time

## What it checks
A browser test that pauses for a fixed time (`page.waitForTimeout` over 500 ms), or that waits up to N ms for something that may never come (`waitFor({timeout: N}).then(() => true).catch(() => false)`), pays that time on every run. On InvoiceB2B two tests paid 6 s per order they opened that way.

## Fix
Await what the action causes (`await_message`, `landed`, a locator); a filtered list: `filter_list`.

## Local
# level: warn
# except: verify-<feature>.test.sh   # why
