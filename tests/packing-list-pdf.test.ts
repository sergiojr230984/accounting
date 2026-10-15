import { describe, it, expect } from "vitest";
import { generatePackingListPDF, type PackingListPDFData } from "../lib/packing-list-pdf";

/**
 * Pure unit tests, same approach as tests/invoice-pdf.test.ts: jsPDF's
 * default (uncompressed) output is plain text, so "(...) Tj" content-stream
 * operators show exactly what text was drawn.
 *
 * The packing list goes to the delivery department, who must not see what
 * the customer paid (owner request 2026-10-15) -- so beyond "the right
 * things are on it", the key assertion is that no money appears at all.
 */

const base: PackingListPDFData = {
  invoiceNumber: "Inv 1443",
  invoiceDate: "2026-10-14",
  notes: "cliente paga delivery solo dejar apto 7mo piso con elevador\ntelefono delivery 786 241 1180",
  customer: {
    name: "Moraima Ponce",
    phone: "786 229 2373",
    address: "2137 nw 36 st apto 705 Miami Fl 33142",
  },
  items: [
    { description: "sectional estacionario verena Kira left", itemCode: "HS/sectional gris left", quantity: "1" },
    { description: "delivery solo dejar", itemCode: "LC/delivery solo dejar", quantity: "1" },
  ],
  employee: { id: "e1", name: "Ali- SW" },
};

function pdfText(data: PackingListPDFData): string {
  return Buffer.from(generatePackingListPDF(data).output("arraybuffer")).toString("latin1");
}

// Only the strings actually drawn on the page (the "(...) Tj" text
// operators) -- the raw PDF also contains coordinates and object numbers,
// which can coincidentally include digits like "699".
function drawnText(data: PackingListPDFData): string {
  return Array.from(pdfText(data).matchAll(/\((.*?)\) Tj/g), (m) => m[1]).join("\n");
}

describe("packing list PDF", () => {
  it("prints the title, invoice number, delivery details, items, codes and quantities", () => {
    const text = pdfText(base);
    expect(text).toContain("(PACKING LIST) Tj");
    expect(text).toContain("(Inv 1443) Tj");
    expect(text).toContain("(Moraima Ponce) Tj");
    expect(text).toContain("2137 nw 36 st apto 705 Miami Fl 33142");
    expect(text).toContain("(786 229 2373) Tj");
    expect(text).toContain("sectional estacionario verena Kira left");
    expect(text).toContain("(HS/sectional gris left) Tj");
    expect(text).toContain("(LC/delivery solo dejar) Tj");
    expect(text).toContain("apto 7mo piso con elevador");
  });

  it("contains no prices, totals, balance or payment information", () => {
    // Even if a caller hands it a full invoice object (prices included),
    // nothing money-related may be drawn -- the function only reads the
    // fields PackingListPDFData declares.
    const withMoney = {
      ...base,
      subtotal: "769.00",
      taxAmount: "53.83",
      totalAmount: "822.83",
      paidAmount: "0.00",
      items: base.items.map((i, idx) => ({ ...i, unitPrice: idx === 0 ? "699.00" : "70.00", lineTotal: idx === 0 ? "699.00" : "70.00" })),
    } as unknown as PackingListPDFData;
    const text = drawnText(withMoney);
    expect(text).toContain("sectional estacionario verena Kira left");
    expect(text).not.toMatch(/\$\s*\d/);
    for (const amount of ["699", "769", "822.83", "53.83", "70.00"]) {
      expect(text).not.toContain(amount);
    }
    for (const word of ["Price", "Amount", "Subtotal", "Total", "Balance", "Tax", "Paid"]) {
      expect(text).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});
