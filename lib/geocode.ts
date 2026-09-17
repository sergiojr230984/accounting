// Pure helpers behind /api/geocode's Florida address-suggestion ranking and
// filtering. Split out from the route handler itself (which also needs
// requireAuth() from lib/api.ts and makes the actual Nominatim call) purely
// so this logic -- the part that actually determines which suggestions are
// trustworthy enough to ever show a user -- can be unit-tested without
// spinning up a request context or a network call. See tests/geocode.test.ts.

export interface NominatimAddress {
  house_number?: string;
  road?: string;
  state?: string;
  [key: string]: unknown;
}

export interface NominatimResult {
  lat: string;
  lon: string;
  address?: NominatimAddress;
  [key: string]: unknown;
}

// Miami-Dade + Broward -- where almost all of our actual customers are.
// Used only to re-rank results after the fact (never to exclude), so a
// real match in, say, Orlando or Tampa still shows up, just lower.
const SOUTH_FLORIDA_BOUNDS = { west: -80.87, north: 26.35, east: -80.05, south: 25.13 };

export function rank(r: NominatimResult): number {
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  const inSouthFlorida =
    lat >= SOUTH_FLORIDA_BOUNDS.south &&
    lat <= SOUTH_FLORIDA_BOUNDS.north &&
    lon >= SOUTH_FLORIDA_BOUNDS.west &&
    lon <= SOUTH_FLORIDA_BOUNDS.east;
  if (inSouthFlorida) return 0;
  if (r.address?.state === "Florida") return 1;
  return 2;
}

// A result with no house_number/road is a locality-, postcode-, or POI-level
// match (e.g. plain "Miami, FL" or "33101") rather than an actual street
// address -- Nominatim readily returns these for a short/incomplete query.
// Picking one used to silently save that vague place, not the street the
// user was actually typing, as the customer's address -- which then printed
// verbatim on the invoice/estimate PDF as a "totally different, generic
// address." Filtered out here so the dropdown can never offer one: better
// to show nothing (the user keeps typing, or finishes the address by hand)
// than a plausible-looking suggestion that resolves to the wrong place.
export function isStreetLevel(r: NominatimResult): boolean {
  return Boolean(r.address?.house_number && r.address?.road);
}

// Defense-in-depth on top of the route's `bounded=1` viewbox: a bounding box
// has square corners, so Nominatim's Florida viewbox technically also
// covers a sliver of Georgia and Alabama near the panhandle -- a real
// street address just across that line could otherwise still come back.
// State name (not coordinates) is the authoritative check for "is this
// actually Florida," matching what rank() below already assumes.
export function isFlorida(r: NominatimResult): boolean {
  return r.address?.state === "Florida";
}

// Nominatim's free-text search isn't a true prefix/autocomplete engine -- it
// scores a query against its full address index, and a short or incomplete
// one (e.g. "790 nw 82") often carries no signal at all to prefer a Florida
// match over an identically-numbered street anywhere else in the country.
// Appending a Florida hint to the query itself (on top of the viewbox in the
// route) measurably improves both recall and ranking for partial input.
// Unconditional except when the query already names Florida (so the hint
// isn't doubled) -- this business is 100% Florida (see the route's own
// comment), so there is no real "the user is deliberately typing an
// out-of-state address" case to protect against here, and isFlorida() above
// still has the final say on what's actually shown regardless of what this
// nudges the search toward.
const FLORIDA_HINT_RE = /\bflorida\b|\bfl\b/i;
export function buildQuery(q: string): string {
  return FLORIDA_HINT_RE.test(q) ? q : `${q}, Florida`;
}

// Applied together, in this order, by the route: filter out anything that
// isn't a real, in-Florida street-level match, THEN rank and trim to what's
// actually shown -- filtering after trimming could throw away a real match
// in favor of keeping a vague or out-of-state one that happened to rank
// higher.
export function filterAndRank(results: NominatimResult[], maxResults: number): NominatimResult[] {
  return results
    .filter((r) => isStreetLevel(r) && isFlorida(r))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r)
    .slice(0, maxResults);
}
