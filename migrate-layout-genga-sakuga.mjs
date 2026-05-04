import { readFileSync } from "fs";
import { getDb } from "./server/db.ts";

async function run() {
  const db = await getDb();
  const sql = readFileSync("./drizzle/0054_layout_genga_sakuga.sql", "utf8");
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    try {
      await db.execute(stmt + ";");
      console.log("OK:", stmt.slice(0, 60) + "...");
    } catch (e) {
      if (e.message?.includes("already exists")) {
        console.log("SKIP (exists):", stmt.slice(0, 60) + "...");
      } else {
        console.error("FAIL:", e.message);
        throw e;
      }
    }
  }
  console.log("Migration complete!");
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
