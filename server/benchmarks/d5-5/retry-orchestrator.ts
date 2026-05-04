/**
 * D5.5 · Retry Orchestrator
 *
 * Manages the retry loop for clips that fail D5.5 quality review.
 * Wires into the H2 Feedback Router pattern but with a higher retry budget
 * (3 attempts per clip vs 1 in post-assembly D5).
 *
 * Flow:
 * 1. Clip generated → D5.5 reviews it
 * 2. If failed → routing decision determines what to regenerate
 * 3. Regeneration happens (video/prompt/reference depending on issue)
 * 4. D5.5 reviews again (attempt 2)
 * 5. If still failed → one more retry (attempt 3)
 * 6. If still failed → escalate to admin quality queue
 *
 * Budget: 3 attempts × $0.04/review = $0.12 max per clip in review cost
 * Plus regeneration cost: ~$0.20/video × 2 retries = $0.40 max per clip
 * Total worst case per clip: ~$0.52
 * Total worst case per episode (19 slices, all fail 3x): ~$9.88
 */

import {
  runD5_5PerClipReview,
  MAX_D5_5_RETRIES_PER_CLIP,
  DEFAULT_PASS_THRESHOLD,
  type D5_5ReviewOptions,
  type D5_5ReviewResult,
  type RoutingDecision,
} from "./per-clip-reviewer.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RetryState {
  sliceId: number;
  attempts: number;
  lastRoutingDecision: RoutingDecision;
  reviews: D5_5ReviewResult[];
  escalated: boolean;
  totalCostUsd: number;
}

export interface RetryOrchestratorResult {
  sliceId: number;
  finalPassed: boolean;
  totalAttempts: number;
  finalRoutingDecision: RoutingDecision;
  reviews: D5_5ReviewResult[];
  escalated: boolean;
  totalCostUsd: number;
  totalDurationMs: number;
}

export interface RegenerationCallback {
  /** Called when a clip needs video regeneration. Returns new clip URL + keyframe URLs. */
  regenerateVideo: (sliceId: number, attempt: number) => Promise<{ clipUrl: string; keyframeUrls: string[] }>;
  /** Called when a clip needs prompt regeneration. Returns new prompt + clip URL + keyframe URLs. */
  regeneratePrompt: (sliceId: number, attempt: number) => Promise<{ clipUrl: string; keyframeUrls: string[] }>;
  /** Called when a clip needs reference regeneration. Returns new clip URL + keyframe URLs. */
  regenerateReference: (sliceId: number, attempt: number) => Promise<{ clipUrl: string; keyframeUrls: string[] }>;
  /** Called when a clip is escalated to admin queue. */
  escalate: (sliceId: number, reviews: D5_5ReviewResult[]) => Promise<void>;
}

// ─── Retry Orchestrator ─────────────────────────────────────────────────────

/**
 * Run the full D5.5 retry loop for a single clip.
 * Returns when the clip passes or is escalated.
 */
export async function runRetryLoop(
  initialOptions: D5_5ReviewOptions,
  callbacks: RegenerationCallback,
): Promise<RetryOrchestratorResult> {
  const start = Date.now();
  const state: RetryState = {
    sliceId: initialOptions.slice.sliceId,
    attempts: 0,
    lastRoutingDecision: "pass",
    reviews: [],
    escalated: false,
    totalCostUsd: 0,
  };

  let currentOptions = { ...initialOptions };

  while (state.attempts < MAX_D5_5_RETRIES_PER_CLIP) {
    state.attempts++;
    currentOptions.attempt = state.attempts;

    // Run D5.5 review
    const review = await runD5_5PerClipReview(currentOptions);
    state.reviews.push(review);
    state.totalCostUsd += review.costUsd;
    state.lastRoutingDecision = review.routingDecision;

    // If passed, we're done
    if (review.passed) {
      return {
        sliceId: state.sliceId,
        finalPassed: true,
        totalAttempts: state.attempts,
        finalRoutingDecision: "pass",
        reviews: state.reviews,
        escalated: false,
        totalCostUsd: state.totalCostUsd,
        totalDurationMs: Date.now() - start,
      };
    }

    // If escalated (max retries reached), stop
    if (review.routingDecision === "escalate") {
      state.escalated = true;
      await callbacks.escalate(state.sliceId, state.reviews);
      break;
    }

    // If not the last attempt, regenerate based on routing decision
    if (state.attempts < MAX_D5_5_RETRIES_PER_CLIP) {
      const newAssets = await dispatchRegeneration(
        review.routingDecision,
        state.sliceId,
        state.attempts,
        callbacks
      );

      if (newAssets) {
        currentOptions.clipUrl = newAssets.clipUrl;
        currentOptions.keyframeUrls = newAssets.keyframeUrls;
      }
    }
  }

  // If we exit the loop without passing, escalate
  if (!state.escalated && !state.reviews[state.reviews.length - 1]?.passed) {
    state.escalated = true;
    state.lastRoutingDecision = "escalate";
    await callbacks.escalate(state.sliceId, state.reviews);
  }

  return {
    sliceId: state.sliceId,
    finalPassed: false,
    totalAttempts: state.attempts,
    finalRoutingDecision: state.lastRoutingDecision,
    reviews: state.reviews,
    escalated: state.escalated,
    totalCostUsd: state.totalCostUsd,
    totalDurationMs: Date.now() - start,
  };
}

