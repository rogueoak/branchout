// The join-by-code page on the insider surface (feedback 0028). The insider host rewrites `/join`
// into this route, so a shared insider room link resolved against the insider origin stays on the
// insider subdomain (only insiders can open it - the insider layout gates the rest). The apex page's
// default and its share-card metadata are surface-agnostic, so re-exporting both is enough.
export { default, generateMetadata } from '../../join/page';
