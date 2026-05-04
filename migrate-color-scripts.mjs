import { readFileSync } from "fs";
import { getDb } from "./server/db.ts";

async function main() {
  const sql = readFileSync("./drizzle/0053_color_scripts.sql", "utf8");
  const statements = sql
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const db = await getDb();
  for (const stmt of statements) {
    console.log("Executing:", stmt.substring(0, 80) + "...");
    await db.execute(stmt);
  }
  console.log("Migration complete: color_scripts table created");
  process.exit(0);
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
