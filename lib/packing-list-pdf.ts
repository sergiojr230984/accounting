import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDateOnly } from "./date";
import {
  drawCompanyHeader,
  BG_GRAY,
  ORANGE,
  RULE_GRAY,
  TEXT_DARK,
  TEXT_LIGHT,
  TEXT_MID,
  type InvoicePDFData,
} from "./invoice-pdf";

/**
 * Packing list for the delivery department (owner request 2026-10-15):
 * what to load and where to take it, WITHOUT what the customer paid.
 *
 * Deliberately its own input type with no money fields at all -- not
 * InvoicePDFData with prices blanked out -- so a price can't leak onto the
 * delivery copy through a caller passing a whole invoice object, or through
 * a future change to the invoice layout. Only the fields declared here are
 * ever read (tests/packing-list-pdf.test.ts checks this with a full invoice
 * object, prices included).
 */
export interface PackingListPDFData {
  invoiceNumber: string;
  invoiceDate: string | Date;
  // Delivery instructions usually live in the invoice notes (floor,
  // elevator, delivery contact phone...).
  notes: string | null;
  // Where it's going: callers pass the invoice's own delivery address
  // (CustomerInvoice.customerAddress) when set, else the customer's.
  customer: {
    name: string;
    phone: string | null;
    address: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  };
  items: {
    description: string;
    itemDescription?: string | null;
    // `SUPPLIERCODE/PARTNUMBER`, pre-joined by the caller (same as the
    // invoice PDF).
    itemCode?: string | null;
    quantity: string | number;
  }[];
  company?: InvoicePDFData["company"];
  employee?: { id: string; name: string } | null;
}

