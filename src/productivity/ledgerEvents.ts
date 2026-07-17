// Tiny event names shared by the ledger's surfaces, in their own module so the countdown overlay
// does not have to import the drop-up (and drag the whole ledger UI onto the editor's load path).

/** Ask the toolbar's clock drop-up to open — dispatched by the countdown overlay. */
export const OPEN_LEDGER_EVENT = 'inkwave:open-ledger'
