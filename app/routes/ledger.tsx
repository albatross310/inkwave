import { Ledger } from '../../src/routes/Ledger'

export function meta() {
  return [
    { title: 'Your ledger | Inkwave Zero' },
    {
      name: 'description',
      content:
        'Your Inkwave ledger — a Pomodoro rhythm, a record of how you worked, and your own session notes. Kept in your own storage; Inkwave never holds it.',
    },
    // Private, per-user data: keep it out of search results entirely.
    { name: 'robots', content: 'noindex, nofollow' },
  ]
}

export default function LedgerRoute() {
  return <Ledger />
}
