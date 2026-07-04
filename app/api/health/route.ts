import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import pkg from "../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Railway health checks. Always returns 200 so Railway
 * marks the deployment as healthy. The `status` field in the body reflects
 * the real DB health ("ok" | "degraded") for monitoring tools.
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
  const integrations = {
    sentryServer: Boolean(process.env.SENTRY_DSN),
    sentryBrowser: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    email: Boolean(process.env.RESEND_API_KEY),
    aiExtraction: Boolean(process.env.ANTHROPIC_API_KEY),
    appUrl: Boolean(process.env.APP_URL),
  };

  // Identify which DB role is being used so you can verify the least-privilege
  // grant switch landed. Returns null if the DB is unreachable.
  let dbRole: string | null = null;
  if (dbOk) {
    try {
      const rows = (await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`);
      dbRole = rows[0]?.current_user ?? null;
    } catch {
      dbRole = null;
    }
  }

  const body = {
    status: dbOk ? "ok" : "degraded",
    version: pkg.version,
    uptimeSeconds: Math.round(process.uptime()),
    db: { ok: dbOk, latencyMs: dbLatencyMs, role: dbRole },
    integrations,
    timestamp: new Date().toISOString(),
    checkLatencyMs: Date.now() - startedAt,
  };
  // Always 200 — Railway uses this endpoint as its health check and marks
  // deployments failed if it gets a non-2xx. DB health is in the body.
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
