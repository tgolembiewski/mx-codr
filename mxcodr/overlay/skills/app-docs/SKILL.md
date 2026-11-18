---
name: app-docs
description: "Write or update the app's documentation: one self-contained HTML file, docs/app-docs.html, with each app module's data model as a drawing, how the app is built, what to know and where to start, in the app's language, light and dark. Use when the person asks for the app documentation (the mx-codr panel's Generate or Update button, or their own words), and once docs/app-docs.html exists, at the end of every turn that changed the model. Not for README files, release notes or the project brain."
---

# App documentation

One HTML page a newcomer reads in ten minutes to know what the app is, where everything lives and where to start
reading. Every sentence comes from something you read in this turn: the model through `./mxcli`, or `docs/brain/`.
Never from memory, from names alone, or from what an app like this usually does. The value is what Studio Pro does
not show at a glance: how the parts connect, the rules, and the surprises.

## 0. When

- **Generate** only when the person asks. Never on your own, never as a side effect of another task.
- **Update** once `docs/app-docs.html` exists: at the end of every turn that changed the model, after your checks
  pass and before you report, update only the parts whose hash changed (section 6). A turn that changed nothing in the
  model leaves the file alone. Changes the person made in Studio Pro between turns count too: the fingerprint
  compares the whole saved model.

## 1. Gather the facts (read-only)

1. `./mxcli -p <app>.mpr --json -c "show modules"`: the **app modules** are the rows with an empty `Source`, minus
   `System`. The rest are Marketplace: one line, name + version. The count columns (PubREST, PubOData, ConOData,
   Constants, Workflows, JavaActions, ...) say which queries in step 4 are worth running.
2. `./mxcli -p <app>.mpr -c "show settings"`: default language, after-startup microflow.
3. Per app module, save `./mxcli describe module <M> --all -p <app>.mpr` to a file outside the app (it can be
   thousands of lines) and read it with grep:
   - every entity with its `/** doc */`, kind (saved, temporary, view) and its `grant` lines; every `association`
     with its `on delete` clause;
   - every flow, page and snippet with its doc comment and `folder`;
   - the **bodies** of the key flows only: the after-startup flow, the `ACT_` flows that pages and menus call, and
     the flows those call.
4. `./mxcli -p <app>.mpr -c "<stmt>"`: `describe navigation`, `show project security`, `show demo users`,
   `show scheduled events`, `show associations in <M>` (also those to other modules), and `describe user role
   <Role>` for each name in `show user roles` (only describe gives the module roles). Where step 1 counts are
   non-zero, the published and consumed services: they are in the step 3 file.
5. `./mxcli brain plan -p <app>.mpr` and the files in `docs/brain/` when it exists.
6. `node <this skill's folder>/fingerprint.mjs -p <app>.mpr`: the hashes for the stale marker (one JSON line).

**Check before you claim.** What a flow does is its body, not its doc comment: when they differ (a retrieve without
the owner filter the comment promises), describe the body and add the mismatch to Things to know. The "Calls" column
and every "always / every / only" sentence come from grep over the bodies (`call microflow`, `show page`,
`snippetcall`, `change $X (Status =`), never from doc comments or captions. Before you say who sees a widget or
when, find its `Visible:`, `DynamicClasses:` or the grant on what it calls.

## 2. Language

Write in the language of the captions users see (page titles, menu items, buttons); check it against `Default:` in
`show settings`. When they disagree, the captions win. Ignore module-role descriptions and brain entries: they are
often in the developer's language. Identifiers stay as they are; requirement text is quoted as recorded. Say in the
footer which language you chose and why.

## 3. Structure and limits

Copy `template.html` (beside this file) to `docs/app-docs.html`, read its top comment for the markup, and fill it in
this order. Prose outside the drawings: under about 1300 words.

1. **Header**: the mx-codr logo and wordmark exactly as in the template (never redraw or recolour it), the app name
   (navigation `app title`) as the title, "App documentation" (translated) under it, two or three short sentences
   on what the app does and for whom, the generated line, the numbered section links (drop Requirements with its
   section).
2. **Data model**, per app module `<section id="model-<Module>">`: the drawing (section 4) with its title block
   (drawing name, entities shown and saved, associations, sheet, key); then a plain paragraph on what deleting takes
   with it and what the app refuses to delete (`on delete`), e.g. "When a game is deleted, its rows are deleted
   with it."; a table of the saved entities: what it holds (from its doc), up to 5 key attributes (skip technical
   ones and say so once), who can see it in plain words. Temporary helpers go in one small table grouped by what
   uses them. A module with 1-2 entities: a paragraph, no drawing. Marketplace modules: one line.
