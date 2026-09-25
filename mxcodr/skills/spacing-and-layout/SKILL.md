---
name: spacing-and-layout
description: "Spacing between widgets, using the theme's own Spacing design property rather than CSS — and the structure a screen is laid out with, including the main menu (one menu for every role, on Atlas_Default, ending with Log out once users can sign in), a Back button top left on every page another page opens, an icon on every button, who is signed in top right and whether a create/edit form is a modal pop-up or a full page. Use before writing or altering any page, snippet or navigation menu, and when the gate's layout verdict fails."
---

# Spacing and layout

A screen can be correct and still look broken. Measured on this project: a gate
reported 10/10 tests, `mx check` 0 errors, lint 0 errors, coverage 12/12 and naming
clean, on a page whose heading, two buttons and grid were welded together with no gap
at all. Nothing in the model was wrong. The widgets simply carried no margin.

## The one thing to get right

**Widgets that share a line need `margin-right` between them and the same
`margin-bottom` on all of them.** Inline means buttons, link buttons, paragraph text,
images, checkboxes — Atlas puts them on one line, and that line *wraps* when the
window narrows.

```
actionbutton btnEdit   (Caption: 'Edit',   Action: ..., DesignProperties: ['Spacing': ['margin-right': 'S', 'margin-bottom': 'S']])
actionbutton btnDelete (Caption: 'Delete', Action: ..., DesignProperties: ['Spacing': ['margin-right': 'S', 'margin-bottom': 'S']])
actionbutton btnSend   (Caption: 'Send',   Action: ..., DesignProperties: ['Spacing': ['margin-bottom': 'S']])
```

Three measured failures, each from leaving part of that out:

| What was written | What it looked like |
|---|---|
| `margin-right` on the first only | the second button touching the first |
| `margin-right` on one, `margin-bottom` on its neighbour | the two ten pixels out of line — a bottom margin lifts an inline-block off the baseline |
| `margin-right` on both, `margin-bottom` on neither | right on a wide screen; narrow the window and three buttons wrap onto two rows, the second against the first |

So the gap goes on every widget but the last, and the bottom margin goes on **all** of
them, with the same value.

That is Studio Pro's own **Spacing** design property — the same dropdown a developer
would use. No `Class:`, no `Style:`, no custom CSS.

| | |
|---|---|
Sides | `margin-top` `margin-right` `margin-bottom` `margin-left`, and the same four as `padding-` |
Values | **`None` `S` `M` `L`** — Atlas Core defines nothing else |
Scopes | any widget, plus `LayoutGridRow` and `LayoutGridColumn` |
Side by side | `margin-right` on each but the last |
Stacked, or a line that can wrap | `margin-bottom` on every one, same value |

`mxcli check` does **not** validate the value: `'XL'` passes it and then fails much
later in `mx check` as CE6083 *"Design property Spacing is not supported by your
theme"*. The gate's `layout` verdict catches it immediately instead.

## What does not need a margin

Block-level widgets already carry the theme's spacing, and adding margins to them
makes the screen worse, not better:

- `textbox`, `datepicker`, `combobox`, `checkbox` inside a `dataview` — Atlas form
  groups are spaced,
- `datagrid`, `listview`, `gallery`, `layoutgrid`, `container`, `snippetcall`,
- a grid `row`, a grid `column`, a datagrid `column`, a layout `region`, a `footer`
  or `header` — these lay other things out and have their own spacing.

The gate only fails on inline-against-inline for this reason.

## Structure

Widgets belong inside a `layoutgrid` / `row` / `column`, not loose in a container:
the grid is what makes a screen responsive, and column widths are how two things sit
side by side on a desktop and stack on a phone.

