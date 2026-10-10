# security -- the security level and the security rules (`security_rules.cjs`)

One line per code of the `security` step; every code blocks DONE unless marked warning. The card: `tests/rulebook/security/<CODE>.md`.

| Code | Wants | Fix |
|---|---|---|
| `ADMIN01` | warning: the administrator is not called MxAdmin | Studio Pro, App Security > Administrator. mxcli cannot change it: leave it. |
| `ANON01` | the guest role creates or writes no persistent entity | Revoke it; take a visitor's input in a non-persistent entity and a microflow that checks it. |
| `CRED01` | no secret in a constant's default value | `DefaultValue: ''` in the script that creates the constant, and that script exec'd again (there is no `alter constant`; a second `create` elsewhere is SCRIPT01); the value per environment: locally `alter settings constant @M.C value '...' in configuration 'Default';` (a run configuration's value stays out of the package), on a server at deployment. |
| `EXTENDS01` | warning: no entity specialises System.User or Administration.Account | Your own entity with a 1-1 association to the account, deleted with it. |
| `FILTER01` | an own-rows page filter is backed by the access rule | Write the role's rule again with it: `grant read (...) on entity M.E to M.R where <the page's XPath>;` -- a second, constrained rule beside the old one changes nothing, rules add up. Not raised when the role has another page that lists every row. |
| `PRODUCTION01` | project security is at Production (and VIEW01 is checked) | `alter project security level PRODUCTION;` in the first script (`level: off` in ## Local only for an app with no users). |
| `PWD01` | warning: a strong password policy | Studio Pro, App Security > Password policy. mxcli cannot change it: leave it. |
| `SQL01` | no query built by joining text and a variable | A database connection query with parameters, or OQL parameters. |
| `STRICT01` | strict mode is on | `alter app security ( StrictMode: TRUE );`. |
| `VIEW01` | a row-scoped role does not read a view over everyone's rows | Constrain the rule, or revoke it and read the view in a data-source microflow. |
| `WRITE01` | warning: a role does not write what only server-side flows set | Leave those attributes out of the rule's write list; a microflow without `@applyentityaccess` still sets them (one with it, or a nanoflow, needs the right and is never flagged). A `write (...)` list drops what it does not name: keep in it the associations the finding lists, or a picker or a "new" button that sets one turns read-only. |
| `XSS01` | warning: no user-typed attribute shown as HTML | Show it as text (`tagContentMode: 'container'` and a dynamictext), or clean it on save (CommunityCommons `XSSanitize`); never loosen `sanitizationConfigFull`. |
