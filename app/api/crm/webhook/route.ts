import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyWebhookChallenge,
  parseIncomingMessages,
  type IncomingMessage,
} from "@/lib/whatsapp";
import {
  normalizePhone,
  assignLead,
  pickNextSalespersonRoundRobin,
  getCrmSetting,
} from "@/lib/crm";

/**
 * GET /api/crm/webhook
 * Handshake de verificación que hace Meta al registrar la URL del webhook.
 * Devuelve el hub.challenge si el verify token coincide.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const challenge = verifyWebhookChallenge(
    searchParams.get("hub.mode"),
    searchParams.get("hub.verify_token"),
    searchParams.get("hub.challenge")
  );

  if (challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  // Meta espera el challenge como texto plano
  return new NextResponse(challenge, { status: 200 });
}

/**
 * POST /api/crm/webhook
 * Recibe mensajes entrantes de WhatsApp. Crea o reutiliza el lead (anti-
 * duplicados por teléfono), guarda el mensaje y asigna vendedora.
 *
 * Responde siempre 200 rápido para que Meta no reintente; los errores se
 * registran pero no rompen la respuesta.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const messages = parseIncomingMessages(payload);

  for (const msg of messages) {
    try {
      await handleIncoming(msg);
    } catch (err) {
      // No reventamos el webhook por un mensaje individual fallido
      console.error("Error procesando mensaje de WhatsApp:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleIncoming(msg: IncomingMessage) {
  // Dedupe: si ya guardamos este mensaje (Meta reintenta), salimos.
  const dup = await prisma.leadMessage.findUnique({
    where: { waMessageId: msg.waMessageId },
  });
  if (dup) return;

  const phone = normalizePhone(msg.from);

  // ¿A qué vendedora le escribió el cliente? (según el phone_number_id destino)
  const targetSalesperson = msg.toPhoneNumberId
    ? await prisma.user.findUnique({
        where: { whatsappPhoneNumberId: msg.toPhoneNumberId },
        select: { id: true },
      })
    : null;

  // Anti-duplicados de lead: reutilizamos el lead si el teléfono ya existe.
  let lead = await prisma.lead.findUnique({ where: { phone } });
  let isNewLead = false;

  if (!lead) {
    isNewLead = true;
    lead = await prisma.lead.create({
      data: {
        name: msg.profileName || phone,
        phone,
        source: "WHATSAPP",
        status: "NEW",
        entryDate: msg.timestamp,
      },
    });
  }

  // Guardamos el mensaje entrante y actualizamos la vista previa del lead
  await prisma.$transaction([
    prisma.leadMessage.create({
      data: {
        leadId: lead.id,
        direction: "INBOUND",
        body: msg.text,
        waMessageId: msg.waMessageId,
        fromNumber: phone,
        toNumber: msg.toPhoneNumberId || null,
        timestamp: msg.timestamp,
      },
    }),
    prisma.lead.update({
      where: { id: lead.id },
      data: { lastMessageAt: msg.timestamp, lastMessageText: msg.text.slice(0, 280) },
    }),
  ]);

  // Asignación solo para leads nuevos (o leads sin vendedora):
  if (!lead.assignedToId) {
    if (targetSalesperson) {
      // El cliente escribió al WhatsApp de una vendedora concreta → es suya
      await assignLead(lead.id, targetSalesperson.id, null, "whatsapp_inbound");
    } else if (isNewLead) {
      const setting = await getCrmSetting();
      if (setting.assignmentMode === "ROUND_ROBIN") {
        const next = await pickNextSalespersonRoundRobin();
        if (next) await assignLead(lead.id, next, null, "round_robin");
      }
    }
  }
}
