# Wave 3 Self-Verification Report

**Date:** 2026-05-04  
**Checkpoint:** `8e34bd6d`

---

## Decision A: D7 Reads Ekonte FX Tags as Primary Source

**CONFIRMED.** The implementation explicitly prioritizes ekonte tags over LLM suggestions.

**File:** `server/benchmarks/d7-fx-compositor/fx-compositor.ts`

**Lines 1-9 (module docstring):**
```ts
/**
 * D7 FX Compositor — Genre-Aware Anime Visual Effects (Stage 14: fx_pass)
 *
 * Design Principles (per user confirmation):
 *   1. PRIMARY FX source: explicit ekonte tags from Stage 5 panels (光角, 波ガラス, ガブレ, etc.)
 *      LLM selection ONLY where ekonte tags are absent or ambiguous.
 *   2. Active FX set driven by Stage 2 anime type (Shōnen/Shōjo/Seinen/Josei/Kodomomuke),
 *      with user preference as secondary modulator.
 *   3. FX taxonomy is anime-specific (NOT Western-cinematic).
 */
```

**Lines 119-195 (EKONTE_TAG_MAP — all 5 required tags present):**
```ts
export const EKONTE_TAG_MAP: Record<string, AnimeFxType> = {
  "光角": "hikari_kaku",          // ✓ Required tag #1
  "波ガラス": "nami_garasu",       // ✓ Required tag #2
  "ガブレ": "gabure",             // ✓ Required tag #3
  "画面動": "gamen_dou",          // ✓ Required tag #4
  "bokeh-pull": "bokeh_pull",     // ✓ Required tag #5 (romanized)
  // ... 50+ additional mappings (Japanese + romanized variants)
};
```

**Lines 731-753 (composeFxBatch — ekonte-first, LLM-fallback flow):**
```ts
for (const clip of input.clips) {
  // Step 1: Parse ekonte tags (PRIMARY)
  let effects = parseEkonteTags(clip.sfxTag, genreProfile);

  if (effects.length > 0) {
    ekonteDrivenCount++;
  } else {
    // Step 2: LLM suggestion (SECONDARY — only when ekonte absent)
    effects = await suggestFxFromLlm(/* ... */, genreProfile);
    if (effects.length > 0) {
      llmSuggestedCount++;
    }
    totalCost += COST_PER_LLM_SUGGESTION;
  }
  // Step 3: Apply user preferences (secondary modulator)
  effects = applyUserPreferences(effects, input.userPreferences, genreProfile);
}
```

**Lines 476-478 (LLM function docstring):**
```ts
/**
 * LLM-based FX suggestion — ONLY used when ekonte tags are absent or ambiguous.
 * The LLM is constrained to suggest from the genre's signature FX set.
 */
```

---

## Decision B: D7 Active FX Driven by Stage 2 Anime Type

**CONFIRMED.** Genre profiles are the primary FX library selector; user preferences are secondary.

**File:** `server/benchmarks/d7-fx-compositor/fx-compositor.ts`

**Lines 203-221 (AnimeType classification):**
```ts
export type AnimeType = "shonen" | "shoujo" | "seinen" | "josei" | "kodomomuke";

export function classifyAnimeType(animeStyle: string, genre?: string | null): AnimeType {
  const style = animeStyle.toLowerCase();
  if (style === "shonen" || style === "mecha") return "shonen";
  if (style === "shoujo") return "shoujo";
  if (style === "seinen" || style === "cyberpunk" || style === "noir" || style === "realistic") return "seinen";
  if (style === "chibi" || style === "watercolor") return "kodomomuke";
  // Genre-based fallback for josei, kodomomuke, etc.
  // ...
}
```

**Lines 242-310 (5 genre profiles with distinct FX libraries):**
```ts
export const GENRE_PROFILES: Record<AnimeType, GenreProfile> = {
  shonen: {
    displayName: "Shōnen (少年)",
    categoryWeights: { motion: 2.0, energy: 2.0, ... },
    forbiddenFx: ["sparkle_eyes", "sweat_drop"],
    signatureFx: ["speed_lines", "impact_frame", "sakuga_sparks", "gabure", "energy_aura", "afterimage"],
    maxEffectsPerClip: 3,
    defaultIntensity: 0.85,
  },
  shoujo: {
    displayName: "Shōjo (少女)",
    categoryWeights: { light: 2.0, atmospheric: 1.8, emotional: 2.0, ... },
    signatureFx: ["bokeh_pull", "sakura_petals", "sparkle_eyes", "rim_light", ...],
    ...
  },
  seinen: { ... },
  josei: { ... },
  kodomomuke: { ... },
};
```

