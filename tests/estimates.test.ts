import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";

/** Estimates are a real feature on this branch, entirely absent on main. */

let admin: TestSession;
let customerId: string;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  const res = await admin.postJson<{ id: string }>("/api/customers", {
    name: "Estimate Test Customer",
  });
  customerId = res.body.id;
});

describe("estimate creation", () => {
  it("computes totals from line items", async () => {
    const { status, body } = await admin.postJson<{ totalAmount: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-TEST-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Consulting", quantity: "2", unitPrice: "150.00" }],
    });
    expect(status).toBe(201);
    expect(Number(body.totalAmount)).toBe(300);
  });

  it("an estimate does not count as revenue until converted", async () => {
    const before = await admin.getJson<{ total: string }>("/api/reports?type=income");
    await admin.postJson("/api/estimates", {
      customerId,
      estimateNumber: `EST-NOREV-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Should not appear in income", quantity: "1", unitPrice: "99999" }],
    });
    const after = await admin.getJson<{ total: string }>("/api/reports?type=income");
    expect(after.body.total).toBe(before.body.total);
  });
});

describe("convert to invoice", () => {
  it("converting an estimate creates a real invoice with matching totals", async () => {
    const est = await admin.postJson<{ id: string; totalAmount: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-CONV-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Convert me", quantity: "1", unitPrice: "500" }],
    });
    const converted = await admin.postJson<{ invoiceId: string }>(
      `/api/estimates/${est.body.id}/convert`,
      {}
    );
    expect(converted.status).toBe(200);
    const invoice = await admin.getJson<{ totalAmount: string }>(
      `/api/invoices/customer/${converted.body.invoiceId}`
    );
    expect(Number(invoice.body.totalAmount)).toBe(Number(est.body.totalAmount));
  });

  // Confirmed via code review: convert does a plain findUnique + null-check
  // on convertedInvoiceId with no transaction or row lock. Two concurrent
  // convert requests can both pass the check and both create a real invoice
  // -- duplicate revenue booked from a single estimate.
  it.fails("converting the same estimate twice concurrently should not create two invoices", async () => {
    const est = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-RACE-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Race me", quantity: "1", unitPrice: "1000" }],
    });

    // A 2-request race doesn't reliably overlap at the DB layer against a
    // fast local server; widen it the same way the invoice-numbering and
    // payment-ledger race tests do, so the check-then-act window is
    // actually likely to be hit.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => admin.postJson(`/api/estimates/${est.body.id}/convert`, {}))
    );
    const succeeded = results.filter((r) => r.status === 200);
    expect(succeeded.length).toBe(1); // currently can be >1 -- multiple requests create an invoice
  });

  it("converting an already-converted estimate a second time (sequentially) is rejected", async () => {
    const est = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-SEQ-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    const first = await admin.postJson(`/api/estimates/${est.body.id}/convert`, {});
    expect(first.status).toBe(200);
    const second = await admin.postJson(`/api/estimates/${est.body.id}/convert`, {});
    expect(second.status).not.toBe(200); // sequential double-conversion is correctly blocked
  });
});
