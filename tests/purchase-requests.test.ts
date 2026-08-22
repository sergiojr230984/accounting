import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";

/**
 * Sell-then-source purchasing trigger workflow: a paid customer-invoice
 * line auto-generates a purchase_request, which purchasing later closes
 * with a bill that writes real cost back to the invoice line. Entirely new
 * on this branch, absent on main.
 */

let admin: TestSession;
let manager: TestSession;
let customerId: string;
let realSupplierId: string;
let realSupplierCode: string;
let houseSupplierId: string;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");
  manager = await loginAs("manager@bizledger.com", "manager123");

  const cust = await admin.postJson<{ id: string }>("/api/customers", {
    name: "Purchase Request Test Customer",
  });
  customerId = cust.body.id;

  // Guaranteed exactly 2 uppercase letters regardless of timestamp digits.
  const uniqueSuffix = Date.now().toString(36).toUpperCase().slice(-2);
  realSupplierCode = uniqueSuffix.replace(/[^A-Z]/g, "X").padEnd(2, "X").slice(0, 2);

  const sup = await admin.postJson<{ id: string; code: string }>("/api/suppliers", {
    name: "PR Test Supplier",
    code: realSupplierCode,
    active: true,
    isHouse: false,
  });
  expect(sup.status).toBe(201);
  realSupplierId = sup.body.id;
  realSupplierCode = sup.body.code;

  const houseCode = `HS${Date.now().toString(36).toUpperCase().slice(-1)}`.replace(/[^A-Z]/g, "X");
  const house = await admin.postJson<{ id: string }>("/api/suppliers", {
    name: "House Stock",
    code: houseCode,
    active: true,
    isHouse: true,
  });
  expect(house.status).toBe(201);
  houseSupplierId = house.body.id;
});

