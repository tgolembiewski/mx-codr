---
name: java-action-docs
description: "The documentation every Java action gets when you create or change one: the action's own description, each parameter's, the return value's name, and the comments in its javasource file. Use before writing `create java action` or editing javasource/<module>/actions/*.java."
---

# Documented Java actions

A Java action is the one piece of logic a modeler cannot read in Studio Pro: it shows its signature and
whatever documentation you gave it, and its code lives in a file outside the model. So every Java action you
create or change carries its documentation in two places.

## 1. In the model (the `create java action` statement)

- The action's own `/** … */`, before `create`: what it does in one sentence, then its **side effects**
  (what it writes, commits, deletes, sends, calls outside the app), what it **returns**, and when it
  **fails** (which exception, and what the caller should do). This text is also the class javadoc of the
  generated `.java` file.
- Every parameter gets a `/** … */` before it: what it is, its unit or format, whether it may be empty.
- The return value gets a name with `returns T as $Name` (the variable a microflow gets).

```mdl
mdl 1;
/** Sends the invoice PDF to the customer's e-mail address.
 * Side effects: sends one e-mail through the SMTP server in the constants; writes nothing to the database.
 * Returns true when the server accepted the message.
 * Fails with an IllegalArgumentException when the invoice has no PDF; the caller shows a message. */
create or modify java action Invoicing.JA_SendInvoice(
  /** The invoice whose PDF is sent; must have a generated PDF. */
  Invoice: Invoicing.Invoice not null,
  /** The recipient's address; empty means the invoice's customer address. */
  Recipient: string
) returns boolean as $Sent
as $$
// 1. resolve the recipient, 2. load the PDF, 3. send, 4. report acceptance
…
$$;
```

## 2. In the javasource file

- The class javadoc comes from the action's documentation: change it in the model, never above
  `public class` in the file (Studio Pro and mxcli write that part again).
- Inside `// BEGIN USER CODE` of `executeAction()`, start with a short comment naming the steps, and comment
  any line whose reason is not obvious (a workaround, a limit, a format).
- Every helper method in `// BEGIN EXTRA CODE` gets a javadoc: what it does, its parameters, what it returns.
- Only the USER CODE, EXTRA CODE and import sections are yours: anything else in the file is regenerated.

## When you change one

A change to what the action does, its parameters or its side effects changes its documentation in the same
statement (`create or modify` with the new `/** … */`), so the model never describes the old behaviour.
