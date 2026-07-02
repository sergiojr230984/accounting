import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";

// Lightweight NextAuth instance — no bcrypt or Prisma, safe for middleware runtime
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/crm/webhook",
  "/pay",
  "/api/health",
  "/api/debug",
];

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

// Build the NextAuth middleware handler separately so we can catch its exceptions
const authMiddleware = auth((req) => {
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

// Exported middleware wraps the NextAuth handler in try-catch.
// If NextAuth throws for any reason (missing AUTH_SECRET, JWT error, etc.)
// we fall back to a safe redirect instead of crashing the entire app.
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (authMiddleware as any)(req, event);
  } catch (err) {
    console.error("[middleware] unhandled exception — falling back to /login redirect:", err);
    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (!isPublic) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
