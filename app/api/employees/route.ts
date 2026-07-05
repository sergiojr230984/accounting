import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const employees = await prisma.employee.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, commissionRate: true, active: true },
  });

  return NextResponse.json(employees);
}
