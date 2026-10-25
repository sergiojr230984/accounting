import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { actorFromSession } from "@/lib/audit";
import { revokeDeliveryToken } from "@/lib/deliveries";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    const updated = await revokeDeliveryToken(id, actorFromSession(guard).actorName);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
