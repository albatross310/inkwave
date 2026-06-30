import { Verify } from '../../src/routes/Verify'

export function meta() {
  return [
    { title: 'Verify a Record · Inkwave Solo' },
    {
      name: 'description',
      content:
        'Verify an Inkwave provenance record entirely in your browser — checked against the published Ed25519 signing key and Bitcoin timestamps. No sign-in required.',
    },
    { tagName: 'link', rel: 'canonical', href: 'https://inkwave.me/verify' },
    { property: 'og:title', content: 'Verify an Inkwave Provenance Record' },
    { property: 'og:description', content: 'Open, client-side verification of Inkwave writing records. Checked against the published signing key and Bitcoin — no sign-in, nothing uploaded.' },
    { property: 'og:url', content: 'https://inkwave.me/verify' },
    { property: 'og:type', content: 'website' },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Verify an Inkwave Provenance Record',
        url: 'https://inkwave.me/verify',
        description: 'Verify an Inkwave writing record against the published Ed25519 signing key and Bitcoin timestamps, entirely in your browser.',
      },
    },
  ]
}

export default function VerifyRoute() {
  return <Verify />
}
