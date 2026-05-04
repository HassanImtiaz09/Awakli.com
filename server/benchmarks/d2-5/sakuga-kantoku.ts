/**
 * D2.5 Sakuga Kantoku (Animation Director)
 *
 * MVP scope: Single Opus pass over the full approved genga set.
 * Outputs a structured punch list of inconsistencies.
 * No auto-fix, no iterative multi-round — flags issues for human review.
 *
 * Reviews:
 *   - Character scale consistency across panels
 *   - Perspective continuity between sequential frames
 *   - Motion arc logic (character movement trajectories)
 *   - Color consistency against locked palette
 *
 * Cost: ~$0.30-0.50/episode (single LLM call)
 */
import { getDb } from "../../db";
import { sakugaReviews } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { invokeLLM } from "../../_core/llm";
import { serverLog } from "../../observability/logger";

// ─── Types ──────────────────────────────────────────────────────────────
export type IssueSeverity = "critical" | "warning" | "info";
export type IssueType =
  | "character_scale_drift"
  | "perspective_break"
  | "motion_arc_violation"
  | "color_inconsistency"
  | "pose_continuity"
  | "depth_layer_error"
  | "framing_mismatch"
  | "general";

export interface PunchListItem {
  type: IssueType;
  severity: IssueSeverity;
  sceneNumber: number;
  panelNumber: number;
  description: string;
  affectedCharacters: string[];
  suggestion: string;
  referencePanel?: number; // The panel this is inconsistent with
}

export interface ReviewScores {
  overall: number;                  // 0-100
  characterConsistency: number;     // 0-100
  perspective: number;              // 0-100
  motionArc: number;                // 0-100
  colorConsistency: number;         // 0-100
}

export interface ReviewInput {
  projectId: number;
  episodeId: number;
  userId: number;
  reviewType?: "full_episode" | "scene" | "panel_range";
  sceneNumber?: number;
  panelRange?: { start: number; end: number };
  // Genga data to review
  keyframes: Array<{
    sceneNumber: number;
    panelNumber: number;
    roughGengaUrl?: string;
    cleanGengaUrl?: string;
    cameraAngle?: string;
    characterPlacements?: any[];
  }>;
  // Context
  characters: Array<{
    name: string;
    visualTraits?: any;
  }>;
  colorScript?: {
    characterPalettes?: any[];
    scenePalettes?: any[];
  };
}

// ─── Run Review ─────────────────────────────────────────────────────────
export async function runSakugaReview(input: ReviewInput): Promise<{
  reviewId: number;
  punchList: PunchListItem[];
  scores: ReviewScores;
  totalCost: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  serverLog.info("[D2.5] Starting Sakuga Kantoku review", {
    projectId: input.projectId,
    episodeId: input.episodeId,
    keyframeCount: input.keyframes.length,
    reviewType: input.reviewType || "full_episode",
  });

  // Build review prompt with all keyframe data
  const { punchList, scores } = await performReview(input);

  // Count severities
  const criticalCount = punchList.filter(i => i.severity === "critical").length;
  const warningCount = punchList.filter(i => i.severity === "warning").length;
  const infoCount = punchList.filter(i => i.severity === "info").length;

  const estimatedCost = 0.40; // Single Opus call for full episode

  // Insert review record
  const [insertResult] = await db.insert(sakugaReviews).values({
    projectId: input.projectId,
    episodeId: input.episodeId,
    reviewType: input.reviewType || "full_episode",
    sceneNumber: input.sceneNumber || null,
    panelRange: input.panelRange || null,
    punchList,
    issueCount: punchList.length,
    criticalCount,
    warningCount,
    infoCount,
    overallScore: String(scores.overall),
    characterConsistencyScore: String(scores.characterConsistency),
    perspectiveScore: String(scores.perspective),
    motionArcScore: String(scores.motionArc),
    colorConsistencyScore: String(scores.colorConsistency),
    generationCostUsd: String(estimatedCost),
    status: "completed",
  });

  const reviewId = (insertResult as any).insertId;

  serverLog.info("[D2.5] Sakuga review complete", {
    reviewId,
    issueCount: punchList.length,
    criticalCount,
    warningCount,
    overallScore: scores.overall,
    cost: estimatedCost,
  });

  return { reviewId, punchList, scores, totalCost: estimatedCost };
}

