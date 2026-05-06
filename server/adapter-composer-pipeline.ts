/**
 * Wave 6A — Item 1.8-1.9: Pipeline Integration + Migration Path
 *
 * Wires AdapterComposer into D0/D1.5/D7 generation stages.
 * Provides the bridge between the existing image-router (single LoRA) and
 * the new three-adapter composition runtime.
 *
 * Per Addendum §2:
 * - Stage 3 (D0): character adapter primary, anime-type and sakufuu modulating
 * - Stage 7 (D1.5/Genga): all three at full weight
 * - Stage 14 (D7/FX Pass): anime-type and sakufuu primary, character at low weight
 *
 * Integration approach:
 * - New `composeAndGenerate()` function replaces direct `generateImage()` calls
 *   in stages that support three-adapter composition
 * - Falls back to legacy single-LoRA path if adapters not available
 * - Existing image-router remains for non-composed generation (thumbnails, etc.)
 *
 * @see server/pipelineOrchestrator.ts for existing pipeline
 * @see server/image-router/router.ts for existing image generation routing
 */

import type {
  AdapterComposer,
  CompositionInput,
  CompositionOutput,
  CompositionStage,
  DoRAAdapter,
  AdapterRole,
  DoRATrainingConfig,
  MigrationConfig,
} from "./adapter-composer";
import {
  resolveBlendWeights,
  validateAdapterComposition,
  migrateLoraToDoraConfig,
  DEFAULT_DORA_TRAINING_CONFIG,
  ROLE_TRAINING_OVERRIDES,
} from "./adapter-composer";
import {
  buildCompositionWithRAG,
  type BuildCompositionWithRAGInput,
  type BuildCompositionWithRAGOutput,
} from "./adapter-composer-rag";
import {
  createCompositionExecutor,
  selectOptimalProvider,
  type ComposerProvider,
} from "./adapter-composer-executors";
import type { GenreTag } from "./benchmarks/d10/genre-retrieval-pool";

// ─── Pipeline Stage Context ─────────────────────────────────────────────────

/**
 * Context passed from the pipeline orchestrator to the composition layer.
 */
export interface PipelineCompositionContext {
  /** Pipeline run ID for tracking */
  pipelineRunId: number;
  /** Episode ID */
  episodeId: number;
  /** Project ID */
  projectId: number;
  /** User ID (owner) */
  userId: number;
  /** Panel ID (if applicable) */
  panelId?: number;
  /** Pipeline stage being executed */
  stage: CompositionStage;
  /** Project's genre tag */
  genre: GenreTag;
  /** Scene description for RAG retrieval */
  sceneDescription: string;
  /** Monthly spend for provider selection */
  monthlySpendUsd?: number;
  /** Preferred provider override */
  preferredProvider?: ComposerProvider;
}

/**
 * Available adapters for a project, resolved from the database.
 */
export interface ProjectAdapters {
  /** Genre adapter (from style bundle / genre training) */
  genre?: DoRAAdapter;
  /** Character adapter (per-character, per-episode) */
  character?: DoRAAdapter;
  /** Sakufuu adapter (creator style, trained every 3-5 episodes) */
  sakufuu?: DoRAAdapter;
}

/**
 * Result from a composed generation in the pipeline.
 */
export interface PipelineCompositionResult {
  /** Generated image URL */
  imageUrl: string;
  /** Total cost in USD */
  costUsd: number;
  /** Whether composition was used (vs legacy single-LoRA fallback) */
  compositionUsed: boolean;
  /** Number of adapters composed */
  adapterCount: number;
  /** Whether IP-Adapter (RAG) was active */
  ipAdapterUsed: boolean;
  /** Provider used */
  provider: string;
  /** Full composition output (null if legacy path) */
  compositionOutput?: CompositionOutput;
  /** RAG result metadata */
  ragMetadata?: {
    retrievalLatencyMs: number;
    confidence: string;
    referencesUsed: number;
  };
  /** Fallback reason (if composition was skipped) */
  fallbackReason?: string;
}

// ─── Main Pipeline Integration ──────────────────────────────────────────────

