export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeDatabase } = await import("./lib/init-db");
  await initializeDatabase();
}
