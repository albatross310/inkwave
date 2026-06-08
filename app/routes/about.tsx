import { About } from '../../src/routes/About'

export function meta() {
  return [
    { title: 'About — Inkwave' },
    { name: 'description', content: 'About Inkwave — a calm writing environment.' },
  ]
}

export default function AboutRoute() {
  return <About />
}