3. **How it is built**: roles with home page and what each can do (a table at 3+ roles); navigation in one
   paragraph; the life cycle if there is one (the status values in order, in a sentence); key flows (at most 8, a
   table: flow, what it does for the user, what it calls); validation rules; reports; integrations (a table:
   service, direction and access, what it carries); startup, jobs and constants (names only). Short side facts (a
   URL, demo users, constant names) go in a `.margin` note beside their paragraph.
4. **Things to know** (`ol.known`): at most 6 points a newcomer would otherwise learn the hard way: comment/body
   mismatches, data that reaches the browser, missing schedules, anonymous endpoints, duplicated rules or links,
   seeding in production.
5. **Where to start** (`table.path`): 6-9 rows of step, documents to open, why; then "Where to change" as a table of
   the 3 most likely changes and the documents to edit.
6. **Requirements**, only when `docs/brain/plan/` holds requirements (else drop the section and its link): one row
   each: its number (`R7`) or, without one, its brain id; the text; the documents its anchors point at; `built` or
   `planned` from `brain plan`. When two requirements contradict each other, say which one the model follows.

**Every Mendix name is a link** the mx-codr panel opens in Studio Pro: entities, microflows, nanoflows, pages,
snippets, enumerations and module roles, in text, tables and the drawing, as the template's top comment shows
(`<a class="mx" href="#" data-mx="Module.Name" data-kind="entity">`; `data-kind` one of entity, microflow,
nanoflow, page, snippet, enumeration, role). `data-mx` is always the qualified name from the model.

## 3a. How to write

- Short, direct sentences in the active voice, each carrying a fact from the model.
- None of these: em-dash asides, "not X but Y", a colon that sets up a reveal, scare quotes, "worth noting",
  "seamless", "robust", "leverage", "delve", lists of three for rhythm, a closing sentence that repeats the paragraph.
- Section names exactly: Data model, How it is built, Things to know, Where to start, Requirements (translated).
- Mendix names in `<code>` inside their link, as they are. Captions users see in **bold**.
- No modelling jargon for the reader: say "saved in the database", "temporary, only while a page is open", "uploaded
  picture", "one Game has many Rows", "not linked to others"; never "persistent", "non-persistent", "specialises",
  "generalisation", "cardinality", "association". The names of the documents themselves stay as they are.
- Name the document that proves a claim ("the retrieve in `DS_WinCounter` has no owner filter"), never a vague
  subject ("some flows").

## 4. Drawings

- Inline `<svg viewBox="0 0 940 H">`, boxes 200 wide on three columns (x = 20, 370, 720), rows 130-150 apart. Do
  **not** scale the `@Position` coordinates (spread over 1500+ px, or a generated grid that means nothing). Lay out
  by links instead: the central entity (the one most links point to) in the middle column, its children above or
  below it, small satellites (pictures, logs, tags) left and right. Entities without links: a `caption` "Not linked
  to others" and a row at the bottom.
- **It looks like Studio Pro's domain model**, so a Mendix developer reads it at once: the template's `--dm-*`
  colours (indigo entities, amber temporary ones, the blue generalization tag, grey lines with circled ends,
  association names in red-bordered boxes), a light and a dark set; never other colours in the drawing.
- **The key is visual, the behaviour is text.** The title block's last cell (`div.keycell` with `<b>Key</b>` and a
  `div.key`) shows one sample of each box kind the drawing uses, drawn with the same classes as the drawing, with a
  plain label ("Saved in the database", "Temporary, only while a page is open", "Image file (uploaded picture)"), and
  one sample line per kind of link with a real example ("1 ― * one Game has many Rows"; add "* ― *" only when the
  module has a many-to-many link). No legend sentences.
- Notes inside boxes in plain words: "temporary", "computed view", "uploaded picture", "login account".
- At most 12 boxes per drawing; split a bigger module by folder or cluster.
- A box (200 wide, `rx="3"`): a 26 px header row closed by a `hd` line, the entity icon (`rect.ico` 14×14 with
  `text.ico` "e") and the name (its link), then up to 6 attribute lines in mono written as Studio Pro lists them,
  `Name (Type)`: String, Integer, Long, Decimal, Boolean, Date and time, Enumeration, AutoNumber, Hashed string,
  Binary (combine same-typed ones: `Color1–Color4 (Integer)`, `Black, White (Integer)`; at most 31 characters a
  line), height `36 + 16 × lines`. Kinds: saved (`box`, `hd`, `ico`, `name`, `attr`); temporary or computed (`np` on
  all of them: the amber box and the dashed icon, plus an `attr note`); another module's record (`ext`, plus an
  `attr note` saying what it is). An entity that extends another (System.Image, System.FileDocument, System.User)
  carries the generalization tag above its box: `rect.gen` 14 high at y−17 with the parent's name in `text.gen`
  (leave 18 px above such a row); an image entity keeps its `attr note` "uploaded picture".
