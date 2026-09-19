// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  capturePaintedWorkspacePreview, clearPaintedWorkspacePreviews, mountPaintedWorkspacePreview,
} from './paintedPreview'

function surface() {
  const element = document.createElement('div')
  element.className = 'inkwave-editor-surface iw-fill'
  element.innerHTML = '<div class="iw-magnify-box"><div><input value="old"><select><option>a</option><option>b</option></select></div></div>'
  document.body.appendChild(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
  clearPaintedWorkspacePreviews()
  localStorage.clear()
})

describe('last-painted workspace cache', () => {
  it('keeps source surface styling but never creates a second live scroller', () => {
    const live = surface()
    live.classList.add('iw-magnified')
    capturePaintedWorkspacePreview('a', 'revision-1')
    const host = document.createElement('div')
    expect(mountPaintedWorkspacePreview('a', host, 'revision-1')).toBe(true)
    expect(host.querySelector('.inkwave-editor-surface.iw-magnified')).not.toBeNull()
    expect(host.querySelector('.iw-fill')).toBeNull()
  })

  it('removes a previously mounted preview when document or layout signature changes', () => {
    surface()
    capturePaintedWorkspacePreview('a', 'revision-1')
    const host = document.createElement('div')
    expect(mountPaintedWorkspacePreview('a', host, 'revision-1')).toBe(true)
    expect(mountPaintedWorkspacePreview('a', host, 'revision-2')).toBe(false)
    expect(host.children).toHaveLength(0)
    expect(mountPaintedWorkspacePreview('a', host, 'revision-1')).toBe(true)
    localStorage.setItem('inkwave:sideMargin', '150')
    expect(mountPaintedWorkspacePreview('a', host, 'revision-1')).toBe(false)
    expect(host.children).toHaveLength(0)
  })

  it('serializes live form values for reload and keeps the persisted cache bounded to two panels', () => {
    const live = surface()
    live.querySelector('input')!.value = 'edited recipient'
    live.querySelector('select')!.value = 'b'
    for (const id of ['a', 'b', 'c']) capturePaintedWorkspacePreview(id, 'revision-1')
    const saved = JSON.parse(sessionStorage.getItem('inkwave:workspace-painted-v1') || '[]')
    expect(saved.map(([id]: [string]) => id)).toEqual(['b', 'c'])
    expect(saved[1][1].box).toContain('value="edited recipient"')
    expect(saved[1][1].box).toContain('<option selected="">b</option>')
  })
})
