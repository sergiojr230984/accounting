import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/crm/webhook", "/pay"];

// ADMIN-only: financial dashboard, reports, admin tools, team management
const ADMIN_ONLY_PATHS = [
  "/admin",
  "/api/admin",
  "/crm/team",
  "/api/crm/team",
  "/dashboard",
  "/api/dashboard",
  "/reports",
  "/api/reports",
];

// ADMIN or MANAGER only (not SALES employees)
const MANAGER_PLUS_PATHS = [
  "/invoices/supplier",
  "/suppliers",
  "/api/invoices/supplier",
  "/api/suppliers",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (req.auth && pathname === "/login") {
    return NextResponse.redirect(new URL("/crm/dashboard", req.url));
  }
  if (!req.auth) return NextResponse.next();

  const role = (req.auth as { user?: { role?: string } }).user?.role;

  // Block non-admins from financial and admin paths
  if (ADMIN_ONLY_PATHS.some((p) => pathname.startsWith(p)) && role !== "ADMIN") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/crm/dashboard", req.url));
  }

  // Block SALES employees from supplier/bill paths
  if (
    MANAGER_PLUS_PATHS.some((p) => pathname.startsWith(p)) &&
    role !== "ADMIN" &&
    role !== "MANAGER"
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/crm/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
