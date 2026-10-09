# ACCOUNT03 — every signing-in role includes Administration.User; someone manages users
step: layout
level: block
check: layout_rules/accounts.cjs#accountFindings
key: none

## What it checks
With login: every role that logs in includes the Administration module's User role, and some role can manage users.

## Fix
`alter user role <Role> add module roles (Administration.User);` and `Administration.Administrator` on the administrators' role.

## Local
# level: block