export function generatePackingListPDF(data: PackingListPDFData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;

  // ─── HEADER ────────────────────────────────────
  const headerBottom = drawCompanyHeader(doc, data.company ?? null, margin);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(...TEXT_DARK);
  doc.text("PACKING LIST", pageWidth - margin, 64, { align: "right" });

  // ─── TWO-COLUMN META BLOCK ──────────────────────────────
  const metaTop = Math.max(headerBottom + 28, 132);
  const colGap = 24;
  const leftColX = margin;
  const leftColW = (pageWidth - margin * 2) * 0.55 - colGap / 2;
  const rightColX = margin + leftColW + colGap;

  // LEFT: DELIVER TO
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_LIGHT);
  doc.text("DELIVER TO", leftColX, metaTop);

  let leftY = metaTop + 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_DARK);
  doc.text(data.customer.name, leftColX, leftY);
  leftY += 15;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...TEXT_DARK);
  if (data.customer.address) {
    const lines = doc.splitTextToSize(data.customer.address, leftColW);
    doc.text(lines, leftColX, leftY);
    leftY += lines.length * 13;
  }
  if (data.customer.phone) {
    doc.text(data.customer.phone, leftColX, leftY);
    leftY += 13;
  }
  if (data.customer.emergencyContactName || data.customer.emergencyContactPhone) {
    leftY += 6;
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text("ALTERNATE CONTACT", leftColX, leftY);
    leftY += 11;
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_MID);
    doc.text(
      [data.customer.emergencyContactName, data.customer.emergencyContactPhone].filter(Boolean).join("  ·  "),
      leftColX,
      leftY
    );
    leftY += 12;
  }

  // RIGHT: reference details (no money)
  const pieces = data.items.reduce((sum, i) => {
    const n = parseFloat(String(i.quantity));
    return sum + (isFinite(n) ? n : 0);
  }, 0);
  const rows: { label: string; value: string }[] = [
    { label: "Invoice Number", value: data.invoiceNumber },
    { label: "Invoice Date", value: formatDateOnly(data.invoiceDate) },
    { label: "Sales Rep", value: data.employee?.name?.trim() || "—" },
    { label: "Pieces", value: String(Number.isInteger(pieces) ? pieces : pieces.toFixed(2)) },
  ];
  let rightY = metaTop;
  for (const r of rows) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text(r.label, rightColX, rightY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_DARK);
    doc.text(r.value, pageWidth - margin, rightY, { align: "right" });
    rightY += 18;
  }

  // ─── ITEMS TABLE ─────────────────────────────────────
  // Item / Code / Qty / a blank check-off box for whoever loads and
  // delivers. Never a price column.
  const itemDescs = data.items.map((i) => i.itemDescription?.trim() ?? "");
  autoTable(doc, {
    startY: Math.max(leftY, rightY) + 24,
    head: [["#", "Item", "Item Code", "Qty", "Check"]],
    body: data.items.map((i, idx) => [
      String(idx + 1),
      i.description,
      i.itemCode?.trim() || "—",
      String(i.quantity),
      "",
    ]),
    margin: { left: margin, right: margin },
    styles: { font: "helvetica", fontSize: 10, cellPadding: 9, valign: "middle" },
    headStyles: {
      fillColor: ORANGE,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 10,
      halign: "left",
      lineWidth: 0,
    },
    bodyStyles: { textColor: TEXT_DARK, lineColor: RULE_GRAY, lineWidth: 0.5 },
    columnStyles: {
      0: { cellWidth: 28, halign: "center", textColor: TEXT_MID },
      1: { cellWidth: "auto", fontStyle: "bold" },
      2: { cellWidth: 150, fontSize: 9 },
      3: { cellWidth: 44, halign: "center", fontStyle: "bold", fontSize: 12 },
      4: { cellWidth: 48, halign: "center" },
    },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    didParseCell: (cell) => {
      // Room for the secondary description line under the item name.
      if (cell.section === "body" && cell.column.index === 1 && itemDescs[cell.row.index]) {
        cell.cell.styles.minCellHeight = 36;
        cell.cell.styles.valign = "top";
      }
    },
    didDrawCell: (cell) => {
      if (cell.section !== "body") return;
      const c = cell.cell as unknown as { x: number; y: number; width: number; height: number };
      if (cell.column.index === 1) {
        const desc = itemDescs[cell.row.index];
        if (!desc) return;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT_MID);
        doc.text(doc.splitTextToSize(desc, c.width - 18), c.x + 9, c.y + c.height - 9);
      }
      if (cell.column.index === 4) {
        // Empty tick box.
        const size = 14;
        doc.setDrawColor(...TEXT_MID);
        doc.setLineWidth(0.8);
        doc.rect(c.x + (c.width - size) / 2, c.y + (c.height - size) / 2, size, size);
      }
    },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28;

  // ─── DELIVERY NOTES ────────────────────────────────────
  if (data.notes && data.notes.trim()) {
    if (y > pageHeight - 200) {
      doc.addPage();
      y = margin + 20;
    }
    const noteLines = data.notes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((l) => doc.splitTextToSize(l, pageWidth - margin * 2 - 24) as string[]);
    const boxH = 30 + noteLines.length * 13;
    doc.setFillColor(...BG_GRAY);
    doc.rect(margin, y - 4, pageWidth - margin * 2, boxH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_DARK);
    doc.text("Delivery Notes", margin + 12, y + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_DARK);
    doc.text(noteLines, margin + 12, y + 28);
    y += boxH + 20;
  }

  // ─── RECEIVED BY ────────────────────────────────────
  // Name / signature / date for the customer to confirm the items arrived.
  if (y > pageHeight - 110) {
    doc.addPage();
    y = margin + 20;
  }
  y = Math.max(y, pageHeight - 110);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MID);
  doc.text("Received in good condition by:", margin, y);
  y += 34;
  const fields = [
    { label: "Print Name", w: 190 },
    { label: "Customer Signature", w: 190 },
    { label: "Date", w: 90 },
  ];
  let x = margin;
  doc.setDrawColor(...TEXT_MID);
  doc.setLineWidth(0.5);
  for (const f of fields) {
    doc.line(x, y, x + f.w, y);
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text(f.label, x, y + 12);
    x += f.w + 22;
  }

  // ─── FOOTER (every page) ───────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text(`Page ${i} of ${pageCount} - Packing list for Invoice #${data.invoiceNumber}`, pageWidth / 2, pageHeight - 24, {
      align: "center",
    });
  }

  return doc;
}
