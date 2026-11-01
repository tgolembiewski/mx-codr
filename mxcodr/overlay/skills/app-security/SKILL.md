---
name: app-security
description: "A Mendix app people sign in to: security at Production with strict mode from the first script, roles that include Administration.User, a demo user per role, your entity linked to Administration.Account and the role's access rule constrained on that link, row isolation tested from both sides, refusals proven by attempting the action as the wrong role, secrets and addresses in constants. Use before the first role, access rule or demo user, and before any test of who may see or do what."
---

# App security

This skill is how this project does security in an app people sign in to. The syntax lives in mxcli's
own skills: `manage-security` (roles, grants, demo users, guest access, the System-module ceiling),
`xpath-constraints` (the constraint language), `system-module` (what `System.User`,
`Administration.Account` and the workflow entities hold). Read those for the spelling; this page says
which choices to make and how to prove them.

## Security on is the whole login

When the app has users who sign in, you need no login page of your own: with security on, the runtime
serves its own sign-in page. Set it in the first script, before the first page or rule:

```sql
mdl 1;
alter app security ( SecurityLevel: production, StrictMode: true, EnableDemoUsers: true );
```

- **Production, not Prototype.** At Prototype level Mendix ignores the XPath on access rules, so a
  test goes green on an app that shows everyone's data. Build at Production from the start; every
  entity a page reads then needs a rule for that page's role, or the page comes up empty, which you
  notice at once instead of at go-live.
- **Strict mode on.** Without it a user can read and change data through the browser in ways no page
  offers. One exception: in an app with an offline profile on Mendix before 11.12.5, strict mode
  breaks every client commit of a synced object; there leave it off and say so in your report.
- The setting is a requirement like any other, so keep a check of it: read it back with
  `./mxcli -p App.mpr -c "show project security"` and assert the level and strict mode, or prove it
  in the browser (a forged request for a field the role may not read comes back empty or refused).
- An app with no users at all (a public kiosk, a pure API) is the one case for leaving security off.

## Roles and demo users

When you create a user role for people who sign in, include `Administration.User` and `System.User`
beside your own module role, so the person can sign in and manage their own account:

```sql
mdl 1;
create module role Sales.Customer;
create user role Customer ( ModuleRoles: (Sales.Customer, Administration.User, System.User) );
create demo user 'demo_customer' ( Password: 'Customer1234!', Entity: Administration.Account, UserRoles: (Customer) );
```

- **One demo user per role you sign in as.** Demo users are the seeded logins: how the person tries
  each role and how your tests sign in. Give each a password the password policy accepts (letters,
  digits, a symbol, 12 characters is safe). They sit beside real accounts; a request for "real
  sign-in" means real accounts as well, never demo users removed. Switching them off is the person's
  step before go-live, not yours.
- **Keep the passwords out of the tests' source.** Read them from an env file your Playwright config
  loads, and leave that file out of git if the request asks for it.
- **The password policy** (length, digit, mixed case, symbol) is set in Studio Pro under App
  Security; mxcli cannot set it. When the request asks for a strong policy, say in your report that
  this is a step for the person, and test what you can (a weak password refused at sign-up or reset).
- Accounts are managed with the Administration module's own pages; a change to them goes in an
  `AdministrationExt` module (skill `module-structure`).

## Your data, linked to the account

When a role may see only its own rows, link your own entity to `Administration.Account` and constrain
your rule on that link.

- **Never grant your own module roles on `Administration.*` entities** (Studio Pro reports CE0007),
  and `grant ... on System.User` is refused at `exec`. mxcli's `manage-security`, section "The
  System-module ceiling", explains why a list over `System.User` shows blank names.
- **Never extend `System.User` or `Administration.Account`** with business data. Keep it in your own
  entity (Customer, Employee) with a one-to-one link to the account.
- **The link crosses modules, so delete it with `on delete set null`.** A restrict rule on that link
  stops the runtime at startup.
- **Constrain the rule on the link, with full names and the token quoted.** `CurrentUser()` and
  `$currentUser` pass `mxcli check` and fail the build with CE0161.

```sql
mdl 1;
create association Sales.Customer_Account from Sales.Customer to Administration.Account type reference on delete set null;
grant read *, write * on entity Sales.Order to Sales.Customer where [Sales.Order_Customer/Sales.Customer/Sales.Customer_Account = '[%CurrentUser%]'];
```

## Rules that hold on the server

What a page shows is not security; the access rule is. When you write a rule, write it for what the
role may do anywhere, not for what one page offers.

- **A page that shows a user only their own rows** (`[%CurrentUser%]` in its XPath) needs the same
  constraint on the role's access rule. Rules add up: a second, constrained rule beside an open one
  changes nothing, so change the open one. Not needed when the role legitimately has another page that
  lists every row.
- **A data source microflow skips entity access**, so its retrieve returns every row. When the page's
  role may see only some rows, constrain the retrieve itself to the user. The runtime still blanks the
  members the role may not read when the objects reach the browser (mxcli's `manage-security`, "a
  microflow data source moves the rows, not the members").
- **A view entity that adds up everyone's rows** (a total over all customers' invoices) must not be
  readable by a role that may see only its own. Constrain the rule, or read the view inside a microflow
  and return your own object with only that user's numbers.
