import { Resend } from "resend";

let cached: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (!cached) cached = new Resend(key);
  return cached;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const c = client();
  if (!c) {
    return {
      ok: false,
      error:
        "Email is not configured. Set the RESEND_API_KEY environment variable in Railway to enable sending.",
    };
  }
  const from = process.env.EMAIL_FROM?.trim() || "La Cuevita Accounting <onboarding@resend.dev>";
  try {
    const res = await c.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, id: res.data?.id ?? "" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
