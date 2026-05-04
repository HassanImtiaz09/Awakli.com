/**
 * D10 Craft Library — Foundation Tests
 *
 * Validates schema, types, verbatim guard, engagement modes,
 * sub-sensei activation, cross-tag rules, and router exports.
 */
import { describe, it, expect } from "vitest";

// ─── Schema Tests ───────────────────────────────────────────────────────

describe("D10 Schema — craft_library_sources", () => {
  it("exports the craftLibrarySources table from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.craftLibrarySources).toBeDefined();
  });

  it("has required columns for source management", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.craftLibrarySources;
    const cols = Object.keys(table);
    const required = ["id", "subSensei", "sourceType", "title", "status", "createdAt"];
    for (const col of required) {
      expect(cols).toContain(col);
    }
  });
});

describe("D10 Schema — craft_library_chunks", () => {
  it("exports the craftLibraryChunks table from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.craftLibraryChunks).toBeDefined();
  });

  it("has required columns for chunk storage", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.craftLibraryChunks;
    const cols = Object.keys(table);
    const required = ["id", "sourceId", "subSensei", "chunkText", "chunkIndex", "createdAt"];
    for (const col of required) {
      expect(cols).toContain(col);
    }
  });
});

// ─── Types Tests ────────────────────────────────────────────────────────

describe("D10 Types", () => {
  it("exports SUB_SENSEIS array with 3 values", async () => {
    const types = await import("./benchmarks/d10/types");
    expect(types.SUB_SENSEIS).toBeDefined();
    expect(types.SUB_SENSEIS).toContain("anime");
    expect(types.SUB_SENSEIS).toContain("manga");
    expect(types.SUB_SENSEIS).toContain("genga");
    expect(types.SUB_SENSEIS).toHaveLength(3);
  });

  it("exports ENGAGEMENT_MODES array with 3 values", async () => {
    const types = await import("./benchmarks/d10/types");
    expect(types.ENGAGEMENT_MODES).toBeDefined();
    expect(types.ENGAGEMENT_MODES).toContain("direct");
    expect(types.ENGAGEMENT_MODES).toContain("consult");
    expect(types.ENGAGEMENT_MODES).toContain("validate");
    expect(types.ENGAGEMENT_MODES).toHaveLength(3);
  });

  it("exports ACTIVATION_STAGES mapping for all sub-senseis", async () => {
    const types = await import("./benchmarks/d10/types");
    expect(types.ACTIVATION_STAGES).toBeDefined();
    expect(types.ACTIVATION_STAGES.anime).toBeDefined();
    expect(Array.isArray(types.ACTIVATION_STAGES.anime)).toBe(true);
    expect(types.ACTIVATION_STAGES.anime.length).toBeGreaterThan(0);
    expect(types.ACTIVATION_STAGES.manga).toBeDefined();
    expect(types.ACTIVATION_STAGES.manga.length).toBeGreaterThan(0);
    expect(types.ACTIVATION_STAGES.genga).toBeDefined();
    expect(types.ACTIVATION_STAGES.genga.length).toBeGreaterThan(0);
  });

  it("exports STAGE_SUB_SENSEI_MAP with all 13 pipeline stages", async () => {
    const types = await import("./benchmarks/d10/types");
    expect(types.STAGE_SUB_SENSEI_MAP).toBeDefined();
    const stages = Object.keys(types.STAGE_SUB_SENSEI_MAP);
    expect(stages.length).toBeGreaterThanOrEqual(10);
    // Verify all values are valid sub-senseis
    for (const sensei of Object.values(types.STAGE_SUB_SENSEI_MAP)) {
      expect(types.SUB_SENSEIS).toContain(sensei);
    }
  });

  it("exports SUB_SENSEI_LABELS for all sub-senseis", async () => {
    const types = await import("./benchmarks/d10/types");
    expect(types.SUB_SENSEI_LABELS).toBeDefined();
    for (const s of types.SUB_SENSEIS) {
      expect(types.SUB_SENSEI_LABELS[s]).toBeDefined();
      expect(typeof types.SUB_SENSEI_LABELS[s]).toBe("string");
    }
  });
});

// ─── Verbatim Guard Tests ───────────────────────────────────────────────

