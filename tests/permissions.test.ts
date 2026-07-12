import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";
import { TEST_SALES_PASSWORD } from "./setup/seed-test-fixtures";

/**
 * RBAC boundary tests. Roles: ADMIN, MANAGER, SALES.
 * sales1/sales2 are two independent salespeople, each with their own
 * Employee record and their own customer invoice (see seed-test-fixtures.ts),
 * used to test horizontal access between salespeople as well as vertical
 * access against admin-only resources.
 */

let admin: TestSession;
let manager: TestSession;
let sales1: TestSession;
let sales2: TestSession;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  manager = await loginAs("manager@lacuevita.com", "manager123");
  sales1 = await loginAs("sales1@test.local", TEST_SALES_PASSWORD);
  sales2 = await loginAs("sales2@test.local", TEST_SALES_PASSWORD);
});

describe("vertical access control — admin-only routes correctly reject lower roles", () => {
  const adminOnlyRoutes = [
    "/api/admin/users",
    "/api/admin/1099",
    "/api/admin/audit-log",
    "/api/admin/backups",
    "/api/admin/export",
    "/api/admin/employees",
  ];

  for (const route of adminOnlyRoutes) {
    it(`SALES is rejected from ${route}`, async () => {
      const { status } = await sales1.getJson(route);
      expect(status).toBe(403);
    });
    it(`MANAGER is rejected from ${route}`, async () => {
      const { status } = await manager.getJson(route);
      expect(status).toBe(403);
    });
  }

  it("MANAGER is rejected from the Admin-only profit-loss report", async () => {
    const { status } = await manager.getJson("/api/reports?type=profit-loss");
    expect(status).toBe(403);
  });

  it("MANAGER IS allowed the income report (Admin+Manager tier)", async () => {
    const { status } = await manager.getJson("/api/reports?type=income");
    expect(status).toBe(200);
  });
});

describe("horizontal access control — one salesperson vs another's invoice", () => {
  it("sales1 cannot read sales2's invoice by ID", async () => {
    const { status } = await sales1.getJson("/api/invoices/customer/inv-fixture-sales2");
    expect(status).toBe(403);
  });

  it("sales1 cannot edit sales2's invoice", async () => {
    const { status } = await sales1.postJson(
      "/api/invoices/customer/inv-fixture-sales2",
      { commissionRate: "0.99" },
      "PATCH"
    );
    expect(status).toBe(403);
  });

  it("sales1's invoice list does not include sales2's invoice", async () => {
    const { body } = await sales1.getJson<{ invoices: { invoiceNumber: string }[] }>(
      "/api/invoices/customer?limit=50"
    );
    const numbers = body.invoices.map((i) => i.invoiceNumber);
    expect(numbers).not.toContain("FIXTURE-S2-001");
  });

  // Documents a real gap found in the companion RBAC audit: the upload route
  // never checks that the caller has permission on the invoice it's attaching
  // to, even though read/edit on that same invoice are correctly blocked above.
  it.fails("sales1 should not be able to attach a file to sales2's invoice", async () => {
    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "test.pdf");
    form.append("customerInvoiceId", "inv-fixture-sales2");
    const res = await sales1.fetch("/api/upload", { method: "POST", body: form });
    expect(res.status).toBe(403); // currently 201 — no ownership check exists on this route
  });
});

describe("vertical access control — known bypasses (documented, not silently accepted)", () => {
  // Documents a real gap found in the companion RBAC audit: lib/permissions.ts
  // restricts customer.delete to ADMIN/MANAGER, but the route never calls
  // requirePermission — only checks that a session exists.
  it.fails("SALES should not be able to delete a customer", async () => {
    const created = await admin.postJson<{ id: string }>("/api/customers", {
      name: "Permission Test Customer (safe to delete)",
    });
    const { status } = await sales1.postJson(`/api/customers/${created.body.id}`, {}, "DELETE");
    expect(status).toBe(403); // currently 200 — no permission check on this route
  });

  // Documents a real gap found in the companion RBAC audit: the collection
  // route (list/create) for supplier invoices has no permission check at all,
  // unlike its own [id] sibling route, which is correctly gated.
  it.fails("SALES should not be able to list supplier bills (AP ledger)", async () => {
    const { status } = await sales1.getJson("/api/invoices/supplier");
    expect(status).toBe(403); // currently 200
  });

  it.fails("SALES should not be able to create a supplier bill", async () => {
    const suppliers = await admin.getJson<{ id: string }[]>("/api/suppliers");
    const supplierId = suppliers.body[0]?.id;
    const { status } = await sales1.postJson("/api/invoices/supplier", {
      supplierId,
      invoiceNumber: `PERM-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      category: "COGS",
      items: [{ description: "should be rejected", quantity: "1", unitCost: "1" }],
    });
    expect(status).toBe(403); // currently 201 — a real bill gets created
  });

  // Documents a real gap found in the companion RBAC audit: /api/dashboard
  // never checks role, despite the same data being Admin/Manager-restricted
  // everywhere else via report_financial / report_income_expense.
  it.fails("SALES should not see the company-wide P&L on the dashboard", async () => {
    const { status } = await sales1.getJson("/api/dashboard");
    expect(status).toBe(403); // currently 200
  });

  // Documents a real gap found in the companion RBAC audit: "employees" is not
  // a resource in lib/permissions.ts's matrix at all, so commissionRate — a
  // payroll-adjacent field — is returned to every authenticated role.
  it.fails("SALES should not see other employees' commission rates", async () => {
    const { status, body } = await sales1.getJson<{ commissionRate: string }[]>("/api/employees");
    const anyHasCommission = body?.some((e) => "commissionRate" in e);
    expect(status === 403 || !anyHasCommission).toBe(true); // currently 200 with commissionRate included
  });
});

describe("unauthenticated / no-role access — should never reach a data-touching handler", () => {
  it.fails("/api/debug should require authentication", async () => {
    const { anonymousSession } = await import("./helpers/client");
    const res = await anonymousSession().fetch("/api/debug");
    expect(res.status).not.toBe(200); // currently 200 with no session at all
  });

  it.fails("/api/test-db should require a valid session, not just a cookie with the right name", async () => {
    const { anonymousSession } = await import("./helpers/client");
    const res = await anonymousSession().fetch("/api/test-db", {
      headers: { Cookie: "authjs.session-token=not-a-real-jwt" },
    });
    expect(res.status).toBe(401); // currently 200 — middleware only checks cookie presence
  });
});
