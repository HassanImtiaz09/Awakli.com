/**
 * Wave 6A — Item 1.6-1.7: RAG Retrieval Integration + IP-Adapter Conditioning
 *
 * Bridges the D10 genre retrieval pool (Item 5) with the AdapterComposer (Items 1.1-1.5).
 * Queries the vector store by scene metadata, returns nearest-neighbor genre references,
 * and constructs the IPAdapterConfig for composition.
 *
 * Per Addendum §3:
 * - Retrieve nearest-neighbor genre-canonical references from D10
 * - Use IP-Adapter to condition generation
 * - Compose genre DoRA on top
 * - Cold-start fallback: <500 approved frames → DoRA-only
 * - IP-Adapter weight bounds: 0.4-0.5 default, per-stage tuning
 * - Retrieval latency budget: ~50-200ms acceptable for HITL
 *
 * @see server/benchmarks/d10/genre-retrieval-pool.ts for underlying retrieval
 * @see server/adapter-composer.ts for IPAdapterConfig type
 */

import type {
  IPAdapterConfig,
  CompositionStage,
  CompositionInput,
  DoRAAdapter,
} from "./adapter-composer";
import {
  STAGE_IP_ADAPTER_WEIGHTS,
  resolveIpAdapterWeight,
} from "./adapter-composer";
import {
  getGenreReferences,
  getGenrePoolConfidence,
  getRecommendedIpAdapterWeight,
  type GenreTag,
  type GenrePoolConfidence,
} from "./benchmarks/d10/genre-retrieval-pool";

// ─── RAG Retrieval Configuration ────────────────────────────────────────────

/**
 * Configuration for RAG-augmented genre conditioning.
 */
export interface RAGConditioningConfig {
  /** Genre tag for retrieval */
  genre: GenreTag;
  /** Scene description for semantic search */
  sceneDescription: string;
  /** Pipeline stage (affects IP-Adapter weight) */
  stage: CompositionStage;
  /** Number of reference images to retrieve (default 3) */
  topK?: number;
  /** Minimum retrieval score threshold (default 0.6) */
  minScore?: number;
  /** Maximum retrieval latency in ms before timeout (default 200) */
  maxLatencyMs?: number;
  /** Force enable/disable IP-Adapter (overrides confidence-based decision) */
  forceIpAdapter?: boolean;
  /** Explicit IP-Adapter weight override */
  weightOverride?: number;
}

/**
 * Result of RAG retrieval + IP-Adapter conditioning construction.
 */
export interface RAGConditioningResult {
  /** Constructed IP-Adapter config (null if cold-start / disabled) */
  ipAdapterConfig: IPAdapterConfig | null;
  /** Confidence assessment of the genre pool */
  confidence: GenrePoolConfidence;
  /** Retrieved references (even if IP-Adapter is disabled) */
  references: Array<{ imageUrl: string; score: number; qualityScore: number }>;
  /** Actual retrieval latency in ms */
  retrievalLatencyMs: number;
  /** Whether IP-Adapter conditioning was enabled */
  enabled: boolean;
  /** Reason for enable/disable decision */
  reason: string;
}

// ─── Core RAG Integration ───────────────────────────────────────────────────

/**
 * Build IP-Adapter conditioning from D10 genre retrieval pool.
 * This is the main integration point between RAG (Item 5) and AdapterComposer (Item 1).
 *
 * Decision flow:
 * 1. Check genre pool confidence
 * 2. If cold_start → return null (DoRA-only)
 * 3. Retrieve nearest-neighbor references
 * 4. Construct IPAdapterConfig with appropriate weight
 *
 * @param config - RAG conditioning configuration
 * @returns IPAdapterConfig or null if cold-start
 */
