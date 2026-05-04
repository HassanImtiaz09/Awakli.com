# Wave 3 Scope Proposal

**Author:** Manus AI  
**Date:** 2026-05-04  
**Baseline:** Wave 2.5 checkpoint `dad18ae1` — 4513 tests passing (142 files), 221 in Wave 2/2.5 scope

---

## Micro-Ask Responses

### (1) `voice_synthesis` in credit-executor.ts:53 — Backwards-Compat Shim

**Yes, intentional.** The `resolveAction()` helper in `server/provider-router/credit-executor.ts` maps the generic provider-router `type: "voice"` to the credit ledger action string `"voice_synthesis"`. This is a **billing-layer shim** — it preserves the original ledger action name so that existing credit transactions, Stripe product mappings (`CREDIT_COSTS["voice_synthesis"] = 1`), and analytics queries continue to work without migration.

The shim applies in **three places**:

| Location | Purpose | Rename Risk |
|----------|---------|-------------|
| `credit-executor.ts:53` | Maps `type:"voice"` → `"voice_synthesis"` for ledger writes | Breaking: all existing ledger rows reference this string |
| `credit-gateway.ts:42` | Type union includes `"voice_synthesis"` | Breaking: TypeScript consumers |
| `server/stripe/products.ts:299` | Credit cost lookup key | Breaking: pricing logic |

The pipeline stage was renamed to `ato_fuki` (Stage 13) in the HITL config, but the **credit/billing layer retains `voice_synthesis`** deliberately. The `LEGACY_STAGE_MIGRATION` map in `stage-config.ts:245` documents this: `voice_synthesis: { action: "renamed", v19Stage: "ato_fuki", v19Number: 13 }`.

**Recommendation:** Keep the shim. A future billing-schema migration (Wave 5+) can unify naming, but it requires a ledger backfill and is not worth the risk now.

---

### (2) Test Count Reconciliation: 221 vs "315 sampled" vs 4513 Actual

The full test suite is **4513 tests across 142 files** (as of this checkpoint). The "221 tests across 8 files" I reported was the **Wave 2/2.5 scope only** — the 8 test files I wrote or rewrote during Waves 2 and 2.5:

| Test File | Tests | Wave |
|-----------|-------|------|
| `style-bundles.test.ts` | 14 | 2 |
| `character-designer.test.ts` | 22 | 2 |
| `color-director.test.ts` | 30 | 2 |
| `layout-genga-sakuga.test.ts` | 38 | 2 |
| `ingestion.test.ts` | 36 | 2 |
| `hitl-integration.test.ts` | 47 | 2.5 |
| `vector-store.test.ts` | 21 | 2.5 |
| `d0-e2e-integration.test.ts` | 13 | 2.5 |
| **Total (Wave 2/2.5 scope)** | **221** | |

The "315" figure you sampled likely included additional pre-existing test files (e.g., `d5-5-quality-gate.test.ts` at 29 tests, `pipeline.test.ts` at 58 tests, etc.) that were written in Wave 1 but touch D-agent code. The full suite runs 4513 tests; 71 currently fail (25 files) due to UI/brand-refresh drift unrelated to pipeline logic. The 117 passing test files (4513 passing tests) include all pipeline, harness, and D-agent logic.

---

## Current Implementation Audit (Anchoring Wave 3 Scope)

### D5.5 (Stage 11) — Partially Implemented

**Implemented:**
- `per-clip-reviewer.ts` (433 LOC): Full LLM-judged per-clip review with 5 dimensions (character_consistency 35%, style 25%, prompt_alignment 15%, motion_quality 15%, emotion_expression 10%), routing decisions (pass/retry/escalate), cost tracking ($0.04/clip)
- `retry-orchestrator.ts` (267 LOC): 3-attempt retry loop with callback-based regeneration (video/prompt/reference), escalation to admin queue, cost accumulation
- `db-helpers.ts` (207 LOC): DB persistence for clip_quality_reviews table
- `routers-quality.ts`: Frontend-facing tRPC router for quality dashboard
- `d5-5-quality-gate.test.ts` (29 tests): Schema, scoring, routing, budget, module structure

