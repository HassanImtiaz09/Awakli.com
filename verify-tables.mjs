import { sql } from 'drizzle-orm';
import { getDb } from './server/db.ts';
const db = await getDb();
const r1 = await db.execute(sql.raw('DESCRIBE character_views'));
console.log('character_views columns:', r1[0].length);
const r2 = await db.execute(sql.raw('DESCRIBE reference_sheet_gates'));
console.log('reference_sheet_gates columns:', r2[0].length);
process.exit(0);
