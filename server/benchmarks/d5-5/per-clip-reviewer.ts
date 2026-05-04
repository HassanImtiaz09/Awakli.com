/**
 * D5.5 · Per-Clip Quality Gate (Pre-Assembly)
 *
 * Runs BEFORE assembly on individual clips. Catches issues early when
 * re-rolls are cheap (~$0.20/clip) instead of after full assembly (~$3-5/episode).
 *
 * Key differences from D5 (post-assembly):
 * - Operates on a SINGLE clip, not the assembled video
 * - Adds `motion_quality` dimension (morphing artifacts, motion stalls)
 * - Higher retry budget: 3 attempts per clip (vs 1 in D5)
 * - No audio_visual_sync check (audio not yet mixed at this stage)
 * - Cheaper per-call: ~$0.04/clip (3 frames × low-detail)
 *
 * Cost target: ~$0.04/clip, ~$0.76/episode (19 slices)
 * Latency target: ≤15s per clip
 */

import { invokeLLM } from "../../_core/llm.js";
import type { D5SliceIssue, D5IssueCategory } from "../harness/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface D5_5ReviewOptions {
  /** URL of the individual clip to review */
  clipUrl: string;
  /** Slice metadata */
  slice: {
    sliceId: number;
    intent: string;        // What this slice is supposed to depict
    emotion?: string;      // Emotion arc beat
    isDialogue: boolean;
    cameraAngle?: string;
    characters: string[];  // Character names present in this slice
  };
  /** Character bible JSONs (only the characters in this slice) */
  characterBibles: Record<string, any>;
  /** style_lock specification */
  styleLock: {
    primary: string;
    forbidden: string[];
    toleranceBand?: string;
  };
  /** Keyframe URLs (pre-extracted: start, mid, end) */
  keyframeUrls: string[];
  /** Current attempt number (1-based) */
  attempt: number;
  /** Pass threshold (minimum overall_score to pass, default 3) */
  passThreshold?: number;
  /** Budget cap in USD per clip (default: 0.10) */
  budgetCapUsd?: number;
}

export interface D5_5ReviewResult {
  sliceId: number;
  attempt: number;
  passed: boolean;
  scores: {
    character_consistency: number;  // 1-5
    style: number;                  // 1-5
    prompt_alignment: number;       // 1-5
    motion_quality: number;         // 1-5 (NEW: morphing, stalls, fluidity)
  };
  overallScore: number;            // Weighted average
  issues: D5SliceIssue[];
  routingDecision: RoutingDecision;
  costUsd: number;
  durationMs: number;
}

export type RoutingDecision =
  | "pass"
  | "retry_video"
  | "retry_prompt"
  | "retry_reference"
  | "escalate";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum retry attempts per clip before escalation */
export const MAX_D5_5_RETRIES_PER_CLIP = 3;

/** Default pass threshold (minimum overall_score 1-5) */
export const DEFAULT_PASS_THRESHOLD = 3;

/** Score weights for computing overall_score */
const SCORE_WEIGHTS = {
  character_consistency: 0.35,
  style: 0.25,
  prompt_alignment: 0.20,
  motion_quality: 0.20,
};

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an anime quality reviewer specializing in per-clip quality assessment.

You review individual 5-10 second anime clips BEFORE they are assembled into a full episode.
Your job is to catch quality issues early when re-generation is cheap.

SCORING DIMENSIONS (1-5 scale):
- character_consistency: Do characters match their reference sheets? Hair color, eye color, outfit, proportions, distinctive features.
- style: Does the visual style match the style_lock? Line weight, color palette, shading approach, background treatment.
- prompt_alignment: Does the clip depict what was intended? Action, emotion, camera angle, setting.
- motion_quality: Is the motion fluid and natural? No morphing artifacts, no motion stalls, no limb distortion, no face melting.

SEVERITY LEVELS:
- critical: Unwatchable — character unrecognizable, severe morphing, completely wrong scene
- major: Noticeable — wrong hair color, style drift, stiff motion, missing key action
- minor: Acceptable — slight proportion shift, minor color variance, brief motion hiccup

RECOMMENDED ACTIONS:
- regenerate-slice: Motion or composition issue → re-generate the video clip
- regenerate-prompt: Intent mismatch → fix the D2 prompt then regenerate
- regenerate-reference: Character drift → regenerate reference sheet then video
- log-only: Minor issue not worth re-rolling

