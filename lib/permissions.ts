// Centralized permission matrix — single source of truth for (role, resource, action) → allow/deny.
// Any new feature defaults to ADMIN-only until explicitly added here.

export type UserRole = "ADMIN" | "MANAGER" | "SALES";

const matrix: Record<string, Record<string, UserRole[]>> = {
  customer_invoice: {
    read:   ["ADMIN", "MANAGER", "SALES"],
    create: ["ADMIN", "MANAGER", "SALES"],
    update: ["ADMIN", "MANAGER", "SALES"],
    delete: ["ADMIN", "MANAGER"],
    void:   ["ADMIN", "MANAGER"],
    export: ["ADMIN", "MANAGER"],
  },
  supplier_invoice: {
    read:   ["ADMIN", "MANAGER"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    delete: ["ADMIN", "MANAGER"],
    void:   ["ADMIN", "MANAGER"],
    export: ["ADMIN", "MANAGER"],
  },
  customer: {
    read:   ["ADMIN", "MANAGER", "SALES"],
    create: ["ADMIN", "MANAGER", "SALES"],
    update: ["ADMIN", "MANAGER", "SALES"],
    delete: ["ADMIN", "MANAGER"],
    void:   ["ADMIN"],
    export: ["ADMIN", "MANAGER"],
  },
  supplier: {
    read:   ["ADMIN", "MANAGER"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    delete: ["ADMIN", "MANAGER"],
    void:   ["ADMIN"],
    export: ["ADMIN", "MANAGER"],
  },
  report_income_expense: {
    read:   ["ADMIN", "MANAGER"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN", "MANAGER"],
  },
  // P&L, Balance Sheet, Cash Flow — Admin only
  report_financial: {
    read:   ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN"],
  },
  settings: {
    read:   ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN"],
  },
  users: {
    read:   ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN"],
  },
  audit_log: {
    read:   ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN"],
  },
  backups: {
    read:   ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN"],
  },
  contractor_tin: {
    read:   ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN"],
  },
  report_1099: {
    read:   ["ADMIN"],
    create: ["ADMIN"],
    update: ["ADMIN"],
    delete: ["ADMIN"],
    void:   ["ADMIN"],
    export: ["ADMIN"],
  },
};

export function can(role: UserRole, resource: string, action: string): boolean {
  return matrix[resource]?.[action]?.includes(role) ?? false;
}

export function getRole(session: { user?: { role?: string } } | null): UserRole | null {
  const role = session?.user?.role;
  if (!role) return null;
  return role as UserRole;
}

export function requirePermission(
  session: { user?: { role?: string } } | null,
  resource: string,
  action: string
): { allowed: boolean; role: UserRole | null } {
  const role = getRole(session);
  if (!role) return { allowed: false, role: null };
  return { allowed: can(role, resource, action), role };
}

export function isAdmin(session: { user?: { role?: string } } | null): boolean {
  return getRole(session) === "ADMIN";
}

export function isManagerOrAbove(session: { user?: { role?: string } } | null): boolean {
  const role = getRole(session);
  return role === "ADMIN" || role === "MANAGER";
}
