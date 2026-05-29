import { execSync } from "child_process";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

let initialized = false;

export async function initializeDatabase() {
  if (initialized) return;
  initialized = true;

  console.log("[init-db] Running prisma db push to sync schema...");
  try {
    execSync("npx prisma db push --accept-data-loss --skip-generate", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    console.log("[init-db] Schema in sync");
  } catch (e) {
    console.error("[init-db] prisma db push failed:", e);
    return;
  }

  try {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount === 0) {
      const hash = await bcrypt.hash("admin123", 12);
      await prisma.user.create({
        data: {
          email: "admin@bizledger.com",
          name: "Admin",
          password: hash,
          role: "ADMIN",
        },
      });
      console.log("[init-db] Default admin seeded: admin@bizledger.com / admin123");
    }
  } catch (e) {
    console.error("[init-db] admin seed failed:", e);
  }
}
