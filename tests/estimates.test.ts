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

  // Estimates duplicated the same subtotal-rounding logic as customer/
  // supplier invoices (df34770 fixed it there on 2026-07-12) but never got
  // the fix applied here -- summing full-precision line totals and rounding
  // once at the end can legitimately disagree with the sum of the
  // already-rounded, individually-stored line totals by a cent. Both create
  // and edit now go through the shared lib/money.ts computeLineTotals()
  // helper so this can't be missed again.
  it("estimate subtotal should equal the sum of its own stored line totals", async () => {
    const { body } = await admin.postJson<{ subtotal: string; items: { lineTotal: string }[] }>(
      "/api/estimates",
      {
        customerId,
        estimateNumber: `EST-ROUNDING-${Date.now()}`,
        estimateDate: "2026-01-01",
        items: [
          { description: "a", quantity: "1", unitPrice: "3.335" },
          { description: "b", quantity: "1", unitPrice: "3.335" },
          { description: "c", quantity: "1", unitPrice: "3.335" },
        ],
      }
    );
    const sumOfLines = body.items.reduce((s, i) => s + Number(i.lineTotal), 0);
    expect(Number(body.subtotal)).toBeCloseTo(sumOfLines, 2);
    expect(Number(body.subtotal)).toBe(10.02);
  });

  // Same bug/fix as customer invoices (see tests/invoices.test.ts): the
  // estimateNumber input used to be free-typed, so sorting the list by
  // estimateNumber (a string) descending let a bare-digit number sort below
  // any "EST-..."-prefixed one regardless of actual creation order. The
  // create/edit forms now lock this field to the system-assigned number, but
  // the API still accepts whatever a caller sends -- this keeps the list
  // itself correct regardless.
  it("a just-created estimate with a differently-formatted number still sorts first", async () => {
    const prefixed = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-SORT-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(prefixed.status).toBe(201);

    const bare = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: `${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(bare.status).toBe(201);

    const { body } = await admin.getJson<{ estimates: { id: string }[] }>(
      `/api/estimates?customerId=${customerId}&limit=5`
    );
    expect(body.estimates[0].id).toBe(bare.body.id);
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

describe("next estimate number — a persisted counter, not a MAX() scan over existing rows", () => {
  it("suggests one past the highest existing sequence under the current prefix", async () => {
    const prefix = `EST-${new Date().getFullYear()}-`;
    await admin.postJson("/api/estimates", {
      customerId,
      estimateNumber: `${prefix}9999`,
      estimateDate: "2026-01-01",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });

    const { body } = await admin.getJson<{ nextNumber: string }>("/api/estimates/next-number");
    expect(body.nextNumber).toBe(`${prefix}10000`);
  });

  it("never reissues a number after the estimate that used it is deleted", async () => {
    const prefix = `EST-${new Date().getFullYear()}-`;
    // Deliberately far above whatever sequence other tests in this file
    // reach, so this doesn't collide with them regardless of run order.
    const usedNumber = `${prefix}20000`;
    const created = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: usedNumber,
      estimateDate: "2026-01-01",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(created.status).toBe(201);

    const afterCreate = await admin.getJson<{ nextNumber: string }>("/api/estimates/next-number");
    expect(afterCreate.body.nextNumber).toBe(`${prefix}20001`);

    const del = await admin.postJson(`/api/estimates/${created.body.id}`, {}, "DELETE");
    expect(del.status).toBe(200);

    // A MAX()-scan-based "next number" would drop right back down to 20000
    // the moment the only estimate using it is gone -- the next estimate
    // created would silently reuse a real, previously-issued number.
    const afterDelete = await admin.getJson<{ nextNumber: string }>("/api/estimates/next-number");
    expect(afterDelete.body.nextNumber).toBe(`${prefix}20001`);
    expect(afterDelete.body.nextNumber).not.toBe(usedNumber);
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

describe("applied fees on estimates — same server-side re-derivation as customer invoices", () => {
  let feeId: string;
  const feeRate = 0.1; // 10%

  beforeAll(async () => {
    feeId = `est-fee-${Date.now()}`;
    const { status } = await admin.postJson(
      "/api/settings",
      { customFees: [{ id: feeId, label: "Delivery fee", rate: feeRate }] },
      "PATCH"
    );
    expect(status).toBe(200);
  });

  it("rejects a fee id that isn't a currently configured fee", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-FEE-UNKNOWN-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
      appliedFees: [{ id: "not-a-real-fee", label: "Made-up fee", rate: 0.5, amount: "50" }],
    });
    expect(status).toBe(400);
    expect(body.error).toContain("not a currently configured fee");
  });

  it("rejects an amount above what the configured rate allows, even for a real fee id", async () => {
    // subtotal 100, fee rate 10% -> the true ceiling is $10, no matter what
    // amount the client claims.
    const { status, body } = await admin.postJson<{ error: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-FEE-INFLATED-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
      appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "9999" }],
    });
    expect(status).toBe(400);
    expect(body.error).toContain("exceeds what its configured rate allows");
  });

  it("accepts a legitimate fee within its configured rate's ceiling and includes it in totalAmount", async () => {
    const { status, body } = await admin.postJson<{ subtotal: string; totalAmount: string }>(
      "/api/estimates",
      {
        customerId,
        estimateNumber: `EST-FEE-LEGIT-${Date.now()}`,
        estimateDate: "2026-01-01",
        items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
        appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "10.00" }],
      }
    );
    expect(status).toBe(201);
    expect(Number(body.subtotal)).toBe(100);
    expect(Number(body.totalAmount)).toBe(110); // 100 subtotal + 10 fee
  });

  it("rejects an inflated fee amount added via PATCH too", async () => {
    const created = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-FEE-PATCH-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
    });
    const { status, body } = await admin.postJson<{ error: string }>(
      `/api/estimates/${created.body.id}`,
      { appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "9999" }] },
      "PATCH"
    );
    expect(status).toBe(400);
    expect(body.error).toContain("exceeds what its configured rate allows");
  });

  it("accepts a legitimate fee added via PATCH and recomputes totalAmount", async () => {
    const created = await admin.postJson<{ id: string }>("/api/estimates", {
      customerId,
      estimateNumber: `EST-FEE-PATCH-OK-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
    });
    const { status, body } = await admin.postJson<{ totalAmount: string }>(
      `/api/estimates/${created.body.id}`,
      { appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "10.00" }] },
      "PATCH"
    );
    expect(status).toBe(200);
    expect(Number(body.totalAmount)).toBe(110);
  });

  it("carries the applied fee over when converting to an invoice", async () => {
    const est = await admin.postJson<{ id: string; totalAmount: string; appliedFees: { label: string; amount: string }[] }>(
      "/api/estimates",
      {
        customerId,
        estimateNumber: `EST-FEE-CONV-${Date.now()}`,
        estimateDate: "2026-01-01",
        items: [{ description: "Convert me", quantity: "1", unitPrice: "100" }],
        appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "10.00" }],
      }
    );
    expect(Number(est.body.totalAmount)).toBe(110);

    const converted = await admin.postJson<{ invoiceId: string }>(
      `/api/estimates/${est.body.id}/convert`,
      {}
    );
    expect(converted.status).toBe(200);

    const invoice = await admin.getJson<{ totalAmount: string; appliedFees: { label: string; amount: string }[] }>(
      `/api/invoices/customer/${converted.body.invoiceId}`
    );
    expect(Number(invoice.body.totalAmount)).toBe(110);
    expect(invoice.body.appliedFees).toEqual(est.body.appliedFees);
  });
});

describe("invalid foreign keys are rejected cleanly, not a raw DB-constraint 500", () => {
  it("rejects estimate creation with a customerId that doesn't exist", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/estimates", {
      customerId: "not-a-real-customer-id",
      estimateNumber: `FK-BADCUST-${Date.now()}`,
      estimateDate: "2026-01-01",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(status).toBe(404);
    expect(body.error).toContain("customer");
  });
});
