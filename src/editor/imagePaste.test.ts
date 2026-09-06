// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { clipboardImageFiles, pastedImageName } from './imagePaste'

function item(file: File | null, type = file?.type ?? ''): DataTransferItem {
  return { kind: 'file', type, getAsFile: () => file } as DataTransferItem
}

describe('clipboardImageFiles', () => {
  it('accepts image clipboard items and refuses non-images', () => {
    const png = new File(['png'], 'shot.png', { type: 'image/png' })
    const text = new File(['no'], 'notes.txt', { type: 'text/plain' })
    expect(clipboardImageFiles({ items: [item(png), item(text)] as unknown as DataTransferItemList, files: [] as unknown as FileList })).toEqual([png])
  })

  it('does not duplicate the same image exposed through both clipboard collections', () => {
    const png = new File(['png'], 'shot.png', { type: 'image/png' })
    expect(clipboardImageFiles({ items: [item(png)] as unknown as DataTransferItemList, files: [png] as unknown as FileList })).toHaveLength(1)
  })

  it('repairs an untyped WebKit file from its clipboard-item MIME', () => {
    const raw = new File(['png'], '')
    const [fixed] = clipboardImageFiles({ items: [item(raw, 'image/png')] as unknown as DataTransferItemList, files: [] as unknown as FileList })
    expect(fixed.type).toBe('image/png')
  })

  it('gives anonymous clipboard images a useful stable label', () => {
    expect(pastedImageName(new File(['x'], 'image.png', { type: 'image/png' }))).toBe('Pasted image.png')
    expect(pastedImageName(new File(['x'], '', { type: 'image/jpeg' }), 1)).toBe('Pasted image 2.jpeg')
  })
})
