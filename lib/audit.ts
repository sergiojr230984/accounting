import { prisma } from "@/lib/prisma";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "VOID"
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "EXPORT"
  | "SETTING_CHANGE"
  | "ROLE_CHANGE"
  | "BACKUP_RUN"
  | "BACKUP_RESTORE"
  | "ACCESS_DENIED"
  | "TIN_VIEW";

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
        changes: entry.changes ?? undefined,
        ipAddress: entry.ipAddress ?? "unknown",
        userAgent: entry.userAgent ?? "unknown",
      },
    });
  } catch (err) {
    // Never let an audit failure break the main request
    console.error("[audit] Failed to write log:", err);
  }
}

export function extractMeta(request: Request) {
  return {
    ipAddress:
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
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

export function actorFromSession(session: {
  user?: { id?: string; name?: string | null; role?: string };
} | null) {
  return {
    actorId: session?.user?.id ?? null,
    actorName: session?.user?.name ?? "unknown",
    actorRole: session?.user?.role ?? "unknown",
  };
}
