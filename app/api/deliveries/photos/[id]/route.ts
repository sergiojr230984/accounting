import { NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";
import { deliveryFileAbsolutePath } from "@/lib/delivery-storage";

/**
 * Serves a delivery photo's bytes to signed-in staff only. Deliberately not
 * a static /public URL like this app's existing invoice-attachment
 * convention -- a delivery photo shows a customer's address/home, which
 * warrants real access control, not just an unguessable path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const photo = await prisma.deliveryPhoto.findUnique({ where: { id } });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const buffer = await fs.readFile(deliveryFileAbsolutePath(photo.path));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }
}
