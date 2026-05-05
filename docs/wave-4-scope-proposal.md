# Wave 4 Scope Proposal

**Author:** Manus AI  
**Date:** 2026-05-04  
**Baseline:** Wave 3 checkpoint `8e34bd6d` — 138 new tests (5 files), total ~4650+ tests across 147 files

---

## Wave 3 Recap

All 5 items landed with 138 new tests passing:

| Item | Stage | Tests | Status |
|------|-------|-------|--------|
| D5.5 Orchestrator Integration | 11 | 17 | Wired into pipelineOrchestrator |
| X-Sheet Authoring + D4 Timing | 12 | 18 | Schema + LLM auto-gen (read-only MVP) |
| D8 Voice Director Critic | 13 | 24 | Scoring + routing + retry loop |
| D7 FX Compositor | 14 | 48 | 33 FX types, ekonte-primary, genre profiles |
| H1 Card-Legibility Probe | 16 | 31 | WCAG contrast + text detection |

**Remaining gaps from Wave 3 (deferred by design):**
- D7, D8, D4 modules exist but are NOT wired into `pipelineOrchestrator.ts` (only D5.5 is wired)
- H1 card-legibility check exists but is NOT registered in `rules-harness.ts` (check #8)
- X-Sheet is read-only (no editor UI, no per-user overrides active)
- 71 failing UI/brand-refresh tests across 25 files

---

## Wave 4 Scope (5 Items)

### Design Principles

1. **Wire what we built** — D7, D8, D4 modules are complete but disconnected from the live pipeline; Wave 4 connects them
2. **Register H1 check #8** — card-legibility probe is built but not in the harness sequence
3. **D9 Sakufuu Tracker** — the last unimplemented required-traversal agent; provides episode-2+ style bias
4. **Fix test hygiene** — the 71 failing UI tests are technical debt that obscures real regressions
5. **Keep Chroma/pgvector swap as a stretch goal** — corpus is still well under 5K chunks; implement only if time permits

---

### Item 1: Pipeline Wiring — D4 Timing + D8 Critic + D7 FX + Render Executor (Stages 12-14)

| Attribute | Value |
|-----------|-------|
| **Owning Stages** | 12 (x_sheet), 13 (ato_fuki), 14 (fx_pass) |
| **Owning Agents** | D4, D8, D7 |
| **Dependencies** | D5.5 wired (Stage 11), voice_gen agent, foley/ambient nodes |
| **Effort** | Large (6-8 days) |

**Sub-items:**

- [ ] Wire D4 Timing Director into orchestrator: after D5.5 passes (Stage 11), call `generateXSheet()` with script + slice metadata → store X-Sheet → HITL blocking gate at Stage 12
- [ ] Wire D8 Voice Critic into orchestrator: after voice_gen completes (Stage 13 gate), run `evaluateVoiceBatch()` on generated clips → retry with D4 re-routing on low scores → only approved clips proceed to lip-sync
- [ ] Wire D7 FX Compositor into orchestrator: after foley/ambient (Stage 14 gate), call `composeFxBatch()` with ekonte tags + anime type → produce FX plans
- [ ] **NEW: D7 FX Render Executor** — `server/benchmarks/d7-fx-compositor/fx-renderer.ts`:
  - Download each clip URL to temp directory
  - Call `buildFilterComplex()` → `buildFfmpegCommand()` → `execFileAsync("ffmpeg", ...)`
  - Upload rendered clips via `storagePut()`
  - Return rendered clip URLs for assembly stage
  - Follows `video-assembly.ts` pattern (download → FFmpeg → upload)
- [ ] Update `LEGACY_NODE_TO_V19` mapping to route through new agent calls
- [ ] D8 retry budget: 2 attempts per dialogue line with critic feedback injection into D4 emotion routing
- [ ] Integration test: full Stage 12→14 flow with mocked LLM/FFmpeg/voice providers

**Note on D7 execution model:** `composeFxBatch()` is currently plan-only (returns `ClipFxPlan[]` with no rendered output). The FX Render Executor is new code that bridges the plan → FFmpeg execution → S3 upload gap. This is the primary reason the effort estimate is 6-8 days rather than 3-4.

---

### Item 2: H1 Card-Legibility Registration (Stage 16)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | 16 (mastering_harness) |
| **Owning Agent** | H1 (rules-based) |
| **Dependencies** | `card-legibility-check.ts` exists (Wave 3 Item 5) |
| **Effort** | Small (0.5 days) |

**Sub-items:**

- [ ] Import `runCardLegibilityCheck` in `rules-harness.ts`
- [ ] Add as check #8 after watermark check in the sequential runner
- [ ] Pass `titleCardDurationSec`, `endCardDurationSec`, `totalDurationSec`, `tempDir` from `RulesHarnessOptions`
- [ ] Add optional `resolution` field to `RulesHarnessOptions` for card legibility (width/height)
- [ ] Update harness verdict logging to include card_legibility result
- [ ] Integration test: harness runner executes 8 checks in correct order

---

### Item 3: D9 Sakufuu Tracker MVP — Data-Tracking Only (Stage 2)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | 2 (anime_type) |
| **Owning Agent** | D9 |
| **Dependencies** | Style bundles (Wave 2), D10 vector store, production bible |
| **Effort** | Large (4-5 days) |

**Scope boundary:** This is a **data-tracking MVP only**. D9 accumulates style decisions and provides bias recommendations. It does NOT train LoRAs or adapt prompts. The downstream scope is:
- **Wave 5:** Sakufuu Aesthetic LoRA training pipeline (style fingerprint → fine-tuned LoRA)
- **Wave 6:** Three-LoRA composition runtime (genre + character + sakufuu LoRA stacking at inference)
- **Wave 6:** Prompt-Style Adapter (D9 injects learned phrasing into generation prompts)

**Sub-items:**

- [ ] Define sakufuu profile schema: `sakufuu_profiles` table with project-level style fingerprint (color tendencies, motion preferences, FX signatures, voice tone patterns)
- [ ] Layer 1 — Episode Memory: track per-episode style decisions (which FX used, color script choices, voice emotion distributions)
- [ ] Layer 2 — Project Memory: aggregate episode memories into project-level tendencies (e.g., "this project uses 光角 heavily, prefers warm palettes")
- [ ] Layer 3 — Genre Memory: **DEFERRED to Wave 5** (corpus too small; flag as dependency on D10 book purchases)
- [ ] D9 bias injection: at Stage 2 (anime_type selection), D9 provides default-bias recommendations for episodes 2+ based on accumulated style memory (Layers 1+2 only)
- [ ] No-op for episode 1 (no memory yet) — returns empty bias, pipeline proceeds normally
- [ ] Integration with D7 FX: D9 provides "signature FX" list that D7 prioritizes
- [ ] Integration test: episode 1 no-op, episode 2+ receives bias from Layer 1+2

---

### Item 4: Fix 71 Failing UI/Brand-Refresh Tests (Hygiene)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | N/A (test infrastructure) |
| **Owning Agent** | N/A |
| **Dependencies** | None |
| **Effort** | Medium (2-3 days) |

**Sub-items:**

- [ ] Audit all 25 failing test files — categorize failures (stale snapshots, removed components, renamed CSS classes, deleted routes)
- [ ] Fix tests for components that still exist but had CSS/class changes (update selectors/assertions)
- [ ] Delete tests for components that were intentionally removed (voting system, legacy palette, etc.)
- [ ] Update snapshot tests to match current brand-refresh state
- [ ] Verify full test suite passes (target: 0 failures across all 147 files)

---

### Item 5: Chroma/pgvector Vector Store Swap (Stretch Goal)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | N/A (infrastructure) |
| **Owning Agent** | D10 |
| **Dependencies** | `setVectorStore()` singleton (Wave 2.5), `IVectorStore` interface |
| **Effort** | Medium (2-3 days) |

**Sub-items:**

- [ ] Implement `PgVectorStore` class implementing `IVectorStore` interface
- [ ] Use `pgvector` extension on TiDB/MySQL (or fallback to cosine similarity UDF)
- [ ] Migration: add `embedding VECTOR(1536)` column to `craft_library_chunks` (or separate embeddings table)
- [ ] Export existing JSON array embeddings → re-import into vector column
- [ ] Benchmark: compare query latency at 1K, 5K, 10K chunks (JSON arrays vs native vector index)
- [ ] Wire `setVectorStore(new PgVectorStore())` in server startup when corpus > threshold
- [ ] Integration test: same semantic queries return equivalent results with both backends

**Note:** This is a stretch goal. If corpus remains under 5K chunks (likely given no book purchases yet), the `JsonArrayVectorStore` is adequate and this item can slip to Wave 5.

---

## Dependency Graph

```
Wave 3 Complete (Stages 11-16 modules built)
       │
       ▼
Item 1: Wire D4+D8+D7 into orchestrator (Stages 12-14)
       │
       ▼
Item 2: Register H1 card-legibility as check #8 (Stage 16)
       │
       ▼
Item 3: D9 Sakufuu Tracker (Stage 2 bias for ep 2+)
       │
       ▼
Item 4: Fix 71 failing UI tests (hygiene)
       │
       ▼
Item 5: Chroma/pgvector swap (stretch, if time permits)
```

Items 1-3 are sequential (pipeline integration order). Items 4-5 are independent and can be done in any order after Item 3.

---

## Items Explicitly NOT in Wave 4

| Item | Reason | Target Wave |
|------|--------|-------------|
| D2.5 Full Resolution-Flow Dashboard | Depends on D7/D8/D4 producing real outputs first | Wave 5B |
| X-Sheet Editor UI (editable timeline) | Data model ready (no migration needed); UI needs design spec | Wave 5B |
| D9 Layer 3 (Genre Memory from D10 corpus) | Corpus too small (<5K chunks) | Wave 5B |
| Sakufuu Aesthetic LoRA Training | Depends on D9 data accumulation | Wave 5B |
| D10 Full Corpus ($2.5-5K book purchases) | Budget dependency, not code | Wave 5B |
| Manga Finishing (D10.M — Playbook 3.6) | Ships with Lulu as closed-loop print product | Wave 5A |
| Lulu Print Integration (Playbook 9.1) | Ships with Manga Finishing as closed-loop print product; **B2 audit blocker** | Wave 5A |
| Founders' Studio Infrastructure | Separate infrastructure track | Wave 5B+ |
| Three-LoRA Composition Runtime | Depends on D9 + Sakufuu LoRA + Character LoRA | Wave 6 |
| Prompt-Style Adapter | Depends on D9 data + LoRA runtime | Wave 6 |

---

## Effort Summary

| Item | Effort | Risk |
|------|--------|------|
| 1. Pipeline Wiring + FX Render Executor (D4+D8+D7) | 6-8 days | Medium-High (3 agents + FFmpeg executor) |
| 2. H1 Card-Legibility Registration | 0.5 days | Very Low |
| 3. D9 Sakufuu Tracker MVP (data-tracking only) | 4-5 days | Medium (new data model + 2-layer logic) |
| 4. Fix 71 Failing UI Tests | 2-3 days | Low (mechanical fixes) |
| 5. Chroma/pgvector Swap (stretch) | 2-3 days | Low (interface already defined) |
| **Total** | **15-20 days** | |

---

## Confirmations Received

1. **D9 Layer 3 defer** — Confirmed. Layer 3 (Genre Memory) deferred to Wave 5. Layers 1+2 only in Wave 4.
2. **UI test strategy** — Aggressively delete tests for removed features; keep regression guards for changed CSS with updated expectations.
3. **Chroma/pgvector** — Confirmed stretch goal. Skip if corpus stays under 5K.
4. **X-Sheet Editor UI** — Deferred to Wave 5. Wave 4 data model already supports per-user overrides without migration.
5. **Pipeline wiring order** — D4 → D8 → D7 confirmed correct (matches stage sequence 12 → 13 → 14).