```
layoutgrid pageGrid {
  row headerRow {
    column colTitle  (DesktopWidth: 8) { dynamictext heading (Content: 'Invoices', RenderMode: H2) }
    column colActions (DesktopWidth: 4) {
      actionbutton btnNew   (Caption: 'New invoice',     Action: ..., DesignProperties: ['Spacing': ['margin-right': 'S', 'margin-bottom': 'S']])
      actionbutton btnReset (Caption: 'Reset demo data', Action: ..., DesignProperties: ['Spacing': ['margin-bottom': 'S']])
    }
  }
  row gridRow { column col1 (DesktopWidth: 12) { datagrid invoiceGrid (...) { ... } } }
}
```

The last widget in a line needs no `margin-right` — nothing follows it — but it keeps
the same `margin-bottom` as the rest, or a wrapped row lands against the one above.

## Create and edit forms: pop-up or full page

Every page that creates or edits a single object is either a **modal pop-up** or a
**full page**, and the choice follows from what the form holds, not from habit. A form
that fits comfortably in a dialog belongs in one: it opens over the list the user came
from, keeps that context, and closes back to it. The same form as a full page fills the
screen with a few inputs and empty space and takes the user somewhere else.

**Pop-up** when the whole form is the object's own fields and fits a dialog without
scrolling:
- one data view over one object, its inputs in a single column,
- no data grid, list view, tab container or nested data view -- nothing that shows or
  edits *other* objects alongside it,
- no long free-text areas or rich text that need the screen's width.

**Full page** when any of these hold:
- the object is edited together with related objects (a header with its lines, a
  record with its history or attachments),
- the form is split into tabs or sections, or needs a wide or multi-column layout,
- the user has to scroll to reach Save.

When in doubt, count what the user has to see at once: if it needs the screen, it is a
page; if it needs a moment's attention and then returns the user to where they were, it
is a pop-up.

```sql
create or modify page Module.Entity_NewEdit
(
  params: { $Entity: Module.Entity },
  title: 'Edit entity',
  layout: Atlas_Core.PopupLayout,
  PopupWidth: 600, PopupResizable: true
)
{
  layoutgrid formGrid {
    row formRow {
      column formCol (DesktopWidth: AutoFill) {
        dataview dvEntity (DataSource: $Entity) {
          -- the entity's own inputs, one per line
          footer formFooter {
            actionbutton btnSave (Caption: 'Save', Action: SAVE_CHANGES CLOSE_PAGE, ButtonStyle: Primary,
              DesignProperties: ['Spacing': ['margin-right': 'S']])
            actionbutton btnCancel (Caption: 'Cancel', Action: CANCEL_CHANGES CLOSE_PAGE)
          }
        }
      }
    }
  }
}
```

- **The layout decides, and it must be modal.** A pop-up form uses a layout of type
  `ModalPopup` -- `Atlas_Core.PopupLayout` in a standard app -- which dims and blocks the
  screen behind it until Save or Cancel. A layout of type `Popup` is **not** modal: the
  page underneath stays clickable, so never use one for a create or edit form. Check
  the type with `SHOW LAYOUTS` (column Type) before choosing a layout other than
  `Atlas_Core.PopupLayout`. A full page uses the app's responsive layout
  (`Atlas_Core.Atlas_Default`).
- **Opening it does not change.** The button or microflow that shows the page works the
  same for both; only the page's layout differs.
- **Save and Cancel close it** (`CLOSE_PAGE`), and the page underneath shows the change
  without a reload.
- **No `url:`** on a pop-up -- it is opened from a page, never navigated to.
- `PopupWidth` / `PopupHeight` are optional (default 600 x 600) and case-sensitive.
- **Tests work unchanged.** A pop-up renders in the same browser page, so `landed()`,
  `fill()` and `pick_combo()` find its widgets as before.

## The main menu: Log out once users can sign in

The navigation menu frames every screen. As soon as the app has user accounts that
sign in (customer logins, demo users, an Administration account page), its main menu
ends with a **Log out** item, in every navigation profile those users reach. Without
it a user can only end the session by closing the browser.

