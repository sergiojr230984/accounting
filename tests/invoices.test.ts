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

describe("product-catalog auto-save — batched, not one query per line item", () => {
  it("creates a new product from a line-item description, but not a duplicate for an existing (case-insensitive) match", async () => {
    const uniqueName = `Widget-${Date.now()}`;
    await admin.postJson("/api/invoices/customer", {
      customerId,
      invoiceNumber: `PRODSYNC-A-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: uniqueName, quantity: "1", unitPrice: "5" }],
    });
    // Re-used with different casing on a second invoice -- should not create a second product.
    await admin.postJson("/api/invoices/customer", {
      customerId,
      invoiceNumber: `PRODSYNC-B-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: uniqueName.toUpperCase(), quantity: "1", unitPrice: "5" }],
    });

    const { body: products } = await admin.getJson<{ name: string }[]>("/api/products");
    const matches = products.filter((p) => p.name.toLowerCase() === uniqueName.toLowerCase());
    expect(matches.length).toBe(1);
  });

  it("two line items sharing the same new name on one invoice only create one product", async () => {
    const uniqueName = `Gadget-${Date.now()}`;
    await admin.postJson("/api/invoices/customer", {
      customerId,
      invoiceNumber: `PRODSYNC-DUPE-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [
        { description: uniqueName, quantity: "1", unitPrice: "1" },
        { description: uniqueName, quantity: "2", unitPrice: "2" },
      ],
    });

    const { body: products } = await admin.getJson<{ name: string }[]>("/api/products");
    const matches = products.filter((p) => p.name.toLowerCase() === uniqueName.toLowerCase());
    expect(matches.length).toBe(1);
  });
});

describe("next invoice number — computed via SQL aggregate, not a full-table JS scan", () => {
  it("suggests one past the highest existing sequence under the current prefix", async () => {
    const before = await admin.getJson<{ prefix: string; nextSeq: number }>(
      "/api/invoices/customer/next-number"
    );
    const { prefix } = before.body;

    // Deliberately far above whatever sequence other tests have reached,
    // so this assertion doesn't depend on run order.
    const highNumber = `${prefix}9999`;
    await admin.postJson("/api/invoices/customer", {
      customerId,
      invoiceNumber: highNumber,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });

    const after = await admin.getJson<{ nextSeq: number; nextNumber: string }>(
      "/api/invoices/customer/next-number"
    );
    expect(after.body.nextSeq).toBe(10000);
    expect(after.body.nextNumber).toBe(`${prefix}10000`);
  });

  it("a manually-set invoice number with trailing non-digit text still contributes its leading digits (matches the old parseInt-based behavior)", async () => {
    const before = await admin.getJson<{ prefix: string }>("/api/invoices/customer/next-number");
    const { prefix } = before.body;

    await admin.postJson("/api/invoices/customer", {
      customerId,
      invoiceNumber: `${prefix}8888b`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });

    const after = await admin.getJson<{ nextSeq: number }>("/api/invoices/customer/next-number");
    expect(after.body.nextSeq).toBeGreaterThanOrEqual(8889);
  });
});

describe("applied fees are re-derived server-side, not trusted from the client", () => {
  let feeId: string;
  const feeRate = 0.1; // 10%

  beforeAll(async () => {
    feeId = `fee-${Date.now()}`;
    const { status } = await admin.postJson(
      "/api/settings",
      { customFees: [{ id: feeId, label: "Delivery fee", rate: feeRate }] },
      "PATCH"
    );
    expect(status).toBe(200);
  });

  it("rejects a fee id that isn't a currently configured fee", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `FEE-UNKNOWN-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
      appliedFees: [{ id: "not-a-real-fee", label: "Made-up fee", rate: 0.5, amount: "50" }],
    });
    expect(status).toBe(400);
    expect(body.error).toContain("not a currently configured fee");
  });

  it("rejects an amount above what the configured rate allows, even for a real fee id", async () => {
    // subtotal 100, fee rate 10% -> the true ceiling is $10, no matter what
    // amount the client claims.
    const { status, body } = await admin.postJson<{ error: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `FEE-INFLATED-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
      appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "9999" }],
    });
    expect(status).toBe(400);
    expect(body.error).toContain("exceeds what its configured rate allows");
  });

  it("accepts a legitimate fee within its configured rate's ceiling", async () => {
    const { status, body } = await admin.postJson<{ totalAmount: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `FEE-LEGIT-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
      appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "10.00" }],
    });
    expect(status).toBe(201);
    expect(Number(body.totalAmount)).toBe(110); // 100 subtotal + 10 fee
  });

  it("caps a fee's ceiling on the pre-tax subtotal, not subtotal + tax (matches the accounting system of record)", async () => {
    // item is $370 @ 7% tax -> subtotal 370, tax 25.90. A 3.99% card fee's
    // true ceiling is 3.99% of the pre-tax 370 ($14.76), not of 395.90
    // ($15.79) -- an amount above the pre-tax ceiling must be rejected.
    const cardFeeId = `cardfee-${Date.now()}`;
    const settingsRes = await admin.postJson(
      "/api/settings",
      { customFees: [{ id: feeId, label: "Delivery fee", rate: feeRate }, { id: cardFeeId, label: "CARD FEE", rate: 0.0399 }] },
      "PATCH"
    );
    expect(settingsRes.status).toBe(200);

    const overCeiling = await admin.postJson<{ error: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `FEE-TAX-CEILING-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "TO/2000/1000 5pc SET BROWN", quantity: "1", unitPrice: "370", taxRate: "0.07" }],
      appliedFees: [{ id: cardFeeId, label: "CARD FEE", rate: 0.0399, amount: "15.80" }],
    });
    expect(overCeiling.status).toBe(400);
    expect(overCeiling.body.error).toContain("exceeds what its configured rate allows");

    const atCeiling = await admin.postJson<{ subtotal: string; taxAmount: string; totalAmount: string }>(
      "/api/invoices/customer",
      {
        customerId,
        invoiceNumber: `FEE-TAX-OK-${Date.now()}`,
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [{ description: "TO/2000/1000 5pc SET BROWN", quantity: "1", unitPrice: "370", taxRate: "0.07" }],
        appliedFees: [{ id: cardFeeId, label: "CARD FEE", rate: 0.0399, amount: "14.76" }],
      }
    );
    expect(atCeiling.status).toBe(201);
    expect(Number(atCeiling.body.subtotal)).toBe(370);
    expect(Number(atCeiling.body.taxAmount)).toBe(25.9);
    expect(Number(atCeiling.body.totalAmount)).toBe(410.66); // 370 + 25.90 + 14.76
  });

  it("accepts the built-in card fee (synthetic id \"__cc__\", backed by companyProfile.creditCardFeeRate, not customFees)", async () => {
    // The client applies the built-in credit-card fee the same way it applies
    // a custom fee, tagged with the synthetic id "__cc__" -- but that fee's
    // rate lives on companyProfile.creditCardFeeRate, not in the customFees
    // array. The ceiling check must recognize "__cc__" too, or every invoice
    // using the built-in card fee is wrongly rejected as "not configured".
    const settingsRes = await admin.postJson(
      "/api/settings",
      { creditCardFeeRate: "0.0399" },
      "PATCH"
    );
    expect(settingsRes.status).toBe(200);

    const { status, body } = await admin.postJson<{ error: string; subtotal: string; totalAmount: string }>(
      "/api/invoices/customer",
      {
        customerId,
        invoiceNumber: `FEE-CC-BUILTIN-${Date.now()}`,
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [{ description: "adorno", quantity: "1", unitPrice: "89" }],
        appliedFees: [{ id: "__cc__", label: "CARD FEE", rate: 0.0399, amount: "3.55" }],
      }
    );
    expect(status).toBe(201);
    expect(Number(body.subtotal)).toBe(89);
    expect(Number(body.totalAmount)).toBe(92.55); // 89 + 3.55 card fee, no tax
  });

  it("rejects an inflated fee amount added via PATCH too", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `FEE-PATCH-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "100" }],
    });
    const { status, body } = await admin.postJson<{ error: string }>(
      `/api/invoices/customer/${created.body.id}`,
      { appliedFees: [{ id: feeId, label: "Delivery fee", rate: feeRate, amount: "9999" }] },
      "PATCH"
    );
    expect(status).toBe(400);
    expect(body.error).toContain("exceeds what its configured rate allows");
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