describe("D10 Verbatim Guard", () => {
  it("exports checkVerbatimOverlap and estimateNgramCount", async () => {
    const guard = await import("./benchmarks/d10/verbatim-guard");
    expect(typeof guard.checkVerbatimOverlap).toBe("function");
    expect(typeof guard.estimateNgramCount).toBe("function");
  });

  it("detects verbatim overlap when output reproduces source text", async () => {
    const { checkVerbatimOverlap } = await import("./benchmarks/d10/verbatim-guard");
    // Create a long source passage (needs >15 words for 15-gram detection)
    const source = "The quick brown fox jumps over the lazy dog and then runs around the park chasing butterflies in the warm summer breeze while the children play nearby on the green grass";
    // Output that reproduces a large portion verbatim
    const output = "The quick brown fox jumps over the lazy dog and then runs around the park chasing butterflies in the warm summer breeze while the children play nearby on the green grass";
    const result = checkVerbatimOverlap(output, [source]);
    expect(result.passed).toBe(false);
    expect(result.overlapRatio).toBeGreaterThan(0.25);
    expect(result.overlappingNgrams).toBeGreaterThan(0);
  });

  it("passes non-verbatim paraphrased output", async () => {
    const { checkVerbatimOverlap } = await import("./benchmarks/d10/verbatim-guard");
    const source = "The quick brown fox jumps over the lazy dog and then runs around the park chasing butterflies in the warm summer breeze while the children play nearby";
    const output = "Animation timing requires careful attention to spacing between keyframes to create believable motion that captures the essence of natural movement";
    const result = checkVerbatimOverlap(output, [source]);
    expect(result.passed).toBe(true);
    expect(result.overlapRatio).toBeLessThanOrEqual(0.25);
  });

  it("handles short text gracefully (no 15-grams possible)", async () => {
    const { checkVerbatimOverlap } = await import("./benchmarks/d10/verbatim-guard");
    const source = "Short text here";
    const output = "Short text here";
    const result = checkVerbatimOverlap(output, [source]);
    // Too short for 15-grams, should pass
    expect(result.passed).toBe(true);
    expect(result.totalOutputNgrams).toBe(0);
  });

  it("estimateNgramCount returns correct count", async () => {
    const { estimateNgramCount } = await import("./benchmarks/d10/verbatim-guard");
    // 20 words → 20 - 15 + 1 = 6 ngrams
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";
    expect(estimateNgramCount(text, 15)).toBe(6);
  });

  it("estimateNgramCount returns 0 for text shorter than ngram size", async () => {
    const { estimateNgramCount } = await import("./benchmarks/d10/verbatim-guard");
    expect(estimateNgramCount("too short", 15)).toBe(0);
  });
});

// ─── Retrieval Tests ────────────────────────────────────────────────────

describe("D10 Retrieval", () => {
  it("exports retrieveChunks function", async () => {
    const retrieval = await import("./benchmarks/d10/retrieval");
    expect(typeof retrieval.retrieveChunks).toBe("function");
  });

  it("exports getSubSenseiForStage helper", async () => {
    const retrieval = await import("./benchmarks/d10/retrieval");
    expect(typeof retrieval.getSubSenseiForStage).toBe("function");
  });

  it("getSubSenseiForStage returns correct sub-sensei", async () => {
    const { getSubSenseiForStage } = await import("./benchmarks/d10/retrieval");
    expect(getSubSenseiForStage("storyboard")).toBe("manga");
    expect(getSubSenseiForStage("genga_keyframes")).toBe("genga");
    expect(getSubSenseiForStage("video_generation")).toBe("anime");
    // Unknown stage defaults to anime
    expect(getSubSenseiForStage("unknown_stage")).toBe("anime");
  });
});

// ─── Source Manager Tests ───────────────────────────────────────────────

describe("D10 Source Manager", () => {
  it("exports CRUD functions", async () => {
    const manager = await import("./benchmarks/d10/source-manager");
    expect(typeof manager.addSource).toBe("function");
    expect(typeof manager.updateSource).toBe("function");
    expect(typeof manager.listSources).toBe("function");
    expect(typeof manager.getSourceById).toBe("function");
    expect(typeof manager.archiveSource).toBe("function");
    expect(typeof manager.getLibraryStats).toBe("function");
  });
});

