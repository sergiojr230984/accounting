import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "La Cuevita — Accounting",
  description: "La Cuevita business accounting and invoice management",
  icons: {
    icon: [{ url: "/api/brand-icon", type: "image/png" }],
    shortcut: "/api/brand-icon",
    apple: "/api/brand-icon",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