describe("invalid foreign keys are rejected cleanly, not a raw DB-constraint 500", () => {
  it("rejects invoice creation with a customerId that doesn't exist", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/invoices/customer", {
      customerId: "not-a-real-customer-id",
      invoiceNumber: `FK-BADCUST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(status).toBe(404);
    expect(body.error).toContain("customer");
  });

  it("rejects invoice creation with an employeeId that doesn't exist", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `FK-BADEMP-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
      employeeId: "not-a-real-employee-id",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("sales rep");
  });

  it("rejects a PATCH that assigns an employeeId that doesn't exist", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `FK-PATCHEMP-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    const { status, body } = await admin.postJson<{ error: string }>(
      `/api/invoices/customer/${created.body.id}`,
      { employeeId: "not-a-real-employee-id" },
      "PATCH"
    );
    expect(status).toBe(400);
    expect(body.error).toContain("sales rep");
  });

  it("rejects a bill (supplier invoice) with a supplierId that doesn't exist", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/invoices/supplier", {
      supplierId: "not-a-real-supplier-id",
      invoiceNumber: `FK-BADSUP-${Date.now()}`,
      invoiceDate: "2026-01-01",
      category: "OPERATING_EXPENSE",
      items: [{ description: "x", quantity: "1", unitCost: "1" }],
    });
    expect(status).toBe(404);
    expect(body.error).toContain("supplier");
  });
});
