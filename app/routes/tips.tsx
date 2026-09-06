import { Tips } from '../../src/routes/Tips'

export function meta() {
  return [
    { title: 'Tips · Inkwave Zero' },
    { name: 'description', content: 'Inkwave shortcuts, window controls, and one-click .studio file setup.' },
  ]
}

export default function TipsRoute() {
  return <Tips />
}
