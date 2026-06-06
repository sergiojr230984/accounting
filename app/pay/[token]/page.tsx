import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/money";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invoice = await prisma.customerInvoice.findUnique({
    where: { viewToken: token },
    include: {
      customer: true,
      items: true,
      payments: { orderBy: { paymentDate: "desc" } },
    },
  });
  if (!invoice) notFound();

  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  const down = Number(invoice.downPayment);
  const balance = Math.max(total - paid - down, 0);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Brand header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-900">La Cuevita</p>
            <p className="text-xs text-gray-500">Accounting</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Invoice header */}
          <div className="p-8 border-b">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">Invoice</p>
                <h1 className="text-2xl font-bold text-gray-900 mt-1">{invoice.invoiceNumber}</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Issued {format(new Date(invoice.invoiceDate), "MMM d, yyyy")} · Due {format(new Date(invoice.dueDate), "MMM d, yyyy")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase text-gray-400">Amount due</p>
                <p className="text-3xl font-bold text-brand-700 mt-1">{formatCurrency(balance.toFixed(2))}</p>
              </div>
            </div>
          </div>

          {/* Bill to */}
          <div className="p-8 border-b">
            <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Bill to</p>
            <p className="font-medium text-gray-900">{invoice.customer.name}</p>
            {invoice.customer.email && <p className="text-sm text-gray-500">{invoice.customer.email}</p>}
            {invoice.customer.phone && <p className="text-sm text-gray-500">{invoice.customer.phone}</p>}
            {invoice.customer.address && <p className="text-sm text-gray-500 whitespace-pre-line">{invoice.customer.address}</p>}
          </div>

          {/* Items */}
          <div className="p-8 border-b">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="pb-2">Description</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">Price</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoice.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 text-gray-900">{item.description}</td>
                    <td className="py-2 text-right text-gray-700">{Number(item.quantity)}</td>
                    <td className="py-2 text-right text-gray-700">{formatCurrency(item.unitPrice.toString())}</td>
                    <td className="py-2 text-right font-medium text-gray-900">{formatCurrency(item.lineTotal.toString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-6 space-y-1.5 text-sm text-right ml-auto max-w-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>{formatCurrency(invoice.subtotal.toString())}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span>{formatCurrency(invoice.taxAmount.toString())}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
                <span>Total</span>
                <span>{formatCurrency(invoice.totalAmount.toString())}</span>
              </div>
              {down > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Down payment</span>
                  <span>−{formatCurrency(down.toFixed(2))}</span>
                </div>
              )}
              {paid > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Paid</span>
                  <span>−{formatCurrency(paid.toFixed(2))}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-brand-700 text-base border-t pt-2">
                <span>Balance due</span>
                <span>{formatCurrency(balance.toFixed(2))}</span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="p-8 border-b">
              <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-line">{invoice.notes}</p>
            </div>
          )}

          <div className="p-8 bg-gray-50">
            <p className="text-xs font-semibold uppercase text-gray-400 mb-2">How to pay</p>
            <p className="text-sm text-gray-700">
              Please contact us to arrange payment. Reference invoice number <strong>{invoice.invoiceNumber}</strong>.
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          This invoice is being viewed via a secure link. Do not share publicly.
        </p>
      </div>
    </div>
  );
}
