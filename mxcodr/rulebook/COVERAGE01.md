---
step: coverage
level: block
check: check_test_coverage.cjs#moduleReport
key: none
---

# COVERAGE01 — every page and ACT_ microflow is named on a # covers: line of a test

## What it checks
Every page and every ACT_ microflow has a test. A test says which pages and microflows it tests in a comment at its top, # covers: Order_List, ACT_Order_Save. This rule checks that every page and ACT_ microflow appears in such a comment, and that every name in those comments really exists in the app (a renamed page leaves an old name behind).

## Fix
Names separated by commas or spaces; a `SUB_`, an entity or an enumeration does not count.

## Local
# level: block

