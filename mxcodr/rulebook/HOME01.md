# HOME01 — administrators open on a page of the app's own module
step: layout
level: block
check: layout_rules/accounts.cjs#adminHomeFindings
key: none

## What it checks
With login: administrators start on a page of the app itself, not on a template page.

## Fix
Create `<Module>.Admin_Home` and `home page <Module>.Admin_Home for Administrator`.

## Local
# level: block

