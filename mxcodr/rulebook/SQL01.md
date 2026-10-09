# SQL01 — no query built by joining text and a variable
step: security
level: block
check: security_rules.cjs#findings
key: document

## What it checks
No microflow builds a database query by gluing text and a variable together. Whoever controls the variable controls the query (SQL injection).

## Fix
A database connection query with parameters, or OQL parameters.

## Local
# level: block
# except: Module.Document   # why

