# Wave 5A Self-Verification Notes

## D9 Wiring Gap — STATUS: STILL OPEN

**Finding:** `injectSakufuuBias()` and `recordSakufuuMemory()` are defined in
`server/benchmarks/d9-sakufuu/sakufuu-pipeline.ts` but are **NOT imported or called**
by any pipeline orchestrator file. The functions are orphaned — they exist with correct
logic but nothing in the production pipeline invokes them.

**Evidence:**
- `grep -rn "injectSakufuuBias|recordSakufuuMemory|from.*sakufuu-pipeline"` returns
  only the definition site itself (no consumers outside the d9-sakufuu directory)
- `server/hitl/orchestrator-bridge.ts` mentions D9 in a comment (line 30) but does
  not import or call the functions
- `server/pipelineOrchestrator.ts` has zero references to sakufuu/D9
- `server/pipeline.ts` has zero references to sakufuu/D9

**What needs to happen:**
1. Import `injectSakufuuBias` into the pipeline orchestrator at Stage 2
2. Pass the returned `bias.signatureFx` to D7 FX Compositor
3. Import `recordSakufuuMemory` into the post-assembly step (after Stage 16)
4. Wire the bias output into video generation (palette/pacing hints) and voice gen (voice targets)

This is the gap the user identified. The Wave 4.5 hotfix created the pipeline integration
module but did NOT wire it into the actual orchestrator call chain.

---

## D10 Vector Store — STATUS: PARTIALLY WIRED

**What exists:**
- `server/benchmarks/d10/vector-store.ts` — JsonArrayVectorStore with search/upsert
- `server/benchmarks/d10/sensei.ts` — `queryCraftLibrary()` function
- `server/benchmarks/d10/retrieval.ts` — `retrieveChunks()` function
- `server/routers-craft-library.ts` — tRPC procedure calling `queryCraftLibrary()`
- D10.M orchestrator accepts `craftGuidance?: CraftGuidance` as input (L101)
- D10.M applies guidance at L226: `applyCraftGuidance(config, input.craftGuidance)`

**Gap:** D10.M does NOT internally call `queryCraftLibrary()` — it expects the caller
to pass in `craftGuidance`. This means whoever invokes `runMangaFinishing()` must
first query the D10 corpus and pass the result. The vector store IS queryable (via
the tRPC procedure and direct function call), but D10.M doesn't self-serve from it.

**Assessment:** This is an acceptable architecture (dependency injection pattern).
The print pipeline caller should query D10 before calling D10.M. The vector store
itself is operational — confirmed by the existing tRPC route and test coverage.

## Programmatic Halftone — STATUS: CONFIRMED

`screentone-engine.ts` uses deterministic pseudo-random pixel filling with genre-based
pattern defaults (ami_ten, kake_ami, suna_me, gradation). No AI generation calls.
Line 238: "Use deterministic pseudo-random for consistency"
Line 400: "For the programmatic path (default), this:"