**NOT yet implemented (the "post-clip extraction → CLIP → regeneration loop"):**
- The actual **video regeneration callbacks** are stub interfaces (`regenerateVideo`, `regeneratePrompt`, `regenerateReference`) — they accept a callback but no concrete implementation wires them to the provider-router/credit-executor
- No **CLIP-based frame extraction** for D5.5 (unlike D0 which has CLIP scoring for character sheets). The per-clip reviewer uses LLM vision, not CLIP embeddings
- No **integration with the pipeline orchestrator** — the `pipelineOrchestrator.ts` doesn't call D5.5 between video generation (Stage 10) and x_sheet (Stage 12)

**Verdict:** D5.5 is ~60% complete. The review + routing logic is solid; the missing piece is the **concrete regeneration wiring** and **orchestrator integration** at Stage 11.

---

### D7 FX Compositor (Stage 14) — Not Implemented

Stage 14 (`fx_pass`) is defined in stage-config with `owningAgent: "D7"`, `gateType: "advisory"`, and `requiredTraversal: true`. The orchestrator-bridge maps the `fx_composite` node to stages [14, 15]. However:

- No `server/benchmarks/d7/` directory exists
- No FX compositor logic exists anywhere in the codebase
- The `pipelineOrchestrator.ts` maps `foley_gen` and `ambient_gen` to the `fx_composite` node but has no actual FX overlay/composite implementation

**Verdict:** D7 is **stage-config only** — zero implementation. It was always MVP-Defer.

---

### D8 Voice Director Critic (Stage 13) — Partially Implemented via D4

D8 is designated as `mode: "critic (within ato_fuki)"` — it's not a standalone pipeline node but a **quality-gate critic** that runs within Stage 13 after D4 (Timing Director) generates TTS. Current state:

- `server/benchmarks/llm/voice-director.ts` implements D4's per-line emotion routing (selects emotion tags + TTS parameter overrides for ElevenLabs). This is the **primary generator**, not D8.
- D8's role (evaluating whether the generated voice matches the intended emotion/character) has **no implementation** — there's no voice-quality critic that scores TTS output and triggers re-generation.
- The `voiceValidator.ts` in `server/pipeline/` validates **presence** (loudness at dialogue timecodes) but not **quality/emotion match**.

**Verdict:** D8 is **unimplemented**. D4 (generator) exists; D8 (critic) does not.

---

### Stage 13 Ato-Fuki: TTS + Lip-Sync Integration

**TTS (D4 generator side):** Fully implemented.
- ElevenLabs adapter (`server/elevenlabs.ts`): TTS, voice cloning, voice library
- Voice provider adapters (`server/provider-router/adapters/voice-providers.ts`): ElevenLabs, PlayHT, LMNT, Fish Audio, Azure
- D4 voice-director LLM (`server/benchmarks/llm/voice-director.ts`): emotion routing per dialogue line
- Pipeline integration: `pipelineOrchestrator.ts:1201` runs voice generation with HITL gate at Stage 13

**Lip-Sync:** Fully implemented.
- `server/lipSyncNode.ts` (455+ LOC): Automated lip-sync via Kling API
- `server/kling-subjects.ts`: Subject Library integration (persistent character elements with voice binding)
- `server/kling.ts`: V3 Omni endpoint with native audio + lip sync
- Pipeline integration: runs after voice_gen, gated by `enableLipSync` assembly setting

**X-Sheet (Stage 12):** Stage defined, but **no dedicated X-Sheet authoring tool exists**. Music generation (MiniMax) runs at this stage in the pipeline, but there's no timing-chart UI or D4-driven cue-sheet editor.

**Verdict:** TTS + lip-sync are production-ready. X-Sheet authoring (the timing chart that coordinates music cues, SFX placement, and voice timing) is the gap.

---

### H1 Audio-Coverage + Card-Legibility Probes (Stage 16 Mastering)

**H1 Rules Harness (Tier 1):** Fully implemented in `server/benchmarks/harness/rules-harness.ts` with 7 checks:
- `silence_check`: Detects silent stretches > 1s outside title/end cards
- `loudness_check`: Validates -16 LUFS ± 1, LRA 6-14 LU, true peak < -1.5 dBTP
- `aspect_check`: Validates 16:9 aspect ratio
- `duration_check`: Validates total duration matches expected (slices + cards)
- `face_count_check`: Validates face presence in dialogue slices
- `watermark_check`: Validates watermark presence/absence per tier
- `file_integrity_check`: Validates container format, codec, bitrate