async function dispatchRegeneration(
  decision: RoutingDecision,
  sliceId: number,
  attempt: number,
  callbacks: RegenerationCallback
): Promise<{ clipUrl: string; keyframeUrls: string[] } | null> {
  switch (decision) {
    case "retry_video":
      return callbacks.regenerateVideo(sliceId, attempt);
    case "retry_prompt":
      return callbacks.regeneratePrompt(sliceId, attempt);
    case "retry_reference":
      return callbacks.regenerateReference(sliceId, attempt);
    default:
      return null;
  }
}

// ─── Episode-Level Orchestrator ─────────────────────────────────────────────

export interface EpisodeRetryOptions {
  episodeId: number;
  projectId: number;
  /** Initial review results from batch D5.5 */
  failedReviews: D5_5ReviewResult[];
  /** Slice metadata for regeneration context */
  sliceMetadata: Map<number, D5_5ReviewOptions["slice"]>;
  /** Character bibles */
  characterBibles: Record<string, any>;
  /** Style lock */
  styleLock: D5_5ReviewOptions["styleLock"];
  /** Regeneration callbacks */
  callbacks: RegenerationCallback;
  /** Pass threshold */
  passThreshold?: number;
}

export interface EpisodeRetryResult {
  episodeId: number;
  totalRetried: number;
  totalPassed: number;
  totalEscalated: number;
  results: RetryOrchestratorResult[];
  totalCostUsd: number;
  totalDurationMs: number;
  /** Whether the episode can proceed to assembly */
  canProceedToAssembly: boolean;
}

/**
 * Run retry loops for all failed clips in an episode.
 * Runs sequentially to avoid overwhelming the generation API.
 */
export async function runEpisodeRetryLoop(
  options: EpisodeRetryOptions
): Promise<EpisodeRetryResult> {
  const start = Date.now();
  const {
    episodeId,
    failedReviews,
    sliceMetadata,
    characterBibles,
    styleLock,
    callbacks,
    passThreshold = DEFAULT_PASS_THRESHOLD,
  } = options;

  console.log(`[D5.5 Retry] Starting retry loop for ${failedReviews.length} failed clips in episode ${episodeId}`);

  const results: RetryOrchestratorResult[] = [];

  for (const review of failedReviews) {
    const metadata = sliceMetadata.get(review.sliceId);
    if (!metadata) {
      console.warn(`[D5.5 Retry] No metadata for slice ${review.sliceId}, skipping`);
      continue;
    }

    const result = await runRetryLoop(
      {
        clipUrl: "", // Will be set by regeneration callback
        slice: metadata,
        characterBibles,
        styleLock,
        keyframeUrls: [], // Will be set by regeneration callback
        attempt: review.attempt + 1, // Start from next attempt
        passThreshold,
      },
      callbacks
    );

    results.push(result);
  }

  const totalPassed = results.filter((r) => r.finalPassed).length;
  const totalEscalated = results.filter((r) => r.escalated).length;
  const totalCostUsd = results.reduce((sum, r) => sum + r.totalCostUsd, 0);
  const totalDurationMs = Date.now() - start;

  // Episode can proceed if no escalations (all clips either passed or were retried successfully)
  const canProceedToAssembly = totalEscalated === 0;

  console.log(`[D5.5 Retry] Complete: ${totalPassed} passed, ${totalEscalated} escalated`);
  console.log(`[D5.5 Retry] Can proceed to assembly: ${canProceedToAssembly}`);

  return {
    episodeId,
    totalRetried: results.length,
    totalPassed,
    totalEscalated,
    results,
    totalCostUsd,
    totalDurationMs,
    canProceedToAssembly,
  };
}
