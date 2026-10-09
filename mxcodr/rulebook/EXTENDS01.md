# EXTENDS01 — no entity specialises System.User or Administration.Account
step: security
level: warn
check: security_rules.cjs#findings
key: document

## What it checks
Points out an entity that extends the user account (System.User or Administration.Account). Keep business data in its own entity, linked to the account.

## Fix
Your own entity with a 1-1 association to the account, deleted with it.

## Local
# level: warn
# except: Module.Document   # why

