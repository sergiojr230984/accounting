import { prisma } from "@/lib/prisma";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "ROLE_CHANGE"
  | "ACCESS_DENIED";

interface AuditEntry {
  actorId?: string | null;
  actorName: string;
  actorRole: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityLabel: string;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Best-effort write to the admin-only ledger. Never throws -- a logging
 * failure must not take down the request it's describing.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: entry.actorId ?? null,
        actorName: entry.actorName,
        actorRole: entry.actorRole,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        entityLabel: entry.entityLabel,
        changes: (entry.changes as object | undefined) ?? undefined,
        ipAddress: entry.ipAddress ?? "unknown",
        userAgent: entry.userAgent ?? "unknown",
      },
    });
  } catch (err) {
    console.error("[audit] Failed to write log:", err);
  }
}

export function extractMeta(request: Request) {
  return {
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown",
    userAgent: request.headers.get("user-agent") ?? "unknown",
  };
}

/** Returns only fields whose JSON representation changed. */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { old: before[key], new: after[key] };
    }
  }
  return changes;
}

/** Accepts both a NextAuth Session and lib/api.ts's AuthedSession/guard shape. */
export function actorFromSession(
  session: {
    user?: { id?: string; name?: string | null; email?: string | null; role?: string };
  } | null
) {
  return {
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? session?.user?.email ?? "unknown",
    actorRole: session?.user?.role ?? "unknown",
  };
}
