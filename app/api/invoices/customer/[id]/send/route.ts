import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/money";
import { requireAuth, checkRateLimit } from "@/lib/api";

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
  // Anti-spam: cap emailing to 30 sends per minute per IP.
  const limited = checkRateLimit(request, "invoice-send", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  const { id } = await params;

  const invoice = await prisma.customerInvoice.findUnique({
    where: { id },
    include: { customer: true, items: true },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!invoice.customer.email) {
    return NextResponse.json(
      { error: "Customer has no email address. Add one on the customer record first." },
      { status: 400 }
    );
  }

  let viewToken = invoice.viewToken;
  if (!viewToken) {
    viewToken = genToken();
    await prisma.customerInvoice.update({ where: { id }, data: { viewToken } });
  }

  const link = `${baseUrl(request)}/pay/${viewToken}`;
  const balance = (
    Number(invoice.totalAmount) - Number(invoice.paidAmount) - Number(invoice.downPayment)
  ).toFixed(2);

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
      <h2 style="color:#c2410c;margin:0 0 8px">Invoice ${invoice.invoiceNumber}</h2>
      <p style="margin:0 0 16px;color:#6b7280">From La Cuevita Accounting</p>
      <p>Hi ${invoice.customer.name},</p>
      <p>Please find your invoice attached below. Total due: <strong>${formatCurrency(invoice.totalAmount.toString())}</strong>.</p>
      ${Number(invoice.downPayment) > 0
        ? `<p>Down payment recorded: ${formatCurrency(invoice.downPayment.toString())}. Remaining balance: <strong>${formatCurrency(balance)}</strong>.</p>`
        : ""}
      <p style="margin:24px 0">
        <a href="${link}" style="background:#ea580c;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          View invoice & pay
        </a>
      </p>
      <p style="color:#6b7280;font-size:14px">If the button doesn't work, copy this link: <br/><a href="${link}">${link}</a></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="color:#9ca3af;font-size:12px">Sent by La Cuevita Accounting</p>
    </div>
  `;

  const result = await sendEmail({
    to: invoice.customer.email,
    subject: `Invoice ${invoice.invoiceNumber} from La Cuevita`,
    html,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, viewToken, link }, { status: 502 });
  }

  await prisma.customerInvoice.update({
    where: { id },
    data: { sentAt: new Date() },
  });

  return NextResponse.json({ ok: true, link, messageId: result.id });
}
