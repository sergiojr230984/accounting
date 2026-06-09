import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import pkg from "../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Railway / Better Uptime.
 *
 * Always returns 200 once the server is up — we never want Railway killing
 * a healthy container just because Postgres is briefly slow during a
 * rolling deploy. The `status` field in the body still reports degraded
 * if the DB ping fails, so monitors that care can alert on the body.
 *
 * The DB ping is wrapped in a 2-second timeout so this endpoint can't
 * hang indefinitely behind a slow connection.
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
      const rolePromise = prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
      const rows = await Promise.race([
        rolePromise.catch(() => [] as { current_user: string }[]),
        new Promise<{ current_user: string }[]>((resolve) => setTimeout(() => resolve([]), 1000)),
      ]);
      dbRole = rows[0]?.current_user ?? null;
    } catch {
      dbRole = null;
    }
  }

  const integrations = {
    sentryServer: Boolean(process.env.SENTRY_DSN),
    sentryBrowser: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    email: Boolean(process.env.RESEND_API_KEY),
    aiExtraction: Boolean(process.env.ANTHROPIC_API_KEY),
    appUrl: Boolean(process.env.APP_URL),
  };

  const body = {
    status: dbOk ? "ok" : "degraded",
    version: pkg.version,
    uptimeSeconds: Math.round(process.uptime()),
    db: { ok: dbOk, latencyMs: dbLatencyMs, role: dbRole },
    integrations,
    timestamp: new Date().toISOString(),
    checkLatencyMs: Date.now() - startedAt,
  };

  // Always 200 — Railway should not kill a freshly-started container while
  // the DB connection is still warming up. External monitors that care
  // about DB health can check body.status === "degraded".
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
