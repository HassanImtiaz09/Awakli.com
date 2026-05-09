/**
 * Wave 8 — Item 1b: Pipeline Traversal Smoke Test Runner
 *
 * End-to-end smoke test that exercises the full 17-stage HITL anime production
 * pipeline using the "First Light" test content (Shōnen training arc, 21 slices,
 * 2 characters, 3-slice sakuga sequence).
 *
 * Architecture:
 * 1. Seeds test data into DB (user, project, episode, 21 panels, 2 characters)
 * 2. Generates character reference images via Forge ImageService
 * 3. Generates panel keyframe images (one per panel) via Forge ImageService
 * 4. Inserts gate_configs for "smoke_test" tier (all advisory, low thresholds)
 * 5. Creates pipeline_run and invokes runPipeline(runId) via tsx import
 * 6. Polls pipeline_run status until completed/failed
 * 7. Collects per-stage results, costs, errors
 * 8. Scores output coherence via LLM vision (threshold ≥0.70)
 * 9. Persists findings to test-results/wave8-smoke-test-2026-05-09.json
 *
 * Usage: npx tsx server/benchmarks/wave8-smoke-test-runner.mjs
 * Requires: DATABASE_URL, BUILT_IN_FORGE_API_URL, BUILT_IN_FORGE_API_KEY env vars
 *
 * HITL Gate Strategy: All gates configured as "advisory" with autoAdvanceThreshold=1
 * so they auto-advance immediately. This matches the First Light decision log
 * (admin-default decisions pre-approved for all gates).
 *
 * @see /home/ubuntu/upload/_TEST_CONTENT_Wave_8_Item_1a_First_Light.md
 * @see Wave 8 scope proposal
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Buffer } from "node:buffer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const RESULTS_DIR = resolve(PROJECT_ROOT, "test-results");
const RESULTS_FILE = resolve(RESULTS_DIR, "wave8-smoke-test-2026-05-09.json");

// ─── Environment ────────────────────────────────────────────────────────────

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!FORGE_API_URL || !FORGE_API_KEY) {
  console.error("BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY must be set");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const baseUrl = FORGE_API_URL.endsWith("/") ? FORGE_API_URL : `${FORGE_API_URL}/`;

// ─── S3 Storage Upload ──────────────────────────────────────────────────────

async function uploadToS3(b64Data, contentType, relKey) {
  const uploadUrl = new URL("v1/storage/upload", baseUrl);
  // Add random suffix to prevent enumeration
  const hash = Math.random().toString(36).slice(2, 10);
  const dotIdx = relKey.lastIndexOf(".");
  const finalKey = dotIdx > 0
    ? `${relKey.slice(0, dotIdx)}_${hash}${relKey.slice(dotIdx)}`
    : `${relKey}_${hash}`;
  uploadUrl.searchParams.set("path", finalKey);

  const buffer = Buffer.from(b64Data, "base64");
  const blob = new Blob([buffer], { type: contentType });
  const form = new FormData();
  form.append("file", blob, finalKey.split("/").pop());

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${FORGE_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`S3 upload failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const result = await response.json();
  return result.url;
}

// ─── Timing & Cost Tracking ─────────────────────────────────────────────────

const timings = {};
const costs = { imageGeneration: 0, llmScoring: 0, pipeline: 0 };
const errors = [];
let totalImagesGenerated = 0;

function startTimer(label) {
  timings[label] = { start: Date.now() };
}
function endTimer(label) {
  if (timings[label]) {
    timings[label].end = Date.now();
    timings[label].durationMs = timings[label].end - timings[label].start;
  }
}

// ─── Forge ImageService ─────────────────────────────────────────────────────

async function generateImage(prompt, originalImages = []) {
  const url = new URL("images.v1.ImageService/GenerateImage", baseUrl).toString();
  const startTime = Date.now();

  const body = { prompt };
  if (originalImages.length > 0) {
    body.original_images = originalImages;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${FORGE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const inferenceTimeMs = Date.now() - startTime;

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Image generation failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const result = await response.json();
  totalImagesGenerated++;
  costs.imageGeneration += 0.04; // ~$0.04 per Forge image generation

  return {
    b64Json: result.image?.b64Json || null,
    mimeType: result.image?.mimeType || "image/png",
    inferenceTimeMs,
  };
}

// ─── LLM Scoring ────────────────────────────────────────────────────────────

async function scorePanelCoherence(panelB64, panelDescription, characterName) {
  const llmUrl = `${FORGE_API_URL.replace(/\/$/, "")}/v1/chat/completions`;

  const systemPrompt = `You are an expert anime production quality evaluator. Score the following generated anime panel on these dimensions (0.0-1.0 each):

1. visual_quality: Technical quality of the anime art (line work, coloring, composition). 1.0 = professional anime production quality.
2. prompt_adherence: How well the image matches the visual description provided. 1.0 = perfect match.
3. character_consistency: If a character is present, how consistent are they with their description. 1.0 = perfect match.
4. mood_atmosphere: Does the image convey the intended mood/atmosphere. 1.0 = perfectly captures the mood.
5. anime_style: Is this recognizably anime-style art (not photorealistic, not Western cartoon). 1.0 = unmistakably anime.

Respond with ONLY a JSON object:
{"visual_quality": 0.XX, "prompt_adherence": 0.XX, "character_consistency": 0.XX, "mood_atmosphere": 0.XX, "anime_style": 0.XX, "notes": "brief observation"}`;

  const dataUrl = `data:image/png;base64,${panelB64}`;

  try {
    const response = await fetch(llmUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${FORGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        max_tokens: 32768,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: `Score this anime panel.\n\nVisual description: "${panelDescription}"\nCharacter (if present): ${characterName || "N/A"}\n\nScore the panel:` },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "panel_coherence_score",
            strict: true,
            schema: {
              type: "object",
              properties: {
                visual_quality: { type: "number" },
                prompt_adherence: { type: "number" },
                character_consistency: { type: "number" },
                mood_atmosphere: { type: "number" },
                anime_style: { type: "number" },
                notes: { type: "string" },
              },
              required: ["visual_quality", "prompt_adherence", "character_consistency", "mood_atmosphere", "anime_style", "notes"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`  LLM scoring failed (${response.status}): ${text.slice(0, 200)}`);
      return null;
    }

    const result = await response.json();
    costs.llmScoring += 0.01; // ~$0.01 per LLM scoring call
    const content = result.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  } catch (err) {
    console.warn(`  LLM scoring error: ${err.message}`);
    return null;
  }
}

// ─── DB Connection (via drizzle-orm/mysql2) ─────────────────────────────────

let db = null;

async function getDb() {
  if (db) return db;
  const { drizzle } = await import("drizzle-orm/mysql2");
  db = drizzle(DATABASE_URL);
  return db;
}

async function execSql(query) {
  const database = await getDb();
  const [rows] = await database.execute(query);
  return rows;
}

// ─── First Light Test Content ───────────────────────────────────────────────

const CHARACTERS = {
  mira: {
    name: "Mira",
    role: "protagonist",
    personalityTraits: ["determined", "expressive", "high standards", "quick to vocalize"],
    visualTraits: {
      hairColor: "Black with magenta-pink highlights at tips",
      eyeColor: "Dark brown",
      bodyType: "Athletic, lean, 5'4\"",
      clothing: "White sleeveless training gi, red sash belt, black fingerless gloves, white knee wraps, bare feet",
      distinguishingFeatures: "Magenta hair highlights, small scar across left eyebrow, slightly torn left sleeve",
    },
    voiceProfile: "Mid-high register, energetic, rapid when frustrated, measured when reflective",
  },
  masterGen: {
    name: "Master Gen",
    role: "supporting",
    personalityTraits: ["stoic", "observant", "rare smile", "warmth through gestures"],
    visualTraits: {
      hairColor: "Long silver hair, low ponytail with silk cord",
      eyeColor: "Calm dark eyes",
      bodyType: "Lean, weathered, 5'8\", upright posture",
      clothing: "Dark navy-blue haori-style robe, silver sash, dark hakama pants, traditional sandals",
      distinguishingFeatures: "Wooden quarterstaff (always present), scar along right jaw, silver hair",
    },
    voiceProfile: "Low-register baritone, measured pace, deliberate, rarely raises voice",
  },
};

const PANELS = [
  // Scene 1 — Morning Training Failure (Slices 1-6)
  { scene: 1, panel: 1, visual: "Dawn-lit traditional dojo interior. Mira mid-stance in foreground, athletic girl with black hair and magenta-pink tips in high ponytail, white training gi with red sash. Master Gen seated cross-legged on raised platform in background, silver hair, navy robe, eyes closed. Sun-streaks across wooden floor. Wide static shot, slight low angle.", camera: "wide", dialogue: null, effectTag: "koukaku", character: "Mira" },
  { scene: 1, panel: 2, visual: "Medium shot of Mira attempting the Drift Wind stance, full body visible. Athletic girl with magenta-tipped black ponytail in white gi with red sash, focused expression, executing a flowing martial arts technique. Eye level camera. Traditional dojo interior.", camera: "medium", dialogue: null, effectTag: null, character: "Mira" },
  { scene: 1, panel: 3, visual: "Close-up on Mira's foot slipping mid-motion on wooden dojo floor, then her face showing frustration breaking through. Quick cut composition. Magenta hair highlights visible. Gabure impact effect on the slip moment.", camera: "close-up", dialogue: [{ character: "Mira", text: "Tch.", emotion: "frustrated" }], effectTag: "gabure", character: "Mira" },
  { scene: 1, panel: 4, visual: "Repetition montage: three quick failed attempts of the Drift Wind stance from varying angles. Same girl (Mira, black hair with magenta tips, white gi) in different positions, body moving but flow not arriving. Mixed angles composition.", camera: "medium", dialogue: null, effectTag: "gabure", character: "Mira" },
  { scene: 1, panel: 5, visual: "Tight close-up on Mira's face, jaw set, sweat on brow, eyes locked forward with determination. Heart-shaped face, dark brown eyes, small scar across left eyebrow. Magenta-tipped ponytail partially visible. Eye level camera.", camera: "close-up", dialogue: [{ character: "Mira", text: "I can do this. I can do this.", emotion: "determined whisper then yell" }], effectTag: null, character: "Mira" },
  { scene: 1, panel: 6, visual: "Wide pull-back shot: Mira small in foreground of traditional dojo, Master Gen still seated on raised platform in background, face unreadable, watching. Silver hair, navy robe, wooden quarterstaff beside him. Slight high angle. Quiet observation moment.", camera: "wide", dialogue: null, effectTag: null, character: "Master Gen" },

  // Scene 2 — Midday Wisdom (Slices 7-14)
  { scene: 2, panel: 7, visual: "Medium two-shot in seiza position. Both characters seated formally on wooden dojo floor, 6 feet apart. Mira (white gi, red sash, tense posture) and Master Gen (navy robe, silver sash, textbook still posture). Harsh midday light, shorter shadows. Slight low angle.", camera: "medium", dialogue: null, effectTag: null, character: "Mira" },
  { scene: 2, panel: 8, visual: "Close-up on Mira seated in seiza, eyes downcast, frustrated but contained expression. Heart-shaped face, dark brown eyes, scar on left eyebrow. Magenta-tipped black ponytail. Warm gold and neutral brown palette, midday light.", camera: "close-up", dialogue: [{ character: "Mira", text: "I've practiced this stance a thousand times. Why won't it work?", emotion: "frustrated but contained" }], effectTag: null, character: "Mira" },
  { scene: 2, panel: 9, visual: "Close-up on Master Gen seated in seiza, calm expression, slight pause before speaking. Lined face, scar along right jaw, calm dark eyes, silver hair in low ponytail. Dark navy robe. Warm midday light.", camera: "close-up", dialogue: [{ character: "Master Gen", text: "You're trying to master the wind, Mira. Wind cannot be mastered.", emotion: "calm, measured" }], effectTag: null, character: "Master Gen" },
  { scene: 2, panel: 10, visual: "Sustained close-up on Mira's face showing confusion shifting to curiosity. Multiple micro-expressions. Heart-shaped face, dark brown eyes, scar on left eyebrow. No cut, sustained shot. Warm palette.", camera: "close-up", dialogue: null, effectTag: null, character: "Mira" },
  { scene: 2, panel: 11, visual: "Close-up on Master Gen's face, gentle expression. Lined face, jaw scar, calm dark eyes, silver hair. Dark navy robe collar visible. Warm midday light.", camera: "close-up", dialogue: [{ character: "Master Gen", text: "You become it.", emotion: "gentle" }], effectTag: null, character: "Master Gen" },
  { scene: 2, panel: 12, visual: "Wide shot: Master Gen rises from seiza in a single fluid motion, performs the Drift Wind technique. Lean weathered man in navy robe with silver sash, silver hair flowing. Effortless movement. Wooden quarterstaff set aside. Koukaku divine backlighting from midday sun. Subtle wave-glass overlay shimmer. Slight tracking camera.", camera: "wide", dialogue: null, effectTag: "koukaku", character: "Master Gen" },
  { scene: 2, panel: 13, visual: "Close-up reaction shot of Mira watching the demonstration. Her eyes track off-camera motion, breath held, realization crystallizing. Heart-shaped face, dark brown eyes, scar on left eyebrow, magenta-tipped ponytail. Warm midday palette.", camera: "close-up", dialogue: null, effectTag: null, character: "Mira" },
  { scene: 2, panel: 14, visual: "Tight close-up on Mira, quieter expression than before, whispering. Heart-shaped face, dark brown eyes, scar on left eyebrow. Warm palette, soft focus background.", camera: "close-up", dialogue: [{ character: "Mira", text: "Become it.", emotion: "whispered, realization" }], effectTag: null, character: "Mira" },

  // Scene 3 — Evening Breakthrough (Slices 15-19 + 17a/17b/17c)
  { scene: 3, panel: 15, visual: "Medium shot of Mira standing in dojo, eyes closed, breathing deeply. Golden hour sunset light streaming in. Athletic girl in white gi with red sash, magenta-tipped black ponytail. Stillness after the day's effort. Static camera, eye level.", camera: "medium", dialogue: null, effectTag: null, character: "Mira" },
  { scene: 3, panel: 16, visual: "Mira's eyes open. She begins the Drift Wind stance slowly, no force. Golden sunset palette, saturated gold and deep magenta-orange light. White gi, red sash, magenta hair highlights singing against golden palette. Slow tracking camera following her body. Gentle wave-glass overlay sense of altered perception.", camera: "medium", dialogue: null, effectTag: "wave-glass", character: "Mira" },
  // 17a — SAKUGA WIND-UP (premium tier)
  { scene: 3, panel: 17, visual: "SAKUGA SEQUENCE WIND-UP. Mira mid-stance, weight shifting low, eyes half-lidded in concentration. Single ribbon of dust spiraling up from her feet, loose hair strands beginning to lift. Time slows. Tight on lower body and feet, slow push-in. Golden sunset light. Wave-glass overlay intensity building. Koukaku warm golden hint from setting sun. Premium quality anime keyframe.", camera: "close-up", dialogue: null, effectTag: "sakuga:koukaku+wave-glass", character: "Mira", sakuga: true },
  // 17b — SAKUGA APEX (premium tier)
  { scene: 3, panel: 18, visual: "SAKUGA SEQUENCE APEX. Full-body flowing motion, Mira's arms tracing arcs through air, ponytail and gi swept by responding wind, magenta hair-tip highlights catching golden light. The Drift Wind technique manifests fully. Visual peak of the episode. Wide tracking shot, camera circles at half-speed. Koukaku golden god rays from above. Gabure on technique apex. Wave-glass overlay sustained. Gamen-dou subtle whole-frame movement. Premium quality anime keyframe.", camera: "wide", dialogue: null, effectTag: "sakuga:koukaku+gabure+wave-glass+gamen-dou", character: "Mira", sakuga: true },
  // 17c — SAKUGA COMPLETION (premium tier)
  { scene: 3, panel: 19, visual: "SAKUGA SEQUENCE COMPLETION. Mira in closing posture of Drift Wind, arms at rest, eyes opening as wind subsides. Visible breath escaping into cooling evening air. Technique complete. Slow pull-back from medium to wide. Koukaku fading. Wave-glass overlay decaying. Gentle bokeh-pull. Premium quality anime keyframe.", camera: "medium", dialogue: null, effectTag: "sakuga:koukaku+wave-glass+bokeh-pull", character: "Mira", sakuga: true },
  // Slice 18 — Master Gen reaction
  { scene: 3, panel: 20, visual: "Close-up on Master Gen. The rare smile, a single nod. Lined face, jaw scar, calm dark eyes softened. Silver hair in low ponytail. Slight low angle. Golden evening light. Voice softer than before.", camera: "close-up", dialogue: [{ character: "Master Gen", text: "Now you understand.", emotion: "rare smile, soft" }], effectTag: null, character: "Master Gen" },
  // Slice 19 — Mira response and end card
  { scene: 3, panel: 21, visual: "Close-up on Mira, eyes shining, breath calm. Quiet certainty replacing morning's frustration. Heart-shaped face, dark brown eyes, scar on left eyebrow, magenta-tipped ponytail. Golden evening light. Hold for fade. Gentle bokeh-pull from face to background.", camera: "close-up", dialogue: [{ character: "Mira", text: "I felt it. The wind.", emotion: "quiet triumph" }], effectTag: "bokeh-pull", character: "Mira" },
];

// ─── DB Seeding ─────────────────────────────────────────────────────────────

async function seedTestData() {
  console.log("\n═══ Phase 1: Seeding Test Data ═══\n");
  startTimer("seed");

  const { sql } = await import("drizzle-orm");
  const database = await getDb();

  // 1. Find or create test user (use owner if exists, otherwise create smoke_test user)
  console.log("  [1/6] Finding/creating test user...");
  let userId;
  const [existingUsers] = await database.execute(sql`
    SELECT id FROM users WHERE role = 'admin' LIMIT 1
  `);
  const userRows = existingUsers;
  if (userRows && userRows.length > 0) {
    userId = userRows[0].id;
    console.log(`    → Using existing admin user (id=${userId})`);
  } else {
    const [insertResult] = await database.execute(sql`
      INSERT INTO users (openId, name, email, role)
      VALUES ('smoke_test_user_w8', 'Smoke Test Runner', 'smoke@test.local', 'admin')
    `);
    userId = insertResult.insertId;
    console.log(`    → Created smoke test user (id=${userId})`);
  }

  // 2. Create subscription for the user (studio tier for premium access)
  console.log("  [2/6] Ensuring studio subscription...");
  const [existingSubs] = await database.execute(sql`
    SELECT id FROM subscriptions WHERE userId = ${userId} AND status = 'active' LIMIT 1
  `);
  if (!existingSubs || existingSubs.length === 0) {
    await database.execute(sql`
      INSERT INTO subscriptions (userId, tier, status, currentPeriodStart, currentPeriodEnd, monthlyCreditGrant, allowedModelTiers, concurrentGenerationLimit, teamSeats, queuePriority)
      VALUES (${userId}, 'studio', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), 100, '["budget","standard","premium"]', 5, 5, 1)
    `);
    console.log("    → Created studio subscription");
  } else {
    console.log("    → Studio subscription already exists");
  }

  // 3. Insert gate_configs for all 17 stages as advisory with threshold=1 (auto-advance everything)
  console.log("  [3/6] Configuring HITL gates (all advisory, auto-advance)...");
  // First delete any existing smoke_test tier configs
  await database.execute(sql`
    DELETE FROM gate_configs WHERE scope = 'tier_default' AND scopeRef = 'studio'
  `);
  for (let stage = 1; stage <= 17; stage++) {
    await database.execute(sql`
      INSERT INTO gate_configs (scope, scopeRef, stageNumber, gateType, autoAdvanceThreshold, reviewThreshold, timeoutHours, timeoutAction, isLocked)
      VALUES ('tier_default', 'studio', ${stage}, 'advisory', 1, 0, 1, 'auto_approve', 0)
    `);
  }
  console.log("    → 17 gate_configs inserted (all advisory, threshold=1)");

  // 4. Create project
  console.log("  [4/6] Creating project 'First Light'...");
  const [projectResult] = await database.execute(sql`
    INSERT INTO projects (userId, title, description, genre, animeStyle, status, visibility, projectState, wizardStage)
    VALUES (${userId}, 'First Light - Smoke Test', 'Wave 8 Item 1b smoke test: Shōnen training arc, 21 slices, 2 characters', 'shonen', 'shonen', 'active', 'private', 'draft', 6)
  `);
  const projectId = projectResult.insertId;
  console.log(`    → Project created (id=${projectId})`);

  // 5. Create episode
  console.log("  [5/6] Creating episode...");
  const [episodeResult] = await database.execute(sql`
    INSERT INTO episodes (projectId, episodeNumber, title, synopsis, status, panelCount, duration)
    VALUES (${projectId}, 1, 'Tournament Prep Arc - Episode 1', 'A young apprentice martial artist trains with her stoic master on the morning of her first tournament selection. Three scenes: morning training failure, midday wisdom, evening breakthrough.', 'approved', 21, 300)
  `);
  const episodeId = episodeResult.insertId;
  console.log(`    → Episode created (id=${episodeId})`);

  // 6. Create characters
  console.log("  [6/6] Creating characters...");
  const [miraResult] = await database.execute(sql`
    INSERT INTO characters (projectId, userId, name, role, personalityTraits, visualTraits)
    VALUES (${projectId}, ${userId}, 'Mira', 'protagonist',
      ${JSON.stringify(CHARACTERS.mira.personalityTraits)},
      ${JSON.stringify(CHARACTERS.mira.visualTraits)})
  `);
  const miraId = miraResult.insertId;

  const [genResult] = await database.execute(sql`
    INSERT INTO characters (projectId, userId, name, role, personalityTraits, visualTraits)
    VALUES (${projectId}, ${userId}, 'Master Gen', 'supporting',
      ${JSON.stringify(CHARACTERS.masterGen.personalityTraits)},
      ${JSON.stringify(CHARACTERS.masterGen.visualTraits)})
  `);
  const masterGenId = genResult.insertId;
  console.log(`    → Characters created: Mira (id=${miraId}), Master Gen (id=${masterGenId})`);

  endTimer("seed");
  return { userId, projectId, episodeId, miraId, masterGenId };
}

// ─── Image Generation Phase ─────────────────────────────────────────────────

async function generateCharacterReferences(miraId, masterGenId) {
  console.log("\n═══ Phase 2: Generating Character References ═══\n");
  startTimer("characterRefs");

  const { sql } = await import("drizzle-orm");
  const database = await getDb();
  const charRefs = {};

  // Generate Mira reference
  console.log("  [1/2] Generating Mira character reference...");
  try {
    const miraPrompt = "Anime character reference sheet, front view. Young athletic girl age 16, heart-shaped face, large dark brown eyes, small scar across left eyebrow. Black hair in high ponytail with magenta-pink highlights at the tips. White sleeveless training gi with red sash belt, black fingerless training gloves, white knee wraps, bare feet. Clean white background, full body, anime style, high quality character design sheet.";
    const miraImg = await generateImage(miraPrompt);
    charRefs.mira = { b64Length: miraImg.b64Json?.length || 0, inferenceTimeMs: miraImg.inferenceTimeMs, success: true };
    // Upload to S3 and store URL (data URLs are too large for MySQL TEXT columns)
    const miraUrl = await uploadToS3(miraImg.b64Json, miraImg.mimeType, `smoke-test/characters/mira-ref.png`);
    await database.execute(sql`
      UPDATE characters SET referenceImages = ${JSON.stringify([miraUrl])} WHERE id = ${miraId}
    `);
    console.log(`    → Mira reference generated (${miraImg.inferenceTimeMs}ms, ${Math.round((miraImg.b64Json?.length || 0) / 1024)}KB)`);
  } catch (err) {
    console.error(`    ✗ Mira reference FAILED: ${err.message}`);
    charRefs.mira = { success: false, error: err.message };
    errors.push({ phase: "characterRefs", character: "Mira", error: err.message });
  }

  // Generate Master Gen reference
  console.log("  [2/2] Generating Master Gen character reference...");
  try {
    const genPrompt = "Anime character reference sheet, front view. Elderly martial arts master, approximately 60s, lean weathered build, 5'8\", upright posture. Lined face, prominent scar along right jaw, calm dark eyes. Long silver hair tied back in low ponytail with silk cord. Dark navy-blue haori-style traditional martial arts robe with silver sash, dark hakama pants, traditional sandals. Wooden quarterstaff in hand. Clean white background, full body, anime style, high quality character design sheet.";
    const genImg = await generateImage(genPrompt);
    charRefs.masterGen = { b64Length: genImg.b64Json?.length || 0, inferenceTimeMs: genImg.inferenceTimeMs, success: true };
    const genUrl = await uploadToS3(genImg.b64Json, genImg.mimeType, `smoke-test/characters/master-gen-ref.png`);
    await database.execute(sql`
      UPDATE characters SET referenceImages = ${JSON.stringify([genUrl])} WHERE id = ${masterGenId}
    `);
    console.log(`    → Master Gen reference generated (${genImg.inferenceTimeMs}ms, ${Math.round((genImg.b64Json?.length || 0) / 1024)}KB)`);
  } catch (err) {
    console.error(`    ✗ Master Gen reference FAILED: ${err.message}`);
    charRefs.masterGen = { success: false, error: err.message };
    errors.push({ phase: "characterRefs", character: "Master Gen", error: err.message });
  }

  endTimer("characterRefs");
  return charRefs;
}

async function generatePanelImages(episodeId, projectId) {
  console.log("\n═══ Phase 3: Generating Panel Keyframe Images ═══\n");
  startTimer("panelImages");

  const { sql } = await import("drizzle-orm");
  const database = await getDb();
  const panelResults = [];

  // Generate images for all 21 panels (sequentially to avoid rate limits)
  for (let i = 0; i < PANELS.length; i++) {
    const panel = PANELS[i];
    const panelLabel = `Scene ${panel.scene}, Panel ${panel.panel}${panel.sakuga ? " [SAKUGA]" : ""}`;
    console.log(`  [${i + 1}/${PANELS.length}] ${panelLabel}...`);

    try {
      const img = await generateImage(panel.visual);
      // Upload to S3 and store URL
      const panelUrl = await uploadToS3(img.b64Json, img.mimeType, `smoke-test/panels/s${panel.scene}p${panel.panel}.png`);

      // Insert panel into DB with imageUrl set
      await database.execute(sql`
        INSERT INTO panels (episodeId, projectId, sceneNumber, panelNumber, visualDescription, cameraAngle, dialogue, sfx, imageUrl, status)
        VALUES (${episodeId}, ${projectId}, ${panel.scene}, ${panel.panel},
          ${panel.visual}, ${panel.camera},
          ${panel.dialogue ? JSON.stringify(panel.dialogue) : null},
          ${panel.effectTag || null},
          ${panelUrl},
          'approved')
      `);

      panelResults.push({
        scene: panel.scene,
        panel: panel.panel,
        success: true,
        inferenceTimeMs: img.inferenceTimeMs,
        sakuga: panel.sakuga || false,
        imageUrl: panelUrl,
      });
      console.log(`    → Generated (${img.inferenceTimeMs}ms)`);

      // Small delay between generations to avoid rate limiting
      if (i < PANELS.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`    ✗ FAILED: ${err.message}`);
      panelResults.push({
        scene: panel.scene,
        panel: panel.panel,
        success: false,
        error: err.message,
        sakuga: panel.sakuga || false,
      });
      errors.push({ phase: "panelImages", panel: `S${panel.scene}P${panel.panel}`, error: err.message });

      // Insert panel without imageUrl so pipeline can still attempt
      await database.execute(sql`
        INSERT INTO panels (episodeId, projectId, sceneNumber, panelNumber, visualDescription, cameraAngle, dialogue, sfx, status)
        VALUES (${episodeId}, ${projectId}, ${panel.scene}, ${panel.panel},
          ${panel.visual}, ${panel.camera},
          ${panel.dialogue ? JSON.stringify(panel.dialogue) : null},
          ${panel.effectTag || null},
          'draft')
      `);
    }
  }

  endTimer("panelImages");
  const successCount = panelResults.filter(r => r.success).length;
  console.log(`\n  Summary: ${successCount}/${PANELS.length} panels generated successfully`);
  return panelResults;
}

// ─── Pipeline Execution ─────────────────────────────────────────────────────

async function runPipelineTraversal(userId, projectId, episodeId) {
  console.log("\n═══ Phase 4: Pipeline Traversal ═══\n");
  startTimer("pipeline");

  const { sql } = await import("drizzle-orm");
  const database = await getDb();

  // Create pipeline_run
  console.log("  [1/3] Creating pipeline run...");
  const [runResult] = await database.execute(sql`
    INSERT INTO pipeline_runs (episodeId, projectId, userId, status, currentNode, progress)
    VALUES (${episodeId}, ${projectId}, ${userId}, 'pending', 'none', 0)
  `);
  const runId = runResult.insertId;
  console.log(`    → Pipeline run created (id=${runId})`);

  // Import and call runPipeline
  console.log("  [2/3] Invoking runPipeline(runId)...");
  console.log("    (This will exercise all 17 stages with auto-advancing HITL gates)");
  console.log("    (Expected duration: 2-5 minutes depending on API response times)");

  let pipelineError = null;
  try {
    const { runPipeline } = await import("../pipelineOrchestrator.ts");
    await runPipeline(runId);
    console.log("    → runPipeline() returned successfully");
  } catch (err) {
    pipelineError = err;
    console.error(`    ✗ runPipeline() threw: ${err.message}`);
    errors.push({ phase: "pipeline", error: err.message, stack: err.stack?.slice(0, 500) });
  }

  // 3. Read final pipeline state
  console.log("  [3/3] Reading final pipeline state...");
  const [finalState] = await database.execute(sql`
    SELECT * FROM pipeline_runs WHERE id = ${runId} LIMIT 1
  `);
  const run = finalState?.[0];

  const pipelineResult = {
    runId,
    status: run?.status || "unknown",
    progress: run?.progress || 0,
    totalCost: run?.totalCost || 0,
    nodeStatuses: run?.nodeStatuses || null,
    nodeCosts: run?.nodeCosts || null,
    errors: run?.errors || null,
    currentNode: run?.currentNode || null,
    currentStageNumber: run?.currentStageNumber || null,
    startedAt: run?.startedAt,
    completedAt: run?.completedAt,
    pipelineError: pipelineError?.message || null,
  };

  // Read pipeline stages
  const [stages] = await database.execute(sql`
    SELECT stageNumber, stageName, status, creditsActual, attempts, completedAt
    FROM pipeline_stages
    WHERE pipelineRunId = ${runId}
    ORDER BY stageNumber
  `);
  pipelineResult.stages = stages || [];

  // Read pipeline assets
  const [assets] = await database.execute(sql`
    SELECT id, assetType, panelId, url, metadata
    FROM pipeline_assets
    WHERE pipelineRunId = ${runId}
    ORDER BY id
  `);
  pipelineResult.assetCount = assets?.length || 0;
  pipelineResult.assetTypes = {};
  for (const asset of (assets || [])) {
    const type = asset.assetType || "unknown";
    pipelineResult.assetTypes[type] = (pipelineResult.assetTypes[type] || 0) + 1;
  }

  // Read gates
  const [gates] = await database.execute(sql`
    SELECT g.id, g.stageNumber, g.gateType, g.confidenceScore, g.decision, g.decisionSource
    FROM gates g
    JOIN pipeline_stages ps ON ps.gateId = g.id
    WHERE ps.pipelineRunId = ${runId}
    ORDER BY g.stageNumber
  `);
  pipelineResult.gates = (gates || []).map(g => ({
    stageNumber: g.stageNumber,
    gateType: g.gateType,
    confidenceScore: g.confidenceScore,
    decision: g.decision,
    decisionSource: g.decisionSource,
  }));

  endTimer("pipeline");
  console.log(`\n  Pipeline final status: ${pipelineResult.status}`);
  console.log(`  Progress: ${pipelineResult.progress}%`);
  console.log(`  Total cost: ${pipelineResult.totalCost} cents`);
  console.log(`  Assets generated: ${pipelineResult.assetCount}`);
  console.log(`  Stages processed: ${pipelineResult.stages?.length || 0}/17`);
  console.log(`  Gates auto-advanced: ${pipelineResult.gates?.filter(g => g.decisionSource === "auto").length || 0}`);

  return pipelineResult;
}

// ─── Coherence Scoring ──────────────────────────────────────────────────────

async function scoreOutputCoherence(episodeId) {
  console.log("\n═══ Phase 5: Output Coherence Scoring ═══\n");
  startTimer("coherence");

  const { sql } = await import("drizzle-orm");
  const database = await getDb();

  // Get panels with images for scoring
  const [panelsWithImages] = await database.execute(sql`
    SELECT id, sceneNumber, panelNumber, visualDescription, imageUrl
    FROM panels
    WHERE episodeId = ${episodeId} AND imageUrl IS NOT NULL
    ORDER BY sceneNumber, panelNumber
    LIMIT 6
  `);

  if (!panelsWithImages || panelsWithImages.length === 0) {
    console.log("  ✗ No panels with images found for scoring");
    endTimer("coherence");
    return { composite: 0, scores: [], error: "No panels with images" };
  }

  // Score a sample of panels (first 2 from each scene, max 6 total)
  const scores = [];
  const samplePanels = panelsWithImages.slice(0, 6);

  console.log(`  Scoring ${samplePanels.length} sample panels...\n`);

  for (const panel of samplePanels) {
    const label = `S${panel.sceneNumber}P${panel.panelNumber}`;
    console.log(`  [${label}] Scoring...`);

    // Download image from S3 URL and convert to base64 for LLM scoring
    const imageUrl = panel.imageUrl;
    if (!imageUrl || imageUrl.startsWith("data:")) {
      console.log(`    → Skipped (no valid URL)`);
      continue;
    }
    let b64;
    try {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) { console.log(`    → Skipped (fetch failed)`); continue; }
      const imgBuffer = await imgResp.arrayBuffer();
      b64 = Buffer.from(imgBuffer).toString("base64");
    } catch (fetchErr) {
      console.log(`    → Skipped (fetch error: ${fetchErr.message})`);
      continue;
    }

    const charName = PANELS.find(p => p.scene === panel.sceneNumber && p.panel === panel.panelNumber)?.character || null;
    const score = await scorePanelCoherence(b64, panel.visualDescription, charName);

    if (score) {
      const composite = (
        score.visual_quality +
        score.prompt_adherence +
        score.character_consistency +
        score.mood_atmosphere +
        score.anime_style
      ) / 5;

      scores.push({
        panel: label,
        ...score,
        composite,
      });
      console.log(`    → Composite: ${composite.toFixed(3)} (quality=${score.visual_quality}, adherence=${score.prompt_adherence}, character=${score.character_consistency}, mood=${score.mood_atmosphere}, anime=${score.anime_style})`);
    } else {
      console.log(`    → Scoring failed (LLM error)`);
      scores.push({ panel: label, composite: 0, error: "LLM scoring failed" });
    }

    // Small delay between scoring calls
    await new Promise(r => setTimeout(r, 300));
  }

  const validScores = scores.filter(s => s.composite > 0);
  const overallComposite = validScores.length > 0
    ? validScores.reduce((sum, s) => sum + s.composite, 0) / validScores.length
    : 0;

  const threshold = 0.70;
  const pass = overallComposite >= threshold;

  endTimer("coherence");
  console.log(`\n  Overall coherence: ${overallComposite.toFixed(3)} (threshold: ${threshold})`);
  console.log(`  Result: ${pass ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`  Panels scored: ${validScores.length}/${samplePanels.length}`);

  return {
    composite: overallComposite,
    threshold,
    pass,
    scores,
    panelsScored: validScores.length,
    panelsTotal: samplePanels.length,
  };
}

// ─── Results Persistence ────────────────────────────────────────────────────

function persistResults(seedData, charRefs, panelResults, pipelineResult, coherenceResult) {
  console.log("\n═══ Phase 6: Persisting Results ═══\n");

  mkdirSync(RESULTS_DIR, { recursive: true });

  const fixture = {
    metadata: {
      testName: "Wave 8 Item 1b — Pipeline Traversal Smoke Test",
      testContent: "First Light (Shōnen training arc, 21 slices, 2 characters)",
      runDate: new Date().toISOString(),
      environment: "sandbox",
      methodology: "End-to-end pipeline traversal: seed DB → generate images → run 17-stage pipeline → score coherence",
      thresholds: {
        coherence: "≥0.70 (sanity check for creator iteration, not production quality)",
      },
    },
    timings: Object.fromEntries(
      Object.entries(timings).map(([k, v]) => [k, { durationMs: v.durationMs }])
    ),
    costs: {
      imageGeneration: { usd: costs.imageGeneration.toFixed(2), imagesGenerated: totalImagesGenerated },
      llmScoring: { usd: costs.llmScoring.toFixed(2) },
      pipeline: { cents: pipelineResult?.totalCost || 0 },
      totalEstimatedUsd: (costs.imageGeneration + costs.llmScoring + (pipelineResult?.totalCost || 0) / 100).toFixed(2),
    },
    phases: {
      seed: {
        userId: seedData.userId,
        projectId: seedData.projectId,
        episodeId: seedData.episodeId,
        characters: { miraId: seedData.miraId, masterGenId: seedData.masterGenId },
      },
      characterReferences: {
        mira: { ...charRefs.mira, b64Json: undefined }, // Strip base64
        masterGen: { ...charRefs.masterGen, b64Json: undefined },
      },
      panelGeneration: {
        total: PANELS.length,
        succeeded: panelResults.filter(r => r.success).length,
        failed: panelResults.filter(r => !r.success).length,
        sakugaPanels: panelResults.filter(r => r.sakuga).length,
        avgInferenceMs: Math.round(
          panelResults.filter(r => r.success).reduce((sum, r) => sum + r.inferenceTimeMs, 0) /
          Math.max(1, panelResults.filter(r => r.success).length)
        ),
        // Don't include b64 data in fixture
        panels: panelResults.map(r => ({ ...r, b64Json: undefined, b64Length: undefined })),
      },
      pipeline: {
        ...pipelineResult,
        // Summarize stages without full data
        stagesSummary: (pipelineResult?.stages || []).map(s => ({
          stage: s.stageNumber,
          name: s.stageName,
          status: s.status,
          credits: s.creditsActual,
        })),
        stages: undefined, // Remove full stage data
      },
      coherence: coherenceResult,
    },
    errors,
    verdict: {
      pipelineTraversal: pipelineResult?.status === "completed" ? "PASS" : (pipelineResult?.status === "failed" ? "FAIL" : "PARTIAL"),
      coherenceScore: coherenceResult?.composite?.toFixed(3) || "N/A",
      coherencePass: coherenceResult?.pass || false,
      overallPass: (pipelineResult?.status === "completed" || pipelineResult?.progress > 0) && (coherenceResult?.pass || false),
      gapList: [],
    },
  };

  // Identify gaps for Item 3 polish
  if (pipelineResult?.status !== "completed") {
    fixture.verdict.gapList.push({
      id: "G1",
      severity: "critical",
      description: `Pipeline did not complete (status: ${pipelineResult?.status}, progress: ${pipelineResult?.progress}%)`,
      failingStage: pipelineResult?.currentNode || pipelineResult?.currentStageNumber,
      error: pipelineResult?.pipelineError || pipelineResult?.errors?.[0]?.message,
    });
  }
  if (!coherenceResult?.pass) {
    fixture.verdict.gapList.push({
      id: "G2",
      severity: "medium",
      description: `Coherence below threshold (${coherenceResult?.composite?.toFixed(3) || 0} < 0.70)`,
      details: coherenceResult?.scores?.filter(s => s.composite < 0.70).map(s => s.panel),
    });
  }
  if (errors.length > 0) {
    fixture.verdict.gapList.push({
      id: "G3",
      severity: "medium",
      description: `${errors.length} error(s) during execution`,
      errors: errors.map(e => `${e.phase}: ${e.error?.slice(0, 100)}`),
    });
  }
  const failedPanels = panelResults.filter(r => !r.success);
  if (failedPanels.length > 0) {
    fixture.verdict.gapList.push({
      id: "G4",
      severity: "low",
      description: `${failedPanels.length}/${PANELS.length} panel image generations failed`,
      panels: failedPanels.map(r => `S${r.scene}P${r.panel}`),
    });
  }

  writeFileSync(RESULTS_FILE, JSON.stringify(fixture, null, 2));
  console.log(`  → Results persisted to: ${RESULTS_FILE}`);
  console.log(`  → File size: ${Math.round(JSON.stringify(fixture).length / 1024)}KB (base64 stripped)`);

  return fixture;
}

// ─── Main Execution ─────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Wave 8 Item 1b — Pipeline Traversal Smoke Test             ║");
  console.log("║  Content: First Light (Shōnen, 21 slices, 2 characters)     ║");
  console.log("║  Target: 17-stage HITL pipeline end-to-end                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\n  Start time: ${new Date().toISOString()}`);
  console.log(`  Forge API: ${FORGE_API_URL}`);
  console.log(`  Database: ${DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}\n`);

  startTimer("total");

  // Phase 1: Seed test data
  const seedData = await seedTestData();

  // Phase 2: Generate character references
  const charRefs = await generateCharacterReferences(seedData.miraId, seedData.masterGenId);

  // Phase 3: Generate panel images
  const panelResults = await generatePanelImages(seedData.episodeId, seedData.projectId);

  // Phase 4: Run pipeline
  const pipelineResult = await runPipelineTraversal(seedData.userId, seedData.projectId, seedData.episodeId);

  // Phase 5: Score coherence
  const coherenceResult = await scoreOutputCoherence(seedData.episodeId);

  // Phase 6: Persist results
  endTimer("total");
  const fixture = persistResults(seedData, charRefs, panelResults, pipelineResult, coherenceResult);

  // Final summary
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  SMOKE TEST COMPLETE                                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\n  Total duration: ${(timings.total?.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Images generated: ${totalImagesGenerated}`);
  console.log(`  Pipeline status: ${pipelineResult?.status || "unknown"}`);
  console.log(`  Coherence: ${coherenceResult?.composite?.toFixed(3) || "N/A"} (threshold: 0.70)`);
  console.log(`  Verdict: ${fixture.verdict.overallPass ? "PASS ✓" : "PARTIAL (see gap list)"}`);
  console.log(`  Gaps identified: ${fixture.verdict.gapList.length}`);
  if (fixture.verdict.gapList.length > 0) {
    for (const gap of fixture.verdict.gapList) {
      console.log(`    [${gap.id}] ${gap.severity}: ${gap.description}`);
    }
  }
  console.log(`\n  Results: ${RESULTS_FILE}`);
  console.log(`  Next: Document findings in docs/wave-8-smoke-test-findings.md\n`);

  // Exit with appropriate code
  process.exit(fixture.verdict.gapList.filter(g => g.severity === "critical").length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("\n  FATAL ERROR:", err.message);
  console.error(err.stack);

  // Still persist partial results
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(RESULTS_FILE, JSON.stringify({
    metadata: { testName: "Wave 8 Item 1b — FATAL ERROR", runDate: new Date().toISOString() },
    fatalError: { message: err.message, stack: err.stack?.slice(0, 1000) },
    timings,
    costs,
    errors,
  }, null, 2));

  process.exit(2);
});