```sql
create or replace navigation Responsive
  home page MyFirstModule.Home_Web
  menu (
    menu item 'Invoices' page Invoicing.Invoice_Overview icon Atlas_Core.Atlas_Filled.document;
    menu item 'Log out' sign_out icon Atlas_Core.Atlas_Filled.logout;
  )
;
```

`sign_out` needs no page or microflow, and it is always the **last** item.
`create or replace navigation` replaces the whole menu: `DESCRIBE NAVIGATION Responsive`
first and keep the items already there.

The gate's layout verdict fails (`NAV01`) while security is on and no menu, page or
snippet offers a way to log out.

## One menu for every role

The menu is the **navigation profile's** menu, shown by `Atlas_Core.Atlas_Default`:
a sidebar on a wide screen, a hamburger button that opens it on a phone, the current
page highlighted. Nothing else gives an app that for free.

Different roles do **not** need different menus. Mendix hides a menu item from a
user who cannot open its page, so a single menu lists every page and each role sees
only its own. What a role can open is page access; where it lands is its home page:

```sql
grant view on page Sales.Order_List to Sales.Employee;
grant view on page Sales.Cust_MyOrders to Sales.Customer;

create or replace navigation Responsive
  home page Sales.Order_List
  home page Sales.Order_List for Employee
  home page Sales.Cust_MyOrders for CustomerPortal
  menu (
    menu item 'Orders' page Sales.Order_List icon Atlas_Core.Atlas_Filled."shopping-cart";
    menu item 'My orders' page Sales.Cust_MyOrders icon Atlas_Core.Atlas_Filled.document;
    menu item 'Log out' sign_out icon Atlas_Core.Atlas_Filled.logout;
  )
;
```

An employee sees Orders and Log out; a customer sees My orders and Log out.

Never build the menu yourself — a layout of your own with link buttons to pages, one
per role. A session did exactly that because MDL menu items take no roles: the links
ran together into one line of text, a fixed 232 px panel covered half a phone
screen, and there was no hamburger and no highlighted page. Keep the pages on
`Atlas_Core.Atlas_Default` (or another stock Atlas layout) and put them in the menu.

Every menu entry — item or sub-menu, Log out included — has an **icon that shows
what it opens**: with the sidebar collapsed the icon is all a user sees. Take it
from `Atlas_Core.Atlas_Filled` (`DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled`
lists the names; hyphenated ones are double-quoted). Ones that fit common screens:

| Screen | Icon |
|---|---|
| orders, cart | `Atlas_Core.Atlas_Filled."shopping-cart"` |
| customers, users, contacts | `Atlas_Core.Atlas_Filled."user-neutral-group"` |
| invoices, bills | `Atlas_Core.Atlas_Filled."cash-payment-bill"` |
| dashboard, overview | `Atlas_Core.Atlas_Filled.dashboard` |
| reports | `Atlas_Core.Atlas_Filled."analytics-bars"` |
| shipments, products | `Atlas_Core.Atlas_Filled."shipment-box"` |
| tasks, approvals | `Atlas_Core.Atlas_Filled."task-list-multiple"` |
| documents | `Atlas_Core.Atlas_Filled.document` |
| setup, settings | `Atlas_Core.Atlas_Filled.cog` |
| home | `Atlas_Core.Atlas_Filled.home` |
| Log out | `Atlas_Core.Atlas_Filled.logout` |

Two items with the same icon read as the same screen; pick different ones.

The gate fails `NAV03` when a role's home page is not in the menu, and `NAV04` when
one of the project's own layouts opens two or more pages from buttons.

## Users and "My account" in the menu

Once users sign in, the menu also carries the Administration module's own account screens.
Nothing needs building, and nothing in the Marketplace module changes:

```sql
    menu item 'Users' page Administration.Account_Overview icon Atlas_Core.Atlas_Filled."user-neutral-group";
    menu item 'My account' microflow Administration.ManageMyAccount icon Atlas_Core.Atlas_Filled.user;
    menu item 'Log out' sign_out icon Atlas_Core.Atlas_Filled.logout;
```

