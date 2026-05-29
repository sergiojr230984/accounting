import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "La Cuevita — Accounting",
  description: "La Cuevita business accounting and invoice management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