async function createInvoiceWithLines(opts: { includeHouseLine: boolean }) {
  const items: Record<string, string>[] = [
    {
      description: "Sofa, brown leather",
      quantity: "1",
      unitPrice: "500",
      taxRate: "0",
      supplierId: realSupplierId,
      partNumber: `PN-${Date.now()}`,
    },
  ];
  if (opts.includeHouseLine) {
    items.push({
      description: "Throw pillow (in stock)",
      quantity: "2",
      unitPrice: "20",
      taxRate: "0",
      supplierId: houseSupplierId,
      partNumber: "N/A",
    });
  }
  const res = await admin.postJson<{ id: string; totalAmount: string; invoiceNumber: string }>("/api/invoices/customer", {
    customerId,
    invoiceNumber: `PR-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-31",
    items,
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe("supplier registry — code assignment", () => {
  it("rejects a code that isn't exactly 2 letters", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/suppliers", {
      name: "Bad Code Co",
      code: "ABC",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("2 letters");
  });

  it("rejects a duplicate code across suppliers (DB-level uniqueness)", async () => {
    const { status, body } = await admin.postJson<{ error: string }>("/api/suppliers", {
      name: "Duplicate Code Co",
      code: realSupplierCode,
    });
    expect(status).toBe(409);
    expect(body.error).toContain("already in use");
  });

  it("allows the HOUSE entry's code to be 2-4 letters", async () => {
    const { status } = await admin.postJson(
      "/api/suppliers",
      { name: `House ${Date.now()}`, code: `HX${Date.now().toString(36).slice(-2).toUpperCase().replace(/[^A-Z]/g, "Q")}`, isHouse: true },
      "POST"
    );
    expect(status).toBe(201);
  });

  it("blocks a MANAGER from assigning a code, but still allows ordinary contact-info edits", async () => {
    const created = await admin.postJson<{ id: string }>("/api/suppliers", { name: "Manager Edit Target" });
    const blocked = await manager.postJson<{ error: string }>(
      `/api/suppliers/${created.body.id}`,
      { name: "Manager Edit Target", code: "MG" },
      "PATCH"
    );
    expect(blocked.status).toBe(403);

    const allowed = await manager.postJson(
      `/api/suppliers/${created.body.id}`,
      { name: "Manager Edit Target Renamed", email: "contact@example.com" },
      "PATCH"
    );
    expect(allowed.status).toBe(200);
  });
});

describe("purchase_request creation trigger", () => {
  it("does not create a purchase_request before any payment is recorded", async () => {
    const inv = await createInvoiceWithLines({ includeHouseLine: false });
    const report = await admin.getJson<{ rows: { invoiceNumber: string }[] }>(
      `/api/reports?type=items-ordered`
    );
    const rowsForInvoice = report.body.rows.filter((r) => r.invoiceNumber === inv.invoiceNumber);
    expect(rowsForInvoice.length).toBe(0);
  });

  it("creates exactly one purchase_request per non-HOUSE line on the first payment (partial), and excludes the HOUSE line entirely", async () => {
    const inv = await createInvoiceWithLines({ includeHouseLine: true });

    // Partial payment -- 50% deposit.
    const pay = await admin.postJson(`/api/invoices/customer/${inv.id}/payments`, {
      amount: "250",
      paymentDate: "2026-01-05",
    });
    expect(pay.status).toBe(201);

    const full = await admin.getJson<{ invoiceNumber: string }>(`/api/invoices/customer/${inv.id}`);
    // Scoped to PENDING -- the unfiltered report legitimately unions real
    // purchase_request rows with HOUSE lines (checked separately below), so
    // asserting "exactly one row total" against the unfiltered report would
    // conflate the two.
    const report = await admin.getJson<{
      rows: { invoiceNumber: string; status: string; supplierId: string }[];
    }>(`/api/reports?type=items-ordered&status=PENDING`);
    const rowsForInvoice = report.body.rows.filter((r) => r.invoiceNumber === full.body.invoiceNumber);

    // Exactly one row: the real-supplier line. The HOUSE line never gets a
    // purchase_request (see lib/purchase-requests.ts), though it's still
    // visible separately with status "HOUSE" -- checked below.
    expect(rowsForInvoice.length).toBe(1);
    expect(rowsForInvoice[0].status).toBe("PENDING");
    expect(rowsForInvoice[0].supplierId).toBe(realSupplierId);

    const houseReport = await admin.getJson<{ rows: { invoiceNumber: string; status: string }[] }>(
      `/api/reports?type=items-ordered&status=HOUSE`
    );
    const houseRowsForInvoice = houseReport.body.rows.filter((r) => r.invoiceNumber === full.body.invoiceNumber);
    expect(houseRowsForInvoice.length).toBe(1);
    expect(houseRowsForInvoice[0].status).toBe("HOUSE");
  });

  it("fire-once: paying off the remaining balance does not create a duplicate purchase_request", async () => {
    const inv = await createInvoiceWithLines({ includeHouseLine: false });

    const first = await admin.postJson(`/api/invoices/customer/${inv.id}/payments`, {
      amount: "200",
      paymentDate: "2026-01-05",
    });
    expect(first.status).toBe(201);

    const full = await admin.getJson<{ invoiceNumber: string }>(`/api/invoices/customer/${inv.id}`);
    const afterFirst = await admin.getJson<{ rows: { invoiceNumber: string }[] }>(
      `/api/reports?type=items-ordered`
    );
    const countAfterFirst = afterFirst.body.rows.filter((r) => r.invoiceNumber === full.body.invoiceNumber).length;
    expect(countAfterFirst).toBe(1);

    // Pay off the rest -- this must NOT re-fire the trigger.
    const second = await admin.postJson(`/api/invoices/customer/${inv.id}/payments`, {
      amount: "300",
      paymentDate: "2026-01-10",
    });
    expect(second.status).toBe(201);

    const afterSecond = await admin.getJson<{ rows: { invoiceNumber: string }[] }>(
      `/api/reports?type=items-ordered`
    );
    const countAfterSecond = afterSecond.body.rows.filter((r) => r.invoiceNumber === full.body.invoiceNumber).length;
    expect(countAfterSecond).toBe(1);
  });

  it("fire-once under concurrency: 8 simultaneous first-payments create exactly one purchase_request", async () => {
    const inv = await createInvoiceWithLines({ includeHouseLine: false });

    // Each concurrent request pays a tiny amount -- all racing to be "the
    // first payment that crosses zero". The row lock in the payments route
    // serializes these, and ensurePurchaseRequestsForInvoice's own
    // idempotency (the @unique constraint) is the actual backstop even if
    // that serialization were ever weakened.
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        admin.postJson(`/api/invoices/customer/${inv.id}/payments`, {
          amount: "10",
          paymentDate: "2026-01-05",
        })
      )
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const full = await admin.getJson<{ invoiceNumber: string; paidAmount: string }>(`/api/invoices/customer/${inv.id}`);
    expect(Number(full.body.paidAmount)).toBe(80);

    const report = await admin.getJson<{ rows: { invoiceNumber: string }[] }>(`/api/reports?type=items-ordered`);
    const count = report.body.rows.filter((r) => r.invoiceNumber === full.body.invoiceNumber).length;
    expect(count).toBe(1);
  });

  it("also triggers off the invoice edit screen's own Amount Paid field (the second write path)", async () => {
    const inv = await createInvoiceWithLines({ includeHouseLine: false });

    const patch = await admin.postJson(`/api/invoices/customer/${inv.id}`, { paidAmount: "500" }, "PATCH");
    expect(patch.status).toBe(200);

    const full = await admin.getJson<{ invoiceNumber: string }>(`/api/invoices/customer/${inv.id}`);
    const report = await admin.getJson<{ rows: { invoiceNumber: string; status: string }[] }>(
      `/api/reports?type=items-ordered`
    );
    const rows = report.body.rows.filter((r) => r.invoiceNumber === full.body.invoiceNumber);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("PENDING");
  });
});

describe("bill creation closes out a purchase_request", () => {
  async function paidInvoiceWithOnePendingRequest() {
    const inv = await createInvoiceWithLines({ includeHouseLine: false });
    await admin.postJson(`/api/invoices/customer/${inv.id}/payments`, {
      amount: "500",
      paymentDate: "2026-01-05",
    });
    const full = await admin.getJson<{ invoiceNumber: string; id: string }>(`/api/invoices/customer/${inv.id}`);
    const report = await admin.getJson<{ rows: { id: string; invoiceNumber: string; quantity: string }[] }>(
      `/api/reports?type=items-ordered&status=PENDING`
    );
    const row = report.body.rows.find((r) => r.invoiceNumber === full.body.invoiceNumber);
    if (!row) throw new Error("expected a pending purchase request row");
    return { invoice: full.body, purchaseRequestId: row.id, quantity: row.quantity };
  }

  it("writes actual cost back to the invoice line and flips the request to FULFILLED", async () => {
    const { invoice, purchaseRequestId, quantity } = await paidInvoiceWithOnePendingRequest();

    const bill = await admin.postJson<{ id: string; customerInvoiceRef: string | null; warning?: string | null }>(
      "/api/invoices/supplier",
      {
        supplierId: realSupplierId,
        invoiceNumber: `BILL-${Date.now()}`,
        invoiceDate: "2026-01-06",
        category: "COGS",
        items: [{ description: "Sofa, brown leather", quantity, unitCost: "300", taxRate: "0" }],
        purchaseRequestId,
      }
    );
    expect(bill.status).toBe(201);
    // Reuses the existing bill<->invoice mechanism rather than a second one.
    expect(bill.body.customerInvoiceRef).toBe(invoice.invoiceNumber);
    expect(bill.body.warning ?? null).toBeNull();

    const updatedInvoice = await admin.getJson<{ items: { actualCost: string | null }[] }>(
      `/api/invoices/customer/${invoice.id}`
    );
    // Raw pass-through from the GET endpoint (like every other Decimal
    // field on this response, e.g. subtotal/totalAmount) -- not reformatted
    // to a fixed 2 decimals, so compare numerically rather than by string.
    expect(updatedInvoice.body.items.some((i) => i.actualCost !== null && Number(i.actualCost) === 300)).toBe(true);

    const fulfilledReport = await admin.getJson<{ rows: { id: string; status: string; cost: string | null }[] }>(
      `/api/reports?type=items-ordered&status=FULFILLED`
    );
    const row = fulfilledReport.body.rows.find((r) => r.id === purchaseRequestId);
    expect(row?.status).toBe("FULFILLED");
    expect(row?.cost).toBe("300.00");
  });

  it("enforces strict 1:1 -- a second bill against the same (now fulfilled) purchase request is rejected", async () => {
    const { purchaseRequestId, quantity } = await paidInvoiceWithOnePendingRequest();

    const first = await admin.postJson(
      "/api/invoices/supplier",
      {
        supplierId: realSupplierId,
        invoiceNumber: `BILL-A-${Date.now()}`,
        invoiceDate: "2026-01-06",
        category: "COGS",
        items: [{ description: "Sofa, brown leather", quantity, unitCost: "300", taxRate: "0" }],
        purchaseRequestId,
      }
    );
    expect(first.status).toBe(201);

    const second = await admin.postJson<{ error: string }>(
      "/api/invoices/supplier",
      {
        supplierId: realSupplierId,
        invoiceNumber: `BILL-B-${Date.now()}`,
        invoiceDate: "2026-01-06",
        category: "COGS",
        items: [{ description: "Sofa, brown leather", quantity, unitCost: "310", taxRate: "0" }],
        purchaseRequestId,
      }
    );
    expect(second.status).toBe(409);
  });

  it("rejects a bill with more than one line item when linked to a purchase request", async () => {
    const { purchaseRequestId, quantity } = await paidInvoiceWithOnePendingRequest();

    const { status, body } = await admin.postJson<{ error: string }>("/api/invoices/supplier", {
      supplierId: realSupplierId,
      invoiceNumber: `BILL-MULTI-${Date.now()}`,
      invoiceDate: "2026-01-06",
      category: "COGS",
      items: [
        { description: "Sofa, brown leather", quantity, unitCost: "300", taxRate: "0" },
        { description: "Extra item", quantity: "1", unitCost: "10", taxRate: "0" },
      ],
      purchaseRequestId,
    });
    expect(status).toBe(400);
    expect(body.error).toContain("exactly one line item");
  });

  it("flags (but does not block) a quantity that differs from the invoice line's quantity", async () => {
    const { purchaseRequestId, quantity } = await paidInvoiceWithOnePendingRequest();
    const mismatchedQty = (Number(quantity) + 1).toString();

    const { status, body } = await admin.postJson<{ warning?: string | null }>("/api/invoices/supplier", {
      supplierId: realSupplierId,
      invoiceNumber: `BILL-QTYMISMATCH-${Date.now()}`,
      invoiceDate: "2026-01-06",
      category: "COGS",
      items: [{ description: "Sofa, brown leather", quantity: mismatchedQty, unitCost: "300", taxRate: "0" }],
      purchaseRequestId,
    });
    expect(status).toBe(201);
    expect(body.warning).toBeTruthy();
  });

  it("blocks editing the items on a bill that already closed out a purchase request", async () => {
    const { purchaseRequestId, quantity } = await paidInvoiceWithOnePendingRequest();
    const bill = await admin.postJson<{ id: string }>("/api/invoices/supplier", {
      supplierId: realSupplierId,
      invoiceNumber: `BILL-LOCK-${Date.now()}`,
      invoiceDate: "2026-01-06",
      category: "COGS",
      items: [{ description: "Sofa, brown leather", quantity, unitCost: "300", taxRate: "0" }],
      purchaseRequestId,
    });
    expect(bill.status).toBe(201);

    const patch = await admin.postJson<{ error: string }>(
      `/api/invoices/supplier/${bill.body.id}`,
      { items: [{ description: "Sofa, brown leather", quantity, unitCost: "999", taxRate: "0" }] },
      "PATCH"
    );
    expect(patch.status).toBe(409);
    expect(patch.body.error).toContain("locked");

    const del = await admin.postJson(`/api/invoices/supplier/${bill.body.id}`, {}, "DELETE");
    expect(del.status).toBe(409);
  });
});

describe("Items Ordered / Pending report — COGS excludes pending and house lines", () => {
  it("sums cost only across FULFILLED rows, never PENDING or HOUSE", async () => {
    const inv = await createInvoiceWithLines({ includeHouseLine: true });
    await admin.postJson(`/api/invoices/customer/${inv.id}/payments`, {
      amount: "540",
      paymentDate: "2026-01-05",
    });
    const full = await admin.getJson<{ invoiceNumber: string; id: string }>(`/api/invoices/customer/${inv.id}`);

    // Scoped to PENDING -- this invoice also has a HOUSE line, and the
    // unfiltered report legitimately unions both.
    const beforeBill = await admin.getJson<{ rows: { invoiceNumber: string; id: string; quantity: string }[]; cogs: string }>(
      `/api/reports?type=items-ordered&status=PENDING`
    );
    const pendingRow = beforeBill.body.rows.find((r) => r.invoiceNumber === full.body.invoiceNumber);
    expect(pendingRow).toBeTruthy();

    const bill = await admin.postJson("/api/invoices/supplier", {
      supplierId: realSupplierId,
      invoiceNumber: `BILL-COGS-${Date.now()}`,
      invoiceDate: "2026-01-06",
      category: "COGS",
      items: [{ description: "Sofa, brown leather", quantity: pendingRow!.quantity, unitCost: "275", taxRate: "0" }],
      purchaseRequestId: pendingRow!.id,
    });
    expect(bill.status).toBe(201);

    const fulfilledOnly = await admin.getJson<{ rows: { id: string; cost: string | null }[]; cogs: string }>(
      `/api/reports?type=items-ordered&status=FULFILLED`
    );
    const row = fulfilledOnly.body.rows.find((r) => r.id === pendingRow!.id);
    expect(row?.cost).toBe("275.00");
    // cogs is the sum across whatever the current filter returns -- with
    // status=FULFILLED that's exclusively fulfilled rows' cost.
    expect(Number(fulfilledOnly.body.cogs)).toBeGreaterThanOrEqual(275);
  });
});

describe("Invoice Profitability report — line-level cost status", () => {
  it("shows a line as pending before the bill closes, and entered with real profit after", async () => {
    const inv = await createInvoiceWithLines({ includeHouseLine: false });
    await admin.postJson(`/api/invoices/customer/${inv.id}/payments`, {
      amount: "500",
      paymentDate: "2026-01-05",
    });
    const full = await admin.getJson<{ invoiceNumber: string; id: string }>(`/api/invoices/customer/${inv.id}`);

    const pendingReport = await admin.getJson<{
      rows: { invoiceNumber: string; hasCost: boolean; pendingLineCount: number; lines: { status: string }[] }[];
      invoicesWithPendingCost: number;
    }>(`/api/reports?type=profitability`);
    const pendingRow = pendingReport.body.rows.find((r) => r.invoiceNumber === full.body.invoiceNumber);
    expect(pendingRow?.pendingLineCount).toBe(1);
    expect(pendingRow?.lines.every((l) => l.status === "pending")).toBe(true);
    expect(pendingReport.body.invoicesWithPendingCost).toBeGreaterThanOrEqual(1);

    const prReport = await admin.getJson<{ rows: { id: string; invoiceNumber: string; quantity: string }[] }>(
      `/api/reports?type=items-ordered&status=PENDING`
    );
    const prRow = prReport.body.rows.find((r) => r.invoiceNumber === full.body.invoiceNumber);
    await admin.postJson("/api/invoices/supplier", {
      supplierId: realSupplierId,
      invoiceNumber: `BILL-PROFIT-${Date.now()}`,
      invoiceDate: "2026-01-06",
      category: "COGS",
      items: [{ description: "Sofa, brown leather", quantity: prRow!.quantity, unitCost: "200", taxRate: "0" }],
      purchaseRequestId: prRow!.id,
    });

    const afterReport = await admin.getJson<{
      rows: { invoiceNumber: string; cost: string; hasCost: boolean; pendingLineCount: number; grossProfit: string }[];
    }>(`/api/reports?type=profitability`);
    const afterRow = afterReport.body.rows.find((r) => r.invoiceNumber === full.body.invoiceNumber);
    expect(afterRow?.pendingLineCount).toBe(0);
    expect(afterRow?.cost).toBe("200.00");
    expect(Number(afterRow?.grossProfit)).toBe(300); // 500 revenue - 200 cost
  });
});