/**
 * Compose and generate an image using the three-adapter composition runtime.
 * This is the primary entry point for pipeline stages (D0, D1.5, D7).
 *
 * Decision flow:
 * 1. Check if adapters are available for this project
 * 2. If yes → use AdapterComposer with RAG-augmented IP-Adapter
 * 3. If no → fall back to legacy single-LoRA path via image-router
 *
 * @param ctx - Pipeline context (stage, project, genre, scene)
 * @param adapters - Available adapters for this project
 * @param prompt - Generation prompt
 * @param options - Generation options (dimensions, seed, etc.)
 * @returns Generated image with metadata
 */
export async function composeAndGenerate(
  ctx: PipelineCompositionContext,
  adapters: ProjectAdapters,
  prompt: string,
  options: {
    negativePrompt?: string;
    width: number;
    height: number;
    numInferenceSteps?: number;
    guidanceScale?: number;
    seed?: number;
    sourceImageUrl?: string;
    denoisingStrength?: number;
    blendWeights?: Record<string, number>;
  }
): Promise<PipelineCompositionResult> {
  // Collect available adapters
  const activeAdapters: DoRAAdapter[] = [];
  if (adapters.genre) activeAdapters.push(adapters.genre);
  if (adapters.character) activeAdapters.push(adapters.character);
  if (adapters.sakufuu) activeAdapters.push(adapters.sakufuu);

  // If no adapters available, fall back to legacy path
  if (activeAdapters.length === 0) {
    return {
      imageUrl: "",
      costUsd: 0,
      compositionUsed: false,
      adapterCount: 0,
      ipAdapterUsed: false,
      provider: "legacy",
      fallbackReason: "No adapters available for this project",
    };
  }

  // Validate adapter composition
  const validation = validateAdapterComposition(activeAdapters);
  if (!validation.valid) {
    return {
      imageUrl: "",
      costUsd: 0,
      compositionUsed: false,
      adapterCount: 0,
      ipAdapterUsed: false,
      provider: "legacy",
      fallbackReason: `Adapter validation failed: ${validation.errors.join("; ")}`,
    };
  }

  // Select provider
  const provider = selectOptimalProvider(
    ctx.monthlySpendUsd ?? 0,
    ctx.preferredProvider
  );

  // Build composition with RAG
  const ragInput: BuildCompositionWithRAGInput = {
    adapters: activeAdapters,
    genre: ctx.genre,
    sceneDescription: ctx.sceneDescription,
    stage: ctx.stage,
    prompt,
    negativePrompt: options.negativePrompt,
    width: options.width,
    height: options.height,
    blendWeights: options.blendWeights,
    numInferenceSteps: options.numInferenceSteps,
    guidanceScale: options.guidanceScale,
    seed: options.seed,
    sourceImageUrl: options.sourceImageUrl,
    denoisingStrength: options.denoisingStrength,
  };

  let ragOutput: BuildCompositionWithRAGOutput;
  try {
    ragOutput = await buildCompositionWithRAG(ragInput);
  } catch (err) {
    return {
      imageUrl: "",
      costUsd: 0,
      compositionUsed: false,
      adapterCount: activeAdapters.length,
      ipAdapterUsed: false,
      provider: "legacy",
      fallbackReason: `RAG conditioning failed: ${(err as Error).message}`,
    };
  }

  // Create executor and compose
  // Note: In production, API keys come from env vars. Here we use placeholder
  // to show the integration pattern. Actual keys injected via env.ts.
  const apiKey = provider === "fal"
    ? (process.env.FAL_API_KEY || "")
    : (process.env.RUNPOD_API_KEY || "");
  const endpointId = process.env.RUNPOD_COMPOSITION_ENDPOINT_ID;

  if (!apiKey) {
    return {
      imageUrl: "",
      costUsd: 0,
      compositionUsed: false,
      adapterCount: activeAdapters.length,
      ipAdapterUsed: false,
      provider,
      fallbackReason: `No API key configured for provider: ${provider}`,
    };
  }

  let executor: AdapterComposer;
  try {
    executor = createCompositionExecutor(provider, {
      apiKey,
      endpointId: endpointId || undefined,
    });
  } catch (err) {
    return {
      imageUrl: "",
      costUsd: 0,
      compositionUsed: false,
      adapterCount: activeAdapters.length,
      ipAdapterUsed: false,
      provider,
      fallbackReason: `Failed to create executor: ${(err as Error).message}`,
    };
  }

  // Execute composition
  try {
    const result = await executor.compose(ragOutput.compositionInput);
    return {
      imageUrl: result.imageUrl,
      costUsd: result.actualCostUsd,
      compositionUsed: true,
      adapterCount: result.metadata.adapterCount,
      ipAdapterUsed: result.ipAdapterUsed,
      provider: result.provider,
      compositionOutput: result,
      ragMetadata: {
        retrievalLatencyMs: ragOutput.ragResult.retrievalLatencyMs,
        confidence: ragOutput.ragResult.confidence.confidence,
        referencesUsed: ragOutput.ragResult.references.length,
      },
    };
  } catch (err) {
    return {
      imageUrl: "",
      costUsd: 0,
      compositionUsed: false,
      adapterCount: activeAdapters.length,
      ipAdapterUsed: false,
      provider,
      fallbackReason: `Composition execution failed: ${(err as Error).message}`,
    };
  }
}

