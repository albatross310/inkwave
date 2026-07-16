import { Music } from '../../src/routes/Music'

export function meta() {
  return [
    { title: 'Score · Inkwave' },
    // NOINDEX: a private, flag-gated view of the student's own score and markup, not a public page.
    { name: 'robots', content: 'noindex' },
  ]
}

export default function MusicRoute() {
  return <Music />
}
