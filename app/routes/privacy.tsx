import { Privacy } from '../../src/routes/Privacy'

export function meta() {
  return [
    { title: 'Privacy Policy | Inkwave' },
    { name: 'description', content: 'Privacy policy for Inkwave Solo and the Citation Capture browser extension.' },
    { tagName: 'link', rel: 'canonical', href: 'https://iwsolo.me/privacy' },
  ]
}

export default function PrivacyRoute() {
  return <Privacy />
}
