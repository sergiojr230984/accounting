import { describe, it, expect } from "vitest";
import { generateInvoicePDF, type InvoicePDFData } from "../lib/invoice-pdf";

/**
 * Pure unit tests -- generateInvoicePDF has no DB/network access, so unlike
 * every other file in this suite these don't need the HTTP server or
 * Postgres. jsPDF's default (uncompressed) output stream is plain text, so
 * asserting the "(PAID) Tj" content-stream operator is a reliable, direct
 * check that the stamp text was actually drawn -- not just that some code
 * path didn't throw.
 */

const base: InvoicePDFData = {
  invoiceNumber: "INV-2026-9001",
  invoiceDate: "2026-01-01",
  dueDate: "2026-01-31",
  subtotal: "100.00",
  taxAmount: "0.00",
  totalAmount: "100.00",
  paidAmount: "0.00",
  notes: null,
  customer: { name: "Test Customer", email: null, phone: null, address: null },
  items: [{ description: "Widget", quantity: "1", unitPrice: "100.00", taxRate: "0", lineTotal: "100.00" }],
  kind: "customer",
};

function pdfText(data: InvoicePDFData): string {
  return Buffer.from(generateInvoicePDF(data).output("arraybuffer")).toString("latin1");
}

describe("customer invoice PDF — PAID stamp", () => {
  it("stamps PAID with the latest payment's date when fully paid", () => {
    const text = pdfText({
      ...base,
      paidAmount: "100.00",
      paymentStatus: "PAID",
      payments: [
        { paymentDate: "2026-01-10", amount: "40.00" },
        { paymentDate: "2026-01-20", amount: "60.00" },
      ],
    });
    expect(text).toContain("(PAID) Tj");
    // The later of the two payments is what tipped the balance to zero --
    // the earlier one's date must not be what gets stamped.
    expect(text).toContain("(Jan 20, 2026) Tj");
    expect(text).not.toContain("(Jan 10, 2026) Tj");
  });

  it("stamps PAID with no date line when marked paid with no dated payment on file", () => {
    const text = pdfText({ ...base, paidAmount: "100.00", paymentStatus: "PAID", payments: [] });
    expect(text).toContain("(PAID) Tj");
  });

  it("does not stamp an unpaid invoice", () => {
    const text = pdfText({ ...base, paidAmount: "0.00", paymentStatus: "UNPAID" });
    expect(text).not.toContain("(PAID) Tj");
  });

  it("does not stamp a partially-paid invoice", () => {
    const text = pdfText({
      ...base,
      paidAmount: "40.00",
      paymentStatus: "PARTIALLY_PAID",
      payments: [{ paymentDate: "2026-01-10", amount: "40.00" }],
    });
    expect(text).not.toContain("(PAID) Tj");
  });

  // Deliberate: a supplier bill's PDF is this company's own AP record, not
  // something handed to anyone as proof of payment, and unlike a customer
  // invoice it has no dated Payment ledger to stamp a date from -- see the
  // doc comment on the stamp in lib/invoice-pdf.ts.
  it("does not stamp a fully-paid supplier bill (purchase order)", () => {
    const text = pdfText({ ...base, paidAmount: "100.00", paymentStatus: "PAID", kind: "supplier" });
    expect(text).not.toContain("(PAID) Tj");
  });

  // Deliberate: an estimate is never "paid" -- EstimateStatus has no PAID
  // value at all, but this guards against the field ever leaking through.
  it("does not stamp an estimate", () => {
    const text = pdfText({
      ...base,
      paidAmount: "100.00",
      paymentStatus: "PAID" as InvoicePDFData["paymentStatus"],
      kind: "estimate",
    });
    expect(text).not.toContain("(PAID) Tj");
  });
});
