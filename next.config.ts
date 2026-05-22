import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep these as native Node.js modules — don't let Next.js bundle them
  serverExternalPackages: ["@prisma/client", "pdf-parse"],
};

export default nextConfig;