- **Member access is part of the rule.** When a role may see only some fields (a customer sees a
  product's name and SKU, never its cost), list them: `grant read (Name, Sku) on entity Sales.Product
  to Sales.Customer;`. A `read *` rule also makes attributes added later readable; a member list leaves
  them unreadable (mxcli's `manage-security`, "Members added later").
- **Leave server-set fields out of the write list.** A total, a status or a decision date is set by a
  microflow, which does not need the right; when the role may write it, the browser can too. A
  `write (...)` list drops what it does not name, so keep in it the associations a picker or a "new"
  button sets, or those turn read-only.
- **Grant each microflow and page only to the roles that use it.** Mendix hides a button whose
  microflow or page the role may not run or view. That is the shape to keep: a Manager-only action is
  granted to the Manager role and absent for everyone else, and the microflow can still check the
  current user's role as a second line.
- **A microflow that completes a workflow task** (approve, reject) first checks that the person
  clicking is one of the task's targets: retrieve the task's target users over
  `System.WorkflowUserTask_TargetUsers` and refuse when `[%CurrentUser%]` is not among them. Grant the
  flow only to the roles the task targets.
- **The guest role creates and writes no persistent entity.** When visitors who are not signed in
  give input (a contact form, a sign-up), take it in a non-persistent entity and let a microflow check
  and store it. Whatever the guest role can read is public; constrain it (mxcli lint SEC004, SEC007).

## Secrets, addresses and queries

- **A secret goes in a constant with an empty default.** A default value ends up in every build and
  backup. Set the value per environment: locally with `alter settings constant`, on a server at
  deployment.
- **A REST address comes from a constant.** A written-in `http://localhost:8080` calls the wrong place
  on any other port and in every deployment. Put the address in the URL template; a REST client's base
  URL cannot take a constant in mxcli (CE7247); with an inline call, pass it from the microflow. The same holds for the
  app's own published service: its constant's default names the port in the app's run configuration.
- **Never build a query by joining text and a variable.** Whoever controls the variable controls the
  query. Use a database connection query with parameters, or OQL parameters.
- **Show text a user typed as text, never as HTML.** In an HTML widget a typed script runs in other
  users' browsers; use a dynamic text, or clean the value on save (CommunityCommons `XSSanitize`).

```sql
mdl 1;
create constant Sales.ApiKey ( Type: String, DefaultValue: '' );
create constant Sales.ApiBaseUrl ( Type: String, DefaultValue: 'https://api.example.com' );
alter settings constant @Sales.ApiKey value 'local-dev-key' in configuration 'Default';
create microflow Sales.ACT_Rates_Refresh ()
returns String as $Body
begin
  $Body = call rest service get '{1}/rates' with ({1} = @Sales.ApiBaseUrl) returns String;
  return $Body;
end;
```

`get @Sales.ApiBaseUrl + '/rates'` is stored as that literal text; use the `{1}` template.

## Proving it from both sides

Every rule above has two sides, and a test proves both: the permitted role succeeds, and the wrong
role is refused by the server. Plant something only one user may see (an order number, a note such as
`SECRET-NOTE-42`), sign in as another user of the same role and assert it never appears, on the page
and in the data (mxcli's `verify-with-oql`); then sign in as its owner and assert it does. Prove a
refusal by attempting the forbidden action as the wrong role: call the microflow from that role's
browser session, open the page's URL, send the REST or OData request with that role's credentials, and
assert the server refuses it (the refusal below, a 401 or 403, an unchanged row in the data). Then do the
same action as the permitted role and assert it succeeds and changes what it should. Never weaken the app
so that a test can see a message. In one run a rule that demanded every message be asserted on screen
led the agent to show Approve and Reject to Employees and widen `ACT_Order_Approve` to Employee, then
replace its stronger test with "click, read the refusal". The right test kept the buttons absent for
Employees, sent a forged `ACT_Order_Approve` call from an Employee's session and asserted the server
refused it, and approved the same order as the Manager.

**What the runtime answers a forged microflow call** (a `runtimeOperation` POST to `/xas/`, measured on
Mendix 11.12). HTTP 560 alone proves nothing: it is the runtime's answer to any exception.

| The call | Status | Body |
|---|---|---|
| a role without execute rights on the flow | 560 | `"description":"Executing runtime operation failed for security reasons: <operation id>"`; the runtime log warns "does not have the required permissions" |
| an operation id that does not exist | 560 | the same security text |
| a permitted role, the flow refuses (`show message`) | 200 | `"actionResult":{"type":"Boolean","value":false}` and the text under `instructions` |
| a permitted role, `validation feedback` | 200 | the message under `datavalidation[].errorFields` |
| a parameter of the wrong entity (a server exception) | 560 | `{"result":560,"type":"exception"}`, no description; ERROR in the log |

So a refusal test asserts the status and the security text, and replays the same recorded call as the
permitted role to show the operation id is real:

```ts
const refused = await forgeOperation(employeePage, approve);   // the operation recorded as the Manager
expect(refused.status).toBe(560);
expect(refused.body).toContain('failed for security reasons');
```

Asserting `"type":"exception"` matches the crash as well. A missing object is no refusal either: the
flow gets an empty parameter and answers 200 with its own message.

A checklist of what deserves such a test, when the app has it:

- the security level and strict mode, read back from the model;
- each row-scoped entity: own rows visible, another user's absent, for every role scoped on it;
- each field a role may not read: absent from the page and from a forged request;
- each action limited to a role: absent for the others, refused when forged, done by the permitted role.
  Every such action gets one forged call by a role without the right (`captureOperation` as the permitted
  role, `forgeOperation` as the other; assert 560 and `failed for security reasons`) and the same call by
  the permitted role succeeding (200). Typical kinds: approve and reject, status changes, scheduled or
  admin jobs run on demand, generating a document, editing a locked or finished record, reset and admin
  actions. A refusal shown only in the UI (a hidden button) does not count as tested;
- each published REST or OData service: refused without sign-in, filtered per role, no hidden fields;
- each workflow task: completed by a target user, refused for anyone else.

mxcli's `test-app` has the Playwright vocabulary; sign out at the end of every test.
