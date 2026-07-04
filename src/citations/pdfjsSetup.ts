// Lazy pdf.js loader. Imported only when a PDF panel actually opens, so pdfjs-dist (large) never
// enters the main/prerender bundle. Wires the same-origin worker once (CSP worker-src 'self' blob:).

type Pdfjs = typeof import('pdfjs-dist')

let libPromise: Promise<Pdfjs> | null = null

export function getPdfjs(): Promise<Pdfjs> {
  if (!libPromise) {
    libPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      // Official viewer CSS drives text-layer positioning/selection (scale-factor vars etc.).
      await import('pdfjs-dist/web/pdf_viewer.css')
      // Vite emits the worker as an asset and gives us its URL via the ?url suffix.
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return libPromise
}
