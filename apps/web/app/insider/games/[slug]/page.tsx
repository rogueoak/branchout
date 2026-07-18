// The per-game feature page on the insider surface (spec 0030). The insider host rewrites
// `/games/[slug]` into this `/insider/games/[slug]` route, so an insider reads a game's page (public
// OR insider-only) without leaving the insider subdomain. The apex page is surface-aware - it reads
// the request host and resolves an insider game only on the insider surface, and is `noindex` there -
// so re-exporting its default and metadata serves the same page here, while the insider layout keeps
// this tree gated to insiders.
export { default, generateMetadata } from '../../../games/[slug]/page';
