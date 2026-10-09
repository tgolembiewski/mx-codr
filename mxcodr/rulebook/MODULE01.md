---
step: layout
level: block
check: layout_rules/accounts.cjs#templateModuleFindings
key: none
---

# MODULE01 — MyFirstModule is gone once the app has its own module

## What it checks
The empty MyFirstModule from the Mendix template is deleted once the app has its own module. The finding lists what still uses it.

## Fix
Re-point home pages, drop `MyFirstModule.User` from user roles, `drop module MyFirstModule;`.

## Local
# level: block

