"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
          maxWidth: "640px",
          margin: "0 auto",
          background: "#f9fafb",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: "12px",
            border: "1px solid #e5e7eb",
            padding: "2rem",
            marginTop: "4rem",
            boxShadow: "0 1px 3px rgba(0,0,0,.1)",
          }}
        >
          <h1 style={{ color: "#dc2626", fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            Application Error
          </h1>
          <p style={{ color: "#374151", marginBottom: "1rem" }}>
            A server-side exception occurred. Details below:
          </p>
          <pre
            style={{
              background: "#f3f4f6",
              borderRadius: "6px",
              padding: "1rem",
              fontSize: "0.8rem",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#1f2937",
            }}
          >
            {error.message || "(no message)"}
            {error.digest ? `\n\nDigest: ${error.digest}` : ""}
          </pre>
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Try again
            </button>
            <a
              href="/login"
              style={{
                padding: "0.5rem 1rem",
                background: "#f3f4f6",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                textDecoration: "none",
                fontSize: "0.875rem",
              }}
            >
              Go to login
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
