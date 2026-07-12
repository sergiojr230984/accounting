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
    const { status, body } = await admin.postJson<{ subtotal: string; totalAmount: string }>(
      "/api/invoices/customer",
      {
        customerId,
        invoiceNumber: `CALC-TEST-${Date.now()}`,
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [
          { description: "Widget", quantity: "3", unitPrice: "10.00" },
          { description: "Gadget", quantity: "2", unitPrice: "5.50" },
        ],
      }
    );
    expect(status).toBe(201);
    expect(Number(body.subtotal)).toBe(41); // 3*10 + 2*5.50
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

  // Fixed: each line's total is rounded to 2 decimals before being summed
  // into subtotal, instead of accumulating full-precision Decimals and
  // rounding once at the end -- the two values can no longer disagree.
  it("invoice subtotal should equal the sum of its own stored line totals", async () => {
    const { body } = await admin.postJson<{ subtotal: string; items: { lineTotal: string }[] }>(
      "/api/invoices/customer",
      {
        customerId,
        invoiceNumber: `ROUNDING-TEST-${Date.now()}`,
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [
          { description: "a", quantity: "1", unitPrice: "3.335" },
          { description: "b", quantity: "1", unitPrice: "3.335" },
          { description: "c", quantity: "1", unitPrice: "3.335" },
        ],
      }
    );
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

  it("a PAID invoice does not accept line-item edits", async () => {
    const id = await createAndFullyPayInvoice();
    const { status } = await admin.postJson(
      `/api/invoices/customer/${id}`,
      { items: [{ description: "rewritten after payment", quantity: "1", unitPrice: "1" }] },
      "PATCH"
    );
    expect(status).toBe(409);
  });

  it("a PAID invoice is not deletable", async () => {
    const id = await createAndFullyPayInvoice();
    const { status } = await admin.postJson(`/api/invoices/customer/${id}`, {}, "DELETE");
    expect(status).toBe(409);
  });

  it("a PAID invoice still accepts non-item edits (e.g. notes)", async () => {
    const id = await createAndFullyPayInvoice();
    const { status } = await admin.postJson(
      `/api/invoices/customer/${id}`,
      { notes: "Called customer to confirm receipt" },
      "PATCH"
    );
    expect(status).toBe(200);
  });
});

describe("overpayment handling", () => {
  it("paidAmount cannot exceed totalAmount via PATCH", async () => {
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
    expect(status).toBe(400);
  });

  it("a payment that would push paidAmount above totalAmount is rejected", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `OVERPAY-LEDGER-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const id = created.body.id;
    const first = await admin.postJson(`/api/invoices/customer/${id}/payments`, {
      amount: "600",
      paymentDate: "2026-01-05",
    });
    expect(first.status).toBe(201);
    const second = await admin.postJson(`/api/invoices/customer/${id}/payments`, {
      amount: "500", // 600 + 500 = 1100 > totalAmount 1000
      paymentDate: "2026-01-06",
    });
    expect(second.status).toBe(400);
  });
});

describe("payment ledger — new on this branch, not present on main", () => {
  it("recording a payment creates a real Payment row and updates paidAmount/status", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `PAYLEDGER-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const id = created.body.id;

    const paid = await admin.postJson<{ paymentStatus: string; paidAmount: string }>(
      `/api/invoices/customer/${id}/payments`,
      { amount: "400", paymentDate: "2026-01-05" }
    );
    expect(paid.status).toBe(201);
    expect(paid.body.paymentStatus).toBe("PARTIALLY_PAID");
    expect(Number(paid.body.paidAmount)).toBe(400);

    const full = await admin.getJson<{ payments: unknown[] }>(`/api/invoices/customer/${id}`);
    expect(full.body.payments.length).toBe(1);
  });

  // Fixed: payment creation now acquires a real row lock (a raw
  // SELECT ... FOR UPDATE inside an interactive transaction) before reading
  // and updating paidAmount, so concurrent payments serialize instead of
  // racing on a stale read. Re-run several times (including as part of a
  // full-suite run, not just in isolation) to confirm the fix is robust,
  // not just narrowing the window -- consistently correct across all of
  // them.
  it("eight concurrent payments on the same invoice are all correctly reflected in paidAmount", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `PAYRACE-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const id = created.body.id;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        admin.postJson(`/api/invoices/customer/${id}/payments`, { amount: "100", paymentDate: "2026-01-05" })
      )
    );

    const final = await admin.getJson<{ paidAmount: string; payments: unknown[] }>(`/api/invoices/customer/${id}`);
    expect(Number(final.body.paidAmount)).toBe(800);
    expect(final.body.payments.length).toBe(8);
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
    const errored = results.filter((r) => r.status >= 500);
    expect(created.length).toBe(1);
    expect(errored.length).toBe(0);
  });
});
