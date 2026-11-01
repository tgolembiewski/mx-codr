# Changing a Marketplace module (skill module-structure)

**Never edit a document inside a Marketplace module.** Updating the module from the
Marketplace replaces the whole module, and every change made in it is gone without
a warning. Instead, create a module named after it with `Ext` appended —
`AdministrationExt` for `Administration` — and put the changed functionality there.

Which modules are Marketplace modules: the `Source` column says so.

```bash
./mxcli -p app.mpr -c "list modules"     # Source: "Marketplace v4.3.2" -> do not edit
```

How the change moves into `<Module>Ext`:

- **A page, microflow or snippet to change:** copy it into `<Module>Ext`
  (`DESCRIBE` the original, create it in the Ext module under the same process
  folders), change the copy, and point the callers at it — navigation menu items,
  buttons, other microflows. The original stays untouched, so an update cannot
  undo the change.
- **New behaviour around a Marketplace flow:** a new microflow in `<Module>Ext`
  that calls the original one, rather than an edit inside it.
- **More data on a Marketplace entity:** a new entity in `<Module>Ext` associated
  with it (or a specialization of it), never a new attribute on the original.
- **Access:** `<Module>Ext` gets its own module roles, mapped to the same user
  roles as the module it extends.

Example: the Roles filter on `Administration.Account_Overview` needed fixing. The
fix belongs in `AdministrationExt.Account_Overview`, with the Accounts menu item
pointing at that page — not in `Administration` itself, where the next Marketplace
update brings the broken filter back.

Two things that are easy to miss:

- **Already changed the original?** Moving the fix into `<Module>Ext` is half the
  job: the original must go back to what the Marketplace shipped, or it keeps a
  change nobody knows about. Re-download the module from the Marketplace or undo it
  in Studio Pro. Do not rewrite a Marketplace page through mxcli to restore it —
  a page the vendor built in Studio Pro does not always survive a rewrite (a column
  bound across an association, for one).
- **The copy is now your code.** Hold `<Module>Ext` to the same standard as any
  module of yours: spacing between buttons and badges that the vendor's page never
  had, widget names, captions, folders. Fix them in the copy, and point the tests
  at the copied page, not the original.

After a Marketplace update, open the originals once and compare: a fix the vendor
has since shipped means the Ext copy can go.

