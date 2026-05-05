# Wave 4 Self-Verification Report

**Date:** 2026-05-05  
**Checkpoint:** pending (all items complete, full suite green)  
**Test Suite:** 4,855 tests × 150 files — ZERO failures

---

## Item 1: Pipeline Wiring (D4 → D8 → D7 + FX Render Executor)

### Files Implemented

| File | Purpose | Lines |
|------|---------|-------|
| `server/benchmarks/d4-timing/timing-pipeline.ts` | D4 Timing Director pipeline integration | ~200 |
| `server/benchmarks/d8-voice-critic/voice-critic-pipeline.ts` | D8 Voice Critic with full retry-and-rerun loop | ~260 |
| `server/benchmarks/d7-fx-compositor/fx-renderer.ts` | FX Render Executor (download → FFmpeg → upload) | ~180 |
| `server/benchmarks/pipeline-wiring.ts` | Orchestrator wiring layer connecting D4+D8+D7 | ~250 |
| `server/benchmarks/d4-pipeline-wiring.test.ts` | Integration test — 18 tests | ~300 |

### Decision Verification

**D8 Retry Loop is FUNCTIONAL (not decorative):**

```
server/benchmarks/d8-voice-critic/voice-critic-pipeline.ts:
Line 7:  *   3. Calls runD8RetryLoop() with a regenerateClip callback
Line 124: * Uses the existing runD8RetryLoop() with a provider-router regeneration callback.
Line 136:    maxRetries = MAX_RETRIES_PER_CLIP,
Line 241:    retryResult = await runD8RetryLoop({
```

The retry loop works end-to-end:
1. D8 scores TTS output via `evaluateVoiceClip()`
2. Low score triggers re-invocation of D4 voice generation via `regenerateClip` callback
3. Callback calls `generateWithCredits()` from provider-router with critic feedback injected
4. New clip re-scored by D8
5. Only approved clips (score ≥ threshold) proceed to lip-sync

**D7 FX Render Executor uses production FFmpeg pattern:**

```
server/benchmarks/d7-fx-compositor/fx-renderer.ts:
Line 7:  *   3. Runs FFmpeg via execFileAsync (production pattern from video-assembly.ts)
Line 17: import { execFile } from "child_process";
Line 23: import { storagePut } from "../../storage.js";
Line 34: const execFileAsync = promisify(execFile);
Line 94: async function downloadClip(url: string, destPath: string): Promise<void> {
Line 119:   await execFileAsync("ffmpeg", args, {
Line 157:     await downloadClip(plan.clipUrl, inputPath);
```

Lifecycle: download clip from S3 → apply FFmpeg filter complex → upload rendered clip to S3 → create pipeline_asset record.

**Pipeline Wiring Order: D4 → D8 → D7 (confirmed):**

```
server/benchmarks/pipeline-wiring.ts:
Line 10:  *   Stage 13: voice_gen → D8 Voice Critic (score + retry loop)
Line 27: import { renderFxBatch } from "./d7-fx-compositor/fx-renderer.js";
Line 108: * The retry loop is functional:
Line 152: *   Phase 2: renderFxBatch() — execute FFmpeg rendering for applicable clips
```

---

## Item 2: H1 Card-Legibility Registration

### Files Modified

| File | Change | Lines |
|------|--------|-------|
| `server/benchmarks/harness/rules-harness.ts` | Added check #8 import + registration | Lines 53, 149-158 |
| `server/benchmarks/harness/h1-registration.test.ts` | Registration test — 6 tests | ~80 |

### Verification

```
server/benchmarks/harness/rules-harness.ts:
Line 53:   skipCardLegibility?: boolean;
Line 149:   if (!options.skipCardLegibility) {
Line 150:     const cardLegibility = runCardLegibilityCheck({
Line 157:     checks.push(cardLegibility);
Line 158:     console.log(`  │ cardLegibility: ${cardLegibility.passed ? "✓" : "✗"} (${cardLegibility.durationMs}ms)`);
```

Harness now runs 8 deterministic checks. Card-legibility is check #8, after watermark check, with `skipCardLegibility` option for tests that don't need it.

---

## Item 3: D9 Sakufuu Tracker MVP (Data-Tracking + Bias)

