1. **Close the suite against the numbered requirements.** Every requirement in `docs/brain/plan/` (R1..Rn,
   recorded with skill `requirements-interview`) is cited by the title of a test that asserts it:
   `test('[R12] a customer sees only its own orders', ...)`. One test may cite several (`[R3][R4]`), and a
   tag on a `test.describe` title cites it for every test inside. Run `node tests/coverage.mjs`: it names
   each requirement no test cites and each tag that names no requirement. Write the missing tests first,
   both sides of every rule (allowed and refused), until it prints `0 missing`. Cite a number only in a
   test that asserts that requirement's content; a skipped test cites nothing. Print no table of your
   own: the script's list is the one that counts.
