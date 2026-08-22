import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Returns the company logo (from CompanyProfile.logo) as a binary image
 * so the browser can use it as a favicon / tab icon. The logo is stored
 * as a base64 data URL — decode it and serve the binary with the right
 * MIME type.
 *
 * Wired up via <link rel="icon" href="/api/brand-icon"> in the root
 * layout. No auth required (icons must load on the login page too).
 */
export async function GET() {
  try {
    const profile = await prisma.companyProfile.findUnique({
      where: { id: "default" },
      select: { logo: true },
    });
    const logo = profile?.logo ?? null;
    if (!logo) {
      return new NextResponse(null, { status: 404 });
    }
    const match = logo.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!match) {
      return new NextResponse(null, { status: 404 });
    }
    const mime = match[1];
    const bin = Buffer.from(match[2], "base64");
    return new NextResponse(bin as unknown as BodyInit, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
