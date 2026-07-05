import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";

/**
 * ASCII-only currency formatter for jsPDF text.
 */
function pdfCurrency(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!isFinite(n)) return "$0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100)
    .toString()
    .padStart(2, "0");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${wholeStr}.${cents}`;
}

export interface InvoicePDFData {
  invoiceNumber: string;
  invoiceDate: string | Date;
  dueDate: string | Date | null;
  subtotal: string | number;
  taxAmount: string | number;
  totalAmount: string | number;
  paidAmount: string | number;
  downPayment?: string | number;
  creditCardFee?: string | number;
  appliedFees?: { label: string; amount: string | number }[];
  notes: string | null;
  customer: {
    name: string;
    contactName?: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    zelle?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  };
  items: {
    description: string;
    itemDescription?: string | null;
    quantity: string | number;
    unitPrice?: string | number;
    unitCost?: string | number;
    taxRate: string | number;
    lineTotal: string | number;
  }[];
  payments?: {
    paymentDate: string | Date;
    amount: string | number;
    notes?: string | null;
  }[];
  company?: {
    name?: string | null;
    logo?: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
    creditCardFeeLabel?: string | null;
  } | null;
  employee?: { id: string; name: string } | null;
  kind?: "customer" | "supplier";
}

const ORANGE: [number, number, number] = [242, 106, 0];
const BRAND_DARK: [number, number, number] = [124, 45, 18];
const TEXT_DARK: [number, number, number] = [31, 41, 55];
const TEXT_MID: [number, number, number] = [75, 85, 99];
const TEXT_LIGHT: [number, number, number] = [156, 163, 175];
const BG_GRAY: [number, number, number] = [243, 244, 246];
const RULE_GRAY: [number, number, number] = [229, 231, 235];

export function generateInvoicePDF(invoice: InvoicePDFData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const isPO = invoice.kind === "supplier";

  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, pageWidth, 8, "F");

  const company = invoice.company ?? null;
  const hasLogo = Boolean(company?.logo);
  const companyName = company?.name?.trim() || "La Cuevita";

  let headerBottom = 30;
  if (hasLogo && company?.logo) {
    try {
      const mime = company.logo.match(/^data:(image\/[a-z+]+);/)?.[1] ?? "image/png";
      const fmt = mime.includes("png") ? "PNG" : mime.includes("svg") ? "SVG" : "JPEG";
      const maxW = 160;
      const maxH = 80;
      let drawW = maxW;
      let drawH = maxH;
      try {
        const props = doc.getImageProperties(company.logo);
        if (props.width && props.height) {
          const ratio = Math.min(maxW / props.width, maxH / props.height);
          drawW = props.width * ratio;
          drawH = props.height * ratio;
        }
      } catch {
        // SVG / probe failure — fall back to fixed box.
      }
      doc.addImage(company.logo, fmt, margin, 30, drawW, drawH, undefined, "FAST");
      headerBottom = 30 + drawH;
    } catch {
      // fall through to text-only header
    }
  }
  if (!hasLogo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...BRAND_DARK);
    doc.text(companyName, margin, 56);
    headerBottom = 64;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(isPO ? 28 : 36);
  doc.setTextColor(...TEXT_DARK);
  doc.text(isPO ? "PURCHASE ORDER" : "INVOICE", pageWidth - margin, 64, { align: "right" });

  const metaTop = Math.max(headerBottom + 28, 132);
  const colGap = 24;
  const leftColX = margin;
  const leftColW = (pageWidth - margin * 2) * 0.55 - colGap / 2;
  const rightColX = margin + leftColW + colGap;
  const rightColW = pageWidth - margin - rightColX;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_LIGHT);
  doc.text(isPO ? "VENDOR" : "BILL TO", leftColX, metaTop);

  let billY = metaTop + 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_DARK);
  doc.text(invoice.customer.name, leftColX, billY);
  billY += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...TEXT_MID);
  if (invoice.customer.contactName) {
    doc.text(invoice.customer.contactName, leftColX, billY);
    billY += 12;
  }
  if (invoice.customer.address) {
    const lines = doc.splitTextToSize(invoice.customer.address, leftColW);
    doc.text(lines, leftColX, billY);
    billY += lines.length * 12;
  }
  if (invoice.customer.phone) {
    doc.text(invoice.customer.phone, leftColX, billY);
    billY += 12;
  }
  if (invoice.customer.email) {
    doc.text(invoice.customer.email, leftColX, billY);
    billY += 12;
  }

  if (invoice.customer.zelle) {
    billY += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text("ZELLE", leftColX, billY);
    billY += 11;
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_MID);
    doc.text(invoice.customer.zelle, leftColX, billY);
    billY += 12;
  }

  if (invoice.customer.emergencyContactName || invoice.customer.emergencyContactPhone) {
    billY += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text("EMERGENCY CONTACT", leftColX, billY);
    billY += 11;
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_MID);
    const parts = [invoice.customer.emergencyContactName, invoice.customer.emergencyContactPhone]
      .filter(Boolean)
      .join("  ·  ");
    doc.text(parts, leftColX, billY);
    billY += 12;
  }

  const leftColBottom = billY;

  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  const down = Number(invoice.downPayment);
  const balance = Math.max(total - paid - down, 0);

  const rep = invoice.employee?.name?.trim() || "—";
  const rows: { label: string; value: string }[] = [
    { label: isPO ? "PO Number" : "Invoice Number", value: invoice.invoiceNumber },
    { label: "Sales Rep", value: rep },
    { label: "Invoice Date", value: format(new Date(invoice.invoiceDate), "MMM d, yyyy") },
    {
      label: isPO ? "Expected" : "Payment Due",
      value: invoice.dueDate ? format(new Date(invoice.dueDate), "MMM d, yyyy") : "On receipt",
    },
  ];

  let metaY = metaTop;
  for (const r of rows) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text(r.label, rightColX, metaY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_DARK);
    doc.text(r.value, pageWidth - margin, metaY, { align: "right" });
    metaY += 18;
  }

  metaY += 4;
  const boxH = 30;
  doc.setFillColor(...BG_GRAY);
  doc.rect(rightColX, metaY, rightColW, boxH, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MID);
  doc.text("Amount Due", rightColX + 12, metaY + 19);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...TEXT_DARK);
  doc.text(pdfCurrency(balance.toFixed(2)), pageWidth - margin - 12, metaY + 20, { align: "right" });
  metaY += boxH;

  const tableStartY = Math.max(leftColBottom, metaY) + 28;
  const priceHeader = isPO ? "Cost" : "Price";

  const itemDescs = invoice.items.map((i) => i.itemDescription?.trim() ?? "");

  autoTable(doc, {
    startY: tableStartY,
    head: [["Items", "Quantity", priceHeader, "Amount"]],
    body: invoice.items.map((i) => [
      i.description,
      String(i.quantity),
      pdfCurrency(String(i.unitPrice ?? i.unitCost ?? 0)),
      pdfCurrency(String(i.lineTotal)),
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
    bodyStyles: {
      textColor: TEXT_DARK,
      lineColor: RULE_GRAY,
      lineWidth: 0.5,
    },
    columnStyles: {
      0: { cellWidth: "auto", fontStyle: "bold" },
      1: { halign: "center", cellWidth: 70 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 90, fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        const desc = itemDescs[data.row.index];
        if (desc) {
          data.cell.styles.minCellHeight = 38;
        }
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 0) return;
      const desc = itemDescs[data.row.index];
      if (!desc) return;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...TEXT_MID);
      const maxW = (data.cell as unknown as { width: number }).width - 18;
      const lines = doc.splitTextToSize(desc, maxW);
      const cellX = (data.cell as unknown as { x: number }).x;
      const cellY = (data.cell as unknown as { y: number }).y;
      doc.text(lines, cellX + 9, cellY + 22);
    },
  });

  const afterTableY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  const labelX = pageWidth - margin - 220;
  const valueX = pageWidth - margin;

  let totalsY = afterTableY;
  const writeRow = (
    label: string,
    value: string,
    opts: { bold?: boolean; muted?: boolean; size?: number } = {}
  ) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(...(opts.muted ? TEXT_MID : TEXT_DARK));
    doc.text(label, labelX, totalsY);
    doc.text(value, valueX, totalsY, { align: "right" });
    totalsY += (opts.size ?? 10) + 6;
  };

  writeRow("Subtotal", pdfCurrency(String(invoice.subtotal)), { muted: true });
  writeRow("Tax", pdfCurrency(String(invoice.taxAmount)), { muted: true });

  const ccFee = Number(invoice.creditCardFee ?? 0);
  if (ccFee > 0) {
    writeRow(company?.creditCardFeeLabel ?? "Card processing fee", pdfCurrency(ccFee.toFixed(2)), { muted: true });
  }

  for (const fee of invoice.appliedFees ?? []) {
    const amt = Number(fee.amount);
    if (!isFinite(amt) || amt <= 0) continue;
    writeRow(fee.label, pdfCurrency(amt.toFixed(2)), { muted: true });
  }

  doc.setDrawColor(...RULE_GRAY);
  doc.line(labelX, totalsY - 8, valueX, totalsY - 8);
  totalsY += 2;
  writeRow("Total", pdfCurrency(String(invoice.totalAmount)), { bold: true, size: 11 });

  if (down > 0) {
    writeRow("Down Payment", "-" + pdfCurrency(down.toFixed(2)), { muted: true });
  }

  const payments = invoice.payments ?? [];
  const paymentSum = payments.reduce((acc, p) => acc + Number(p.amount), 0);
  if (payments.length > 0) {
    for (const p of payments) {
      const dateStr = format(new Date(p.paymentDate), "MMM d, yyyy");
      const label = p.notes?.trim()
        ? `Payment on ${dateStr} using ${p.notes.trim()}:`
        : `Payment on ${dateStr}:`;
      writeRow(label, "-" + pdfCurrency(String(p.amount)), { muted: true });
    }
    const leftover = paid - paymentSum;
    if (leftover > 0.005) {
      writeRow("Payment Received", "-" + pdfCurrency(leftover.toFixed(2)), { muted: true });
    }
  } else if (paid > 0) {
    writeRow("Payment Received", "-" + pdfCurrency(paid.toFixed(2)), { muted: true });
  }

  doc.setDrawColor(...RULE_GRAY);
  doc.line(labelX, totalsY - 8, valueX, totalsY - 8);
  totalsY += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_DARK);
  doc.text("Balance Due", labelX, totalsY);
  doc.text(pdfCurrency(balance.toFixed(2)), valueX, totalsY, { align: "right" });
  totalsY += 30;

  if (invoice.notes && invoice.notes.trim()) {
    if (totalsY > pageHeight - 200) {
      doc.addPage();
      totalsY = margin + 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_DARK);
    doc.text("Notes / Terms", margin, totalsY);
    totalsY += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_MID);

    const noteLines = invoice.notes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of noteLines) {
      if (totalsY > pageHeight - 100) {
        doc.addPage();
        totalsY = margin + 20;
      }
      const wrapped = doc.splitTextToSize(line, pageWidth - margin * 2 - 14);
      doc.text("•", margin, totalsY);
      doc.text(wrapped, margin + 14, totalsY);
      totalsY += wrapped.length * 12 + 2;
    }
    totalsY += 12;
  }

  if (!isPO) {
    if (totalsY > pageHeight - 80) {
      doc.addPage();
      totalsY = margin + 20;
    }
    totalsY = Math.max(totalsY, pageHeight - 80);
    const sigLineW = 220;
    doc.setDrawColor(...TEXT_MID);
    doc.setLineWidth(0.5);
    doc.line(margin, totalsY, margin + sigLineW, totalsY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text("Customer Signature", margin, totalsY + 12);
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_LIGHT);
    doc.text(
      `Page ${i} of ${pageCount} for Invoice #${invoice.invoiceNumber}`,
      pageWidth / 2,
      pageHeight - 24,
      { align: "center" }
    );
  }

  return doc;
}
