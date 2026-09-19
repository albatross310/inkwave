// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmailAttachmentBar } from './EmailAttachmentBar'

const attachment = {
  id: 'attachment-1',
  name: 'proposal.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  sha256: 'ab'.repeat(32),
  addedAt: '2026-09-07T00:00:00.000Z',
}

describe('EmailAttachmentBar', () => {
  it('shows attached files and removes only the selected reference', () => {
    const onChange = vi.fn()
    render(<EmailAttachmentBar attachments={[attachment]} onChange={onChange} />)
    expect(screen.getByText('proposal.pdf')).toBeTruthy()
    expect(screen.getByText('2 KB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove proposal.pdf' }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
