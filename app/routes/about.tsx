import { About } from '../../src/routes/About'

export function meta() {
  return [
    { title: 'About Inkwave Zero | Inkwave Zero' },
    {
      name: 'description',
      content:
        'About Inkwave Zero by Inkwave Zero — a calm writing surface for STEM and philosophy students. Vocabulary constraints help you develop authorial voice while building a tamper-evident, Bitcoin-anchored provenance record of your work.',
    },
    { tagName: 'link', rel: 'canonical', href: 'https://iwzero.me/about' },
    { property: 'og:title', content: 'About Inkwave Zero | Inkwave Zero' },
    { property: 'og:description', content: 'A calm writing surface for academic and philosophical writing by Inkwave Zero. Words that stray glow — cycle synonyms to develop your voice. Provenance anchored to Bitcoin.' },
    { property: 'og:url', content: 'https://iwzero.me/about' },
    { property: 'og:type', content: 'website' },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: 'About Inkwave Zero',
        url: 'https://iwzero.me/about',
        description:
          'Learn about Inkwave Zero by Inkwave Zero — a calm writing surface with stochastic vocabulary constraints and Bitcoin-anchored provenance.',
        publisher: { '@type': 'Organization', name: 'Inkwave Zero', url: 'https://iwzero.me' },
      },
    },
  ]
}

export default function AboutRoute() {
  return <About />
}
