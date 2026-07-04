// Channel-agnostic citation store.
// Holds Map<citekey, CSLItem> in memory. The native library channel (OPFS) and the browser
// extension both write here via upsert/remove/setEntries. Components subscribe to refresh events.

import type { CSLItem } from '../types/document'

export type BibChannel = 'library' | 'extension' | 'none'

export interface BibProviderStatus {
  channel: BibChannel
  entries: number
  lastSync?: string
}

export interface BibProvider {
  refresh(): Promise<void>
  getAll(): CSLItem[]
  get(citekey: string): CSLItem | undefined
  getVersion(): number
  search(query: string): CSLItem[]
  subscribe(cb: () => void): () => void
  status(): BibProviderStatus
}

class BibProviderImpl implements BibProvider {
  private map = new Map<string, CSLItem>()
  private subs: Set<() => void> = new Set()
  private _status: BibProviderStatus = { channel: 'none', entries: 0 }
  private _refreshFn: (() => Promise<void>) | null = null
  private _version = 0

  /** Monotonically increasing counter — increments on every change. Use with useSyncExternalStore. */
  getVersion(): number { return this._version }

  /** Replace the whole library (used when hydrating from the OPFS store on load). */
  setEntries(items: CSLItem[], channel: Exclude<BibChannel, 'none'> = 'library'): void {
    this.map.clear()
    for (const item of items) this.map.set(item.id, item)
    this._status = { channel, entries: this.map.size, lastSync: new Date().toISOString() }
    this.notify()
  }

  /** Insert or replace one entry (extension capture, URL/DOI capture, manual add). */
  upsert(item: CSLItem, channel: Exclude<BibChannel, 'none'> = 'library'): void {
    this.map.set(item.id, item)
    this._status = { channel, entries: this.map.size, lastSync: new Date().toISOString() }
    this.notify()
  }

  /** Remove one entry by citekey. Returns true if it existed. */
  remove(citekey: string): boolean {
    const had = this.map.delete(citekey)
    if (had) {
      this._status = { ...this._status, entries: this.map.size, lastSync: new Date().toISOString() }
      this.notify()
    }
    return had
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
    const q = query.toLowerCase().trim()
    if (!q) return this.getAll()
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

  private notify(): void {
    this._version++
    for (const cb of this.subs) cb()
    // DOM-event backup for NodeViews in isolated React roots. Guarded so the store stays usable in
    // SSR / tests / workers where there is no window.
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('inkwave:bib-changed'))
  }
}

// Singleton — the entire app shares one provider.
export const bibProvider = new BibProviderImpl()
