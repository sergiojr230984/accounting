import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

// Increase body size limit for PDF uploads and allow longer AI response time
export const maxDuration = 60;

const CUSTOMER_SYSTEM = `You are an invoice data extractor. Extract structured data from the invoice and return ONLY valid JSON, no other text.

Return this exact structure:
{
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "customerName": "the buyer/bill-to company name or null",
  "items": [
    {
      "description": "item description",
      "quantity": "number as string e.g. 1",
      "unitPrice": "price per unit as string e.g. 125.00",
      "taxRate": "decimal rate as string e.g. 0.08 for 8%, default 0"
    }
  ],
  "notes": "any extra notes or null"
}

Rules:
- All numbers must be plain strings without currency symbols
- Dates must be YYYY-MM-DD format
- taxRate is a decimal (0.08 means 8%)
- If tax is a single total line, estimate the rate from the subtotal
- Return empty array for items if none found`;

const SUPPLIER_SYSTEM = `You are an invoice data extractor. Extract structured data from the invoice and return ONLY valid JSON, no other text.

Return this exact structure:
{
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "supplierName": "the seller/from company name or null",
  "category": "one of: COGS, SERVICES_EXPENSE, OPERATING_EXPENSE, OTHER",
  "items": [
    {
      "description": "item description",
      "quantity": "number as string e.g. 1",
      "unitCost": "cost per unit as string e.g. 50.00",
      "taxRate": "decimal rate as string e.g. 0.08 for 8%, default 0"
    }
  ],
  "notes": "any extra notes or null"
}

Category rules:
- COGS: raw materials, inventory, goods for resale, manufacturing supplies
- SERVICES_EXPENSE: software, cloud hosting, consulting, professional services
- OPERATING_EXPENSE: rent, utilities, office supplies, insurance, marketing
- OTHER: anything that does not clearly fit above

Rules:
- All numbers must be plain strings without currency symbols
- Dates must be YYYY-MM-DD format
- taxRate is a decimal (0.08 means 8%)`;

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it in Railway → Variables tab." },
      { status: 503 }
    );
  }

  // Initialize client inside handler so env var is always fresh
  const client = new Anthropic({ apiKey });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read uploaded file: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;
  const type = (formData.get("type") as string) ?? "customer";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const systemPrompt = type === "supplier" ? SUPPLIER_SYSTEM : CUSTOMER_SYSTEM;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messageContent: any[];

  if (file.type === "application/pdf") {
    messageContent = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      },
      { type: "text", text: "Extract all invoice data from this document." },
    ];
  } else if (["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) {
    const mediaType = file.type === "image/jpg" ? "image/jpeg" : file.type;
    messageContent = [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      },
      { type: "text", text: "Extract all invoice data from this image." },
    ];
  } else {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Use PDF, JPG, or PNG.` },
      { status: 400 }
    );
  }

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: messageContent }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not find invoice data in file. Try a clearer scan or different file." },
        { status: 422 }
      );
    }

    const extracted = JSON.parse(jsonMatch[0]);
    return NextResponse.json(extracted);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract] Anthropic error:", msg);
    return NextResponse.json({ error: `Extraction failed: ${msg}` }, { status: 500 });
  }
}
