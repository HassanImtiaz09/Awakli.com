import { getDb } from "./server/db.ts";

async function run() {
  const db = await getDb();
  for (const table of ["panel_layouts", "genga_keyframes", "flip_book_previews", "sakuga_reviews"]) {
    const [rows] = await db.execute(`SHOW TABLES LIKE '${table}'`);
    console.log(`${table}: ${rows.length > 0 ? "EXISTS" : "MISSING"}`);
  }
  process.exit(0);
}
run();
