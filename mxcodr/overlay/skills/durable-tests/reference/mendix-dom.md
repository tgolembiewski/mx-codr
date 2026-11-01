# How Mendix renders, for tests

Read before the first selector or expected value, and again when a locator times out or a value differs
from what you expected: most such failures are one of these facts, not a broken feature. Measured on
Mendix 11.12 with Atlas 3 and Data Grid 2, in a browser test suite of 63 tests; the one row seen on a single
layout only says so. The `tests/mx.ts` helper that relies on a fact is named in brackets.

## Sign-in, sessions and refused pages

| Fact | Selector or value |
|---|---|
| The login page's fields [`signIn`] | `#usernameInput`, `#passwordInput`, `#loginButton` on `/login.html` |
| A sign-in that the runtime refuses stays on the login form | the text "Sign in failed." about 0.3 s after submit; at the session limit the runtime log says "Maximum number of sessions exceeded" |
| A warm sign-in | about 1 s; 20 s means something is wrong |
| The trial runtime's session limit | six sessions, stale ones included; past it every sign-in fails |
| Closing the page or its browser context does not end a session | it stays alive on the server; only a logout ends it [`signOut`] |
| A page the role may not open | `login.html?messageCode=403#/<page>`, the login form shown, no `window.mx`, the session still alive |
| An unknown URL while signed in | the role's home page |
| A page URL while not signed in | `/#/<page>`, then the login form |
| The CSRF token of a session | `mx.session.getConfig('csrftoken')` while `window.mx` exists |

## Dialogs, messages and inputs

| Fact | Selector or value |
|---|---|
| A message dialog [`dialogText`] | `.mx-dialog .mx-dialog-body`; the newest is the last |
| Its buttons [`dismissDialog`] | `.mx-dialog-footer .btn` |
| An error dialog | the dialog also has the class `mx-dialog-error` |
| A validation message is not the field's label | a label "Password (12+ characters)" is not the message "at least 12 characters": assert the message the flow sets |
| An input commits on blur [`fillInput`] | `fill`, then Tab, before a click on Save |
| A Decimal input shows two decimals | `23.00` for a stored `23` |
| `formatDecimal(x, '#,##0.00')` on a page | `55,500.00` |
| The Combobox menu is lazy [`pickCombo`] | click `input.widget-combobox-input`, type, then `.widget-combobox-menu li` |
| `.btn` inside a form or a grid | also matches pager and column-selector buttons: count buttons by `.mx-name-<widget>` |

## Grids, menus and charts

| Fact | Selector or value |
|---|---|
| Data Grid 2 rows [`rowOf`] | `.mx-name-<grid> [role=row]`; the header row is a `[role=row]` too |
| Its cells [`cell`] | `[role=gridcell]` |
| Its headers | `[role=columnheader]`, including a "Column selector" entry; a header's text may be only in `title` |
| An empty grid's pager | "Currently showing 0 to 0 of 0" |
| A text filter [`filterGrid`] | applies on Enter; the grid first shows its unfiltered first page, so wait for the row |
| The navigation menu [`menuItems`] | `.mx-navigationtree a` (seen on Atlas_Default) |
| Plotly chart axis labels | `.xtick text`, `.ytick text` |

## Calls the client makes

| Fact | Selector or value |
|---|---|
| A button that runs a microflow [`captureOperation`] | POST `/xas/` with `action: 'runtimeOperation'`, `operationId` and `params`, never the microflow's name |
| Page loads send `runtimeOperation` too | only a button's call carries `validationGuids` |
| A forged call's answers [`forgeOperation`] | 560 with `failed for security reasons` = refused; 560 without it = a crash or the session limit; 200 = the flow's own answer |
| Strict mode [`retrieveByIds`] | `mx.data.get` throws `NotAllowedInStrictModeError`; read by id with `retrieve_by_ids` over `/xas/` |
| Member access in an answer | an attribute the role may not read is left out; `readonly: true` appears only on attributes that are sent; `createdDate` is always sent |

## OQL (`./mxcli oql --json`) [`oql`, `sessionsLeft`]

| Fact | Selector or value |
|---|---|
| It reads the running app | a stopped app: "cannot connect to Mendix admin API" |
| The output | a JSON array of objects keyed by alias; every value a string (`"5"`, `"4200"`) except Booleans (`true`); a null column is left out; no rows is `[]` |
| A count over no rows | `[{"N":"0"}]` |
| Dates | `"Sun Oct 18 03:40:33 CEST 2026"`, in the server's time zone |
| Sorting | `order by x desc limit 5`; `sort by` does not parse |
| System attributes | lower case: `createdDate` (`CreatedDate` fails) |
| `System.Session` | `ID`, `SessionId`, `CSRFToken`, `LastActive`, `createdDate`; its user by `left join s/System.Session_User/System.User u`, then `u.Name` |

## Data a test did not make

| Fact | What to do |
|---|---|
| A seeded row may have lines, references or another state than you assume | pick the row by OQL first (one with lines, one without a reference) |
| A test passes alone and fails after others | it reads state another test changed: assert relative to what it created or read just before |
