import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });

export default defineConfig({
  test: {
    globalSetup: ["./tests/setup/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
});
