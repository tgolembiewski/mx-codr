## Project brain

You only propose, with `./mxcli brain capture "<text>" ... --json` (add `-p <app>.mpr`). Capture on three
triggers only, never for small fixes, technical questions or what mxcli shows, and never ask
whether to save something. Every entry is `"<title>\n<details>"`: a title of at most about 8 words saying what is
required or decided, the details and the reason on the second line.
1. A feature request not in the requirement list: `"R<n> <title>\n<details>" --slice <NN-name> -a
   @Module.Document`: n after the highest R, queue too; a new slice takes the next free NN. The anchor is a NEW
   document or attribute the work creates (enum, page, microflow): never an existing one, never a bare module.
2. You cannot go on without a business-rule answer: capture the question with `--open` first, then ask it (plan mode: no
   `--open`, the answer goes into the plan's lines).
   Answered in a chat message: `./mxcli brain promote <id>`, then `./mxcli brain resolve <id> "<their exact words>"`.
3. The person corrected the same thing a second time, or you chose between real alternatives (or an odd mxbuild
   error or Marketplace version): capture `"D<n> <title>\n<why>" -a @...` (the person decides by that why;
   n after the highest D, queue too). At most 3 per turn.
Never promote your own findings, write a status into a requirement, or edit or drop an entry unless asked in the chat.
Except: build an anchor under exactly its name; if named otherwise, or a finished requirement has none, run at once
`./mxcli brain edit <id> -a @<the document you built>` (id: `brain list`).
**With `MXCODR_PANEL=1`** set, the person approves in mx-codr's panel: promote nothing else. A plan captures nothing:
per new requirement one line `Requirement: R<n> <title> | slice <NN-name> | anchor @Module.Document | why <details>`
(anchor: the NEW page or microflow that builds it, even before it exists; left out only if it has none); per
business-rule assumption one line `Decision: D<n> <title> | anchor @Module.Document | why <details>` (anchor and why
optional, approved with the plan); open choices: trigger 2. The pack names the next free R, D and slice numbers.
The brain pack at session start is your brain reading and the requirement list (no pack: `./mxcli
brain list --kind requirement`); do not read `docs/brain/`; in a module: `./mxcli brain brief --module <M>`.
**Without it**, promote only what the person approved in the chat.
