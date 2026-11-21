// The installer (overlay/install.mjs): its one terminal output (lib/ui.mjs), shared by main() and the steps that print,
// and the way it stops on a failure.
import { makeUi } from '../lib/ui.mjs';

export const ui = makeUi();
// v1's ui_fail: a red cross, the message in bold, the fix indented below it; exit 2 (the tests and the eval runner read it)
export const die = (s, ...fix) => { ui.fail(s, ...fix.filter(Boolean)); process.exit(2); };
