import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
- If tax is shown as a single total, estimate a rate from the subtotal
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
- SERVICES_EXPENSE: software subscriptions, cloud hosting, consulting, professional services
- OPERATING_EXPENSE: rent, utilities, office supplies, insurance, marketing
- OTHER: anything that doesn't clearly fit above

Rules:
- All numbers must be plain strings without currency symbols
- Dates must be YYYY-MM-DD format
- taxRate is a decimal (0.08 means 8%)`;

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured. Add it in Railway → Variables." },
      { status: 503 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const type = (formData.get("type") as string) ?? "customer";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const systemPrompt = type === "supplier" ? SUPPLIER_SYSTEM : CUSTOMER_SYSTEM;

  let messageContent: Anthropic.MessageParam["content"];

  if (file.type === "application/pdf") {
    // Send PDF natively to Claude — no pdf-parse needed
    messageContent = [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      } as unknown as Anthropic.TextBlockParam,
      {
        type: "text",
        text: "Extract all invoice data from this document.",
      },
    ];
  } else if (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp"
  ) {
    messageContent = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: file.type as "image/jpeg" | "image/png" | "image/webp",
          data: base64,
        },
      },
      {
        type: "text",
        text: "Extract all invoice data from this image.",
      },
    ];
  } else {
    return NextResponse.json(
      { error: "Only PDF, JPG, PNG, or WEBP files are supported." },
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

    const raw =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Pull JSON out of the response (handles any leading/trailing text)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not parse invoice data from file. Try a clearer scan." },
        { status: 422 }
      );
    }

    const extracted = JSON.parse(jsonMatch[0]);
    return NextResponse.json(extracted);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Extraction error:", message);
    return NextResponse.json(
      { error: `AI extraction failed: ${message}` },
      { status: 500 }
    );
  }
}
