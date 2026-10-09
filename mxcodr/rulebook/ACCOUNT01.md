---
step: layout
level: block
check: layout_rules/accounts.cjs#accountFindings
key: none
---

# ACCOUNT01 — a Users menu item for administrators

## What it checks
With login: administrators have a "Users" menu item to manage accounts.

## Fix
`menu item 'Users' ( OnClick: show page Administration.Account_Overview, Icon: ... )` before Log out.

## Local
# level: block

