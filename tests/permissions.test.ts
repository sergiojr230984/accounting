import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";
import { TEST_SALES_PASSWORD } from "./setup/seed-test-fixtures";

/**
 * `lib/permissions.ts` (the centralized matrix audited on `main`) does not
 * exist on this branch. It was replaced by `lib/api.ts`'s `requireRole()`,
 * applied inconsistently: some resources (users, employees writes, settings,
 * tax rates, reports/frequency) are properly ADMIN-gated; many others
 * (customers, suppliers, dashboard, invoices, uploads, estimates) use only
 * `requireAuth()` / a bare session check, meaning any authenticated role --
 * including SALES -- has full access.
 */

let admin: TestSession;
let manager: TestSession;
let sales1: TestSession;
let sales2: TestSession;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  manager = await loginAs("manager@bizledger.com", "manager123");
  sales1 = await loginAs("sales1@test.local", TEST_SALES_PASSWORD);
  sales2 = await loginAs("sales2@test.local", TEST_SALES_PASSWORD);
});

describe("correctly ADMIN-gated resources", () => {
  it("SALES is rejected from user management", async () => {
    const { status } = await sales1.getJson("/api/users");
    expect(status).toBe(403);
  });
  it("MANAGER is rejected from user management", async () => {
    const { status } = await manager.getJson("/api/users");
    expect(status).toBe(403);
  });
  it("SALES cannot create an employee", async () => {
    const { status } = await sales1.postJson("/api/employees", { name: "x", commissionRate: "0" });
    expect(status).toBe(403);
  });
  it("SALES cannot write company settings", async () => {
    const { status } = await sales1.postJson("/api/settings", { name: "Hacked Co" }, "PATCH");
    expect(status).toBe(403);
  });
  it("SALES cannot create a tax rate", async () => {
    const { status } = await sales1.postJson("/api/settings/taxes", { name: "x", rate: "0.5" });
    expect(status).toBe(403);
  });
  it("SALES is rejected from the frequency report", async () => {
    const { status } = await sales1.getJson("/api/reports/frequency");
    expect(status).toBe(403);
  });
});

describe("previously had no role gate at all -- now fixed", () => {
  it("SALES cannot see the company-wide P&L on the dashboard", async () => {
    const { status } = await sales1.getJson("/api/dashboard");
    expect(status).toBe(403);
  });

  it("SALES cannot delete a customer", async () => {
    const created = await admin.postJson<{ id: string }>("/api/customers", {
      name: "Permission Test Customer (safe to delete)",
    });
    const { status } = await sales1.postJson(`/api/customers/${created.body.id}`, {}, "DELETE");
    expect(status).toBe(403);
  });

  // Fixed: the list itself stays visible to any authenticated role (the
  // "Create Bill" flow, open to every role, needs a supplier picker), but
  // bank account/routing/Zelle details are stripped unless the caller is
  // ADMIN/MANAGER -- same pattern as employees' commissionRate below.
  // Previously this returned 403, which crashed the Suppliers page and the
  // Create Bill page for SALES (both blindly called array methods on the
  // 403's error-object body).
  it("SALES does not see supplier bank account details", async () => {
    await admin.postJson("/api/suppliers", {
      name: "Bank Details Leak Test",
      bankName: "First National",
      bankAccountNumber: "12345678",
      bankRouting: "021000021",
      zelle: "ops@test.local",
    });
    const { status, body } = await sales1.getJson<Record<string, unknown>[]>("/api/suppliers");
    expect(status).toBe(200); // the list itself stays visible (Create Bill supplier picker)
    const anyHasBankDetails = Array.isArray(body) && body.some((s) => "bankName" in s || "bankAccountNumber" in s || "bankRouting" in s || "zelle" in s);
    expect(anyHasBankDetails).toBe(false); // but the sensitive fields are stripped
  });

  it("SALES cannot delete a supplier", async () => {
    const created = await admin.postJson<{ id: string }>("/api/suppliers", {
      name: "Permission Test Supplier (safe to delete)",
    });
    const { status } = await sales1.postJson(`/api/suppliers/${created.body.id}`, {}, "DELETE");
    expect(status).toBe(403);
  });

  it("SALES does not see every employee's commission rate", async () => {
    await admin.postJson("/api/employees", { name: "Commission Leak Test", commissionRate: "0.15" });
    const { status, body } = await sales1.getJson<{ commissionRate: string }[]>("/api/employees");
    expect(status).toBe(200); // the list itself stays visible (invoice-assignment dropdown)
    const anyHasCommission = Array.isArray(body) && body.some((e) => "commissionRate" in e);
    expect(anyHasCommission).toBe(false); // but the sensitive field is stripped
  });

  it("SALES cannot see every employee's commission and sales totals on the performance leaderboard", async () => {
    const { status } = await sales1.getJson("/api/performance");
    expect(status).toBe(403);
  });
});

