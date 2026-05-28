import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { InkwaveDocument } from '../types/document'
import { scheduleSave } from '../storage/opfs'
import { upsertMeta } from '../storage/indexeddb'

interface TiptapEditorProps {
  doc: InkwaveDocument
  onDocChange: (updated: InkwaveDocument) => void
}

export function TiptapEditor({ doc, onDocChange }: TiptapEditorProps) {
  const docRef = useRef(doc)
  useEffect(() => {
    docRef.current = doc
  }, [doc])

  const editor = useEditor({
    extensions: [StarterKit],
    content: doc.contentJson,
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        'data-placeholder': 'Begin writing…',
      },
    },
    onTransaction: ({ editor: e }) => {
      const current = docRef.current
      const updated: InkwaveDocument = {
        ...current,
        contentJson: e.getJSON(),
        updatedAt: new Date().toISOString(),
        title: deriveTitle(e.getText()) || current.title,
      }
      docRef.current = updated
      onDocChange(updated)
      scheduleSave(updated)
      void upsertMeta({
        id: updated.id,
        title: updated.title,
        updatedAt: updated.updatedAt,
      })
    },
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const currentContent = JSON.stringify(editor.getJSON())
    const incomingContent = JSON.stringify(doc.contentJson)
    if (currentContent !== incomingContent) {
      editor.commands.setContent(doc.contentJson, false)
    }
  }, [doc.id, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="inkwave-editor-surface min-h-screen bg-parchment px-6 py-12 md:px-0">
      <div className="mx-auto w-full max-w-[680px]">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  return first.slice(0, 80)
}
