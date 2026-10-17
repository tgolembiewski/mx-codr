---
step: naming
level: warn
check: naming_rules.cjs#actionFindings
key: none
baseline: captions
---

# CAPTION01 — every activity has a business @caption

## What it checks
Every activity (retrieve, create, change, commit, delete, show page, call…) has a caption in business words, like "Find the customer's open invoices". Checked before each exec too (CAPTION01-07, with a suggested caption per line), so a flow reaches the model captioned.

## Fix
Warns until the first DONE; a microflow new or changed since the last DONE then blocks (`level: block` on CAPTION01-06: all block).

## Local
# level: warn

