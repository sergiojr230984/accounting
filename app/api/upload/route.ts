import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateFile, saveFile } from "@/lib/upload";
import { requireAuth, checkRateLimit } from "@/lib/api";

export async function POST(request: Request) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  // Cap uploads to 30 per minute per IP.
  const limited = checkRateLimit(request, "upload", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const customerInvoiceId = formData.get("customerInvoiceId") as string | null;
  const supplierInvoiceId = formData.get("supplierInvoiceId") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!customerInvoiceId && !supplierInvoiceId) {
    return NextResponse.json({ error: "Must specify an invoice to attach to" }, { status: 400 });
  }

  const validation = validateFile(file);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { storedName, filePath } = await saveFile(file);

  const uploaded = await prisma.uploadedFile.create({
    data: {
      originalName: file.name,
      storedName,
      mimeType: file.type,
      size: file.size,
      path: filePath,
      customerInvoiceId: customerInvoiceId ?? null,
      supplierInvoiceId: supplierInvoiceId ?? null,
    },
  });

  return NextResponse.json(uploaded, { status: 201 });
}
