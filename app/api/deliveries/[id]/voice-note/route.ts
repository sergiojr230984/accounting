import { NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";
import { deliveryFileAbsolutePath } from "@/lib/delivery-storage";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const delivery = await prisma.delivery.findUnique({ where: { id }, select: { exceptionVoiceNotePath: true } });
  if (!delivery?.exceptionVoiceNotePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const buffer = await fs.readFile(deliveryFileAbsolutePath(delivery.exceptionVoiceNotePath));
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "audio/webm" } });
  } catch {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }
}
