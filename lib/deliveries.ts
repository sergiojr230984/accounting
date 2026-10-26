import { randomBytes } from "crypto";
import type { PrismaClient, Delivery, DeliveryExceptionReason, DeliveryStatus, DeliveryTokenKind } from "@prisma/client";
import { prisma } from "./prisma";
import { scheduleDeliveryEvent, appendDeliveredToEvent, type DeliveredAttachment } from "./google-calendar";
import { uploadDeliveryPhoto } from "./google-drive";
import { saveDeliveryPhoto, saveDeliveryVoiceNote, validatePhoto, validateVoiceNote } from "./delivery-storage";

/** 256 bits, base64url -- well over the spec's 128-bit floor, never derived from the invoice number (spec §6). */
export function generateDeliveryToken(): string {
  return randomBytes(32).toString("base64url");
}

export const EXCEPTION_REASON_LABELS: Record<DeliveryExceptionReason, string> = {
  CLIENTE_AUSENTE: "Cliente ausente",
  DIRECCION_INCORRECTA: "Dirección incorrecta",
  ACCESO_IMPOSIBLE: "Acceso imposible",
  PRODUCTO_DANADO: "Producto dañado",
  CLIENTE_RECHAZO: "Cliente rechazó",
  OTRO: "Otro",
};

/**
 * Auto-creates this invoice's Delivery row the moment it has a line item
 * whose own description mentions "delivery" -- fire-once, idempotent, same
 * pattern as lib/purchase-requests.ts's ensurePurchaseRequestsForInvoice
 * (the @unique on customerInvoiceId is the actual guarantee, not this
 * existence check, which is only a fast path). Call from both the invoice
 * POST and PATCH routes, unconditionally -- unlike purchase requests this is
 * NOT gated on payment: "PAID != delivered" is the whole point of this
 * feature, so scheduling/tracking must work before any money has changed
 * hands.
 *
 * Deliberately a plain keyword match on the line's own free-typed
 * description ("Delivery", "Delivery + Armada", ...), not tied to a
 * specific Product or its isDeliveryService flag: staff pick/type whatever
 * matches the furniture, and the line that represents the delivery itself
 * is reliably the one that says so. The part number and supplier fields are
 * never checked. "Pick up in store" or any line that doesn't say the word
 * does not trigger it.
 */
export async function ensureDeliveryForInvoice(
  tx: Pick<PrismaClient, "customerInvoiceItem" | "delivery">,
  customerInvoiceId: string
): Promise<void> {
  const existing = await tx.delivery.findUnique({ where: { customerInvoiceId }, select: { id: true } });
  if (existing) return;

  const items = await tx.customerInvoiceItem.findMany({
    where: { invoiceId: customerInvoiceId },
    select: { description: true },
  });
  if (items.length === 0) return;

  const hasDeliveryLine = items.some((item) => item.description.toLowerCase().includes("delivery"));
  if (!hasDeliveryLine) return;

  try {
    await tx.delivery.create({
      data: {
        customerInvoiceId,
        token: generateDeliveryToken(),
      },
    });
  } catch (e) {
    // P2002 (unique violation on customerInvoiceId) means a concurrent call
    // already created it -- that's the fire-once guarantee working as
    // intended, not an error.
    const code = (e as { code?: string })?.code;
    if (code !== "P2002") throw e;
  }
}

export type TokenInvalidReason = "revoked" | "expired" | "already_delivered";

