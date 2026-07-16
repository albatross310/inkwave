import { Productivity } from '../../src/routes/Productivity'

export function meta() {
  return [
    { title: 'Your writing · Inkwave' },
    // NOINDEX: this is a private, flag-gated view of the writer's own record, not a public page.
    { name: 'robots', content: 'noindex' },
  ]
}

export default function ProductivityRoute() {
  return <Productivity />
}
