import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { submitDeliveryOutcome, checkTokenValidity, EXCEPTION_REASON_LABELS } from "@/lib/deliveries";
import type { DeliveryExceptionReason } from "@prisma/client";

const VALID_REASONS = new Set(Object.keys(EXCEPTION_REASON_LABELS));

/**
 * Public, unauthenticated submission endpoint for the crew/subcontractor
 * upload page (spec §2). No session, no login -- the token itself (checked
 * below via checkTokenValidity) is the only gate. Rate-limited both per-IP
 * and per-token so a leaked/guessed token can't be hammered even though it
 * needs no password.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const ipLimited = checkRateLimit(request, "delivery-submit", { windowMs: 60_000, max: 20 });
  if (ipLimited) return ipLimited;

  const { token } = await params;
  const tokenLimit = rateLimit(`delivery-submit-token:${token}`, { windowMs: 10 * 60_000, max: 20 });
  if (!tokenLimit.ok) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }

  const delivery = await prisma.delivery.findUnique({
    where: { token },
    include: { customerInvoice: { select: { invoiceNumber: true } }, assignedCrewEmployee: { select: { name: true } } },
  });
  if (!delivery) return NextResponse.json({ error: "Enlace no válido." }, { status: 404 });

  const validity = checkTokenValidity(delivery);
  if (!validity.ok) {
    const messages: Record<string, string> = {
      revoked: "Este enlace fue revocado por la oficina.",
      expired: "Este enlace ya expiró.",
      already_delivered: "Esta entrega ya fue marcada como entregada.",
    };
    return NextResponse.json({ error: messages[validity.reason] }, { status: 410 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const outcome = formData.get("outcome");
  if (outcome !== "DELIVERED" && outcome !== "EXCEPTION") {
    return NextResponse.json({ error: "Resultado no válido." }, { status: 400 });
  }

  const photoFiles = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const photos = await Promise.all(
    photoFiles.map(async (f) => ({
      buffer: Buffer.from(await f.arrayBuffer()),
      mimeType: f.type,
      originalName: f.name,
    }))
  );

  let exceptionReason: DeliveryExceptionReason | undefined;
  if (outcome === "EXCEPTION") {
    const raw = formData.get("exceptionReason");
    if (typeof raw !== "string" || !VALID_REASONS.has(raw)) {
      return NextResponse.json({ error: "Selecciona un motivo." }, { status: 400 });
    }
    exceptionReason = raw as DeliveryExceptionReason;
  }

  const exceptionNoteRaw = formData.get("exceptionNote");
  const exceptionNote = typeof exceptionNoteRaw === "string" ? exceptionNoteRaw.slice(0, 2000) : undefined;

  let voiceNote: { buffer: Buffer; mimeType: string } | null = null;
  const voiceFile = formData.get("voiceNote");
  if (voiceFile instanceof File && voiceFile.size > 0) {
    voiceNote = { buffer: Buffer.from(await voiceFile.arrayBuffer()), mimeType: voiceFile.type };
  }

  let gps: { lat: number; lng: number } | null = null;
  const latRaw = formData.get("gpsLat");
  const lngRaw = formData.get("gpsLng");
  if (typeof latRaw === "string" && typeof lngRaw === "string") {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (Number.isFinite(lat) && Number.isFinite(lng)) gps = { lat, lng };
  }

  const actorType = delivery.tokenKind === "SUBCONTRACTOR" ? "SUBCONTRACTOR_LINK" : "CREW_LINK";
  const actorLabel =
    delivery.tokenKind === "SUBCONTRACTOR"
      ? delivery.assignedSubcontractorName || "Subcontratista"
      : delivery.assignedCrewEmployee?.name || "Equipo";

  const result = await submitDeliveryOutcome(delivery.id, {
    outcome,
    photos,
    exceptionReason,
    exceptionNote,
    voiceNote,
    gps,
    actorType,
    actorLabel,
    invoiceNumber: delivery.customerInvoice.invoiceNumber,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, status: result.delivery.status });
}
