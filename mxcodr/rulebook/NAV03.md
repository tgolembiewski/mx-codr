# NAV03 — every role's home page is in the menu
step: layout
level: block
check: layout_rules/navigation.cjs#roleHomeFindings
key: none

## What it checks
With login: every role's home page is also in the menu, so users can get back to it.

## Fix
`menu item '<caption>' ( OnClick: show page <Page>, Icon: <icon> )` before Log out.

## Local
# level: block

