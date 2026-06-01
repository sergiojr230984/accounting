import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { isAdmin, getCrmSetting } from "@/lib/crm";

const schema = z.object({
  assignmentMode: z.enum(["MANUAL", "ROUND_ROBIN"]),
});

/** GET /api/crm/settings — configuración del CRM (modo de asignación). */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const setting = await getCrmSetting();
  return NextResponse.json(setting);
}

/** PATCH /api/crm/settings — cambia el modo de asignación. Solo ADMIN. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const setting = await prisma.crmSetting.upsert({
    where: { id: "singleton" },
    update: { assignmentMode: parsed.data.assignmentMode },
    create: { id: "singleton", assignmentMode: parsed.data.assignmentMode },
  });

  return NextResponse.json(setting);
}