### Files Implemented

| File | Purpose | Lines |
|------|---------|-------|
| `server/benchmarks/d9-sakufuu/sakufuu-tracker.ts` | Three-layer tracker (episode memory + project profile + bias) | ~380 |
| `server/benchmarks/d9-sakufuu/d9-sakufuu-tracker.test.ts` | Integration test — 46 tests | ~500 |
| `drizzle/0057_sakufuu_tracker.sql` | Migration: `sakufuu_episode_memories` + `sakufuu_project_profiles` tables | ~40 |

### Decision Verification

**Data-tracking only (no LoRA training, no Prompt-Style Adapter):**

```
server/benchmarks/d9-sakufuu/sakufuu-tracker.ts:
Line 67:   signatureFx: Array<{ type: string; frequency: number; avgIntensity: number }>;
Line 83:   signatureFx: string[];
Line 209: export function aggregateProjectProfile(
Line 230:   const signatureFx = Array.from(fxAgg.entries())
Line 281:     signatureFx,
Line 310: export function getSakufuuBias(input: GetBiasInput): SakufuuBias {
Line 322:   const profile = projectProfile ?? aggregateProjectProfile(projectId, episodeMemories);
Line 329:   const signatureFx = profile.signatureFx.map(f => f.type);
```

**No-op for episode 1:**
- `getSakufuuBias()` returns `{ active: false, ... }` when `episodeNumber === 1` or no prior memories exist

**Bias recommendations for episodes 2+:**
- Signature FX list (for D7 prioritization)
- Palette tendencies (dominant colors)
- Voice consistency markers (preferred voices, pacing)
- Camera/transition patterns

**Scope boundaries confirmed:**
- Wave 4 = data-tracking + bias recommendations only
- Wave 5 = Sakufuu Aesthetic LoRA training pipeline
- Wave 6 = Three-LoRA composition runtime (genre + character + sakufuu) + Prompt-Style Adapter

---

## Item 4: Fix 71 Failing UI/Brand-Refresh Tests

### Summary

| Category | Files Fixed | Tests Resolved |
|----------|-------------|----------------|
| Removed features (Leaderboard, Vote, toggleLike) | 4 files | ~15 tests deleted |
| Tier/pricing drift ($29→$19, $499→$149, regen limits) | 6 files | ~20 tests updated |
| Stage count (7→8 STAGES, 12→17 HITL stages) | 5 files | ~18 tests updated |
| Architecture renames (nav constants, node types) | 5 files | ~12 tests updated |
| Misc (sameSite, LoRA capabilities, cost estimates) | 4 files | ~6 tests updated |

### Result

```
Test Files  150 passed (150)
     Tests  4855 passed (4855)
  Duration  144.71s
```

**Zero failures across the entire test suite.**

---

## Item 5: Chroma/pgvector Swap — DEFERRED (Confirmed Stretch)

- Corpus currently < 5K chunks — `JsonArrayVectorStore` performs adequately
- `IVectorStore` interface already in place at `server/benchmarks/d10/vector-store.ts:46`
- Swap point documented: `getVectorStore()` singleton factory at line 303
- Will revisit when corpus approaches 5K threshold (likely Wave 6+)

---

## Wave 5 Restructure (Confirmed in Roadmap)

| Wave | Scope | Timeline |
|------|-------|----------|
| **5A** | Manga Finishing (D10.M) + Lulu Print Integration | Ships together as closed-loop print product |
| **5B** | D2.5 Resolution-Flow Dashboard + Sakufuu Aesthetic LoRA training | After 5A |
| **6** | Three-LoRA composition runtime + Prompt-Style Adapter + 'Awakli learns your style' feature | Functional at Wave 6 earliest |

Three-product narrative goes live at Wave 5A completion (~5-6 months from now).

---

## Test Counts

| Test File | Tests |
|-----------|-------|
| `d4-pipeline-wiring.test.ts` (Item 1) | 18 |
| `h1-registration.test.ts` (Item 2) | 6 |
| `d9-sakufuu-tracker.test.ts` (Item 3) | 46 |
| Item 4 (existing tests fixed) | 4,855 total |
| **Wave 4 new tests** | **70** |
| **Full suite** | **4,855 × 150 files** |
