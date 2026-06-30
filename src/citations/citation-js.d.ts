// Minimal type declarations for citation-js (no official @types package).
// We only declare what we actually use; everything else is unknown.

declare module '@citation-js/core' {
  export class Cite {
    constructor(input?: unknown, options?: Record<string, unknown>)
    static async(input: unknown, options?: Record<string, unknown>): Promise<Cite>
    get(options: Record<string, unknown>): unknown
    format(format: string, options?: Record<string, unknown>): string
  }
  export const plugins: {
    config: {
      get(name: string): {
        templates: { add(id: string, xml: string): void }
      }
    }
  }
}

declare module '@citation-js/plugin-bibtex' {
  const _: unknown
  export default _
}

declare module '@citation-js/plugin-csl' {
  const _: unknown
  export default _
}
