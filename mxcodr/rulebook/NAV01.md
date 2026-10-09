# NAV01 — users can log out
step: layout
level: block
check: layout_rules/navigation.cjs#signOutFindings
key: none

## What it checks
With login: the user can log out, through a Log out menu item or button.

## Fix
`menu item 'Log out' ( OnClick: sign out, Icon: Atlas_Core.Atlas_Filled.logout )` as the menu's last item.

## Local
# level: block

