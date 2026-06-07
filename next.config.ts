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
    return [
      {
        source: "/(.*)",
        headers: [
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

