// Channel-agnostic citation store.
// Holds Map<citekey, CSLItem> in memory. Both channels (file + BBT HTTP) write here.
// Components subscribe to refresh events via subscribe().

import type { CSLItem } from '../types/document'

export interface BibProviderStatus {
  channel: 'file' | 'bbt' | 'none'
  entries: number
  lastSync?: string
}

export interface BibProvider {
  refresh(): Promise<void>
  getAll(): CSLItem[]
  get(citekey: string): CSLItem | undefined
  search(query: string): CSLItem[]
  subscribe(cb: () => void): () => void
  status(): BibProviderStatus
}

class BibProviderImpl implements BibProvider {
  private map = new Map<string, CSLItem>()
  private subs: Set<() => void> = new Set()
  private _status: BibProviderStatus = { channel: 'none', entries: 0 }
  private _refreshFn: (() => Promise<void>) | null = null

  setEntries(items: CSLItem[], channel: 'file' | 'bbt'): void {
    this.map.clear()
    for (const item of items) this.map.set(item.id, item)
    this._status = { channel, entries: items.length, lastSync: new Date().toISOString() }
    this.notify()
  }

  setRefreshFn(fn: () => Promise<void>): void {
    this._refreshFn = fn
  }

  async refresh(): Promise<void> {
    if (this._refreshFn) await this._refreshFn()
  }

  getAll(): CSLItem[] { return [...this.map.values()] }
  get(citekey: string): CSLItem | undefined { return this.map.get(citekey) }

  search(query: string): CSLItem[] {
    const q = query.toLowerCase()
    const hits: Array<{ score: number; item: CSLItem }> = []
    for (const item of this.map.values()) {
      let score = 0
      if (item.id.toLowerCase().includes(q)) score += 3
      const title = typeof item.title === 'string' ? item.title.toLowerCase() : ''
      if (title.includes(q)) score += 2
      const year = item.issued?.['date-parts']?.[0]?.[0]?.toString() ?? ''
      if (year.includes(q)) score += 1
      const authors = (item.author ?? []).map(a => (a.family ?? a.literal ?? '')).join(' ').toLowerCase()
      if (authors.includes(q)) score += 2
      if (score > 0) hits.push({ score, item })
    }
    return hits.sort((a, b) => b.score - a.score).map(h => h.item)
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  status(): BibProviderStatus { return { ...this._status } }

  private notify(): void { for (const cb of this.subs) cb() }
}

// Singleton — the entire app shares one provider.
export const bibProvider = new BibProviderImpl()