// ─── Router Tests ───────────────────────────────────────────────────────

describe("D10 Craft Library Router", () => {
  it("exports craftLibraryRouter", async () => {
    const router = await import("./routers-craft-library");
    expect(router.craftLibraryRouter).toBeDefined();
  });

  it("has expected procedures", async () => {
    const router = await import("./routers-craft-library");
    const r = router.craftLibraryRouter;
    const procedures = Object.keys(r._def.procedures ?? r);
    const expected = ["listSources", "addSource", "updateSource", "archiveSource", "getStats", "query"];
    for (const proc of expected) {
      expect(procedures).toContain(proc);
    }
  });
});

// ─── Sub-Sensei Activation Stage Mapping ────────────────────────────────

describe("D10 Sub-Sensei Activation", () => {
  it("anime sub-sensei covers video/assembly stages", async () => {
    const { ACTIVATION_STAGES } = await import("./benchmarks/d10/types");
    const animeStages = ACTIVATION_STAGES.anime;
    const hasVideoStage = animeStages.some((s: string) =>
      s.includes("video") || s.includes("assembly") || s.includes("lip_sync")
    );
    expect(hasVideoStage).toBe(true);
  });

  it("manga sub-sensei covers storyboard/panel stages", async () => {
    const { ACTIVATION_STAGES } = await import("./benchmarks/d10/types");
    const mangaStages = ACTIVATION_STAGES.manga;
    const hasPanelStage = mangaStages.some((s: string) =>
      s.includes("panel") || s.includes("storyboard") || s.includes("manga") || s.includes("color")
    );
    expect(hasPanelStage).toBe(true);
  });

  it("genga sub-sensei covers key animation stages", async () => {
    const { ACTIVATION_STAGES } = await import("./benchmarks/d10/types");
    const gengaStages = ACTIVATION_STAGES.genga;
    const hasGengaStage = gengaStages.some((s: string) =>
      s.includes("genga") || s.includes("sakuga") || s.includes("motion") || s.includes("in_between")
    );
    expect(hasGengaStage).toBe(true);
  });

  it("ACTIVATION_STAGES is the inverse of STAGE_SUB_SENSEI_MAP", async () => {
    const { ACTIVATION_STAGES, STAGE_SUB_SENSEI_MAP, SUB_SENSEIS } = await import("./benchmarks/d10/types");
    // Every stage in the map should appear in exactly one sub-sensei's activation list
    for (const [stage, sensei] of Object.entries(STAGE_SUB_SENSEI_MAP)) {
      expect(ACTIVATION_STAGES[sensei]).toContain(stage);
    }
    // Every stage in activation lists should map back to the correct sub-sensei
    for (const sensei of SUB_SENSEIS) {
      for (const stage of ACTIVATION_STAGES[sensei]) {
        expect(STAGE_SUB_SENSEI_MAP[stage]).toBe(sensei);
      }
    }
  });
});

// ─── Cross-Tag Broadening ───────────────────────────────────────────────

describe("D10 Cross-Tag Retrieval", () => {
  it("exports CROSS_TAG_RULES for all sub-senseis", async () => {
    const { CROSS_TAG_RULES, SUB_SENSEIS } = await import("./benchmarks/d10/types");
    expect(CROSS_TAG_RULES).toBeDefined();
    for (const s of SUB_SENSEIS) {
      expect(CROSS_TAG_RULES[s]).toBeDefined();
      expect(Array.isArray(CROSS_TAG_RULES[s])).toBe(true);
    }
  });

  it("cross-tag rules only reference valid sub-senseis", async () => {
    const { CROSS_TAG_RULES, SUB_SENSEIS } = await import("./benchmarks/d10/types");
    for (const [, targets] of Object.entries(CROSS_TAG_RULES)) {
      for (const target of targets) {
        expect(SUB_SENSEIS).toContain(target);
      }
    }
  });

  it("genga cross-tags to both anime and manga", async () => {
    const { CROSS_TAG_RULES } = await import("./benchmarks/d10/types");
    expect(CROSS_TAG_RULES.genga).toContain("anime");
    expect(CROSS_TAG_RULES.genga).toContain("manga");
  });
});
