// The room page on the insider surface (feedback 0028). The insider host rewrites `/rooms/[code]`
// into this route, so the lobby, setup, and running game all stay on the insider subdomain. The apex
// page reads the request host to gate the picker to insider games, so re-exporting it is enough; the
// insider layout keeps this tree gated to insiders.
export { default } from '../../../rooms/[code]/page';
