/**
 * Wave 6A — Item 1.10-1.11: E2E Verification + Unit/Integration Tests
 *
 * Tests for the three-adapter composition runtime:
 * - AdapterComposer interface contracts
 * - Blend weight resolution per stage
 * - IP-Adapter conditioning weight management
 * - Trigger word injection
 * - Adapter validation
 * - Cost estimation
 * - DoRA training config + migration
 * - RAG integration
 * - Pipeline integration
 * - Executor factory
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveBlendWeights,
  resolveIpAdapterWeight,
  injectTriggerWords,
  validateAdapterComposition,
  estimateCompositionCost,
  migrateLoraToDoraConfig,
  STAGE_BLEND_WEIGHTS,
  STAGE_IP_ADAPTER_WEIGHTS,
  DEFAULT_DORA_TRAINING_CONFIG,
  ROLE_TRAINING_OVERRIDES,
  type DoRAAdapter,
  type CompositionInput,
  type IPAdapterConfig,
  type CompositionStage,
} from "./adapter-composer";
import {
  FalCompositionExecutor,
  RunPodCompositionExecutor,
  createCompositionExecutor,
  selectOptimalProvider,
} from "./adapter-composer-executors";
import {
  buildIPAdapterConditioning,
  buildCompositionWithRAG,
  checkLatencyBudget,
  selectExperimentWeight,
  IP_ADAPTER_EXPERIMENTS,
  DEFAULT_LATENCY_BUDGET,
} from "./adapter-composer-rag";
import {
  composeAndGenerate,
  generateMigrationPlan,
  mapNodeToStage,
  stageSupportsComposition,
  shouldUseComposition,
  legacyLoraToAdapter,
} from "./adapter-composer-pipeline";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeAdapter(overrides: Partial<DoRAAdapter> = {}): DoRAAdapter {
  return {
    id: "test_adapter_1",
    role: "character",
    type: "dora",
    weightsUrl: "https://storage.example.com/adapters/test.safetensors",
    triggerWord: "awk_char_1",
    defaultWeight: 0.8,
    rank: 32,
    initialization: "pissa",
    baseModel: "Anything V5",
    ...overrides,
  };
}

function makeGenreAdapter(): DoRAAdapter {
  return makeAdapter({
    id: "genre_shonen_v3",
    role: "genre",
    triggerWord: "shonen_style",
    defaultWeight: 0.5,
    rank: 64,
  });
}

function makeSakufuuAdapter(): DoRAAdapter {
  return makeAdapter({
    id: "sakufuu_creator_42",
    role: "sakufuu",
    triggerWord: "sakufuu_42",
    defaultWeight: 0.6,
    rank: 48,
  });
}

function makeCompositionInput(overrides: Partial<CompositionInput> = {}): CompositionInput {
  return {
    adapters: [makeGenreAdapter(), makeAdapter(), makeSakufuuAdapter()],
    stage: "d1_5_genga",
    prompt: "dynamic action pose, energy effects, dramatic lighting",
    width: 1024,
    height: 768,
    ...overrides,
  };
}

// ─── Blend Weight Resolution Tests ──────────────────────────────────────────

describe("AdapterComposer — Blend Weight Resolution", () => {
  it("uses D0 stage defaults: character primary, genre+sakufuu modulating", () => {
    const input = makeCompositionInput({ stage: "d0_character_design" });
    const weights = resolveBlendWeights(input);

    expect(weights["genre_shonen_v3"]).toBe(0.3);
    expect(weights["test_adapter_1"]).toBe(0.8);
    expect(weights["sakufuu_creator_42"]).toBe(0.3);
  });

  it("uses D1.5 stage defaults: all three at full weight", () => {
    const input = makeCompositionInput({ stage: "d1_5_genga" });
    const weights = resolveBlendWeights(input);

    expect(weights["genre_shonen_v3"]).toBe(1.0);
    expect(weights["test_adapter_1"]).toBe(1.0);
    expect(weights["sakufuu_creator_42"]).toBe(1.0);
  });

  it("uses D7 stage defaults: genre+sakufuu primary, character low", () => {
    const input = makeCompositionInput({ stage: "d7_fx_pass" });
    const weights = resolveBlendWeights(input);

    expect(weights["genre_shonen_v3"]).toBe(0.8);
    expect(weights["test_adapter_1"]).toBe(0.2);
    expect(weights["sakufuu_creator_42"]).toBe(0.7);
  });

  it("explicit overrides take priority over stage defaults", () => {
    const input = makeCompositionInput({
      stage: "d1_5_genga",
      blendWeights: { "genre_shonen_v3": 0.6, "test_adapter_1": 0.9 },
    });
    const weights = resolveBlendWeights(input);

    expect(weights["genre_shonen_v3"]).toBe(0.6);
    expect(weights["test_adapter_1"]).toBe(0.9);
    expect(weights["sakufuu_creator_42"]).toBe(1.0); // No override, uses stage default
  });

  it("clamps weights to [0, 1] range", () => {
    const input = makeCompositionInput({
      blendWeights: { "genre_shonen_v3": 1.5, "test_adapter_1": -0.3 },
    });
    const weights = resolveBlendWeights(input);

    expect(weights["genre_shonen_v3"]).toBe(1.0);
    expect(weights["test_adapter_1"]).toBe(0);
  });

  it("all stages have defined weights for all roles", () => {
    const stages: CompositionStage[] = [
      "d0_character_design", "d1_5_genga", "d7_fx_pass", "d10_reference_gen", "custom"
    ];
    for (const stage of stages) {
      const defaults = STAGE_BLEND_WEIGHTS[stage];
      expect(defaults.character).toBeGreaterThanOrEqual(0);
      expect(defaults.genre).toBeGreaterThanOrEqual(0);
      expect(defaults.sakufuu).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── IP-Adapter Weight Tests ────────────────────────────────────────────────

describe("AdapterComposer — IP-Adapter Weight Resolution", () => {
  it("returns 0 when IP-Adapter is disabled", () => {
    const input = makeCompositionInput({
      ipAdapterConfig: {
        referenceImageUrls: ["https://example.com/ref.jpg"],
        weight: 0.5,
        enabled: false,
        source: { genreTag: "shonen", confidence: "high", poolSize: 1000, retrievalScores: [0.9] },
      },
    });
    expect(resolveIpAdapterWeight(input)).toBe(0);
  });

  it("returns 0 when no reference images", () => {
    const input = makeCompositionInput({
      ipAdapterConfig: {
        referenceImageUrls: [],
        weight: 0.5,
        enabled: true,
        source: { genreTag: "shonen", confidence: "high", poolSize: 1000, retrievalScores: [] },
      },
    });
    expect(resolveIpAdapterWeight(input)).toBe(0);
  });

  it("uses config weight when provided", () => {
    const input = makeCompositionInput({
      ipAdapterConfig: {
        referenceImageUrls: ["https://example.com/ref.jpg"],
        weight: 0.45,
        enabled: true,
        source: { genreTag: "shonen", confidence: "high", poolSize: 1000, retrievalScores: [0.9] },
      },
    });
    expect(resolveIpAdapterWeight(input)).toBe(0.45);
  });

  it("uses stage default when config weight is 0", () => {
    const input = makeCompositionInput({
      stage: "d1_5_genga",
      ipAdapterConfig: {
        referenceImageUrls: ["https://example.com/ref.jpg"],
        weight: 0,
        enabled: true,
        source: { genreTag: "shonen", confidence: "high", poolSize: 1000, retrievalScores: [0.9] },
      },
    });
    expect(resolveIpAdapterWeight(input)).toBe(STAGE_IP_ADAPTER_WEIGHTS["d1_5_genga"]);
  });

  it("returns 0 when no ipAdapterConfig", () => {
    const input = makeCompositionInput();
    expect(resolveIpAdapterWeight(input)).toBe(0);
  });
});

// ─── Trigger Word Injection Tests ───────────────────────────────────────────

describe("AdapterComposer — Trigger Word Injection", () => {
  it("prepends trigger words for active adapters", () => {
    const adapters = [makeGenreAdapter(), makeAdapter(), makeSakufuuAdapter()];
    const weights = { "genre_shonen_v3": 0.5, "test_adapter_1": 0.8, "sakufuu_creator_42": 0.6 };
    const result = injectTriggerWords("dynamic action pose", adapters, weights);

    expect(result).toBe("shonen_style, awk_char_1, sakufuu_42, dynamic action pose");
  });

  it("skips adapters with weight 0", () => {
    const adapters = [makeGenreAdapter(), makeAdapter()];
    const weights = { "genre_shonen_v3": 0, "test_adapter_1": 0.8 };
    const result = injectTriggerWords("action scene", adapters, weights);

    expect(result).toBe("awk_char_1, action scene");
  });

  it("deduplicates trigger words", () => {
    const adapter1 = makeAdapter({ id: "a1", triggerWord: "same_trigger" });
    const adapter2 = makeAdapter({ id: "a2", triggerWord: "same_trigger", role: "genre" });
    const weights = { "a1": 0.8, "a2": 0.5 };
    const result = injectTriggerWords("test prompt", [adapter1, adapter2], weights);

    expect(result).toBe("same_trigger, test prompt");
  });

  it("returns original prompt if no active adapters", () => {
    const adapters = [makeAdapter()];
    const weights = { "test_adapter_1": 0 };
    const result = injectTriggerWords("original prompt", adapters, weights);

    expect(result).toBe("original prompt");
  });

  it("does not duplicate if prompt already starts with triggers", () => {
    const adapters = [makeAdapter()];
    const weights = { "test_adapter_1": 0.8 };
    const result = injectTriggerWords("awk_char_1, dynamic action pose", adapters, weights);

    expect(result).toBe("awk_char_1, dynamic action pose");
  });
});

// ─── Adapter Validation Tests ───────────────────────────────────────────────

describe("AdapterComposer — Validation", () => {
  it("validates a valid three-adapter composition", () => {
    const adapters = [makeGenreAdapter(), makeAdapter(), makeSakufuuAdapter()];
    const result = validateAdapterComposition(adapters);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty adapter list", () => {
    const result = validateAdapterComposition([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("At least one adapter");
  });

  it("rejects more than 5 adapters", () => {
    const adapters = Array.from({ length: 6 }, (_, i) =>
      makeAdapter({ id: `adapter_${i}` })
    );
    const result = validateAdapterComposition(adapters);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Maximum 5");
  });

  it("rejects adapters with different base models", () => {
    const adapters = [
      makeAdapter({ baseModel: "Anything V5" }),
      makeAdapter({ id: "a2", baseModel: "SDXL 1.0", role: "genre" }),
    ];
    const result = validateAdapterComposition(adapters);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("different base models");
  });

  it("warns about multiple adapters with same role", () => {
    const adapters = [
      makeAdapter({ id: "char1" }),
      makeAdapter({ id: "char2" }), // Same role: character
    ];
    const result = validateAdapterComposition(adapters);
    expect(result.valid).toBe(true); // Warning, not error
    expect(result.warnings.some((w) => w.includes("Multiple adapters"))).toBe(true);
  });

  it("warns about mixing DoRA and LoRA", () => {
    const adapters = [
      makeAdapter({ type: "dora" }),
      makeAdapter({ id: "a2", type: "lora", role: "genre" }),
    ];
    const result = validateAdapterComposition(adapters);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Mixing DoRA and LoRA"))).toBe(true);
  });

  it("errors on missing weights URL", () => {
    const adapters = [makeAdapter({ weightsUrl: "" })];
    const result = validateAdapterComposition(adapters);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("no weights URL");
  });
});

// ─── Cost Estimation Tests ──────────────────────────────────────────────────

describe("AdapterComposer — Cost Estimation", () => {
  it("fal.ai base cost for single adapter", () => {
    const cost = estimateCompositionCost("fal", 1, false, 1024, 768);
    expect(cost).toBe(0.075);
  });

  it("fal.ai cost increases with adapter count", () => {
    const cost1 = estimateCompositionCost("fal", 1, false, 1024, 768);
    const cost3 = estimateCompositionCost("fal", 3, false, 1024, 768);
    expect(cost3).toBeGreaterThan(cost1);
    expect(cost3 - cost1).toBeCloseTo(0.03, 2); // 2 extra adapters × 0.015
  });

  it("fal.ai cost adds IP-Adapter overhead", () => {
    const withoutIP = estimateCompositionCost("fal", 3, false, 1024, 768);
    const withIP = estimateCompositionCost("fal", 3, true, 1024, 768);
    expect(withIP - withoutIP).toBeCloseTo(0.03, 2);
  });

  it("fal.ai high-res multiplier applies above 1024px", () => {
    const standard = estimateCompositionCost("fal", 3, true, 1024, 768);
    const highRes = estimateCompositionCost("fal", 3, true, 1536, 1024);
    expect(highRes).toBeCloseTo(standard * 1.5, 2);
  });

  it("runpod is cheaper than fal.ai for same configuration", () => {
    const falCost = estimateCompositionCost("fal", 3, true, 1024, 768);
    const runpodCost = estimateCompositionCost("runpod", 3, true, 1024, 768);
    expect(runpodCost).toBeLessThan(falCost);
  });

  it("costs align with addendum §6 ranges", () => {
    // Per Addendum: fal.ai $0.06-0.18/gen
    const falMin = estimateCompositionCost("fal", 1, false, 512, 512);
    const falMax = estimateCompositionCost("fal", 5, true, 1536, 1536);
    expect(falMin).toBeGreaterThanOrEqual(0.06);
    expect(falMax).toBeLessThanOrEqual(0.25); // Slightly above range for 5 adapters + high-res

    // Per Addendum: RunPod $0.04-0.15/gen
    const rpMin = estimateCompositionCost("runpod", 1, false, 512, 512);
    const rpMax = estimateCompositionCost("runpod", 5, true, 1536, 1536);
    expect(rpMin).toBeGreaterThanOrEqual(0.04);
    expect(rpMax).toBeLessThanOrEqual(0.18);
  });
});

// ─── DoRA Training Config Tests ─────────────────────────────────────────────

describe("AdapterComposer — DoRA Training Config", () => {
  it("default config uses DoRA + PiSSA", () => {
    expect(DEFAULT_DORA_TRAINING_CONFIG.adapterType).toBe("dora");
    expect(DEFAULT_DORA_TRAINING_CONFIG.initialization).toBe("pissa");
  });

  it("role overrides have increasing rank: character < sakufuu < genre", () => {
    expect(ROLE_TRAINING_OVERRIDES.character.rank!).toBeLessThan(ROLE_TRAINING_OVERRIDES.sakufuu.rank!);
    expect(ROLE_TRAINING_OVERRIDES.sakufuu.rank!).toBeLessThan(ROLE_TRAINING_OVERRIDES.genre.rank!);
  });

  it("role overrides have increasing steps: character < sakufuu < genre", () => {
    expect(ROLE_TRAINING_OVERRIDES.character.steps!).toBeLessThan(ROLE_TRAINING_OVERRIDES.sakufuu.steps!);
    expect(ROLE_TRAINING_OVERRIDES.sakufuu.steps!).toBeLessThan(ROLE_TRAINING_OVERRIDES.genre.steps!);
  });

  it("migrateLoraToDoraConfig converts legacy config correctly", () => {
    const legacy = {
      baseModel: "Anything V5",
      triggerWord: "old_trigger",
      steps: 1000,
      learningRate: 1e-4,
      loraRank: 32,
      resolution: 512,
      batchSize: 2,
      useCaptions: true,
    };
    const migrated = migrateLoraToDoraConfig(legacy, "character");

    expect(migrated.adapterType).toBe("dora");
    expect(migrated.initialization).toBe("pissa");
    expect(migrated.triggerWord).toBe("old_trigger");
    expect(migrated.rank).toBe(32);
    expect(migrated.alpha).toBe(16); // rank / 2
    expect(migrated.role).toBe("character");
  });
});

// ─── Executor Factory Tests ─────────────────────────────────────────────────

describe("AdapterComposer — Executor Factory", () => {
  it("creates FalCompositionExecutor for 'fal' provider", () => {
    const executor = createCompositionExecutor("fal", { apiKey: "test-key" });
    expect(executor.provider).toBe("fal");
    expect(executor.maxAdapters()).toBe(10);
    expect(executor.supportsIpAdapter()).toBe(true);
  });

  it("creates RunPodCompositionExecutor for 'runpod' provider", () => {
    const executor = createCompositionExecutor("runpod", {
      apiKey: "test-key",
      endpointId: "ep-123",
    });
    expect(executor.provider).toBe("runpod");
    expect(executor.maxAdapters()).toBe(5);
    expect(executor.supportsIpAdapter()).toBe(true);
  });

  it("throws if RunPod has no endpointId", () => {
    expect(() => createCompositionExecutor("runpod", { apiKey: "test" })).toThrow(
      "endpointId"
    );
  });

  it("selectOptimalProvider returns fal for low spend", () => {
    expect(selectOptimalProvider(100)).toBe("fal");
    expect(selectOptimalProvider(499)).toBe("fal");
  });

  it("selectOptimalProvider returns runpod for high spend", () => {
    expect(selectOptimalProvider(501)).toBe("runpod");
    expect(selectOptimalProvider(1000)).toBe("runpod");
  });

  it("selectOptimalProvider respects preferred override", () => {
    expect(selectOptimalProvider(1000, "fal")).toBe("fal");
    expect(selectOptimalProvider(100, "runpod")).toBe("runpod");
  });
});

// ─── RAG Integration Tests ──────────────────────────────────────────────────

describe("AdapterComposer — RAG Integration", () => {
  it("checkLatencyBudget passes within budget", () => {
    const result = checkLatencyBudget(50, DEFAULT_LATENCY_BUDGET);
    expect(result.withinBudget).toBe(true);
    expect(result.warning).toBe(false);
  });

  it("checkLatencyBudget warns above threshold", () => {
    const result = checkLatencyBudget(150, DEFAULT_LATENCY_BUDGET);
    expect(result.withinBudget).toBe(true);
    expect(result.warning).toBe(true);
  });

  it("checkLatencyBudget fails above max", () => {
    const result = checkLatencyBudget(250, DEFAULT_LATENCY_BUDGET);
    expect(result.withinBudget).toBe(false);
    expect(result.warning).toBe(true);
  });

  it("selectExperimentWeight uses experiment weight for matching stage", () => {
    const experiment = IP_ADAPTER_EXPERIMENTS[2]; // aggressive: 0.6
    const weight = selectExperimentWeight(experiment, "d1_5_genga", 0.4);
    expect(weight).toBe(0.6);
  });

  it("selectExperimentWeight uses default for non-matching stage", () => {
    const experiment = { name: "test", weight: 0.7, stages: ["d0_character_design" as CompositionStage] };
    const weight = selectExperimentWeight(experiment, "d1_5_genga", 0.4);
    expect(weight).toBe(0.4);
  });

  it("selectExperimentWeight uses default when no experiment", () => {
    const weight = selectExperimentWeight(null, "d1_5_genga", 0.4);
    expect(weight).toBe(0.4);
  });

  it("IP_ADAPTER_EXPERIMENTS has three variants", () => {
    expect(IP_ADAPTER_EXPERIMENTS).toHaveLength(3);
    expect(IP_ADAPTER_EXPERIMENTS[0].name).toBe("conservative");
    expect(IP_ADAPTER_EXPERIMENTS[1].name).toBe("standard");
    expect(IP_ADAPTER_EXPERIMENTS[2].name).toBe("aggressive");
  });
});

// ─── Pipeline Integration Tests ─────────────────────────────────────────────

describe("AdapterComposer — Pipeline Integration", () => {
  it("mapNodeToStage maps D0/character nodes correctly", () => {
    expect(mapNodeToStage("character_design")).toBe("d0_character_design");
    expect(mapNodeToStage("D0_chara_design")).toBe("d0_character_design");
  });

  it("mapNodeToStage maps D1.5/genga nodes correctly", () => {
    expect(mapNodeToStage("genga_generation")).toBe("d1_5_genga");
    expect(mapNodeToStage("D1.5_key_animation")).toBe("d1_5_genga");
    expect(mapNodeToStage("d1_5_genga")).toBe("d1_5_genga");
  });

  it("mapNodeToStage maps D7/FX nodes correctly", () => {
    expect(mapNodeToStage("fx_compositor")).toBe("d7_fx_pass");
    expect(mapNodeToStage("D7_compositing")).toBe("d7_fx_pass");
  });

  it("mapNodeToStage maps D10 nodes correctly", () => {
    expect(mapNodeToStage("d10_reference")).toBe("d10_reference_gen");
    expect(mapNodeToStage("craft_library")).toBe("d10_reference_gen");
  });

  it("mapNodeToStage defaults to custom for unknown nodes", () => {
    expect(mapNodeToStage("unknown_stage")).toBe("custom");
    expect(mapNodeToStage("")).toBe("custom");
  });

  it("stageSupportsComposition returns true for all named stages", () => {
    expect(stageSupportsComposition("d0_character_design")).toBe(true);
    expect(stageSupportsComposition("d1_5_genga")).toBe(true);
    expect(stageSupportsComposition("d7_fx_pass")).toBe(true);
    expect(stageSupportsComposition("d10_reference_gen")).toBe(true);
  });

  it("stageSupportsComposition returns false for custom", () => {
    expect(stageSupportsComposition("custom")).toBe(false);
  });

  it("shouldUseComposition respects explicit opt-in", () => {
    expect(shouldUseComposition({ compositionEnabled: true })).toBe(true);
    expect(shouldUseComposition({ compositionEnabled: false })).toBe(false);
  });

  it("shouldUseComposition auto-enables for DoRA projects", () => {
    expect(shouldUseComposition({ hasDoRAAdapters: true })).toBe(true);
  });

  it("shouldUseComposition auto-enables for post-Wave-6 projects", () => {
    expect(shouldUseComposition({ createdAfterWave6: true })).toBe(true);
  });

  it("shouldUseComposition defaults to false for legacy projects", () => {
    expect(shouldUseComposition({})).toBe(false);
  });

  it("legacyLoraToAdapter creates valid adapter structure", () => {
    const adapter = legacyLoraToAdapter(
      "https://storage.example.com/lora.safetensors",
      "character",
      "my_char"
    );
    expect(adapter.type).toBe("lora");
    expect(adapter.role).toBe("character");
    expect(adapter.initialization).toBe("random");
    expect(adapter.weightsUrl).toBe("https://storage.example.com/lora.safetensors");
    expect(adapter.triggerWord).toBe("my_char");
    expect(adapter.defaultWeight).toBe(0.8); // Character default
  });

  it("legacyLoraToAdapter uses 0.5 weight for non-character roles", () => {
    const adapter = legacyLoraToAdapter("https://example.com/lora.safetensors", "genre");
    expect(adapter.defaultWeight).toBe(0.5);
  });
});

// ─── Migration Plan Tests ───────────────────────────────────────────────────

describe("AdapterComposer — Migration Plan", () => {
  const now = Date.now();
  const recentlyUsed = now - 5 * 24 * 60 * 60 * 1000; // 5 days ago
  const longAgo = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago

  it("migrates active character LoRAs", () => {
    const plan = generateMigrationPlan([
      {
        id: "job1", role: "character", baseModel: "Anything V5",
        triggerWord: "char1", steps: 1000, learningRate: 1e-4,
        loraRank: 32, resolution: 512, batchSize: 2, useCaptions: true,
        lastUsedAt: recentlyUsed, status: "completed",
      },
    ]);
    expect(plan.toMigrate).toHaveLength(1);
    expect(plan.toMigrate[0].newConfig.adapterType).toBe("dora");
    expect(plan.toMigrate[0].newConfig.initialization).toBe("pissa");
  });

  it("keeps inactive character LoRAs as-is", () => {
    const plan = generateMigrationPlan([
      {
        id: "job1", role: "character", baseModel: "Anything V5",
        triggerWord: "char1", steps: 1000, learningRate: 1e-4,
        loraRank: 32, resolution: 512, batchSize: 2, useCaptions: true,
        lastUsedAt: longAgo, status: "completed",
      },
    ]);
    expect(plan.toMigrate).toHaveLength(0);
    expect(plan.toKeep).toHaveLength(1);
    expect(plan.toKeep[0].reason).toContain("inactive");
  });

  it("always migrates sakufuu LoRAs", () => {
    const plan = generateMigrationPlan([
      {
        id: "job1", role: "sakufuu", baseModel: "Anything V5",
        triggerWord: "saku1", steps: 2000, learningRate: 1e-4,
        loraRank: 48, resolution: 768, batchSize: 2, useCaptions: true,
        lastUsedAt: longAgo, status: "completed",
      },
    ]);
    expect(plan.toMigrate).toHaveLength(1);
    expect(plan.toMigrate[0].role).toBe("sakufuu");
  });

  it("always migrates genre LoRAs", () => {
    const plan = generateMigrationPlan([
      {
        id: "job1", role: "genre", baseModel: "Anything V5",
        triggerWord: "genre1", steps: 3000, learningRate: 1e-4,
        loraRank: 64, resolution: 768, batchSize: 2, useCaptions: true,
        status: "completed",
      },
    ]);
    expect(plan.toMigrate).toHaveLength(1);
    expect(plan.toMigrate[0].role).toBe("genre");
  });

  it("skips non-completed jobs", () => {
    const plan = generateMigrationPlan([
      {
        id: "job1", role: "sakufuu", baseModel: "Anything V5",
        triggerWord: "saku1", steps: 2000, learningRate: 1e-4,
        loraRank: 48, resolution: 768, batchSize: 2, useCaptions: true,
        status: "pending_admin_approval",
      },
    ]);
    expect(plan.toMigrate).toHaveLength(0);
    expect(plan.toKeep).toHaveLength(1);
    expect(plan.toKeep[0].reason).toContain("not completed");
  });

  it("calculates total migration cost", () => {
    const plan = generateMigrationPlan([
      {
        id: "j1", role: "character", baseModel: "Anything V5",
        triggerWord: "c1", steps: 1000, learningRate: 1e-4,
        loraRank: 32, resolution: 512, batchSize: 2, useCaptions: true,
        lastUsedAt: recentlyUsed, status: "completed",
      },
      {
        id: "j2", role: "sakufuu", baseModel: "Anything V5",
        triggerWord: "s1", steps: 2000, learningRate: 1e-4,
        loraRank: 48, resolution: 768, batchSize: 2, useCaptions: true,
        status: "completed",
      },
      {
        id: "j3", role: "genre", baseModel: "Anything V5",
        triggerWord: "g1", steps: 3000, learningRate: 1e-4,
        loraRank: 64, resolution: 768, batchSize: 2, useCaptions: true,
        status: "completed",
      },
    ]);
    expect(plan.toMigrate).toHaveLength(3);
    expect(plan.totalCostUsd).toBe(12.5 + 100 + 125); // character + sakufuu + genre
  });

  it("generates readable summary", () => {
    const plan = generateMigrationPlan([
      {
        id: "j1", role: "character", baseModel: "Anything V5",
        triggerWord: "c1", steps: 1000, learningRate: 1e-4,
        loraRank: 32, resolution: 512, batchSize: 2, useCaptions: true,
        lastUsedAt: recentlyUsed, status: "completed",
      },
    ]);
    expect(plan.summary).toContain("1 jobs to re-train as DoRA");
    expect(plan.summary).toContain("$12.50");
  });
});

// ─── E2E Composition Flow Test ──────────────────────────────────────────────

describe("AdapterComposer — E2E Composition Flow", () => {
  it("full composition input resolves all parameters correctly", () => {
    const input = makeCompositionInput({
      stage: "d1_5_genga",
      ipAdapterConfig: {
        referenceImageUrls: ["https://example.com/ref1.jpg", "https://example.com/ref2.jpg"],
        weight: 0.5,
        enabled: true,
        source: {
          genreTag: "shonen",
          confidence: "high",
          poolSize: 1000,
          retrievalScores: [0.92, 0.87],
        },
      },
    });

    // Blend weights at D1.5: all 1.0
    const weights = resolveBlendWeights(input);
    expect(weights["genre_shonen_v3"]).toBe(1.0);
    expect(weights["test_adapter_1"]).toBe(1.0);
    expect(weights["sakufuu_creator_42"]).toBe(1.0);

    // IP-Adapter weight
    const ipWeight = resolveIpAdapterWeight(input);
    expect(ipWeight).toBe(0.5);

    // Trigger words
    const enhanced = injectTriggerWords(input.prompt, input.adapters, weights);
    expect(enhanced).toContain("shonen_style");
    expect(enhanced).toContain("awk_char_1");
    expect(enhanced).toContain("sakufuu_42");

    // Validation
    const validation = validateAdapterComposition(input.adapters);
    expect(validation.valid).toBe(true);
  });

  it("cold-start scenario: no IP-Adapter, DoRA-only", () => {
    const input = makeCompositionInput({
      stage: "d0_character_design",
      // No ipAdapterConfig → cold start
    });

    const ipWeight = resolveIpAdapterWeight(input);
    expect(ipWeight).toBe(0);

    // Blend weights still resolve for DoRA adapters
    const weights = resolveBlendWeights(input);
    expect(weights["test_adapter_1"]).toBe(0.8); // Character primary at D0
  });

  it("single adapter composition is valid", () => {
    const input: CompositionInput = {
      adapters: [makeAdapter()],
      stage: "d0_character_design",
      prompt: "character sheet, full body",
      width: 1024,
      height: 1024,
    };

    const validation = validateAdapterComposition(input.adapters);
    expect(validation.valid).toBe(true);

    const weights = resolveBlendWeights(input);
    expect(weights["test_adapter_1"]).toBe(0.8);
  });

  it("executor validates composition before execution", () => {
    const executor = new FalCompositionExecutor("test-key");
    const adapters = [makeGenreAdapter(), makeAdapter(), makeSakufuuAdapter()];
    const result = executor.validateComposition(adapters);
    expect(result.valid).toBe(true);
  });

  it("executor rejects invalid composition", () => {
    const executor = new FalCompositionExecutor("test-key");
    const result = executor.validateComposition([]);
    expect(result.valid).toBe(false);
  });

  it("cost estimation matches expected ranges for typical three-adapter composition", () => {
    const input = makeCompositionInput({ stage: "d1_5_genga" });
    const executor = new FalCompositionExecutor("test-key");
    const cost = executor.estimateCostUsd(input);

    // Per Addendum §6: $0.06-0.18/gen for fal.ai
    expect(cost).toBeGreaterThanOrEqual(0.06);
    expect(cost).toBeLessThanOrEqual(0.18);
  });
});

// ─── composeAndGenerate Integration Tests ───────────────────────────────────

describe("AdapterComposer — composeAndGenerate", () => {
  it("returns fallback when no adapters available", async () => {
    const result = await composeAndGenerate(
      {
        pipelineRunId: 1,
        episodeId: 1,
        projectId: 1,
        userId: 1,
        stage: "d1_5_genga",
        genre: "shonen" as GenreTag,
        sceneDescription: "battle scene",
      },
      { genre: undefined, character: undefined, sakufuu: undefined },
      "test prompt",
      { width: 1024, height: 768 }
    );

    expect(result.compositionUsed).toBe(false);
    expect(result.fallbackReason).toContain("No adapters available");
  });

  it("returns fallback when validation fails", async () => {
    const badAdapter = makeAdapter({ weightsUrl: "", baseModel: "Model A" });
    const result = await composeAndGenerate(
      {
        pipelineRunId: 1,
        episodeId: 1,
        projectId: 1,
        userId: 1,
        stage: "d1_5_genga",
        genre: "shonen" as GenreTag,
        sceneDescription: "battle scene",
      },
      { genre: undefined, character: badAdapter, sakufuu: undefined },
      "test prompt",
      { width: 1024, height: 768 }
    );

    expect(result.compositionUsed).toBe(false);
    expect(result.fallbackReason).toContain("validation failed");
  });

  it("returns fallback when no API key configured", async () => {
    // Clear env vars
    const originalFal = process.env.FAL_API_KEY;
    delete process.env.FAL_API_KEY;

    const result = await composeAndGenerate(
      {
        pipelineRunId: 1,
        episodeId: 1,
        projectId: 1,
        userId: 1,
        stage: "d1_5_genga",
        genre: "shonen" as GenreTag,
        sceneDescription: "battle scene",
      },
      { character: makeAdapter() },
      "test prompt",
      { width: 1024, height: 768 }
    );

    expect(result.compositionUsed).toBe(false);
    expect(result.fallbackReason).toContain("No API key");

    // Restore
    if (originalFal) process.env.FAL_API_KEY = originalFal;
  });
});
