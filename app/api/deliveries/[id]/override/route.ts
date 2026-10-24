import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api";
import { actorFromSession } from "@/lib/audit";
import { overrideMarkDelivered } from "@/lib/deliveries";

const schema = z.object({ reason: z.string().min(1, "A reason is required.") });

/** Manager override: mark Delivered without a photo (spec §3). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole("ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const updated = await overrideMarkDelivered(id, { reason: parsed.data.reason, actorLabel: actorFromSession(guard).actorName });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
