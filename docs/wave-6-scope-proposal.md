# Wave 6 Scope Proposal — Awakli

**Date:** May 6, 2026 (updated with Hassan's 5 clarifications)  
**Author:** Manus  
**Status:** Greenlit — implementation starting  
**Pairs with:** Awakli Pipeline Blueprint v1.9.1 Adapter Architecture Addendum, Wave 6 Scope Direction memo  
**Estimated total:** 20–27 days, split into Wave 6A (10–15 days) and Wave 6B (10–12 days)

---

## Wave Split

Per clarification (3), Wave 6 is split into two sub-waves with a verification checkpoint between them:

**Wave 6A** (10–15 days): Architectural foundation
- fal.ai multi-DoRA spike (0.5 days)
- Item 5: RAG Retrieval Pool Seeding (1–2 days)
- Item 1: Three-Adapter Composition Runtime + RAG Hybrid (7–10 days)
- Item 6: TTS Migration to Inworld + Kokoro (1–2 days) — parallel with Item 1

**Wave 6B** (10–12 days): Dependent work (starts after Wave 6A verification passes)
- Item 2: Prompt-Style Adapter (3–4 days)
- Item 3: Premium Tier Features Unlock (4–5 days)
- Item 4: Premium Video Model Integration (4–5 days)

---

## Execution Order (Wave 6A)

```
fal.ai multi-DoRA spike (0.5 days)
  ↓
Item 5 (RAG Retrieval Pool Seeding, 1-2 days)
  ↓
Item 1 (Three-Adapter Composition Runtime + RAG Hybrid, 7-10 days)
  ‖ parallel
Item 6 (TTS Migration to Inworld + Kokoro, 1-2 days)
  ↓
Wave 6A verification checkpoint
```

## Execution Order (Wave 6B)

```
Item 2 (Prompt-Style Adapter, 3-4 days)
  ↓
Item 3 (Premium Tier Features Unlock, 4-5 days)
  ↓
Item 4 (Premium Video Model Integration, 4-5 days)
  ↓
Wave 6B verification checkpoint
```

---

## Pre-Item: fal.ai Multi-DoRA Technical Spike (0.5 days)

### Purpose

De-risk Item 1 before any dependent work starts. Per clarification (2), this spike runs first to confirm whether fal.ai's custom inference supports multi-adapter (DoRA) stacking natively.

### Deliverable

Written finding document (`docs/fal-ai-dora-spike.md`) containing:
- Whether fal.ai custom inference supports loading 3 DoRA adapters simultaneously
- Code snippets from docs/community confirming or denying
- If no-go: which fallback path (RunPod custom endpoint vs sequential-with-merge) is recommended
- Go/no-go recommendation for Item 1.4

### Method

- Review fal.ai documentation for custom model endpoints and LoRA/DoRA stacking
- Check fal.ai community forums / Discord for multi-adapter usage patterns
- If docs are unclear, construct a minimal test request structure to validate

---

## Item 5: D10 RAG Retrieval Pool Seeding (1–2 days)

### Purpose

Populate the genre-tagged retrieval pool so Item 1's RAG-augmented genre adapter has content to retrieve from. Without this, the cold-start fallback (DoRA-only) would be the only path, defeating the purpose of the hybrid architecture.

### Sub-items

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 5.1 | Genre taxonomy enum + tagging schema migration | 0.25 days | `genreTag` column on approved content tables (Shōnen, Shōjo, Seinen, Josei, Kodomomuke) |
| 5.2 | Auto-tagger procedure: classify approved Founders' Studio keyframes into genre buckets using LLM + metadata heuristics | 0.5 days | `tagApprovedContentGenre` procedure in `routers-d10.ts` |
| 5.3 | Embedding generation for approved keyframes: batch-embed approved frames into JsonArrayVectorStore with genre metadata | 0.5 days | `seedGenreRetrievalPool` admin procedure, embeddings stored via existing `IVectorStore.upsert()` |
| 5.4 | Cold-start confidence threshold: if <500 approved frames per genre, mark retrieval as low-confidence | 0.25 days | `getGenrePoolConfidence()` helper returning `{ genre, frameCount, confidence: 'high' | 'low' }` |
| 5.5 | Tests for retrieval pool seeding | 0.25 days | Vitest covering tagging, embedding, confidence threshold |

### Dependencies

- Existing `IVectorStore` interface (Wave 2.5) and `JsonArrayVectorStore` implementation
- Existing `embed()` / `embedBatch()` methods on the vector store
- At least some approved Founders' Studio content in the database (even seed data suffices for structural validation)

### Integration Points

- `server/benchmarks/d10/vector-store.ts` — existing IVectorStore with `upsert()`, `search()`, `embed()`
- `drizzle/schema.ts` — new `genreTag` column on relevant content tables
- `server/routers-d10.ts` or new `server/routers-genre-pool.ts`

---

## Item 1: Three-Adapter Composition Runtime + RAG Hybrid (7–10 days)

### Purpose

The core architectural deliverable of Wave 6. Implements the `AdapterComposer` interface that stacks genre + character + sakufuu DoRA adapters at inference time, with RAG-augmented IP-Adapter conditioning for the genre signal. This is the runtime that every upstream visual stage (D0, D1.5, D7) calls for generation.

### Sub-items

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 1.1 | `AdapterComposer` interface design | 0.5 days | Provider-agnostic interface: `compose({ adapters: DoRAAdapter[], ipAdapterConfig?, stage, blendWeights })` → generation params |
| 1.2 | DoRA adapter type + PiSSA initialization wiring into TrainingProvider | 1 day | Extend `TrainingProvider.submitTraining()` with `adapterType: 'dora' | 'lora'` and `initialization: 'pissa' | 'random'` params; default new jobs to DoRA + PiSSA |
| 1.3 | Per-stage blend weight defaults | 0.5 days | Config object: D0 (character 0.8, genre 0.3, sakufuu 0.3), D1.5 (all 1.0), D7 (genre 0.8, sakufuu 0.7, character 0.2) — tunable per project |
| 1.4 | fal.ai composition executor | 1.5 days | `FalCompositionExecutor` class implementing `AdapterComposer` via fal.ai's custom inference endpoint for DoRA stacking (contingent on spike go/no-go) |
| 1.5 | RunPod composition executor (cost-optimized alternative) | 1 day | `RunPodCompositionExecutor` as secondary provider, same interface |
| 1.6 | RAG retrieval integration in composition path | 1 day | Query D10 vector store by scene metadata → return nearest-neighbor genre references → feed to IP-Adapter conditioning |
| 1.7 | IP-Adapter conditioning weight management | 0.5 days | Default 0.4–0.5, per-stage tunable, cold-start fallback (confidence < threshold → skip IP-Adapter, DoRA-only) |
| 1.8 | Pipeline integration: wire AdapterComposer into D0/D1.5/D7 generation stages | 1.5 days | Modify `pipelineOrchestrator.ts` and stage handlers to call `AdapterComposer.compose()` before generation |
| 1.9 | Migration path for existing LoRA training jobs | 0.5 days | `migrateLoraToDoraConfig()` utility; existing jobs stay as-is, new jobs default to DoRA + PiSSA |
| 1.10 | E2E verification test | 0.5 days | Episode generation with three-adapter composition at D0/D1.5/D7, RAG retrieval surfacing genre references, IP-Adapter conditioning visible in output metadata |
| 1.11 | Unit + integration tests | 0.5 days | AdapterComposer interface, blend weights, cold-start fallback, fal.ai executor mock, RunPod executor mock |

### Dependencies

- fal.ai spike complete (go/no-go determines Item 1.4 approach)
- Item 5 complete (genre retrieval pool seeded)
- `FAL_API_KEY` already configured (confirmed in env.ts)
- Existing `TrainingProvider` interface in `server/benchmarks/sakufuu/lora-training.ts`
- Existing IP-Adapter fallback logic in `server/character-lora-pipeline.test.ts` (lines 666–683)

### Integration Points

- `server/benchmarks/sakufuu/lora-training.ts` — extend TrainingProvider with DoRA/PiSSA params
- `server/lora-training-pipeline.ts` — model support matrix (line 134 already has fal.ai models)
- `server/pipelineOrchestrator.ts` — wire composition into generation stages
- `server/provider-router/adapters/image-providers.ts` — fal.ai already integrated (line 96+)
- `server/benchmarks/d10/vector-store.ts` — retrieval for genre references

### Architectural Notes

- Interface named `AdapterComposer` (cleaner than retaining "LoRA" per addendum §9 suggestion)
- DoRA stacking is mathematically identical to LoRA stacking at inference — no new math, just config
- PiSSA is a pure training-time change (SVD initialization); no inference-time impact
- fal.ai primary because it's already integrated (image providers, voice providers) — lowest integration risk
- RunPod as cost-optimized alternative for when monthly spend crosses ~$500/month

---

## Item 6: TTS Migration to Inworld + Kokoro (1–2 days)

### Purpose

Replace ElevenLabs as primary TTS with Inworld TTS-1.5-Max (Creator+ tiers) and Kokoro (Free tier). "Better and cheaper" — higher ELO score at 1/12th the cost.

### Sub-items

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 6.1 | Inworld TTS-1.5-Max adapter | 0.5 days | New adapter in `server/provider-router/adapters/voice-providers.ts` using `createVoiceAdapter()` factory; voice cloning support for 5–15s samples |
| 6.2 | Kokoro Free-tier adapter | 0.5 days | Kokoro adapter via fal.ai self-hosted endpoint (or API at $0.70/M chars); no voice cloning |
| 6.3 | Tier-routing update | 0.25 days | Free → Kokoro, Creator+ → Inworld, ElevenLabs → fallback only. Update `voice-providers.ts` registration order and tier-gating logic |
| 6.4 | D8 retry budget update | 0.25 days | Increase retries from 2 to 3 per dialogue line (cost-favorable with Inworld pricing) |
| 6.5 | Tests | 0.25 days | Adapter validation, tier routing, retry budget, ElevenLabs fallback path |

### Dependencies

- Inworld API key (new env var needed: `INWORLD_API_KEY`)
- Kokoro endpoint (either fal.ai hosted or external API — needs clarification from Hassan)

### Integration Points

- `server/provider-router/adapters/voice-providers.ts` — existing adapter factory pattern
- `server/provider-router/registry.ts` — register new adapters
- D8 voice critic retry logic (existing in pipeline)

### Note

Per clarification (4), silent-output enforcement verification (previously Item 6.5) has been moved to Item 4 (Premium Video Model Integration) since it's a video generation constraint, not a TTS concern.

---

## Item 2: Prompt-Style Adapter (3–4 days) — Wave 6B

### Purpose

D9 component per Blueprint Stage 17. Learns the creator's preferred prompting language from D9 Sakufuu Tracker approval/rejection patterns. Lightweight LLM-based adapter — not heavy ML training.

### Sub-items

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 2.1 | Prompt pattern extraction from D9 approval history | 1 day | `extractPromptPatterns(creatorId)` — analyzes approved vs rejected prompts, identifies creator's preferred vocabulary, structure, emphasis patterns |
| 2.2 | LLM-based prompt rewriter | 1 day | `rewritePromptForCreator(basePrompt, creatorPatterns)` — adapts pipeline-generated prompts to match creator's style preferences using invokeLLM with few-shot examples from their approval history |
| 2.3 | Integration with pipeline prompt generation | 0.5 days | Wire prompt-style adapter into D0/D1.5/D7 prompt construction, after scene description but before generation call |
| 2.4 | Per-creator pattern caching + refresh cycle | 0.5 days | Cache extracted patterns, refresh every N approvals (configurable); store in DB |
| 2.5 | Tests | 0.5 days | Pattern extraction accuracy, prompt rewriting quality, caching behavior |

### Dependencies

- Item 1 complete (composition runtime operational — prompt-style adapter feeds into the same generation path)
- D9 Sakufuu Tracker approval/rejection data in database (Wave 5B)

---

## Item 3: Premium Tier Features Unlock (4–5 days) — Wave 6B

### Purpose

Unlock three premium-tier features that are architecturally ready but not yet exposed to users: creator-uploaded reference library (Pro+), AI screentone (Pro+), and D7 advanced FX (Pro+).

### Sub-items

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 3.1 | Pro-tier creator-uploaded reference library | 1.5 days | Upload endpoint for private supplements to D10 corpus; storage via S3 + metadata in DB; embedding generation; retrieval scoped to creator's own uploads |
| 3.2 | AI screentone option (Pro+ upsell) | 1.5 days | Opt-in per project; wire existing screentone engine (Wave 5C tier-gated) into generation path with user toggle; billing via credit deduction |
| 3.3 | D7 advanced FX categories | 1 day | Premium-tier additional effect categories beyond base set; user-configurable FX intensity slider (0.0–1.0); tier-gate enforcement |
| 3.4 | Frontend UI for premium features | 0.5 days | Settings/toggle UI for screentone, FX intensity; upload interface for reference library |
| 3.5 | Tests | 0.5 days | Upload flow, tier gating, screentone toggle, FX intensity bounds |

### Dependencies

- Item 1 complete (reference library feeds into RAG retrieval path)
- Existing screentone engine (Wave 5C, confirmed tier-gated)
- Existing D7 FX infrastructure

---

## Item 4: Premium Video Model Integration (4–5 days) — Wave 6B

### Purpose

Integrate the locked premium video provider (determined by comparative test) for sakuga shots. Enforces silent-output rule per §5.1.

### Sub-items

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 4.1 | Comparative quality test (1 day) | 1 day | Generate 5–10 sakuga shots across **PixVerse V4.5 / Seedance 2.0 Fast / Veo 3.1 / Kling 3.0 i2v**. Score on: anime style fit, genga conditioning acceptance, cost/clip, silent-output compliance, integration complexity. Document results + recommendation |
| 4.2 | Provider adapter implementation | 1.5 days | New adapter in `server/provider-router/adapters/video-providers.ts` for locked provider using `createVideoAdapter()` factory; silent-output flag enforced |
| 4.3 | One-Model-Per-Tier routing update | 0.5 days | sakuga-tagged clips → new premium provider; budget/standard tiers unchanged (Wan 2.7 / Kling 1.5 Pro) |
| 4.4 | Silent-output enforcement verification | 0.5 days | Confirm all video generation paths have `audio: false` / silent flag set per §5.1 audio rule (moved from Item 6 per clarification 4) |
| 4.5 | Silent-output verification tests | 0.5 days | Automated test confirming audio is disabled in all video generation requests across all tiers |
| 4.6 | Integration tests | 0.5 days | End-to-end sakuga generation through new provider, tier routing, fallback to Kling 3.0 |

### Dependencies

- API keys for test providers (PixVerse, Seedance, Veo 3.1 — new env vars needed)
- Item 4.1 result determines which provider to fully integrate
- Existing video provider adapter pattern in `server/provider-router/adapters/video-providers.ts`

### Note on Veo 3.1

Per clarification (1), Veo 3.1 is added to the comparative test. It's listed in addendum §5.2 as premium-quality fallback at $0.03/sec (~$0.15/5sec clip). Its native audio generation must be explicitly disabled per the audio rule — this is a test criterion.

---

## Architectural Acknowledgments

### Decisions Accepted Without Pushback

1. **DoRA + PiSSA as default adapter type** — strict upgrade, drop-in compatible, no architectural reshape needed.
2. **RAG-augmented genre adapter pattern** — architecturally sound. D10's `IVectorStore` already has the required methods.
3. **Audio rule (silent video across all tiers)** — clean constraint, enforced in Item 4.
4. **TTS migration to Inworld + Kokoro** — straightforward adapter addition via existing factory.
5. **fal.ai primary for AdapterComposer** — already integrated, lowest risk. Confirmed by spike before committing.
6. **Training data hygiene rules** — operational constraints, no code impact.

### Refinement Applied

**Naming: `AdapterComposer`** — Per addendum §9, using `AdapterComposer` as the interface name. Internal "LoRA" references in existing code stay for backward compatibility.

---

## Audit Blocker Capture

| Blocker | Status | Owner | Deadline |
|---------|--------|-------|----------|
| B1: Stripe sandbox claim | Pending Hassan verification (URL not treated as authoritative per clarification 5) | Hassan | June 13, 2026 |
| B3: E2E smoke test | Passed (Wave 5C) | Manus | Complete |
| Security audit | Passed (Wave 5C) | Manus | Complete |

---

## Operational Prerequisites from Hassan

| # | Prerequisite | Blocking Item | Priority | Status |
|---|---|---|---|---|
| 1 | **Inworld API key** (`INWORLD_API_KEY`) | Item 6 | High | Hassan actioning |
| 2 | **Kokoro endpoint confirmation** | Item 6 | High | Hassan actioning |
| 3 | **PixVerse V4.5 API access** | Item 4 (Wave 6B) | Medium | Hassan actioning |
| 4 | **Seedance 2.0 API access** | Item 4 (Wave 6B) | Medium | Hassan actioning |
| 5 | **Veo 3.1 API access** | Item 4 (Wave 6B) | Medium | Hassan actioning |
| 6 | **Stripe sandbox claim** (B1) | None (parallel) | High | Hassan verifying URL |
| 7 | **fal.ai multi-DoRA stacking** | Item 1 | High | Manus spike (first action) |
| 8 | **Founders' Studio creator shortlist** | Item 5 | Medium | Hassan actioning |
| 9 | **MAX_COST_PER_ISSUE env var value** | None (config) | Low | Hassan actioning |
| 10 | **Cal.com API key** (`CALCOM_API_KEY`) | Production config | Low | Hassan actioning |
| 11 | **Discord bot token** (`DISCORD_BOT_TOKEN`) | Production config | Low | Hassan actioning |

---

## Scope Boundaries — Explicitly Deferred to Wave 7+

The following are **NOT in Wave 6 scope** (deferred by design per addendum §7):

- Master-style visual adapters (Imaishi-style, Nakamura-style) — requires ~50+ accumulated tagged frames
- StoryMaker / StoryDiffusion / PuLID character consistency enhancements
- Three-adapter migration of ALL existing training jobs (only new jobs default to DoRA)
- D10 corpus book purchases ($150 D10.M, $1K–3K D10.G) — operational, not engineering
- RunPod/Lambda Labs training migration (cost optimization)
- Multilingual TTS via Google Chirp 3 HD

---

## Verification Protocol

Per Wave 5C lessons, each item's completion report will include:

1. **File paths + line excerpts** for every new interface, procedure, and adapter
2. **Explicit separation** of "shipped" vs "deferred by design" — no bundling
3. **Test count** per item with pass/fail summary
4. **Self-verification script** for high-blast-radius items (Items 1, 4, 6) confirming:
   - Cost gates are enforced (no unbounded API calls)
   - Silent-output flag is set on all video generation paths
   - Tier routing directs to correct provider per tier
   - Admin approval gates are in place for training jobs

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| fal.ai doesn't support multi-DoRA stacking natively | Item 1 delayed 2–3 days | Spike identifies this before implementation starts; fallback to RunPod or sequential-with-merge |
| PixVerse V4.5 / Veo 3.1 not yet publicly available | Item 4 comparative test incomplete | Proceed with available providers; add missing ones when access lands |
| Inworld API has undocumented rate limits | Item 6 degraded | ElevenLabs fallback already wired; circuit breaker pattern |
| Cold-start retrieval pool too sparse | Item 1 RAG path unused | Graceful fallback to DoRA-only; RAG improves as content accumulates |
| Item 1 integration complexity exceeds estimate | Wave 6A timeline extends | Modular design: composition runtime ships first, RAG hybrid added incrementally |
