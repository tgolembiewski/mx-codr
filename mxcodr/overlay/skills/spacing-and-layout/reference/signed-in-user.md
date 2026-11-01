# Who is signed in (skill spacing-and-layout)

When users sign in, every page (pop-ups and the login page aside) shows the user icon and the
signed-in user's e-mail on the right of its top row, just under the language selector, with
the Back button (where there is one) on the left of the same row. Clicking it opens My account.

```sql
/** Who is signed in, as one line for the page header. */
create or modify non-persistent entity Shop.SignedInUser ( Label: String(200) );
grant read * on entity Shop.SignedInUser to Shop.User;      -- every module role that signs in

/** The signed-in user's e-mail, or their user name when the account has none. */
create or modify microflow Shop.DS_SignedInUser ()
returns Shop.SignedInUser as $SignedInUser
begin
  @caption 'Find the signed-in account'
  retrieve $Account from Administration.Account where [id = '[%CurrentUser%]'] first;
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
grant execute on microflow Shop.DS_SignedInUser to Shop.User;

create or modify snippet Shop.SNIPPET_CurrentUser {
  dataview CurrentUserSnippet_SignedInUserForm (DataSource: microflow Shop.DS_SignedInUser) {
    linkbutton CurrentUserSnippet_MyAccountLink (Caption: '{1}', CaptionParams: ({1} = Label),
      Icon: 'Atlas_Core.Atlas_Filled.user', Action: call microflow Administration.ManageMyAccount)
  }
};
```

Then every page opens with one row. The row, not the snippet, decides where the link goes:

```sql
  -- a page opened from another page: Back on the left, the user on the right
  layoutgrid OrderDetail_PageLayout {
    row {
      column (DesktopWidth: 12) {
        container OrderDetail_PageTopBox (DesignProperties: ('Flex container': 'Horizontal (row)',
            'Align items X': 'Space between (only for horizontal containers)', 'Align items Y': 'Center', 'Spacing': ('margin-bottom': 'M'))) {
          actionbutton OrderDetail_BackButton (Caption: 'Back', Action: close page, Icon: 'Atlas_Core.Atlas_Filled.chevron-left')
          snippetcall OrderDetail_CurrentUserSnippet (Snippet: Shop.SNIPPET_CurrentUser)
        }
        dynamictext OrderDetail_HeadingText (Content: 'Order', RenderMode: H1, DesignProperties: ('Spacing': ('margin-bottom': 'M')))
      }
    }
    -- the page's other rows follow here, in the same grid
  }

  -- any other page: the user on the right, the same way inside the grid
        container OrderOverview_PageTopBox (DesignProperties: ('Flex container': 'Horizontal (row)',
            'Align items X': 'Right', 'Align items Y': 'Center', 'Spacing': ('margin-bottom': 'M'))) {
          snippetcall OrderOverview_CurrentUserSnippet (Snippet: Shop.SNIPPET_CurrentUser)
        }
```

- `Align items X` is Atlas's `justify-content`, and it only works together with
  `Flex container`: without it the link lands on the left, above the heading (seen in a
  session). It moves the row's direct children, which is why it goes on the row.
- **On a phone or tablet page** the title joins that row, so nothing stands on a row
  of its own above it: Back and the title in a box on the left, the user on the right, and
  `'Disable row wrap': ON` on both containers -- Back, an H1 and the name need 375 px of a
  phone's 358, and Atlas wraps the row otherwise. A title that reads the page's object sits in
  a data view of its own around the row. The offline snippet's list view takes
  `('Style': 'No styling')`, or each name is a 69 px card:

```sql
        dataview JobDetail_TitleForm (DataSource: $Job) {
          container JobDetail_PageTopBox (DesignProperties: ('Flex container': 'Horizontal (row)',
              'Align items X': 'Space between (only for horizontal containers)', 'Align items Y': 'Center',
              'Disable row wrap': ON, 'Spacing': ('margin-bottom': 'M'))) {
            container JobDetail_TitleBox (DesignProperties: ('Flex container': 'Horizontal (row)',
                'Align items Y': 'Center', 'Disable row wrap': ON)) {
              actionbutton JobDetail_BackButton (Caption: 'Back', Action: close page, Icon: 'Atlas_Core.Atlas_Filled.chevron-left')
              dynamictext JobDetail_HeadingText (Content: 'Job {1}', RenderMode: H1, ContentParams: ({1} = Number))
            }
            snippetcall JobDetail_CurrentUserSnippet (Snippet: Field.SNIPPET_CurrentUserOffline)
          }
        }
```
- `CurrentUser` is a reserved name in Mendix (CE7247) -- hence `SignedInUser`.
- A button caption takes an attribute, not an expression, so the microflow picks e-mail or
  user name and the snippet only shows `Label`.
- Why a snippet and not the layout's top bar: copying an Atlas layout with mxcli drops its
  sidebar toggle (the hamburger), and Atlas_Core itself is a Marketplace module that is
  never edited.

**A page an offline profile reaches** (PhoneOffline, TabletOffline, ResponsiveOffline) uses
`SNIPPET_CurrentUserOffline` instead, in the same row. The snippet above breaks there twice:
its microflow data source needs the server, so offline it shows nothing, and its link to
`ManageMyAccount` makes the Administration pages reachable offline, which Mendix refuses
(CE6900, CE6904). The offline one reads the signed-in account from the device's own database,
and the profile downloads that one account:

```sql
create or modify snippet Shop.SNIPPET_CurrentUserOffline {
  listview CurrentUserOffline_AccountList (DataSource: database from Administration.Account where [id = '[%CurrentUser%]']) {
    dynamictext CurrentUserOffline_NameText (Content: '{1}', ContentParams: ({1} = Name))
  }
};
-- in the offline profile's sync block, beside the app's own entities:
--   sync Administration.Account where [id = '[%CurrentUser%]'];
```

A list, not a data view: a data view cannot take a database source. No account link: a user
changes the password on the online profile. A page both kinds of profile reach uses the
offline one; it works online too. Proven offline on a PhoneOffline app (2026-10-10): the page
opened without a network shows the user's name.

