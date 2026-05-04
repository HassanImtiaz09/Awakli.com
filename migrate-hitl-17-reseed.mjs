import { getDb } from "./server/db.ts";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("No DB"); process.exit(1); }

// 1. Update totalStages default (already done but confirm)
await db.execute(sql.raw("ALTER TABLE `pipeline_runs` MODIFY COLUMN `totalStages` int NOT NULL DEFAULT 17"));
console.log("✓ pipeline_runs.totalStages default set to 17");

// 2. Update any existing pipeline_runs
await db.execute(sql.raw("UPDATE `pipeline_runs` SET `totalStages` = 17 WHERE `totalStages` = 12"));
console.log("✓ Existing pipeline_runs updated to 17 stages");

// 3. Delete old gate_configs (greenfield - no production users)
await db.execute(sql.raw("DELETE FROM `gate_configs`"));
console.log("✓ Old gate_configs cleared");

// 4. Reseed gate_configs for 5 tiers × 17 stages
// Using correct columns: scope, scopeRef, stageNumber, gateType, autoAdvanceThreshold, reviewThreshold, timeoutHours, timeoutAction, isLocked

// v1.9 Blueprint gate types per stage:
// blocking: 1(script), 3(character_design), 4(color_script), 5(ekonte), 6(layout), 7(genga), 10(video_generation), 15(satsuei), 16(mastering_harness)
// advisory: 2(anime_type), 8(sakuga_kantoku_review), 9(sakuga_tagging), 11(per_clip_continuity), 12(x_sheet), 13(ato_fuki), 14(fx_pass)
// ambient: 17(continual_learning)

const TIERS = [
  { scopeRef: "free_trial", blockingAutoAdv: 85, blockingReview: 60, advisoryAutoAdv: 80, advisoryReview: 50, ambientAutoAdv: 95, ambientReview: 40 },
  { scopeRef: "creator", blockingAutoAdv: 85, blockingReview: 55, advisoryAutoAdv: 82, advisoryReview: 48, ambientAutoAdv: 95, ambientReview: 35 },
  { scopeRef: "creator_pro", blockingAutoAdv: 88, blockingReview: 50, advisoryAutoAdv: 85, advisoryReview: 45, ambientAutoAdv: 95, ambientReview: 30 },
  { scopeRef: "studio", blockingAutoAdv: 90, blockingReview: 45, advisoryAutoAdv: 88, advisoryReview: 40, ambientAutoAdv: 95, ambientReview: 25 },
  { scopeRef: "enterprise", blockingAutoAdv: 92, blockingReview: 40, advisoryAutoAdv: 90, advisoryReview: 35, ambientAutoAdv: 95, ambientReview: 20 },
];

// Stage definitions per v1.9 Blueprint
const STAGES = [
  { num: 1,  gateType: "blocking",  timeoutAction: "auto_pause" },    // script
  { num: 2,  gateType: "advisory",  timeoutAction: "auto_approve" },  // anime_type
  { num: 3,  gateType: "blocking",  timeoutAction: "auto_pause" },    // character_design
  { num: 4,  gateType: "blocking",  timeoutAction: "auto_pause" },    // color_script
  { num: 5,  gateType: "blocking",  timeoutAction: "auto_pause" },    // ekonte
  { num: 6,  gateType: "blocking",  timeoutAction: "auto_pause" },    // layout
  { num: 7,  gateType: "blocking",  timeoutAction: "auto_pause" },    // genga
  { num: 8,  gateType: "advisory",  timeoutAction: "auto_approve" },  // sakuga_kantoku_review
  { num: 9,  gateType: "advisory",  timeoutAction: "auto_approve" },  // sakuga_tagging (required traversal, advisory gate)
  { num: 10, gateType: "blocking",  timeoutAction: "auto_pause" },    // video_generation
  { num: 11, gateType: "advisory",  timeoutAction: "auto_approve" },  // per_clip_continuity
  { num: 12, gateType: "advisory",  timeoutAction: "auto_approve" },  // x_sheet
  { num: 13, gateType: "advisory",  timeoutAction: "auto_approve" },  // ato_fuki
  { num: 14, gateType: "advisory",  timeoutAction: "auto_approve" },  // fx_pass
  { num: 15, gateType: "blocking",  timeoutAction: "auto_pause" },    // satsuei
  { num: 16, gateType: "blocking",  timeoutAction: "auto_pause" },    // mastering_harness
  { num: 17, gateType: "ambient",   timeoutAction: "auto_approve" },  // continual_learning
];

let insertCount = 0;
for (const tier of TIERS) {
  for (const stage of STAGES) {
    let autoAdv, review;
    if (stage.gateType === "blocking") {
      autoAdv = tier.blockingAutoAdv;
      review = tier.blockingReview;
    } else if (stage.gateType === "advisory") {
      autoAdv = tier.advisoryAutoAdv;
      review = tier.advisoryReview;
    } else {
      autoAdv = tier.ambientAutoAdv;
      review = tier.ambientReview;
    }
    
    await db.execute(sql.raw(
      `INSERT INTO gate_configs (scope, scopeRef, stageNumber, gateType, autoAdvanceThreshold, reviewThreshold, timeoutHours, timeoutAction, isLocked, createdAt, updatedAt) VALUES ('tier_default', '${tier.scopeRef}', ${stage.num}, '${stage.gateType}', ${autoAdv}, ${review}, 24, '${stage.timeoutAction}', 0, NOW(), NOW())`
    ));
    insertCount++;
  }
}

console.log(`✓ Inserted ${insertCount} gate_configs (expected: ${TIERS.length * STAGES.length})`);

// Verify
const [verify] = await db.execute(sql.raw("SELECT COUNT(*) as cnt, MAX(stageNumber) as maxStage FROM gate_configs"));
console.log(`✓ Verification: ${verify[0].cnt} rows, max stage: ${verify[0].maxStage}`);

process.exit(0);
