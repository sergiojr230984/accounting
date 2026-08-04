import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initializeDatabase } from "@/lib/init-db";
import { requireRole } from "@/lib/api";
import { generateApiKey } from "@/lib/api-key";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import { z } from "zod";

const createSchema = z.object({
  label: z.string().min(1, "A label is required, e.g. \"Power BI dashboard\""),
});

export async function GET() {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;
  await initializeDatabase();
  const keys = await prisma.apiKey.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      label: true,
      keyPrefix: true,
      active: true,
      createdByName: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json(keys);
}

export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (guard instanceof NextResponse) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await initializeDatabase();

  const { fullKey, keyHash, keyPrefix } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      label: parsed.data.label,
      keyHash,
      keyPrefix,
      createdById: guard.user.id,
      createdByName: guard.user.name ?? guard.user.email ?? "unknown",
    },
    select: { id: true, label: true, keyPrefix: true, createdAt: true },
  });

  await writeAuditLog({
    ...actorFromSession(guard),
    action: "CREATE",
    entityType: "api_key",
    entityId: created.id,
    entityLabel: `API key "${created.label}"`,
    ...extractMeta(request),
  });

  // The only point in this key's lifetime the full value is ever available
  // -- only its hash is persisted, so it cannot be shown again after this
  // response. The client must copy it now or generate a new one later.
  return NextResponse.json({ ...created, key: fullKey }, { status: 201 });
}
