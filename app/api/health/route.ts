import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import pkg from "../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness probe. Returns 200 only if the database is reachable.
 * Wire this URL into Better Uptime (or any HTTP monitor) as your health check.
 *
 * Cache-Control: no-store — we never want a stale "OK" answer.
 */
export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = {
    status: dbOk ? "ok" : "degraded",
    version: pkg.version,
    uptimeSeconds: Math.round(process.uptime()),
    db: { ok: dbOk, latencyMs: dbLatencyMs },
    timestamp: new Date().toISOString(),
    checkLatencyMs: Date.now() - startedAt,
  };
  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