export function checkTokenValidity(
  delivery: Pick<Delivery, "tokenRevokedAt" | "tokenKind" | "windowEnd" | "status">
): { ok: true } | { ok: false; reason: TokenInvalidReason } {
  if (delivery.tokenRevokedAt) return { ok: false, reason: "revoked" };
  if (delivery.status === "DELIVERED") return { ok: false, reason: "already_delivered" };
  if (delivery.tokenKind === "SUBCONTRACTOR" && delivery.windowEnd) {
    const expiresAt = new Date(delivery.windowEnd.getTime() + 24 * 60 * 60 * 1000);
    if (new Date() > expiresAt) return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

async function writeHistory(
  tx: Pick<PrismaClient, "deliveryStatusHistory">,
  deliveryId: string,
  fromStatus: DeliveryStatus,
  toStatus: DeliveryStatus,
  actorType: "OFFICE_USER" | "CREW_LINK" | "SUBCONTRACTOR_LINK",
  actorLabel: string,
  reason?: string | null
) {
  await tx.deliveryStatusHistory.create({
    data: { deliveryId, fromStatus, toStatus, actorType, actorLabel, reason: reason ?? null },
  });
}

export interface ScheduleInput {
  windowStart: Date;
  windowEnd: Date;
  assignedCrewEmployeeId?: string | null;
  assignedSubcontractorName?: string | null;
  subcontractorCost?: string | null;
  invoiceNumber: string;
  customerFirstName: string;
  deliveryAddress: string;
  publicLinkUrl: string;
  timeZone: string;
  actorLabel: string;
}

/**
 * Office action: set/move the delivery window and crew/subcontractor
 * assignment, then create or move the Calendar event (spec §1, §4). If a
 * delivery that was ALREADY assigned to someone gets reassigned (including
 * a crew<->subcontractor swap), the token is regenerated -- the previous
 * holder of the link should not keep access to a job that's no longer
 * theirs. The very first scheduling of a brand-new delivery does NOT rotate
 * it, since that link (spec §1: "generated at creation") may already be on
 * a printed route sheet before the office finishes assigning anyone.
 */
export async function scheduleDelivery(deliveryId: string, input: ScheduleInput): Promise<Delivery> {
  const current = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });

  const tokenKind: DeliveryTokenKind = input.assignedSubcontractorName ? "SUBCONTRACTOR" : "CREW";
  const hadPriorAssignment = !!current.assignedCrewEmployeeId || !!current.assignedSubcontractorName;
  const assignmentChanged =
    current.assignedCrewEmployeeId !== (input.assignedCrewEmployeeId ?? null) ||
    current.assignedSubcontractorName !== (input.assignedSubcontractorName ?? null);
  // Only a genuine REASSIGNMENT rotates the token (a previous holder losing
  // access to a job that's no longer theirs) -- the very first scheduling
  // of a brand-new delivery must NOT rotate it, since the link generated at
  // creation (spec §1) may already be printed on a route sheet or shown as
  // a QR before the office finishes assigning a crew/subcontractor to it.
  const shouldRotateToken = hadPriorAssignment && assignmentChanged;

  const summary = `Entrega - ${input.invoiceNumber} - ${input.customerFirstName}`;
  const description = [
    `Cliente: ${input.customerFirstName}`,
    `Factura: ${input.invoiceNumber}`,
    `Dirección: ${input.deliveryAddress}`,
    `Subir foto de entrega: ${input.publicLinkUrl}`,
  ].join("\n");

  const calendarEventId = await scheduleDeliveryEvent({
    existingEventId: current.calendarEventId,
    summary,
    description,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    timeZone: input.timeZone,
  });

  const fromStatus = current.status;
  const toStatus: DeliveryStatus = "SCHEDULED";

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        scheduledDate: input.windowStart,
        assignedCrewEmployeeId: input.assignedCrewEmployeeId ?? null,
        assignedSubcontractorName: input.assignedSubcontractorName ?? null,
        subcontractorCost: input.subcontractorCost ?? null,
        tokenKind,
        token: shouldRotateToken ? generateDeliveryToken() : current.token,
        calendarEventId: calendarEventId ?? current.calendarEventId,
        status: toStatus,
      },
    });
    await writeHistory(tx, deliveryId, fromStatus, toStatus, "OFFICE_USER", input.actorLabel);
    return result;
  });

  return updated;
}

export async function revokeDeliveryToken(deliveryId: string, actorLabel: string): Promise<Delivery> {
  return prisma.delivery.update({ where: { id: deliveryId }, data: { tokenRevokedAt: new Date() } }).then(async (d) => {
    await prisma.deliveryStatusHistory.create({
      data: {
        deliveryId,
        fromStatus: d.status,
        toStatus: d.status,
        actorType: "OFFICE_USER",
        actorLabel,
        reason: "Link revocado manualmente",
      },
    });
    return d;
  });
}

