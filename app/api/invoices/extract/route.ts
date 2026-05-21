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
- All numbers must be strings
- Dates must be YYYY-MM-DD format
- taxRate is a decimal (0.08 not 8)
- If tax is shown as a single total rather than per line, distribute it proportionally or add as a separate item
- Return empty array for items if none found
- Never include currency symbols in numeric fields`;

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

Category rules — pick the best fit:
- COGS: raw materials, inventory, goods for resale, manufacturing supplies
- SERVICES_EXPENSE: software subscriptions, cloud hosting, consulting, professional services, freelancers
- OPERATING_EXPENSE: rent, utilities, office supplies, insurance, marketing, salaries
- OTHER: anything that doesn't clearly fit above

Rules:
- All numbers must be strings
- Dates must be YYYY-MM-DD format
- taxRate is a decimal (0.08 not 8)
- Never include currency symbols in numeric fields`;

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

  const systemPrompt = type === "supplier" ? SUPPLIER_SYSTEM : CUSTOMER_SYSTEM;
  let messageContent: Anthropic.MessageParam["content"];

  if (file.type === "application/pdf") {
    // Extract text from PDF then send to Claude
    const buffer = Buffer.from(await file.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    let pdfText: string;
    try {
      const parsed = await pdfParse(buffer);
      pdfText = parsed.text;
    } catch {
      return NextResponse.json({ error: "Could not read PDF. Try a clearer scan or JPG/PNG." }, { status: 422 });
    }

    if (!pdfText.trim()) {
      return NextResponse.json(
        { error: "PDF appears to be a scanned image with no readable text. Please upload a JPG or PNG instead." },
        { status: 422 }
      );
    }

    messageContent = [
      {
        type: "text",
        text: `Extract invoice data from this PDF text:\n\n${pdfText.slice(0, 8000)}`,
      },
    ];
  } else if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") {
    // Send image directly to Claude vision
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
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
      { error: "Only PDF, JPG, PNG, or WEBP files are supported for extraction." },
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
      return NextResponse.json({ error: "Could not parse invoice data from file." }, { status: 422 });
    }

    const extracted = JSON.parse(jsonMatch[0]);
    return NextResponse.json(extracted);
  } catch (err) {
    console.error("Extraction error:", err);
    return NextResponse.json({ error: "AI extraction failed. Check your API key." }, { status: 500 });
  }
}
