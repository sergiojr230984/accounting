import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";

export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const estimate = await prisma.estimate.findUnique({
    where: { viewToken: token },
    include: { customer: true, items: true },
  });
  if (!estimate) notFound();

  const profile = await prisma.companyProfile.findUnique({ where: { id: "default" } }).catch(() => null);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Brand header */}
        <div className="flex items-center gap-3 mb-6">
          {profile?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.logo} alt={profile.name ?? "Logo"} className="h-10 w-auto max-w-[160px] object-contain" />
          ) : (
            <>
              <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-gray-900">{profile?.name ?? "La Cuevita"}</p>
                <p className="text-xs text-gray-500">Accounting</p>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Estimate header */}
          <div className="p-8 border-b">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">Estimate</p>
                <h1 className="text-2xl font-bold text-gray-900 mt-1">{estimate.estimateNumber}</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Prepared {formatDateOnly(estimate.estimateDate)}
                  {estimate.expiryDate && <> · Valid until {formatDateOnly(estimate.expiryDate)}</>}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase text-gray-400">Estimated total</p>
                <p className="text-3xl font-bold text-brand-700 mt-1">{formatCurrency(estimate.totalAmount.toString())}</p>
              </div>
            </div>
          </div>

          {/* Prepared for */}
          <div className="p-8 border-b">
            <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Prepared for</p>
            <p className="font-medium text-gray-900">{estimate.customer.name}</p>
            {estimate.customer.email && <p className="text-sm text-gray-500">{estimate.customer.email}</p>}
            {estimate.customer.phone && <p className="text-sm text-gray-500">{estimate.customer.phone}</p>}
            {estimate.customer.address && <p className="text-sm text-gray-500 whitespace-pre-line">{estimate.customer.address}</p>}
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
                {estimate.items.map((item) => (
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
                <span>{formatCurrency(estimate.subtotal.toString())}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax</span>
                <span>{formatCurrency(estimate.taxAmount.toString())}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
                <span>Estimated Total</span>
                <span>{formatCurrency(estimate.totalAmount.toString())}</span>
              </div>
            </div>
          </div>

          {estimate.notes && (
            <div className="p-8 border-b">
              <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-line">{estimate.notes}</p>
            </div>
          )}

          <div className="p-8 bg-gray-50">
            <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Ready to move forward?</p>
            <p className="text-sm text-gray-700">
              This is an estimate, not a bill — nothing is due yet. Contact us to confirm and we&apos;ll turn this into an invoice.
              Reference estimate number <strong>{estimate.estimateNumber}</strong>.
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          This estimate is being viewed via a secure link. Do not share publicly.
        </p>
      </div>
    </div>
  );
}
