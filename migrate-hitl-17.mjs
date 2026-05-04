import { getDb } from "./server/db.ts";
import { sql } from "drizzle-orm";
import fs from "fs";

const db = await getDb();
if (!db) { console.error("No DB"); process.exit(1); }

const migrationSql = fs.readFileSync("./drizzle/0055_hitl_17_stage_migration.sql", "utf-8");

// Split by semicolons and execute each statement
const statements = migrationSql
  .split(";")
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith("--"));

for (const stmt of statements) {
  try {
    await db.execute(sql.raw(stmt));
    console.log(`✓ ${stmt.substring(0, 60)}...`);
  } catch (err) {
    console.error(`✗ ${stmt.substring(0, 60)}...`);
    console.error(`  Error: ${err.message}`);
  }
}

console.log("\nMigration complete!");
process.exit(0);
