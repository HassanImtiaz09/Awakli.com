/**
 * Wave 6A — Item 1: Three-Adapter Composition Runtime
 *
 * AdapterComposer interface + DoRA/PiSSA types + blend weight defaults.
 * Provider-agnostic composition layer that stacks genre + character + sakufuu
 * DoRA adapters at inference time, with RAG-augmented IP-Adapter conditioning.
 *
 * Per Addendum v1.9.1 §2:
 * - Stage 3 (D0): character adapter primary, anime-type and sakufuu modulating
 * - Stage 7 (D1.5/Genga): all three at full weight
 * - Stage 14 (D7/FX Pass): anime-type and sakufuu primary, character at low weight
 *
 * @see Awakli_Pipeline_Blueprint_v1_9_1_Adapter_Architecture_Addendum §1-§3
 */

// ─── Adapter Types ──────────────────────────────────────────────────────────

/**
 * Adapter training type. DoRA is the default for all new training jobs.
 * LoRA retained for backward compatibility with existing trained models.
 */
export type AdapterType = "dora" | "lora";

/**
 * Initialization strategy for adapter training.
 * PiSSA (SVD-based) is default for cold-start; random for legacy compatibility.
 */
export type AdapterInitialization = "pissa" | "random";

/**
 * Role of an adapter in the three-adapter composition stack.
 */
export type AdapterRole = "genre" | "character" | "sakufuu";

/**
 * A single DoRA/LoRA adapter to be composed at inference time.
 */
export interface DoRAAdapter {
  /** Unique identifier for this adapter (e.g., "genre_shonen_v3", "char_awk_42") */
  id: string;
  /** Role in the composition stack */
  role: AdapterRole;
  /** Adapter type (dora or legacy lora) */
  type: AdapterType;
  /** URL to the trained adapter weights (.safetensors) */
  weightsUrl: string;
  /** Trigger word for this adapter */
  triggerWord: string;
  /** Default weight/scale for this adapter (0.0 - 1.0) */
  defaultWeight: number;
  /** Training rank (dimensionality) */
  rank: number;
  /** Whether this adapter was trained with PiSSA initialization */
  initialization: AdapterInitialization;
  /** Base model this adapter was trained on */
  baseModel: string;
  /** Optional per-layer scale overrides (layer_name → scale) */
  layerScales?: Record<string, number>;
  /** Metadata for provenance tracking */
  metadata?: {
    trainedAt?: number;
    trainingSteps?: number;
    trainingLoss?: number;
    version?: number;
    projectId?: number;
    characterId?: string;
    genreTag?: string;
  };
}

/**
 * IP-Adapter conditioning configuration for RAG-augmented genre signal.
 * Per Addendum §3: retrieve nearest-neighbor genre-canonical references from D10,
 * use IP-Adapter to condition generation.
 */
export interface IPAdapterConfig {
  /** URL(s) to reference images from D10 retrieval pool */
  referenceImageUrls: string[];
  /** IP-Adapter conditioning weight (default 0.4-0.5, per-stage tunable) */
  weight: number;
  /** Whether IP-Adapter is enabled (disabled during cold-start) */
  enabled: boolean;
  /** Source metadata for provenance */
  source: {
    /** Genre tag used for retrieval */
    genreTag: string;
    /** Confidence level of the retrieval pool */
    confidence: "cold_start" | "low" | "medium" | "high";
    /** Number of frames in the genre pool */
    poolSize: number;
    /** Retrieval scores for each reference */
    retrievalScores: number[];
  };
}

/**
 * Pipeline stage identifier for blend weight selection.
 */
export type CompositionStage =
  | "d0_character_design"     // Stage 3: Character sheet generation
  | "d1_5_genga"              // Stage 7: Genga (key animation) generation
  | "d7_fx_pass"              // Stage 14: FX compositing pass
  | "d10_reference_gen"       // Reference generation for craft library
  | "custom";                 // Custom blend weights provided explicitly

/**
 * Input to the AdapterComposer.compose() method.
 */
export interface CompositionInput {
  /** Adapters to stack (1-3, typically genre + character + sakufuu) */
  adapters: DoRAAdapter[];
  /** Optional IP-Adapter conditioning from RAG retrieval */
  ipAdapterConfig?: IPAdapterConfig;
  /** Pipeline stage (determines default blend weights) */
  stage: CompositionStage;
  /** Optional explicit blend weight overrides (adapter.id → weight) */
  blendWeights?: Record<string, number>;
  /** Generation prompt (used for adapter trigger word injection) */
  prompt: string;
  /** Negative prompt */
  negativePrompt?: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Number of inference steps */
  numInferenceSteps?: number;
  /** Guidance scale */
  guidanceScale?: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Optional source image for img2img / inpainting */
  sourceImageUrl?: string;
  /** Denoising strength for img2img (0.0-1.0) */
  denoisingStrength?: number;
}

