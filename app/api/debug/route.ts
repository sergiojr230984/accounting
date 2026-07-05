import { NextResponse } from "next/server";

export async function GET() {
  const result: Record<string, unknown> = {
    ok: true,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    env: process.env.NODE_ENV,
    nextRuntime: process.env.NEXT_RUNTIME ?? "unknown",
  };

  // Auth secret
  const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  result.hasAuthSecret = authSecret.length > 0;
  result.authSecretLength = authSecret.length;

  // Auth URL
  result.authUrl = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "(not set)";

  // Database URL
  const dbUrl = process.env.DATABASE_URL ?? "";
  result.hasDatabaseUrl = dbUrl.length > 0;
  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      result.dbHost = parsed.hostname;
      result.dbPort = parsed.port;
      result.dbName = parsed.pathname.replace("/", "");
    } catch {
      result.dbUrlParseFailed = true;
    }
  }

  // Live Prisma ping
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    result.dbPing = "ok";
  } catch (e) {
    result.dbPing = "failed";
    result.dbPingError = String(e);
  }

  return NextResponse.json(result);
}
