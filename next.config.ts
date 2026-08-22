import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // Compression of HTML / static assets at the server (default true, explicit).
  compress: true,
  // Never ship client source maps to production.
  productionBrowserSourceMaps: false,
  // Strip console.* from production bundles, keep error/warn for diagnostics.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  // Don't reveal the framework in response headers.
  poweredByHeader: false,
  // Long-cache hashed static assets and add basic security headers.
  async headers() {
    // No external script/style/font/image host is loaded anywhere in the
    // app today (confirmed by a repo-wide search) -- self plus data:/blob:
    // for images (client-side previews, jsPDF) is enough. script-src/
    // style-src keep 'unsafe-inline' because Next.js's default (non-nonce)
    // App Router setup relies on inline scripts for hydration data; a
    // stricter nonce-based CSP is a reasonable follow-up but needs its own
    // middleware wiring and browser testing, not a drop-in change.
    // Next.js dev mode's React Refresh/HMR evaluates code via eval(), which
    // a strict script-src blocks -- that's dev-only, not a production
    // requirement, so unsafe-eval is scoped to non-production only.
    const isDev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
        ],
      },
      {
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

// Wrap config with Sentry so server-side errors are auto-captured.
// We disable client source-map upload (and source maps in general) so we don't
// ship them to browsers — server-side stack traces still resolve since the
// build's server bundles include their own maps locally.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // Do NOT upload or expose client source maps. Server traces still resolve
  // because the server bundle keeps its own maps locally.
  sourcemaps: { disable: true },
  disableLogger: true,
  widenClientFileUpload: false,
  reactComponentAnnotation: { enabled: false },
  tunnelRoute: undefined,
  telemetry: false,
});