- **Users** (`Account_Overview`) is user management: create accounts, reset passwords,
  assign roles. Only `Administration.Administrator` may open it, so only administrators
  see the item — the one-menu rule does the rest.
- **My account** is every user's own account and password. The page behind it,
  `Administration.MyAccount`, needs the account as its parameter, so a menu item cannot open
  it; `ManageMyAccount` fetches the signed-in account and opens it.
- Every user role that signs in includes `Administration.User` (without it "My account" is
  hidden), and the administrators' role includes `Administration.Administrator`:
  `alter user role Employee add module roles (Administration.User);`

The gate fails `ACCOUNT01` (no Users item), `ACCOUNT02` (no My account item) and `ACCOUNT03`
(a role without `Administration.User`, or nobody with `Administration.Administrator`).

## Every button has an icon

Every `actionbutton` and `linkbutton`, on a page or in a snippet, carries an icon that
shows what it does, from `Atlas_Core.Atlas_Filled`:

```sql
actionbutton btnSave (Caption: 'Save', Action: SAVE_CHANGES CLOSE_PAGE,
  Icon: 'Atlas_Core.Atlas_Filled.floppy-disk', ButtonStyle: Primary)
```

| The button | Icon |
|---|---|
| Back (`close_page`) | `chevron-left` |
| Save | `floppy-disk` |
| Cancel, Close | `remove` |
| Delete, Remove, Discard | `trash-can` |
| New, Add | `add` |
| Edit | `pencil` |
| Open, View, Details | `view` |
| Next, Advance, Move to … | `arrow-right` |
| Approve, Confirm, Submit | `checkmark` |
| Reject | `thumbs-down` |
| Send, Remind, Email | `email` |
| PDF | `file-pdf` |
| Invoice | `cash-payment-bill` |
| Download, Export / Upload, Import | `download-bottom` / `upload-bottom` |
| Search / Filter / Print / Refresh, Reset / Copy | `search` / `filter` / `print` / `refresh` / `copy` |
| Log out | `logout` |

Anything else: `DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled` lists the names. The gate
fails `ICON01` for a button without one and suggests an icon from its action and caption.

## One layout for every page

Pick the layout once, for the whole app, and give it to every page that is not a pop-up.
The layout draws the menu: its style, its toggle, and whether it is open or collapsed.
Two pages on two layouts means the menu changes shape, or opens and closes, as the user
moves between them.

- Choose one at the start: `Atlas_Core.Atlas_Default` (sidebar menu, hamburger on a phone)
  unless the app is meant to have a top bar, then `Atlas_Core.Atlas_TopBar`.
- Every new page gets that `Layout:` — including the template's `Home_Web` if users can
  reach it.
- Different on purpose, and left alone by the gate: pop-ups (`Atlas_Core.PopupLayout`, or
  a layout of type `ModalPopup`/`Popup`), the login page, and phone/tablet layouts.
- To move pages: `alter pages in <Module> set layout = <main> where layout = <other>;` —
  and set the same `Layout:` in the scripts that create them, or a re-run moves them back.

The gate fails `LAYOUT01` when the app's pages use more than one layout, and lists them.

## Who is signed in, top right, on every page

Once users sign in, every page (pop-ups and the login page aside) shows the user icon and the
signed-in user's e-mail on the right of its top row, just under the language selector, with
the Back button (where there is one) on the left of the same row. Clicking it opens My account.

