import { About } from '../../src/routes/About'

export function meta() {
  return [
    { title: 'About Inkwave Solo | Inkwave Writing Studio' },
    {
      name: 'description',
      content:
        'About Inkwave Solo by Inkwave Writing Studio — a calm writing surface for STEM and philosophy students. Vocabulary constraints help you develop authorial voice while building a tamper-evident, Bitcoin-anchored provenance record of your work.',
    },
    { tagName: 'link', rel: 'canonical', href: 'https://iwsolo.me/about' },
    { property: 'og:title', content: 'About Inkwave Solo | Inkwave Writing Studio' },
    { property: 'og:description', content: 'A calm writing surface for academic and philosophical writing by Inkwave Writing Studio. Words that stray glow — cycle synonyms to develop your voice. Provenance anchored to Bitcoin.' },
    { property: 'og:url', content: 'https://iwsolo.me/about' },
    { property: 'og:type', content: 'website' },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: 'About Inkwave Solo',
        url: 'https://iwsolo.me/about',
        description:
          'Learn about Inkwave Solo by Inkwave Writing Studio — a calm writing surface with stochastic vocabulary constraints and Bitcoin-anchored provenance.',
        publisher: { '@type': 'Organization', name: 'Inkwave Writing Studio', url: 'https://iwsolo.me' },
      },
    },
  ]
}

export default function AboutRoute() {
  return <About />
}