/**
 * Output from the AdapterComposer.compose() method.
 */
export interface CompositionOutput {
  /** Generated image URL */
  imageUrl: string;
  /** Actual cost in USD for this generation */
  actualCostUsd: number;
  /** Provider that executed the composition */
  provider: string;
  /** Provider-specific task/job ID */
  providerTaskId: string;
  /** Resolved blend weights used (adapter.id → actual weight) */
  resolvedWeights: Record<string, number>;
  /** Whether IP-Adapter was active */
  ipAdapterUsed: boolean;
  /** Execution metadata */
  metadata: {
    /** Total inference time in ms */
    inferenceTimeMs: number;
    /** Model/endpoint used */
    model: string;
    /** Seed used */
    seed?: number;
    /** Number of adapters composed */
    adapterCount: number;
    /** Adapter roles composed */
    adapterRoles: AdapterRole[];
    /** IP-Adapter weight (0 if not used) */
    ipAdapterWeight: number;
    /** Retrieval latency in ms (0 if no RAG) */
    retrievalLatencyMs?: number;
  };
}

/**
 * Provider-agnostic AdapterComposer interface.
 * Implementations: FalCompositionExecutor, RunPodCompositionExecutor.
 *
 * Per Addendum §9: named AdapterComposer (not LoRAComposer).
 */
export interface AdapterComposer {
  /** Provider name (e.g., "fal", "runpod") */
  readonly provider: string;

  /**
   * Compose multiple DoRA adapters + optional IP-Adapter conditioning
   * into a single generation call.
   *
   * @param input - Adapters, stage, blend weights, prompt, dimensions
   * @returns Generated image with metadata
   */
  compose(input: CompositionInput): Promise<CompositionOutput>;

  /**
   * Validate that a set of adapters can be composed together.
   * Checks base model compatibility, weight format, etc.
   */
  validateComposition(adapters: DoRAAdapter[]): {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  };

  /**
   * Estimate cost for a composition request (before execution).
   */
  estimateCostUsd(input: CompositionInput): number;

  /**
   * Check if this executor supports a given number of simultaneous adapters.
   */
  maxAdapters(): number;

  /**
   * Check if this executor supports IP-Adapter conditioning alongside DoRA stacking.
   */
  supportsIpAdapter(): boolean;
}

// ─── Per-Stage Blend Weight Defaults ────────────────────────────────────────

/**
 * Default blend weights per stage per adapter role.
 * Per Addendum v1.9.1 §2:
 * - D0 (character design): character 0.8, genre 0.3, sakufuu 0.3
 * - D1.5 (genga): all three at 1.0
 * - D7 (FX pass): genre 0.8, sakufuu 0.7, character 0.2
 */
export const STAGE_BLEND_WEIGHTS: Record<CompositionStage, Record<AdapterRole, number>> = {
  d0_character_design: {
    character: 0.8,
    genre: 0.3,
    sakufuu: 0.3,
  },
  d1_5_genga: {
    character: 1.0,
    genre: 1.0,
    sakufuu: 1.0,
  },
  d7_fx_pass: {
    character: 0.2,
    genre: 0.8,
    sakufuu: 0.7,
  },
  d10_reference_gen: {
    character: 0.0,
    genre: 0.9,
    sakufuu: 0.5,
  },
  custom: {
    character: 0.5,
    genre: 0.5,
    sakufuu: 0.5,
  },
};

/**
 * Default IP-Adapter weight per stage.
 * Per Addendum §3: default 0.4-0.5, per-stage tunable.
 */
export const STAGE_IP_ADAPTER_WEIGHTS: Record<CompositionStage, number> = {
  d0_character_design: 0.3,   // Lower — character DoRA is primary
  d1_5_genga: 0.5,            // Full — genre conditioning important for key frames
  d7_fx_pass: 0.4,            // Medium — genre style for FX consistency
  d10_reference_gen: 0.5,     // Full — genre references drive reference generation
  custom: 0.4,
};

// ─── Blend Weight Resolution ────────────────────────────────────────────────

/**
 * Resolve final blend weights for a composition request.
 * Priority: explicit overrides > stage defaults.
 * Linear blending resolves conflicts (per Addendum §2: not priority overrides).
 */
