import { spawn, ChildProcess, execSync } from "child_process";
import path from "path";

/**
 * Global setup for the integration suite: pushes the real Prisma schema to
 * whatever DATABASE_URL points at, seeds it (base users + two isolated
 * SALES fixtures used by the RBAC tests), then boots a real Next.js server
 * so tests exercise actual route handlers, actual auth, actual middleware —
 * not mocks. Intended for a disposable test database only; never point
 * DATABASE_URL at production when running this suite.
 */

const TEST_PORT = process.env.TEST_PORT ?? "3100";
export const BASE_URL = `http://localhost:${TEST_PORT}`;

let serverProcess: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

export default async function setup() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a disposable test database before running the suite — never production."
    );
  }
  if (/railway\.app|amazonaws|rds\./.test(process.env.DATABASE_URL)) {
    throw new Error(
      "Refusing to run: DATABASE_URL looks like it might be a hosted/production database."
    );
  }

  const cwd = path.resolve(__dirname, "../..");

  console.log("[test-setup] Pushing schema to test database...");
  execSync("npx prisma db push --accept-data-loss --skip-generate", {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  console.log("[test-setup] Seeding base fixtures...");
  execSync("npx tsx prisma/seed.ts", { cwd, stdio: "inherit", env: process.env });
  execSync("npx tsx tests/setup/seed-test-fixtures.ts", {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  console.log(`[test-setup] Starting Next.js server on port ${TEST_PORT}...`);
  serverProcess = spawn("npx", ["next", "dev", "-p", TEST_PORT], {
    cwd,
    env: process.env,
    stdio: "pipe",
    detached: true,
  });
  serverProcess.stdout?.on("data", () => {});
  serverProcess.stderr?.on("data", () => {});

  await waitForServer(`${BASE_URL}/api/health`, 45_000);
  console.log("[test-setup] Server is up.");

  return async function teardown() {
    console.log("[test-teardown] Stopping Next.js server...");
    if (serverProcess && serverProcess.pid) {
      try {
        process.kill(-serverProcess.pid, "SIGTERM");
      } catch {
        serverProcess.kill("SIGTERM");
      }
    }
  };
}
