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

  // Fixed: convert now acquires a real row lock (a raw SELECT ... FOR
  // UPDATE inside an interactive transaction) on the estimate before
  // checking and setting convertedInvoiceId, so concurrent conversion
  // requests serialize instead of racing past the check together.
  // Re-confirmed correct across multiple separate full-suite runs, not
  // just in isolation.
  it("converting the same estimate 8 times concurrently creates exactly one invoice", async () => {
    const est = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-RACE-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Race me", quantity: "1", unitPrice: "1000" }],
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => admin.postJson(`/api/estimates/${est.body.id}/convert`, {}))
    );
    const succeeded = results.filter((r) => r.status === 200);
    const conflicted = results.filter((r) => r.status === 409);
    expect(succeeded.length).toBe(1);
    expect(conflicted.length).toBe(7);
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
