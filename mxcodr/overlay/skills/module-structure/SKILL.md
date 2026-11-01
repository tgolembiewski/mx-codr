---
name: module-structure
description: "Whether new functionality belongs in an existing module or a new one, and the folder structure a module starts with — processes, not document types. Changes to a Marketplace module go in a <Module>Ext module. Use before creating a module, before adding the first documents to one, before changing a Marketplace module, and when deciding where a new page or microflow goes."
---

# Module structure

Two questions come before any document is created: *is this a new module*, and
*which folder does it go in*. Getting them wrong is cheap today and expensive
later — a module is the unit Mendix secures, versions and (eventually) replaces.

The **mechanics** — `MOVE`, the `folder:` page property, the `folder '...'`
microflow clause — live in mxcli's own
[organize-project](../../../.ai-context/skills/organize-project/SKILL.md). This
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
│   ├── FNC/
│   └── ENV/
├── Invoicing/       raise and correct an invoice
│   ├── UI/          Invoice_Overview, Invoice_Edit
│   ├── FNC/         ACT_Invoice_Save, SUB_Invoice_Number
│   └── ENV/         ENUM_InvoiceStatus, PaymentTermsDays, JSON_Invoice
├── Chasing/         remind, escalate, write off
├── CustomerAdmin/   maintain customers
└── _Shared/         used by more than one process (UI/, FNC/, ENV/ again)
```

The rules:

- **Every document lives in a folder.** Nothing at module root, enumerations and
  constants included. A module root full of documents is the state a module decays
  into, and it decays quickly. Entities have no folders (the domain model is one canvas).
- **Each process folder holds three kind folders, and only these:** `UI` for pages and
  snippets, `FNC` for microflows and nanoflows, `ENV` for everything else --
  enumerations, constants, Java and JavaScript actions, JSON structures, mappings,
  REST and OData services, workflows, scheduled events. A process with thirty
  documents of every kind in one list is unreadable; three short lists are not.
  Create each document in place with a `folder '...'` clause; one created without it
  is moved in the same script (mxcli's `organize-project` has the full syntax):

  ```sql
  create or modify microflow Invoicing.ACT_Invoice_Send ($Invoice: Invoicing.Invoice)
  folder 'Invoicing/FNC'
  begin
    @caption 'Mark the invoice as sent'
    change $Invoice (IsSent = true) commit;
  end;
  create or modify page Invoicing.Invoice_Overview folder 'Invoicing/UI'
  (Title: 'Invoices', Layout: Atlas_Core.Atlas_Default) {
    -- the page's widgets
  };
  move enumeration Invoicing.ENUM_InvoiceStatus to folder 'Invoicing/ENV';
  ```
- **Process folders are named for the business, never for a document type.**
  `Microflows/`, `Pages/`, `Snippets/`, `Logic/` are banned, and `UI`, `FNC`, `ENV`
  appear only as the last folder: `Invoicing/UI`, never `UI/Invoicing`.
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

Never edit a Marketplace module itself: an update overwrites it. A change to one goes into a module of
your own named `<Module>Ext`. How, step by step: [reference/marketplace-ext.md](reference/marketplace-ext.md)
-- read it before you change anything in a Marketplace module.

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
./mxcli -p app.mpr -c "list impact of Module.Entity"
```

Security follows the same boundary: each user role maps to exactly **one** module
role per module (lint rule CONV008), so a module's roles describe that module's
access and nothing else.

## Starting a new module

1. Name it for the domain, UpperCamelCase, no `Module` suffix: `Invoicing`, not
   `InvoiceModule`.
2. Create the process folders **before** the first document — `_Setup`, `_Shared`,
   and one per process you already know about, each with its `UI`, `FNC` and `ENV`.
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
create or modify page Shop.Admin_Home (Title: 'Administration', Layout: Atlas_Core.Atlas_Default, Url: 'admin-home') {
  -- what an administrator starts the day with, and a link to Users
};
grant view on page Shop.Admin_Home to Shop.Admin;
create or modify navigation Responsive
  home page Shop.Order_List
  home page Shop.Admin_Home for Administrator
  -- the other role homes and the menu, as before
;
alter user role Administrator drop module roles (MyFirstModule.User);
alter user role User drop module roles (MyFirstModule.User);
drop module MyFirstModule;
```

Order matters: re-point every `home page` and menu item first, move anything your pages or
flows use from `MyFirstModule` (an image, a flow) into your module, take `MyFirstModule.User`
out of every user role, then drop the module. Remove it from the scripts in `mdlsource/` too,
or a re-run brings it back. The administrators' role opens on a page of the app's own module,
never on `MyFirstModule.Home_Web` or an Administration page.

To see what still uses it before the drop: `./mxcli -p app.mpr -c "list references to MyFirstModule.Home_Web"`
(and the same for its other documents).

## Nothing left behind

A document nothing uses still costs: a reader takes it for live code, and a re-run of an old
script edits it instead of the one the app uses. When a data source flow gives way to a
`database` source, a probe has answered, or a page was replaced, drop the old one in the
same script, and its `create` in `mdlsource/` too:

```sql
drop microflow Shop.DS_Customers;
drop enumeration Shop.ENUM_OldStatus;
```

**Nothing left that nothing uses.** Before you call the work finished, look for microflows,
nanoflows, pages, snippets, enumerations and Java actions of the app's own modules that nothing
uses, and drop them. A document is unused only when three things agree: no reference in the model
(`list references to`, which covers calls, pages, navigation, settings, scheduled events and
published services), its name in no Java, JavaScript, theme or test file, and a copy of the app
still passing `./mxcli docker check` without it. A document kept on purpose (an API for later, a
page opened only by its URL) stays; say why in its documentation comment, and in the project brain if it is a
decision.

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
- [ ] No document is left that nothing uses; its script in `mdlsource/` is gone too
- [ ] Every document in `<process>/UI`, `/FNC` or `/ENV`; no folder named after a document type
- [ ] Shared documents live in `_Shared/`, not duplicated
- [ ] A consumable module exposes `UseMe/` and hides `Private/`
- [ ] No cyclic dependency between modules (`graph-report`, ARCH001)
- [ ] `./mxcli lint -p app.mpr` clean for the module, CONV008 included
- [ ] No document in a Marketplace module was changed; changes live in `<Module>Ext`
- [ ] A Marketplace document changed before the move is back to what the Marketplace shipped
