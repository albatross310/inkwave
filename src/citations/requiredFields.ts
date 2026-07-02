// Shared type labels and required-field lists used by the app edit dialog, extension
// background (to compute missing fields), and the in-page capture panel.

export const ITEM_TYPE_LABELS: Record<string, string> = {
  'article-journal':   'Journal article',
  'webpage':           'Webpage',
  'post-weblog':       'Blog post',
  'article-newspaper': 'News article',
  'book':              'Book',
  'chapter':           'Book chapter',
  'paper-conference':  'Conference paper',
  'thesis':            'Thesis / Dissertation',
  'report':            'Report',
  'video':             'Video',
  'motion_picture':    'Video / Film',
  'broadcast':         'TV / Radio broadcast',
  'song':              'Song / Album',
  'graphic':           'Image / Artwork',
  'legal_case':        'Legal case',
  'legislation':       'Legislation',
  'dataset':           'Dataset',
  'article-magazine':  'Magazine article',
}

// Fields that at least one major style (APA 7, MLA 9, Chicago 17) marks required.
// Keys match CSL field names as used in CSLItem; 'year' is handled separately
// (stored in item.issued, not a flat key) so background.ts checks it via issued?.date-parts.
export const REQUIRED_BY_TYPE: Record<string, string[]> = {
  'article-journal':   ['author', 'title', 'container-title', 'year', 'volume', 'page'],
  'webpage':           ['title', 'URL'],
  'post-weblog':       ['author', 'title', 'year', 'URL'],
  'article-newspaper': ['author', 'title', 'container-title', 'year'],
  'article-magazine':  ['author', 'title', 'container-title', 'year'],
  'book':              ['author', 'title', 'publisher', 'year'],
  'chapter':           ['author', 'title', 'container-title', 'publisher', 'year', 'page'],
  'paper-conference':  ['author', 'title', 'event-title', 'year'],
  'thesis':            ['author', 'title', 'genre', 'publisher', 'year'],
  'report':            ['author', 'title', 'publisher', 'year'],
  'video':             ['author', 'title', 'year'],
  'motion_picture':    ['author', 'title', 'year'],
  'broadcast':         ['title', 'publisher', 'year'],
  'song':              ['author', 'title', 'year'],
  'dataset':           ['author', 'title', 'year', 'URL'],
}

// Human-readable labels for CSL field keys used in warning messages.
export const FIELD_LABELS: Record<string, string> = {
  author:          'Author',
  title:           'Title',
  'container-title': 'Journal / Publisher',
  year:            'Year',
  volume:          'Volume',
  page:            'Pages',
  URL:             'URL',
  publisher:       'Publisher / Institution',
  'event-title':   'Conference name',
  genre:           'Degree type',
  DOI:             'DOI',
  issue:           'Issue',
  accessed:        'Date accessed',
}

/**
 * Given a CSLItem (or partial), return the required field keys that are absent.
 * 'year' is checked via issued['date-parts'], not a flat key.
 */
export function missingRequiredFields(
  type: string,
  item: Record<string, unknown>,
  extractedFields?: Record<string, { value?: string } | undefined>,
): string[] {
  const required = REQUIRED_BY_TYPE[type] ?? []
  return required.filter(f => {
    if (f === 'year') {
      const issued = item.issued as { 'date-parts'?: number[][] } | undefined
      return !issued?.['date-parts']?.[0]?.[0]
    }
    if (item[f]) return false
    if (extractedFields?.[f]?.value) return false
    return true
  })
}
