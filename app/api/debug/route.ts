import { NextResponse } from "next/server";

export async function GET() {
  const raw = process.env.ANTHROPIC_API_KEY ?? "";
  const trimmed = raw.trim();
  return NextResponse.json({
    hasAnthropicKey: !!trimmed,
    keyPrefix: trimmed.slice(0, 14) ?? "NOT SET",
    keyLength: trimmed.length,
    hasWhitespace: raw !== trimmed,
    startsCorrectly: trimmed.startsWith("sk-ant-api03-"),
    nodeVersion: process.version,
    env: process.env.NODE_ENV,
  });
}
