export type CloudPickerFile = { id: string; name: string }

export type CloudPickerFileRow<T extends CloudPickerFile = CloudPickerFile> = {
  file: T
  current: boolean
  existsHere: boolean
}

const STUDIO_EXT = /\.(?:studio|inkwave)$/i

function cleanName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/**
 * Files displayed by a sync-destination picker. The current document is pinned first. If the
 * provider listing contains it, the row truthfully says the next sync updates that existing file;
 * otherwise a synthetic row makes the pending create equally explicit.
 */
export function cloudPickerFileRows<T extends CloudPickerFile>(
  files: readonly T[],
  currentName: string,
): CloudPickerFileRow<T>[] {
  const visible = files.filter((file) => STUDIO_EXT.test(file.name))
  const current = cleanName(currentName)
  const found = current ? visible.find((file) => cleanName(file.name) === current) : undefined
  const rows: CloudPickerFileRow<T>[] = []
  if (found) rows.push({ file: found, current: true, existsHere: true })
  else if (currentName.trim()) rows.push({
    file: { id: '__current-document__', name: currentName.trim() } as T,
    current: true,
    existsHere: false,
  })
  for (const file of visible) {
    if (file === found) continue
    rows.push({ file, current: false, existsHere: true })
  }
  return rows
}

