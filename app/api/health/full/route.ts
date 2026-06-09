import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Detailed health probe — includes DB latency, role, and integration status.
 * Use this for Better Uptime or status page checks, not Railway healthcheck
 * (Railway should hit /api/health which is dependency-free and always 200).
 */
export async function GET() {
  const startedAt = Date.now();

  const dbProbe = (async () => {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return Date.now() - t0;
  })();

  const dbLatencyMs = await Promise.race([
    dbProbe.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
  const dbOk = dbLatencyMs !== null;

  let dbRole: string | null = null;
  if (dbOk) {
    try {
      const rows = (await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`);
      dbRole = rows[0]?.current_user ?? null;
    } catch {
      dbRole = null;
    }
  }

  return NextResponse.json(
    {
      status: dbOk ? "ok" : "degraded",
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
      db: { ok: dbOk, latencyMs: dbLatencyMs, role: dbRole },
      integrations: {
        sentryServer: Boolean(process.env.SENTRY_DSN),
        sentryBrowser: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
        email: Boolean(process.env.RESEND_API_KEY),
        aiExtraction: Boolean(process.env.ANTHROPIC_API_KEY),
        appUrl: Boolean(process.env.APP_URL),
      },
      timestamp: new Date().toISOString(),
      checkLatencyMs: Date.now() - startedAt,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
