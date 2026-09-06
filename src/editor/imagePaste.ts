// Clipboard-image detection kept outside the editor component so paste behaviour is testable
// without constructing the 2,500-line editor. A browser commonly supplies the same image through
// both `items` and `files`; prefer items and only fall back to files so one paste inserts one image.

type ClipboardFiles = Pick<DataTransfer, 'items' | 'files'>

export function clipboardImageFiles(data: ClipboardFiles | null): File[] {
  if (!data) return []
  const fromItems: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.toLowerCase().startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    // Some WebKit clipboard items report the MIME on DataTransferItem but hand back an untyped
    // File. Preserve the bytes while restoring the only information the media decoder needs.
    fromItems.push(file.type ? file : new File([file], file.name || 'pasted-image', { type: item.type }))
  }
  if (fromItems.length) return fromItems
  return Array.from(data.files ?? []).filter((file) => file.type.toLowerCase().startsWith('image/'))
}

export function pastedImageName(file: Pick<File, 'name' | 'type'>, index = 0): string {
  const supplied = file.name.trim()
  if (supplied && supplied.toLowerCase() !== 'image.png') return supplied
  const subtype = file.type.split('/')[1]?.split(';')[0] || 'png'
  return `Pasted image${index ? ` ${index + 1}` : ''}.${subtype}`
}
