---
name: module-structure
description: "Whether new functionality belongs in an existing module or a new one, and the folder structure a module starts with — processes, not document types. Changes to a Marketplace module go in a <Module>Ext module. Use before creating a module, before adding the first documents to one, before changing a Marketplace module, and when deciding where a new page or microflow goes."
---

# Module structure

Two questions come before any document is created: *is this a new module*, and
*which folder does it go in*. Getting them wrong is cheap today and expensive
later — a module is the unit Mendix secures, versions and (eventually) replaces.

The **mechanics** — `MOVE`, the `folder:` page property, the `folder '...'`
microflow clause — live in [organize-project](../organize-project/SKILL.md). This
skill is the decision, not the syntax.

## When to Use This Skill

- Before `create module`
- Before adding the first pages or microflows to a module
- When new functionality could plausibly go in two places
- When a module has grown and someone suggests splitting it
- Before changing anything in a Marketplace module (Administration, Atlas_Core, DataWidgets, …)

## When a new module is justified

Mendix's own rule: *"Modules should be treated like standalone replaceable
services; for example, the customer module should function as a standalone customer
management system as much as possible, replaceable by a different customer
management system."*
([dev-best-practices](https://docs.mendix.com/refguide10/dev-best-practices/))

Three triggers, each with the test that settles it:

**1. Business domain / bounded context.** Could this be lifted out and replaced by a
bought system, without the rest of the app noticing anything but a changed
integration? Then it is a module. Invoicing, CRM, Inventory each own their data and
publish what others may use.

**2. Reuse across apps.** Another app or another team would consume it. It becomes
its own module with a deliberate public surface (see *Shared modules* below), not a
folder inside yours.

**3. Integration boundary.** One module per external system — its REST/OData client,
mappings and entities. When the vendor changes, the blast radius is that one module.

### Not reasons to make a module

- *"It is getting big."* Size is a folder problem first. Split when the domain
  splits, not when the document list gets long.
- *"These are all pages."* That is a type, not a boundary.
- *"A different developer wrote it."* Ownership is not a boundary either — two
  people can own two processes in one module.
- *"This entity is only used here."* Then it is already in the right module.

The real ceiling is the app, not the module: roughly 3,000 microflows and 750
entities on a high-end machine (2,000 / 500 on lower spec). Past that, split the
**app**, not the module.

## Folder structure: by process

Mendix documents two options — by process and by entity. **This project uses
process.** Folders name what the business does, and a document sits with the
process it serves:

```
InvoiceDesk/
├── _Setup/          startup, demo data, configuration, test support (data reset)
├── Invoicing/       raise and correct an invoice
├── Chasing/         remind, escalate, write off
├── CustomerAdmin/   maintain customers
└── _Shared/         used by more than one process
```

The rules:

- **Every document lives in a folder.** Nothing at module root. A module root
  full of documents is the state a module decays into, and it decays quickly.
  "Document" here means pages, microflows, nanoflows and snippets — the things
  that carry a process. Entities have no folders (the domain model is one canvas),
  and enumerations, constants and Java actions are not checked.
- **Folder names are processes, never document types.** `Microflows/`, `Pages/`,
  `Snippets/`, `Logic/`, `UI/` are banned: the `ACT_`, `SUB_`, `DS_`, `VAL_`
  prefixes and the document icon already say the type. A type folder splits one
  process across four places for no gain.
- **`_Setup` and `_Shared` carry an underscore** so the two non-process folders sort
  to the top and read as different in kind.
- **A document used by two processes moves to `_Shared/`** — it is never copied.
  If `_Shared` grows past a handful of documents, that is the signal a process is
  hiding in there unnamed.
- **Sub-folders only when a process genuinely has steps.** `Chasing/Escalation/` is
  fine when escalation is several documents; not when it is one.

Consistency beats cleverness: whichever names you pick, every module in the app uses
the same style.

## Shared modules look different

A module other apps consume carries the Marketplace layout instead of processes
([app-setup](https://docs.mendix.com/appstore/creating-content/best-practices/app-setup/)):

```
PaymentsConnector/
├── _Docs/     readme snippet, version constant (semantic version)
├── UseMe/     everything a consumer may call — the public surface
└── Private/   internals consumers must not touch
```

`UseMe` is the contract. If something needs to move out of `Private`, that is a
deliberate act, and a version bump.

## Changing a Marketplace module: always in `<Module>Ext`

**Never edit a document inside a Marketplace module.** Updating the module from the
Marketplace replaces the whole module, and every change made in it is gone without
a warning. Instead, create a module named after it with `Ext` appended —
`AdministrationExt` for `Administration` — and put the changed functionality there.

Which modules are Marketplace modules: the `Source` column says so.

```bash
./mxcli -p app.mpr -c "SHOW MODULES"     # Source: "Marketplace v4.3.2" -> do not edit
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
- **The copy is now your code.** The gate does not check Marketplace modules, but it
  checks `<Module>Ext` like any module of yours: expect layout findings (spacing
  between buttons and badges that the vendor's page never had) and naming findings,
  and fix them in the copy. A test for the copied page names it on its covers line:
  `# covers: AdministrationExt.Account_Overview`.

After a Marketplace update, open the originals once and compare: a fix the vendor
has since shipped means the Ext copy can go.

## Dependencies between modules

**No cycles.** If A needs B and B needs A, you have one module wearing two names, or
a third module waiting to be extracted. The single documented exception is a
solution module paired with its adaptable counterpart, which Mendix treats as one
module
([sol-architecting](https://docs.mendix.com/appstore/creating-content/sol-architecting/)).

Point the dependency at the more stable side: features depend on the domain, never
the other way round.

Find the violations rather than guessing at them:

```bash
./mxcli graph-report -p app.mpr        # cohesion, "surprise edges", god nodes
./mxcli lint -p app.mpr                # ARCH001: a page reading another module's entities
./mxcli -p app.mpr -c "show impact of Module.Entity"
```

Security follows the same boundary: each user role maps to exactly **one** module
role per module (lint rule CONV008), so a module's roles describe that module's
access and nothing else.

## Starting a new module

1. Name it for the domain, UpperCamelCase, no `Module` suffix: `Invoicing`, not
   `InvoiceModule`.
2. Create the process folders **before** the first document — `_Setup`, `_Shared`,
   and one per process you already know about.
3. Create one module role per level of access, and map each to a single user role.
4. Put the entities the module owns in its own domain model; reach into another
   module's entities only through that module's microflows.
5. Write the whole domain model in **one script, before any page or microflow**:
   entities, associations, enumerations, module roles and their access rules. Under
   `mxcli run --watch` a change to any of those restarts the runtime (about 10 s),
   while a page or microflow hot-applies in about 2 s. Measured on a 43-exec session,
   that restart was most of the 13 s every test run waited for. Schema once, up front;
   screens and logic as often as you like.

## MyFirstModule goes once the app has its own module

A new Mendix app starts with `MyFirstModule`: a `Home_Web` page, a `MyFirstLogic` microflow,
an image collection and a `User` module role. It is scaffolding. As soon as the app has a
module of its own with pages, remove it, so nothing in the app opens on the template's empty
home page and no role carries a module role that grants nothing:

```sql
create or modify page Shop.Admin_Home (Title: 'Administration', Layout: Atlas_Core.Atlas_Default) {
  -- what an administrator starts the day with, and a link to Users
}
grant view on page Shop.Admin_Home to Shop.Admin;
create or replace navigation Responsive
  home page Shop.Order_List
  home page Shop.Admin_Home for Administrator
  -- the other role homes and the menu, as before
;
alter user role Administrator remove module roles (MyFirstModule.User);
alter user role User remove module roles (MyFirstModule.User);
drop module MyFirstModule;
```

Order matters: re-point every `home page` and menu item first, move anything your pages or
flows use from `MyFirstModule` (an image, a flow) into your module, take `MyFirstModule.User`
out of every user role, then drop the module. Remove it from the scripts in `mdlsource/` too,
or a re-run brings it back. The administrators' role opens on a page of the app's own module,
never on `MyFirstModule.Home_Web` or an Administration page.

The gate fails `MODULE01` while `MyFirstModule` is still there, listing what still uses it,
and `HOME01` when the administrators' role opens anywhere but the app's own module.

## Check it

```bash
./mxcli lint -p app.mpr | grep -E 'MOD001|ARCH001|CONV008'
./mxcli graph-report -p app.mpr
```

`MOD001` — a page, microflow, nanoflow or snippet at module root, or in a folder
named after a document type. `ARCH001` — a page reading another module's entities.
`CONV008` — a module role mapped to more than one user role. `graph-report` shows
cycles and cross-module coupling that no single rule catches.

## Validation checklist

- [ ] Every new module answers yes to domain, reuse, or integration boundary
- [ ] The domain model, roles and access rules went in first, in one script; pages and microflows after
- [ ] No document sits at module root
- [ ] `MyFirstModule` is gone, and the administrators open on a page of the app's own module
- [ ] No folder is named after a document type
- [ ] Shared documents live in `_Shared/`, not duplicated
- [ ] A consumable module exposes `UseMe/` and hides `Private/`
- [ ] No cyclic dependency between modules (`graph-report`, ARCH001)
- [ ] `./mxcli lint -p app.mpr` clean for the module, CONV008 included
- [ ] No document in a Marketplace module was changed; changes live in `<Module>Ext`
- [ ] A Marketplace document changed before the move is back to what the Marketplace shipped
