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

describe("resources with no role gate at all -- any authenticated role has full access", () => {
  it.fails("SALES should not see the company-wide P&L on the dashboard", async () => {
    const { status } = await sales1.getJson("/api/dashboard");
    expect(status).toBe(403); // currently 200
  });

  it.fails("SALES should not be able to delete a customer", async () => {
    const created = await admin.postJson<{ id: string }>("/api/customers", {
      name: "Permission Test Customer (safe to delete)",
    });
    const { status } = await sales1.postJson(`/api/customers/${created.body.id}`, {}, "DELETE");
    expect(status).toBe(403); // currently 200
  });

  // Regression vs. main: on main, suppliers/[id] was one of the
  // *correctly*-gated routes (via the now-removed lib/permissions.ts). On
  // this branch every supplier handler -- including DELETE, and including
  // read access to bank account/routing/Zelle fields -- has zero role check.
  it.fails("SALES should not see supplier bank account details", async () => {
    const { status } = await sales1.getJson("/api/suppliers");
    expect(status).toBe(403); // currently 200, full bank details included
  });

  it.fails("SALES should not be able to delete a supplier", async () => {
    const created = await admin.postJson<{ id: string }>("/api/suppliers", {
      name: "Permission Test Supplier (safe to delete)",
    });
    const { status } = await sales1.postJson(`/api/suppliers/${created.body.id}`, {}, "DELETE");
    expect(status).toBe(403); // currently 200
  });

  it.fails("SALES should not see every employee's commission rate", async () => {
    await admin.postJson("/api/employees", { name: "Commission Leak Test", commissionRate: "0.15" });
    const { status, body } = await sales1.getJson<{ commissionRate: string }[]>("/api/employees");
    const anyHasCommission = Array.isArray(body) && body.some((e) => "commissionRate" in e);
    expect(status === 403 || !anyHasCommission).toBe(true); // currently 200 with commissionRate included
  });

  it.fails("SALES should not see every employee's commission and sales totals on the performance leaderboard", async () => {
    const { status } = await sales1.getJson("/api/performance");
    expect(status).toBe(403); // currently 200, company-wide leaderboard visible to any role
  });
});

describe("horizontal isolation between two salespeople -- removed vs. main", () => {
  // On main, a SALES user was correctly scoped to only their own invoices
  // via an Employee-linked email match. On this branch, User has no
  // relation to Employee at all -- there is no per-salesperson scoping
  // concept anywhere, confirmed by code review. Both tests below prove it.
  it.fails("one salesperson's invoice list should not include invoices created by another salesperson", async () => {
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
    expect(ids).not.toContain(inv.body.id); // currently included -- every SALES user sees every invoice
  });

  it.fails("one salesperson should not be able to edit an invoice created by another salesperson", async () => {
    const customer = await admin.postJson<{ id: string }>("/api/customers", { name: "Horizontal Test Co 2" });
    const inv = await sales1.postJson<{ id: string }>("/api/invoices/customer", {
      customerId: customer.body.id,
      invoiceNumber: `HORIZ2-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    const { status } = await sales2.postJson(`/api/invoices/customer/${inv.body.id}`, { commissionRate: "0.99" }, "PATCH");
    expect(status).toBe(403); // currently 200 -- no role check on this PATCH at all
  });
});