export async function buildIPAdapterConditioning(
  config: RAGConditioningConfig
): Promise<RAGConditioningResult> {
  const startTime = Date.now();
  const topK = config.topK ?? 3;
  const maxLatencyMs = config.maxLatencyMs ?? 200;

  // Step 1: Check genre pool confidence
  let confidence: GenrePoolConfidence;
  try {
    confidence = await getGenrePoolConfidence(config.genre);
  } catch (err) {
    // On confidence check failure, default to cold_start (safe fallback)
    confidence = {
      genre: config.genre,
      frameCount: 0,
      avgQualityScore: 0,
      confidence: "cold_start",
      ipAdapterEnabled: false,
    };
  }

  // Step 2: Determine if IP-Adapter should be enabled
  const shouldEnable = config.forceIpAdapter ?? confidence.ipAdapterEnabled;

  if (!shouldEnable) {
    const latency = Date.now() - startTime;
    return {
      ipAdapterConfig: null,
      confidence,
      references: [],
      retrievalLatencyMs: latency,
      enabled: false,
      reason: confidence.confidence === "cold_start"
        ? `Cold start: only ${confidence.frameCount} frames in ${config.genre} pool (need 50+)`
        : `IP-Adapter disabled for ${config.genre} (confidence: ${confidence.confidence})`,
    };
  }

  // Step 3: Retrieve nearest-neighbor references with timeout
  let references: Array<{ imageUrl: string; score: number; qualityScore: number }> = [];
  try {
    const retrievalPromise = getGenreReferences(config.genre, config.sceneDescription, topK);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Retrieval timeout")), maxLatencyMs)
    );
    references = await Promise.race([retrievalPromise, timeoutPromise]);
  } catch (err) {
    // Retrieval failed or timed out — fall back to DoRA-only
    const latency = Date.now() - startTime;
    return {
      ipAdapterConfig: null,
      confidence,
      references: [],
      retrievalLatencyMs: latency,
      enabled: false,
      reason: `Retrieval failed/timed out after ${latency}ms: ${(err as Error).message}`,
    };
  }

  const latency = Date.now() - startTime;

  // Filter by minimum score if specified
  const minScore = config.minScore ?? 0.6;
  const filteredRefs = references.filter((r) => r.score >= minScore);

  // Step 4: If no good references found, fall back to DoRA-only
  if (filteredRefs.length === 0) {
    return {
      ipAdapterConfig: null,
      confidence,
      references,
      retrievalLatencyMs: latency,
      enabled: false,
      reason: `No references above score threshold ${minScore} for "${config.sceneDescription}"`,
    };
  }

  // Step 5: Determine IP-Adapter weight
  const recommendedWeight = getRecommendedIpAdapterWeight(confidence);
  const stageDefault = STAGE_IP_ADAPTER_WEIGHTS[config.stage] ?? 0.4;
  // Use the minimum of recommended and stage default (conservative approach)
  const baseWeight = Math.min(recommendedWeight, stageDefault);
  const finalWeight = config.weightOverride ?? baseWeight;

  // Step 6: Construct IPAdapterConfig
  const ipAdapterConfig: IPAdapterConfig = {
    referenceImageUrls: filteredRefs.map((r) => r.imageUrl),
    weight: finalWeight,
    enabled: true,
    source: {
      genreTag: config.genre,
      confidence: confidence.confidence,
      poolSize: confidence.frameCount,
      retrievalScores: filteredRefs.map((r) => r.score),
    },
  };

  return {
    ipAdapterConfig,
    confidence,
    references: filteredRefs,
    retrievalLatencyMs: latency,
    enabled: true,
    reason: `IP-Adapter enabled: ${filteredRefs.length} refs, weight ${finalWeight}, confidence ${confidence.confidence}`,
  };
}

// ─── Composition Helper ─────────────────────────────────────────────────────

/**
 * Build a complete CompositionInput with RAG-augmented IP-Adapter conditioning.
 * This is the high-level helper that pipeline stages call.
 *
 * Usage in D0/D1.5/D7 stage handlers:
 * ```ts
 * const compositionInput = await buildCompositionWithRAG({
 *   adapters: [genreAdapter, characterAdapter, sakufuuAdapter],
 *   genre: "shonen",
 *   sceneDescription: "intense battle scene with energy blasts",
 *   stage: "d1_5_genga",
 *   prompt: "dynamic action pose, energy effects",
 *   width: 1024,
 *   height: 768,
 * });
 * const result = await composer.compose(compositionInput);
 * ```
 */
export interface BuildCompositionWithRAGInput {
  /** Adapters to compose (genre + character + sakufuu) */
  adapters: DoRAAdapter[];
  /** Genre for RAG retrieval */
  genre: GenreTag;
  /** Scene description for semantic search */
  sceneDescription: string;
  /** Pipeline stage */
  stage: CompositionStage;
  /** Generation prompt */
  prompt: string;
  /** Negative prompt */
  negativePrompt?: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Optional explicit blend weight overrides */
  blendWeights?: Record<string, number>;
  /** Number of inference steps */
  numInferenceSteps?: number;
  /** Guidance scale */
  guidanceScale?: number;
  /** Random seed */
  seed?: number;
  /** Source image for img2img */
  sourceImageUrl?: string;
  /** Denoising strength */
  denoisingStrength?: number;
  /** RAG-specific overrides */
  ragConfig?: Partial<RAGConditioningConfig>;
}

