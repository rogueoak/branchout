// The rooms home on the insider surface (feedback 0029). The insider host rewrites `/rooms` into
// this `/insider/rooms` route, so an insider hosts and plays without leaving the insider subdomain.
// The apex page is surface-aware (it reads the request host), so re-exporting it serves the same
// flow here while the insider layout keeps this tree gated to insiders.
export { default } from '../../rooms/page';