- A line per association from `show associations`; at each end a `circle.mult` (r 7, on the line, 12 px from the
  box) with the `text.mult` at its centre: Reference = `*` at the parent, `1` at the child (Owner `Both`: `1` at
  both); ReferenceSet = `*` at both. The name as `text.label` in a `rect.label` (the red border) above the middle of
  the line, 14 high, `6 × characters + 4` wide. Straight lines; one bend (`polyline`) when a line would cross a box.
  Names must fit the 150 px gap.
- Colours only through the template's tokens (`--paper --ink --quiet --rule --accent --sheet`, `--ok --warn`, the
  drawing's `--dm-*`); a new colour gets a light and a dark value with AA contrast. The page loads its three web fonts
  from Google Fonts and falls back to system fonts offline (the mx-codr panel and its PDF use copies it carries); no
  other external files. The only scripts are the template's two inline
  scripts: copy them byte for byte (the panel runs exactly these) and add none.
- **Theme switch** (System / Light / Dark, top right): the reader's override, kept in `localStorage` key
  `mxcodr-docs-theme`. Inside the mx-codr panel the panel keeps the reader's choice; without one it may start in its
  own theme.

## 5. Never include

What anyone sees in Studio Pro in one click without insight (every attribute, every widget, activity lists);
constant values, URLs of configurations, passwords (also the ones written in doc comments), keys; personal data from
the database or the brain; anything you did not read.

## 6. Fingerprint and updates

- Put the JSON line of `fingerprint.mjs` in `<meta name="mxcodr-docs" content='...'>`. Each section carries the
  part it was written from: `data-src="module:<M>"`, `"app"` (header), `"brain"` (requirements), `"all"` (how it is
  built, things to know, where to start), with that part's `data-hash` (`overall` for `"all"`).
- **Update**: `node <this skill's folder>/fingerprint.mjs -p <app>.mpr --check docs/app-docs.html` names the parts
  that differ. For each, gather only that part again (step 3 for that module, 4 for `app`, 5 for `brain`) and
  rewrite the sections with that `data-src`, plus the lines in How it is built, Things to know and Where to start
  that mention what changed. Then the new meta and hashes. Never rewrite an unchanged section. `"current": true`
  with `"mxcli": true` (another mxcli version, the same saved model): only the new meta and hashes, no text. Parts
  `["model"]` (the model changed and the page was written with another mxcli, so the parts cannot be told): write
  everything again. A passage with an open or answered comment (section 7) stays word for word
  unless the part it was written from changed; then rewrite it and answer the comment with what changed.

## 7. Comments

The person comments on passages in the mx-codr panel; the comments are in `docs/app-docs.comments.json`, each with
`id`, `quote` (the passage), `before`/`after` (the text around it), `src` and `section` (where), `note`, `status`, and a
`thread` of earlier answers and replies. A request to fix comments names them by id.

1. Read the file. Work on the comments with `status: "open"` only, and in the page only on their passages (find each
   by `quote` with `before` and `after` in its `section`). Leave every other sentence as it is.
2. Check what the note asks for against the model, as in section 1. Where it is right, rewrite the passage (same
   writing rules, links on every name) and set the comment's `status` to `"resolved"`.
3. Where the note contradicts the model (it asks for something the model does not do or have), do not change the text:
   set `status` to `"answered"`, `reply` to one or two sentences naming the document that shows it, and `answeredAt`
   to the time. A reply in `thread` from the person is part of the note: read it before you decide.
4. Write the file back whole, valid JSON, every other field and comment unchanged; never delete a comment. Then the
   meta and hashes as in section 6.

## 8. Check before you report

- Every document named, and every `data-mx`, exists in the model (grep the step 3 file or `describe` it).
- The fingerprint again: its `overall` equals the meta (nothing changed while you wrote).
- Screenshot it in light and dark, and dark with `data-theme="light"` on `<html>`, with your own headless Chromium
  (`chromium.launch()` from the Playwright library, `colorScheme` per context), never the `playwright-cli` browser
  the app's tests share. Check: readable drawing, body background follows the theme, no horizontal scroll, no
  request leaves the file except the three Google Fonts files. Look at the screenshots; fix what they show once.
