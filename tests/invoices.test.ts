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

// Fixed: the invoiceNumber input on invoices/customer/new used to be
// free-typed -- nothing stopped a sales rep from clearing the auto-filled
// "Inv 1320" prefix and submitting a bare "1320". The invoices list used to
// sort by invoiceNumber (a string) descending, so a bare-digit number like
// "1320" sorts *below* any "Inv "-prefixed number ('1' < 'I' in ASCII)
// regardless of when it was actually created -- a just-created invoice
// could vanish off the first page of "All invoices" while older,
// differently-formatted invoices sat above it. Sorting by createdAt
// instead makes list order track actual creation order no matter what's in
// the number field.
//
// The create/edit forms now lock this field to the system-assigned number
// (see invoices/customer/new and .../[id]) so a sales rep can no longer
// type over it -- but the API itself still has to accept whatever number a
// caller sends: the AI PDF/image extractor (handleExtracted in
// invoices/customer/new) still fills this field from a scanned document's
// own printed number, which is never going to match the "Inv ####"
// sequence. This test keeps the list itself honest regardless of where an
// oddly-formatted number came from.
describe("invoice list order survives an inconsistently-formatted invoice number", () => {
  it("a just-created invoice with a bare number still sorts first", async () => {
    const prefixed = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `Inv SORT-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(prefixed.status).toBe(201);

    // Created after the one above, but with a bare number lacking the "Inv "
    // prefix -- under the old invoiceNumber-string sort this would land
    // *after* "Inv SORT-..." even though it's the newer invoice.
    const bare = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(bare.status).toBe(201);

    const { body } = await admin.getJson<{ invoices: { id: string }[] }>(
      `/api/invoices/customer?customerId=${customerId}&limit=5`
    );
    expect(body.invoices[0].id).toBe(bare.body.id);
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
  // Customer invoices deliberately ALLOW overpayment as of da79d8e (a
  // customer paying in cash often rounds up, e.g. $1001 against a $1000.70
  // invoice) -- these two used to assert the opposite (a rejected 400) and
  // were left failing when that guard was intentionally removed, instead of
  // being updated to match the new behavior. paymentStatus still correctly
  // caps at PAID rather than some nonsensical "more than paid" state.
  it("paidAmount above totalAmount via PATCH is allowed and caps paymentStatus at PAID", async () => {
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: `OVERPAY-TEST-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    });
    const { status, body } = await admin.postJson<{ paidAmount: string; paymentStatus: string }>(
      `/api/invoices/customer/${created.body.id}`,
      { paidAmount: "1001" },
      "PATCH"
    );
    expect(status).toBe(200);
    expect(Number(body.paidAmount)).toBe(1001);
    expect(body.paymentStatus).toBe("PAID");
  });

  it("a payment that pushes paidAmount above totalAmount is allowed and caps paymentStatus at PAID", async () => {
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
    const second = await admin.postJson<{ paymentStatus: string }>(
      `/api/invoices/customer/${id}/payments`,
      {
        amount: "500", // 600 + 500 = 1100 > totalAmount 1000, a legitimate 100 overpayment
        paymentDate: "2026-01-06",
      }
    );
    expect(second.status).toBe(201);
    expect(second.body.paymentStatus).toBe("PAID");

    const invoice = await admin.getJson<{ paidAmount: string }>(`/api/invoices/customer/${id}`);
    expect(Number(invoice.body.paidAmount)).toBe(1100);
  });

  // Supplier bills were NOT part of da79d8e's scope -- the original
  // overpayment guard (6858f49) is still intentionally in place here, so a
  // rounded-up vendor payment is still rejected. Documented so a future
  // change to align the two doesn't look like an accidental regression.
  it("supplier bills still reject an overpayment (guard not relaxed here, unlike customer invoices)", async () => {
    const supplierRes = await admin.postJson<{ id: string }>("/api/suppliers", {
      name: "Overpay Test Supplier",
    });
    const created = await admin.postJson<{ id: string }>("/api/invoices/supplier", {
      supplierId: supplierRes.body.id,
      invoiceNumber: `SUP-OVERPAY-${Date.now()}`,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      category: "OTHER",
      items: [{ description: "Materials", quantity: "1", unitCost: "1000" }],
    });
    const { status } = await admin.postJson(
      `/api/invoices/supplier/${created.body.id}`,
      { paidAmount: "1001" },
      "PATCH"
    );
    expect(status).toBe(400);
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

describe("next invoice number — a persisted counter, not a MAX() scan over existing rows", () => {
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

  it("never reissues a number after the invoice that used it is deleted", async () => {
    const before = await admin.getJson<{ prefix: string }>("/api/invoices/customer/next-number");
    const { prefix } = before.body;

    // Deliberately far above whatever sequence other tests in this file
    // reach, so this doesn't collide with them regardless of run order.
    const usedNumber = `${prefix}20000`;
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber: usedNumber,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(created.status).toBe(201);

    const afterCreate = await admin.getJson<{ nextNumber: string }>("/api/invoices/customer/next-number");
    expect(afterCreate.body.nextNumber).toBe(`${prefix}20001`);

    const del = await admin.postJson(`/api/invoices/customer/${created.body.id}`, {}, "DELETE");
    expect(del.status).toBe(200);

    // A MAX()-scan-based "next number" would drop right back down to 20000
    // the moment the only invoice using it is gone -- the next invoice
    // created would silently reuse a real, previously-issued number. The
    // persisted counter must not care that the row is gone.
    const afterDelete = await admin.getJson<{ nextNumber: string }>("/api/invoices/customer/next-number");
    expect(afterDelete.body.nextNumber).toBe(`${prefix}20001`);
    expect(afterDelete.body.nextNumber).not.toBe(usedNumber);
  });

  it("falls back to the default prefix instead of scanning every invoice number in the table when the configured prefix is blank", async () => {
    // A Settings field saved as "" (e.g. accidentally cleared and saved,
    // rather than left unset) must not be treated as "no prefix, match
    // anything" -- that degrades the underlying LIKE '<prefix>%' scan into
    // LIKE '%', which picks up the leading digit run of every invoice
    // number in the table regardless of format, including old/unrelated
    // ones, instead of just this prefix's own sequence.
    const before = await admin.getJson<{ prefix: string; nextSeq: number }>(
      "/api/invoices/customer/next-number"
    );
    const originalPrefix = before.body.prefix;
    // Comfortably above whatever earlier tests in this file already pushed
    // the "INV-2026-" sequence to, so the floor set below actually wins.
    const floorSeq = before.body.nextSeq + 500;

    try {
      // A differently-formatted invoice number with a huge leading digit
      // run -- if the prefix scope is lost, this pollutes the "next number"
      // computation for every other prefix too.
      await admin.postJson("/api/invoices/customer", {
        customerId,
        invoiceNumber: "99999999-unrelated-legacy-number",
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [{ description: "x", quantity: "1", unitPrice: "1" }],
      });

      const settingsRes = await admin.postJson(
        "/api/settings",
        { customerInvoicePrefix: "", customerInvoiceNextSeq: floorSeq },
        "PATCH"
      );
      expect(settingsRes.status).toBe(200);

      const after = await admin.getJson<{ prefix: string; nextNumber: string; nextSeq: number }>(
        "/api/invoices/customer/next-number"
      );
      expect(after.body.prefix).toBe("INV-2026-");
      expect(after.body.nextSeq).toBe(floorSeq);
      expect(after.body.nextNumber).toBe(`INV-2026-${floorSeq}`);
    } finally {
      await admin.postJson("/api/settings", { customerInvoicePrefix: originalPrefix }, "PATCH");
    }
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

  it("accepts a fee amount that rounds up to the next cent past the unrounded ceiling", async () => {
    // 176.69 * 3.99% = 7.049931 exactly. A client always submits fee amounts
    // rounded to cents (7.05, since the third decimal digit is 9), but the
    // true, unrounded product is 7.049931 -- comparing a rounded amount
    // against an unrounded ceiling would wrongly reject roughly half of all
    // legitimate fees, single line item or not.
    const settingsRes = await admin.postJson(
      "/api/settings",
      { creditCardFeeRate: "0.0399" },
      "PATCH"
    );
    expect(settingsRes.status).toBe(200);

    const created = await admin.postJson<{ id: string; totalAmount: string }>(
      "/api/invoices/customer",
      {
        customerId,
        invoiceNumber: `FEE-ROUND-${Date.now()}`,
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [{ description: "silla", quantity: "1", unitPrice: "176.69" }],
        appliedFees: [{ id: "__cc__", label: "CARD FEE", rate: 0.0399, amount: "7.05" }],
      }
    );
    expect(created.status).toBe(201);
    expect(Number(created.body.totalAmount)).toBe(183.74); // 176.69 + 7.05

    // Same rounding must be tolerated when re-saving via PATCH (the edit page).
    const patched = await admin.postJson<{ error: string }>(
      `/api/invoices/customer/${created.body.id}`,
      {
        items: [{ description: "silla", quantity: "1", unitPrice: "176.69" }],
        appliedFees: [{ id: "__cc__", label: "CARD FEE", rate: 0.0399, amount: "7.05" }],
      },
      "PATCH"
    );
    expect(patched.status).toBe(200);
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
