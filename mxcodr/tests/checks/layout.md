# layout -- the shape of a signed-in app (skill `spacing-and-layout`)

One line per code of the `layout` step; every code blocks DONE unless marked warning. The card: `tests/rulebook/layout/<CODE>.md`.

| Code | Wants | Fix |
|---|---|---|
| `ACCOUNT01` | a Users menu item for administrators | `menu item 'Users' ( OnClick: show page Administration.Account_Overview, Icon: ... )` before Log out. |
| `ACCOUNT02` | a My account menu item | `menu item 'My account' ( OnClick: call microflow Administration.ManageMyAccount, Icon: Atlas_Core.Atlas_Filled.user )` before Log out. |
| `ACCOUNT03` | every signing-in role includes Administration.User; someone manages users | `alter user role <Role> add module roles (Administration.User);` and `Administration.Administrator` on the administrators' role. |
| `ALERT01` | warning: an alert class on a container, not on inline text | `container ctNote (Class: 'alert alert-info') { dynamictext ... }`. |
| `BACK01` | a Back button, top left, on every page another page opens | First widget `actionbutton btnBack (Caption: 'Back', Action: close page, Icon: 'Atlas_Core.Atlas_Filled.chevron-left')`; pop-ups excepted. |
| `EDGE01` | every widget sits inside a layout grid | `layoutgrid pageGrid { row rowTop { column colTop (DesktopWidth: 12) { ... } } }` around the page's widgets, the top row too. |
| `GRID01` | a column with a filter keeps its Attribute | `column colX (Attribute: X) { textfilter fltX (Attribute: X) }`; without it: "Unable to get filter store". |
| `GRID02` | a button that changes a grid's rows sits in its header | `controlbar` in the datagrid; `$dgX` or a page parameter. |
| `HEAD01` | warning: a heading on every page |  |
| `HOME01` | administrators open on a page of the app's own module | Create `<Module>.Admin_Home` and `home page <Module>.Admin_Home for Administrator`. |
| `ICON01` | an icon on every button | `Icon: 'Atlas_Core.Atlas_Filled.floppy-disk'` Save, `trash-can` Delete, `pencil` Edit, `add` New, `view` Open. |
| `LAYOUT01` | one layout for every page that is not a pop-up | Pick one (`Atlas_Core.Atlas_Default`) and set it on every page. |
| `MODULE01` | MyFirstModule is gone once the app has its own module | Re-point home pages, drop `MyFirstModule.User` from user roles, `drop module MyFirstModule;`. |
| `NAME01` | warning: a widget name is used on one page only | Its own `<Page>_<What><Type>` name. |
| `NAME02` | warning: every widget is named <Page>_<What><Type> | The name it prints; warns until the first DONE, then blocks a new or changed page. Rename `.mx-name-...` in tests too. |
| `NAV01` | users can log out | `menu item 'Log out' ( OnClick: sign out, Icon: Atlas_Core.Atlas_Filled.logout )` as the menu's last item. |
| `NAV02` | warning: Log out is the last menu item | Move it to the end. |
| `NAV03` | every role's home page is in the menu | `menu item '<caption>' ( OnClick: show page <Page>, Icon: <icon> )` before Log out. |
| `NAV04` | no menu built from buttons in a layout | Put those pages in the navigation profile's menu; the layout keeps Atlas's own menu. |
| `NAV05` | an icon on every menu item | `Icon: Atlas_Core.Atlas_Filled.<name>` at the end of the item. |
| `NAV06` | no icon twice in what one role sees | The other icon the message suggests. |
| `SPACE01` | a margin after an inline widget and under a heading | `DesignProperties: ('Spacing': ('margin-bottom': 'S'))` on the heading. |
| `SPACE02` | only Atlas spacing values (None, S, M, L) | Sides `margin-`/`padding-` `top|right|bottom|left`, values `None S M L`; never a `Class:` or CSS for spacing. |
| `SPACE03` | the same vertical spacing on widgets that share a line | Give them the same `margin-top`/`margin-bottom`. |
| `SPACE04` | a gap between a button or text and a grid, list or card | `'margin-bottom': 'S'` on the upper one; each `controlbar` button too. |
| `TEXT01` | a text area for a long String | `replace txtX with { textarea txtX (...) }`. |
| `TEXT02` | warning: a text area for a prose-named attribute | A textarea if people write more than a line. |
| `URL01` | every page that can have a URL has one | The `alter page` it prints; the same `Url:` in the page's create. |
| `USER01` | who is signed in, top right, on every page | The page starts with `container ctPageTop (DesignProperties: ('Flex container': 'Horizontal (row)', 'Align items X': 'Right'))` holding `snippetcall scCurrentUser (Snippet: <Module>.SNIPPET_CurrentUser)`. |
