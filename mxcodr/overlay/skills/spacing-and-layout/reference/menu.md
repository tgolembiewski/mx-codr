# The menu (skill spacing-and-layout)

Syntax for navigation profiles is in mxcli's `manage-navigation`; this is how the menu of an app
built here is shaped.

## One menu for every role

The menu is the **navigation profile's** menu, shown by the app's one layout
(`Atlas_Core.Atlas_Default`): a sidebar on a wide screen, a hamburger on a phone, the current page
highlighted. Nothing else gives an app that for free.

Different roles do **not** need different menus. Mendix hides a menu item from a user who cannot
open its page, so one menu lists every page and each role sees only its own. What a role can open is
page access; where it lands is its home page:

```sql
grant view on page Sales.Order_List to Sales.Employee;
grant view on page Sales.Cust_MyOrders to Sales.Customer;

create or modify navigation Responsive
  home page Sales.Order_List
  home page Sales.Order_List for "Employee"
  home page Sales.Cust_MyOrders for "CustomerPortal"
  {
    menu item 'Orders' ( OnClick: show page Sales.Order_List, Icon: Atlas_Core.Atlas_Filled."shopping-cart" )
    menu item 'My orders' ( OnClick: show page Sales.Cust_MyOrders, Icon: Atlas_Core.Atlas_Filled.document )
    menu item 'Users' ( OnClick: show page Administration.Account_Overview, Icon: Atlas_Core.Atlas_Filled."user-neutral-shield" )
    menu item 'My account' ( OnClick: call microflow Administration.ManageMyAccount, Icon: Atlas_Core.Atlas_Filled.user )
    menu item 'Log out' ( OnClick: sign out, Icon: Atlas_Core.Atlas_Filled.logout )
  }
;
```

An employee sees Orders, My account and Log out; a customer sees My orders, My account and Log out;
an administrator also sees Users.

- `create or modify navigation` replaces the whole menu: `DESCRIBE NAVIGATION Responsive` first and
  keep the items already there.
- Every role's home page is also a menu item, so its users can get back to it.
- When the app has sign-in, administrators land on a page of the app's own module, not a template
  page left from the starter app.
- Never build the menu yourself as a layout of your own with link buttons, one per role (MDL menu
  items take no roles, which tempts it). A session did: the links ran together into one line, a fixed
  232 px panel covered half a phone screen, no hamburger, no highlighted page. Keep the pages on a
  stock Atlas layout and put them in the menu.

## Log out, last

When the app has user accounts that sign in (logins, demo users, an account page), the menu ends with
**Log out** in every navigation profile those users reach. Without it a user can only end the session
by closing the browser. `sign out` needs no page or microflow, and it is always the **last** item.

## Users and My account

When users sign in, the menu also carries the Administration module's own account screens. Nothing
needs building, and nothing in the Marketplace module changes:

- **Users** (`Administration.Account_Overview`) is user management: create accounts, reset
  passwords, assign roles. Only `Administration.Administrator` may open it, so only administrators
  see the item.
- **My account** is every user's own account and password. Its page, `Administration.MyAccount`,
  needs the account as a parameter, so a menu item cannot open it; `Administration.ManageMyAccount`
  fetches the signed-in account and opens it.
- Every user role that signs in includes `Administration.User` (without it My account is hidden),
  and the administrators' role includes `Administration.Administrator`:
  `alter user role "Employee" add module roles (Administration.User);`
  (`app-security` covers roles and demo users.)

## An icon on every entry, different within a role

Every menu entry, sub-menu and Log out included, carries an **icon that shows what it opens**: with
the sidebar collapsed the icon is all a user sees. Two entries one role sees with the same icon read
as the same screen; pick different ones (entries a role cannot open do not count, Mendix hides them).
Take them from `Atlas_Core.Atlas_Filled` (`DESCRIBE ICON COLLECTION Atlas_Core.Atlas_Filled` lists
the names; hyphenated ones are double-quoted):

| Screen | Icon |
|---|---|
| orders, cart | `Atlas_Core.Atlas_Filled."shopping-cart"` |
| customers, contacts | `Atlas_Core.Atlas_Filled."user-neutral-group"` |
| users (user management) | `Atlas_Core.Atlas_Filled."user-neutral-shield"` |
| My account | `Atlas_Core.Atlas_Filled.user` |
| invoices, bills | `Atlas_Core.Atlas_Filled."cash-payment-bill"` |
| dashboard, overview | `Atlas_Core.Atlas_Filled.dashboard` |
| reports | `Atlas_Core.Atlas_Filled."analytics-bars"` |
| shipments, products | `Atlas_Core.Atlas_Filled."shipment-box"` |
| tasks, approvals | `Atlas_Core.Atlas_Filled."task-list-multiple"` |
| documents | `Atlas_Core.Atlas_Filled.document` |
| setup, settings | `Atlas_Core.Atlas_Filled.cog` |
| home | `Atlas_Core.Atlas_Filled.home` |
| Log out | `Atlas_Core.Atlas_Filled.logout` |
