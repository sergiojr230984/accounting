import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const results: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    results.connection = "ok";
  } catch (err) {
    results.connection = err instanceof Error ? err.message : String(err);
  }

  try {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Customer' ORDER BY column_name
    `;
    results.customerColumns = cols.map((c) => c.column_name).join(", ");
  } catch (err) {
    results.customerColumns = err instanceof Error ? err.message : String(err);
  }

  try {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Supplier' ORDER BY column_name
    `;
    results.supplierColumns = cols.map((c) => c.column_name).join(", ");
  } catch (err) {
    results.supplierColumns = err instanceof Error ? err.message : String(err);
  }

  try {
    const test = await prisma.customer.create({
      data: { name: "__test__" },
    });
    await prisma.customer.delete({ where: { id: test.id } });
    results.customerCreate = "ok";
  } catch (err) {
    results.customerCreate = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results);
}
