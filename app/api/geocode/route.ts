import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { buildQuery, filterAndRank, type NominatimResult } from "@/lib/geocode";

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
//
// The actual ranking/filtering logic (which results are trustworthy enough
// to ever show, and in what order) lives in lib/geocode.ts, unit-tested in
// tests/geocode.test.ts -- kept out of this file so it doesn't need a
// request context or a live network call to test.
const MIN_CHARS = 3;
const MAX_RESULTS = 5;
// Cast a wider net upstream than we actually show -- the ranking pass below
// needs real candidates to sort through (e.g. a Miami-Dade match buried at
// position 8), and filterAndRank() drops non-street-level matches before
// trimming down to MAX_RESULTS.
const FETCH_LIMIT = 12;

// The whole business is in Florida -- nobody here has ever had a reason to
// invoice someone in another state. Hard-bounded (see `bounded=1` below),
// not just a ranking bias: a soft bias still let a same-numbered street in
// another state outrank the real Florida match on a short/ambiguous query,
// which is exactly what was reported ("gives you addresses outside Florida
// even when you chose the right one").
// left,top,right,bottom (min_lon,max_lat,max_lon,min_lat)
const FLORIDA_VIEWBOX = "-87.635,31.001,-79.974,24.396";

export async function GET(request: Request) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < MIN_CHARS) return NextResponse.json([]);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", buildQuery(q));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(FETCH_LIMIT));
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("viewbox", FLORIDA_VIEWBOX);
  url.searchParams.set("bounded", "1");

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
    return NextResponse.json(filterAndRank(results, MAX_RESULTS));
  } catch {
    return NextResponse.json([]);
  }
}