export interface BuildCompositionWithRAGOutput {
  /** Ready-to-use CompositionInput */
  compositionInput: CompositionInput;
  /** RAG conditioning result (for logging/metadata) */
  ragResult: RAGConditioningResult;
}

/**
 * Build a complete CompositionInput with RAG-augmented IP-Adapter conditioning.
 */
export async function buildCompositionWithRAG(
  input: BuildCompositionWithRAGInput
): Promise<BuildCompositionWithRAGOutput> {
  // Build RAG conditioning
  const ragResult = await buildIPAdapterConditioning({
    genre: input.genre,
    sceneDescription: input.sceneDescription,
    stage: input.stage,
    topK: input.ragConfig?.topK,
    minScore: input.ragConfig?.minScore,
    maxLatencyMs: input.ragConfig?.maxLatencyMs,
    forceIpAdapter: input.ragConfig?.forceIpAdapter,
    weightOverride: input.ragConfig?.weightOverride,
  });

  // Construct CompositionInput
  const compositionInput: CompositionInput = {
    adapters: input.adapters,
    ipAdapterConfig: ragResult.ipAdapterConfig ?? undefined,
    stage: input.stage,
    blendWeights: input.blendWeights,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    width: input.width,
    height: input.height,
    numInferenceSteps: input.numInferenceSteps,
    guidanceScale: input.guidanceScale,
    seed: input.seed,
    sourceImageUrl: input.sourceImageUrl,
    denoisingStrength: input.denoisingStrength,
  };

  return { compositionInput, ragResult };
}

// ─── IP-Adapter Weight Management ───────────────────────────────────────────

/**
 * Per Addendum §3: IP-Adapter weight bounds 0.4-0.5 default, per-stage tuning.
 * This function provides A/B testable weight selection.
 */
export interface IPAdapterWeightExperiment {
  /** Experiment name */
  name: string;
  /** Weight to use for this experiment variant */
  weight: number;
  /** Stages this experiment applies to */
  stages: CompositionStage[];
}

/**
 * Pre-defined weight experiments for A/B testing.
 * Per Addendum §3: A/B testable IP-Adapter weights.
 */
export const IP_ADAPTER_EXPERIMENTS: IPAdapterWeightExperiment[] = [
  {
    name: "conservative",
    weight: 0.3,
    stages: ["d0_character_design", "d1_5_genga", "d7_fx_pass", "d10_reference_gen"],
  },
  {
    name: "standard",
    weight: 0.45,
    stages: ["d0_character_design", "d1_5_genga", "d7_fx_pass", "d10_reference_gen"],
  },
  {
    name: "aggressive",
    weight: 0.6,
    stages: ["d0_character_design", "d1_5_genga", "d7_fx_pass", "d10_reference_gen"],
  },
];

/**
 * Select IP-Adapter weight for an A/B experiment.
 * Returns the experiment weight if the stage matches, otherwise the default.
 */
export function selectExperimentWeight(
  experiment: IPAdapterWeightExperiment | null,
  stage: CompositionStage,
  defaultWeight: number
): number {
  if (!experiment) return defaultWeight;
  if (!experiment.stages.includes(stage)) return defaultWeight;
  return experiment.weight;
}

// ─── Latency Budget Enforcement ─────────────────────────────────────────────

/**
 * Per Addendum §3: Retrieval latency budget ~50-200ms acceptable for HITL.
 * Track and enforce latency budgets.
 */
export interface LatencyBudget {
  /** Maximum acceptable retrieval latency in ms */
  maxMs: number;
  /** Warning threshold (log if exceeded) */
  warnMs: number;
  /** Whether to skip IP-Adapter if budget exceeded */
  skipOnExceed: boolean;
}

export const DEFAULT_LATENCY_BUDGET: LatencyBudget = {
  maxMs: 200,
  warnMs: 100,
  skipOnExceed: true,
};

/**
 * Check if retrieval latency is within budget.
 */
export function checkLatencyBudget(
  actualMs: number,
  budget: LatencyBudget = DEFAULT_LATENCY_BUDGET
): { withinBudget: boolean; warning: boolean; message: string } {
  if (actualMs > budget.maxMs) {
    return {
      withinBudget: false,
      warning: true,
      message: `Retrieval latency ${actualMs}ms exceeds budget ${budget.maxMs}ms`,
    };
  }
  if (actualMs > budget.warnMs) {
    return {
      withinBudget: true,
      warning: true,
      message: `Retrieval latency ${actualMs}ms exceeds warning threshold ${budget.warnMs}ms`,
    };
  }
  return {
    withinBudget: true,
    warning: false,
    message: `Retrieval latency ${actualMs}ms within budget`,
  };
}