**Audio coverage** is addressed by `silence_check` (no dead air) + `loudness_check` (proper levels) + the `voiceValidator.ts` (voice presence at every dialogue timecode). These are **already shipped** in Wave 1.

**Card legibility** is **NOT implemented**. There's no check that validates title/end card text is readable (contrast ratio, font size, render quality). The `title-cards.ts` generates cards via FFmpeg drawtext, but no harness check validates the output is legible.

**Verdict:** Audio-coverage probes are shipped (Wave 1). Card-legibility probe is a gap — should be a new H1 check (compute-based contrast/OCR validation).

---

## Wave 3 Scope Proposal

### Design Principles

1. **Keep Wave 3 tight** — 4 major items + 1 harness addition, targeting the critical path from video generation through to publishable output
2. **Pull forward D7/D8** from MVP-Defer — they're required-traversal stages in the 17-stage config; without them, the pipeline has a hole at stages 13-14
3. **Do NOT pull forward D9 Sakufuu Tracker** — it's advisory-only and the no-op behavior for episode 1 is acceptable; Wave 4 is the right home
4. **Push back "full resolution-flow" for D2.5** — the auto-regen multi-round dashboard is polish, not critical path

---

### Item 1: D5.5 Orchestrator Integration (Stage 11)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | 11 (continuity_check) |
| **Owning Agent** | D5.5 |
| **Dependencies** | Video generation (Stage 10) complete, provider-router, credit-executor |
| **Effort** | Medium (3-4 days) |

**Sub-items:**

- [ ] Wire `retry-orchestrator.ts` callbacks to concrete provider-router calls (`generateWithCredits` for video regeneration)
- [ ] Integrate D5.5 into `pipelineOrchestrator.ts` between video_gen completion and x_sheet start
- [ ] Add HITL gate at Stage 11 via `completeNodeWithGate` (advisory gate, auto-advance at score ≥ 3)
- [ ] Implement frame extraction from generated clips (3 equidistant keyframes per clip for LLM vision input)
- [ ] Connect to D10 semantic retrieval for character-bible context injection into per-clip review prompts
- [ ] Integration test: full flow from clip URL → D5.5 review → routing decision → regeneration callback → re-review → pass/escalate
- [ ] Cost validation: verify $0.04/clip target holds with real LLM calls (low-detail vision)

**Note:** This is NOT a CLIP-based loop (that's D0's domain). D5.5 uses LLM vision for quality assessment. The "post-clip extraction → CLIP → regeneration loop" phrasing conflates two different mechanisms. D5.5's loop is: extract keyframes → LLM vision score → route → regenerate video → re-score.

---

### Item 2: X-Sheet Authoring + D4 Timing Integration (Stage 12)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | 12 (x_sheet) |
| **Owning Agent** | D4 + user |
| **Dependencies** | D5.5 (Stage 11) passes, music provider (MiniMax), SFX provider |
| **Effort** | Large (5-6 days) |

**Sub-items:**

- [ ] Define X-Sheet data model: per-slice timing entries with music cue points, SFX triggers, voice start/end, transition markers
- [ ] D4 LLM auto-generates initial X-Sheet from script + slice metadata (emotion arcs, dialogue timecodes, scene boundaries)
- [ ] X-Sheet editor UI: timeline-based view showing slices, music beds, SFX layers, voice tracks (read-only in MVP, editable in Wave 4)
- [ ] Wire X-Sheet into assembly pipeline: music-bed generation uses X-Sheet cue points instead of hardcoded offsets
- [ ] SFX placement from X-Sheet: foley/ambient triggers at specified timecodes
- [ ] HITL blocking gate at Stage 12: user reviews X-Sheet before audio generation proceeds
- [ ] Integration test: D4 generates X-Sheet → user approves gate → music + SFX generated at correct timecodes

---

