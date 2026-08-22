import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/money";
import { requireAuth, checkRateLimit } from "@/lib/api";
import { initializeDatabase } from "@/lib/init-db";

function genToken() {
  return randomBytes(18).toString("base64url");
}

function baseUrl(req: Request) {
  const env = process.env.APP_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;
  const limited = checkRateLimit(request, "estimate-send", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  await initializeDatabase();

  const { id } = await params;

  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: { customer: true, items: true },
  });
  if (!estimate) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  if (!estimate.customer.email) {
    return NextResponse.json(
      { error: "Customer has no email address. Add one on the customer record first." },
      { status: 400 }
    );
  }

  let viewToken = estimate.viewToken;
  if (!viewToken) {
    viewToken = genToken();
    await prisma.estimate.update({ where: { id }, data: { viewToken } });
  }

  const link = `${baseUrl(request)}/estimate/${viewToken}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
      <h2 style="color:#c2410c;margin:0 0 8px">Estimate ${estimate.estimateNumber}</h2>
      <p style="margin:0 0 16px;color:#6b7280">From La Cuevita</p>
      <p>Hi ${estimate.customer.name},</p>
      <p>Here's the estimate you requested. Estimated total: <strong>${formatCurrency(estimate.totalAmount.toString())}</strong>.</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#c2410c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          View Estimate
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px">Reply to this email if you have any questions or would like to move forward.</p>
    </div>
  `;

  const result = await sendEmail({
    to: estimate.customer.email,
    subject: `Estimate ${estimate.estimateNumber} from La Cuevita`,
    html,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, link }, { status: 502 });
  }

  await prisma.estimate.update({
    where: { id },
    data: { sentAt: new Date(), status: estimate.status === "DRAFT" ? "SENT" : estimate.status },
  });

  return NextResponse.json({ ok: true, link });
}