```sql
/** Who is signed in, as one line for the page header. */
create or modify non-persistent entity Shop.SignedInUser ( Label: String(200) );
grant Shop.User on Shop.SignedInUser (read *);      -- every role that signs in

/** The signed-in user's e-mail, or their user name when the account has none. */
create or modify microflow Shop.DS_SignedInUser ()
returns Shop.SignedInUser as $SignedInUser
begin
  @caption 'Find the signed-in account'
  retrieve $Account from Administration.Account where [id = '[%CurrentUser%]'] limit 1;
  declare $Label String = $Account/Name;
  @caption 'Has an e-mail address?'
  if $Account/Email != empty and $Account/Email != '' then
    @caption 'Use the e-mail'
    set $Label = $Account/Email;
  end if;
  @caption 'Create the header line'
  $SignedInUser = create Shop.SignedInUser (Label = $Label);
  return $SignedInUser;
end;
/
grant execute on microflow Shop.DS_SignedInUser to Shop.User;

create or modify snippet Shop.SNIPPET_CurrentUser {
  dataview dvCurrentUser (DataSource: microflow Shop.DS_SignedInUser) {
    linkbutton lnkCurrentUser (Caption: '{1}', CaptionParams: [{1} = Label],
      Icon: 'Atlas_Core.Atlas_Filled.user', Action: microflow Administration.ManageMyAccount)
  }
}
```

Then every page opens with one row. The row, not the snippet, decides where the link goes:

```sql
  -- a page opened from another page: Back on the left, the user on the right
  container ctPageTop (DesignProperties: ['Flex container': 'Horizontal (row)',
      'Align items X': 'Space between (only for horizontal containers)', 'Align items Y': 'Center', 'Spacing': ['margin-bottom': 'M']]) {
    actionbutton btnBack (Caption: 'Back', Action: CLOSE_PAGE, Icon: 'Atlas_Core.Atlas_Filled.chevron-left')
    snippetcall scCurrentUser (Snippet: Shop.SNIPPET_CurrentUser)
  }

  -- any other page: the user on the right
  container ctPageTop (DesignProperties: ['Flex container': 'Horizontal (row)',
      'Align items X': 'Right', 'Align items Y': 'Center', 'Spacing': ['margin-bottom': 'M']]) {
    snippetcall scCurrentUser (Snippet: Shop.SNIPPET_CurrentUser)
  }
```

- `Align items X` is Atlas's `justify-content`, and it only works together with
  `Flex container`: without it the link lands on the left, above the heading (seen in a
  session). It moves the row's direct children, which is why it goes on the row.
- `CurrentUser` is a reserved name in Mendix (CE7247) -- hence `SignedInUser`.
- A button caption takes an attribute, not an expression, so the microflow picks e-mail or
  user name and the snippet only shows `Label`.
- Why a snippet and not the layout's top bar: copying an Atlas layout with mxcli drops its
  sidebar toggle (the hamburger), and Atlas_Core itself is a Marketplace module that is
  never edited.

The gate fails `USER01` for every page that does not start with the snippet.

## Back, top left, on every page you navigate to

A page that another page or a microflow opens (`show_page`, `show page`) starts with a
**Back** button, top left, above its heading. Without one, the only way back is the
browser's own button or the menu, and a detail page reached from a list becomes a dead
end — a Pi session built three of those. A menu page or a home page needs none, even when a
microflow shows it again after an action: the menu is its way back.

```sql
create or modify page Sales.Order_Detail (Title: 'Order', Layout: Atlas_Core.Atlas_Default,
  Params: { $Order: Sales.Order }) {
  layoutgrid pageGrid {
    row row1 {
      column col1 (DesktopWidth: 12) {
        actionbutton btnBack (Caption: 'Back', Action: CLOSE_PAGE,
          Icon: 'Atlas_Core.Atlas_Filled.chevron-left',
          DesignProperties: ['Spacing': ['margin-bottom': 'M']])
        dynamictext h (Content: 'Order', RenderMode: H1, DesignProperties: ['Spacing': ['margin-bottom': 'M']])
      }
    }
  }
}
```

- `CLOSE_PAGE` returns to the page the user came from, whichever that was — a list, a
  dashboard, another detail page. Never a `show_page` back to a fixed page.
