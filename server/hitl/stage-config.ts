/**
 * HITL Stage Configuration (v1.9 Pipeline Blueprint)
 *
 * Defines the 17-stage pipeline aligned with Blueprint Section 4.
 * Gate configs are loaded from the database (gate_configs table) but these
 * constants provide the canonical stage definitions.
 *
 * Key design decisions:
 * - D2 (Prompt Engineer) and D3 (Quality Critic) are subsumed into per-agent
 *   helpers / self-critics, not pipeline stages.
 * - D10 (Craft Sensei) is NOT a pipeline stage — it's a retrieval service
 *   consulted across multiple D-agents at their respective stages.
 * - D7 = FX Compositor, D8 = Voice Director Critic, D9 = Sakufuu Tracker.
 * - Music and SFX are produced by infrastructure within X-Sheet / Ato-Fuki /
 *   FX Pass / Mastering stages — no own D-designations.
 * - Branch stages (5.5, 7.5) are NOT in the main pipeline numbering.
 *   They are triggered by user action after their parent stage approval.
 * - 'Publish to catalog' is a user-triggered action AFTER mastering_harness
 *   (Stage 16), not a pipeline stage.
 */

// ─── Stage Definitions ──────────────────────────────────────────────────

export const TOTAL_STAGES = 17;

/**
 * Canonical stage keys indexed by stage number.
 * These are the internal identifiers used in DB, orchestrator, and D-agent hooks.
 */
export const STAGE_NAMES: Record<number, string> = {
  1: "script",
  2: "anime_type",
  3: "character_design",
  4: "color_script",
  5: "ekonte",
  6: "layout",
  7: "genga",
  8: "sakuga_kantoku_review",
  9: "sakuga_tagging",
  10: "video_generation",
  11: "per_clip_continuity",
  12: "x_sheet",
  13: "ato_fuki",
  14: "fx_pass",
  15: "satsuei",
  16: "mastering_harness",
  17: "continual_learning",
};

/**
 * Human-readable display names with Japanese terminology.
 */
export const STAGE_DISPLAY_NAMES: Record<number, string> = {
  1: "Script (脚本)",
  2: "Anime Type Selection",
  3: "Character Design (キャラクターデザイン)",
  4: "Color Script (色彩設計)",
  5: "Storyboard / Ekonte (絵コンテ)",
  6: "Layout (レイアウト)",
  7: "Key Animation / Genga (原画)",
  8: "Sakuga Kantoku Review (作画監督)",
  9: "Sakuga Tagging (作画指定)",
  10: "In-Betweening / Douga (動画)",
  11: "Per-Clip Continuity Check",
  12: "Timing Chart / X-Sheet (タイムシート)",
  13: "Post-Recording / Ato-Fuki (アフレコ)",
  14: "FX Pass (特殊効果)",
  15: "Final Compositing / Satsuei (撮影)",
  16: "Mastering & Hybrid Harness",
  17: "Continual Learning (LoRA + Sakufuu)",
};

// ─── Branch Sub-Stages ──────────────────────────────────────────────────

/**
 * Branch stages are NOT in the main pipeline numbering.
 * They are triggered by explicit user action after parent stage approval.
 * Represented as fractional numbers for ordering clarity.
 */
export const BRANCH_STAGES = {
  manga_finishing: {
    key: "manga_finishing",
    displayName: "Manga Finishing (漫画仕上げ)",
    parentStage: 5,
    fractionalNumber: 5.5,
    gateType: "blocking" as const,
    owningAgent: "D10.M",
    triggerCondition: "User selects 'publish as manga' after ekonte approval",
  },
  genga_finishing: {
    key: "genga_finishing",
    displayName: "Genga Finishing (原画仕上げ)",
    parentStage: 7,
    fractionalNumber: 7.5,
    gateType: "blocking" as const,
    owningAgent: "D10.G",
    triggerCondition: "User selects 'publish as collector-edition genga' after genga approval (Pro+ tier only)",
    tierRequirement: "creator_pro",
  },
} as const;

// ─── Gate Types ─────────────────────────────────────────────────────────

export type GateType = "blocking" | "advisory" | "ambient";

export type GateDecision =
  | "pending"
  | "approved"
  | "rejected"
  | "regenerate"
  | "regenerate_with_edits"
  | "auto_approved"
  | "auto_rejected"
  | "escalated"
  | "timed_out";

