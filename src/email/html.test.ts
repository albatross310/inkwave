// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { emailHtmlFromEditor, emailHtmlHasFormatting } from './html'

describe('outbound email HTML', () => {
  it('keeps the StyleBar vocabulary and strips application-only attributes', () => {
    const html = emailHtmlFromEditor(
      '<p style="text-align:center;padding-left:2em" data-app="secret"><strong>Hello</strong> ' +
      '<mark data-color="#fef08a" style="background-color:#fef08a">Ada</mark></p>',
    )
    expect(html).toContain('<p style="text-align: center; padding-left: 2em;"><strong>Hello</strong> ')
    expect(html).toContain('<span style="background-color: rgb(254, 240, 138);">Ada</span>')
    expect(html).not.toContain('data-app')
    expect(html).not.toContain('data-color')
  })

  it('flattens unknown app nodes and rejects active link/style values', () => {
    const html = emailHtmlFromEditor(
      '<div data-citation><span style="background-image:url(https://tracker)">Visible citation</span></div>' +
      '<p><a href="javascript:alert(1)">unsafe</a><a href="https://example.com">safe</a></p>',
    )
    expect(html).toContain('Visible citation')
    expect(html).not.toContain('background-image')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="https://example.com"')
  })

  it('preserves styled and task-list meaning without executable controls', () => {
    const html = emailHtmlFromEditor(
      '<ol style="list-style-type:lower-roman"><li>First</li></ol>' +
      '<ul data-type="taskList"><li data-checked="true"><label><input type="checkbox"></label><p>Done</p></li></ul>',
    )
    expect(html).toContain('list-style-type: lower-roman')
    expect(html).toContain('☑ ')
    expect(html).not.toContain('<input')
  })

  it('distinguishes structural paragraphs from writer-applied formatting', () => {
    expect(emailHtmlHasFormatting('<p>Plain<br>mail</p><p></p>')).toBe(false)
    expect(emailHtmlHasFormatting('<p style="text-align: center">Centred</p>')).toBe(true)
    expect(emailHtmlHasFormatting('<p><strong>Important</strong></p>')).toBe(true)
    expect(emailHtmlHasFormatting(undefined)).toBe(false)
  })
})
