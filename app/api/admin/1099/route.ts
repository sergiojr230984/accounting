import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { writeAuditLog, extractMeta, actorFromSession } from "@/lib/audit";
import Decimal from "decimal.js";

const IRS_THRESHOLD = new Decimal("600.00");

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdmin(session)) {
    await writeAuditLog({
      ...actorFromSession(session),
      action: "ACCESS_DENIED",
      entityType: "report_1099",
      entityLabel: "1099 Contractor Report",
      ...extractMeta(request),
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()));
  const exportCsv = searchParams.get("export") === "csv";
  const includeTin = searchParams.get("includeTin") === "true";

  const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
  const endDate = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  // Get all 1099 contractors
  const contractors = await prisma.supplier.findMany({
    where: { is1099Contractor: true },
    include: {
      invoices: {
        include: {
          payments: {
            where: {
              paymentDate: { gte: startDate, lt: endDate },
              // Exclude card payments (processor handles 1099-K)
              paymentMethod: { not: "card" },
            },
          },
        },
      },
    },
  });

  // Log TIN view
  await writeAuditLog({
    ...actorFromSession(session),
    action: "TIN_VIEW",
    entityType: "report_1099",
    entityLabel: `1099 Report ${year}${includeTin ? " (with TINs)" : ""}`,
    ...extractMeta(request),
  });

  const { decryptTin, maskTin } = await import("@/lib/tin-crypto");

  const rows = contractors.map((contractor) => {
    const totalPaid = contractor.invoices
      .flatMap((inv) => inv.payments)
      .reduce((sum, p) => sum.plus(new Decimal(p.amount.toString())), new Decimal(0));

    let tinDisplay = "—";
    if (contractor.taxId) {
      if (includeTin) {
        try {
          tinDisplay = decryptTin(contractor.taxId);
        } catch {
          tinDisplay = "[decrypt error]";
        }
      } else {
        try {
          tinDisplay = maskTin(decryptTin(contractor.taxId));
        } catch {
          tinDisplay = "***-**-****";
        }
      }
    }

    return {
      id: contractor.id,
      name: contractor.name,
      legalName: contractor.legalName ?? contractor.name,
      businessAddress: contractor.businessAddress ?? contractor.address ?? "",
      tin: tinDisplay,
      taxIdType: contractor.taxIdType ?? "—",
      w9OnFile: contractor.w9OnFile,
      totalPaid: totalPaid.toFixed(2),
      meetsThreshold: totalPaid.gte(IRS_THRESHOLD),
      missingTin: !contractor.taxId,
      missingW9: !contractor.w9OnFile,
      default1099Box: contractor.default1099Box ?? "NEC_BOX_1",
    };
  });

  if (exportCsv) {
    await writeAuditLog({
      ...actorFromSession(session),
      action: "EXPORT",
      entityType: "report_1099",
      entityLabel: `1099 CSV Export ${year}`,
      ...extractMeta(request),
    });

    const header = "Name,Legal Name,Address,TIN,TIN Type,W-9 on File,Total Paid,Meets $600 Threshold,Missing TIN,Missing W-9\n";
    const csvRows = rows
      .map((r) =>
        [
          `"${r.name}"`,
          `"${r.legalName}"`,
          `"${r.businessAddress}"`,
          `"${r.tin}"`,
          r.taxIdType,
          r.w9OnFile ? "Yes" : "No",
          r.totalPaid,
          r.meetsThreshold ? "Yes" : "No",
          r.missingTin ? "Yes" : "No",
          r.missingW9 ? "Yes" : "No",
        ].join(",")
      )
      .join("\n");

    return new Response(header + csvRows, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="1099-contractors-${year}.csv"`,
      },
    });
  }

  return NextResponse.json({ year, contractors: rows, irsThreshold: IRS_THRESHOLD.toFixed(2) });
}
