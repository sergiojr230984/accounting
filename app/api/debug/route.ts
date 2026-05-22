import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    keyPrefix: process.env.ANTHROPIC_API_KEY?.slice(0, 10) ?? "NOT SET",
    nodeVersion: process.version,
    env: process.env.NODE_ENV,
  });
}