describe("shared visibility -- this is a company-wide ledger, not per-salesperson silos", () => {
  // seed-test-fixtures.ts links each SALES test account to a same-email
  // Employee row so invoice creation (which auto-assigns employeeId from
  // the caller's own linked record for SALES, for commission attribution)
  // has something real to link to. That attribution no longer restricts
  // who can subsequently see or edit the invoice -- every authenticated
  // role sees and can edit every invoice.
  it("a salesperson can see their own invoice in their own list", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", { name: "Own Invoice Test Co" });
    const inv = await sales1.postJson<{ id: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `OWN-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(inv.status).toBe(201);
    const { body } = await sales1.getJson<{ invoices: { id: string }[] }>("/api/invoices/customer?limit=100");
    expect(body.invoices.map((i) => i.id)).toContain(inv.body.id);
  });

  it("one salesperson's invoice list includes invoices created by another salesperson", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", { name: "Horizontal Test Co" });
    const inv = await sales1.postJson<{ id: string; invoiceNumber: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `HORIZ-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    const { body } = await sales2.getJson<{ invoices: { id: string }[] }>("/api/invoices/customer?limit=100");
    const ids = body.invoices.map((i) => i.id);
    expect(ids).toContain(inv.body.id);
  });

  it("one salesperson can view another salesperson's invoice by id", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", { name: "Horizontal Test Co 3" });
    const inv = await sales1.postJson<{ id: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `HORIZ3-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    const { status } = await sales2.getJson(`/api/invoices/customer/${inv.body.id}`);
    expect(status).toBe(200);
  });

  it("one salesperson can edit an invoice created by another salesperson", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", { name: "Horizontal Test Co 2" });
    const inv = await sales1.postJson<{ id: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `HORIZ2-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    const { status } = await sales2.postJson(`/api/invoices/customer/${inv.body.id}`, { commissionRate: "0.99" }, "PATCH");
    expect(status).toBe(200);
  });

  it("ADMIN and MANAGER see every invoice regardless of who created it", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", { name: "Horizontal Test Co 4" });
    const inv = await sales1.postJson<{ id: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `HORIZ4-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    const asAdmin = await admin.getJson(`/api/invoices/customer/${inv.body.id}`);
    const asManager = await manager.getJson(`/api/invoices/customer/${inv.body.id}`);
    expect(asAdmin.status).toBe(200);
    expect(asManager.status).toBe(200);
  });

  // A SALES login with no same-email Employee row (e.g. never linked by an
  // admin) used to be scoped to a sentinel id that matched nothing, leaving
  // them looking at an empty list. Since invoice visibility is no longer
  // scoped to the caller's own Employee record at all, an unlinked account
  // sees the same company-wide list as everyone else.
  it("an unlinked SALES account still sees the company's invoices, not an empty list", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", { name: "Unlinked Visibility Test Co" });
    const inv = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `UNLINKED-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });

    const email = `unlinked-${Date.now()}@test.local`;
    const password = "unlinkedTest#1pw";
    await admin.postJson("/api/users", { name: "Unlinked Sales", email, password, role: "SALES" });
    const unlinked = await loginAs(email, password);
    const { status, body } = await unlinked.getJson<{ invoices: { id: string }[] }>(
      "/api/invoices/customer?limit=100"
    );
    expect(status).toBe(200);
    expect(body.invoices.map((i) => i.id)).toContain(inv.body.id);
  });
});
