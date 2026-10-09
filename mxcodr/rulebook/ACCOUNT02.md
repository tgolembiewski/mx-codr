---
step: layout
level: block
check: layout_rules/accounts.cjs#accountFindings
key: none
---

# ACCOUNT02 — a My account menu item

## What it checks
With login: everyone has a "My account" menu item to change their own password.

## Fix
`menu item 'My account' ( OnClick: call microflow Administration.ManageMyAccount, Icon: Atlas_Core.Atlas_Filled.user )` before Log out.

## Local
# level: block

