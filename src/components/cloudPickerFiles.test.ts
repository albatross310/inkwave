import { describe, expect, it } from 'vitest'
import { cloudPickerFileRows } from './cloudPickerFiles'

describe('cloud destination file rows', () => {
  it('pins and identifies the existing current sync file', () => {
    expect(cloudPickerFileRows([
      { id: 'other', name: 'Other.studio' },
      { id: 'current', name: 'Thesis.studio' },
    ], 'Thesis.studio')).toEqual([
      { file: { id: 'current', name: 'Thesis.studio' }, current: true, existsHere: true },
      { file: { id: 'other', name: 'Other.studio' }, current: false, existsHere: true },
    ])
  })

  it('shows the current document as a pending create when it is not already in the folder', () => {
    expect(cloudPickerFileRows([{ id: 'other', name: 'Other.studio' }], 'New.studio')[0]).toEqual({
      file: { id: '__current-document__', name: 'New.studio' },
      current: true,
      existsHere: false,
    })
  })

  it('does not present broad legacy opener matches as studio documents', () => {
    const rows = cloudPickerFileRows([
      { id: 'json', name: 'legacy.trace.json' },
      { id: 'txt', name: 'notes.txt' },
      { id: 'old', name: 'Archive.inkwave' },
    ], 'Draft.studio')
    expect(rows.map((row) => row.file.name)).toEqual(['Draft.studio', 'Archive.inkwave'])
  })
})