// ─── LLM Review Pass ────────────────────────────────────────────────────
async function performReview(input: ReviewInput): Promise<{
  punchList: PunchListItem[];
  scores: ReviewScores;
}> {
  const keyframeDescriptions = input.keyframes.map(kf => {
    const chars = (kf.characterPlacements || []).map((cp: any) =>
      `${cp.characterName || "unknown"} at (${cp.x}, ${cp.y}) scale=${cp.scale} facing=${cp.facing}`
    ).join("; ");
    return `Scene ${kf.sceneNumber}, Panel ${kf.panelNumber}: camera=${kf.cameraAngle || "medium"}, characters=[${chars}]${kf.roughGengaUrl ? " [has rough genga]" : ""}${kf.cleanGengaUrl ? " [has clean genga]" : ""}`;
  }).join("\n");

  const characterList = input.characters.map(c => `- ${c.name}`).join("\n");

  const prompt = `You are a Sakuga Kantoku (Animation Director) reviewing a set of genga keyframes for consistency.

EPISODE KEYFRAMES (${input.keyframes.length} panels):
${keyframeDescriptions}

CHARACTERS:
${characterList}

${input.colorScript ? "COLOR SCRIPT: Available for reference." : "No color script provided."}

Review ALL keyframes for:
1. CHARACTER SCALE DRIFT: Are characters consistently sized relative to each other and the environment across panels?
2. PERSPECTIVE BREAKS: Do camera angles and vanishing points maintain logical continuity between sequential panels?
3. MOTION ARC VIOLATIONS: Do character movements follow natural trajectories? Are poses between panels physically plausible?
4. COLOR CONSISTENCY: Do character colors and scene lighting stay consistent with the established palette?
5. POSE CONTINUITY: Between sequential panels, do character poses transition naturally?
6. DEPTH LAYER ERRORS: Are foreground/midground/background elements consistently layered?
7. FRAMING MISMATCHES: Do camera angles serve the narrative intent of each panel?

For each issue found, provide:
- type: one of [character_scale_drift, perspective_break, motion_arc_violation, color_inconsistency, pose_continuity, depth_layer_error, framing_mismatch, general]
- severity: critical (breaks immersion), warning (noticeable but not breaking), info (minor suggestion)
- sceneNumber and panelNumber where the issue occurs
- description of the issue
- affectedCharacters: names of characters involved
- suggestion: how to fix it
- referencePanel: the panel number this is inconsistent with (if applicable)

Also provide overall scores (0-100) for each category.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are an expert Sakuga Kantoku. Output valid JSON only. Be thorough but fair — only flag genuine issues." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sakuga_review",
        strict: true,
        schema: {
          type: "object",
          properties: {
            punchList: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  severity: { type: "string" },
                  sceneNumber: { type: "integer" },
                  panelNumber: { type: "integer" },
                  description: { type: "string" },
                  affectedCharacters: { type: "array", items: { type: "string" } },
                  suggestion: { type: "string" },
                  referencePanel: { type: "integer" },
                },
                required: ["type", "severity", "sceneNumber", "panelNumber", "description", "affectedCharacters", "suggestion", "referencePanel"],
                additionalProperties: false,
              },
            },
            scores: {
              type: "object",
              properties: {
                overall: { type: "number" },
                characterConsistency: { type: "number" },
                perspective: { type: "number" },
                motionArc: { type: "number" },
                colorConsistency: { type: "number" },
              },
              required: ["overall", "characterConsistency", "perspective", "motionArc", "colorConsistency"],
              additionalProperties: false,
            },
          },
          required: ["punchList", "scores"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

  // Validate and normalize
  const punchList: PunchListItem[] = (parsed.punchList || []).map((item: any) => ({
    type: validateIssueType(item.type),
    severity: validateSeverity(item.severity),
    sceneNumber: item.sceneNumber || 0,
    panelNumber: item.panelNumber || 0,
    description: item.description || "",
    affectedCharacters: item.affectedCharacters || [],
    suggestion: item.suggestion || "",
    referencePanel: item.referencePanel || undefined,
  }));

  const scores: ReviewScores = {
    overall: clampScore(parsed.scores?.overall),
    characterConsistency: clampScore(parsed.scores?.characterConsistency),
    perspective: clampScore(parsed.scores?.perspective),
    motionArc: clampScore(parsed.scores?.motionArc),
    colorConsistency: clampScore(parsed.scores?.colorConsistency),
  };

  return { punchList, scores };
}

// ─── Query Helpers ──────────────────────────────────────────────────────
export async function getReviewById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sakugaReviews).where(eq(sakugaReviews.id, id)).limit(1);
  return rows[0] || null;
}

export async function getReviewsByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sakugaReviews)
    .where(eq(sakugaReviews.episodeId, episodeId))
    .orderBy(desc(sakugaReviews.createdAt));
}

export async function getLatestReview(episodeId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sakugaReviews)
    .where(eq(sakugaReviews.episodeId, episodeId))
    .orderBy(desc(sakugaReviews.createdAt))
    .limit(1);
  return rows[0] || null;
}

export async function getReviewsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sakugaReviews)
    .where(eq(sakugaReviews.projectId, projectId))
    .orderBy(desc(sakugaReviews.createdAt));
}

export async function acknowledgeReview(reviewId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const review = await getReviewById(reviewId);
  if (!review || review.status !== "completed") return false;
  await db.update(sakugaReviews).set({
    status: "acknowledged",
    acknowledgedAt: new Date(),
    acknowledgedBy: userId,
  }).where(eq(sakugaReviews.id, reviewId));
  return true;
}

// ─── Validation Helpers ─────────────────────────────────────────────────
const VALID_ISSUE_TYPES: IssueType[] = [
  "character_scale_drift", "perspective_break", "motion_arc_violation",
  "color_inconsistency", "pose_continuity", "depth_layer_error",
  "framing_mismatch", "general",
];

function validateIssueType(type: string): IssueType {
  if (VALID_ISSUE_TYPES.includes(type as IssueType)) return type as IssueType;
  return "general";
}

function validateSeverity(severity: string): IssueSeverity {
  if (["critical", "warning", "info"].includes(severity)) return severity as IssueSeverity;
  return "info";
}

function clampScore(score: any): number {
  const n = Number(score);
  if (isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
