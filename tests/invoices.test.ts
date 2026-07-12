import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";

let admin: TestSession;
let customerId: string;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  const res = await admin.postJson<{ id: string }>("/api/customers", {
    name: "Invoice Test Customer",
  });
  customerId = res.body.id;
});

describe("invoice creation — server-side totals", () => {
  it("computes subtotal/total from line items, not from a client-submitted total", async () => {
    const { status, body } = await admin.postJson<{
      subtotal: string;
      totalAmount: string;
    }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `CALC-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [
        { description: "Widget", quantity: "3", unitPrice: "10.00" },
        { description: "Gadget", quantity: "2", unitPrice: "5.50" },
      ],
    });
    expect(status).toBe(201);
    // 3*10.00 + 2*5.50 = 41.00 — Prisma's Decimal JSON serialization strips
    // trailing zeros (the DB value itself is exact), so compare numerically.
    expect(Number(body.subtotal)).toBe(41);
    expect(Number(body.totalAmount)).toBe(41);
  });

  it("rejects a duplicate invoice number for the same customer", async () => {
    const invoiceNumber = `DUP-TEST-${Date.now()}`;
    const payload = {
      customerId,
      invoiceNumber,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    };
    const first = await admin.postJson("/api/invoices/customer", payload);
    expect(first.status).toBe(201);
    const second = await admin.postJson("/api/invoices/customer", payload);
    expect(second.status).toBe(409);
  });

  // Documents a real, reproducible bug found in the companion financial-integrity
  // audit: subtotal accumulates UNROUNDED per-line values and rounds once at the
  // end, while each line item is rounded individually for storage/display — the
  // two numbers can legitimately disagree by a cent.
  it.fails("invoice subtotal should equal the sum of its own stored line totals", async () => {
    const { body } = await admin.postJson<{
      subtotal: string;
      items: { lineTotal: string }[];
    }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `ROUNDING-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [
        { description: "a", quantity: "1", unitPrice: "3.335" },
        { description: "b", quantity: "1", unitPrice: "3.335" },
        { description: "c", quantity: "1", unitPrice: "3.335" },
      ],
    });
    const sumOfLines = body.items.reduce((s, i) => s + Number(i.lineTotal), 0);
    expect(Number(body.subtotal)).toBeCloseTo(sumOfLines, 2); // currently 10.01 vs 10.02
  });
});

describe("paid-invoice protection", () => {
  async function createAndFullyPayInvoice(): Promise<string> {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `PAID-TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const id = created.body.id;
    await admin.postJson(`/api/invoices/customer/${id}`, { paidAmount: "1000" }, "PATCH");
    return id;
  }

  // Documents a real, live-verified bug from the financial-integrity audit:
  // a PAID invoice's line items and total can be rewritten with no restriction.
  it.fails("a PAID invoice should not accept line-item edits", async () => {
    const id = await createAndFullyPayInvoice();
    const { status } = await admin.postJson(
      `/api/invoices/customer/${id}`,
      { items: [{ description: "rewritten after payment", quantity: "1", unitPrice: "1" }] },
      "PATCH"
    );
    expect(status).toBe(409); // currently 200 — the total silently changes from 1000.00 to 1.00
  });

  // Documents a real, live-verified bug from the financial-integrity audit:
  // a PAID invoice — with real payment recorded against it — can be hard-deleted
  // with no barrier, leaving zero trace it ever existed.
  it.fails("a PAID invoice should not be deletable", async () => {
    const id = await createAndFullyPayInvoice();
    const { status } = await admin.postJson(`/api/invoices/customer/${id}`, {}, "DELETE");
    expect(status).toBe(409); // currently 200 — the invoice and its payment history vanish entirely
  });
});

describe("overpayment handling", () => {
  // Documents a real, live-verified bug from the financial-integrity audit:
  // paidAmount is accepted with no upper bound relative to totalAmount, and
  // there is no credit-balance concept anywhere to account for the difference.
  it.fails("paidAmount should not be able to exceed totalAmount without an explicit credit/overpayment path", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `OVERPAY-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const { status } = await admin.postJson(
      `/api/invoices/customer/${created.body.id}`,
      { paidAmount: "5000" },
      "PATCH"
    );
    expect(status).toBe(400); // currently 200 — a $4,000 overpayment is silently accepted
  });

  it("a partial payment below the total correctly yields PARTIALLY_PAID", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `PARTIAL-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const { body } = await admin.postJson<{ paymentStatus: string }>(
      `/api/invoices/customer/${created.body.id}`,
      { paidAmount: "400" },
      "PATCH"
    );
    expect(body.paymentStatus).toBe("PARTIALLY_PAID");
  });

  it("a payment exactly equal to the total correctly yields PAID", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `EXACT-PAY-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const { body } = await admin.postJson<{ paymentStatus: string }>(
      `/api/invoices/customer/${created.body.id}`,
      { paidAmount: "1000" },
      "PATCH"
    );
    expect(body.paymentStatus).toBe("PAID");
  });
});

describe("concurrency — invoice numbering", () => {
  it("concurrent creates with the same invoice number produce exactly one invoice, never a duplicate or a 500", async () => {
    const invoiceNumber = `RACE-TEST-${Date.now()}`;
    const payload = {
      customerId,
      invoiceNumber,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "race", quantity: "1", unitPrice: "1" }],
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => admin.postJson("/api/invoices/customer", payload))
    );
    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);
    const errored = results.filter((r) => r.status >= 500);
    expect(created.length).toBe(1);
    expect(conflicted.length).toBe(5);
    // Not a hard failure today (the DB constraint saves it), but worth watching:
    // there's no try/catch around the create() call, so a tighter race under
    // real load could surface as a 500 rather than a clean 409.
    expect(errored.length).toBe(0);
  });
});