export type DecisionSource = "creator" | "auto" | "escalation" | "timeout";

export type StageStatus =
  | "pending"
  | "executing"
  | "awaiting_gate"
  | "approved"
  | "rejected"
  | "regenerating"
  | "skipped"
  | "failed"
  | "timed_out";

export type PipelineRunStatus = "active" | "paused" | "completed" | "aborted" | "failed";

// ─── Default Gate Assignments (fallback if DB has no config) ────────────

export interface StageGateDefault {
  stageNumber: number;
  stageName: string;
  gateType: GateType;
  autoAdvanceThreshold: number;
  reviewThreshold: number;
  timeoutHours: number;
  timeoutAction: "auto_approve" | "auto_reject" | "auto_pause";
  isLocked: boolean;
  owningAgent: string;
  /** If true, orchestrator must execute this stage even if gate is advisory */
  requiredTraversal: boolean;
}

/**
 * v1.9 gate assignments per Blueprint Section 4.
 *
 * Key semantics:
 * - "blocking" = pipeline halts until user approves
 * - "advisory" = auto-advances after execution, but user can retroactively reject
 * - "ambient" = auto-advances silently, user sees in batch review only
 * - requiredTraversal = orchestrator MUST execute this stage (cannot skip),
 *   even if gate type is advisory (e.g., sakuga_tagging feeds video_generation)
 */
