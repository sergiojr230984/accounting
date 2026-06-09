// Nothing inside register() blocks server startup. We fire-and-forget
// everything so the HTTP server starts immediately and Railway's
// healthcheck can pass without waiting for Sentry or DB warm-up.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    import("./sentry.server.config").catch((e) =>
      console.error("[instrumentation] sentry init failed:", e)
    );
    import("./lib/init-db")
      .then(({ initializeDatabase }) =>
        initializeDatabase().catch((e) =>
          console.error("[instrumentation] init-db failed:", e)
        )
      )
      .catch((e) => console.error("[instrumentation] init-db import failed:", e));
  } else if (process.env.NEXT_RUNTIME === "edge") {
    import("./sentry.edge.config").catch(() => undefined);
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: { [key: string]: string | string[] | undefined } },
  context: { routerKind: "Pages Router" | "App Router"; routePath: string; routeType: "render" | "route" | "action" | "middleware" }
) {
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(err, request, context);
  } catch {
    // Sentry not installed / failed to load — swallow so a Sentry hiccup
    // never propagates to the user as a 500.
  }
}
