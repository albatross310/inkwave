// Minimal Tiptap editor on the SAME engine family as Inkwave (ProseMirror + StarterKit),
// with NONE of Inkwave's extensions (SCAS, pagination, citations, waves, decorations).
// This isolates Inkwave's own per-keystroke overhead above the bare engine.
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const editor = new Editor({
  element: document.getElementById('editor'),
  extensions: [StarterKit],
  content: '<p>ready</p>',
})

window.__editor = editor
window.__region = document.querySelector('.ProseMirror')
window.__sig = () => window.__region.textContent.length

// paras: array of paragraph strings. Caret goes into the MIDDLE paragraph.
window.__setDoc = (paras) => {
  const html = paras.map(p => '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>').join('')
  editor.commands.setContent(html, false)
  window.__region = document.querySelector('.ProseMirror')
  // place caret in the middle of the doc
  const size = editor.state.doc.content.size
  editor.commands.focus()
  editor.commands.setTextSelection(Math.floor(size / 2))
}