export async function regenerateDeliveryToken(deliveryId: string, actorLabel: string): Promise<Delivery> {
  const token = generateDeliveryToken();
  const d = await prisma.delivery.update({
    where: { id: deliveryId },
    data: { token, tokenRevokedAt: null },
  });
  await prisma.deliveryStatusHistory.create({
    data: { deliveryId, fromStatus: d.status, toStatus: d.status, actorType: "OFFICE_USER", actorLabel, reason: "Link regenerado" },
  });
  return d;
}

interface IncomingPhoto {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface SubmitOutcomeInput {
  outcome: "DELIVERED" | "EXCEPTION";
  photos: IncomingPhoto[];
  exceptionReason?: DeliveryExceptionReason;
  exceptionNote?: string;
  voiceNote?: { buffer: Buffer; mimeType: string } | null;
  gps?: { lat: number; lng: number } | null;
  actorType: "CREW_LINK" | "SUBCONTRACTOR_LINK";
  actorLabel: string;
  invoiceNumber: string;
}

export type SubmitOutcomeResult =
  | { ok: true; delivery: Delivery }
  | { ok: false; error: string };

/**
 * The public upload page's one write path (spec §2-3). DELIVERED requires
 * >=1 photo (enforced here, not just client-side -- the client check is a
 * UX nicety, this is the actual guarantee); EXCEPTION requires a reason
 * from the fixed enum. Saves photos locally first (always succeeds or the
 * whole submission fails -- this is the record that must never be lost),
 * then best-effort mirrors to Drive and writes the calendar back; neither
 * of those can fail the submission itself.
 */
export async function submitDeliveryOutcome(deliveryId: string, input: SubmitOutcomeInput): Promise<SubmitOutcomeResult> {
  if (input.outcome === "DELIVERED" && input.photos.length === 0) {
    return { ok: false, error: "Se requiere al menos una foto para marcar como entregado." };
  }
  if (input.outcome === "EXCEPTION" && !input.exceptionReason) {
    return { ok: false, error: "Se requiere un motivo." };
  }
  for (const photo of input.photos) {
    const v = validatePhoto(photo.mimeType, photo.buffer.length);
    if (!v.ok) return { ok: false, error: v.error! };
  }
  if (input.voiceNote) {
    const v = validateVoiceNote(input.voiceNote.mimeType, input.voiceNote.buffer.length);
    if (!v.ok) return { ok: false, error: v.error! };
  }

  const current = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!current) return { ok: false, error: "Entrega no encontrada." };

  const validity = checkTokenValidity(current);
  if (!validity.ok) {
    return { ok: false, error: validity.reason === "already_delivered" ? "Ya fue marcada como entregada." : "Este enlace ya no es válido." };
  }

  const deliveredAt = new Date();

  // Save locally first -- this is the non-optional record; Drive/Calendar
  // below are best-effort mirrors layered on top of it.
  const savedPhotos = await Promise.all(
    input.photos.map(async (p) => {
      const saved = await saveDeliveryPhoto(p.buffer, p.mimeType);
      return { ...saved, mimeType: p.mimeType, size: p.buffer.length, originalName: p.originalName, buffer: p.buffer };
    })
  );
  let voiceNotePath: string | null = null;
  if (input.voiceNote) {
    const saved = await saveDeliveryVoiceNote(input.voiceNote.buffer, input.voiceNote.mimeType);
    voiceNotePath = saved.relativePath;
  }

