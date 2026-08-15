import { describe, it, expect, beforeAll } from "vitest";
import { loginAs, TestSession } from "./helpers/client";

let admin: TestSession;
let customerId: string;
let supplierId: string;

beforeAll(async () => {
  admin = await loginAs("admin@lacuevita.com", "admin123");

  const custRes = await admin.postJson<{ id: string }>("/api/customers", {
    name: "Ledger Test Customer",
  });
  customerId = custRes.body.id;

  const supRes = await admin.postJson<{ id: string }>("/api/suppliers", {
    name: "Ledger Test Supplier",
  });
  supplierId = supRes.body.id;
});

type LedgerResponse = {
  openingBalance: string;
  closingBalance: string;
  transactions: {
    date: string;
    description: string;
    debit: string | null;
    credit: string | null;
    balance: string;
    invoiceId: string;
    invoiceType: "customer" | "supplier";
  }[];
};

describe("account transactions report — accounts receivable", () => {
  it("debits an invoice, credits a payment, and carries a running balance", async () => {
    const invoiceNumber = `AR-LEDGER-${Date.now()}`;
    const created = await admin.postJson<{ id: string }>("/api/invoices/customer", {
      customerId,
      invoiceNumber,
      invoiceDate: "2026-02-01",
      dueDate: "2026-02-28",
      items: [{ description: "Service", quantity: "1", unitPrice: "500" }],
    });
    expect(created.status).toBe(201);
    const invoiceId = created.body.id;

    const payment = await admin.postJson(`/api/invoices/customer/${invoiceId}/payments`, {
      amount: "200",
      paymentDate: "2026-02-10",
    });
    expect(payment.status).toBe(201);

    const { status, body } = await admin.getJson<LedgerResponse>(
      `/api/reports?type=account-transactions&account=receivable&contactId=${customerId}&from=2026-02-01&to=2026-02-28`
    );

    expect(status).toBe(200);
    expect(body.openingBalance).toBe("0.00");
    expect(body.transactions).toHaveLength(2);
    expect(body.transactions[0]).toMatchObject({ debit: "500.00", credit: null, balance: "500.00", invoiceType: "customer" });
    expect(body.transactions[1]).toMatchObject({ debit: null, credit: "200.00", balance: "300.00" });
    expect(body.closingBalance).toBe("300.00");
  });

  it("carries prior-period activity into the opening balance instead of dropping it", async () => {
    const invoiceNumber = `AR-OPEN-${Date.now()}`;
    const created = await admin.postJson("/api/invoices/customer", {
      customerId,
      invoiceNumber,
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      items: [{ description: "Prior period", quantity: "1", unitPrice: "1000" }],
    });
    expect(created.status).toBe(201);

    const { body } = await admin.getJson<LedgerResponse>(
      `/api/reports?type=account-transactions&account=receivable&contactId=${customerId}&from=2026-02-01&to=2026-02-28`
    );
    // Only the Jan 1 invoice (1000) predates the Feb window, so it's the
    // only thing folded into the opening balance -- the Feb 1 invoice and
    // Feb 10 payment from the previous test still land inside the window
    // as their own transaction rows, unchanged.
    expect(body.openingBalance).toBe("1000.00");
    expect(body.transactions).toHaveLength(2);
  });
});

describe("account transactions report — accounts payable", () => {
  it("credits a bill and debits its cumulative paidAmount as a synthesized payment entry", async () => {
    const invoiceNumber = `AP-LEDGER-${Date.now()}`;
    const created = await admin.postJson<{ id: string }>("/api/invoices/supplier", {
      supplierId,
      invoiceNumber,
      invoiceDate: "2026-03-01",
      category: "OPERATING_EXPENSE",
      items: [{ description: "Supplies", quantity: "1", unitCost: "300" }],
    });
    expect(created.status).toBe(201);
    const invoiceId = created.body.id;

    const patch = await admin.postJson(`/api/invoices/supplier/${invoiceId}`, { paidAmount: "120" }, "PATCH");
    expect(patch.status).toBe(200);

    // The synthesized payment entry is dated at the bill's updatedAt --
    // i.e. whenever the PATCH actually ran (now), not the bill's original
    // invoiceDate -- so the query window has to stay open-ended on `to`
    // to catch it.
    const { status, body } = await admin.getJson<LedgerResponse>(
      `/api/reports?type=account-transactions&account=payable&contactId=${supplierId}&from=2026-03-01`
    );

    expect(status).toBe(200);
    expect(body.openingBalance).toBe("0.00");
    expect(body.transactions).toHaveLength(2);
    expect(body.transactions[0]).toMatchObject({ debit: null, credit: "300.00", balance: "300.00", invoiceType: "supplier" });
    expect(body.transactions[1]).toMatchObject({ debit: "120.00", credit: null, balance: "180.00" });
    expect(body.closingBalance).toBe("180.00");
  });

  it("omits a payment entry for a bill that hasn't been paid at all", async () => {
    const invoiceNumber = `AP-UNPAID-${Date.now()}`;
    const created = await admin.postJson<{ id: string }>("/api/invoices/supplier", {
      supplierId,
      invoiceNumber,
      invoiceDate: "2026-03-02",
      category: "OPERATING_EXPENSE",
      items: [{ description: "Unpaid supplies", quantity: "1", unitCost: "75" }],
    });
    expect(created.status).toBe(201);

    const { body } = await admin.getJson<LedgerResponse>(
      `/api/reports?type=account-transactions&account=payable&contactId=${supplierId}&from=2026-03-02&to=2026-03-02`
    );
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]).toMatchObject({ debit: null, credit: "75.00" });
  });
});

describe("account transactions report — all contacts", () => {
  it("combines every customer's activity when no contactId is passed", async () => {
    const { status, body } = await admin.getJson<LedgerResponse>(
      `/api/reports?type=account-transactions&account=receivable&from=2026-01-01&to=2026-02-28`
    );
    expect(status).toBe(200);
    expect(body.transactions.length).toBeGreaterThanOrEqual(3);
  });
});
