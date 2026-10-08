# security rules: Mendix's own security best practices

The `security` step reads the app's own modules for what Mendix's security guidance
(docs.mendix.com, "Best Practices for App Security") says never to ship. The level itself
(`PRODUCTION`) and `VIEW01` are in `tests/checks/app.md`. Every code blocks DONE unless its line says "warning";
every finding of the last gate is in `.mxcli/security.txt`.

| Code | Wants | Fix |
|---|---|---|
| `CRED01` | no constant named for a secret (password, token, API key, credential) with a default value: a default ships in every build, package and backup -- and to every browser when it is exposed to the client | `DefaultValue: ''` in the script that creates the constant, and that script exec'd again (there is no `alter constant`; a second `create` elsewhere is SCRIPT01); the value per environment: locally `alter settings constant @M.C value '...' in configuration 'Default';` (a run configuration's value stays out of the package), on a server at deployment |
| `ANON01` | the guest role creates or writes no persistent entity | revoke it; take a visitor's input in a non-persistent entity and a microflow that checks it |
| `STRICT01` | strict mode on: without it the client API reads and changes data the model never offers | `alter app security ( StrictMode: TRUE );` |
| `FILTER01` | a page that shows a role only its own rows (`[%CurrentUser%]` on a list) has the same XPath on that role's access rule -- a filter on a page is not security | write the role's rule again with it: `grant read (...) on entity M.E to M.R where <the page's XPath>;` -- a second, constrained rule beside the old one changes nothing, rules add up. Not raised when the role has another page that lists every row |
| `SQL01` | no query built by joining text and a variable | a database connection query with parameters, or OQL parameters |
| `EXTENDS01` | warning: no entity of the app specialises `System.User` or `Administration.Account` | your own entity with a 1-1 association to the account, deleted with it |
| `XSS01` | warning: an HTML Element in `innerHTML` mode shows no attribute a user types | show it as text (`tagContentMode: 'container'` and a dynamictext), or clean it on save (CommunityCommons `XSSanitize`); never loosen `sanitizationConfigFull` |
| `WRITE01` | warning: a role writes no attribute that only server-side flows set (totals, status, dates) and none of its pages edits | leave those attributes out of the rule's write list; a microflow without `@applyentityaccess` still sets them (one with it, or a nanoflow, needs the right and is never flagged). A `write (...)` list drops what it does not name: keep in it the associations the finding lists, or a picker or a "new" button that sets one turns read-only |
| `ADMIN01` | warning, for the person: the administrator is not called `MxAdmin` | Studio Pro, App Security > Administrator. mxcli cannot change it: leave it |
| `PWD01` | warning, for the person: a strong password policy (8+, digit, mixed case, symbol) | Studio Pro, App Security > Password policy. mxcli cannot change it: leave it |

Mendix's own reasoning, in one line each: a model with any of the blocking ones passes Studio
Pro and runs, and is open to whoever finds it; what a page hides, the client API still serves.
