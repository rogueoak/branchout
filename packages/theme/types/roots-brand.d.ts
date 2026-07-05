// Ambient types for the untyped `@rogueoak/roots/brand` build-time entry (it ships as
// `brand.mjs` with no `.d.ts`). Only the surface this package uses is declared.
declare module '@rogueoak/roots/brand' {
  export interface BuildBrandOptions {
    name: string;
    primitives: string | string[];
    semantic: string;
    semanticDark: string;
    outFile: string;
    scope?: string | null;
  }
  export interface BuildBrandResult {
    outFile: string;
    css: string;
    roles: string[];
    selectors: { light: string; dark: string };
  }
  export function buildBrand(options: BuildBrandOptions): Promise<BuildBrandResult>;
}
