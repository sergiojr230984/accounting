import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Routes accessible without authentication
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/crm/webhook"];

// Paths that require ADMIN role
const ADMIN_PATHS = ["/admin", "/api/admin"];

// Paths that require at least MANAGER role
const MANAGER_PATHS = [
  "/invoices/supplier",
  "/suppliers",
  "/api/invoices/supplier",
  "/api/suppliers",
];

// Financial report paths — Admin only
const FINANCIAL_REPORT_PATHS = ["/reports/financial", "/reports/pl", "/reports/balance", "/reports/cash-flow"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Already authenticated users visiting /login → redirect to CRM
  if (req.auth && pathname === "/login") {
    return NextResponse.redirect(new URL("/crm/dashboard", req.url));
  }

  if (!req.auth) return NextResponse.next();

  const role = (req.auth as { user?: { role?: string } }).user?.role;

  // ADMIN-only areas
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));
  if (isAdminPath && role !== "ADMIN") {
    // For API routes return 403 JSON; for pages redirect to dashboard
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/crm/dashboard", req.url));
  }

  // Manager-and-above areas
  const isManagerPath = MANAGER_PATHS.some((p) => pathname.startsWith(p));
  if (isManagerPath && role !== "ADMIN" && role !== "MANAGER") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/crm/dashboard", req.url));
  }

  // Financial reports — Admin only
  const isFinancialPath = FINANCIAL_REPORT_PATHS.some((p) => pathname.startsWith(p));
  if (isFinancialPath && role !== "ADMIN") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