Return valid JSON matching the schema exactly.`;

// ─── Core Reviewer ──────────────────────────────────────────────────────────

export async function runD5_5PerClipReview(options: D5_5ReviewOptions): Promise<D5_5ReviewResult> {
  const start = Date.now();
  const {
    clipUrl,
    slice,
    characterBibles,
    styleLock,
    keyframeUrls,
    attempt,
    passThreshold = DEFAULT_PASS_THRESHOLD,
    budgetCapUsd = 0.10,
  } = options;

  // Build context block
  const contextBlock = JSON.stringify({
    slice: {
      sliceId: slice.sliceId,
      intent: slice.intent,
      emotion: slice.emotion || "unspecified",
      isDialogue: slice.isDialogue,
      cameraAngle: slice.cameraAngle || "medium",
      characters: slice.characters,
    },
    characterBibles,
    styleLock,
    attempt,
    passThreshold,
  }, null, 2);

  // Build multimodal message with keyframes
  const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = [];

  userContent.push({
    type: "text",
    text: `Review this single anime clip (attempt ${attempt}/${MAX_D5_5_RETRIES_PER_CLIP}). Context:\n\n${contextBlock}\n\nBelow are 3 keyframes from this clip (start, mid, end). Score the clip and identify any issues.`,
  });

  // Add keyframe images
  for (let i = 0; i < keyframeUrls.length; i++) {
    const label = i === 0 ? "START" : i === 1 ? "MID" : "END";
    userContent.push({
      type: "text",
      text: `\n[Keyframe ${label}]`,
    });
    userContent.push({
      type: "image_url",
      image_url: {
        url: keyframeUrls[i],
        detail: "low",
      },
    });
  }

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent as any },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "clip_quality_review",
          strict: true,
          schema: {
            type: "object",
            properties: {
              scores: {
                type: "object",
                properties: {
                  character_consistency: { type: "integer", minimum: 1, maximum: 5 },
                  style: { type: "integer", minimum: 1, maximum: 5 },
                  prompt_alignment: { type: "integer", minimum: 1, maximum: 5 },
                  motion_quality: { type: "integer", minimum: 1, maximum: 5 },
                },
                required: ["character_consistency", "style", "prompt_alignment", "motion_quality"],
                additionalProperties: false,
              },
              issues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: {
                      type: "string",
                      enum: ["character_consistency", "style_violation", "narrative_coherence", "audio_visual_sync", "prompt_alignment"],
                    },
                    severity: { type: "string", enum: ["critical", "major", "minor"] },
                    description: { type: "string" },
                    recommended_action: {
                      type: "string",
                      enum: ["regenerate-slice", "regenerate-reference", "regenerate-prompt", "log-only"],
                    },
                  },
                  required: ["category", "severity", "description", "recommended_action"],
                  additionalProperties: false,
                },
              },
            },
            required: ["scores", "issues"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty LLM response");
    }

    const parsed = JSON.parse(content as string);
    const durationMs = Date.now() - start;

    // Compute overall score (weighted average)
    const overallScore = computeOverallScore(parsed.scores);

    // Determine pass/fail
    const passed = overallScore >= passThreshold;

    // Determine routing decision
    const routingDecision = determineRouting(passed, parsed.issues, attempt);

    // Estimate cost (3 images × $0.003 + text ~$0.03)
    const estimatedCost = Math.min(keyframeUrls.length * 0.003 + 0.03, budgetCapUsd);

    return {
      sliceId: slice.sliceId,
      attempt,
      passed,
      scores: parsed.scores,
      overallScore,
      issues: parsed.issues,
      routingDecision,
      costUsd: estimatedCost,
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`[D5.5] Error reviewing slice ${slice.sliceId}: ${err.message?.slice(0, 200)}`);

    // On failure, pass the clip (fail-safe: don't block pipeline on reviewer errors)
    return {
      sliceId: slice.sliceId,
      attempt,
      passed: true,
      scores: { character_consistency: 0, style: 0, prompt_alignment: 0, motion_quality: 0 },
      overallScore: 0,
      issues: [],
      routingDecision: "pass",
      costUsd: 0,
      durationMs,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeOverallScore(scores: D5_5ReviewResult["scores"]): number {
  const weighted =
    scores.character_consistency * SCORE_WEIGHTS.character_consistency +
    scores.style * SCORE_WEIGHTS.style +
    scores.prompt_alignment * SCORE_WEIGHTS.prompt_alignment +
    scores.motion_quality * SCORE_WEIGHTS.motion_quality;

  // Round to nearest integer (1-5 scale)
  return Math.round(weighted);
}

function determineRouting(
  passed: boolean,
  issues: D5SliceIssue[],
  attempt: number
): RoutingDecision {
  if (passed) return "pass";

  // If we've exhausted retries, escalate
  if (attempt >= MAX_D5_5_RETRIES_PER_CLIP) return "escalate";

  // Find the most severe issue and route based on its recommended action
  const criticalIssues = issues.filter((i) => i.severity === "critical");
  const majorIssues = issues.filter((i) => i.severity === "major");
  const topIssue = criticalIssues[0] || majorIssues[0] || issues[0];

  if (!topIssue) return "retry_video"; // Default: retry the video generation

  switch (topIssue.recommended_action) {
    case "regenerate-reference":
      return "retry_reference";
    case "regenerate-prompt":
      return "retry_prompt";
    case "regenerate-slice":
      return "retry_video";
    case "log-only":
      // Log-only issues shouldn't trigger retry — pass through
      return "pass";
    default:
      return "retry_video";
  }
}

// ─── Batch Review (all slices in an episode) ────────────────────────────────

export interface BatchD5_5Options {
  episodeId: number;
  projectId: number;
  slices: Array<D5_5ReviewOptions["slice"] & {
    clipUrl: string;
    keyframeUrls: string[];
    currentAttempt: number;
  }>;
  characterBibles: Record<string, any>;
  styleLock: D5_5ReviewOptions["styleLock"];
  passThreshold?: number;
  /** Run reviews in parallel (default: true) */
  parallel?: boolean;
}

export interface BatchD5_5Result {
  episodeId: number;
  projectId: number;
  totalSlices: number;
  passedSlices: number;
  failedSlices: number;
  escalatedSlices: number;
  reviews: D5_5ReviewResult[];
  totalCostUsd: number;
  totalDurationMs: number;
}

export async function runBatchD5_5Review(options: BatchD5_5Options): Promise<BatchD5_5Result> {
  const start = Date.now();
  const {
    episodeId,
    projectId,
    slices,
    characterBibles,
    styleLock,
    passThreshold = DEFAULT_PASS_THRESHOLD,
    parallel = true,
  } = options;

  console.log(`[D5.5] Reviewing ${slices.length} clips for episode ${episodeId}...`);

  let reviews: D5_5ReviewResult[];

  if (parallel) {
    // Run all reviews in parallel (faster, higher cost burst)
    reviews = await Promise.all(
      slices.map((slice) =>
        runD5_5PerClipReview({
          clipUrl: slice.clipUrl,
          slice: {
            sliceId: slice.sliceId,
            intent: slice.intent,
            emotion: slice.emotion,
            isDialogue: slice.isDialogue,
            cameraAngle: slice.cameraAngle,
            characters: slice.characters,
          },
          characterBibles,
          styleLock,
          keyframeUrls: slice.keyframeUrls,
          attempt: slice.currentAttempt,
          passThreshold,
        })
      )
    );
  } else {
    // Sequential (lower burst, better for rate-limited scenarios)
    reviews = [];
    for (const slice of slices) {
      const review = await runD5_5PerClipReview({
        clipUrl: slice.clipUrl,
        slice: {
          sliceId: slice.sliceId,
          intent: slice.intent,
          emotion: slice.emotion,
          isDialogue: slice.isDialogue,
          cameraAngle: slice.cameraAngle,
          characters: slice.characters,
        },
        characterBibles,
        styleLock,
        keyframeUrls: slice.keyframeUrls,
        attempt: slice.currentAttempt,
        passThreshold,
      });
      reviews.push(review);
    }
  }

  const totalDurationMs = Date.now() - start;
  const passedSlices = reviews.filter((r) => r.passed).length;
  const failedSlices = reviews.filter((r) => !r.passed && r.routingDecision !== "escalate").length;
  const escalatedSlices = reviews.filter((r) => r.routingDecision === "escalate").length;
  const totalCostUsd = reviews.reduce((sum, r) => sum + r.costUsd, 0);

  console.log(`[D5.5] Complete: ${passedSlices}/${slices.length} passed, ${failedSlices} need retry, ${escalatedSlices} escalated`);
  console.log(`[D5.5] Cost: $${totalCostUsd.toFixed(3)}, Duration: ${(totalDurationMs / 1000).toFixed(1)}s`);

  return {
    episodeId,
    projectId,
    totalSlices: slices.length,
    passedSlices,
    failedSlices,
    escalatedSlices,
    reviews,
    totalCostUsd,
    totalDurationMs,
  };
}
