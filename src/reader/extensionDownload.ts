// WHERE A WRITER GETS THE INKWAVE EXTENSION — one constant, one place.
//
// Peter, 2026-08-30, looking at the offer the source panel shows at a wall: **"this is for others
// not us: we need to host the file on our github and give instructions on how the user downloads it
// on github and then installs with developer mode."** The card was telling a reader to run
// `pnpm ext:build`, which assumes a clone, a toolchain and a package manager. That is an
// instruction only its authors can follow — the same failure as a button that does nothing, in
// prose, and it sat inside a card whose own header rule is "NO DEAD DOWNLOAD BUTTON".
//
// v0.1.5 is CUT AND VERIFIED — downloaded back over HTTPS (200, 31,398 bytes), unzipped, and the
// manifest read out of the artifact a writer would actually install: name Inkwave, version 0.1.5,
// `content_scripts` present (its absence was the bug that made live view dark for four rounds),
// `declarativeNetRequestWithHostAccess`, and `<all_urls>` still OPTIONAL. So the card links to the
// asset, not to a listing page.
//
// ⚠ THE LINK IS PINNED BY HAND AND NOT DERIVED FROM `extension-src/package.json`, AND THE TWO FAIL
// IN OPPOSITE DIRECTIONS. Deriving it looks tidier and is worse: bumping the version bumps the URL
// the instant somebody edits that file, so between the bump and the upload the card points at a
// release that does not exist — a 404, which is the dead-button failure with a delay on it. A
// pinned constant can only ever name an asset that DID exist, so the worst it can go is STALE, and
// a stale zip still unzips, still installs and still works. Failing old beats failing dead.
//
// What catches the staleness is the GATE, not the runtime: `extensionDownload.test.ts` asserts this
// URL's version matches `extension-src/package.json`, so cutting a release and forgetting this line
// turns the suite red at home rather than turning the card into a 404 in front of a writer.
//
// ⚠ AND IT IS ONE CONSTANT SO THAT A WEB STORE LISTING IS ONE EDIT. The copy around it changes then
// too — a store install is one click and carries no Developer-mode warning — so `extensionOffer()`
// in SourceBrowser.tsx is the other half of this decision and the two must move together.

/**
 * The exact zip a writer installs. Version-pinned; see the header for why that is deliberate.
 *
 * ⚠ WHEN YOU CUT A RELEASE, UPDATE THIS LINE. The test will tell you if you forget.
 */
export const EXTENSION_ZIP_URL =
  'https://github.com/albatross310/inkwave/releases/download/v0.1.5/inkwave-extension-0.1.5-chrome.zip'

/**
 * All versions, and the release notes.
 *
 * Shown BESIDE the download rather than instead of it: the notes carry the honest limits the card
 * is too small to hold (JSTOR, Google's results and YouTube's home page answer a framed request
 * with a bot challenge whatever we do; `<all_urls>` is optional and revocable), and it is the live
 * route if the pinned asset above is ever wrong. A single link with no second door is how a stale
 * constant becomes a dead end.
 */
export const EXTENSION_RELEASES_URL = 'https://github.com/albatross310/inkwave/releases'

/**
 * The unpacked folder name inside the release zip, as `wxt zip` produces it.
 *
 * Named here rather than described in prose in the card, because the writer has to RECOGNISE it in
 * a file picker — "pick the folder you just unzipped" is ambiguous when unzipping produces a folder
 * containing a folder, which on macOS and Windows it routinely does.
 */
export const EXTENSION_UNPACKED_DIR = 'chrome-mv3'
