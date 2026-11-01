---
name: requirements-interview
description: "Ask the person what the app must do before building it: roles, data, journeys, channels, outside systems, security, what counts as done; at most two rounds. When nobody can answer (the request says so, or an unattended run), take your recommended answers as assumptions, write them down and build on. Use before the first feature of a new app, and before a change that adds a role, a module or a channel."
---

# Ask before you build

A short request ("make me an invoice chasing app") leaves most of the app open. Whatever you
guess there, the person corrects after you report it finished, and that is the most expensive
rework. Ask first, record the answers as requirements, then build them and keep a test for each
(skill `durable-tests`).

## 0. Should you ask at all?

- **Someone can answer** (the default): ask the person, and wait for the answers.
- **Nobody can answer**: the request says not to ask, or the run is unattended (a benchmark, a
  scheduled job). Do every step below, but take your recommended answers as assumptions and go on
  without waiting. Never end a turn on a plan, a question or "say go": nobody reads it, and the
  run stops there with nothing built. Record the assumptions and start building in the same turn.

Skip the questions when the request already answers every branch below, or when the change adds
no role, module or channel. `./mxcli brain plan -p <app>.mpr` shows the requirements already
recorded: ask only about what is new.

## 1. The questions: one fixed tree

Check the request against these branches. Every branch it leaves open is a question.

1. **Who uses it:** the user roles; what each one may see and change; seeded users or sign-up.
2. **The data:** the main entities and their key attributes; what is required, what is unique.
3. **The journeys:** per role, the pages and actions in the order the user meets them.
4. **Channels:** browser, phone, offline -- and then what syncs, and when.
5. **Outside world:** imports, REST or OData, e-mail, files.
6. **Security:** who may see whose data; the demo users and their passwords.
7. **Done:** per journey, what the person checks to call it done.

## 2. Ask in rounds

At most two rounds, at most 7 questions a round. Ask first what the other answers depend on
(roles before journeys, journeys before acceptance). Number each question and give your
recommended answer, so the person can reply "all as recommended":

```
Q1 - Who signs in: <the question, with the choices>
  -> Recommended: <your answer>
```

What you can look up yourself (the model, `./mxcli`, the files) you never ask. A question left
over after the second round becomes an assumption with its recommended answer.

## 3. Record each answer in the project brain

`docs/brain/` must exist first: `./mxcli brain init -p <app>.mpr` when it does not. mxcli's
`project-brain` skill says what belongs there.

- **The scope is the words of the request.** Everything the request names is built, literally.
  A dashboard, KPI, statistics or summary page, an extra role, a log or notes entity, and edit or
  admin screens are extras unless the request names them: list each idea you leave out under "to
  add next" in your final report, where the person approves it. What a finished Mendix app needs
  whether or not the request names it (sign-in, Log out, the signed-in user's name, folders,
  captions, demo users, a home page) is not an extra; build it and say so in the report.
- **Keep what the request spells out.** A requirement is a paraphrase, and the details fall out of
  a paraphrase: a count ("exactly 8 characters", "last 6 weeks"), a bound (a quantity > 0), a
  format, a caption in quotes ("Add to cart"), a place ("a bar above the table"), a state
  ("disabled", not hidden), "unique", "default". Copy the words into the requirement and write its
  "checked when" so that it asserts them: the literal number or caption, never a value read back
  from the app's own data. "Do not simplify" and "literally" in a request are binding.
- **A departure is an assumption with its proof.** What the request says about a screen or a step
  is built as written. What you cannot build is recorded as `Assumed: ... because <the mx check or
  runtime error text>`; "simpler" or "it is hidden instead" is no proof.
- **One requirement per acceptance criterion**, one sentence, anchored where it will be built --
  the anchor may name a page or microflow that does not exist yet (that reads as "not built yet"):
  ```
  ./mxcli brain capture "A customer can see only their own invoices; checked when demo_customer opens Invoices and sees no other customer's row" --slice 01-customer-sees-invoices -a @Invoicing.Invoice_Overview -p <app>.mpr
  ```
  The sentence: "<role> can <what>; checked when <what is visible>". Group the requirements in one
  slice per journey (a role and its goal), not one per layer (security, data model, pages).
- **Every number, limit and place the request names is its own requirement** ("one Employee, one
  Manager, two customers"; "a filter bar above the table"): what is not recorded is lost to the
  next session.
- **An assumption is only what the person did not decide** -- a question left over after the
  second round, one they left to you, and every answer when nobody can answer -- captured as an
  open question: `./mxcli brain capture "Assumed: one currency, EUR" --open -p <app>.mpr`. An answer
  the person gave or accepted ("all as recommended" included) is a requirement, never `--open`.
- **A feature that needs a key, an account or an outside service is built, not deferred**: build
  it to work with a stand-in when the key is missing (a template text for an AI draft, a mock for
  a service), read the key from a constant left empty, and record the key as an open question.
- **Capture a slice in one command:** chain its captures with `&&`, not one tool call each.

Then show the person the list -- each requirement as its sentence, grouped by slice -- and ask:
"Do you agree?" Do this even after "all as recommended": they agreed to answers, not to the
requirements you wrote from them. Captures wait in mxcli's queue (`./mxcli brain staged`) until a
person promotes them; that step is theirs. When nobody can answer, promote them yourself in one
chained command (`./mxcli brain promote <id> -p <app>.mpr && ...`), so `brain plan` counts them.

**Never resolve an open question yourself** (`./mxcli brain resolve`): it is the person's answer.
When they give it, run `./mxcli brain resolve <id> "<their answer>"` with their words.

## 4. Then build

Build the slices one journey at a time. Every requirement gets a test that checks its "checked
when" (skill `durable-tests`): name the requirement's subject in the assertion's message, so a red
test says which requirement it is. `./mxcli brain plan -p <app>.mpr` counts what is built against
what was asked. In the final report, list the assumptions still open for the person to settle.

The question format comes from Matt Pocock's `grilling` skill (github.com/mattpocock/skills, MIT).
