import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canManageAll } from "@/lib/crm";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const schema = z.object({
  body: z.string().min(1),
});

/**
 * POST /api/crm/leads/[id]/messages
 * Envía un mensaje saliente al cliente por WhatsApp y lo guarda en el historial.
 * Si WhatsApp no está configurado, el mensaje se guarda igual (modo local).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const json = await request.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { assignedTo: true },
  });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Las vendedoras solo escriben a sus propios leads
  const role = (session.user as { role?: string }).role;
  if (!canManageAll(role) && lead.assignedToId !== session.user!.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let waMessageId: string | null = null;
  try {
    waMessageId = await sendWhatsAppMessage({
      to: lead.phone,
      body: parsed.data.body,
      // Envía desde el número de la vendedora asignada si lo tiene configurado
      phoneNumberId: lead.assignedTo?.whatsappPhoneNumberId ?? undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error enviando WhatsApp" },
      { status: 502 }
    );
  }

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.leadMessage.create({
      data: {
        leadId: id,
        direction: "OUTBOUND",
        body: parsed.data.body,
        waMessageId,
        fromNumber: lead.assignedTo?.whatsappNumber ?? null,
        toNumber: lead.phone,
        timestamp: now,
      },
    }),
    prisma.lead.update({
      where: { id },
      data: {
        lastMessageAt: now,
        // Al responder, si el lead estaba NEW, pasa a CONTACTED automáticamente
        ...(lead.status === "NEW" ? { status: "CONTACTED" } : {}),
      },
    }),
  ]);

  return NextResponse.json(message, { status: 201 });
}
