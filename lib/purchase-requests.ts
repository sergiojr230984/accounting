import type { PrismaClient } from "@prisma/client";

/**
 * Ensures a purchase_request exists for every eligible line item on a
 * customer invoice, once that invoice has a payment recorded (partial or
 * full -- both trigger the identical process, see the payments POST route
 * and the invoice PATCH route, the two write paths that can move
 * `paidAmount` off zero).
 *
 * Idempotent by design, not by a "was this the first payment" check at the
 * call site: `createMany({ skipDuplicates: true })` relies on
 * PurchaseRequest.customerInvoiceItemId's UNIQUE constraint, so calling this
 * again for an invoice that already has requests (the balance being paid
 * off, a retried/duplicate request, a double-click) safely no-ops on every
 * line that already has one. That's what actually delivers the fire-once
 * guarantee -- not "only call this on the very first payment."
 *
 * A line is skipped, not requested, when:
 * - It has no supplierId/partNumber at all (a row that predates this
 *   feature -- there's no supplier to route the request to).
 * - Its supplier is the HOUSE/in-stock entry (`isHouse: true`) -- nothing
 *   needs to be purchased externally for that line, by design (see the
 *   Supplier model's isHouse doc comment). HOUSE lines still show up in the
 *   Items Ordered / Pending report -- see app/api/reports/route.ts's
 *   `items-ordered` type, which unions them in separately since they never
 *   get a row here.
 *
 * Call this inside the same transaction as the payment/paidAmount write
 * that qualifies the invoice, so a purchase_request never exists without
 * the payment that earned it, or vice versa, even if either half fails.
 */
export async function ensurePurchaseRequestsForInvoice(
  tx: Pick<PrismaClient, "customerInvoiceItem" | "purchaseRequest">,
  customerInvoiceId: string
): Promise<void> {
  const items = await tx.customerInvoiceItem.findMany({
    where: { invoiceId: customerInvoiceId },
    include: { supplier: { select: { id: true, isHouse: true } } },
  });

  const toCreate = items
    .filter((item) => item.supplierId && item.partNumber && item.supplier && !item.supplier.isHouse)
    .map((item) => ({
      customerInvoiceId,
      customerInvoiceItemId: item.id,
      supplierId: item.supplierId as string,
      partNumber: item.partNumber as string,
      description: item.description,
      quantity: item.quantity,
    }));

  if (toCreate.length === 0) return;

  await tx.purchaseRequest.createMany({ data: toCreate, skipDuplicates: true });
}

/**
 * The reverse of ensurePurchaseRequestsForInvoice: once an invoice has no
 * money on it any more (paidAmount back to $0 -- the same field whose move
 * OFF zero created the requests), its still-PENDING purchase requests are
 * cancelled (deleted). Owner decision 2026-09-28: removing the payment
 * means the sale isn't confirmed, so purchasing shouldn't order for it.
 *
 * Only PENDING requests with no supplier bill are touched. A FULFILLED one
 * (purchasing already entered the supplier's bill and cost) is real
 * purchasing history and is always kept -- undoing that goes through the
 * bill's own delete flow, not this.
 *
 * Call it inside the same transaction as the write that brought
 * paidAmount to $0, on EVERY such path (payment delete, payment edit, the
 * invoice edit screen's Amount Paid) -- see the matching note on
 * ensurePurchaseRequestsForInvoice. Returns how many were cancelled.
 */
export async function cancelPendingPurchaseRequestsIfUnpaid(
  tx: Pick<PrismaClient, "customerInvoice" | "purchaseRequest">,
  customerInvoiceId: string
): Promise<number> {
  const invoice = await tx.customerInvoice.findUnique({
    where: { id: customerInvoiceId },
    select: { paidAmount: true },
  });
  if (!invoice || Number(invoice.paidAmount) > 0) return 0;
  const { count } = await tx.purchaseRequest.deleteMany({
    where: { customerInvoiceId, status: "PENDING", supplierInvoice: null },
  });
  return count;
}
