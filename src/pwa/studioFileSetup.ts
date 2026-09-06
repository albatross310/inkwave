export const STUDIO_FILE_SETUP_TIP =
  'Open .studio files in one click: install Inkwave PWA, then make it the default app for .studio files.'

export const STUDIO_FILE_SETUP_MAC = [
  'Install Inkwave PWA from desktop Chrome’s app-install menu.',
  'In Finder, select a .studio file and press Command-I (Get Info).',
  'Under Open with, choose Inkwave PWA, then choose Change All and Continue.',
] as const

export const STUDIO_FILE_SETUP_WINDOWS = [
  'Install Inkwave PWA from desktop Chrome’s app-install menu.',
  'Right-click a .studio file and choose Open with, then Choose another app.',
  'Choose Inkwave PWA and select Always.',
] as const