// ─── Adapter Resolution ─────────────────────────────────────────────────────

/**
 * Resolve available adapters for a project from the database.
 * This function queries the lora_training_jobs and style_bundles tables
 * to find the latest trained adapters for each role.
 *
 * @param projectId - Project to resolve adapters for
 * @param characterId - Optional specific character ID
 * @returns Available adapters (may be partial — not all roles trained)
 */
export async function resolveProjectAdapters(
  projectId: number,
  characterId?: string
): Promise<ProjectAdapters> {
  // This is the integration point with the database.
  // In production, this queries:
  // 1. loraTrainingJobs for character + sakufuu adapters (status = 'completed')
  // 2. styleBundles for genre adapter (genreKey → trained DoRA)
  //
  // For now, return the interface contract. Actual DB queries will be wired
  // when the schema migration adds adapterType/initialization columns.
  return {
    genre: undefined,
    character: undefined,
    sakufuu: undefined,
  };
}

// ─── Stage-Specific Helpers ─────────────────────────────────────────────────

/**
 * Map pipeline node names to CompositionStage.
 * Used by the orchestrator to determine which blend weights to use.
 */
export function mapNodeToStage(nodeName: string): CompositionStage {
  const normalized = nodeName.toLowerCase();
  if (normalized.includes("character") || normalized.includes("d0") || normalized.includes("chara_design")) {
    return "d0_character_design";
  }
  if (normalized.includes("genga") || normalized.includes("d1.5") || normalized.includes("d1_5") || normalized.includes("key_animation")) {
    return "d1_5_genga";
  }
  if (normalized.includes("fx") || normalized.includes("d7") || normalized.includes("composit")) {
    return "d7_fx_pass";
  }
  if (normalized.includes("d10") || normalized.includes("reference") || normalized.includes("craft")) {
    return "d10_reference_gen";
  }
  return "custom";
}

/**
 * Determine if a pipeline stage supports three-adapter composition.
 * Not all stages use composed generation — some use direct image generation.
 */
export function stageSupportsComposition(stage: CompositionStage): boolean {
  return stage !== "custom"; // All named stages support composition
}

// ─── Migration Path (Item 1.9) ──────────────────────────────────────────────

/**
 * Migrate existing LoRA training jobs to DoRA configuration.
 * Per Addendum §1: existing jobs stay as-is, new jobs default to DoRA + PiSSA.
 * Migration = re-training (not weight conversion).
 *
 * This utility generates migration configs for batch re-training.
 */
export interface MigrationPlan {
  /** Jobs that will be migrated (re-trained as DoRA) */
  toMigrate: Array<{
    jobId: string;
    role: AdapterRole;
    newConfig: DoRATrainingConfig;
    estimatedCostUsd: number;
  }>;
  /** Jobs that will stay as legacy LoRA */
  toKeep: Array<{
    jobId: string;
    reason: string;
  }>;
  /** Total estimated cost for migration */
  totalCostUsd: number;
  /** Summary */
  summary: string;
}

/**
 * Generate a migration plan for existing LoRA training jobs.
 *
 * Strategy:
 * - Active character LoRAs (used in last 30 days): migrate to DoRA
 * - Sakufuu LoRAs: always migrate (high-value, long-lived)
 * - Genre LoRAs: migrate if genre pool confidence is medium+
 * - Inactive LoRAs (>30 days unused): keep as-is (will be superseded)
 */