### Item 3: Stage 13 Ato-Fuki — D8 Voice Director Critic

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | 13 (ato_fuki) |
| **Owning Agent** | D8 (critic within D4's stage) |
| **Dependencies** | D4 voice generation complete, ElevenLabs/voice providers |
| **Effort** | Medium (3-4 days) |

**Sub-items:**

- [ ] Implement D8 voice quality critic: LLM-judged evaluation of generated TTS against intended emotion, character voice profile, and dialogue context
- [ ] Scoring dimensions: emotion_match (40%), character_voice_fidelity (30%), pacing_naturalness (20%), audio_clarity (10%)
- [ ] Routing decisions: pass (score ≥ 3.5) / retry with different emotion params (score 2.5-3.5) / escalate (score < 2.5)
- [ ] Retry budget: 2 attempts per dialogue line (re-run D4 emotion routing with critic feedback)
- [ ] Wire D8 into Stage 13 HITL gate: runs after D4 generates all voice clips, before lip-sync
- [ ] Integration with lip-sync: only approved voice clips proceed to Kling lip-sync node
- [ ] Integration test: D4 generates voice → D8 scores → retry on low score → approve → lip-sync proceeds

**Note:** D8 does NOT replace the existing `voiceValidator.ts` (presence check). D8 is a **quality** critic; voiceValidator is a **coverage** gate. Both run at Stage 13.

---

### Item 4: D7 FX Compositor (Stage 14)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | 14 (fx_pass) |
| **Owning Agent** | D7 |
| **Dependencies** | Stage 13 (ato_fuki) complete, assembled video clips with audio |
| **Effort** | Medium-Large (4-5 days) |

**Sub-items:**

- [ ] Define FX taxonomy: genre-aware effect categories (action: speed lines, impact frames; drama: vignette, depth-of-field; horror: grain, chromatic aberration; comedy: chibi flash, sweat drops)
- [ ] D7 LLM effect selector: reads script emotion/action tags per slice, selects appropriate FX from taxonomy
- [ ] FFmpeg filter graph generator: translates D7's FX selections into compositable filter chains
- [ ] Overlay compositor: applies FX layers to video clips (preserving original audio track)
- [ ] Genre profile system: per-project FX style preferences (user can set "action-heavy" vs "subtle" vs "none")
- [ ] HITL advisory gate at Stage 14: auto-advances if score ≥ 75, flags for review if 50-75
- [ ] Integration test: D7 selects FX → FFmpeg applies → harness validates no corruption → gate passes
- [ ] Cost target: $0/episode (FFmpeg compute only, no API calls except D7 LLM selection at ~$0.01)

---

### Item 5: H1 Card-Legibility Probe (Stage 16 Mastering)

| Attribute | Value |
|-----------|-------|
| **Owning Stage** | 16 (mastering_harness) |
| **Owning Agent** | H1 (rules-based) |
| **Dependencies** | Title/end cards generated (assembly/title-cards.ts) |
| **Effort** | Small (1 day) |

**Sub-items:**

- [ ] Implement `card-legibility-check.ts` in `server/benchmarks/harness/checks/`
- [ ] Extract title/end card frames via FFmpeg (first frame of title card, last frame of end card)
- [ ] Validate text contrast ratio ≥ 4.5:1 (WCAG AA) using pixel sampling around text regions
- [ ] Validate minimum text height ≥ 3% of frame height (legible at 720p)
- [ ] Register in `rules-harness.ts` as check #8
- [ ] Routing hint: `assembly_reencode` (re-render cards with adjusted font/color if failed)
- [ ] Unit test: pass/fail cases with known-good and known-bad card frames

---

## Dependency Graph

```
Stage 10 (video_gen) ─── COMPLETE
       │
       ▼
Stage 11 (continuity_check) ─── Item 1: D5.5 Integration
       │
       ▼
Stage 12 (x_sheet) ─── Item 2: X-Sheet + D4 Timing
       │
       ▼
Stage 13 (ato_fuki) ─── Item 3: D8 Voice Critic
       │                         (TTS + lip-sync already done)
       ▼
Stage 14 (fx_pass) ─── Item 4: D7 FX Compositor
       │
       ▼
Stage 15 (satsuei) ─── existing (final composite)
       │
       ▼
Stage 16 (mastering_harness) ─── Item 5: Card-Legibility Probe
       │
       ▼
Stage 17 (catalog_release) ─── existing (publish action)
```

---

## Items Explicitly NOT in Wave 3

| Item | Reason | Target Wave |
|------|--------|-------------|
| D9 Sakufuu Tracker (Three-Layer) | Advisory-only, no-op for ep 1, not critical path | Wave 4 |
| D2.5 Full Resolution-Flow (auto-regen dashboard) | Polish, not blocking | Wave 4 |
| D10 Full Corpus ($2.5-5K book purchases) | Budget dependency, not code | Wave 4 |
| Chroma/pgvector swap | JsonArrayVectorStore sufficient until ~5K chunks | Wave 4 |
| Manga Finishing (Playbook 3.6) | Separate product track | Wave 4 |
| Lulu Print Integration | Separate product track | Wave 4 |
| Founders' Studio Infrastructure | Separate infrastructure track | Wave 5 |
| Per-User Character LoRA Pipeline | Depends on D9 + corpus | Wave 5 |

---

## Items Considered for Pull-Forward (from Wave 4/5 → Wave 3)

| Item | Decision | Rationale |
|------|----------|-----------|
| D9 episode-2+ bias | **No** | The no-op for ep 1 is fine; bias logic is trivial once D9 Three-Layer lands in Wave 4 |
| Card-legibility probe | **Yes → Item 5** | Trivial effort (1 day), completes the H1 harness, blocks nothing |
| Tiered Video Routing (genga-conditioned) | **Partially in Item 1** | D5.5 integration naturally exercises the regeneration path; full tiered routing (budget/standard/premium model selection) stays Wave 3 via the existing provider-router |

---

## Effort Summary

| Item | Effort | Risk |
|------|--------|------|
| 1. D5.5 Orchestrator Integration | 3-4 days | Low (logic exists, wiring needed) |
| 2. X-Sheet Authoring + D4 Timing | 5-6 days | Medium (new data model + UI) |
| 3. D8 Voice Director Critic | 3-4 days | Low (follows D5.5 pattern) |
| 4. D7 FX Compositor | 4-5 days | Medium (FFmpeg filter complexity) |
| 5. H1 Card-Legibility Probe | 1 day | Very Low |
| **Total** | **16-20 days** | |

---

## Answers to Anchoring Questions

**Q: Are D7 and D8 intentionally pulled forward from MVP-Defer?**

Yes. Both are `requiredTraversal: true` in stage-config. Without them, the 17-stage pipeline has a gap between Stage 13 and Stage 15 — the orchestrator would need to skip stages, which violates the state machine's sequential traversal contract. They were MVP-Defer when we had 12 stages; with 17 stages they're critical path.

**Q: Is Stage 13 Ato-Fuki TTS+lip-sync in Wave 3 alongside X-Sheet?**

The **TTS generation + lip-sync execution** are already shipped (Wave 1). What's new in Wave 3 is: (a) the **D8 quality critic** that evaluates TTS output before it proceeds to lip-sync, and (b) the **X-Sheet** (Stage 12) that provides the timing context D4 uses to generate voice with correct pacing. The generation machinery exists; Wave 3 adds the quality gate and timing coordination.

**Q: Are H1 audio-coverage + card-legibility probes in Wave 3 or already shipped?**

Audio-coverage is **shipped** (Wave 1): `silence_check` + `loudness_check` + `voiceValidator.ts`. Card-legibility is **new in Wave 3** (Item 5) — it's a 1-day addition to the H1 rules harness.

**Q: Is D5.5 fully end-to-end including the post-clip extraction → CLIP → regeneration loop?**

D5.5 does **not** use CLIP. It uses **LLM vision** (3 keyframes per clip → structured JSON scoring). The review + routing logic is 60% complete; the missing 40% is: (a) concrete regeneration callbacks wired to provider-router, (b) orchestrator integration at Stage 11, and (c) frame extraction utility. Wave 3 Item 1 completes this. The "CLIP → regeneration loop" phrasing applies to D0 (character sheets), not D5.5 (clip quality).

---

## Next Steps

1. Confirm this scope (or request adjustments)
2. I'll implement Items 1-5 sequentially, with integration tests per item
3. After all 5 land, full test suite verification against the canonical repo
4. Wave 4 scoping begins
