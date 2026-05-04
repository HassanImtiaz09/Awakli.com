/**
 * D10 Craft Library — Shared Types
 *
 * Three sub-senseis, three engagement modes, and the core query/result shapes.
 * All pipeline stages can import these types to interact with the Craft Library.
 */

// ─── Sub-Sensei Classification ──────────────────────────────────────────

/** The three knowledge domains of the Craft Library */
export type SubSensei = "anime" | "manga" | "genga";

/** Human-readable labels for each sub-sensei */
export const SUB_SENSEI_LABELS: Record<SubSensei, string> = {
  anime: "D10.A — Anime Production",
  manga: "D10.M — Manga Craft",
  genga: "D10.G — Genga & Key Animation",
};

/**
 * Maps pipeline stages to their primary sub-sensei.
 * A stage may consult multiple sub-senseis, but has one primary.
 */
export const STAGE_SUB_SENSEI_MAP: Record<string, SubSensei> = {
  // Manga stages
  "storyboard": "manga",
  "panel_layout": "manga",
  "manga_render": "manga",
  "color_script": "manga",
  // Genga stages
  "genga_keyframes": "genga",
  "sakuga_review": "genga",
  "motion_lora": "genga",
  "in_between": "genga",
  // Anime stages
  "video_generation": "anime",
  "voice_direction": "anime",
  "assembly": "anime",
  "post_production": "anime",
  "lip_sync": "anime",
};

// ─── Engagement Modes ───────────────────────────────────────────────────

/**
 * How the D10 agent interacts with the pipeline:
 *
 * - **direct**: Pipeline stage asks a question, D10 retrieves and synthesises an answer.
 *   Example: "What camera angles work best for shonen fight scenes?"
 *
 * - **consult**: D10 proactively reviews a pipeline artifact and suggests improvements.
 *   Example: D10.G reviews genga keyframes and suggests timing adjustments.
 *
 * - **validate**: D10 checks an artifact against craft principles and returns pass/fail.
 *   Example: D10.M validates panel flow against manga pacing rules.
 */
export type EngagementMode = "direct" | "consult" | "validate";

// ─── Source Types ───────────────────────────────────────────────────────

export type SourceType =
  | "web_article"
  | "book_chapter"
  | "video_transcript"
  | "tutorial"
  | "interview"
  | "podcast_transcript"
  | "reference_image_set";

export type SourceStatus = "pending" | "ingesting" | "ingested" | "failed" | "archived";

// ─── Query & Result Shapes ──────────────────────────────────────────────

/** Input to the D10 retrieval + synthesis pipeline */
export interface CraftQuery {
  /** The question or artifact description */
  query: string;
  /** Primary sub-sensei to search (required) */
  subSensei: SubSensei;
  /** Engagement mode determines how the answer is framed */
  mode: EngagementMode;
  /** Optional: also search cross-tagged chunks from other sub-senseis */
  includeCrossTags?: boolean;
  /** Optional: pipeline stage context for more relevant retrieval */
  pipelineStage?: string;
  /** Optional: max chunks to retrieve (default 5) */
  topK?: number;
  /** Optional: artifact URL/data for consult/validate modes */
  artifactContext?: string;
}

/** A single retrieved chunk with attribution */
export interface RetrievedChunk {
  chunkId: number;
  sourceId: number;
  sourceTitle: string;
  sourceAuthor: string | null;
  sourceType: SourceType;
  subSensei: SubSensei;
  text: string;
  chunkIndex: number;
  /** Relevance score from retrieval (0-1, higher = more relevant) */
  relevanceScore: number;
  /** Page/chapter/timestamp metadata for attribution */
  metadata: Record<string, unknown> | null;
}

/** Output from the D10 synthesis pipeline */
export interface CraftResult {
  /** The synthesised guidance (never verbatim — always paraphrased) */
  guidance: string;
  /** Engagement mode used */
  mode: EngagementMode;
  /** Sub-sensei that provided the answer */
  subSensei: SubSensei;
  /** Source chunks used (for attribution and audit) */
  sources: RetrievedChunk[];
  /** For validate mode: pass/fail verdict */
  verdict?: "pass" | "needs_revision" | "fail";
  /** For validate mode: specific issues found */
  issues?: string[];
  /** For consult mode: suggested improvements */
  suggestions?: string[];
  /** Cost of the LLM synthesis call */
  costUsd: number;
  /** Duration of the full retrieval + synthesis pipeline */
  durationMs: number;
}

// ─── Verbatim Guard ─────────────────────────────────────────────────────

/** Configuration for the 15-gram verbatim detection */
export interface VerbatimGuardConfig {
  /** N-gram size for overlap detection (default: 15) */
  ngramSize: number;
  /** Maximum allowed overlap ratio before flagging (default: 0.25 = 25%) */
  maxOverlapRatio: number;
}

export const DEFAULT_VERBATIM_CONFIG: VerbatimGuardConfig = {
  ngramSize: 15,
  maxOverlapRatio: 0.25,
};

// ─── Convenience Arrays ────────────────────────────────────────────────

/** All sub-sensei values as a tuple for iteration and validation */
export const SUB_SENSEIS: SubSensei[] = ["anime", "manga", "genga"];

/** All engagement mode values as a tuple for iteration and validation */
export const ENGAGEMENT_MODES: EngagementMode[] = ["direct", "consult", "validate"];

// ─── Activation Stages (inverse of STAGE_SUB_SENSEI_MAP) ───────────────

/**
 * Maps each sub-sensei to the pipeline stages it activates at.
 * Derived from STAGE_SUB_SENSEI_MAP for convenience.
 */
export const ACTIVATION_STAGES: Record<SubSensei, string[]> = SUB_SENSEIS.reduce(
  (acc, sensei) => {
    acc[sensei] = Object.entries(STAGE_SUB_SENSEI_MAP)
      .filter(([, s]) => s === sensei)
      .map(([stage]) => stage);
    return acc;
  },
  {} as Record<SubSensei, string[]>,
);

// ─── Cross-Tag Broadening Rules ────────────────────────────────────────

/**
 * When a query targets one sub-sensei, cross-tag rules define which
 * other sub-senseis may have relevant supplementary knowledge.
 *
 * Example: a genga query about "fight scene timing" may also benefit
 * from anime sub-sensei knowledge about camera cuts and pacing.
 */
export const CROSS_TAG_RULES: Record<SubSensei, SubSensei[]> = {
  anime: ["genga"],         // anime production benefits from genga motion knowledge
  manga: ["genga"],         // manga paneling benefits from genga pose knowledge
  genga: ["anime", "manga"], // genga benefits from both anime timing and manga composition
};

// ─── Library Stats ──────────────────────────────────────────────────────

export interface LibraryStats {
  totalSources: number;
  totalChunks: number;
  totalTokens: number;
  bySubSensei: Record<SubSensei, {
    sources: number;
    chunks: number;
    tokens: number;
  }>;
  byStatus: Record<SourceStatus, number>;
  bySourceType: Record<SourceType, number>;
}
