import { Edit } from '../../src/routes/Edit'

export function meta() {
  return [
    { title: 'Inkwave Solo — Writing That Remembers | Inkwave Writing Studio' },
    {
      name: 'description',
      content:
        'Inkwave Solo by Inkwave Writing Studio — a calm writing environment for STEM and philosophy students. Words that stray from your vocabulary glow purple; cycle synonyms until every sentence is yours. Bitcoin-anchored provenance. No sign-up.',
    },
    { name: 'keywords', content: 'Inkwave Solo, Inkwave Writing Studio, academic writing, distraction-free writing, provenance, vocabulary constraints, philosophy writing, STEM writing' },
    { tagName: 'link', rel: 'canonical', href: 'https://iwsolo.me/' },
    { property: 'og:title', content: 'Inkwave Solo — Writing That Remembers | Inkwave Writing Studio' },
    { property: 'og:description', content: 'A calm writing environment for academic and philosophical writing by Inkwave Writing Studio. Words that stray glow — cycle synonyms to own every sentence. Bitcoin-anchored provenance. No sign-up.' },
    { property: 'og:url', content: 'https://iwsolo.me/' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:title', content: 'Inkwave Solo — Writing That Remembers | Inkwave Writing Studio' },
    { name: 'twitter:description', content: 'Calm academic writing by Inkwave Writing Studio. Words that stray glow — cycle synonyms to own every sentence. No sign-up, no dashboard.' },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Inkwave Solo',
        alternateName: 'Inkwave Writing Studio',
        url: 'https://iwsolo.me',
        description:
          'Inkwave Solo by Inkwave Writing Studio — a calm, distraction-free writing surface for academic and philosophical writing with vocabulary constraints and Bitcoin-anchored provenance.',
        applicationCategory: 'WritingApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires a modern web browser',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@type': 'Organization', name: 'Inkwave Writing Studio', url: 'https://iwsolo.me' },
      },
    },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: 'https://iwsolo.me',
        name: 'Inkwave Solo',
        alternateName: 'Inkwave Writing Studio',
        publisher: { '@type': 'Organization', name: 'Inkwave Writing Studio', url: 'https://iwsolo.me' },
      },
    },
  ]
}

// The editor is the landing page. It renders a prerendered empty-editor shell (static HTML,
// styled by the same CSS as the live editor), then mounts the real Tiptap editor client-side.
export default function Home() {
  return <Edit />
}
