import { Edit } from '../../src/routes/Edit'

export function meta() {
  return [
    { title: 'Inkwave Solo — Calm Writing for Serious Thinking' },
    {
      name: 'description',
      content:
        'A distraction-free writing surface for academic and philosophical writing. Words that stray from your vocabulary glow purple — cycle synonyms until every sentence is yours. No sign-up, no dashboard.',
    },
    { tagName: 'link', rel: 'canonical', href: 'https://iwsolo.me/' },
    { property: 'og:title', content: 'Inkwave Solo — Calm Writing for Serious Thinking' },
    { property: 'og:description', content: 'Calm, focused writing for STEM and philosophy students. Words that stray glow — cycle synonyms to own every sentence. No sign-up.' },
    { property: 'og:url', content: 'https://iwsolo.me/' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:title', content: 'Inkwave Solo — Calm Writing for Serious Thinking' },
    { name: 'twitter:description', content: 'Calm academic writing. Words that stray glow — cycle synonyms to own every sentence. No sign-up, no dashboard.' },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Inkwave Solo',
        url: 'https://iwsolo.me',
        description:
          'A calm, distraction-free writing surface for academic and philosophical writing with vocabulary constraints and Bitcoin-anchored provenance.',
        applicationCategory: 'WritingApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires a modern web browser',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@type': 'Organization', name: 'Inkwave', url: 'https://iwsolo.me' },
      },
    },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: 'https://iwsolo.me',
        name: 'Inkwave Solo',
      },
    },
  ]
}

// The editor is the landing page. It renders a prerendered empty-editor shell (static HTML,
// styled by the same CSS as the live editor), then mounts the real Tiptap editor client-side.
export default function Home() {
  return <Edit />
}
