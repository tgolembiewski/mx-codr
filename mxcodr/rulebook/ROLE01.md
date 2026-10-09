---
step: paths
level: block
check: check_paths.cjs#findings
key: document
baseline: paths
---

# ROLE01 — every demo user's role is the user of some test

## What it checks
Every demo user's role is used by at least one test.

## Fix
A journey per role: what it sees, and what it is refused.

## Local
# level: block
# except: Module.Document   # why

