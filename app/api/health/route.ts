import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Bulletproof Railway healthcheck. No imports beyond NextResponse, no DB
 * queries, no awaits, no module side-effects. The only way this fails is
 * if the HTTP server itself isn't listening — which is exactly what
 * Railway's healthcheck is supposed to detect.
 *
 * Detailed health (DB latency, integration status, etc.) lives at
 * /api/health/full and is what Better Uptime / status pages should hit.
 */
export function GET() {
  return new NextResponse(JSON.stringify({ ok: true, ts: Date.now() }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
