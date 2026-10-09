---
step: paths
level: block
check: check_paths.cjs#findings
key: document
baseline: paths
---

# ISO01 — each row-scoped role reads its entity in a test

## What it checks
When a role may only see its own records (for example a customer sees only their own orders), a test logs in as that role and checks that their own records are there and someone else's are not.

## Fix
As that user, show one of its own rows is there and another user's row is not (`oql_count` with the other user's key = 0, or the API the role reads through).

## Local
# level: block
# except: Module.Document   # why