export function resolveBlendWeights(
  input: CompositionInput
): Record<string, number> {
  const resolved: Record<string, number> = {};
  const stageDefaults = STAGE_BLEND_WEIGHTS[input.stage];

  for (const adapter of input.adapters) {
    // Explicit override takes priority
    if (input.blendWeights && input.blendWeights[adapter.id] !== undefined) {
      resolved[adapter.id] = Math.max(0, Math.min(1, input.blendWeights[adapter.id]));
    } else {
      // Use stage default for this adapter's role
      resolved[adapter.id] = stageDefaults[adapter.role] ?? adapter.defaultWeight;
    }
  }

  return resolved;
}

/**
 * Resolve IP-Adapter weight for a composition request.
 * Returns 0 if IP-Adapter is disabled or not configured.
 */
export function resolveIpAdapterWeight(input: CompositionInput): number {
  if (!input.ipAdapterConfig?.enabled) return 0;
  if (input.ipAdapterConfig.referenceImageUrls.length === 0) return 0;

  // If explicit weight provided in config, use it
  if (input.ipAdapterConfig.weight > 0) {
    return Math.max(0, Math.min(1, input.ipAdapterConfig.weight));
  }

  // Otherwise use stage default
  return STAGE_IP_ADAPTER_WEIGHTS[input.stage] ?? 0.4;
}

/**
 * Inject adapter trigger words into a prompt.
 * Prepends trigger words for all active adapters (weight > 0).
 */
export function injectTriggerWords(
  prompt: string,
  adapters: DoRAAdapter[],
  weights: Record<string, number>
): string {
  const activeTriggers = adapters
    .filter((a) => (weights[a.id] ?? 0) > 0 && a.triggerWord)
    .map((a) => a.triggerWord);

  if (activeTriggers.length === 0) return prompt;

  // Prepend trigger words, deduplicate
  const uniqueTriggers = Array.from(new Set(activeTriggers));
  const triggerPrefix = uniqueTriggers.join(", ");

  // Don't duplicate if prompt already starts with trigger words
  if (prompt.startsWith(triggerPrefix)) return prompt;

  return `${triggerPrefix}, ${prompt}`;
}

// ─── DoRA Training Config Extension ────────────────────────────────────────

/**
 * Extended training configuration for DoRA + PiSSA.
 * Extends the existing TrainingConfig interface from sakufuu/lora-training.ts.
 */
export interface DoRATrainingConfig {
  /** Adapter type: dora (default) or legacy lora */
  adapterType: AdapterType;
  /** Initialization: pissa (default) or random (legacy) */
  initialization: AdapterInitialization;
  /** Base model to fine-tune */
  baseModel: string;
  /** Trigger word for the adapter */
  triggerWord: string;
  /** Number of training steps */
  steps: number;
  /** Learning rate (default 1e-4 for DoRA, same as LoRA) */
  learningRate: number;
  /** Adapter rank (dimensionality) — default 32 for DoRA */
  rank: number;
  /** Alpha for scaling (default rank/2 for DoRA) */
  alpha: number;
  /** Resolution for training images */
  resolution: number;
  /** Batch size */
  batchSize: number;
  /** Whether to use caption-based training */
  useCaptions: boolean;
  /** Role this adapter will serve */
  role: AdapterRole;
  /** Additional provider-specific config */
  extra?: Record<string, unknown>;
}

/**
 * Default DoRA training configuration.
 * Per Addendum §1: DoRA + PiSSA is default for ALL proprietary Awakli adapters.
 */
export const DEFAULT_DORA_TRAINING_CONFIG: Omit<DoRATrainingConfig, "triggerWord" | "role"> = {
  adapterType: "dora",
  initialization: "pissa",
  baseModel: "Anything V5",
  steps: 1200,
  learningRate: 1e-4,
  rank: 32,
  alpha: 16,
  resolution: 512,
  batchSize: 2,
  useCaptions: true,
};

/**
 * Per-role training configuration overrides.
 */
export const ROLE_TRAINING_OVERRIDES: Record<AdapterRole, Partial<DoRATrainingConfig>> = {
  character: {
    steps: 1200,
    rank: 32,
    resolution: 512,
    // Character adapters train per-episode
  },
  sakufuu: {
    steps: 2000,
    rank: 48,
    resolution: 768,
    // Sakufuu adapters train every 3-5 episodes, need higher capacity
  },
  genre: {
    steps: 3000,
    rank: 64,
    resolution: 768,
    // Genre adapters train once, quarterly refresh, highest capacity
  },
};

// ─── Migration Utility ──────────────────────────────────────────────────────

/**
 * Configuration for migrating existing LoRA training jobs to DoRA.
 * Per Addendum §1: existing jobs stay as-is, new jobs default to DoRA + PiSSA.
 * Migration = re-training (not weight conversion).
 */
