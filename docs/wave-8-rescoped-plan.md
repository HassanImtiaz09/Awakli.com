# Wave 8 — Re-Scoped Work Plan

**Date:** 2026-05-09  
**Author:** Manus AI  
**Status:** PROPOSED — Awaiting lock-in before execution  
**Prerequisite:** Diagnostic report accepted (11 failure surfaces documented)

---

## Context

The initial Wave 8 smoke test revealed that the pipeline reports "completed" while producing zero usable video output. The diagnostic identified 11 failure surfaces spanning error propagation, asset validation, provider routing, voice casting, timing, and quality scoring. This re-scoped plan addresses these surfaces in dependency order, ensuring each fix is verifiable before proceeding to the next.

---

## Execution Tiers

### Tier A: Pipeline Integrity (P0 — Must-fix before any re-run)

These fixes ensure the pipeline **fails loudly** when something goes wrong, rather than silently reporting success.

| # | Fix | Effort | Verification |
|---|-----|--------|--------------|
| A1 | Re-throw in assembly catch block (Surface #1) | 10 min | Pipeline with 0 video clips → status="failed" |
| A2 | Post-loop asset count validation in videoGenAgent (Surface #2) | 10 min | Pipeline with Kling API down → status="failed", error logged |
| A3 | Content-length + duration validation for MiniMax music (Surface #4) | 15 min | Corrupted 1KB response → retry or fail with clear error |
| A4 | S3 upload verification — HEAD check after storagePut (Surface #5) | 15 min | Upload returns URL → HEAD confirms 200 + correct content-length |

**Total Tier A:** ~50 minutes. After this, the pipeline either succeeds with real output or fails with actionable error messages.

---

### Tier B: Voice & Character Identity (P1 — Highest UX impact)

These fixes ensure each character has a distinct voice and the voice casting system actually works end-to-end.

| # | Fix | Effort | Verification |
|---|-----|--------|--------------|
| B1 | Character-voice mapping in voiceGenAgent (Surface #11) | 45 min | 2 characters with different voiceId → 2 different voice clips |
| B2 | Parse dialogue as per-character array, not flattened string | 30 min | Panel with 2 speakers → 2 separate voice clips generated |
| B3 | Populate voiceAssignments in production bible from characters table | 15 min | Production bible reflects cast assignments |

**Total Tier B:** ~90 minutes. After this, multi-character dialogue is intelligible.

---

### Tier C: Quality Scoring & HITL (P1 — Enables automated quality gates)

These fixes ensure the quality evaluation layer actually runs and produces meaningful scores.

| # | Fix | Effort | Verification |
|---|-----|--------|--------------|
| C1 | Deploy CLIP scoring service (or use local ViT-B/32) (Surface #3) | 60 min | scoreGeneration returns real cosine similarity, not random vectors |
| C2 | Fix HITL initializePipelineStages schema issue | 30 min | pipeline_stages table populated for run; gates created |
| C3 | Fix gate_configs scopeRef to match resolved tier | 15 min | Tier "free_trial" → gate_configs with scopeRef="free_trial" found |

**Total Tier C:** ~105 minutes. After this, HITL gates are functional and can block on low-quality output.

---

### Tier D: Provider Routing & Timing (P2 — Quality differentiation)

These fixes enable premium-tier video quality and proper pacing.

| # | Fix | Effort | Verification |
|---|-----|--------|--------------|
| D1 | Wire PixVerse V4.5 into video-provider dispatch (Surface #9) | 90 min | Sakuga-tagged panels → PixVerse endpoint called |
| D2 | Compute per-panel duration from dialogue + pacing (Surface #10) | 120 min | Panels with 2s dialogue → 3-4s clip; panels with 8s dialogue → 10-12s clip |
| D3 | Wire TTS provider selection (Cartesia for JP, ElevenLabs for EN) (Surface #8) | 60 min | Episode language=ja → Cartesia API called |

**Total Tier D:** ~270 minutes (4.5 hours). After this, premium tiers get differentiated quality.

---

### Tier E: Character-Consistent Image Generation (P2 — Long-pole)

This is the largest single work item and represents the path to proper anime character consistency.

| # | Fix | Effort | Verification |
|---|-----|--------|--------------|
| E1 | Wire adapter-composer-pipeline into orchestrator (Surface #7) | 4-8 hrs | Keyframes generated via StoryMaker/Mitsua with character refs |
| E2 | Implement D0→D1.5→D7 stage progression | 4-6 hrs | Each stage produces progressively refined images |
| E3 | CLIP consistency gate: reject panels with max-sim < 0.60 | 2 hrs | Low-consistency panels trigger regeneration |

**Total Tier E:** ~10-16 hours. This is a multi-session work item.

---

## Proposed Execution Order

```
Session 1: Tier A (50 min) → Smoke re-run → Verify failures are loud
Session 2: Tier B (90 min) → Smoke re-run → Verify multi-voice works
Session 3: Tier C (105 min) → Smoke re-run → Verify HITL gates fire
Session 4: Tier D (270 min) → Smoke re-run → Verify routing + timing
Session 5+: Tier E (10-16 hrs) → Full re-run → Verify character consistency
```

Each session ends with a smoke re-run that validates the tier's fixes. The re-run uses the same First Light content (21 panels, 2 characters) as the original test.

---

## Success Criteria for "Wave 8 Complete"

After all tiers are applied, a clean smoke test must demonstrate:

1. **Pipeline integrity**: Either produces video output OR fails with clear error (never silent "completed" with zero assets)
2. **Multi-voice**: Mira and Master Gen have distinct voices; dialogue is per-character
3. **Quality scoring**: CLIP confidence scores are real (not mock); gates block when score < threshold
4. **Video output**: At least 15/21 panels produce video clips (Kling or PixVerse)
5. **Pacing**: Clip durations vary based on dialogue length (not flat 10s)
6. **Character consistency**: CLIP mean max-sim ≥ 0.75 across all panels

---

## What This Plan Does NOT Address

The following items are explicitly deferred to Wave 9 or later:

- Bilingual JP/EN delivery (requires full localization pipeline)
- Inworld TTS-1.5-Max integration (Cartesia is the P1 alternative)
- Full X-Sheet timing director with beat-level precision
- Production-grade CLIP service deployment (local ViT-B/32 is sufficient for gates)
- Kling clip recovery (accept the $3.60 loss; prevention is in Tier A)

---

## Decision Required

Before I begin execution, please confirm:

1. **Tier scope**: Execute Tiers A+B+C in this session, or just Tier A?
2. **Provider preference**: For Surface #8 (TTS), wire Cartesia (faster, API key available) or Inworld (spec-mandated but requires new integration)?
3. **HITL behavior**: Should gates block (pause pipeline for creator approval) or remain advisory (log scores but auto-advance) for the re-run?
4. **Re-run scope**: Full 21-panel smoke test after each tier, or abbreviated 5-panel quick test?