export const DEFAULT_GATE_ASSIGNMENTS: StageGateDefault[] = [
  // Stage 1: Script — D1 generates draft, user edits and approves
  { stageNumber: 1,  stageName: "script",                  gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 48, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D1", requiredTraversal: true },
  // Stage 2: Anime Type — user selects, D9 provides default-bias for episodes 2+
  { stageNumber: 2,  stageName: "anime_type",              gateType: "blocking", autoAdvanceThreshold: 90, reviewThreshold: 70, timeoutHours: 48, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "user+D9", requiredTraversal: true },
  // Stage 3: Character Design — D0 two-pass + CLIP validation
  { stageNumber: 3,  stageName: "character_design",        gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D0", requiredTraversal: true },
  // Stage 4: Color Script — D6 Color Director
  { stageNumber: 4,  stageName: "color_script",            gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D6", requiredTraversal: true },
  // Stage 5: Ekonte — D1 storyboard with effect tags
  { stageNumber: 5,  stageName: "ekonte",                  gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D1", requiredTraversal: true },
  // Stage 6: Layout — D1.25 Layout Director
  { stageNumber: 6,  stageName: "layout",                  gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D1.25", requiredTraversal: true },
  // Stage 7: Genga — D1.5 Genga Director (two-pass keyframes)
  { stageNumber: 7,  stageName: "genga",                   gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D1.5", requiredTraversal: true },
  // Stage 8: Sakuga Kantoku Review — D2.5 single Opus pass, advisory but required
  { stageNumber: 8,  stageName: "sakuga_kantoku_review",   gateType: "advisory", autoAdvanceThreshold: 70, reviewThreshold: 50, timeoutHours: 24, timeoutAction: "auto_approve", isLocked: false, owningAgent: "D2.5", requiredTraversal: true },
  // Stage 9: Sakuga Tagging — user marks shots as standard/sakuga, advisory but REQUIRED TRAVERSAL before Stage 10
  { stageNumber: 9,  stageName: "sakuga_tagging",          gateType: "advisory", autoAdvanceThreshold: 70, reviewThreshold: 50, timeoutHours: 24, timeoutAction: "auto_approve", isLocked: false, owningAgent: "user+D1", requiredTraversal: true },
  // Stage 10: Video Generation / In-Betweening — per-clip router
  { stageNumber: 10, stageName: "video_generation",        gateType: "advisory", autoAdvanceThreshold: 80, reviewThreshold: 55, timeoutHours: 24, timeoutAction: "auto_approve", isLocked: false, owningAgent: "per-clip", requiredTraversal: true },
  // Stage 11: Per-Clip Continuity — D5.5 (pre-assembly, not post-subtitles)
  { stageNumber: 11, stageName: "per_clip_continuity",     gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D5.5", requiredTraversal: true },
  // Stage 12: X-Sheet — D4 timing chart (subsumes legacy music_scoring + sfx_foley)
  { stageNumber: 12, stageName: "x_sheet",                 gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "D4+user", requiredTraversal: true },
  // Stage 13: Ato-Fuki — D4 + lip-sync provider (renamed from voice_synthesis)
  { stageNumber: 13, stageName: "ato_fuki",                gateType: "advisory", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_approve", isLocked: false, owningAgent: "D4+lip-sync", requiredTraversal: true },
  // Stage 14: FX Pass — D7 FX Compositor (genre-aware effects)
  { stageNumber: 14, stageName: "fx_pass",                 gateType: "advisory", autoAdvanceThreshold: 75, reviewThreshold: 50, timeoutHours: 24, timeoutAction: "auto_approve", isLocked: false, owningAgent: "D7", requiredTraversal: true },
  // Stage 15: Satsuei — final compositing (renamed from video_composite)
  { stageNumber: 15, stageName: "satsuei",                 gateType: "blocking", autoAdvanceThreshold: 85, reviewThreshold: 60, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: false, owningAgent: "assembly", requiredTraversal: true },
  // Stage 16: Mastering & Hybrid Harness — H1 + D5 + H2 + Regen Executor
  { stageNumber: 16, stageName: "mastering_harness",       gateType: "blocking", autoAdvanceThreshold: 90, reviewThreshold: 70, timeoutHours: 24, timeoutAction: "auto_pause",   isLocked: true,  owningAgent: "H1+D5+H2", requiredTraversal: true },
  // Stage 17: Continual Learning — D9 + LoRA training (ambient, post-episode)
  { stageNumber: 17, stageName: "continual_learning",      gateType: "ambient",  autoAdvanceThreshold: 70, reviewThreshold: 40, timeoutHours: 72, timeoutAction: "auto_approve", isLocked: false, owningAgent: "D9+LoRA", requiredTraversal: false },
];

// ─── D-Agent Designations (v1.9 Section 7B) ────────────────────────────

/**
 * Canonical D-agent designations per Blueprint Section 7B.
 * D2 (Prompt Engineer) and D3 (Quality Critic) are subsumed into per-agent
 * helpers / self-critics — they are NOT pipeline stage owners.
 */
export const D_AGENT_DESIGNATIONS = {
  D0: { name: "Character Designer", stages: [3], mode: "owner" },
  D1: { name: "Script/Ekonte Director", stages: [1, 5], mode: "owner" },
  "D1.25": { name: "Layout Director", stages: [6], mode: "owner" },
  "D1.5": { name: "Genga Director", stages: [7], mode: "owner" },
  D2: { name: "Prompt Engineer", stages: [], mode: "helper (subsumed)" },
  "D2.5": { name: "Sakuga Kantoku", stages: [8], mode: "owner" },
  D3: { name: "Quality Critic", stages: [], mode: "helper (subsumed)" },
  D4: { name: "Timing Director", stages: [12, 13], mode: "owner" },
  D5: { name: "Mastering Critic", stages: [16], mode: "participant" },
  "D5.5": { name: "Continuity Checker", stages: [11], mode: "owner" },
  D6: { name: "Color Director", stages: [4], mode: "owner" },
  D7: { name: "FX Compositor", stages: [14], mode: "owner" },
  D8: { name: "Voice Director Critic", stages: [13], mode: "critic (within ato_fuki)" },
  D9: { name: "Sakufuu Tracker", stages: [2, 17], mode: "advisory + owner(17)" },
  D10: { name: "Craft Sensei Constellation", stages: [], mode: "retrieval service (NOT a pipeline stage)" },
} as const;

/**
 * D10 plug-in points — stages where D10 is consulted (NOT owned).
 * D10 operates in three modes: Direct, Consult, Validate.
 */
export const D10_PLUGIN_POINTS: Record<number, { subSensei: string; mode: string }[]> = {
  1: [{ subSensei: "D10.A", mode: "consult" }],
  5: [{ subSensei: "D10.A", mode: "consult" }, { subSensei: "D10.M", mode: "direct" }],
  7: [{ subSensei: "D10.G", mode: "direct" }],
  8: [{ subSensei: "D10.A", mode: "consult" }, { subSensei: "D10.G", mode: "consult" }],
  14: [{ subSensei: "D10.A", mode: "consult" }],
  17: [{ subSensei: "D10.A", mode: "consult" }],
};

// ─── Legacy Stage Deprecation Map ───────────────────────────────────────

/**
 * Documents the mapping from legacy 12-stage names to v1.9 stages.
 * Used for migration tooling and audit trails only.
 */
export const LEGACY_STAGE_MIGRATION: Record<string, { action: string; v19Stage?: string; v19Number?: number }> = {
  manga_analysis: { action: "deprecated", v19Stage: "script", v19Number: 1 },
  scene_planning: { action: "renamed", v19Stage: "ekonte", v19Number: 5 },
  character_sheet_gen: { action: "renamed", v19Stage: "character_design", v19Number: 3 },
  keyframe_generation: { action: "renamed", v19Stage: "genga", v19Number: 7 },
  video_generation: { action: "preserved", v19Stage: "video_generation", v19Number: 10 },
  voice_synthesis: { action: "renamed", v19Stage: "ato_fuki", v19Number: 13 },
  music_scoring: { action: "subsumed", v19Stage: "x_sheet", v19Number: 12 },
  sfx_foley: { action: "subsumed", v19Stage: "x_sheet", v19Number: 12 },
  audio_mix: { action: "subsumed", v19Stage: "mastering_harness", v19Number: 16 },
  video_composite: { action: "renamed", v19Stage: "satsuei", v19Number: 15 },
  subtitle_render: { action: "subsumed", v19Stage: "mastering_harness", v19Number: 16 },
  episode_publish: { action: "subsumed", v19Stage: "mastering_harness", v19Number: 16 },
};

// ─── Tier Names ─────────────────────────────────────────────────────────

export const TIER_NAMES = ["free_trial", "creator", "creator_pro", "studio", "enterprise"] as const;
export type TierName = typeof TIER_NAMES[number];

// ─── Credit Cost Estimates per Stage (in credits) ───────────────────────

export const STAGE_CREDIT_ESTIMATES: Record<number, number> = {
  1: 2,     // script — LLM generation + editing
  2: 0,     // anime_type — user selection (D9 advisory is negligible)
  3: 15,    // character_design — D0 two-pass image gen (4 views × ~$0.10)
  4: 3,     // color_script — D6 LLM palette generation
  5: 5,     // ekonte — D1 storyboard (LLM + optional sketch gen)
  6: 10,    // layout — D1.25 composition sketches (~$0.05/panel × 19)
  7: 20,    // genga — D1.5 keyframe generation (50-75 images)
  8: 2,     // sakuga_kantoku_review — D2.5 single Opus pass
  9: 0,     // sakuga_tagging — user action (D1 suggestion is negligible)
  10: 40,   // video_generation — expensive per-clip generation
  11: 5,    // per_clip_continuity — D5.5 CLIP checks + Opus
  12: 3,    // x_sheet — D4 timing chart (LLM-based)
  13: 10,   // ato_fuki — TTS + lip-sync generation
  14: 8,    // fx_pass — D7 effect generation/overlay
  15: 5,    // satsuei — compositing (mostly compute, not generation)
  16: 3,    // mastering_harness — audio mastering + checks
  17: 0,    // continual_learning — background LoRA training (billed separately)
};

// ─── Required Traversal Check ───────────────────────────────────────────

/**
 * Returns true if the given stage must be executed (cannot be skipped)
 * regardless of gate type. This is critical for advisory stages like
 * sakuga_tagging (Stage 9) whose output feeds downstream stages.
 */
export function isRequiredTraversal(stageNumber: number): boolean {
  const config = DEFAULT_GATE_ASSIGNMENTS.find(g => g.stageNumber === stageNumber);
  return config?.requiredTraversal ?? true;
}

// ─── Skippable Stages ───────────────────────────────────────────────────

/**
 * Only ambient gates that are NOT required traversal can be skipped.
 * In v1.9, only Stage 17 (continual_learning) is truly skippable.
 */
export function isStageSkippable(stageNumber: number, gateType: GateType): boolean {
  if (isRequiredTraversal(stageNumber)) return false;
  return gateType === "ambient";
}

// ─── Confidence Score Thresholds ────────────────────────────────────────

export const AMBIENT_ESCALATION_THRESHOLD = 20;
export const AMBIENT_PATTERN_DEGRADATION_THRESHOLD = 50;
export const AMBIENT_PATTERN_DEGRADATION_COUNT = 3;

// ─── Timeout Constants ──────────────────────────────────────────────────

export const TIMEOUT_WARNING_HOURS = [1, 6, 23] as const;
export const ABSOLUTE_TIMEOUT_HOURS = 48; // auto-abort after this
