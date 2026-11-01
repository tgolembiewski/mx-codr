# Keep your checks as tests

Every check you make of the running app — a browser flow per role, a refusal, data isolation, a
computed value, an API call — goes into `tests/` as a re-runnable automated test (Playwright for the
browser), never a throwaway script. Each requirement of the request gets a test that asserts its actual
content (the value, the order, the refusal, both sides of a rule), not only that a page opens. Before you
say you are done, run the whole suite once and show it passing.
