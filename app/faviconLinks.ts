/** Browser-tab icons. Development gets a deliberately black-backed seal so a localhost tab can
 * never be mistaken for production; installed-app and production assets remain unchanged. */
export function faviconLinks(development: boolean) {
  if (development) return [
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/fav-local-32.png?v=black-1' },
    { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/fav-local-16.png?v=black-1' },
    { rel: 'icon', type: 'image/png', sizes: '128x128', href: '/fav-local-128.png?v=black-1' },
    { rel: 'icon', type: 'image/png', href: '/fav-local-128.png?v=black-1', sizes: 'any' },
    { rel: 'shortcut icon', type: 'image/png', href: '/fav-local-32.png?v=black-1' },
  ]
  return [
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/fav-32.png?v=20' },
    { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/fav-16.png?v=20' },
    { rel: 'icon', type: 'image/png', sizes: '128x128', href: '/fav-128.png?v=20' },
    { rel: 'icon', href: '/favicon.ico?v=20', sizes: 'any' },
    { rel: 'shortcut icon', href: '/favicon.ico?v=20' },
  ]
}