**Lines 619-671 (User preferences as secondary modulator):**
```ts
/**
 * Apply user preferences as a secondary modulator on top of genre profile.
 * Genre profile is PRIMARY, user preferences are SECONDARY.
 */
export function applyUserPreferences(
  effects: FxSpec[],
  preferences: UserFxPreferences | null | undefined,
  genreProfile: GenreProfile,
): FxSpec[] {
  // Filters out user-disabled FX, applies intensity multiplier,
  // adds always-include FX (unless genre-forbidden)
}
```

**Lines 719-720 (composeFxBatch entry point — genre profile drives everything):**
```ts
const animeType = classifyAnimeType(input.animeStyle, input.genre);
const genreProfile = GENRE_PROFILES[animeType];
```

---

## Decision C: X-Sheet Data Model Supports Per-User Overrides

**CONFIRMED.** Three-table schema with immutable D4 base + user override layer + read-time merge.

**File:** `drizzle/schema.ts`

**Lines 2624-2628 (design intent comment):**
```ts
/**
 * Data model supports per-user overrides in Wave 4 via xSheetOverrides table.
 * D4 output is the "base layer"; user edits are stored as overrides that
 * merge on top at read time.
 */
```

**Lines 2727-2740 (x_sheet_overrides table):**
```ts
export const xSheetOverrides = mysqlTable("x_sheet_overrides", {
  id: int("id").autoincrement().primaryKey(),
  xSheetId: int("x_sheet_id").notNull().references(() => xSheets.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sliceNumber: int("slice_number").notNull(),
  overrideData: json("override_data").notNull(),  // Sparse JSON patch
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**File:** `server/benchmarks/d4-timing/db-helpers.ts`

**Lines 101-172 (override CRUD + read-time merge):**
```ts
// ─── X-Sheet Overrides (Wave 4 ready) ───────────────────────────────────────

export async function createXSheetOverride(data: InsertXSheetOverride): Promise<void> { ... }
export async function getOverridesForSheet(xSheetId: number, userId: number): Promise<XSheetOverride[]> { ... }

/**
 * Merge base entries with user overrides.
 * Returns entries with override_data fields merged on top of base entry fields.
 * This is the read-time merge pattern: D4 output is immutable, user edits layer on top.
 */
export function mergeEntriesWithOverrides(entries, overrides): XSheetEntry[] {
  // Maps overrides by sliceNumber, spreads override_data on top of base entry
}

