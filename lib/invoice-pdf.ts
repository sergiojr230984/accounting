import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { formatCurrency } from "./money";

export interface InvoicePDFData {
  invoiceNumber: string;
  invoiceDate: string | Date;
  dueDate: string | Date;
  subtotal: string | number;
  taxAmount: string | number;
  totalAmount: string | number;
  paidAmount: string | number;
  downPayment: string | number;
  notes: string | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  items: {
    description: string;
    quantity: string | number;
    unitPrice: string | number;
    taxRate: string | number;
    lineTotal: string | number;
  }[];
}

export function generateInvoicePDF(invoice: InvoicePDFData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  // Brand header (orange band)
  doc.setFillColor(234, 88, 12); // brand-600 (#ea580c)
  doc.rect(0, 0, pageWidth, 8, "F");

  // Company / brand
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(124, 45, 18); // brand-900
  doc.text("La Cuevita", margin, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text("Accounting", margin, 76);

  // Invoice title (right side)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(31, 41, 55);
  doc.text("INVOICE", pageWidth - margin, 56, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`# ${invoice.invoiceNumber}`, pageWidth - margin, 74, { align: "right" });

  // Meta block (dates)
  const metaY = 110;
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175);
  doc.text("ISSUE DATE", pageWidth - margin - 140, metaY);
  doc.text("DUE DATE", pageWidth - margin, metaY, { align: "right" });
  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "bold");
  doc.text(format(new Date(invoice.invoiceDate), "MMM d, yyyy"), pageWidth - margin - 140, metaY + 14);
  doc.text(format(new Date(invoice.dueDate), "MMM d, yyyy"), pageWidth - margin, metaY + 14, { align: "right" });

  // Bill To
  let cursorY = metaY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175);
  doc.text("BILL TO", margin, cursorY);
  cursorY += 14;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(31, 41, 55);
  doc.text(invoice.customer.name, margin, cursorY);
  cursorY += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  if (invoice.customer.email) {
    doc.text(invoice.customer.email, margin, cursorY);
    cursorY += 12;
  }
  if (invoice.customer.phone) {
    doc.text(invoice.customer.phone, margin, cursorY);
    cursorY += 12;
  }
  if (invoice.customer.address) {
    const lines = doc.splitTextToSize(invoice.customer.address, 220);
    doc.text(lines, margin, cursorY);
    cursorY += lines.length * 12;
  }

  // Items table
  const tableStartY = Math.max(cursorY, 180) + 16;
  autoTable(doc, {
    startY: tableStartY,
    head: [["Description", "Qty", "Unit price", "Tax", "Amount"]],
    body: invoice.items.map((i) => [
      i.description,
      String(i.quantity),
      formatCurrency(String(i.unitPrice)),
      `${(Number(i.taxRate) * 100).toFixed(0)}%`,
      formatCurrency(String(i.lineTotal)),
    ]),
    margin: { left: margin, right: margin },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 7 },
    headStyles: { fillColor: [249, 250, 251], textColor: [55, 65, 81], fontStyle: "bold", lineColor: [229, 231, 235], lineWidth: 0.5 },
    bodyStyles: { textColor: [31, 41, 55], lineColor: [243, 244, 246], lineWidth: 0.5 },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right", cellWidth: 50 },
      2: { halign: "right", cellWidth: 80 },
      3: { halign: "right", cellWidth: 50 },
      4: { halign: "right", cellWidth: 80, fontStyle: "bold" },
    },
  });

  // Totals
  const afterTableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  const labelX = pageWidth - margin - 160;
  const valueX = pageWidth - margin;
  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  const down = Number(invoice.downPayment);
  const balance = Math.max(total - paid - down, 0);

  let totalsY = afterTableY;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);
  doc.text("Subtotal", labelX, totalsY);
  doc.setTextColor(31, 41, 55);
  doc.text(formatCurrency(String(invoice.subtotal)), valueX, totalsY, { align: "right" });
  totalsY += 16;

  doc.setTextColor(107, 114, 128);
  doc.text("Tax", labelX, totalsY);
  doc.setTextColor(31, 41, 55);
  doc.text(formatCurrency(String(invoice.taxAmount)), valueX, totalsY, { align: "right" });
  totalsY += 16;

  // Separator
  doc.setDrawColor(229, 231, 235);
  doc.line(labelX, totalsY - 6, valueX, totalsY - 6);
  totalsY += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(31, 41, 55);
  doc.text("Total", labelX, totalsY);
  doc.text(formatCurrency(String(invoice.totalAmount)), valueX, totalsY, { align: "right" });
  totalsY += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (down > 0) {
    doc.setTextColor(21, 128, 61);
    doc.text("Down payment", labelX, totalsY);
    doc.text(`−${formatCurrency(down.toFixed(2))}`, valueX, totalsY, { align: "right" });
    totalsY += 16;
  }
  if (paid > 0) {
    doc.setTextColor(21, 128, 61);
    doc.text("Paid", labelX, totalsY);
    doc.text(`−${formatCurrency(paid.toFixed(2))}`, valueX, totalsY, { align: "right" });
    totalsY += 16;
  }
  doc.setDrawColor(229, 231, 235);
  doc.line(labelX, totalsY - 6, valueX, totalsY - 6);
  totalsY += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(194, 65, 12); // brand-700
  doc.text("Balance due", labelX, totalsY);
  doc.text(formatCurrency(balance.toFixed(2)), valueX, totalsY, { align: "right" });
  totalsY += 24;

  // Notes
  if (invoice.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text("NOTES", margin, totalsY);
    totalsY += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81);
    const noteLines = doc.splitTextToSize(invoice.notes, pageWidth - margin * 2);
    doc.text(noteLines, margin, totalsY);
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 32;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text("Generated by La Cuevita Accounting", pageWidth / 2, footerY, { align: "center" });

  return doc;
}
