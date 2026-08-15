import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";

// Proxies address-suggestion lookups through our own server instead of the
// browser calling Nominatim (OpenStreetMap) directly. Two real-world
// failure modes with a direct client-side call:
//
// 1. Nominatim's usage policy requires a valid identifying User-Agent or
//    Referer. A browser fetch only sends whatever Referer its current
//    privacy settings/policy allow -- unreliable across devices/browsers,
//    and easy to end up with neither. A server-side request can set an
//    explicit, compliant User-Agent every time.
// 2. Mobile carriers put many customers behind the same public IP
//    (carrier-grade NAT). Nominatim rate-limits by IP, so one carrier's
//    aggregate traffic can get the *entire carrier* throttled or blocked --
//    which silently breaks this for every one of our mobile users on it,
//    with no error visible client-side (a non-ok response just clears the
//    suggestion list). Requesting from our own server's stable IP avoids
//    that entirely.
const MIN_CHARS = 3;
const MAX_RESULTS = 5;
// Cast a wider net upstream than we actually show -- the ranking pass below
// needs real candidates to sort through (e.g. a Miami-Dade match buried at
// position 8) before trimming down to MAX_RESULTS.
const FETCH_LIMIT = 12;

// The whole business is in Florida -- nobody here has ever had a reason to
// invoice someone in another state. Biasing the Nominatim query itself to
// Florida's bounding box (soft bias via viewbox, NOT bounded=1) keeps
// Florida results dominant without hard-excluding a genuine out-of-state
// address if one ever comes up.
// left,top,right,bottom (min_lon,max_lat,max_lon,min_lat)
const FLORIDA_VIEWBOX = "-87.635,31.001,-79.974,24.396";

// Miami-Dade + Broward -- where almost all of our actual customers are.
// Used only to re-rank results after the fact (never to exclude), so a
// real match in, say, Orlando or Tampa still shows up, just lower.
const SOUTH_FLORIDA_BOUNDS = { west: -80.87, north: 26.35, east: -80.05, south: 25.13 };

interface NominatimAddress {
  state?: string;
  [key: string]: unknown;
}

interface NominatimResult {
  lat: string;
  lon: string;
  address?: NominatimAddress;
  [key: string]: unknown;
}

function rank(r: NominatimResult): number {
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

export async function GET(request: Request) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < MIN_CHARS) return NextResponse.json([]);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(FETCH_LIMIT));
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("viewbox", FLORIDA_VIEWBOX);
  // Bias, don't exclude -- bounded=1 would drop every non-Florida result
  // outright, which is one step further than "strongly suggest Florida."

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        // Required by Nominatim's usage policy -- identifies this app and
        // gives them a way to find/contact us if there's a usage issue,
        // rather than relying on whatever Referer a given browser sends.
        "User-Agent": "LaCuevitaAccounting/1.0 (+https://lacuevitafurniture.up.railway.app)",
      },
      // Nominatim results don't need to be fresh to the second, and caching
      // cuts down on repeat lookups for common partial addresses.
      next: { revalidate: 60 },
    });
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();
    const results: NominatimResult[] = Array.isArray(data) ? data : [];
    // Stable sort: South Florida first, then the rest of Florida, then
    // everything else, preserving Nominatim's own relevance ordering within
    // each group.
    const ranked = results
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      .map(({ r }) => r)
      .slice(0, MAX_RESULTS);
    return NextResponse.json(ranked);
  } catch {
    return NextResponse.json([]);
  }
}