export async function getResolvedXSheet(episodeId, userId?): Promise<ResolvedXSheet | null> {
  // Returns { sheet, entries (merged), hasOverrides: boolean }
}
```

**File:** `drizzle/0056_x_sheet_tables.sql` (migration applied)
```sql
CREATE TABLE IF NOT EXISTS `x_sheet_overrides` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `x_sheet_id` int NOT NULL,
  `user_id` int NOT NULL,
  `slice_number` int NOT NULL,
  `override_data` json NOT NULL,
  `reason` text DEFAULT NULL,
  ...
);
CREATE INDEX `idx_x_sheet_overrides_sheet_user` ON `x_sheet_overrides`(`x_sheet_id`, `user_id`);
```

**No migration needed for Wave 4 overrides** — the table, FK constraints, indexes, and merge logic all exist. Wave 4 only needs to wire the CRUD endpoints and (eventually) the editor UI.

---

## Question 5: D7 Execution Model — Plan-Only vs FFmpeg Rendering

**CONFIRMED: `composeFxBatch()` is PLAN-ONLY.** It does NOT execute FFmpeg.

**Evidence:**

1. `composeFxBatch()` (lines 719-786) returns `FxCompositorResult` which contains `ClipFxPlan[]` — each plan has `effects: FxSpec[]`, `clipUrl` (the original input URL), and `renderCostUsd` (estimated). There is **no rendered output URL** in the return type.

2. `buildFilterComplex()` (line 582) and `buildFfmpegCommand()` (line 611) are **exported utility functions** that generate FFmpeg command strings but are **never called** within `composeFxBatch()` or anywhere else in production code. They are only exercised in tests.

3. No `child_process`, `execSync`, `execFile`, or `storagePut` imports exist in `fx-compositor.ts`. The only FFmpeg reference is the string template in `buildFfmpegCommand`.

4. No other file in `server/` (outside tests) calls `buildFfmpegCommand` or `buildFilterComplex`.

**Implication for Wave 4 Item 1:**

Wave 4 must add an **FX Render Executor** that:
1. Takes `ClipFxPlan[]` from `composeFxBatch()`
2. Downloads each clip URL to a temp directory
3. Calls `buildFilterComplex()` → `buildFfmpegCommand()` → `execFileAsync("ffmpeg", ...)`
4. Uploads rendered clips via `storagePut()`
5. Returns rendered clip URLs for the assembly stage

This is analogous to how `video-assembly.ts` (line 33: `import { execFile } from "child_process"`) and `assemble-p13.ts` (line 17: `import { execSync } from "child_process"`) handle FFmpeg execution. The pattern exists; it just hasn't been written for D7 yet.

**This materially increases Item 1's effort estimate** (see below).

---

## Substantive Scope Answers

### (1) D9 Sakufuu Tracker MVP Scope

**Confirmed:** Wave 4 D9 is **data-tracking only** — it accumulates style decisions (FX usage, color choices, voice patterns) per-episode and per-project, and provides bias recommendations for episodes 2+. It does NOT train LoRAs or adapt prompts.

The downstream scope is:
- **Wave 5:** Sakufuu Aesthetic LoRA training pipeline (takes accumulated style fingerprint → fine-tunes a LoRA adapter)
- **Wave 6:** Three-LoRA composition runtime (genre LoRA + character LoRA + sakufuu LoRA applied at inference time via LoRA merging/stacking)
- **Wave 6:** Prompt-Style Adapter (D9 injects learned phrasing patterns into video/image generation prompts)

The three-LoRA composition runtime becomes functional when all three LoRA types exist and a merge/stack inference path is built. That's Wave 6 at earliest.

### (2) D2.5 Full Resolution-Flow Dashboard

**Acknowledged slip.** Wave 3 scope proposal (line 288) said "Wave 4" for D2.5. Wave 4 proposal does not include it.

**Current status:** D2.5 is now **Wave 5**. The rationale: Wave 4 is focused on wiring the existing agents into the live pipeline and completing D9 MVP. D2.5 (the auto-regen multi-round dashboard with user-facing resolution UI) is polish that depends on D7/D8/D4 being wired first — it can't show meaningful resolution flows until the agents are actually producing outputs in the pipeline.

**Revised target:** Wave 5, after pipeline wiring is stable and producing real outputs to display.

### (3) Lulu Print (B2) — Three-Product Narrative Timeline

**Acknowledged.** Lulu Print has slipped from Wave 4 → Wave 5. Given:
- Wave 4: ~12-16 days (pipeline wiring + D9 + hygiene)
- Wave 5: ~15-20 days (D2.5 dashboard + Lulu integration + LoRA training)
- Wave 6: ~10-15 days (three-LoRA runtime + prompt adapter)

The three-product narrative (anime video + manga finishing + print-on-demand) is approximately **6-7 months out from live** assuming sequential waves with review gaps between them. This is a real constraint on the business narrative timeline.

If Lulu is a hard dependency for fundraising/demo purposes, it could be pulled forward into Wave 4 as a stretch goal (replacing Chroma/pgvector), but it would add 3-4 days and compete with D9 for attention.

### (4) Item 1 Effort Estimate — Revised Upward

**You're right.** The original 3-4 day estimate was too light. Here's why:

D5.5 wiring (Wave 3 Item 1) took 3-4 days for **one agent** with:
- Orchestrator integration (call site + HITL gate)
- Frame extraction utility
- Regeneration callback wiring
- Integration test

Wave 4 Item 1 requires wiring **three agents** (D4, D8, D7) PLUS:
- **D7 FX Render Executor** (new code — download clips, run FFmpeg, upload results)
- D8 retry logic (re-run voice generation with critic feedback)
- D4 X-Sheet → assembly pipeline coordination
- Three separate HITL gates
- Integration test covering the full Stage 12→14 flow

**Revised estimate: 6-8 days.** Breaking down:
- D4 Timing wiring + HITL gate: 1.5 days
- D8 Voice Critic wiring + retry loop: 2 days
- D7 FX wiring + **Render Executor** (new): 2.5-3 days
- Integration test (full flow): 1 day

The FX Render Executor is the hidden complexity — it's a new module that follows the `video-assembly.ts` pattern (download → FFmpeg → upload) but applied per-clip rather than as a final concat.

---

## Summary Table

| Decision | Status | Key File | Key Lines |
|----------|--------|----------|-----------|
| A: Ekonte tags primary, LLM fallback | **SHIPPED** | `fx-compositor.ts` | 1-9, 119-195, 731-753 |
| B: Anime type drives FX library | **SHIPPED** | `fx-compositor.ts` | 203-310, 719-720 |
| C: Per-user overrides in X-Sheet | **SHIPPED** | `schema.ts` + `db-helpers.ts` | 2624-2740, 101-172 |
| D7 execution model | **Plan-only** (no FFmpeg render) | `fx-compositor.ts` | 719-786 (no exec imports) |

**Wave 4 Item 1 revised effort: 6-8 days** (was 3-4). Total Wave 4 revised: **15-20 days** (was 12-16).
