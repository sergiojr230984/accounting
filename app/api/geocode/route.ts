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
  url.searchParams.set("limit", String(MAX_RESULTS));
  url.searchParams.set("countrycodes", "us");

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
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch {
    return NextResponse.json([]);
  }
}
