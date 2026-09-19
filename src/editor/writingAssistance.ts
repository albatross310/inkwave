/**
 * Native/WebKit inline prediction paints a pale completion after the caret (for example
 * `consis|tently`). It looks like the caret has fallen behind real document text, especially in the
 * installed Safari app. Inkwave owns its own explicit SCAS suggestions, so browser-authored text
 * must stay out of the contenteditable surface.
 */
export const EDITOR_WRITING_ASSISTANCE_ATTRIBUTES = {
  spellcheck: 'false',
  autocomplete: 'off',
  autocorrect: 'off',
  writingsuggestions: 'false',
} as const