  const fromStatus = current.status;
  const toStatus: DeliveryStatus = input.outcome;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.delivery.update({
      where: { id: deliveryId },
      data:
        input.outcome === "DELIVERED"
          ? { status: "DELIVERED", deliveredAt }
          : { status: "EXCEPTION", exceptionReason: input.exceptionReason, exceptionNote: input.exceptionNote ?? null, exceptionVoiceNotePath: voiceNotePath },
    });
    if (savedPhotos.length > 0) {
      await tx.deliveryPhoto.createMany({
        data: savedPhotos.map((p) => ({
          deliveryId,
          originalName: p.originalName,
          storedName: p.storedName,
          mimeType: p.mimeType,
          size: p.size,
          path: p.relativePath,
          gpsLat: input.gps?.lat ?? null,
          gpsLng: input.gps?.lng ?? null,
        })),
      });
    }
    await writeHistory(
      tx,
      deliveryId,
      fromStatus,
      toStatus,
      input.actorType,
      input.actorLabel,
      input.outcome === "EXCEPTION" ? EXCEPTION_REASON_LABELS[input.exceptionReason!] : undefined
    );
    return result;
  });

  // Best-effort from here on -- never throws, never blocks the response the
  // crew sees. Runs synchronously (not fire-and-forget) so acceptance
  // criterion #2's "within 1 minute" the calendar event shows ENTREGADO is
  // actually true by the time this function returns, not just eventually.
  if (input.outcome === "DELIVERED" && current.calendarEventId) {
    try {
      const driveResults = await Promise.all(
        savedPhotos.map((p, i) => uploadDeliveryPhoto(p.buffer, input.invoiceNumber, i + 1, p.mimeType, deliveredAt))
      );
      const successful = driveResults.filter((r): r is NonNullable<typeof r> => r !== null);
      if (successful.length < savedPhotos.length) {
        console.error(
          `[deliveries] ${savedPhotos.length - successful.length}/${savedPhotos.length} photo(s) failed to upload to Drive for delivery ${deliveryId} -- local copies are intact.`
        );
      }
      if (successful.length > 0) {
        await Promise.all(
          successful.map((r, i) =>
            prisma.deliveryPhoto
              .updateMany({
                where: { deliveryId, storedName: savedPhotos[i].storedName },
                data: { driveFileId: r.fileId, driveWebViewLink: r.webViewLink },
              })
              .catch(() => undefined)
          )
        );
      }

      const attachments: DeliveredAttachment[] = successful.map((r, i) => ({
        fileId: r.fileId,
        fileUrl: r.webViewLink,
        title: `PO${input.invoiceNumber}_${i + 1}`,
        mimeType: savedPhotos[i]?.mimeType ?? "image/jpeg",
      }));
      const primaryLink = successful[0]?.webViewLink ?? null;
      await appendDeliveredToEvent(current.calendarEventId, deliveredAt, primaryLink, attachments);
    } catch (e) {
      console.error(`[deliveries] Drive/Calendar write-back failed for delivery ${deliveryId}:`, e);
    }
  }

  return { ok: true, delivery: updated };
}

export interface OverrideInput {
  reason: string;
  actorLabel: string;
}

/** Manager override (spec §3): mark Delivered without a photo. Reason is mandatory and lands in history, never silently. */
export async function overrideMarkDelivered(deliveryId: string, input: OverrideInput): Promise<Delivery> {
  if (!input.reason.trim()) throw new Error("A reason is required for a manager override.");
  const current = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const deliveredAt = new Date();
  return prisma.$transaction(async (tx) => {
    const result = await tx.delivery.update({
      where: { id: deliveryId },
      data: { status: "DELIVERED", deliveredAt, overrideReason: input.reason.trim() },
    });
    await writeHistory(tx, deliveryId, current.status, "DELIVERED", "OFFICE_USER", input.actorLabel, `Override: ${input.reason.trim()}`);
    return result;
  });
}

/** Gated: can only flip true once proof exists (>=1 photo, or a recorded override) -- spec §5. */
export async function markSubcontractorPayable(deliveryId: string, actorLabel: string): Promise<Delivery> {
  const delivery = await prisma.delivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: { photos: { take: 1 } },
  });
  const hasProof = delivery.photos.length > 0 || !!delivery.overrideReason;
  if (!hasProof) throw new Error("No proof of delivery exists for this delivery yet.");
  return prisma.$transaction(async (tx) => {
    const result = await tx.delivery.update({
      where: { id: deliveryId },
      data: { subcontractorPayable: true, subcontractorPayableAt: new Date() },
    });
    await writeHistory(tx, deliveryId, result.status, result.status, "OFFICE_USER", actorLabel, "Marcado como pagable al subcontratista");
    return result;
  });
}
