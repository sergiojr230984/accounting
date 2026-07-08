import Decimal from "decimal.js";
import { formatDateOnly } from "@/lib/date";
import PaymentBadge from "@/components/PaymentBadge";

interface PreviewItem {
  description: string;
  quantity: string;
  price: string;
  taxRate: string;
}

interface InvoiceDocumentPreviewProps {
  docType: "INVOICE" | "BILL";
  number: string;
  date: string;
  dueDate?: string;
  partyLabel: string;
  partyName: string;
  partyEmail?: string | null;
  partyPhone?: string | null;
  partyAddress?: string | null;
  priceLabel: string;
  items: PreviewItem[];
  fees?: { label: string; amount: string }[];
  notes?: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  paidAmount: string;
}

function safeDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export default function InvoiceDocumentPreview({
  docType,
  number,
  date,
  dueDate,
  partyLabel,
  partyName,
  partyEmail,
  partyPhone,
  partyAddress,
  priceLabel,
  items,
  fees,
  notes,
  paymentStatus,
  paidAmount,
}: InvoiceDocumentPreviewProps) {
  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);

  const lines = items.map((item) => {
    let lineTotal = new Decimal(0);
    let lineTax = new Decimal(0);
    try {
      const qty = new Decimal(item.quantity || "0");
      const price = new Decimal(item.price || "0");
      const rate = new Decimal(item.taxRate || "0");
      lineTotal = qty.times(price);
      lineTax = lineTotal.times(rate);
      subtotal = subtotal.plus(lineTotal);
      taxAmount = taxAmount.plus(lineTax);
    } catch {
      // ignore unparsable rows while the user is still typing
    }
    return { ...item, lineTotal };
  });

  let feesTotal = new Decimal(0);
  for (const fee of fees ?? []) {
    try {
      feesTotal = feesTotal.plus(new Decimal(fee.amount || "0"));
    } catch {
      // ignore unparsable fee amount
    }
  }

  const total = subtotal.plus(taxAmount).plus(feesTotal);
  const paid = (() => {
    try {
      return new Decimal(paidAmount || "0");
    } catch {
      return new Decimal(0);
    }
  })();
  const balanceDue = total.minus(paid);

  const invoiceDate = safeDate(date);
  const paymentDueDate = safeDate(dueDate);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Preview</h2>
        <PaymentBadge status={paymentStatus} />
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div className="text-sm text-gray-500">
            <p className="font-semibold text-gray-800">{partyLabel}</p>
            <p className="mt-1">{partyName || <span className="text-gray-300">—</span>}</p>
            {partyAddress && <p>{partyAddress}</p>}
            {partyEmail && <p>{partyEmail}</p>}
            {partyPhone && <p>{partyPhone}</p>}
          </div>
          <div className="text-right">
            <h3 className="text-xl font-bold tracking-wide text-gray-800">{docType}</h3>
            <div className="mt-2 text-sm text-gray-500 space-y-0.5">
              <p><span className="text-gray-400">Number:</span> {number || "—"}</p>
              <p><span className="text-gray-400">Date:</span> {invoiceDate ? formatDateOnly(invoiceDate) : "—"}</p>
              {dueDate !== undefined && (
                <p><span className="text-gray-400">Due:</span> {paymentDueDate ? formatDateOnly(paymentDueDate) : "—"}</p>
              )}
            </div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr className="text-left">
              <th className="px-6 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">{priceLabel}</th>
              <th className="px-3 py-2 font-medium text-right">Tax</th>
              <th className="px-6 py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-gray-300">No items yet</td>
              </tr>
            )}
            {lines.map((item, i) => (
              <tr key={i}>
                <td className="px-6 py-2">{item.description || <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-right">{item.quantity || "0"}</td>
                <td className="px-3 py-2 text-right">${item.price || "0"}</td>
                <td className="px-3 py-2 text-right">{((parseFloat(item.taxRate) || 0) * 100).toFixed(0)}%</td>
                <td className="px-6 py-2 text-right font-medium">${item.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-6 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tax</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
            {(fees ?? []).map((fee, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-gray-500">{fee.label}</span>
                <span>${new Decimal(fee.amount || "0").toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold text-base border-t pt-2">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-green-600">
              <span>Paid</span>
              <span>${paid.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold text-red-600">
              <span>Balance Due</span>
              <span>${balanceDue.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {notes && (
          <div className="px-6 pb-6 text-xs text-gray-500 border-t border-gray-100 pt-4 whitespace-pre-wrap">
            {notes}
          </div>
        )}
      </div>
    </div>
  );
}