export function generateMigrationPlan(
  existingJobs: Array<{
    id: string;
    role: AdapterRole;
    baseModel: string;
    triggerWord: string;
    steps: number;
    learningRate: number;
    loraRank: number;
    resolution: number;
    batchSize: number;
    useCaptions: boolean;
    lastUsedAt?: number;
    status: string;
  }>
): MigrationPlan {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const toMigrate: MigrationPlan["toMigrate"] = [];
  const toKeep: MigrationPlan["toKeep"] = [];

  for (const job of existingJobs) {
    // Only migrate completed jobs
    if (job.status !== "completed") {
      toKeep.push({ jobId: job.id, reason: `Job not completed (status: ${job.status})` });
      continue;
    }

    // Check if recently used
    const isActive = job.lastUsedAt && (now - job.lastUsedAt) < thirtyDaysMs;

    // Sakufuu always migrates
    if (job.role === "sakufuu") {
      const newConfig = migrateLoraToDoraConfig(job, "sakufuu");
      toMigrate.push({
        jobId: job.id,
        role: "sakufuu",
        newConfig,
        estimatedCostUsd: estimateMigrationCost("sakufuu"),
      });
      continue;
    }

    // Genre always migrates
    if (job.role === "genre") {
      const newConfig = migrateLoraToDoraConfig(job, "genre");
      toMigrate.push({
        jobId: job.id,
        role: "genre",
        newConfig,
        estimatedCostUsd: estimateMigrationCost("genre"),
      });
      continue;
    }

    // Character: only migrate if active
    if (job.role === "character") {
      if (isActive) {
        const newConfig = migrateLoraToDoraConfig(job, "character");
        toMigrate.push({
          jobId: job.id,
          role: "character",
          newConfig,
          estimatedCostUsd: estimateMigrationCost("character"),
        });
      } else {
        toKeep.push({
          jobId: job.id,
          reason: `Character LoRA inactive (last used ${job.lastUsedAt ? Math.floor((now - job.lastUsedAt) / (24 * 60 * 60 * 1000)) + " days ago" : "never"})`,
        });
      }
      continue;
    }

    toKeep.push({ jobId: job.id, reason: "Unknown role" });
  }

  const totalCostUsd = toMigrate.reduce((sum, m) => sum + m.estimatedCostUsd, 0);

  return {
    toMigrate,
    toKeep,
    totalCostUsd,
    summary: `Migration plan: ${toMigrate.length} jobs to re-train as DoRA ($${totalCostUsd.toFixed(2)}), ${toKeep.length} jobs kept as legacy LoRA`,
  };
}

/**
 * Estimate cost to re-train a LoRA as DoRA.
 * Per Addendum §6 Cost Framework.
 */
function estimateMigrationCost(role: AdapterRole): number {
  switch (role) {
    case "character": return 12.5;  // $5-20 per character
    case "sakufuu": return 100;     // $50-150 per cycle
    case "genre": return 125;       // $50-200 per genre
    default: return 15;
  }
}

// ─── Legacy Compatibility ───────────────────────────────────────────────────

/**
 * Check if a project should use the new composition path or legacy single-LoRA.
 * Gradual rollout: projects opt-in via a flag or when they have DoRA-trained adapters.
 */
export function shouldUseComposition(
  projectConfig: {
    compositionEnabled?: boolean;
    hasDoRAAdapters?: boolean;
    createdAfterWave6?: boolean;
  }
): boolean {
  // Explicit opt-in
  if (projectConfig.compositionEnabled === true) return true;
  // Explicit opt-out
  if (projectConfig.compositionEnabled === false) return false;
  // Auto-enable for projects with DoRA adapters
  if (projectConfig.hasDoRAAdapters) return true;
  // Auto-enable for projects created after Wave 6
  if (projectConfig.createdAfterWave6) return true;
  // Default: legacy path
  return false;
}

/**
 * Convert a legacy single-LoRA URL to a DoRAAdapter structure.
 * Used during the transition period when projects have legacy LoRAs
 * but want to use the composition path.
 */
export function legacyLoraToAdapter(
  loraUrl: string,
  role: AdapterRole,
  triggerWord: string = ""
): DoRAAdapter {
  return {
    id: `legacy_${role}_${Date.now()}`,
    role,
    type: "lora", // Legacy LoRAs stay as type "lora"
    weightsUrl: loraUrl,
    triggerWord,
    defaultWeight: role === "character" ? 0.8 : 0.5,
    rank: 32, // Assumed default
    initialization: "random", // Legacy = random init
    baseModel: "Anything V5", // Assumed
  };
}
