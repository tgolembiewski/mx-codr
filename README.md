# mx-codr

**Your AI agent builds the Mendix app. mx-codr makes sure it is actually finished.**

Claude Code, Codex, Cursor, OpenCode and Pi can already write Mendix domain models, microflows and
pages through [mxcli](https://github.com/mendixlabs/mxcli). What they do not do on their own is
*prove* the work: a test for every screen, a model that passes Mendix's own checks, microflows a
colleague can read, screens that are not glued together. mx-codr comes with
**one installer** that takes care of every dependency -- mxcli, Node, Playwright and its browser,
MxBuild, PostgreSQL, the skills and hooks for your agent -- so apart from it you install nothing
else to get AI support in your Mendix project.

The installer adds skills the agent reads, hooks that keep it honest, and one command,
`bash tests/gate.sh`, that answers **DONE** or **NOT DONE**.

## Install

Clone this repo anywhere, then run the installer. It asks for your Mendix project folder (Enter takes
the folder you are in), copies `mxcodr/` there and installs. An empty or new folder gets a new
Mendix app.

**macOS and Linux**

```bash
git clone https://github.com/tgolembiewski/mx-codr.git
./mx-codr/mxcodr/install.sh
```

**Windows**: PowerShell **as administrator**, with Mendix Studio Pro installed:

```powershell
git clone https://github.com/tgolembiewski/mx-codr.git
powershell -ExecutionPolicy Bypass -File mx-codr\mxcodr\bootstrap.ps1
```

When it is done, start a **new** agent session in the project folder and ask for a feature. (An
agent reads its skills when the session starts; the session that ran the installer does not see
them.)

**Options**

```
bash mx-codr/mxcodr/install.sh [project-folder] [--no-app] [--no-deps]

  project-folder   the Mendix project; asked for when not given (default: the current folder)
  --no-app         never create a Mendix app; require one to be there already
  --no-deps        only report missing prerequisites instead of installing them
```

Run it again any time (from the project: `bash mxcodr/install.sh`) to upgrade. The harness is
replaced; your tests, `tests/credentials.env`, `tests/harness.env` and your rule changes are kept.

**What the installer does for you**

| | |
|---|---|
| Your Mendix app | creates one if the folder has none; on a Mac with several Studio Pro versions it asks which, `MX_VERSION` decides without asking |
| How the app runs | asks: **locally** (default; runtime and PostgreSQL on this machine, a model change is live in about a second) or **in Docker** (nothing else installed, about 40 s per change) |
| mxcli | downloads the one release the harness is tested with (`mxcodr/MXCLI_TESTED`, now v0.26.0), checksum-verified |
| Node, Playwright, MxBuild, PostgreSQL | installs what is missing; leaves what is there |
| Skills, hooks, the rulebook, the checkers | puts them where each of the five agents looks |
| Windows | links what Studio Pro's mxbuild needs (Gradle, the JDK the Mendix version wants, ARM64 tools) and boots the app without `mxcli run`, which cannot boot on Windows |
| The app's look | offers Atlas or one of five themes; `bash tests/theme.sh` switches later |
| How Pi keeps its context short | asks whether Pi should compact the conversation at 70% of each model's window instead of at its edge; no by default (a shorter context each turn, but in two of three measured runs more turns, so no proven saving); your answer is kept as `MDL_COMPACTION` |

What it cannot install unattended (a JDK, a Docker daemon to start) it lists at the end, with the
command to run. **Requirements:** on macOS and Linux bash and a package manager (Homebrew, apt or
dnf); on Windows Mendix Studio Pro (the bootstrap installs Git and Node with winget). Everything else
the installer handles.

## What it gives you

Without mx-codr an agent says "done" when it stops typing. With it, "done" means the app was built,
tested in a real browser and checked the way a senior Mendix developer would check it.

- **Apps that work, proven in a browser.** For every feature the agent first writes a browser test
  that fails, then builds until it passes. Every page and every action gets a test, so you get a
  working app and its regression suite in one go.
- **"Done" you can trust.** One command, `bash tests/gate.sh`, runs the tests, Mendix's own
  consistency check and 107 quality rules in parallel. The agent may only say it is finished on
  **DONE**. You never run anything yourself: the hooks make the agent do it.
- **Your model is never broken.** Every change is tried on a copy of the project first. If Studio
  Pro would show an error, your `.mpr` is not touched.
- **Secure by default.** Production security level, no anonymous data access, no credentials in
  the model, XPath constraints where they belong, no raw SQL built from user input.
- **An app that looks like a Mendix app.** One menu with icons, one layout, Back buttons, user
  management, pages with URLs, nothing left over from the template, and an optional theme.
- **A model your colleagues can read.** Business captions on microflow activities, process
  folders, names that say what things are, no unused documents.
- **You decide how strict it is.** Each check the gate makes (for example "every page has a URL")
  is described in its own short text file in your project. Write one line in that file to make the
  check stop the agent, only warn it, or switch it off, or to exclude one page that should stay as it
  is. The agent cannot change these files; it can only suggest the line for you to add.
- **Phone and offline apps, tested without a network.** A test opens the phone or tablet profile at
  its screen size, cuts the network, does the work a field worker does in a basement, checks the
  server has nothing yet, then reconnects, syncs and checks it arrived. Rules catch an offline app
  that cannot work offline: no service worker, nothing synchronized, the template's dead phone menu.
  The app on this machine works offline by hand too: a local build turns the service worker's cache
  off, and the gate turns it on in the built `index.js` and keeps it on across rebuilds, so a browser
  with the network cut in DevTools sees what the tests see.
- **Asked before it is built.** Before the first feature of a new app, or a change that adds a role,
  a module or a channel, the agent asks you a few numbered questions, each with its recommended
  answer: who uses it, what each role does, phone or offline, what counts as done. Each answer is
  recorded as a requirement in the project brain, and `mxcli brain plan` counts what is built.
- **Handed over at DONE.** When the gate ends in DONE it lists the app's address, every demo user
  with its roles and password, and every assumption the agent made without you, and the agent ends
  its report with that list, so you can open the finished app and correct a guess straight away.
- **Any agent, any OS.** Claude Code, Codex, Cursor, OpenCode or Pi, on macOS, Linux or Windows,
  with a cloud model or a local one.
- **See what was tested.** Ask the agent to film a test, or run `bash tests/film.sh <name>`: you
  get a video with each step captioned, in `.mxcli/films/`.

```
 you ask ─▶ agent writes a test ─▶ test fails (red) ─▶ agent builds it in MDL
                                                              │
      DONE ◀── gate: tests · mx check · rules (below) ◀── test passes
```

**The difference in numbers.** We gave the same prompt to the same model (Claude Opus, headless
Claude Code), once without mx-codr and once with it, each time in a fresh Mendix 11.12 app. Both apps
were then judged by the same gate.

| | Without mx-codr | With mx-codr |
|---|---|---|
| Agent said it was finished after | 11.4 min | 15.2 min |
| First **DONE** from the gate | never | 12.2 min |
| Browser tests written | 0 | 7 |
| Gate verdict on the result | **NOT DONE** | **DONE** |
| What the gate found missing | no tests, untested pages, layout | nothing |
| Tokens read (input, mostly cached) | 4.36 million | 4.18 million |
| Tokens written (output) | 32,000 | 53,000 |
| Cost at list price | $7.74 | $8.50 |

With mx-codr the agent read slightly less and wrote more: the extra output went into the browser
tests and more thinking. The first **DONE** came less than a minute after the run without mx-codr
stopped; the remaining minutes were tidying the agent chose to do.

**The prompt used for both runs:**

> Make me an invoice-chasing app for me and my customers. I would like to be able to log in, and
> every customer should have their own separate login.

**Open-source models work too.** Because the gate, the tests and the rules carry the process,
mx-codr gets very good results from open-source models, not only from the large commercial ones.
It was tested with **DeepSeek 4.1 Flash** and **Qwen 3.8 Flash Next** (run locally), through Pi,
on the same invoice-chasing prompt. Both built the app; Qwen reached **DONE** with 6 browser tests
and every page and action covered.

## The rules it keeps

Every rule is a card in your project, `tests/rulebook/<group>/<CODE>.md`: what it checks, how to
fix it, and how hard it judges. **Blocks** means the gate says NOT DONE until it is fixed;
**Warning** is listed under the verdict and does not stop DONE. The gate
prints the code; `tests/checks/<group>.md` says in one line what each code wants.
`bash tests/rules.sh` lists them all, `bash tests/rules.sh explain URL01` shows one.

**Done means tested and building** (19 rules)

The browser tests, Mendix's own check, and what must be true before a script runs.

| Rule | What it checks | Level |
|---|---|---|
| `COVERAGE01` | Every page and every ACT_ microflow has a test. A test says which pages and microflows it tests in a comment at its top, # covers: Order_List, ACT_Order_Save. This rule checks that every page and ACT_ microflow appears in such a comment, and that every name in those comments really exists in the app (a renamed page leaves an old name behind). | Blocks |
| `LOOK01` | Only when switched on: an AI model has looked at a screenshot of every page. | Warning |
| `LOOK02` | Only when switched on: none of those screenshots was judged to look wrong. | Warning |
| `MX01` | Mendix's own consistency check finds no errors: the same red errors Studio Pro would show in its Errors pane. | Blocks |
| `RUNTIME01` | While the tests ran, the Mendix server logged no errors. A test can pass while something failed in the background. | Warning |
| `SCOPE01` | Points out a page whose data source microflow retrieves records that the page's role should only partly see. A microflow ignores access rules, so the retrieve itself must limit the records to the user. | Warning |
| `SCRIPT01` | Each page, microflow, entity or constant is created in only one script in mdlsource/. If two scripts both create the same page, running the older one again silently throws away the newer version. One-off repair scripts kept elsewhere are not compared. | Blocks |
| `STALE01` | An old script cannot be run again if that would undo changes made to its pages or microflows later. Moving a document to another folder does not count as a change. | Blocks |
| `TEST01` | Test first: before a new page or a new ACT_ microflow is added, a browser test for it must already exist. Fixing something that is already in the app is fine. | Blocks |
| `REQ01` | Before the first pages of an app are built, its requirements are recorded in the project brain: one per testable statement of the request (every rule, format, count and role), what it leaves open as an assumption. Until then the exec is refused, with the procedure in the message; an app that grew without a brain gets a warning instead. | Blocks |
| `TESTS01` | Every browser test passes. Microflow unit tests (*.test.mdl) are not run by the gate; it shows the command that runs them. | Blocks |
| `UNUSED01` | No microflow, page, snippet, enumeration or Java action is left that nothing uses. It is reported only if nothing in the app refers to it, its name appears nowhere else, and the app still builds without it. | Blocks |
| `VIS01` | On the page a test ends on, no two widgets lie on top of each other. | Warning |
| `VIS02` | The page does not scroll sideways. | Warning |
| `VIS03` | No text is cut off because its box is too small. On a phone- or tablet-wide screen a data grid's cells count too, an ellipsis included. | Warning |
| `VIS05` | On a phone- or tablet-wide screen the layout's top and bottom bars stay on the screen while the content scrolls. | Warning |
| `VIS06` | On a phone- or tablet-wide screen the page title starts at the top of the content, with who is signed in beside it, not under it. | Warning |
| `VIS07` | Measured at the end of every test: a data grid column whose numbers carry different decimals ("688.8", "1228.77", "5535"), or a page that shows one amount with a thousands separator and another of 1000 or more with decimals and none ("50,000.00" beside "19190.829"). One kind of value in two formats. | Blocks |
| `VIS04` | A chart fits on one screen, in height and in width. | Warning |
| `WAIT01` | A browser test that pauses for a fixed time (`page.waitForTimeout` over 500 ms), or that waits up to N ms for something that may never come (`waitFor({timeout: N}).then(() => true).catch(() => false)`), pays that time on every run. On InvoiceB2B two tests paid 6 s per order they opened that way. | Warning |

**Every path through the app has a test** (7 rules)

mx-codr reads the app and lists everything a user can run into; each needs a test.

| Rule | What it checks | Level |
|---|---|---|
| `ISO01` | When a role may only see its own records (for example a customer sees only their own orders), a test logs in as that role and checks that their own records are there and someone else's are not. | Blocks (warning for paths that existed before the install) |
| `OUTCOME01` | Every message the app can show (a success message, a validation error, a "credit limit exceeded" refusal) is checked by a test: the test makes the message appear and reads it on the screen. An attribute's validation rule counts only where a page lets the user edit that attribute. | Blocks (warning for paths that existed before the install) |
| `REQ02` | Every requirement the person agreed to (a promoted entry in the project brain) is named by a test: the test carries the line `# requirement: <id>`. A requirement no test proves is not built. | Blocks |
| `ROLE01` | Every demo user's role is used by at least one test. | Blocks (warning for paths that existed before the install) |
| `SVC01` | Every published REST or OData service is called by a test. | Blocks (warning for paths that existed before the install) |
| `WF01` | A microflow that approves or rejects a workflow task first checks that the person clicking is someone the task was assigned to. Without that check, anyone allowed to run the microflow can decide someone else's task. | Blocks |
| `WF02` | Every outcome of every workflow task (approve, reject…) is chosen in a test, and the test logs in as both people: the one who starts the workflow and the one who decides. | Blocks (warning for paths that existed before the install) |

**Security** (12 rules)

Mendix's security best practices, checked on the model.

| Rule | What it checks | Level |
|---|---|---|
| `ADMIN01` | Points out that the administrator account is still called MxAdmin. A task for you in Studio Pro; mxcli cannot change it. | Warning |
| `ANON01` | Anonymous (not logged in) users cannot create or change stored data. | Blocks |
| `CRED01` | A constant meant for a secret (a password, token or API key) has no default value. A default ends up in every build and backup. The value is set per environment instead. | Blocks |
| `EXTENDS01` | Points out an entity that extends the user account (System.User or Administration.Account). Keep business data in its own entity, linked to the account. | Warning |
| `FILTER01` | If a page shows a user only their own records (with [%CurrentUser%] in its XPath), the entity's access rule limits them the same way. A filter on a page is not security: another page or the browser could still read everything. | Blocks |
| `PRODUCTION01` | App security is set to Production. At Prototype level Mendix ignores the XPath constraints on access rules, so a test can pass on an app that shows everyone's data. | Blocks |
| `PWD01` | Points out a weak password policy (fewer than 8 characters, or no digit, mixed case or symbol). A task for you in Studio Pro. | Warning |
| `SQL01` | No microflow builds a database query by gluing text and a variable together. Whoever controls the variable controls the query (SQL injection). | Blocks |
| `STRICT01` | Strict mode is on. Without it, a clever user can read and change data through the browser in ways the pages never offer. Only warns in an app with an offline profile on Mendix before 11.12.5, where strict mode breaks offline commits (fixed in 11.12.5). | Blocks |
| `VIEW01` | A role that may only see its own records cannot read a view entity that adds up everybody's records, like a total of all customers' invoices. | Blocks |
| `WRITE01` | Points out a role that may change fields only the system should set, like a total or a status. The finding names the fields to remove and the associations to keep. | Warning |
| `XSS01` | Points out an HTML widget that shows text a user typed as HTML. Someone could type a script that runs in other users' browsers. | Warning |

**Microflows** (23 rules)

Logic a colleague can read on the canvas, and data work that scales.

| Rule | What it checks | Level |
|---|---|---|
| `CAPTION01` | Every activity (retrieve, create, change, commit, delete, show page, call…) has a caption in business words, like "Find the customer's open invoices". | Warning until the first DONE; then blocks a new or changed microflow |
| `CAPTION02` | No activity keeps the caption Mendix gives it by default, like "Retrieve Invoice" or "Commit object". | Warning until the first DONE; then blocks a new or changed microflow |
| `CAPTION03` | Every decision has a caption. | Warning until the first DONE; then blocks a new or changed microflow |
| `CAPTION04` | A decision's caption is a question and ends with "?", like "Is the order approved?". | Warning until the first DONE; then blocks a new or changed microflow |
| `CAPTION05` | A decision's caption is not the expression itself ($Order/Total > 1000). It says the question in words. | Warning until the first DONE; then blocks a new or changed microflow |
| `CAPTION06` | Every loop has an annotation saying what it walks through. | Warning until the first DONE; then blocks a new or changed microflow |
| `CAPTION07` | A loop has no caption: mxcli drops loop captions, so the text belongs in the annotation. | Blocks |
| `CAPTION08` | Points out a decision whose caption was overwritten by its expression. | Warning |
| `DS01` | A data grid, list view or gallery whose data source is a microflow that only retrieves rows uses a Database source instead. The database then pages, sorts and filters, which is much faster. | Blocks |
| `ERR01` | Points out an error handler that nobody would notice: it should log, show a message, raise the error again or return. | Warning |
| `EVENT01` | An entity's after-commit event microflow does not commit its own object again with events. That commit starts the same event again: an endless loop. | Blocks |
| `EVENT02` | A before-commit event microflow that can say "no" (return false) is set to raise an error. Otherwise the save is skipped and the user gets no message at all. | Blocks |
| `EVENT03` | Points out a commit "without events" on an entity whose event microflow sets or checks something: that work is silently skipped. | Warning |
| `EVENT04` | Points out a plain Save button on an entity whose before-commit event can refuse: the user sees only "An error has occurred". Save through a microflow with a validation message instead. | Warning |
| `PERF02` | Points out a loop over database rows that only adds them up or counts them. The database can do that in one query. | Warning |
| `PERF03` | Points out a database call for every row inside such a loop (a retrieve, a Java action, a sub-microflow that reads data): with 10,000 rows, 10,000 calls. | Warning |
| `PERF05` | Points out a retrieve of a whole table followed by an if that keeps some rows. Filter in the retrieve's XPath instead. | Warning |
| `PERF06` | Points out a loop that only looks for the highest or lowest value. One sorted retrieve of the first row does it. | Warning |
| `PERF07` | Points out a search on attributes that no index covers. The finding prints the index to add. | Warning |
| `PERF08` | Points out an index that no search in the app uses. It only slows down saving. | Warning |
| `REFRESH01` | When the Save button of a pop-up commits an object and closes the pop-up, the commit refreshes the client. Otherwise the list behind the pop-up does not show the new or changed row until the user reloads. | Blocks |
| `VAR01` | No variables named like $Int1, $tmp or $x. A name says what the variable holds, like $OpenInvoiceCount. | Blocks |
| `VAR02` | No variable names ending in _List, _Object or _Obj: $OverdueInvoices, not $Invoice_List. | Blocks |

**Screens and navigation** (44 rules)

What makes the app look and behave like a proper Mendix app.

| Rule | What it checks | Level |
|---|---|---|
| `ACCOUNT01` | With login: administrators have a "Users" menu item to manage accounts. | Blocks |
| `ACCOUNT02` | With login: everyone has a "My account" menu item to change their own password. | Blocks |
| `ACCOUNT03` | With login: every role that logs in includes the Administration module's User role, and some role can manage users. | Blocks |
| `ALERT01` | Points out an alert or card style put on a plain text, where it renders badly. Put it on a container around the text. | Warning |
| `BACK01` | A page opened from another page has a Back button, top left. Pop-ups don't need one: they close with their X. | Blocks |
| `EDGE01` | Everything on a page sits inside a layout grid, so nothing is glued to the edge of the window. | Blocks |
| `GRID01` | A data grid column that has a filter is still bound to its attribute. Without it the filter shows "Unable to get filter store" and does nothing. | Blocks |
| `GRID02` | A button that changes what a grid shows (New, Delete selected…) sits in the grid's own header, not somewhere else on the page. | Blocks |
| `DATE01` | A data grid column on a date and time shows the time of day too, when a form of the app edits that time (a date-and-time picker, or a format of its own with hours) (Data grid 2 shows a DateTime as a date only). The finding prints the column. | Blocks |
| `STATUS01` | A button whose flow always sets one status (Send invoice, Finish job) is hidden once the object has that status, so nobody sets it twice. A button that walks through several statuses is not judged. | Warning |
| `HEAD01` | Points out a page without a heading. | Warning |
| `HOME01` | With login: administrators start on a page of the app itself, not on a template page. | Blocks |
| `ICON01` | Every button has an icon. The finding suggests one. | Blocks |
| `HIDDEN01` | No widget is hidden for good (`Visible: [false]`): no one sees it, so it is no feature, and a test that reads through it proves nothing. | Blocks |
| `LABEL01` | A column caption or field label is words (`Due date`), never an attribute's name (`DueDate`, `Due_Date`). | Blocks |
| `LAYOUT01` | All normal pages use the same layout, so the menu looks and behaves the same everywhere. Pop-ups, the login page and phone pages may differ. | Blocks |
| `LIST01` | A list view item with buttons is one row that does not wrap: its texts in a box on the left, its buttons in a box on the right; the finding prints the row. | Blocks |
| `MODULE01` | The empty MyFirstModule from the Mendix template is deleted once the app has its own module. The finding lists what still uses it. | Blocks |
| `NAME01` | Points out a widget name used on more than one page. | Warning |
| `NAME02` | Every widget is named after its page, what it is for and its type, in full words, like OrderDetail_GenerateInvoiceButton. Tests find widgets by these names. | Warning until the first DONE; then blocks a new or changed page |
| `NAV01` | With login: the user can log out, through a Log out menu item or button. | Blocks |
| `NAV02` | With login: Log out is the last item in the menu. | Warning |
| `NAV03` | With login: every role's home page is also in the menu, so users can get back to it. | Blocks |
| `NAV04` | The menu is a real Mendix navigation menu, not a row of buttons built into a layout (that has no mobile menu and no highlighted item). | Blocks |
| `NAV05` | Every menu item has an icon. | Blocks |
| `NAV06` | No two menu items that the same user can see have the same icon. | Blocks |
| `OFFLINE01` | An offline profile works without a network only through the service worker Mendix registers for it. A profile with no Progressive web app settings gets none ("registerServiceWorker": false in the built index.js), and then no page opens offline. mxcli (v0.26 and before) writes offline profiles without these settings, and Studio Pro shows them greyed out for an offline profile, so they cannot be set afterwards: the profile has to be deleted and added again in Studio Pro. Judged where the app is built on this machine (local mode). | Blocks |
| `OFFLINE02` | An offline profile downloads nothing until each entity has a sync mode, and then shows an empty app while every check passes. At least one entity is synchronized with all or where. | Blocks |
| `OFFLINE03` | An app with an offline profile has a test that cuts the network: it opens the profile, calls go_offline(), does the work the user does without a network, checks the server has nothing yet, then go_online() and sync_now() and checks it arrived. | Blocks |
| `PHONE01` | Atlas's phone and tablet layouts show a bottom menu from Atlas_Core (Phone_Menu, Tablet_Menu): the template's Home, Layouts, Templates and Widgets, which do nothing. A page whose layout shows a menu whose items all do nothing is reported. | Blocks |
| `PHONE02` | A page the browser profile opens (home page, menu item, or a button on such a page) is not on a phone or tablet layout; a page the phone shares gets a web copy. | Blocks |
| `PHONE03` | A page on a phone or tablet layout lists its items as cards in a list view, each value on its own line, not in a data grid whose columns cut every value short. | Blocks |
| `PHONE04` | On a phone the bottom bar stays on the screen and only the content scrolls: Atlas Core 4.1.3 (Mendix 11.12.1's blank app) has a typo that scrolls the whole page; the finding prints the one-line fix. | Blocks |
| `PHONE05` | On a phone the login form fits the screen: Atlas Core gives it a fixed 400 px, so it touches the left edge and runs off the right one; the finding prints the narrow-screen rule for theme/web/main.scss. | Blocks |
| `PHONE06` | A page on a phone or tablet layout opens with one row that does not wrap: Back (where there is one), the title, and who is signed in. Nothing stands on a row of its own above the title; the finding prints the row. | Blocks |
| `TABS01` | A phone or tablet page that shows its object's form and, under it, a list that belongs to that object puts the two in tabs, the object first; leave it only with a reason in the report. | Warning |
| `SPACE01` | Widgets next to each other have space between them, and a heading has space under it. Spacing uses Atlas's spacing settings. | Blocks |
| `SPACE02` | Spacing uses only the Atlas sizes None, S, M or L. Other values make the Mendix build fail. | Blocks |
| `SPACE03` | Widgets on the same line have the same spacing above and below them, so they line up. | Blocks |
| `SPACE04` | A button or text never touches a grid, list or card right above or below it. | Blocks |
| `TEXT01` | A long text attribute (more than 500 characters, or unlimited) is edited in a multi-line text area, not a one-line text box. | Blocks |
| `TEXT02` | Points out a one-line text box for a field named like free text (Description, Notes, Reason). | Warning |
| `URL01` | Every normal page has a URL, so it can be bookmarked, shared and reloaded. A page with a parameter gets the parameter in its URL, like order/{Order/Id}. Pop-ups, login pages and pages whose parameter can't be in a URL are skipped. The finding prints the line that adds the URL. | Blocks |
| `USER01` | With login: every page shows who is signed in, top right. Pop-ups and the login page don't need it. On a phone or tablet page PHONE06 checks it, in the title's row. | Blocks |

**Structure** (1 rule)

Where documents live.

| Rule | What it checks | Level |
|---|---|---|
| `FOLDER01` | Every document sits in a folder named after the business process (Orders, Customers), split into three subfolders: UI for pages and snippets, FNC for microflows and nanoflows, ENV for everything else. The finding prints the moves to make. | Blocks |

## Where you can change things

**The rules: `tests/rulebook/`.** Each card ends with a `## Local` section that is yours; the
installer keeps it word for word on every upgrade.

```markdown
## Local
level: warn                                 # block | warn | info | off
except: Orders.Approval_Task   # opened only from the task inbox; a URL would skip the task
```

The gate then judges with your level and skips the excepted documents, and says so in its output
(`rulebook: 1 excepted (URL01 Orders.Approval_Task)`). On a rule that only warns about what existed
before the install (the paths cards), `level: block` makes those old findings block too.
A card marked `owner: person` in its header (OFFLINE01, ADMIN01, PWD01) is one only you can clear, in Studio Pro. When nothing else blocks DONE, the hooks stop sending the agent back to the gate: it ends its report with what you have to do. `bash tests/rules.sh check` validates the cards. The agent may read them and propose a line, but a hook stops it from writing one.

**The project's settings: `tests/harness.env`.** Written by the installer, yours to edit; the agent
cannot change it.

The default is in bold. A key you leave out takes its default.

| Key | Options | What it does |
|---|---|---|
| `MDL_RUN_MODE` | **`local`** · `docker` | `local`: the Mendix runtime and PostgreSQL run on this machine, a model change is live in about a second. `docker`: the app runs in Docker, nothing else installed, about 40 s per change. |
| `APP_PORT`, `ADMIN_PORT` | a port number; **8081** and its admin port | The ports the app answers on. A second project running beside the first needs its own, e.g. 8082. |
| `MDL_DB_HOST`, `MDL_DB_NAME`, `MDL_DB_USER`, `MDL_DB_PASSWORD` | set by the installer | The app's PostgreSQL database. |
| `MDL_PSQL` | a path to `psql` | Which PostgreSQL client to use when it is not on the `PATH`. |
| `MDL_MXBUILD_PATH`, `JAVA_HOME`, `MDL_BOOT_COMMAND`, `MX_VERSION` | set by the installer | How the app is built and booted, and which Studio Pro version to use when there are several. |
| `GRADLE_HOME` | the newest `gradle-*` beside mxbuild | The Gradle the Windows boot (`tests/run-app.sh`) builds with, when another one is needed. |
| `MDL_DB_RESET` | **`done`** · `session` · `off` | `done`: the database is saved when the app first boots and put back after every DONE, so the person never sees test data; a full gate after a red one also starts its tests on the saved data (`--reset-data` does it for `--only`). `session`: put back only after a session's first DONE. `off`: the data stays. Local mode only. |
| `MDL_CLOSE_BROWSER` | **`0`** · `1` | `0`: the test browser stays open, so the next run starts faster. `1`: it closes after each gate run. |
| `MDL_REQUIREMENTS` | **`ask`** · `assume` · `off` | `ask`: before the first feature the agent asks you what the app must do and waits. `assume`: nobody answers (a benchmark); it takes its recommended answers as assumptions, listed at DONE. `off`: no interview. |
| `MDL_COMPACTION` | `on` · **`off`** | `on`: the installer gives Pi a compaction threshold of 70% of each model's window (`.pi/settings.json`, only for models you have not set yourself). `off`: Pi's own default. Read by the installer only; re-run it after a change. Measured on one prompt: a shorter context each turn, but more turns in two of three runs. Claude Code and Codex are not set: their threshold is a token count, not a share of the window. |
| `MDL_VISUAL_REVIEW` | **empty** · `agent` | `agent`: a model that reads images also judges a screenshot of each page (`LOOK01`, `LOOK02`). Empty: only the automatic visual checks run. |
| `MDL_ALLOW_GREEN_FIRST` | test names, separated by spaces | Tests that pass from the start by nature, so the gate does not warn that they never failed first. |
| `MDL_MARKETPLACE_LOGIN` | **`wait`** · `report` | `wait`: when the app needs a Marketplace module and mxcli is not logged in, the session stops and asks you to log in. `report`: nothing waits; the feature is reported as not built (for unattended runs). |
| `MDL_PRECHECK` | **`1`** · `0` | `1`: every MDL script is tried on a copy of the model before it runs. `0`: scripts run directly. |
| `MDL_GATE_CACHE` | **`1`** · `0` | `1`: the gate replays a model check whose inputs did not change. `0`: it runs every check again. |
| `MDL_HARNESS_EDITS` | **empty** · `allow` | `allow`: the agent may edit the harness's own files. The rule cards and this file stay protected either way. |

**Test users: `tests/credentials.env`.** `TEST_PASSWORD_<user>=...` for each demo user a test signs
in as.

**The look: `bash tests/theme.sh`** lists the themes, `bash tests/theme.sh teal` switches. A reinstall refreshes the theme's frame, so a fix to it (one focus ring on a combo box, not two) reaches existing apps.

**Commands you can run yourself**

```bash
bash tests/gate.sh                    # the done gate
bash tests/gate.sh --boot-if-needed   # boot the app first if nothing answers
bash tests/gate.sh --only <feature>   # one test, warm browser (ends PASSED, never DONE)
bash tests/gate.sh --changed          # the tests a model change touched
bash tests/gate.sh --restart          # stop this project's app and boot it again
bash tests/gate.sh --only <feature> --reset-data  # first put back the rows earlier runs left
bash tests/rules.sh                   # every rule, its level and your exceptions
bash tests/orient.sh                  # what is in this project, and its state
bash tests/diagnose.sh                # why the app does not answer
bash tests/film.sh <test>             # a video of one test
```

## When something goes wrong

- **The app is created but does not build on Windows.** Studio Pro must be installed in the version
  the app uses; the installer reports a missing one, it never installs Studio Pro.
- **Ports.** Studio Pro running an app holds 8080 and 8090; set `APP_PORT` (and `ADMIN_PORT`) in
  `tests/harness.env` when both run at once.
- **Microflow tests on Windows** (`mxcli test --local`) need a patched mxcli until the fix is upstream.
- **After a failed `mxcli test` run** the project's after-startup microflow may still point at
  `MxTest.RegisterEndpoint`; check with `./mxcli -p <app>.mpr -c 'SHOW SETTINGS'`.
- **A Marketplace module is needed** and mxcli is not logged in: the session stops and asks you to
  run `./mxcli auth login` in your own terminal.
- **What the harness repairs itself.** A data grid mxcli wrote in an older widget definition
  (CE0463) is updated right after the exec that wrote it (`mxcli fix widgets`); a suite that ran
  out of trial-licence sessions restarts the app once and runs again.

## For maintainers

Every rule in plain words: [`docs/harness-rules.html`](docs/harness-rules.html); the harness in
motion: [`docs/harness-wiring.html`](docs/harness-wiring.html).