- The icon is always the left chevron, `Atlas_Core.Atlas_Filled.chevron-left`.
- It is the page's **first** widget, so it sits top left above the heading.
- A pop-up (`Atlas_Core.PopupLayout`) needs none: it closes with its own X.
- A page opened from a microflow counts too: `show page` in an `ACT_` flow.

The gate fails `BACK01` for every opened page without it and says which page opens it.

## Headings

Stock Atlas layouts render the **app** brand in the top region, not the page title,
and the page's `Title:` property feeds the browser tab and the menu — not the screen.
So a page with no heading widget opens unlabelled. Two conventions both work, and the
gate accepts either:

- an `H1`–`H3` `dynamictext` in the page, or
- one shared snippet every page calls — `SNIPPET_AppHeader` in the demo app, which is
  what [reuse-and-snippets](../reuse-and-snippets/SKILL.md) would have you do.

Pick one per app and keep to it. This is a warning in the gate, never a failure: it
is a convention, and a rule must only fail things that are wrong under every
convention.

## Fixing an existing page

`ALTER PAGE`'s `SET` cannot take a `DesignProperties` map — it rejects the value.
Patch the page body instead, which is re-runnable:

```bash
./mxcli describe PAGE Mod.Invoice_Overview -p app.mpr > /tmp/page.mdl
# add DesignProperties to the offending widget
./mxcli check /tmp/page.mdl -p app.mpr --references && ./mxcli exec /tmp/page.mdl -p app.mpr
```

## Check it

```bash
bash tests/gate.sh            # the layout verdict, with the rest
```

```
layout: PASS  0 failure(s) over 6 page(s)
```

| Check | Severity | Fails when |
|---|---|---|
`SPACE01` | error | a widget sharing a line with the next and no `margin-right`; or a heading with content under it and no `margin-bottom` |
`SPACE02` | error | a spacing value outside `None` `S` `M` `L` |
`SPACE03` | error | widgets on one line disagreeing on vertical margins (misaligned), or none carrying `margin-bottom` (wraps into the row above) |
`HEAD01` | warning | the page renders no heading and calls no header snippet |
`NAV01` | error | project security is on, a navigation menu has no `sign_out` item, and no page or snippet has a sign-out button |
`NAV02` | warning | the `sign_out` item is not the last item of its menu |
`GRID01` | error | a grid filter sits in a column with no `Attribute:` and has none of its own: it renders "Unable to get filter store" and filters nothing |
`NAV03` | error | project security is on, and a role's home page (`home page X for Role`) is not in the menu |
`NAV04` | error | one of the project's own layouts opens two or more pages from buttons: a menu built by hand |
`NAV05` | error | a menu item or sub-menu has no icon (the message suggests one for its caption) |
`ACCOUNT01` | error | users sign in and the menu has no `page Administration.Account_Overview` item (user management) |
`ACCOUNT02` | error | users sign in and the menu has no `microflow Administration.ManageMyAccount` item (own account, password) |
`ACCOUNT03` | error | a role that signs in lacks `Administration.User`, or no role has `Administration.Administrator` |
`ICON01` | error | a button (`actionbutton`, `linkbutton`) without an icon; the message suggests one from its action and caption |
`LAYOUT01` | error | the app's pages (pop-ups, login and phone/tablet pages aside) use more than one layout |
`USER01` | error | users sign in, and a page (pop-ups and the login page aside) does not open with `<Module>.SNIPPET_CurrentUser` on the right of its top row (first, or right after Back in the same container) |
`BACK01` | error | a page another page or a flow opens does not start with a Back button (`close_page`, icon `chevron-left`); pop-ups, menu pages and home pages are exempt |

## What this cannot see

A narrow window also **cuts content off sideways** when a grid has more columns than
fit. No margin fixes that and no read of the MDL proves it: it is a datagrid with too
many columns for a phone, or a `layoutgrid` column that never stacks. Judge that by
narrowing the browser.

Nothing here judges colour, typography or contrast — those are not mechanically
checkable, and a rule that cannot be checked is advice. Look at the screen for those.
