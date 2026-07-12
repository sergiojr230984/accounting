import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";

/**
 * This file is not a conventional pass/fail suite — it's a living inventory.
 * Each block asserts whether a requested business-critical workflow actually
 * has a working route today. Where a workflow doesn't exist, the assertion
 * documents that absence (e.g. expecting 404) so that if someone builds the
 * feature later without adding real tests for it, this file breaks loudly —
 * a deliberate tripwire, not a bug in this test file.
 */

let admin: TestSession;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
});

describe("workflows confirmed present and covered elsewhere in this suite", () => {
  it("login/logout — see auth.test.ts", () => expect(true).toBe(true));
  it("user permissions (RBAC) — see permissions.test.ts", () => expect(true).toBe(true));
  it("customer creation — POST /api/customers", async () => {
    const { status } = await admin.postJson("/api/customers", { name: "Coverage Check Customer" });
    expect(status).toBe(201);
  });
  it("supplier creation — POST /api/suppliers", async () => {
    const { status } = await admin.postJson("/api/suppliers", { name: "Coverage Check Supplier" });
    expect(status).toBe(201);
  });
  it("customer invoice creation — see invoices.test.ts", () => expect(true).toBe(true));
  it("invoice editing restrictions — exist as a route, but the restriction itself is missing (see invoices.test.ts, it.fails)", () =>
    expect(true).toBe(true));
  it("partial/full payments — exist as a paidAmount field edit, not a real ledger (see invoices.test.ts)", () =>
    expect(true).toBe(true));
  it("bill (supplier invoice) creation — POST /api/invoices/supplier", async () => {
    const suppliers = await admin.getJson<{ id: string }[]>("/api/suppliers");
    const supplierId = suppliers.body[0]?.id;
    const { status } = await admin.postJson("/api/invoices/supplier", {
      supplierId,
      invoiceNumber: `COVERAGE-BILL-${Date.now()}`,
      invoiceDate: "2026-01-01",
      category: "COGS",
      items: [{ description: "x", quantity: "1", unitCost: "1" }],
    });
    expect(status).toBe(201);
  });
  it("report generation — income/expenses/P&L/outstanding/profitability exist; see report-types below for what's missing", () =>
    expect(true).toBe(true));
  it("file uploads — exist, with real vulnerabilities (see uploads.test.ts)", () => expect(true).toBe(true));
});

describe("workflows that do not exist at all — no route, no feature, zero test coverage possible", () => {
  it("password reset has no route", async () => {
    // /api/auth/* is NextAuth's own catch-all route, which returns 400 for an
    // unrecognized action rather than a bare 404 — still confirms no reset
    // flow exists, just via a different status code than a non-NextAuth path.
    const res1 = await admin.fetch("/api/auth/forgot-password", { method: "POST" });
    expect([400, 404, 405]).toContain(res1.status);
    const res2 = await admin.fetch("/api/auth/reset-password", { method: "POST" });
    expect([400, 404, 405]).toContain(res2.status);
    const res3 = await admin.fetch("/api/password-reset", { method: "POST" });
    expect([404, 405]).toContain(res3.status);
  });

  it("there is no company-switching endpoint (the app has no multi-company concept at all)", async () => {
    const res = await admin.fetch("/api/company/switch", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("there is no dedicated product-creation route (products are only silently auto-created from invoice item text)", async () => {
    const res = await admin.fetch("/api/products", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("there is no refund or credit-note route", async () => {
    for (const path of ["/api/refunds", "/api/credit-notes", "/api/invoices/customer/x/refund"]) {
      const res = await admin.fetch(path, { method: "POST" });
      expect(res.status).toBe(404);
    }
  });

  it("there is no purchase-order workflow distinct from directly creating a supplier bill", async () => {
    const res = await admin.fetch("/api/purchase-orders", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("there is no inventory-receiving route (Product has no stock-quantity field at all)", async () => {
    const res = await admin.fetch("/api/inventory/receive", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("there is no inventory-adjustment route", async () => {
    const res = await admin.fetch("/api/inventory/adjust", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("there is no journal-posting route (no general ledger exists in the schema)", async () => {
    const res = await admin.fetch("/api/journal-entries", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("balance sheet, trial balance, and cash flow reports are not implemented", async () => {
    for (const type of ["balance-sheet", "trial-balance", "cash-flow"]) {
      const { status } = await admin.getJson(`/api/reports?type=${type}`);
      expect(status).toBe(400); // falls through to "Unknown report type"
    }
  });

  it("backup restoration does not actually restore anything", async () => {
    const { status, body } = await admin.postJson<{ message?: string }>("/api/admin/backups", {
      action: "restore",
      confirm: "RESTORE",
    });
    // The route responds successfully but only logs the request — it never
    // reads a backup file or writes any data. A real restore-and-verify
    // integration test cannot be written until the underlying feature exists;
    // see the companion database/backup audit's safe test procedure for what
    // that test should look like once it does.
    expect(status).toBe(200);
    expect(body.message ?? "").toMatch(/SETUP\.md|manual/i);
  });

  it("data export (CSV) routes exist in code but currently error due to missing schema fields", async () => {
    const auditLogExport = await admin.fetch("/api/admin/audit-log?export=csv");
    // AuditLog model is absent from the schema entirely — see the
    // production-readiness audit. This assertion documents today's reality
    // rather than asserting the ideal; tighten it once that's fixed.
    expect([200, 500]).toContain(auditLogExport.status);
  });
});