export interface MigrationConfig {
  /** Original LoRA job ID */
  originalJobId: string;
  /** Original LoRA weights URL */
  originalWeightsUrl: string;
  /** Whether to re-train as DoRA (true) or keep as legacy LoRA (false) */
  migrateToDoRA: boolean;
  /** If migrating, use same training images */
  reuseTrainingData: boolean;
}

/**
 * Generate a DoRA training config from an existing LoRA training config.
 * Used for migration path (Item 1.9).
 */
export function migrateLoraToDoraConfig(
  legacyConfig: {
    baseModel: string;
    triggerWord: string;
    steps: number;
    learningRate: number;
    loraRank: number;
    resolution: number;
    batchSize: number;
    useCaptions: boolean;
  },
  role: AdapterRole
): DoRATrainingConfig {
  return {
    adapterType: "dora",
    initialization: "pissa",
    baseModel: legacyConfig.baseModel,
    triggerWord: legacyConfig.triggerWord,
    steps: legacyConfig.steps,
    learningRate: legacyConfig.learningRate,
    rank: legacyConfig.loraRank,
    alpha: Math.floor(legacyConfig.loraRank / 2),
    resolution: legacyConfig.resolution,
    batchSize: legacyConfig.batchSize,
    useCaptions: legacyConfig.useCaptions,
    role,
  };
}

// ─── Composition Validation ─────────────────────────────────────────────────

/**
 * Validate that a set of adapters can be composed together.
 * Checks: base model compatibility, role uniqueness, weight format.
 */
export function validateAdapterComposition(adapters: DoRAAdapter[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (adapters.length === 0) {
    errors.push("At least one adapter is required");
    return { valid: false, errors, warnings };
  }

  if (adapters.length > 5) {
    errors.push("Maximum 5 adapters supported per composition");
    return { valid: false, errors, warnings };
  }

  // Check base model compatibility
  const baseModels = new Set(adapters.map((a) => a.baseModel));
  if (baseModels.size > 1) {
    errors.push(
      `Adapters trained on different base models cannot be composed: ${Array.from(baseModels).join(", ")}`
    );
  }

  // Check role uniqueness (at most one per role)
  const roleCounts: Record<string, number> = {};
  for (const adapter of adapters) {
    roleCounts[adapter.role] = (roleCounts[adapter.role] || 0) + 1;
  }
  for (const [role, count] of Object.entries(roleCounts)) {
    if (count > 1) {
      warnings.push(`Multiple adapters with role "${role}" — weights will be split`);
    }
  }

  // Check weights URL format
  for (const adapter of adapters) {
    if (!adapter.weightsUrl) {
      errors.push(`Adapter "${adapter.id}" has no weights URL`);
    }
    if (!adapter.weightsUrl.endsWith(".safetensors") && !adapter.weightsUrl.includes("safetensors")) {
      warnings.push(`Adapter "${adapter.id}" weights may not be in .safetensors format`);
    }
  }

  // Check DoRA/LoRA mixing
  const adapterTypes = new Set(adapters.map((a) => a.type));
  if (adapterTypes.size > 1) {
    warnings.push("Mixing DoRA and LoRA adapters — composition will work but DoRA-only is recommended");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Cost Estimation ────────────────────────────────────────────────────────

/**
 * Per Addendum §6 Cost Framework:
 * - Three-adapter composition (fal.ai): $0.06-0.18/gen
 * - Three-adapter composition (RunPod): $0.04-0.15/gen
 * - IP-Adapter conditioning: $0.05-0.20/gen (hybrid genre path only)
 */
export const COMPOSITION_COST_ESTIMATES = {
  fal: {
    basePerGen: 0.075,           // $0.075/megapixel (flux-general)
    perAdapterOverhead: 0.015,   // Small overhead per additional adapter
    ipAdapterOverhead: 0.03,     // IP-Adapter adds ~$0.03
    highResMultiplier: 1.5,      // >1024px in either dimension
  },
  runpod: {
    basePerGen: 0.05,            // Lower base cost
    perAdapterOverhead: 0.01,
    ipAdapterOverhead: 0.02,
    highResMultiplier: 1.3,
  },
} as const;

/**
 * Estimate composition cost for a given provider.
 */
export function estimateCompositionCost(
  provider: "fal" | "runpod",
  adapterCount: number,
  useIpAdapter: boolean,
  width: number,
  height: number
): number {
  const costs = COMPOSITION_COST_ESTIMATES[provider];
  let cost = costs.basePerGen;
  cost += (adapterCount - 1) * costs.perAdapterOverhead;
  if (useIpAdapter) cost += costs.ipAdapterOverhead;
  if (width > 1024 || height > 1024) cost *= costs.highResMultiplier;
  return Math.round(cost * 1000) / 1000; // Round to 3 decimal places
}
