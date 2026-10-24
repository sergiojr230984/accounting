import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { checkTokenValidity } from "@/lib/deliveries";
import { CheckCircle2, XCircle } from "lucide-react";
import DeliveryUploadForm from "./DeliveryUploadForm";

// Public page, no login (spec §1). The select below is the actual security
// boundary for §6's "must not expose price, balance, or any other customer
// data" -- notice there is no unitPrice/lineTotal/totalAmount/paidAmount
// anywhere in it, only what a crew member needs to find the right house and
// know what's on the truck.
export default async function DeliveryUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const delivery = await prisma.delivery.findUnique({
    where: { token },
    select: {
      id: true,
      status: true,
      tokenRevokedAt: true,
      tokenKind: true,
      windowStart: true,
      windowEnd: true,
      customerInvoice: {
        select: {
          invoiceNumber: true,
          customerAddress: true,
          customer: { select: { name: true, address: true } },
          items: { select: { id: true, description: true, itemDescription: true, quantity: true } },
        },
      },
    },
  });
  if (!delivery) notFound();

  const firstName = delivery.customerInvoice.customer.name.trim().split(/\s+/)[0] || delivery.customerInvoice.customer.name;
  const address = delivery.customerInvoice.customerAddress ?? delivery.customerInvoice.customer.address ?? "";

  const validity = checkTokenValidity(delivery);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-bold text-gray-900 text-center mb-1">Entrega — {delivery.customerInvoice.invoiceNumber}</h1>
        <p className="text-center text-gray-500 text-sm mb-6">Para: {firstName}</p>

        {!validity.ok && validity.reason === "already_delivered" && (
          <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-gray-900">Ya entregado</p>
            <p className="text-sm text-gray-500 mt-1">Esta entrega ya fue registrada. ¡Gracias!</p>
          </div>
        )}

        {!validity.ok && validity.reason !== "already_delivered" && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6 text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-gray-900">
              {validity.reason === "revoked" ? "Enlace revocado" : "Enlace expirado"}
            </p>
            <p className="text-sm text-gray-500 mt-1">Contacta a la oficina si necesitas ayuda.</p>
          </div>
        )}

        {validity.ok && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
              <p className="text-xs font-semibold uppercase text-gray-400 mb-1">Dirección</p>
              <p className="text-gray-900 mb-4 whitespace-pre-line">{address}</p>

              {(delivery.windowStart || delivery.windowEnd) && (
                <>
                  <p className="text-xs font-semibold uppercase text-gray-400 mb-1">Horario</p>
                  <p className="text-gray-900 mb-4">
                    {delivery.windowStart?.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
                    {delivery.windowEnd ? ` – ${delivery.windowEnd.toLocaleString("es", { timeStyle: "short" })}` : ""}
                  </p>
                </>
              )}

              <p className="text-xs font-semibold uppercase text-gray-400 mb-1">Artículos</p>
              <ul className="text-gray-900 text-sm space-y-1">
                {delivery.customerInvoice.items.map((item) => (
                  <li key={item.id}>
                    {Number(item.quantity)}× {item.description}
                    {item.itemDescription ? ` — ${item.itemDescription}` : ""}
                  </li>
                ))}
              </ul>
            </div>

            <DeliveryUploadForm token={token} />
          </>
        )}
      </div>
    </div>
  );
}
