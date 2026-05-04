import { getDb } from "./server/db.ts";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("No DB"); process.exit(1); }

const [rows] = await db.execute(sql.raw("SELECT COUNT(*) as cnt FROM gate_configs"));
console.log("gate_configs count:", rows[0].cnt, "(expected: 85 = 5 tiers × 17 stages)");

const [rows2] = await db.execute(sql.raw("SELECT tierName, COUNT(*) as cnt FROM gate_configs GROUP BY tierName"));
console.log("Per tier:", rows2.map(r => `${r.tierName}=${r.cnt}`).join(", "));

const [rows3] = await db.execute(sql.raw("SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pipeline_runs' AND COLUMN_NAME='totalStages'"));
console.log("totalStages default:", rows3[0]?.COLUMN_DEFAULT);

process.exit(0);
