// THE ONE EXTENSION LIST (2026-07-17 — the /snapshot schema seam).
//
// WHY THIS FILE EXISTS. `buildBreakTable`/`buildRenderModel` need a real ProseMirror `Node`, and a
// Node needs a Schema. The list used to be an inline array literal inside TiptapEditor's `useEditor`
// call, so the ONLY schema in the app was the one the editor's constructor happened to build — and
// /snapshot has no editor (`useEditor` is absent there). That is why the plaintext renderer, though
// fully built and measured, could not go live: a version's `contentJson` could not be turned into a
// Node outside the editor.
//
// WHY IT IS A FUNCTION AND NOT TWO LISTS. A schema-only COPY of this list is exactly how two
// implementations drift — the textMap/pmToText lesson (see CLAUDE.md ROUND 12): the copy renders
// subtly different documents while every self-check still passes, because both sides derive from the
// same wrong structure. So there is ONE list. The editor passes its plugin closures; the schema
// builder passes none. The nodes/marks — the only things a Schema is made of — are identical BY
// CONSTRUCTION, not by a comparison we have to remember to run. (`editorSchema.ts` proves the
// identity against the LIVE editor's schema anyway, from outside — see `schemaIdentity.prove.mjs`.)
//
// WHY DEPS ARE OPTIONAL. The three closures (`getDoc`/`getHintState`/`getScasLookup`) are consumed
// ONLY by RedHighlightExtension's `addProseMirrorPlugins`. RedHighlight is an `Extension.create`
// with no nodes, no marks and no `addGlobalAttributes`, so it contributes NOTHING to the schema and
// `getSchema` never installs plugins. A schema-only build therefore needs no closures.
//
// ⚠ AND THE REASON IS NOT "the defaults are harmless" — `getDoc`'s default THROWS by design. A
// deps-less list is safe for ONE reason only: `getSchema` resolves nodes/marks and NEVER calls
// `addProseMirrorPlugins`, so the defaults are never invoked. That distinction is load-bearing:
// omitting deps is safe for the SCHEMA and unsafe for an EDITOR. Anything that ever builds a real
// Editor from this list MUST pass deps — `editorExtensions.test.ts` asserts the editor half does,
// and RedHighlight's throwing default is what makes a silent omission loud rather than subtly
// wrong. Do not "tidy" that default into something forgiving.
//
// EDITOR CONSTRUCTION IS UNCHANGED. The list below is the former inline literal verbatim: same
// entries, same order, same `.configure()` arguments. TiptapEditor called this array literal fresh
// on every render (an inline literal in the options object); it now calls a function that returns
// that same fresh array on every render. `useEditor`'s deps are unchanged, so the editor is still
// created exactly once. No work moved onto the typing or save path — this is a MOVE, not a schedule.

import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import type { Extensions } from '@tiptap/core'

import { FontSize } from './FontSize'
import { TextColor } from './TextColor'
import { ParagraphStyle } from './ParagraphStyle'
import { RedHighlightExtension, type RedHighlightOptions } from './RedHighlightExtension'
import { PaginationExtension } from './PaginationExtension'
import { ListStyle } from './ListStyle'
import { ScasSlotMark } from './ScasSlotMark'
import { CommentMark } from './CommentMark'
import { InsertionMark, DeletionMark, TrackChanges } from './TrackChanges'
import { MathInline } from './MathInline'
import { MathBlock } from './MathBlock'
import { MathPasteHandler } from './MathPasteHandler'
import { TabIndent } from './TabIndent'
import { LineNumbers } from './LineNumbers'
import { CitationNode } from './CitationNode'
import { CiteSuggestion } from './CiteSuggestion'
import { ReferenceListNode } from './ReferenceListNode'
import { MediaImage } from './MediaImage'
import { gappedPagesEnabled, paginationEnabled } from '../pageView'

/**
 * The live editor's plugin closures. Omitted for schema-only builds (no editor, no plugins) —
 * see the header: these reach ONLY RedHighlightExtension's ProseMirror plugins, never the schema.
 */
export type EditorPresentation = 'document' | 'application'

export type EditorExtensionDeps = RedHighlightOptions & {
  /** Application surfaces keep the shared editor/schema but use continuous content instead of
      inserting document-page gaps inside the tool frame. */
  presentation?: EditorPresentation
}

/**
 * The app's extension list. Pass `deps` to build the editor's; omit them to build a list whose
 * SCHEMA is identical (see `editorSchema.ts`) but whose plugins are never installed.
 */
export function buildEditorExtensions(deps?: EditorExtensionDeps): Extensions {
  const application = deps?.presentation === 'application'
  return [
    StarterKit,
    Highlight.configure({ multicolor: true }),
    Underline,
    ListStyle,
    // Always measure page breaks (shared canonical model — see pageModel.ts): gapped mode gets
    // the tall gap widgets + sheet panels, ungapped gets zero-size break markers the PageGuides
    // rules + the print stylesheet break at. Same breaks either way, so toggling the switch
    // never moves content across pages.
    PaginationExtension.configure({ enabled: paginationEnabled(), gapped: !application && gappedPagesEnabled() }),
    ScasSlotMark,
    CommentMark,
    InsertionMark,
    DeletionMark,
    TrackChanges,
    TextStyle,
    FontFamily,
    FontSize,
    TextColor,
    TextAlign.configure({ types: ['paragraph'] }),
    ParagraphStyle,
    // Standard Enter = new paragraph; Shift+Enter = hard break (via StarterKit's HardBreak).
    RedHighlightExtension.configure(deps ? {
      getDoc: deps.getDoc,
      getHintState: deps.getHintState,
      getScasLookup: deps.getScasLookup,
    } : {}),
    MathInline,
    MathBlock,
    MathPasteHandler,
    TabIndent,
    LineNumbers,
    CitationNode,
    CiteSuggestion,
    MediaImage.configure(deps ? {
      getAddedAt: (assetId: string) => deps.getDoc().media?.find((asset) => asset.id === assetId)?.addedAt ?? null,
    } : {}),
    ReferenceListNode,
    TaskList,
    TaskItem.configure({ nested: true }),
  ]
}
