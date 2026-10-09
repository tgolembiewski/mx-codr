---
step: security
level: block
check: security_rules.cjs#findings
key: none
---

# ANON01 — the guest role creates or writes no persistent entity

## What it checks
Anonymous (not logged in) users cannot create or change stored data.

## Fix
Revoke it; take a visitor's input in a non-persistent entity and a microflow that checks it.

## Local
# level: block

