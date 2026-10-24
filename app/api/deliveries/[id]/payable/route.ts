import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api";
import { actorFromSession } from "@/lib/audit";
import { markSubcontractorPayable } from "@/lib/deliveries";

/** Gated: refuses with 400 if no proof (photo or override) exists yet (spec §5). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole("ADMIN", "MANAGER");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    const updated = await markSubcontractorPayable(id, actorFromSession(guard).actorName);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
