import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  bigint,
  float,
  decimal,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  animePreviewUsed: int("animePreviewUsed").default(0),
  preferences: json("preferences"),  // {preferred_style, preferred_tone, preferred_chapter_length, preferred_audience, last_used_style}
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Projects ─────────────────────────────────────────────────────────────

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  genre: varchar("genre", { length: 100 }),
  coverImageUrl: text("coverImageUrl"),
  status: mysqlEnum("status", ["draft", "active", "archived"]).default("draft").notNull(),
  visibility: mysqlEnum("visibility", ["private", "unlisted", "public"]).default("private").notNull(),
  animeStyle: mysqlEnum("animeStyle", ["shonen", "seinen", "shoujo", "chibi", "cyberpunk", "watercolor", "noir", "realistic", "mecha", "default"]).default("default").notNull(),
  tone: varchar("tone", { length: 100 }),
  targetAudience: mysqlEnum("targetAudience", ["kids", "teen", "adult"]).default("teen"),
  settings: json("settings"),
  slug: varchar("slug", { length: 255 }).unique(),
  originalPrompt: text("originalPrompt"),
  creationMode: mysqlEnum("creationMode", ["quick_create", "studio", "upload"]).default("quick_create"),
  animeEligible: int("animeEligible").default(0),
  featured: int("featured").default(0),
  viewCount: int("viewCount").default(0),
  animeStatus: mysqlEnum("animeStatus", ["not_eligible", "eligible", "in_production", "completed"]).default("not_eligible").notNull(),
  animePromotedAt: timestamp("animePromotedAt"),
  trailerVideoUrl: text("trailerVideoUrl"),
  previewVideoUrl: text("previewVideoUrl"),
  previewGeneratedAt: timestamp("previewGeneratedAt"),
  sneakPeekUrl: text("sneak_peek_url"),
  sneakPeekStatus: mysqlEnum("sneak_peek_status", ["none", "generating", "ready", "failed"]).default("none"),
  sneakPeekSceneId: int("sneak_peek_scene_id"),
  sneakPeekGeneratedAt: timestamp("sneak_peek_generated_at"),
  chapterLengthPreset: mysqlEnum("chapter_length_preset", ["short", "standard", "long"]).default("standard"),
  pacingStyle: mysqlEnum("pacing_style", ["action_heavy", "dialogue_heavy", "balanced"]).default("balanced"),
  chapterEndingStyle: mysqlEnum("chapter_ending_style", ["cliffhanger", "resolution", "serialized"]).default("cliffhanger"),
  publicationStatus: mysqlEnum("publication_status", ["draft", "private", "published", "archived"]).default("draft").notNull(),
  publishedAt: timestamp("publishedAt"),
  sourceType: mysqlEnum("source_type", ["text_prompt", "upload_ai", "upload_digital", "upload_hand_drawn"]).default("text_prompt"),
  uploadMetadata: json("upload_metadata"),
  // F3: Project Persistence - wizard stage tracking
  wizardStage: int("wizardStage").default(0).notNull(),  // 0-6 maps to input/setup/script/panels/anime-gate/video/publish
  projectState: mysqlEnum("projectState", ["draft", "published_manga", "published_anime", "archived"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Project = typeof projects.$inferSelect;;
export type InsertProject = typeof projects.$inferInsert;

// ─── Content Views (anonymous + authenticated) ──────────────────────────────
export const contentViews = mysqlTable("content_views", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  contentType: mysqlEnum("content_type", ["manga_chapter", "anime_episode", "project"]).notNull(),
  contentId: int("content_id").notNull(),
  projectId: int("project_id").references(() => projects.id, { onDelete: "cascade" }),
  viewerHash: varchar("viewer_hash", { length: 64 }).notNull(),
  sessionId: varchar("session_id", { length: 64 }),
  userId: int("user_id").references(() => users.id, { onDelete: "set null" }),
  durationSeconds: int("duration_seconds"),
  source: mysqlEnum("source", ["direct", "search", "social", "internal", "embed"]).default("direct"),
  viewedAt: timestamp("viewed_at").defaultNow().notNull(),
});
export type ContentView = typeof contentViews.$inferSelect;
export type InsertContentView = typeof contentViews.$inferInsert;

// ─── Manga Uploads ────────────────────────────────────────────────────────

export const mangaUploads = mysqlTable("manga_uploads", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSizeBytes: int("fileSizeBytes"),
  mimeType: varchar("mimeType", { length: 100 }),
  pageCount: int("pageCount"),
  status: mysqlEnum("status", ["uploaded", "queued", "processing", "completed", "failed"]).default("uploaded").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MangaUpload = typeof mangaUploads.$inferSelect;
export type InsertMangaUpload = typeof mangaUploads.$inferInsert;

// ─── Processing Jobs ──────────────────────────────────────────────────────

export const processingJobs = mysqlTable("processing_jobs", {
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("uploadId").notNull().references(() => mangaUploads.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["queued", "processing", "completed", "failed"]).default("queued").notNull(),
  progress: int("progress").default(0),
  inputImageUrl: text("inputImageUrl"),
  resultUrls: json("resultUrls"),   // string[] of CDN URLs for generated frames
  errorMessage: text("errorMessage"),
  animeStyle: mysqlEnum("animeStyle", ["shonen", "seinen", "shoujo", "chibi", "cyberpunk", "watercolor", "noir", "realistic", "mecha", "default"]).default("default").notNull(),
  processingStartedAt: timestamp("processingStartedAt"),
  processingCompletedAt: timestamp("processingCompletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type InsertProcessingJob = typeof processingJobs.$inferInsert;

// ─── Episodes ────────────────────────────────────────────────────────────

export const episodes = mysqlTable("episodes", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeNumber: int("episodeNumber").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  synopsis: text("synopsis"),
  scriptContent: json("scriptContent"),  // Full structured JSON script
  status: mysqlEnum("status", ["draft", "generating", "generated", "approved", "locked", "pipeline", "review", "published"]).default("draft").notNull(),
  wordCount: int("wordCount").default(0),
  panelCount: int("panelCount").default(0),
  viewCount: int("viewCount").default(0),
  duration: int("duration").default(0),
  videoUrl: text("videoUrl"),
  thumbnailUrl: text("thumbnailUrl"),
  narratorEnabled: int("narratorEnabled").default(1),
  narratorVoiceId: varchar("narratorVoiceId", { length: 255 }),
  sfxData: json("sfxData"),  // Generated SFX timeline [{sfxType, timestampMs, volume, durationMs, url}]
  scriptModerationStatus: mysqlEnum("scriptModerationStatus", ["pending", "clean", "flagged", "revised"]).default("pending"),
  scriptModerationFlags: json("scriptModerationFlags"),  // [{category, severity, description, lineNumber}]
  estimatedCostCents: int("estimatedCostCents"),
  isPremium: mysqlEnum("isPremium", ["free", "premium", "pay_per_view"]).default("free"),
  ppvPriceCents: int("ppvPriceCents"),
  chapterEndType: mysqlEnum("chapter_end_type", ["cliffhanger", "resolution", "serialized"]),
  nextChapterHook: text("next_chapter_hook"),
  estimatedReadTime: int("estimated_read_time"),  // in seconds
  moodArc: json("mood_arc"),  // string[] e.g. ["tense", "calm", "building", "climax", "cliffhanger"]
  assemblySettings: json("assembly_settings"),  // {enableLipSync, enableFoley, enableAmbient, voiceLufs, musicLufs, foleyLufs, ambientLufs, enableVoiceValidation}
  streamUid: varchar("stream_uid", { length: 255 }),  // Cloudflare Stream video UID
  streamEmbedUrl: text("stream_embed_url"),  // Cloudflare Stream iframe embed URL
  streamHlsUrl: text("stream_hls_url"),  // Cloudflare Stream HLS playback URL
  streamThumbnailUrl: text("stream_thumbnail_url"),  // Cloudflare Stream auto-generated thumbnail
  streamStatus: mysqlEnum("stream_status", ["none", "uploading", "processing", "ready", "error"]).default("none"),
  srtUrl: text("srt_url"),  // Generated SRT subtitle file URL
  srtGeneratedAt: timestamp("srt_generated_at"),  // When subtitles were last generated
  vttUrl: text("vtt_url"),  // Generated WebVTT subtitle file URL
  captionLanguage: varchar("caption_language", { length: 10 }).default("en"),  // Caption language code (ISO 639-1)
  captionStatus: mysqlEnum("caption_status", ["none", "converting", "uploading", "ready", "error"]).default("none"),  // Cloudflare Stream caption delivery status
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Episode = typeof episodes.$inferSelect;
export type InsertEpisode = typeof episodes.$inferInsert;

// ─── Panels ──────────────────────────────────────────────────────────────

export const panels = mysqlTable("panels", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sceneNumber: int("sceneNumber").notNull(),
  panelNumber: int("panelNumber").notNull(),
  visualDescription: text("visualDescription"),
  cameraAngle: mysqlEnum("cameraAngle", ["wide", "medium", "close-up", "extreme-close-up", "birds-eye"]).default("medium"),
  dialogue: json("dialogue"),  // [{character, text, emotion}]
  sfx: varchar("sfx", { length: 255 }),
  transition: mysqlEnum("transition", ["cut", "fade", "dissolve", "cross-dissolve"]).default("cut"),
  transitionDuration: float("transition_duration").default(0.5),  // seconds (0.2–2.0)
  imageUrl: text("imageUrl"),
  compositeImageUrl: text("compositeImageUrl"),  // Image with dialogue/SFX overlay
  fluxPrompt: text("fluxPrompt"),  // The actual prompt sent to image generation
  negativePrompt: text("negativePrompt"),
  status: mysqlEnum("status", ["draft", "generating", "generated", "approved", "rejected"]).default("draft").notNull(),
  reviewStatus: mysqlEnum("reviewStatus", ["pending", "approved", "rejected", "needs_revision"]).default("pending"),
  qualityScore: int("qualityScore"),  // 1-100 (average of 5 criteria * 10)
  qualityDetails: json("qualityDetails"),  // {promptAdherence, anatomy, styleConsistency, composition, characterAccuracy}
  generationAttempts: int("generationAttempts").default(1),
  upscaledImageUrl: text("upscaledImageUrl"),
  moderationStatus: mysqlEnum("moderationStatus", ["pending", "clean", "flagged", "acknowledged"]).default("pending"),
  moderationFlags: json("moderationFlags"),  // [{category, severity, description}]
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Panel = typeof panels.$inferSelect;
export type InsertPanel = typeof panels.$inferInsert;

// ─── Characters ──────────────────────────────────────────────────────────

export const characters = mysqlTable("characters", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["protagonist", "antagonist", "supporting", "background"]).default("supporting").notNull(),
  personalityTraits: json("personalityTraits"),  // string[]
  visualTraits: json("visualTraits"),  // {hairColor, eyeColor, bodyType, clothing, distinguishingFeatures}
  referenceImages: json("referenceImages"),  // string[] of CDN URLs
  bio: text("bio"),
  loraModelUrl: text("loraModelUrl"),
  loraStatus: mysqlEnum("loraStatus", ["none", "uploading", "training", "validating", "ready", "failed"]).default("none"),
  loraTriggerWord: varchar("loraTriggerWord", { length: 100 }),
  loraTrainingProgress: int("loraTrainingProgress").default(0),
  voiceId: varchar("voiceId", { length: 255 }),
  voiceCloneUrl: text("voiceCloneUrl"),
  voiceSettings: json("voiceSettings"),  // {stability, similarity_boost}
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

// ─── Pipeline Runs ─────────────────────────────────────────────────────

export const pipelineRuns = mysqlTable("pipeline_runs", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "cancelled"]).default("pending").notNull(),
  currentNode: mysqlEnum("currentNode", ["quality_check", "upscale", "content_mod", "video_gen", "voice_gen", "narrator_gen", "lip_sync", "music_gen", "sfx_gen", "assembly", "qa_review", "none"]).default("none"),
  nodeStatuses: json("nodeStatuses"),  // {video_gen: 'complete', voice_gen: 'running', ...}
  progress: int("progress").default(0),
  estimatedTimeRemaining: int("estimatedTimeRemaining"),  // seconds
  totalCost: int("totalCost").default(0),  // cents
  nodeCosts: json("nodeCosts"),  // {video_gen: 120, voice_gen: 50, ...}
  errors: json("errors"),  // [{node, message, timestamp}]
  qaIssues: json("qaIssues"),  // [{type, description, node}]
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// New HITL columns (added via ALTER TABLE, not changing existing columns)
// currentStageNumber, totalStages, gateConfig, totalCreditsSpent, totalCreditsHeld, abortedAt, abortReason

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT 17: HITL Gate Architecture Tables
// ═══════════════════════════════════════════════════════════════════════════

// ─── Pipeline Stages (one row per stage per pipeline run) ─────────────────
export const pipelineStages = mysqlTable("pipeline_stages", {
  id: int("id").autoincrement().primaryKey(),
  pipelineRunId: int("pipelineRunId").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  stageNumber: int("stageNumber").notNull(),
  stageName: varchar("stageName", { length: 128 }).notNull(),
  status: mysqlEnum("status", [
    "pending", "executing", "awaiting_gate", "approved", "rejected",
    "regenerating", "skipped", "failed", "timed_out"
  ]).default("pending").notNull(),
  generationRequestId: int("generationRequestId"),  // references generation_requests.id
  gateId: int("gateId"),  // references gates.id (FK added after gates table)
  creditsEstimated: decimal("creditsEstimated", { precision: 10, scale: 4 }),
  creditsActual: decimal("creditsActual", { precision: 10, scale: 4 }),
  holdId: varchar("holdId", { length: 64 }),  // credit ledger hold ID
  attempts: int("attempts").notNull().default(0),
  maxAttempts: int("maxAttempts").notNull().default(3),
  resultUrl: text("resultUrl"),  // URL to the generated output
  resultMetadata: json("resultMetadata"),  // provider metadata, dimensions, duration, etc.
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PipelineStage = typeof pipelineStages.$inferSelect;
export type InsertPipelineStage = typeof pipelineStages.$inferInsert;

// ─── Gates (one per gate checkpoint) ──────────────────────────────────────
export const gates = mysqlTable("gates", {
  id: int("id").autoincrement().primaryKey(),
  pipelineStageId: int("pipelineStageId").notNull(),  // references pipeline_stages.id
  pipelineRunId: int("pipelineRunId").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  gateType: mysqlEnum("gateType", ["blocking", "advisory", "ambient"]).notNull(),
  stageNumber: int("stageNumber").notNull(),
  stageName: varchar("stageName", { length: 128 }).notNull(),

  // Confidence scoring
  confidenceScore: int("confidenceScore"),  // 0-100
  confidenceDetails: json("confidenceDetails"),  // SubScore[] breakdown
  autoAdvanceThreshold: int("autoAdvanceThreshold").default(85),
  reviewThreshold: int("reviewThreshold").default(60),

  // Decision
  decision: mysqlEnum("decision", [
    "pending", "approved", "rejected", "regenerate", "regenerate_with_edits",
    "auto_approved", "auto_rejected", "escalated", "timed_out"
  ]).default("pending").notNull(),
  decisionSource: mysqlEnum("decisionSource", ["creator", "auto", "escalation", "timeout"]),
  decisionReason: text("decisionReason"),
  decisionAt: timestamp("decisionAt"),

  // Regeneration
  regenParamsDiff: json("regenParamsDiff"),  // what the creator changed
  regenGenerationRequestId: int("regenGenerationRequestId"),  // new request after regen

  // Credit display
  creditsSpentSoFar: decimal("creditsSpentSoFar", { precision: 10, scale: 4 }),
  creditsToProceed: decimal("creditsToProceed", { precision: 10, scale: 4 }),
  creditsToRegenerate: decimal("creditsToRegenerate", { precision: 10, scale: 4 }),
  creditsSavedIfReject: decimal("creditsSavedIfReject", { precision: 10, scale: 4 }),

  // Timeout
  timeoutAt: timestamp("timeoutAt"),
  timeoutAction: mysqlEnum("timeoutAction", ["auto_approve", "auto_reject", "auto_pause"]).default("auto_pause"),
  timeoutNotified1h: int("timeoutNotified1h").default(0),  // MySQL boolean
  timeoutNotified6h: int("timeoutNotified6h").default(0),
  timeoutNotified23h: int("timeoutNotified23h").default(0),

  // Quality feedback
  qualityScore: int("qualityScore"),  // 1-5

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Gate = typeof gates.$inferSelect;
export type InsertGate = typeof gates.$inferInsert;

// ─── Gate Notifications ───────────────────────────────────────────────────
export const gateNotifications = mysqlTable("gate_notifications", {
  id: int("id").autoincrement().primaryKey(),
  gateId: int("gateId").notNull(),  // references gates.id
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: mysqlEnum("channel", ["websocket", "email", "push"]).notNull(),
  notificationType: mysqlEnum("notificationType", [
    "gate_ready", "review_recommended", "review_required",
    "timeout_warning_1h", "timeout_warning_6h", "timeout_warning_23h",
    "timeout_fired", "escalation"
  ]).notNull(),
  delivered: int("delivered").default(0).notNull(),  // MySQL boolean
  deliveredAt: timestamp("deliveredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GateNotification = typeof gateNotifications.$inferSelect;
export type InsertGateNotification = typeof gateNotifications.$inferInsert;

// ─── Gate Audit Log (immutable append-only) ───────────────────────────────
export const gateAuditLog = mysqlTable("gate_audit_log", {
  id: int("id").autoincrement().primaryKey(),
  gateId: int("gateId").notNull(),  // references gates.id
  pipelineRunId: int("pipelineRunId").notNull(),
  stageNumber: int("stageNumber").notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),  // created, confidence_scored, auto_advanced, creator_approved, etc.
  oldState: json("oldState"),
  newState: json("newState"),
  actor: varchar("actor", { length: 128 }).notNull(),  // 'system', 'creator:{userId}', 'timeout'
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GateAuditLogEntry = typeof gateAuditLog.$inferSelect;
export type InsertGateAuditLogEntry = typeof gateAuditLog.$inferInsert;

// ─── Gate Configs (per-tier defaults and per-user overrides) ──────────────
export const gateConfigs = mysqlTable("gate_configs", {
  id: int("id").autoincrement().primaryKey(),
  scope: mysqlEnum("scope", ["tier_default", "user_override"]).notNull(),
  scopeRef: varchar("scopeRef", { length: 128 }).notNull(),  // tier name or user_id
  stageNumber: int("stageNumber").notNull(),
  gateType: mysqlEnum("gateType", ["blocking", "advisory", "ambient"]).notNull(),
  autoAdvanceThreshold: int("autoAdvanceThreshold").default(85),
  reviewThreshold: int("reviewThreshold").default(60),
  timeoutHours: int("timeoutHours").default(24),
  timeoutAction: mysqlEnum("timeoutAction", ["auto_approve", "auto_reject", "auto_pause"]).default("auto_pause"),
  isLocked: int("isLocked").default(0),  // 1 = cannot be overridden (Episode Publish)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type GateConfig = typeof gateConfigs.$inferSelect;
export type InsertGateConfig = typeof gateConfigs.$inferInsert;

// ─── Pipeline Assets ───────────────────────────────────────────────────

export const pipelineAssets = mysqlTable("pipeline_assets", {
  id: int("id").autoincrement().primaryKey(),
  pipelineRunId: int("pipelineRunId").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  panelId: int("panelId"),
  assetType: mysqlEnum("assetType", ["video_clip", "voice_clip", "synced_clip", "music_segment", "sfx_clip", "narrator_clip", "upscaled_panel", "subtitle_srt", "final_video", "thumbnail", "stream_video"]).notNull(),
  url: text("url").notNull(),
  metadata: json("metadata"),  // {duration, fileSize, format, characterId, ...}
  nodeSource: mysqlEnum("nodeSource", ["quality_check", "upscale", "content_mod", "video_gen", "voice_gen", "narrator_gen", "lip_sync", "music_gen", "sfx_gen", "assembly"]).notNull(),
  harnessScore: float("harnessScore"),  // overall quality score from harness (0-10)
  harnessResult: varchar("harnessResult", { length: 20 }),  // pass/warn/retry/block/human_review
  harnessDetails: json("harnessDetails"),  // full harness check output for this asset
  // ─── Smart Model Router fields ───
  klingModelUsed: varchar("klingModelUsed", { length: 30 }),  // v3-omni, v2-6, v2-1, v1-6
  complexityTier: int("complexityTier"),  // 1-4
  lipSyncMethod: varchar("lipSyncMethod", { length: 20 }),  // native, post_sync, none
  classificationReasoning: text("classificationReasoning"),
  costActual: float("costActual"),  // actual cost in dollars
  costIfV3Omni: float("costIfV3Omni"),  // what it would have cost with V3 Omni
  userOverride: int("userOverride").default(0),  // 1 if user manually overrode model
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PipelineAsset = typeof pipelineAssets.$inferSelect;
export type InsertPipelineAsset = typeof pipelineAssets.$inferInsert;

// ─── CLIP Embeddings (for confidence scoring) ─────────────────────────────
export const clipEmbeddings = mysqlTable("clip_embeddings", {
  id: int("id").autoincrement().primaryKey(),
  referenceType: mysqlEnum("referenceType", ["character_sheet", "style_reference", "keyframe", "generated_output"]).notNull(),
  referenceId: int("referenceId").notNull(),  // character_id, project_id, etc.
  imageUrl: text("imageUrl").notNull(),
  embedding: json("embedding").notNull(),  // float[] (512-dim CLIP vector)
  modelVersion: varchar("modelVersion", { length: 64 }).default("clip-vit-base-patch32"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClipEmbedding = typeof clipEmbeddings.$inferSelect;
export type InsertClipEmbedding = typeof clipEmbeddings.$inferInsert;


// ─── Comments ───────────────────────────────────────────────────────────

export const comments = mysqlTable("comments", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  parentId: int("parentId"),
  content: text("content").notNull(),
  upvotes: int("upvotes").default(0),
  downvotes: int("downvotes").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

// ─── Follows ────────────────────────────────────────────────────────────

export const follows = mysqlTable("follows", {
  id: int("id").autoincrement().primaryKey(),
  followerId: int("followerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  followingId: int("followingId").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Follow = typeof follows.$inferSelect;
export type InsertFollow = typeof follows.$inferInsert;

// ─── Watchlist ──────────────────────────────────────────────────────────

export const watchlist = mysqlTable("watchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  lastEpisodeId: int("lastEpisodeId"),
  progress: int("progress").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = typeof watchlist.$inferInsert;

// ─── Notifications ──────────────────────────────────────────────────────

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: mysqlEnum("type", ["new_episode", "reply", "new_follower", "anime_eligible", "anime_started", "anime_completed"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  linkUrl: varchar("linkUrl", { length: 512 }),
  isRead: int("isRead").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─── Notification Types Update ──────────────────────────────────────────

// ─── Subscriptions (Prompt 15) ────────────────────────────────────────

export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  tier: mysqlEnum("tier", ["free_trial", "creator", "creator_pro", "studio", "enterprise"]).default("free_trial").notNull(),
  status: mysqlEnum("status", ["trialing", "active", "past_due", "canceled", "incomplete", "paused"]).default("trialing").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart").notNull(),
  currentPeriodEnd: timestamp("currentPeriodEnd").notNull(),
  cancelAtPeriodEnd: int("cancelAtPeriodEnd").default(0).notNull(),
  monthlyCreditGrant: int("monthlyCreditGrant").notNull().default(15),
  rolloverPercentage: decimal("rolloverPercentage", { precision: 3, scale: 2 }).default("0.00").notNull(),
  rolloverCap: int("rolloverCap"),
  episodeLengthCapSeconds: int("episodeLengthCapSeconds").notNull().default(300),
  allowedModelTiers: json("allowedModelTiers").notNull(),  // string[] e.g. ["budget"]
  concurrentGenerationLimit: int("concurrentGenerationLimit").notNull().default(1),
  teamSeats: int("teamSeats").notNull().default(1),
  queuePriority: int("queuePriority").notNull().default(5),
  lastDowngradeAt: timestamp("lastDowngradeAt"),  // for 30-day cooling-off enforcement
  billingInterval: mysqlEnum("billingInterval", ["monthly", "annual"]).default("monthly"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ─── Usage Records ─────────────────────────────────────────────────────

export const usageRecords = mysqlTable("usage_records", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  actionType: mysqlEnum("actionType", ["script", "panel", "video", "voice", "lora_train"]).notNull(),
  creditsUsed: int("creditsUsed").notNull(),
  projectId: int("projectId"),
  episodeId: int("episodeId"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UsageRecord = typeof usageRecords.$inferSelect;
export type InsertUsageRecord = typeof usageRecords.$inferInsert;

// ─── Tips ──────────────────────────────────────────────────────────────

export const tips = mysqlTable("tips", {
  id: int("id").autoincrement().primaryKey(),
  fromUserId: int("fromUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  toUserId: int("toUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  amountCents: int("amountCents").notNull(),
  creatorShareCents: int("creatorShareCents").notNull(),
  platformShareCents: int("platformShareCents").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Tip = typeof tips.$inferSelect;
export type InsertTip = typeof tips.$inferInsert;

// ─── Moderation Queue ──────────────────────────────────────────────────

export const moderationQueue = mysqlTable("moderation_queue", {
  id: int("id").autoincrement().primaryKey(),
  contentType: mysqlEnum("contentType", ["project", "episode", "comment", "panel"]).notNull(),
  contentId: int("contentId").notNull(),
  reportedBy: int("reportedBy").references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason"),
  status: mysqlEnum("status", ["pending", "approved", "removed", "dismissed"]).default("pending").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ModerationItem = typeof moderationQueue.$inferSelect;
export type InsertModerationItem = typeof moderationQueue.$inferInsert;

// ─── Platform Config ──────────────────────────────────────────────────

export const platformConfig = mysqlTable("platform_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformConfig = typeof platformConfig.$inferSelect;
export type InsertPlatformConfig = typeof platformConfig.$inferInsert;

// ─── Scenes (for consistency tracking) ───────────────────────────────

export const scenes = mysqlTable("scenes", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sceneNumber: int("sceneNumber").notNull(),
  location: text("location"),
  timeOfDay: varchar("timeOfDay", { length: 50 }),
  mood: varchar("mood", { length: 50 }),
  sceneContext: json("sceneContext"),  // Extracted visual context from first panel
  environmentLoraUrl: text("environmentLoraUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;

// ─── Episode SFX ─────────────────────────────────────────────────────

export const episodeSfx = mysqlTable("episode_sfx", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  panelId: int("panelId").references(() => panels.id, { onDelete: "cascade" }),
  sfxType: varchar("sfxType", { length: 100 }).notNull(),  // explosion, footsteps, rain, etc.
  sfxUrl: text("sfxUrl"),
  timestampMs: int("timestampMs").default(0),
  volume: int("volume").default(80),  // 0-100
  durationMs: int("durationMs"),
  source: mysqlEnum("source", ["generated", "library"]).default("library").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EpisodeSfx = typeof episodeSfx.$inferSelect;
export type InsertEpisodeSfx = typeof episodeSfx.$inferInsert;

// ─── Tier Limits (configuration table) ──────────────────────────────

export const tierLimits = mysqlTable("tier_limits", {
  tier: varchar("tier", { length: 20 }).primaryKey(),
  maxProjects: int("maxProjects").notNull(),
  maxChaptersPerProject: int("maxChaptersPerProject").notNull(),
  maxPanelsPerChapter: int("maxPanelsPerChapter").notNull(),
  maxAnimeEpisodesPerMonth: int("maxAnimeEpisodesPerMonth").notNull(),
  maxLoraCharacters: int("maxLoraCharacters").notNull(),
  maxVoiceClones: int("maxVoiceClones").notNull(),
  scriptModel: varchar("scriptModel", { length: 100 }).notNull(),
  videoResolution: varchar("videoResolution", { length: 20 }).notNull(),
  hasWatermark: int("hasWatermark").default(0).notNull(),
  canUploadManga: int("canUploadManga").default(0).notNull(),
  canMonetize: int("canMonetize").default(0).notNull(),
  revenueSharePercent: int("revenueSharePercent").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TierLimit = typeof tierLimits.$inferSelect;
export type InsertTierLimit = typeof tierLimits.$inferInsert;

// ─── Exports (download tracking) ────────────────────────────────────

export const exports = mysqlTable("exports", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: int("projectId").references(() => projects.id, { onDelete: "cascade" }),
  episodeId: int("episodeId").references(() => episodes.id, { onDelete: "cascade" }),
  format: mysqlEnum("format", ["pdf", "png_zip", "epub", "cbz", "mp4_1080", "mp4_4k", "prores", "stems", "srt", "tiff_zip", "thumbnail"]).notNull(),
  status: mysqlEnum("status", ["generating", "ready", "expired", "failed"]).default("generating").notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  watermarked: int("watermarked").default(0),
  resolution: varchar("resolution", { length: 20 }),
  dpi: int("dpi"),
  chapterNumber: int("chapterNumber"),  // null = all chapters
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Export = typeof exports.$inferSelect;
export type InsertExport = typeof exports.$inferInsert;

// ─── Pre-Production Configs ────────────────────────────────────────────

export const preProductionConfigs = mysqlTable("pre_production_configs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["in_progress", "locked", "archived"]).default("in_progress").notNull(),
  currentStage: int("currentStage").default(1).notNull(),  // 1-6
  characterApprovals: json("characterApprovals"),  // {characterId: {approved, versionId, lockedAt}}
  voiceAssignments: json("voiceAssignments"),  // {characterId: {voiceId, cloneId, directionNotes, source}}
  animationStyle: varchar("animationStyle", { length: 50 }),  // limited/sakuga/cel_shaded/rotoscope/motion_comic
  styleMixing: json("styleMixing"),  // {sceneId: animationStyle}
  colorGrading: varchar("colorGrading", { length: 50 }),  // warm/cool/vivid/muted/neon/pastel
  atmosphericEffects: json("atmosphericEffects"),  // {sceneId: [effects]}
  aspectRatio: varchar("aspectRatio", { length: 20 }).default("16:9"),
  openingStyle: varchar("openingStyle", { length: 50 }).default("title_card"),
  endingStyle: varchar("endingStyle", { length: 50 }).default("credits_roll"),
  pacing: varchar("pacing", { length: 50 }).default("standard_tv"),
  subtitleConfig: json("subtitleConfig"),  // {primaryLang, additionalLangs[], style, fontSize, burnedIn}
  audioConfig: json("audioConfig"),  // {musicVolume, sfxVolume, duckingIntensity}
  environmentApprovals: json("environmentApprovals"),  // {locationId: {approvedUrl, timeVariants}}
  musicConfig: json("musicConfig"),  // {opening_theme, ending_theme, ost_tracks[], scene_bgm_mapping[], stingers[]}
  estimatedCostCredits: int("estimatedCostCredits"),
  lockedAt: timestamp("lockedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PreProductionConfig = typeof preProductionConfigs.$inferSelect;
export type InsertPreProductionConfig = typeof preProductionConfigs.$inferInsert;

// ─── Character Versions ────────────────────────────────────────────────

export const characterVersions = mysqlTable("character_versions", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
  versionNumber: int("versionNumber").notNull(),
  images: json("images"),  // {portrait, fullBody, threeQuarter, action, expressions} URLs
  descriptionUsed: text("descriptionUsed"),
  qualityScores: json("qualityScores"),  // per-image quality scores
  isApproved: int("isApproved").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CharacterVersion = typeof characterVersions.$inferSelect;
export type InsertCharacterVersion = typeof characterVersions.$inferInsert;

// ─── Voice Auditions ───────────────────────────────────────────────────

export const voiceAuditions = mysqlTable("voice_auditions", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
  voiceId: varchar("voiceId", { length: 255 }).notNull(),
  voiceName: varchar("voiceName", { length: 255 }),
  dialogueText: text("dialogueText"),
  audioUrl: text("audioUrl"),
  isSelected: int("isSelected").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VoiceAudition = typeof voiceAuditions.$inferSelect;
export type InsertVoiceAudition = typeof voiceAuditions.$inferInsert;

// ─── Music Tracks ─────────────────────────────────────────────────────

export const musicTracks = mysqlTable("music_tracks", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  trackType: mysqlEnum("trackType", ["opening", "ending", "bgm", "stinger", "custom"]).notNull(),
  mood: varchar("mood", { length: 100 }),  // for BGM: action, romance, tension, etc.
  title: varchar("title", { length: 255 }),
  lyrics: text("lyrics"),  // for OP/ED with vocals
  stylePrompt: text("stylePrompt"),  // the Suno prompt used
  trackUrl: text("trackUrl"),  // S3/R2 URL
  durationSeconds: float("durationSeconds"),
  isVocal: int("isVocal").default(0),
  isLoopable: int("isLoopable").default(0),  // for BGM tracks
  versionNumber: int("versionNumber").default(1).notNull(),
  isApproved: int("isApproved").default(0),
  isUserUploaded: int("isUserUploaded").default(0),
  sunoGenerationId: varchar("sunoGenerationId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MusicTrack = typeof musicTracks.$inferSelect;
export type InsertMusicTrack = typeof musicTracks.$inferInsert;

// ─── Music Versions ───────────────────────────────────────────────────

export const musicVersions = mysqlTable("music_versions", {
  id: int("id").autoincrement().primaryKey(),
  musicTrackId: int("musicTrackId").notNull().references(() => musicTracks.id, { onDelete: "cascade" }),
  versionNumber: int("versionNumber").notNull(),
  trackUrl: text("trackUrl"),
  stylePrompt: text("stylePrompt"),
  refinementNotes: text("refinementNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MusicVersion = typeof musicVersions.$inferSelect;
export type InsertMusicVersion = typeof musicVersions.$inferInsert;

// ─── Vocal Recordings (Phase 17) ─────────────────────────────────────

export const vocalRecordings = mysqlTable("vocal_recordings", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  trackType: mysqlEnum("trackType", ["opening", "ending"]).notNull(),
  rawRecordingUrl: text("rawRecordingUrl"),
  isolatedVocalUrl: text("isolatedVocalUrl"),
  convertedVocalUrl: text("convertedVocalUrl"),
  finalMixUrl: text("finalMixUrl"),
  targetVoiceModel: varchar("targetVoiceModel", { length: 255 }),
  conversionSettings: json("conversionSettings"),
  recordingMode: mysqlEnum("recordingMode", ["full_take", "section_by_section"]).default("full_take").notNull(),
  sectionRecordings: json("sectionRecordings"),
  status: mysqlEnum("status", ["recording", "processing", "ready", "approved"]).default("recording").notNull(),
  conversionCount: int("conversionCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VocalRecording = typeof vocalRecordings.$inferSelect;
export type InsertVocalRecording = typeof vocalRecordings.$inferInsert;

// ─── RVC Voice Models (Phase 17) ─────────────────────────────────────

export const rvcVoiceModels = mysqlTable("rvc_voice_models", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  gender: varchar("gender", { length: 50 }).notNull(),
  vocalRange: varchar("vocalRange", { length: 50 }).notNull(),
  styleTags: text("styleTags"),  // comma-separated: "rock,pop,ballad"
  modelUrl: text("modelUrl"),
  indexUrl: text("indexUrl"),
  sampleAudioUrl: text("sampleAudioUrl"),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RvcVoiceModel = typeof rvcVoiceModels.$inferSelect;
export type InsertRvcVoiceModel = typeof rvcVoiceModels.$inferInsert;

// ─── Kling Character Elements (Subject Library) ─────────────────────────

export const characterElements = mysqlTable("character_elements", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Kling Voice API
  klingVoiceTaskId: varchar("klingVoiceTaskId", { length: 255 }),
  klingVoiceId: varchar("klingVoiceId", { length: 255 }),
  voiceSourceUrl: text("voiceSourceUrl"),  // audio sample used for voice cloning

  // Kling Element API
  klingElementTaskId: varchar("klingElementTaskId", { length: 255 }),
  klingElementId: bigint("klingElementId", { mode: "number" }),  // the element_id from Kling API
  referenceImageUrl: text("referenceImageUrl"),  // frontal image used
  additionalImageUrls: json("additionalImageUrls"),  // string[] of additional reference images

  // Status tracking
  status: mysqlEnum("status", [
    "pending",
    "creating_voice",
    "voice_ready",
    "creating_element",
    "ready",
    "failed",
  ]).default("pending").notNull(),
  errorMessage: text("errorMessage"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CharacterElement = typeof characterElements.$inferSelect;
export type InsertCharacterElement = typeof characterElements.$inferInsert;

// ─── Production Bibles ─────────────────────────────────────────────────

export const productionBibles = mysqlTable("production_bibles", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  bibleData: json("bibleData").notNull(),  // Full Production Bible JSONB
  version: int("version").default(1).notNull(),
  lockedAt: timestamp("lockedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductionBible = typeof productionBibles.$inferSelect;
export type InsertProductionBible = typeof productionBibles.$inferInsert;

// ─── Model Routing Stats ──────────────────────────────────────────────

export const modelRoutingStats = mysqlTable("model_routing_stats", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  pipelineRunId: int("pipelineRunId").references(() => pipelineRuns.id, { onDelete: "cascade" }),
  totalPanels: int("totalPanels").notNull(),
  tier1Count: int("tier1Count").default(0).notNull(),
  tier2Count: int("tier2Count").default(0).notNull(),
  tier3Count: int("tier3Count").default(0).notNull(),
  tier4Count: int("tier4Count").default(0).notNull(),
  actualCost: float("actualCost").notNull(),  // total actual cost in dollars
  v3OmniCost: float("v3OmniCost").notNull(),  // what all-V3-Omni would have cost
  savings: float("savings").notNull(),  // v3OmniCost - actualCost
  savingsPercent: float("savingsPercent").notNull(),  // (savings / v3OmniCost) * 100
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ModelRoutingStat = typeof modelRoutingStats.$inferSelect;
export type InsertModelRoutingStat = typeof modelRoutingStats.$inferInsert;

// ─── Harness Results ───────────────────────────────────────────────────

export const harnessResults = mysqlTable("harness_results", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  pipelineRunId: int("pipelineRunId").references(() => pipelineRuns.id, { onDelete: "cascade" }),
  layer: mysqlEnum("layer", ["script", "visual", "video", "audio", "integration"]).notNull(),
  checkName: varchar("checkName", { length: 100 }).notNull(),  // e.g., '2B_character_identity'
  targetId: int("targetId"),  // panel_id, clip_id, or episode_id depending on layer
  targetType: varchar("targetType", { length: 50 }),  // 'panel', 'clip', 'episode', 'asset'
  result: mysqlEnum("result", ["pass", "warn", "retry", "block", "human_review"]).notNull(),
  score: float("score"),  // overall score for this check (0-10)
  details: json("details"),  // full check output, scores per criterion, flagged issues
  autoFixApplied: text("autoFixApplied"),  // description of auto-fix if retry
  attemptNumber: int("attemptNumber").default(1).notNull(),
  costCredits: float("costCredits").default(0),  // cost of this harness check in dollars
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HarnessResult = typeof harnessResults.$inferSelect;
export type InsertHarnessResult = typeof harnessResults.$inferInsert;

// ─── Uploaded Assets (BYO Manga) ──────────────────────────────────────────
export const uploadedAssets = mysqlTable("uploaded_assets", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  originalUrl: text("originalUrl").notNull(),
  cleanedUrl: text("cleanedUrl"),
  lineArtUrl: text("lineArtUrl"),
  processedUrl: text("processedUrl"),
  panelNumber: int("panelNumber").notNull(),
  sourceType: mysqlEnum("source_type", ["ai_generated", "digital_art", "hand_drawn"]).default("ai_generated"),
  processingApplied: json("processing_applied"),  // string[] of steps applied
  styleTransferOption: mysqlEnum("style_transfer_option", ["none", "enhance_only", "hybrid", "full_restyle"]).default("none"),
  ocrExtracted: json("ocr_extracted"),  // detected dialogue, bubbles, SFX
  panelMetadata: json("panel_metadata"),  // scene desc, camera angle, mood, etc.
  segmentationData: json("segmentation_data"),  // bounding box if from full page
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UploadedAsset = typeof uploadedAssets.$inferSelect;
export type InsertUploadedAsset = typeof uploadedAssets.$inferInsert;

// ─── Credit Ledger (Prompt 15) ──────────────────────────────────────────

export const creditLedger = mysqlTable("credit_ledger", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  transactionType: mysqlEnum("transactionType", [
    "grant_subscription",
    "grant_pack_purchase",
    "grant_promotional",
    "hold_preauth",
    "commit_consumption",
    "release_hold",
    "refund_generation",
    "rollover",
    "expiry",
    "admin_adjustment",
  ]).notNull(),
  amountCredits: int("amountCredits").notNull(),  // signed: + for grants, - for consumption/expiry
  holdId: varchar("holdId", { length: 64 }),  // UUID string for hold lifecycle tracking
  referenceType: varchar("referenceType", { length: 50 }),  // e.g. 'subscription', 'credit_pack', 'episode', 'admin'
  referenceId: varchar("referenceId", { length: 255 }),  // ID of the referenced entity
  description: text("description"),
  metadata: json("metadata"),  // arbitrary JSON for audit (reason_code, admin_id, etc.)
  balanceAfter: int("balanceAfter").notNull(),  // committed balance after this txn
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  createdBy: int("createdBy").references(() => users.id),  // null for system, set for admin actions
});

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedger.$inferInsert;

// ─── Credit Balances (Materialized Projection, Prompt 15) ───────────────

export const creditBalances = mysqlTable("credit_balances", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  committedBalance: int("committedBalance").notNull().default(0),
  activeHolds: int("activeHolds").notNull().default(0),
  // available_balance = committedBalance - activeHolds (computed in app layer for MySQL)
  lifetimeGrants: int("lifetimeGrants").notNull().default(0),
  lifetimeConsumption: int("lifetimeConsumption").notNull().default(0),
  lastTransactionAt: timestamp("lastTransactionAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CreditBalance = typeof creditBalances.$inferSelect;
export type InsertCreditBalance = typeof creditBalances.$inferInsert;

// ─── Credit Packs (Prompt 15) ───────────────────────────────────────────

export const creditPacks = mysqlTable("credit_packs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }).notNull(),
  packSize: mysqlEnum("packSize", ["small", "medium", "large", "custom"]).notNull(),
  creditsGranted: int("creditsGranted").notNull(),
  pricePaidCents: int("pricePaidCents").notNull(),
  appliedDiscountPercentage: decimal("appliedDiscountPercentage", { precision: 3, scale: 2 }).default("0.00"),
  ledgerEntryId: int("ledgerEntryId"),  // references credit_ledger.id
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CreditPack = typeof creditPacks.$inferSelect;
export type InsertCreditPack = typeof creditPacks.$inferInsert;

// ─── Usage Events (Prompt 15) ───────────────────────────────────────────

export const usageEvents = mysqlTable("usage_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  episodeId: int("episodeId").references(() => episodes.id, { onDelete: "set null" }),
  provider: varchar("provider", { length: 100 }).notNull(),  // kling, fal, elevenlabs, minimax, anthropic
  modelName: varchar("modelName", { length: 100 }).notNull(),
  modelTier: varchar("modelTier", { length: 50 }).notNull(),  // budget, standard, premium, ultra
  apiCallType: varchar("apiCallType", { length: 100 }).notNull(),  // video_generation, voice_synthesis, etc.
  usdCostCents: int("usdCostCents").notNull(),  // actual USD cost in cents
  creditsConsumed: int("creditsConsumed").notNull(),
  durationSeconds: int("durationSeconds"),
  success: int("success").notNull().default(1),  // 1=true, 0=false
  holdLedgerId: int("holdLedgerId"),  // references credit_ledger.id for the HOLD_PREAUTH entry
  commitLedgerId: int("commitLedgerId"),  // references credit_ledger.id for the COMMIT entry
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = typeof usageEvents.$inferInsert;

// ─── Episode Costs (Prompt 15) ──────────────────────────────────────────

export const episodeCosts = mysqlTable("episode_costs", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  totalCredits: int("totalCredits").notNull().default(0),
  totalUsdCents: int("totalUsdCents").notNull().default(0),
  videoCostCredits: int("videoCostCredits").notNull().default(0),
  voiceCostCredits: int("voiceCostCredits").notNull().default(0),
  musicCostCredits: int("musicCostCredits").notNull().default(0),
  postProcessingCostCredits: int("postProcessingCostCredits").notNull().default(0),
  scriptCostCredits: int("scriptCostCredits").notNull().default(0),
  imageCostCredits: int("imageCostCredits").notNull().default(0),
  status: mysqlEnum("status", ["in_progress", "completed", "refunded"]).default("in_progress").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EpisodeCost = typeof episodeCosts.$inferSelect;
export type InsertEpisodeCost = typeof episodeCosts.$inferInsert;

// ─── Stripe Events Log (Idempotency, Prompt 15) ────────────────────────

export const stripeEventsLog = mysqlTable("stripe_events_log", {
  id: int("id").autoincrement().primaryKey(),
  stripeEventId: varchar("stripeEventId", { length: 255 }).notNull().unique(),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
  payload: json("payload"),  // full event payload for audit
});

export type StripeEventLog = typeof stripeEventsLog.$inferSelect;
export type InsertStripeEventLog = typeof stripeEventsLog.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT 16: Multi-Provider Router Tables
// ═══════════════════════════════════════════════════════════════════════════

// ─── Providers Registry ──────────────────────────────────────────────────
export const providers = mysqlTable("providers", {
  id: varchar("id", { length: 64 }).primaryKey(),  // e.g. 'kling_21', 'wan_26'
  displayName: varchar("displayName", { length: 128 }).notNull(),
  vendor: varchar("vendor", { length: 64 }).notNull(),  // 'kling_ai', 'alibaba', 'tencent', 'fal_ai', etc.
  modality: mysqlEnum("modality", ["video", "voice", "music", "image"]).notNull(),
  tier: mysqlEnum("tier", ["budget", "standard", "premium", "flagship"]).notNull(),
  capabilities: json("capabilities").notNull(),  // resolution range, max duration, streaming, voice cloning, etc.
  pricing: json("pricing").notNull(),  // unit, rate, currency, effective_date
  endpointUrl: text("endpointUrl").notNull(),
  authScheme: mysqlEnum("authScheme", ["bearer", "api_key_header", "signed_request"]).notNull(),
  adapterClass: varchar("adapterClass", { length: 128 }).notNull(),  // code reference
  status: mysqlEnum("status", ["active", "disabled", "deprecated"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Provider = typeof providers.$inferSelect;
export type InsertProvider = typeof providers.$inferInsert;

// ─── Provider API Keys ───────────────────────────────────────────────────
export const providerApiKeys = mysqlTable("provider_api_keys", {
  id: int("id").autoincrement().primaryKey(),
  providerId: varchar("providerId", { length: 64 }).notNull(),
  encryptedKey: text("encryptedKey").notNull(),  // AES-256-GCM encrypted, base64 encoded
  keyLabel: varchar("keyLabel", { length: 64 }).notNull(),  // 'primary', 'fallback', 'dev'
  rateLimitRpm: int("rateLimitRpm").default(60).notNull(),
  dailySpendCapUsd: decimal("dailySpendCapUsd", { precision: 10, scale: 2 }),
  isActive: int("isActive").default(1).notNull(),  // 1=true, 0=false (MySQL boolean)
  rotatedAt: timestamp("rotatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProviderApiKey = typeof providerApiKeys.$inferSelect;
export type InsertProviderApiKey = typeof providerApiKeys.$inferInsert;

// ─── Provider Health ─────────────────────────────────────────────────────
export const providerHealth = mysqlTable("provider_health", {
  providerId: varchar("providerId", { length: 64 }).primaryKey(),
  circuitState: mysqlEnum("circuitState", ["closed", "open", "half_open"]).default("closed").notNull(),
  consecutiveFailures: int("consecutiveFailures").default(0).notNull(),
  lastSuccessAt: timestamp("lastSuccessAt"),
  lastFailureAt: timestamp("lastFailureAt"),
  latencyP50Ms: int("latencyP50Ms"),
  latencyP95Ms: int("latencyP95Ms"),
  latencyP99Ms: int("latencyP99Ms"),
  successRate1h: decimal("successRate1h", { precision: 5, scale: 4 }),  // 0.0000 to 1.0000
  successRate24h: decimal("successRate24h", { precision: 5, scale: 4 }),
  successRate7d: decimal("successRate7d", { precision: 5, scale: 4 }),
  requestCount1h: int("requestCount1h").default(0),
  openedAt: timestamp("openedAt"),  // when circuit opened
  nextRetryAt: timestamp("nextRetryAt"),  // when to try half-open
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProviderHealth = typeof providerHealth.$inferSelect;
export type InsertProviderHealth = typeof providerHealth.$inferInsert;

// ─── Generation Requests (append-only log) ───────────────────────────────
export const generationRequests = mysqlTable("generation_requests", {
  id: int("id").autoincrement().primaryKey(),
  requestUid: varchar("requestUid", { length: 32 }).notNull().unique(),  // nanoid for external reference
  userId: int("userId").notNull(),
  episodeId: int("episodeId"),
  sceneId: int("sceneId"),
  requestType: mysqlEnum("requestType", ["video", "voice", "music", "image"]).notNull(),
  providerId: varchar("providerId", { length: 64 }).notNull(),
  providerHint: varchar("providerHint", { length: 64 }),
  fallbackChain: json("fallbackChain"),  // ordered list of providers considered
  tier: mysqlEnum("tier", ["budget", "standard", "premium", "flagship"]).notNull(),
  params: json("params").notNull(),  // sanitized, no secrets
  holdId: varchar("holdId", { length: 64 }),  // reference to credit_ledger hold
  estimatedCostCredits: decimal("estimatedCostCredits", { precision: 10, scale: 4 }).notNull(),
  estimatedCostUsd: decimal("estimatedCostUsd", { precision: 10, scale: 4 }).notNull(),
  actualCostCredits: decimal("actualCostCredits", { precision: 10, scale: 4 }),
  actualCostUsd: decimal("actualCostUsd", { precision: 10, scale: 4 }),
  status: mysqlEnum("requestStatus", ["pending", "executing", "succeeded", "failed", "cancelled"]).default("pending").notNull(),
  errorCode: varchar("errorCode", { length: 64 }),  // TRANSIENT, RATE_LIMITED, etc.
  errorDetail: text("errorDetail"),  // short, no PII
  latencyMs: int("latencyMs"),
  retryCount: int("retryCount").default(0),
  parentRequestId: int("parentRequestId"),  // for fallback chain tracking
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  // Prompt 21: Character LoRA tracking
  characterId: int("characterId"),
  loraId: int("loraId"),
  loraStrength: decimal("loraStrength", { precision: 3, scale: 2 }),
});
export type GenerationRequest = typeof generationRequests.$inferSelect;
export type InsertGenerationRequest = typeof generationRequests.$inferInsert;

// ─── Generation Results ──────────────────────────────────────────────────
export const generationResults = mysqlTable("generation_results", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId").notNull().unique(),
  storageUrl: text("storageUrl").notNull(),
  storageSizeBytes: bigint("storageSizeBytes", { mode: "number" }),
  mimeType: varchar("mimeType", { length: 128 }),
  durationSeconds: decimal("durationSeconds", { precision: 8, scale: 3 }),
  metadata: json("metadata"),  // provider-returned metadata
  isDraft: int("isDraft").default(0).notNull(),  // 1=draft, 0=final
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GenerationResult = typeof generationResults.$inferSelect;
export type InsertGenerationResult = typeof generationResults.$inferInsert;

// ─── Provider Rate Limits ────────────────────────────────────────────────
export const providerRateLimits = mysqlTable("provider_rate_limits", {
  id: int("id").autoincrement().primaryKey(),
  providerId: varchar("providerId", { length: 64 }).notNull(),
  apiKeyId: int("apiKeyId").notNull(),
  windowStart: timestamp("windowStart").notNull(),
  requestCount: int("requestCount").default(0).notNull(),
  spendUsd: decimal("spendUsd", { precision: 10, scale: 4 }).default("0").notNull(),
});
export type ProviderRateLimit = typeof providerRateLimits.$inferSelect;
export type InsertProviderRateLimit = typeof providerRateLimits.$inferInsert;

// ─── Provider Quality Scores ─────────────────────────────────────────────
export const providerQualityScores = mysqlTable("provider_quality_scores", {
  id: int("id").autoincrement().primaryKey(),
  providerId: varchar("providerId", { length: 64 }).notNull(),
  sceneType: varchar("sceneType", { length: 64 }).notNull(),
  qualityScore: decimal("qualityScore", { precision: 4, scale: 2 }).notNull(),
  sampleCount: int("sampleCount").default(0).notNull(),
  ratingSource: mysqlEnum("ratingSource", ["creator", "auto_clip", "admin"]).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProviderQualityScore = typeof providerQualityScores.$inferSelect;
export type InsertProviderQualityScore = typeof providerQualityScores.$inferInsert;

// ─── Provider Events (operational log) ───────────────────────────────────
export const providerEvents = mysqlTable("provider_events", {
  id: int("id").autoincrement().primaryKey(),
  providerId: varchar("providerId", { length: 64 }).notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),  // circuit_opened, circuit_closed, fallback_triggered, key_rotated, daily_cap_reached
  severity: mysqlEnum("severity", ["info", "warn", "error", "critical"]).notNull(),
  detail: json("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProviderEvent = typeof providerEvents.$inferSelect;
export type InsertProviderEvent = typeof providerEvents.$inferInsert;

// ─── Provider Spend Summary (refreshed periodically, replaces materialized view) ──
export const providerSpend24h = mysqlTable("provider_spend_24h", {
  providerId: varchar("providerId", { length: 64 }).primaryKey(),
  requests: int("requests").default(0).notNull(),
  spendUsd: decimal("spendUsd", { precision: 10, scale: 4 }).default("0").notNull(),
  avgLatencyMs: int("avgLatencyMs"),
  successRate: decimal("successRate", { precision: 5, scale: 4 }),
  refreshedAt: timestamp("refreshedAt").defaultNow().notNull(),
});
export type ProviderSpend24h = typeof providerSpend24h.$inferSelect;

// ─── Creator Provider Mix (refreshed periodically, replaces materialized view) ──
export const creatorProviderMix7d = mysqlTable("creator_provider_mix_7d", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  providerId: varchar("providerId", { length: 64 }).notNull(),
  requests: int("requests").default(0).notNull(),
  creditsSpent: decimal("creditsSpent", { precision: 10, scale: 4 }).default("0").notNull(),
  platformCogsUsd: decimal("platformCogsUsd", { precision: 10, scale: 4 }).default("0").notNull(),
  refreshedAt: timestamp("refreshedAt").defaultNow().notNull(),
});
export type CreatorProviderMix7d = typeof creatorProviderMix7d.$inferSelect;


// ─── Prompt 19: Hybrid Local/API Inference Infrastructure ────────────────

// ─── Model Artifacts — Versioned model weights in object storage ─────────
export const modelArtifacts = mysqlTable("model_artifacts", {
  id: int("id").autoincrement().primaryKey(),
  modelName: varchar("modelName", { length: 64 }).notNull(),  // e.g. 'animatediff_v3', 'rife_v422'
  version: varchar("version", { length: 32 }).notNull(),  // semver-ish: '1.0.0', '1.1.0'
  artifactPath: text("artifactPath").notNull(),  // S3 path: awakli-model-artifacts/animatediff/v1.0.0/
  sizeBytes: bigint("sizeBytes", { mode: "number" }).notNull(),
  checksumSha256: varchar("checksumSha256", { length: 64 }).notNull(),
  isActive: int("isActive").default(0).notNull(),  // 1=active, 0=inactive; only one active per model
  metadata: json("metadata"),  // additional info: base_model, dependencies, etc.
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ModelArtifact = typeof modelArtifacts.$inferSelect;
export type InsertModelArtifact = typeof modelArtifacts.$inferInsert;

// ─── Local Endpoints — RunPod/Modal serverless endpoints per model ──────
export const localEndpoints = mysqlTable("local_endpoints", {
  id: int("id").autoincrement().primaryKey(),
  providerId: varchar("providerId", { length: 64 }).notNull(),  // refs providers.id (e.g. 'local_animatediff')
  platform: mysqlEnum("platform", ["runpod", "modal"]).notNull(),
  endpointId: varchar("endpointId", { length: 128 }).notNull(),  // RunPod endpoint ID or Modal function name
  endpointUrl: text("endpointUrl").notNull(),
  gpuType: varchar("gpuType", { length: 32 }).notNull(),  // 'h100_sxm', 'a100_80gb', 'rtx_4090'
  modelArtifactId: int("modelArtifactId"),  // refs model_artifacts.id
  scalingConfig: json("scalingConfig").notNull(),  // { min_workers, max_workers, idle_timeout, max_queue_depth, cold_start_budget, warm_pool }
  status: mysqlEnum("endpointStatus", ["active", "draining", "disabled"]).default("active").notNull(),
  warmWorkers: int("warmWorkers").default(0).notNull(),
  queueDepth: int("queueDepth").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LocalEndpoint = typeof localEndpoints.$inferSelect;
export type InsertLocalEndpoint = typeof localEndpoints.$inferInsert;

// ─── GPU Usage Log — Append-only log for cost reconciliation ────────────
export const gpuUsageLog = mysqlTable("gpu_usage_log", {
  id: int("id").autoincrement().primaryKey(),
  generationRequestId: int("generationRequestId"),  // refs generation_requests.id (nullable for standalone ops)
  endpointId: int("endpointId").notNull(),  // refs local_endpoints.id
  gpuType: varchar("gpuType", { length: 32 }).notNull(),
  gpuSeconds: decimal("gpuSeconds", { precision: 10, scale: 3 }).notNull(),
  costUsd: decimal("costUsd", { precision: 10, scale: 6 }).notNull(),
  wasColdStart: int("wasColdStart").default(0).notNull(),  // 1=cold start, 0=warm
  coldStartSeconds: decimal("coldStartSeconds", { precision: 6, scale: 2 }),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelVersion: varchar("modelVersion", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GpuUsageLogEntry = typeof gpuUsageLog.$inferSelect;
export type InsertGpuUsageLogEntry = typeof gpuUsageLog.$inferInsert;

// ─── Prompt 20: Scene-Type Router ─────────────────────────────────────────

// Scene type enum values
export const SCENE_TYPES = ["dialogue", "action", "establishing", "transition", "reaction", "montage"] as const;
export type SceneType = typeof SCENE_TYPES[number];

// Emotion enum values for reaction cache
export const REACTION_EMOTIONS = ["surprise", "anger", "joy", "sadness", "fear", "neutral"] as const;
export type ReactionEmotion = typeof REACTION_EMOTIONS[number];

// Camera angle enum values for reaction cache
export const REACTION_CAMERA_ANGLES = ["front", "three_quarter", "side", "close_up"] as const;
export type ReactionCameraAngle = typeof REACTION_CAMERA_ANGLES[number];

// ─── Scene Classifications ────────────────────────────────────────────────
export const sceneClassifications = mysqlTable("scene_classifications", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  sceneId: int("sceneId").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  sceneType: mysqlEnum("sceneType", ["dialogue", "action", "establishing", "transition", "reaction", "montage"]).notNull(),
  classifierVersion: varchar("classifierVersion", { length: 32 }).default("v1_rule_based").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  metadata: json("metadata").notNull(),  // Input features used for classification (SceneMetadata)
  creatorOverride: mysqlEnum("creatorOverride", ["dialogue", "action", "establishing", "transition", "reaction", "montage"]),
  overrideReason: text("overrideReason"),
  pipelineTemplate: varchar("pipelineTemplate", { length: 64 }).notNull(),  // 'dialogue_inpaint', 'action_premium', etc.
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SceneClassification = typeof sceneClassifications.$inferSelect;
export type InsertSceneClassification = typeof sceneClassifications.$inferInsert;

// ─── Reaction Cache ───────────────────────────────────────────────────────
export const reactionCache = mysqlTable("reaction_cache", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
  emotion: mysqlEnum("emotion", ["surprise", "anger", "joy", "sadness", "fear", "neutral"]).notNull(),
  cameraAngle: mysqlEnum("reactionCameraAngle", ["front", "three_quarter", "side", "close_up"]).notNull(),
  storageUrl: text("storageUrl").notNull(),
  durationS: decimal("durationS", { precision: 5, scale: 2 }).notNull(),
  generationRequestId: int("generationRequestId"),  // refs generation_requests.id
  reusableAcrossEpisodes: int("reusableAcrossEpisodes").default(1).notNull(),  // 1=true, 0=false
  usageCount: int("usageCount").default(0).notNull(),
  createdBy: int("createdBy").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ReactionCacheEntry = typeof reactionCache.$inferSelect;
export type InsertReactionCacheEntry = typeof reactionCache.$inferInsert;

// ─── Scene Type Overrides (training data for V2 classifier) ──────────────
export const sceneTypeOverrides = mysqlTable("scene_type_overrides", {
  id: int("id").autoincrement().primaryKey(),
  sceneClassificationId: int("sceneClassificationId").notNull().references(() => sceneClassifications.id, { onDelete: "cascade" }),
  originalType: mysqlEnum("originalType", ["dialogue", "action", "establishing", "transition", "reaction", "montage"]).notNull(),
  overriddenType: mysqlEnum("overriddenType", ["dialogue", "action", "establishing", "transition", "reaction", "montage"]).notNull(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SceneTypeOverride = typeof sceneTypeOverrides.$inferSelect;
export type InsertSceneTypeOverride = typeof sceneTypeOverrides.$inferInsert;

// ─── Pipeline Templates ──────────────────────────────────────────────────
export const pipelineTemplates = mysqlTable("pipeline_templates", {
  id: varchar("id", { length: 64 }).primaryKey(),  // 'dialogue_inpaint', 'action_premium', etc.
  sceneType: mysqlEnum("templateSceneType", ["dialogue", "action", "establishing", "transition", "reaction", "montage"]).notNull(),
  displayName: varchar("displayName", { length: 128 }).notNull(),
  stages: json("stages").notNull(),  // Ordered list of stage configs
  preferredProviders: json("preferredProviders").notNull(),  // Per-stage provider hints
  skipStages: json("skipStages").notNull(),  // Stage numbers to skip
  estimatedCreditsPerTenS: decimal("estimatedCreditsPerTenS", { precision: 10, scale: 4 }).notNull(),
  isActive: int("isActive").default(1).notNull(),  // 1=active, 0=inactive
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PipelineTemplate = typeof pipelineTemplates.$inferSelect;
export type InsertPipelineTemplate = typeof pipelineTemplates.$inferInsert;


// ═══════════════════════════════════════════════════════════════════════════
// PROMPT 21: Character LoRA Training Pipeline & Asset Library
// ═══════════════════════════════════════════════════════════════════════════

// ─── Character Library ──────────────────────────────────────────────────
export const characterLibrary = mysqlTable("character_library", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  seriesId: int("seriesId"),  // optional grouping by project/series
  description: text("description"),
  appearanceTags: json("appearanceTags"),  // {"hair":"blue","eyes":"red","outfit":"school_uniform"}
  referenceSheetUrl: text("referenceSheetUrl"),
  loraStatus: mysqlEnum("loraStatus", [
    "untrained",
    "pending_admin_approval",
    "training",
    "validating",
    "active",
    "needs_retraining",
    "failed",
  ]).default("untrained").notNull(),
  activeLoraId: int("activeLoraId"),  // references character_loras.id (set after validation)
  activeIpEmbeddingUrl: text("activeIpEmbeddingUrl"),
  activeClipEmbeddingUrl: text("activeClipEmbeddingUrl"),
  usageCount: int("usageCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CharacterLibraryEntry = typeof characterLibrary.$inferSelect;
export type InsertCharacterLibraryEntry = typeof characterLibrary.$inferInsert;

// ─── Character LoRAs (versioned) ────────────────────────────────────────
export const characterLoras = mysqlTable("character_loras", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characterLibrary.id, { onDelete: "cascade" }),
  version: int("version").notNull(),
  artifactPath: text("artifactPath").notNull(),  // S3 path: characters/{id}/lora/{version}/lora.safetensors
  artifactSizeBytes: bigint("artifactSizeBytes", { mode: "number" }).notNull(),
  trainingParams: json("trainingParams").notNull(),  // {rank, alpha, lr, steps, baseModel, scheduler, optimizer}
  trainingLossFinal: decimal("trainingLossFinal", { precision: 8, scale: 6 }),
  qualityScore: int("qualityScore"),  // 0-100 (mapped from CLIP similarity)
  clipSimilarity: decimal("clipSimilarity", { precision: 5, scale: 4 }),  // 0.0000-1.0000
  validationStatus: mysqlEnum("validationStatus", [
    "pending",
    "validating",
    "approved",
    "rejected",
    "deprecated",
  ]).default("pending").notNull(),
  status: mysqlEnum("loraVersionStatus", [
    "training",
    "active",
    "deprecated",
    "failed",
  ]).default("training").notNull(),
  triggerWord: varchar("triggerWord", { length: 100 }).notNull(),  // 'awakli_charactername'
  validationImageUrls: json("validationImageUrls"),  // string[] of 5 test image URLs
  deprecatedAt: timestamp("deprecatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CharacterLora = typeof characterLoras.$inferSelect;
export type InsertCharacterLora = typeof characterLoras.$inferInsert;

// ─── LoRA Training Jobs ─────────────────────────────────────────────────
export const loraTrainingJobs = mysqlTable("lora_training_jobs", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characterLibrary.id, { onDelete: "cascade" }),
  loraId: int("loraId"),  // references character_loras.id (set after LoRA record created)
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("trainingJobStatus", [
    "pending_admin_approval",
    "queued",
    "preprocessing",
    "training",
    "validating",
    "completed",
    "failed",
    "cancelled",
  ]).default("pending_admin_approval").notNull(),
  priority: int("priority").default(5).notNull(),  // 1=highest, 10=lowest
  runpodJobId: varchar("runpodJobId", { length: 255 }),
  gpuType: varchar("gpuType", { length: 32 }),  // 'h100_sxm', 'a100_80gb', 'rtx_4090'
  gpuSeconds: decimal("gpuSeconds", { precision: 10, scale: 3 }),
  costUsd: decimal("costUsd", { precision: 10, scale: 4 }),
  costCredits: decimal("costCredits", { precision: 10, scale: 4 }),
  estimatedCostCents: int("estimatedCostCents"),  // Pre-computed cost estimate for admin review
  errorMessage: text("errorMessage"),
  rejectionReason: text("rejectionReason"),  // Admin rejection reason
  batchId: varchar("batchId", { length: 64 }),  // groups jobs in a batch training session
  adminApprovedBy: int("adminApprovedBy"),  // Admin who approved training
  adminApprovedAt: timestamp("adminApprovedAt"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LoraTrainingJob = typeof loraTrainingJobs.$inferSelect;
export type InsertLoraTrainingJob = typeof loraTrainingJobs.$inferInsert;

// ─── Character Assets (reference sheets, embeddings, etc.) ──────────────
export const characterAssets = mysqlTable("character_assets", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characterLibrary.id, { onDelete: "cascade" }),
  assetType: mysqlEnum("assetType", [
    "reference_sheet",
    "reference_image",
    "lora",
    "ip_adapter_embedding",
    "clip_embedding",
  ]).notNull(),
  storageUrl: text("storageUrl").notNull(),
  version: int("version").default(1).notNull(),
  metadata: json("metadata"),  // {width, height, caption, viewAngle, etc.}
  isActive: int("isActive").default(1).notNull(),  // 1=true, 0=false
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CharacterAsset = typeof characterAssets.$inferSelect;
export type InsertCharacterAsset = typeof characterAssets.$inferInsert;

// ─── Pipeline Run LoRA Pins (version pinning per pipeline run) ──────────
export const pipelineRunLoraPins = mysqlTable("pipeline_run_lora_pins", {
  id: int("id").autoincrement().primaryKey(),
  pipelineRunId: int("pipelineRunId").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  characterId: int("characterId").notNull().references(() => characterLibrary.id, { onDelete: "cascade" }),
  loraId: int("loraId").notNull().references(() => characterLoras.id, { onDelete: "cascade" }),
  pinnedAt: timestamp("pinnedAt").defaultNow().notNull(),
});
export type PipelineRunLoraPin = typeof pipelineRunLoraPins.$inferSelect;
export type InsertPipelineRunLoraPin = typeof pipelineRunLoraPins.$inferInsert;

// ─── Fix Drift Jobs (persistence for targeted re-generation) ──────────
export const fixDriftJobs = mysqlTable("fix_drift_jobs", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characterLibrary.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  generationId: int("generationId").notNull(),
  episodeId: int("episodeId").notNull(),
  sceneId: int("sceneId"),
  frameIndex: int("frameIndex").notNull(),
  originalResultUrl: text("originalResultUrl"),
  originalDriftScore: float("originalDriftScore").notNull(),
  originalLoraStrength: float("originalLoraStrength"),
  boostedLoraStrength: float("boostedLoraStrength").notNull(),
  boostDelta: float("boostDelta").notNull(),
  severity: mysqlEnum("fixSeverity", ["warning", "critical"]).notNull(),
  targetFeatures: json("targetFeatures"),  // string[]
  fixConfidence: mysqlEnum("fixConfidence", ["high", "medium", "low"]).notNull(),
  estimatedCredits: int("estimatedCredits").notNull(),
  estimatedSeconds: int("estimatedSeconds").notNull(),
  status: mysqlEnum("fixDriftStatus", ["queued", "processing", "completed", "failed"]).default("queued").notNull(),
  progress: int("fixProgress").default(0).notNull(),
  newResultUrl: text("newResultUrl"),
  newDriftScore: float("newDriftScore"),
  driftImprovement: float("driftImprovement"),
  errorMessage: text("fixErrorMessage"),
  queuedAt: timestamp("queuedAt").defaultNow().notNull(),
  startedAt: timestamp("fixStartedAt"),
  completedAt: timestamp("fixCompletedAt"),
});
export type FixDriftJob = typeof fixDriftJobs.$inferSelect;
export type InsertFixDriftJob = typeof fixDriftJobs.$inferInsert;

// ─── Lineart Assets (Prompt 22: Lineart Extraction & ControlNet Pipeline) ─
export const lineartAssets = mysqlTable("lineart_assets", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  sceneId: int("sceneId"),
  panelIndex: int("panelIndex").notNull(),
  extractionMethod: mysqlEnum("extractionMethod", ["canny", "anime2sketch"]).notNull(),
  storageUrl: text("storageUrl").notNull(),
  sourcePanelUrl: text("sourcePanelUrl").notNull(),
  resolutionW: int("resolutionW").notNull(),
  resolutionH: int("resolutionH").notNull(),
  version: int("lineartVersion").default(1).notNull(),
  snrDb: float("snrDb"),
  isActive: int("lineartIsActive").default(1).notNull(),
  createdAt: timestamp("lineartCreatedAt").defaultNow().notNull(),
});
export type LineartAsset = typeof lineartAssets.$inferSelect;
export type InsertLineartAsset = typeof lineartAssets.$inferInsert;

// ─── ControlNet Configs (per user, per scene type) ────────────────────────
export const controlnetConfigs = mysqlTable("controlnet_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sceneType: mysqlEnum("cnSceneType", ["dialogue", "action", "establishing", "reaction", "montage", "transition"]).notNull(),
  controlnetMode: mysqlEnum("controlnetMode", ["canny", "lineart", "lineart_anime", "depth"]).default("lineart_anime").notNull(),
  conditioningStrength: float("conditioningStrength").notNull(),
  extractionMethod: mysqlEnum("cnExtractionMethod", ["canny", "anime2sketch"]).default("anime2sketch").notNull(),
  isDefault: int("cnIsDefault").default(1).notNull(),
  createdAt: timestamp("cnCreatedAt").defaultNow().notNull(),
  updatedAt: timestamp("cnUpdatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ControlnetConfig = typeof controlnetConfigs.$inferSelect;
export type InsertControlnetConfig = typeof controlnetConfigs.$inferInsert;

// ─── Lineart Batch Jobs (batch extraction tracking) ───────────────────────
export const lineartBatchJobs = mysqlTable("lineart_batch_jobs", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("batchEpisodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  totalPanels: int("totalPanels").notNull(),
  completedPanels: int("completedPanels").default(0).notNull(),
  failedPanels: int("failedPanels").default(0).notNull(),
  extractionMethod: mysqlEnum("batchExtractionMethod", ["canny", "anime2sketch", "mixed"]).notNull(),
  status: mysqlEnum("batchStatus", ["queued", "running", "completed", "failed"]).default("queued").notNull(),
  startedAt: timestamp("batchStartedAt"),
  completedAt: timestamp("batchCompletedAt"),
  costCredits: float("costCredits").default(0).notNull(),
  errorLog: json("batchErrorLog"),
  createdAt: timestamp("batchCreatedAt").defaultNow().notNull(),
});
export type LineartBatchJob = typeof lineartBatchJobs.$inferSelect;
export type InsertLineartBatchJob = typeof lineartBatchJobs.$inferInsert;

// ─── Prompt 23: Tier Sampler Library & Expectation-Setting UX ─────────

export const tierSamples = mysqlTable("tier_samples", {
  id: int("id").autoincrement().primaryKey(),
  archetypeId: varchar("archetypeId", { length: 10 }).notNull(), // V01-V12 or A01-A08
  modality: mysqlEnum("modality", ["visual", "audio"]).notNull(),
  tier: int("tier").notNull(), // 1-5
  provider: varchar("provider", { length: 100 }).notNull(),
  genreVariant: mysqlEnum("genreVariant", ["action", "slice_of_life", "atmospheric", "neutral"]).notNull(),
  outcomeClass: mysqlEnum("outcomeClass", ["success", "partial_success", "expected_failure"]).notNull(),
  failureMode: varchar("failureMode", { length: 100 }), // nullable: morph_artifact, character_drift, motion_stall, etc.
  creditsConsumed: float("creditsConsumed").notNull(),
  storageUrl: text("storageUrl").notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  durationMs: int("durationMs"),
  generationSeed: bigint("generationSeed", { mode: "number" }).notNull(),
  reviewedBy: json("reviewedBy").notNull(), // Array of {role, reviewerId, decision, timestamp}
  publishedAt: timestamp("publishedAt").notNull(),
  stalenessScore: float("stalenessScore").notNull().default(0), // 0-1
  isActive: int("isActive").notNull().default(1), // boolean: 1=active, 0=archived
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TierSample = typeof tierSamples.$inferSelect;
export type InsertTierSample = typeof tierSamples.$inferInsert;

export const expectationAnchors = mysqlTable("expectation_anchors", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sceneType: varchar("sceneType", { length: 50 }).notNull(), // dialogue, action, establishing, etc.
  anchoredSampleId: int("anchoredSampleId").notNull().references(() => tierSamples.id),
  anchoredTier: int("anchoredTier").notNull(), // tier of the anchored sample
  selectedTier: int("selectedTier"), // actual tier selected (populated at selection time)
  anchorConfidence: float("anchorConfidence"), // optional 0-1
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ExpectationAnchor = typeof expectationAnchors.$inferSelect;
export type InsertExpectationAnchor = typeof expectationAnchors.$inferInsert;

export const esgScores = mysqlTable("esg_scores", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  sceneType: varchar("sceneType", { length: 50 }).notNull(),
  expectationTier: int("expectationTier").notNull(),
  actualTier: int("actualTier").notNull(),
  expectedSatisfaction: float("expectedSatisfaction").notNull(), // baseline for actual_tier
  satisfactionScore: float("satisfactionScore").notNull(), // creator rating 1-5
  esg: float("esg").notNull(), // computed gap
  routingAction: mysqlEnum("routingAction", ["none", "monitor", "investigate", "act"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EsgScore = typeof esgScores.$inferSelect;
export type InsertEsgScore = typeof esgScores.$inferInsert;

export const samplerAbAssignments = mysqlTable("sampler_ab_assignments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  cohort: mysqlEnum("cohort", ["control", "sampler"]).notNull(),
  enrolledAt: timestamp("enrolledAt").defaultNow().notNull(),
  exitedAt: timestamp("exitedAt"),
});

export type SamplerAbAssignment = typeof samplerAbAssignments.$inferSelect;
export type InsertSamplerAbAssignment = typeof samplerAbAssignments.$inferInsert;

// ─── Motion LoRA (Prompt 24) ──────────────────────────────────────────────

/**
 * Tracks trained motion LoRA artifacts per character.
 * Each character may have multiple versions; only the latest "promoted" one is active.
 */
export const motionLoras = mysqlTable("motion_loras", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: int("version").notNull().default(1),
  trainingPath: mysqlEnum("trainingPath", ["sdxl_kohya", "wan_fork"]).notNull(),
  status: mysqlEnum("status", [
    "queued",       // Waiting for GPU slot
    "training",     // Training in progress
    "evaluating",   // Running M1-M14 gates
    "promoted",     // Passed evaluation, active for use
    "blocked",      // Failed critical gates
    "needs_review", // Passed but flagged for manual review
    "retired",      // Superseded by newer version
  ]).notNull().default("queued"),
  artifactUrl: text("artifactUrl"),           // S3 URL to .safetensors file
  artifactKey: text("artifactKey"),           // S3 key for the artifact
  triggerToken: varchar("triggerToken", { length: 100 }),
  trainingSteps: int("trainingSteps").default(3500),
  trainingClipCount: int("trainingClipCount"),
  frameCount: int("frameCount").default(16),
  baseWeight: float("baseWeight").default(0.60),
  /** JSON: evaluation gate results { gateId, pass, score, notes }[] */
  evaluationResults: json("evaluationResults"),
  /** Final verdict from evaluation: promoted | blocked | needs_review */
  evaluationVerdict: mysqlEnum("evaluationVerdict", ["promoted", "blocked", "needs_review"]),
  evaluationCostUsd: float("evaluationCostUsd"),
  trainingCostCredits: float("trainingCostCredits"),
  trainingStartedAt: timestamp("trainingStartedAt"),
  trainingCompletedAt: timestamp("trainingCompletedAt"),
  evaluatedAt: timestamp("evaluatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MotionLora = typeof motionLoras.$inferSelect;
export type InsertMotionLora = typeof motionLoras.$inferInsert;

/**
 * Training configuration snapshots for motion LoRA jobs.
 * Stores the exact hyperparameters used for reproducibility.
 */
export const motionLoraConfigs = mysqlTable("motion_lora_configs", {
  id: int("id").autoincrement().primaryKey(),
  motionLoraId: int("motionLoraId").notNull().references(() => motionLoras.id, { onDelete: "cascade" }),
  /** JSON: full Kohya-SS or Wan config snapshot */
  config: json("config").notNull(),
  /** Training path determines config schema */
  trainingPath: mysqlEnum("trainingPath", ["sdxl_kohya", "wan_fork"]).notNull(),
  /** Key hyperparameters extracted for quick access */
  learningRate: float("learningRate"),
  rank: int("rank"),
  alpha: int("alpha"),
  networkDim: int("networkDim"),
  batchSize: int("batchSize"),
  resolution: varchar("resolution", { length: 20 }),  // e.g., "512x512"
  schedulerType: varchar("schedulerType", { length: 50 }),
  optimizerType: varchar("optimizerType", { length: 50 }),
  /** Caption template used for training */
  captionTemplate: text("captionTemplate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MotionLoraConfig = typeof motionLoraConfigs.$inferSelect;
export type InsertMotionLoraConfig = typeof motionLoraConfigs.$inferInsert;

/**
 * Tracks which motion categories (scene types) are covered by a character's
 * trained motion LoRA. Used to identify coverage gaps and prioritize retraining.
 */
export const motionCoverageMatrix = mysqlTable("motion_coverage_matrix", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("characterId").notNull().references(() => characters.id, { onDelete: "cascade" }),
  motionLoraId: int("motionLoraId").notNull().references(() => motionLoras.id, { onDelete: "cascade" }),
  sceneType: varchar("sceneType", { length: 50 }).notNull(),  // e.g., "action-combat", "dialogue-gestured"
  /** Number of training clips for this scene type */
  clipCount: int("clipCount").notNull().default(0),
  /** Average quality score from evaluation gates for this scene type */
  qualityScore: float("qualityScore"),
  /** Whether this scene type passed evaluation */
  passed: int("passed").default(0),  // 0 = not evaluated, 1 = passed, -1 = failed
  /** Last evaluation timestamp */
  evaluatedAt: timestamp("evaluatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MotionCoverageMatrix = typeof motionCoverageMatrix.$inferSelect;
export type InsertMotionCoverageMatrix = typeof motionCoverageMatrix.$inferInsert;


// ─── Image Router: Generation Costs (Prompt 25) ────────────────────────

/**
 * Tracks per-image generation costs for cost attribution, budget governance,
 * and per-chapter / per-provider burn dashboards.
 */
export const generationCosts = mysqlTable("generation_costs", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("job_id", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  providerId: varchar("provider_id", { length: 64 }).notNull(),
  workloadType: varchar("workload_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // Cost attribution
  estimatedCostUsd: decimal("estimated_cost_usd", { precision: 10, scale: 6 }),
  actualCostUsd: decimal("actual_cost_usd", { precision: 10, scale: 6 }),
  actualCostCredits: decimal("actual_cost_credits", { precision: 10, scale: 4 }),
  // Image parameters
  prompt: text("prompt"),
  width: int("width"),
  height: int("height"),
  numImages: int("num_images").default(1),
  controlNetModel: varchar("control_net_model", { length: 64 }),
  loraModelUrl: text("lora_model_url"),
  // Result
  resultUrl: text("result_url"),
  resultMimeType: varchar("result_mime_type", { length: 32 }),
  latencyMs: int("latency_ms"),
  attemptCount: int("attempt_count").default(1),
  errorMessage: text("error_message"),
  errorCode: varchar("error_code", { length: 32 }),
  // Context
  userId: int("user_id").notNull(),
  episodeId: int("episode_id"),
  chapterId: int("chapter_id"),
  sceneId: int("scene_id"),
  // Provider metadata (JSON)
  providerMetadata: json("provider_metadata"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  submittedAt: timestamp("submitted_at"),
  completedAt: timestamp("completed_at"),
});
export type GenerationCost = typeof generationCosts.$inferSelect;
export type InsertGenerationCost = typeof generationCosts.$inferInsert;


// ─── A/B Experiments ─────────────────────────────────────────────────────

export const abExperiments = mysqlTable("ab_experiments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  controlProvider: varchar("control_provider", { length: 50 }).notNull(),
  variantProvider: varchar("variant_provider", { length: 50 }).notNull(),
  trafficSplitPercent: int("traffic_split_percent").notNull().default(20),
  workloadTypes: json("workload_types").$type<string[]>().default([]),
  status: mysqlEnum("status", ["draft", "running", "paused", "completed", "cancelled"]).notNull().default("draft"),
  minSampleSize: int("min_sample_size").notNull().default(30),
  createdBy: int("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
});
export type ABExperiment = typeof abExperiments.$inferSelect;
export type InsertABExperiment = typeof abExperiments.$inferInsert;

// ─── A/B Experiment Results ──────────────────────────────────────────────

export const abExperimentResults = mysqlTable("ab_experiment_results", {
  id: varchar("id", { length: 36 }).primaryKey(),
  experimentId: varchar("experiment_id", { length: 36 }).notNull(),
  arm: mysqlEnum("arm", ["control", "variant"]).notNull(),
  providerId: varchar("provider_id", { length: 50 }).notNull(),
  jobId: varchar("job_id", { length: 36 }).notNull(),
  workloadType: varchar("workload_type", { length: 50 }).notNull(),
  latencyMs: int("latency_ms").notNull().default(0),
  costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  qualityScore: int("quality_score"),
  succeeded: int("succeeded").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ABExperimentResult = typeof abExperimentResults.$inferSelect;
export type InsertABExperimentResult = typeof abExperimentResults.$inferInsert;

// ─── Batch Jobs ──────────────────────────────────────────────────────────

export const batchJobs = mysqlTable("batch_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed", "cancelled"]).notNull().default("pending"),
  totalItems: int("total_items").notNull().default(0),
  completedItems: int("completed_items").notNull().default(0),
  failedItems: int("failed_items").notNull().default(0),
  totalCostUsd: decimal("total_cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  /** Webhook URL to notify on batch completion */
  webhookUrl: text("webhook_url"),
  /** Secret for signing webhook payloads */
  webhookSecret: varchar("webhook_secret", { length: 128 }),
  /** Batch configuration (workload type, prompts, etc.) */
  config: json("config").$type<Record<string, unknown>>(),
  /** Error summary if batch failed */
  errorSummary: text("error_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});
export type BatchJob = typeof batchJobs.$inferSelect;
export type InsertBatchJob = typeof batchJobs.$inferInsert;

// ─── Batch Job Items ─────────────────────────────────────────────────────

export const batchJobItems = mysqlTable("batch_job_items", {
  id: varchar("id", { length: 36 }).primaryKey(),
  batchId: varchar("batch_id", { length: 36 }).notNull(),
  /** Index within the batch (0-based) */
  itemIndex: int("item_index").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "succeeded", "failed"]).notNull().default("pending"),
  prompt: text("prompt").notNull(),
  workloadType: varchar("workload_type", { length: 50 }).notNull(),
  width: int("width").notNull().default(1024),
  height: int("height").notNull().default(1024),
  /** Provider that handled this item */
  providerId: varchar("provider_id", { length: 50 }),
  /** Result image URL */
  resultUrl: text("result_url"),
  costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  latencyMs: int("latency_ms"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});
export type BatchJobItem = typeof batchJobItems.$inferSelect;
export type InsertBatchJobItem = typeof batchJobItems.$inferInsert;


// ═══════════════════════════════════════════════════════════════════════════
// PROMPT 26: Character Bible & Spatial Consistency Pipeline
// ═══════════════════════════════════════════════════════════════════════════

// ─── Character Registries (P26 §3.2) ────────────────────────────────────
// Authoritative structured representation of every character in a story.
// Created in Stage 1 (Character Bible), read by Stages 2-5.
// Immutable once generation begins; mutations create a new version.
export const characterRegistries = mysqlTable("character_registries", {
  id: int("id").autoincrement().primaryKey(),
  storyId: int("story_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  registryJson: json("registry_json").notNull(), // CharacterRegistry JSON
  version: int("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CharacterRegistryRow = typeof characterRegistries.$inferSelect;
export type InsertCharacterRegistryRow = typeof characterRegistries.$inferInsert;

// ─── Spatial QA Results (P26 §8) ────────────────────────────────────────
// Stores QA gate check results per panel for audit and debugging.
export const spatialQaResults = mysqlTable("spatial_qa_results", {
  id: int("id").autoincrement().primaryKey(),
  panelId: int("panel_id").notNull().references(() => panels.id, { onDelete: "cascade" }),
  episodeId: int("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Check 1: Face similarity
  faceSimilarityScore: float("face_similarity_score"),
  faceSimilarityVerdict: mysqlEnum("face_similarity_verdict", ["pass", "soft_fail", "hard_fail", "skipped"]).default("skipped"),
  // Check 2: Height ratio compliance
  heightRatioDeviation: float("height_ratio_deviation"),
  heightRatioVerdict: mysqlEnum("height_ratio_verdict", ["pass", "soft_fail", "hard_fail", "skipped"]).default("skipped"),
  // Check 3: Style coherence
  styleCoherenceScore: float("style_coherence_score"),
  styleCoherenceVerdict: mysqlEnum("style_coherence_verdict", ["pass", "soft_fail", "hard_fail", "skipped"]).default("skipped"),
  // Overall
  overallVerdict: mysqlEnum("overall_verdict", ["pass", "soft_fail", "hard_fail"]).default("pass"),
  regenerationCount: int("regeneration_count").default(0),
  details: json("details"), // Full check details JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SpatialQaResult = typeof spatialQaResults.$inferSelect;
export type InsertSpatialQaResult = typeof spatialQaResults.$inferInsert;

// ─── Scene Provider Pins (P26 §7.2) ─────────────────────────────────────
// Tracks which provider was pinned for each scene to enforce consistency.
export const sceneProviderPins = mysqlTable("scene_provider_pins", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeId: int("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  sceneNumber: int("scene_number").notNull(),
  providerId: varchar("provider_id", { length: 50 }).notNull(),
  qualityTier: mysqlEnum("quality_tier", ["draft", "hero"]).default("draft").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SceneProviderPin = typeof sceneProviderPins.$inferSelect;
export type InsertSceneProviderPin = typeof sceneProviderPins.$inferInsert;

// ─── Project Checkpoints (F3: Project Persistence) ─────────────────────────
// Records every stage transition with inputs, outputs, credits spent, and timestamp.
export const projectCheckpoints = mysqlTable("project_checkpoints", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  stageFrom: int("stageFrom").notNull(),  // 0-6
  stageTo: int("stageTo").notNull(),      // 0-6
  inputs: json("inputs"),                 // Snapshot of what was provided at this stage
  outputs: json("outputs"),               // Snapshot of what was produced at this stage
  creditsSpent: int("creditsSpent").default(0),
  metadata: json("metadata"),             // Additional context (tier, validation results, etc.)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProjectCheckpoint = typeof projectCheckpoints.$inferSelect;
export type InsertProjectCheckpoint = typeof projectCheckpoints.$inferInsert;

// ─── Video Slices (10-second clip decomposition) ─────────────────────────

export const videoSlices = mysqlTable("video_slices", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sceneId: int("sceneId"),  // Reference to the source scene from the script
  sliceNumber: int("sliceNumber").notNull(),  // Sequential order within the episode (1-based)
  durationSeconds: float("durationSeconds").default(10).notNull(),  // Target duration (typically 10s, min 5, max 15)

  // Content metadata
  characters: json("characters"),  // [{characterId, name, role, elementId?, loraId?}]
  dialogue: json("dialogue"),  // [{characterId, text, emotion, startOffset, endOffset}]
  actionDescription: text("actionDescription"),  // What happens visually in this slice
  cameraAngle: mysqlEnum("cameraAngle", ["wide", "medium", "close-up", "extreme-close-up", "birds-eye", "panning", "tracking"]).default("medium"),
  mood: varchar("mood", { length: 100 }),  // e.g. "tense", "calm", "dramatic", "comedic"
  panelIds: json("panelIds"),  // Array of panel IDs that map to this slice

  // Complexity & routing
  complexityTier: int("complexityTier").default(1).notNull(),  // 1 (highest/V3 Omni) to 4 (lowest/V1.6)
  complexityReason: text("complexityReason"),  // Why this tier was assigned
  klingModel: mysqlEnum("klingModel", ["v3_omni", "v2_6", "v2_1", "v1_6"]).default("v3_omni").notNull(),
  klingMode: mysqlEnum("klingMode", ["professional", "standard"]).default("professional").notNull(),
  lipSyncRequired: int("lipSyncRequired").default(0).notNull(),  // 1 if dialogue present → forces V3 Omni
  userOverrideTier: int("userOverrideTier"),  // User can override the auto-assigned tier

  // Core scene preview
  coreScenePrompt: text("coreScenePrompt"),  // The prompt used to generate the core scene image
  coreSceneImageUrl: text("coreSceneImageUrl"),
  coreSceneStatus: mysqlEnum("coreSceneStatus", ["pending", "generating", "generated", "approved", "rejected"]).default("pending").notNull(),
  coreSceneAttempts: int("coreSceneAttempts").default(0),

  // Video clip
  videoClipUrl: text("videoClipUrl"),
  videoClipStatus: mysqlEnum("videoClipStatus", ["pending", "generating", "generated", "approved", "rejected", "failed"]).default("pending").notNull(),
  videoClipAttempts: int("videoClipAttempts").default(0),
  videoClipDurationMs: int("videoClipDurationMs"),  // Actual duration after generation

  // Voice & audio
  voiceAudioUrl: text("voiceAudioUrl"),  // Pre-generated voice audio for this slice
  voiceAudioDurationMs: int("voiceAudioDurationMs"),

  // Credits
  estimatedCredits: int("estimatedCredits").default(0),  // Pre-calculated cost estimate
  actualCredits: int("actualCredits"),  // Actual credits spent after generation

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoSlice = typeof videoSlices.$inferSelect;
export type InsertVideoSlice = typeof videoSlices.$inferInsert;

// ─── Assembly Queue (Milestone 8: Batch Assembly) ───────────────────────

export const assemblyQueue = mysqlTable("assembly_queue", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  batchId: varchar("batchId", { length: 64 }).notNull(),  // Groups episodes submitted together
  status: mysqlEnum("assemblyQueueStatus", [
    "queued",
    "assembling",
    "streaming",    // Assembly done, now uploading to Cloudflare Stream
    "completed",
    "failed",
  ]).default("queued").notNull(),
  priority: int("priority").default(5).notNull(),  // 1=highest, 10=lowest
  position: int("position").notNull(),  // Order within the batch (1-based)
  error: text("error"),
  retryCount: int("retryCount").default(0).notNull(),
  estimatedCredits: int("estimatedCredits").default(0),
  actualCredits: int("actualCredits"),
  queuedAt: timestamp("queuedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
});

export type AssemblyQueueItem = typeof assemblyQueue.$inferSelect;
export type InsertAssemblyQueueItem = typeof assemblyQueue.$inferInsert;

// ─── Episode Views (Milestone 9: Analytics) ─────────────────────────────

export const episodeViews = mysqlTable("episode_views", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  viewerUserId: int("viewerUserId"),  // Nullable for anonymous viewers
  viewerIpHash: varchar("viewerIpHash", { length: 64 }),  // SHA-256 hashed IP for privacy
  watchDurationSeconds: int("watchDurationSeconds").default(0),
  completionPercent: int("completionPercent").default(0),  // 0-100
  country: varchar("country", { length: 2 }),  // ISO 3166-1 alpha-2
  device: mysqlEnum("deviceType", ["desktop", "mobile", "tablet", "unknown"]).default("unknown"),
  referrer: varchar("referrer", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EpisodeView = typeof episodeViews.$inferSelect;
export type InsertEpisodeView = typeof episodeViews.$inferInsert;

// ─── Episode Subtitles (Multi-Language) ─────────────────────────────────

export const episodeSubtitles = mysqlTable("episode_subtitles", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episodeId").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  language: varchar("language", { length: 10 }).notNull(),  // ISO 639-1 code: en, ja, es, fr, de, pt, ko, zh
  label: varchar("label", { length: 64 }).notNull(),  // Human-readable: "English", "Japanese", etc.
  srtUrl: text("srtUrl"),
  vttUrl: text("vttUrl"),
  status: mysqlEnum("status", ["pending", "translating", "converting", "uploading", "ready", "error"]).default("pending").notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EpisodeSubtitle = typeof episodeSubtitles.$inferSelect;
export type InsertEpisodeSubtitle = typeof episodeSubtitles.$inferInsert;

// ─── Background Asset Library ───────────────────────────────────────────

export const backgroundAssets = mysqlTable("background_assets", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  locationName: varchar("locationName", { length: 256 }).notNull(),
  imageUrl: text("imageUrl").notNull(),
  fileKey: text("fileKey"),
  styleTag: varchar("styleTag", { length: 64 }),  // e.g., "shonen", "seinen", "shoujo"
  resolution: varchar("resolution", { length: 32 }),  // e.g., "1024x576"
  tags: json("tags").$type<string[]>(),  // searchable tags: ["city", "night", "rain"]
  usageCount: int("usageCount").default(0).notNull(),
  sourceEpisodeId: int("sourceEpisodeId"),  // which episode first generated this bg
  sourcePanelId: int("sourcePanelId"),  // which panel first generated this bg
  promptUsed: text("promptUsed"),  // the generation prompt for reproducibility
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BackgroundAsset = typeof backgroundAssets.$inferSelect;
export type InsertBackgroundAsset = typeof backgroundAssets.$inferInsert;

// ─── Voice Line Cache ───────────────────────────────────────────────────

export const voiceCache = mysqlTable("voice_cache", {
  id: int("id").autoincrement().primaryKey(),
  voiceId: varchar("voiceId", { length: 128 }).notNull(),  // ElevenLabs voice ID
  textHash: varchar("textHash", { length: 64 }).notNull(),  // SHA-256 of normalized text
  text: text("text").notNull(),  // Original text for display
  emotion: varchar("emotion", { length: 32 }),  // e.g., "neutral", "excited", "sad"
  audioUrl: text("audioUrl").notNull(),
  fileKey: text("fileKey"),
  durationMs: int("durationMs"),
  usageCount: int("usageCount").default(0).notNull(),
  projectId: int("projectId"),  // null for common interjections shared across projects
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VoiceCacheEntry = typeof voiceCache.$inferSelect;
export type InsertVoiceCacheEntry = typeof voiceCache.$inferInsert;

// ─── LoRA Marketplace ───────────────────────────────────────────────────

export const loraMarketplaceLicenseEnum = mysqlEnum("lora_license", [
  "free",
  "attribution",
  "commercial",
  "exclusive",
]);

export const loraMarketplaceCategoryEnum = mysqlEnum("lora_category", [
  "character",
  "style",
  "background",
  "effect",
  "general",
]);

export const loraMarketplace = mysqlTable("lora_marketplace", {
  id: int("id").autoincrement().primaryKey(),
  creatorId: int("creatorId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  previewImages: text("previewImages"), // JSON array of URLs
  downloads: int("downloads").default(0).notNull(),
  ratingSum: int("ratingSum").default(0).notNull(),
  ratingCount: int("ratingCount").default(0).notNull(),
  license: loraMarketplaceLicenseEnum.default("free").notNull(),
  priceCents: int("priceCents").default(0).notNull(), // 0 = free
  tags: text("tags"), // JSON array of strings
  category: loraMarketplaceCategoryEnum.default("character").notNull(),
  loraFileKey: text("loraFileKey"), // S3 key for the LoRA weights
  loraFileUrl: text("loraFileUrl"), // S3 URL for the LoRA weights
  baseModelId: varchar("baseModelId", { length: 64 }), // which base model this LoRA targets
  trainingCreditsUsed: int("trainingCreditsUsed"),
  isPublished: int("isPublished").default(0).notNull(), // MySQL boolean: 0=false, 1=true
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type LoraMarketplaceEntry = typeof loraMarketplace.$inferSelect;
export type InsertLoraMarketplaceEntry = typeof loraMarketplace.$inferInsert;

export const loraMarketplaceReviews = mysqlTable("lora_marketplace_reviews", {
  id: int("id").autoincrement().primaryKey(),
  loraId: int("loraId").notNull(),
  userId: int("userId").notNull(),
  rating: int("rating").notNull(), // 1-5
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LoraReview = typeof loraMarketplaceReviews.$inferSelect;
export type InsertLoraReview = typeof loraMarketplaceReviews.$inferInsert;


// ─── Founders' Studio Interest Submissions ──────────────────────────────
// Pipeline Blueprint v1.9 §7C — Express Interest form for the Founders' Studio program.
// Captures minimal data for outbound triage; no promise of acceptance.

export const founderInterest = mysqlTable("founder_interest", {
  id: int("id").autoincrement().primaryKey(),
  /** Authenticated user who submitted (null if submitted before login) */
  userId: int("user_id"),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  /** Primary output track: manga-only, genga (key animation collector), or full anime */
  outputTrack: mysqlEnum("output_track", ["manga", "genga", "full_anime"]).notNull(),
  /** Required portfolio link (ArtStation, Pixiv, personal site, etc.) */
  portfolioUrl: text("portfolio_url").notNull(),
  /** Optional genre focus */
  genreFocus: varchar("genre_focus", { length: 200 }),
  /** Short paragraph: what they'd want to make during the program */
  pitch: text("pitch").notNull(),
  /** Admin triage status */
  status: mysqlEnum("status", ["new", "reviewing", "shortlisted", "contacted", "declined"]).notNull().default("new"),
  /** Internal admin notes */
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FounderInterest = typeof founderInterest.$inferSelect;
export type InsertFounderInterest = typeof founderInterest.$inferInsert;


// ═══════════════════════════════════════════════════════════════════════════
// D5.5: Per-Clip Quality Gate (Pre-Assembly Review)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stores per-clip quality review results from the D5.5 gate.
 * Unlike D5 (post-assembly, whole-episode), D5.5 runs per-clip BEFORE assembly,
 * catching issues early when re-rolls are cheap (~$0.20/clip).
 *
 * Retry budget: up to 3 attempts per clip before escalation.
 */
export const clipQualityReviews = mysqlTable("clip_quality_reviews", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sliceId: int("slice_id").notNull(),  // References video_slices.sliceNumber
  pipelineRunId: int("pipeline_run_id"),  // References pipeline_runs.id if available

  // Attempt tracking
  attempt: int("attempt").notNull().default(1),  // 1-based attempt number (max 3 before escalation)
  
  // Scores (1-5 scale, matching D5 schema for consistency)
  characterConsistency: int("character_consistency").notNull(),
  styleScore: int("style_score").notNull(),
  promptAlignment: int("prompt_alignment").notNull(),
  motionQuality: int("motion_quality").notNull(),  // NEW: D5.5-specific — motion fluidity, no morphing
  overallScore: int("overall_score").notNull(),  // Weighted average of above 4 dimensions

  // Verdict
  passed: int("passed").notNull(),  // 1=pass, 0=fail (MySQL boolean)
  passThreshold: int("pass_threshold").notNull().default(3),  // Minimum overall_score to pass (configurable)

  // Issues (structured JSON matching D5SliceIssue[])
  issues: json("issues"),  // D5SliceIssue[] — category, severity, description, recommended_action

  // Context used for review
  keyframeUrls: json("keyframe_urls"),  // string[] — 3 keyframe URLs (start, mid, end)
  clipUrl: text("clip_url"),  // URL of the clip being reviewed
  characterBibleHash: varchar("character_bible_hash", { length: 64 }),  // SHA-256 of bible used
  styleLockHash: varchar("style_lock_hash", { length: 64 }),  // SHA-256 of style_lock used

  // Routing decision
  routingDecision: mysqlEnum("routing_decision", [
    "pass",              // Clip passed, proceed to assembly
    "retry_video",       // Re-generate video clip
    "retry_prompt",      // Re-generate D2 prompt + video
    "retry_reference",   // Re-generate character reference + video
    "escalate",          // Exhausted retries, send to admin queue
  ]).notNull().default("pass"),

  // Cost & timing
  costUsd: decimal("cost_usd", { precision: 8, scale: 4 }).notNull().default("0"),
  durationMs: int("duration_ms").notNull().default(0),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ClipQualityReview = typeof clipQualityReviews.$inferSelect;
export type InsertClipQualityReview = typeof clipQualityReviews.$inferInsert;


// ═══════════════════════════════════════════════════════════════════════════
// D10: Craft Library — Curated Knowledge Base for Anime/Manga/Genga Production
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registered knowledge sources for the Craft Library.
 * Each source belongs to a primary sub-sensei (D10.A, D10.M, or D10.G)
 * and may cross-tag into others.
 *
 * Sources go through: pending → ingested (chunks created) → archived.
 */
export const craftLibrarySources = mysqlTable("craft_library_sources", {
  id: int("id").autoincrement().primaryKey(),
  /** Primary sub-sensei this source belongs to */
  subSensei: mysqlEnum("sub_sensei", ["anime", "manga", "genga"]).notNull(),
  /** Content type classification */
  sourceType: mysqlEnum("source_type", [
    "web_article",
    "book_chapter",
    "video_transcript",
    "tutorial",
    "interview",
    "podcast_transcript",
    "reference_image_set",
  ]).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  url: text("url"),  // nullable for books/offline sources
  author: varchar("author", { length: 255 }),
  description: text("description"),
  /** Cross-tags into other sub-senseis (e.g., sakuga blog post tagged anime + genga) */
  crossTags: json("cross_tags").$type<string[]>(),  // ["manga", "genga"]
  /** Ingestion status */
  status: mysqlEnum("source_status", ["pending", "ingesting", "ingested", "failed", "archived"]).notNull().default("pending"),
  /** Error message if ingestion failed */
  errorMessage: text("error_message"),
  /** Number of chunks created from this source */
  chunkCount: int("chunk_count").default(0).notNull(),
  /** Total token count across all chunks */
  totalTokens: int("total_tokens").default(0).notNull(),
  /** When this source was last fetched/refreshed */
  lastFetchedAt: timestamp("last_fetched_at"),
  /** Source-specific metadata (page count, duration, ISBN, etc.) */
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CraftLibrarySource = typeof craftLibrarySources.$inferSelect;
export type InsertCraftLibrarySource = typeof craftLibrarySources.$inferInsert;

/**
 * Chunked text segments from ingested sources.
 * Each chunk is a semantically coherent passage suitable for RAG retrieval.
 *
 * Embedding vectors are stored externally (Chroma collections);
 * this table stores the text + metadata for reconstruction and attribution.
 */
export const craftLibraryChunks = mysqlTable("craft_library_chunks", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("source_id").notNull().references(() => craftLibrarySources.id, { onDelete: "cascade" }),
  /** Sub-sensei inherited from source (denormalized for fast filtering) */
  subSensei: mysqlEnum("chunk_sub_sensei", ["anime", "manga", "genga"]).notNull(),
  /** The actual text content of this chunk */
  chunkText: text("chunk_text").notNull(),
  /** Sequential index within the source (0-based) */
  chunkIndex: int("chunk_index").notNull(),
  /** Approximate token count for budget estimation */
  tokenCount: int("token_count").notNull().default(0),
  /** Embedding vector storage: JSON array of 64-dim float vector (~1300 chars)
   * Expanded from varchar(128) in migration 0064 to support direct vector storage
   * until pgvector/Chroma migration (Wave 4 swap target) */
  embeddingRef: text("embedding_ref"),
  /** Chunk-level metadata: page number, chapter, timestamp, heading, etc. */
  metadata: json("chunk_metadata"),
  createdAt: timestamp("chunk_created_at").defaultNow().notNull(),
});
export type CraftLibraryChunk = typeof craftLibraryChunks.$inferSelect;
export type InsertCraftLibraryChunk = typeof craftLibraryChunks.$inferInsert;


// ═══════════════════════════════════════════════════════════════════════════
// Wave 2 Item 1: Anime Type Style Bundles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Style Bundles define the visual DNA for a genre/aesthetic.
 * Each bundle contains prompt templates, negative prompts, color palettes,
 * frame-rate defaults, music mood vectors, reference images, and a placeholder
 * LoRA configuration slot (populated when Phase 6.3 RLHF training lands).
 *
 * Downstream consumers:
 * - D2 (Prompt Engineer): reads promptTemplate + negativePrompt
 * - D6 (Color Director): reads colorPalette
 * - D1.5 (Genga Director): reads frameRateDefault + referenceImageUrls
 * - Project Creation Wizard: genre selector backed by active bundles
 */
export const styleBundles = mysqlTable("style_bundles", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique machine key for lookups: 'shonen', 'seinen', 'isekai', etc. */
  genreKey: varchar("genre_key", { length: 64 }).notNull().unique(),
  /** Human-readable display name */
  name: varchar("name", { length: 128 }).notNull(),
  /** Short description for the genre selector UI */
  description: text("description"),
  /** Long-form notes on the aesthetic (for admin reference) */
  aestheticNotes: text("aesthetic_notes"),

  // ─── Prompt Engineering ─────────────────────────────────────────────
  /** Base prompt template injected into D2 prompt construction */
  promptTemplate: text("prompt_template").notNull(),
  /** Negative prompt additions specific to this genre */
  negativePrompt: text("negative_prompt").notNull(),

  // ─── Visual Configuration ───────────────────────────────────────────
  /** Color palette as JSON: {primary, secondary, accent, background, highlight, shadow} in hex */
  colorPalette: json("color_palette").notNull(),
  /** Default frame rate for this genre (e.g., 12 for traditional anime, 24 for fluid action) */
  frameRateDefault: int("frame_rate_default").notNull().default(12),
  /** Reference image URLs for style conditioning (CDN URLs) */
  referenceImageUrls: json("reference_image_urls").$type<string[]>(),

  // ─── Audio Configuration ────────────────────────────────────────────
  /** Music mood vector for BGM generation: {energy, valence, tempo_bpm, instrumentation_tags[]} */
  musicMoodVector: json("music_mood_vector"),

  // ─── LoRA Configuration (Placeholder — Phase 6.3) ──────────────────
  /**
   * Placeholder LoRA config: {model_id: null, trigger_word, weight_range: [min, max], compatible_bases: string[]}
   * model_id remains null until Phase 6.3 RLHF training produces actual LoRA weights.
   */
  loraConfig: json("lora_config"),

  // ─── Preview / UI ──────────────────────────────────────────────────
  /** Preview thumbnail URL for the genre selector card */
  previewImageUrl: text("preview_image_url"),
  /** Icon identifier or emoji for compact displays */
  iconIdentifier: varchar("icon_identifier", { length: 32 }),

  // ─── Status ─────────────────────────────────────────────────────────
  /** Whether this bundle is available for selection */
  isActive: int("is_active").default(1).notNull(),
  /** Display order in the genre selector (lower = first) */
  sortOrder: int("sort_order").default(0).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type StyleBundle = typeof styleBundles.$inferSelect;
export type InsertStyleBundle = typeof styleBundles.$inferInsert;

// ─── Wave 2 Item 2: D0 Character Designer — Multi-View Reference Sheets ──

export const characterViews = mysqlTable("character_views", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewAngle: mysqlEnum("view_angle", ["front", "three_quarter", "side", "back"]).notNull(),
  generationPass: int("generation_pass").notNull().default(1),
  imageUrl: text("image_url"),
  clipScore: decimal("clip_score", { precision: 5, scale: 4 }),
  status: mysqlEnum("status", ["pending", "generating", "generated", "approved", "rejected", "failed"]).notNull().default("pending"),
  promptUsed: text("prompt_used"),
  conditioningImageUrl: text("conditioning_image_url"),
  styleBundleKey: varchar("style_bundle_key", { length: 64 }),
  attemptNumber: int("attempt_number").notNull().default(1),
  generationCostUsd: decimal("generation_cost_usd", { precision: 8, scale: 4 }).default("0"),
  errorMessage: text("error_message"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type CharacterView = typeof characterViews.$inferSelect;
export type InsertCharacterView = typeof characterViews.$inferInsert;

export const referenceSheetGates = mysqlTable("reference_sheet_gates", {
  id: int("id").autoincrement().primaryKey(),
  characterId: int("character_id").notNull().unique().references(() => characters.id, { onDelete: "cascade" }),
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "all_views_generated", "approved", "rejected", "expired"]).notNull().default("pending"),
  frontViewId: int("front_view_id"),
  threeQuarterViewId: int("three_quarter_view_id"),
  sideViewId: int("side_view_id"),
  backViewId: int("back_view_id"),
  overallClipScore: decimal("overall_clip_score", { precision: 5, scale: 4 }),
  styleBundleKey: varchar("style_bundle_key", { length: 64 }),
  totalCostUsd: decimal("total_cost_usd", { precision: 8, scale: 4 }).default("0"),
  totalAttempts: int("total_attempts").notNull().default(0),
  approvedAt: timestamp("approved_at"),
  rejectedReason: text("rejected_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ReferenceSheetGate = typeof referenceSheetGates.$inferSelect;
export type InsertReferenceSheetGate = typeof referenceSheetGates.$inferInsert;

// ─── Color Scripts (Wave 2 Item 3: D6 Color Director) ────────────────────

export const colorScripts = mysqlTable("color_scripts", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  episodeId: int("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
  // Per-character palettes: { [characterId]: { primary, secondary, accent, skin, hair, eyes, outline } }
  characterPalettes: json("character_palettes"),
  // Per-scene palettes: { [sceneNumber]: { background, midground, foreground, ambient, lighting, accent } }
  scenePalettes: json("scene_palettes"),
  // Mood progression: [{ sceneNumber, warmth (0-1), saturation (0-1), brightness (0-1), dominantHue, mood }]
  moodProgression: json("mood_progression"),
  // Palette lock: { locked: boolean, lockedBy: userId, lockedAt: timestamp, lockedPalettes: string[] }
  paletteLock: json("palette_lock"),
  // Generation metadata
  styleBundleKey: varchar("style_bundle_key", { length: 50 }),
  generationPrompt: text("generation_prompt"),
  generationCostUsd: decimal("generation_cost_usd", { precision: 8, scale: 4 }).default("0"),
  status: mysqlEnum("status", [
    "pending",
    "generating",
    "generated",
    "approved",
    "rejected",
    "locked",
  ]).default("pending").notNull(),
  approvedAt: timestamp("approved_at"),
  approvedBy: int("approved_by"),
  rejectedReason: text("rejected_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ColorScript = typeof colorScripts.$inferSelect;
export type InsertColorScript = typeof colorScripts.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// WAVE 2 ITEM 4: D1.25 Layout Director + D1.5 Genga Director + D2.5 Sakuga Kantoku
// ═══════════════════════════════════════════════════════════════════════════

// ─── D1.25 Panel Layouts ────────────────────────────────────────────────
export const panelLayouts = mysqlTable("panel_layouts", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  episodeId: int("episode_id").notNull(),
  sceneNumber: int("scene_number").notNull(),
  panelNumber: int("panel_number").notNull(),
  // Camera & composition
  cameraAngle: varchar("camera_angle", { length: 50 }).notNull(), // wide, medium, close-up, extreme_close_up, birds_eye, worms_eye, dutch_angle, over_shoulder
  cameraMovement: varchar("camera_movement", { length: 50 }), // static, pan_left, pan_right, tilt_up, tilt_down, zoom_in, zoom_out, dolly
  depthLayers: json("depth_layers"), // { foreground: [...], midground: [...], background: [...] }
  // Character placement
  characterPlacements: json("character_placements"), // [{ characterId, x, y, scale, facing, pose, zIndex }]
  // Composition reference
  compositionSketchUrl: text("composition_sketch_url"), // Low-res layout reference image
  compositionSketchKey: varchar("composition_sketch_key", { length: 255 }),
  layoutJson: json("layout_json"), // Full structured layout data
  // Generation metadata
  generationPrompt: text("generation_prompt"),
  generationCostUsd: decimal("generation_cost_usd", { precision: 8, scale: 4 }).default("0"),
  status: mysqlEnum("status", [
    "pending", "generating", "generated", "approved", "rejected",
  ]).default("pending").notNull(),
  approvedAt: timestamp("approved_at"),
  approvedBy: int("approved_by"),
  rejectedReason: text("rejected_reason"),
  metadata: json("metadata"), // Additional layout metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PanelLayout = typeof panelLayouts.$inferSelect;
export type InsertPanelLayout = typeof panelLayouts.$inferInsert;

// ─── D1.5 Genga Keyframes ──────────────────────────────────────────────
export const gengaKeyframes = mysqlTable("genga_keyframes", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  episodeId: int("episode_id").notNull(),
  sceneNumber: int("scene_number").notNull(),
  panelNumber: int("panel_number").notNull(),
  layoutId: int("layout_id"), // FK to panelLayouts
  sequenceIndex: int("sequence_index").notNull().default(0), // Order within panel for multi-frame sequences
  // Genga passes
  roughGengaUrl: text("rough_genga_url"),
  roughGengaKey: varchar("rough_genga_key", { length: 255 }),
  cleanGengaUrl: text("clean_genga_url"),
  cleanGengaKey: varchar("clean_genga_key", { length: 255 }),
  // Generation metadata
  generationPrompt: text("generation_prompt"),
  conditioningInputs: json("conditioning_inputs"), // { layoutId, characterSheetUrls, colorPalette }
  generationCostUsd: decimal("generation_cost_usd", { precision: 8, scale: 4 }).default("0"),
  attemptNumber: int("attempt_number").default(1).notNull(),
  // Status
  status: mysqlEnum("status", [
    "pending", "generating_rough", "rough_ready", "approved_rough",
    "generating_clean", "clean_ready", "approved", "rejected",
  ]).default("pending").notNull(),
  approvedAt: timestamp("approved_at"),
  approvedBy: int("approved_by"),
  rejectedReason: text("rejected_reason"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type GengaKeyframe = typeof gengaKeyframes.$inferSelect;
export type InsertGengaKeyframe = typeof gengaKeyframes.$inferInsert;

// ─── D1.5 Flip-Book Previews ───────────────────────────────────────────
export const flipBookPreviews = mysqlTable("flip_book_previews", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  episodeId: int("episode_id").notNull(),
  sceneNumber: int("scene_number").notNull(),
  // Preview assembly
  frameUrls: json("frame_urls"), // Ordered array of genga frame URLs
  previewVideoUrl: text("preview_video_url"), // Assembled flip-book as short video/GIF
  previewVideoKey: varchar("preview_video_key", { length: 255 }),
  frameCount: int("frame_count").default(0).notNull(),
  fps: int("fps").default(8).notNull(),
  // Approval
  status: mysqlEnum("status", [
    "pending", "assembling", "ready", "approved", "rejected",
  ]).default("pending").notNull(),
  approvedAt: timestamp("approved_at"),
  approvedBy: int("approved_by"),
  rejectedReason: text("rejected_reason"),
  generationCostUsd: decimal("generation_cost_usd", { precision: 8, scale: 4 }).default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FlipBookPreview = typeof flipBookPreviews.$inferSelect;
export type InsertFlipBookPreview = typeof flipBookPreviews.$inferInsert;

// ─── D2.5 Sakuga Kantoku Reviews ───────────────────────────────────────
export const sakugaReviews = mysqlTable("sakuga_reviews", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  episodeId: int("episode_id").notNull(),
  // Review scope
  reviewType: mysqlEnum("review_type", ["full_episode", "scene", "panel_range"]).default("full_episode").notNull(),
  sceneNumber: int("scene_number"), // null for full_episode
  panelRange: json("panel_range"), // { start, end } for panel_range type
  // Punch list output
  punchList: json("punch_list"), // [{ type, severity, sceneNumber, panelNumber, description, affectedCharacters, suggestion }]
  issueCount: int("issue_count").default(0).notNull(),
  criticalCount: int("critical_count").default(0).notNull(),
  warningCount: int("warning_count").default(0).notNull(),
  infoCount: int("info_count").default(0).notNull(),
  // Consistency scores
  overallScore: decimal("overall_score", { precision: 5, scale: 2 }), // 0-100
  characterConsistencyScore: decimal("character_consistency_score", { precision: 5, scale: 2 }),
  perspectiveScore: decimal("perspective_score", { precision: 5, scale: 2 }),
  motionArcScore: decimal("motion_arc_score", { precision: 5, scale: 2 }),
  colorConsistencyScore: decimal("color_consistency_score", { precision: 5, scale: 2 }),
  // Generation metadata
  generationCostUsd: decimal("generation_cost_usd", { precision: 8, scale: 4 }).default("0"),
  status: mysqlEnum("status", [
    "pending", "reviewing", "completed", "acknowledged",
  ]).default("pending").notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: int("acknowledged_by"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type SakugaReview = typeof sakugaReviews.$inferSelect;
export type InsertSakugaReview = typeof sakugaReviews.$inferInsert;

// ─── X-Sheet (Stage 12: Timing Director) ────────────────────────────────────
/**
 * X-Sheet (Exposure Sheet / Timing Chart)
 *
 * Master timing document for an episode. Generated by D4 Timing Director,
 * reviewed by user at Stage 12 blocking gate. Contains per-slice timing
 * entries with music cue points, SFX triggers, voice timing, and transitions.
 *
 * Data model supports per-user overrides in Wave 4 via xSheetOverrides table.
 * D4 output is the "base layer"; user edits are stored as overrides that
 * merge on top at read time.
 */
export const xSheets = mysqlTable("x_sheets", {
  id: int("id").autoincrement().primaryKey(),
  episodeId: int("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: int("version").default(1).notNull(),
  /** Who generated this version: 'd4_auto' | 'user_edit' | 'user_override' */
  source: mysqlEnum("source", ["d4_auto", "user_edit", "user_override"]).default("d4_auto").notNull(),
  /** Overall episode timing metadata */
  totalDurationMs: int("total_duration_ms"),
  /** BPM detected/set for music synchronization */
  bpm: int("bpm"),
  /** Time signature (e.g., "4/4", "3/4") */
  timeSignature: varchar("time_signature", { length: 10 }),
  /** Global emotion arc summary (JSON array of {timestamp, emotion, intensity}) */
  emotionArc: json("emotion_arc"),
  /** D4 generation metadata (model, prompt, confidence) */
  generationMetadata: json("generation_metadata"),
  /** Status in the approval pipeline */
  status: mysqlEnum("x_sheet_status", ["draft", "pending_review", "approved", "rejected", "superseded"]).default("draft").notNull(),
  approvedAt: timestamp("approved_at"),
  approvedBy: int("approved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type XSheet = typeof xSheets.$inferSelect;
export type InsertXSheet = typeof xSheets.$inferInsert;

/**
 * X-Sheet Entries — per-slice timing rows
 *
 * Each entry represents one slice/panel's timing within the episode timeline.
 * Contains voice start/end, music cue points, SFX triggers, and transition markers.
 */
export const xSheetEntries = mysqlTable("x_sheet_entries", {
  id: int("id").autoincrement().primaryKey(),
  xSheetId: int("x_sheet_id").notNull().references(() => xSheets.id, { onDelete: "cascade" }),
  /** Slice/panel reference (maps to videoSlices or panels depending on decomposition) */
  sliceNumber: int("slice_number").notNull(),
  panelId: int("panel_id"),
  /** Absolute start time in the episode timeline (ms from episode start) */
  startMs: int("start_ms").notNull(),
  /** Absolute end time (ms from episode start) */
  endMs: int("end_ms").notNull(),
  /** Target duration for this slice (ms) */
  durationMs: int("duration_ms").notNull(),
  // ─── Voice Timing ─────────────────────────────────────────────────────
  /** Voice audio start offset within this slice (ms from slice start) */
  voiceStartMs: int("voice_start_ms"),
  /** Voice audio end offset within this slice (ms from slice start) */
  voiceEndMs: int("voice_end_ms"),
  /** Character speaking in this slice */
  voiceCharacterId: int("voice_character_id"),
  /** Emotion directive for TTS (e.g., "angry", "whisper", "excited") */
  voiceEmotion: varchar("voice_emotion", { length: 50 }),
  /** Pacing directive (wpm target or relative: "slow", "normal", "fast") */
  voicePacing: varchar("voice_pacing", { length: 20 }),
  // ─── Music Cue Points ─────────────────────────────────────────────────
  /** Music cue type at this slice boundary */
  musicCueType: mysqlEnum("music_cue_type", [
    "none", "start", "stop", "transition", "crescendo", "diminuendo", "accent", "stinger"
  ]).default("none"),
  /** Music mood/genre shift at this point (null = continue current) */
  musicMoodShift: varchar("music_mood_shift", { length: 100 }),
  /** Music intensity (0-100, for dynamic mixing) */
  musicIntensity: int("music_intensity"),
  // ─── SFX Triggers ─────────────────────────────────────────────────────
  /** SFX events within this slice (JSON array of {type, offsetMs, duration, category}) */
  sfxTriggers: json("sfx_triggers"),
  // ─── Transition Markers ───────────────────────────────────────────────
  /** Outgoing transition type (to next slice) */
  transitionType: mysqlEnum("entry_transition_type", [
    "cut", "crossfade", "dip_to_black", "soft_fade", "audio_cross", "wipe", "none"
  ]).default("cut"),
  /** Transition duration (ms) */
  transitionDurationMs: int("transition_duration_ms").default(0),
  // ─── Scene Context ────────────────────────────────────────────────────
  /** Scene number for grouping */
  sceneNumber: int("scene_number"),
  /** Emotion at this point in the arc */
  emotion: varchar("emotion", { length: 50 }),
  /** Energy level (1-10) for pacing */
  energyLevel: int("energy_level"),
  /** Camera movement note (for timing coordination) */
  cameraNote: varchar("camera_note", { length: 200 }),
  /** D4 confidence in this entry's timing (0.0 - 1.0) */
  confidence: float("confidence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type XSheetEntry = typeof xSheetEntries.$inferSelect;
export type InsertXSheetEntry = typeof xSheetEntries.$inferInsert;

/**
 * X-Sheet Overrides — per-user timing adjustments (Wave 4)
 *
 * Stores user modifications on top of D4-generated base entries.
 * At read time, overrides merge on top of base entries by sliceNumber.
 * This keeps the D4 output immutable while allowing user customization.
 */
export const xSheetOverrides = mysqlTable("x_sheet_overrides", {
  id: int("id").autoincrement().primaryKey(),
  xSheetId: int("x_sheet_id").notNull().references(() => xSheets.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Which slice this override applies to */
  sliceNumber: int("slice_number").notNull(),
  /** JSON patch: only the fields the user changed (sparse merge) */
  overrideData: json("override_data").notNull(),
  /** Reason for the override (user note) */
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type XSheetOverride = typeof xSheetOverrides.$inferSelect;
export type InsertXSheetOverride = typeof xSheetOverrides.$inferInsert;

// ─── Print Orders (Wave 5A — Lulu Print Integration) ─────────────────────────

/**
 * Print Orders — tracks manga print product orders through Lulu POD.
 *
 * Lifecycle: created → payment_pending → paid → submitted_to_lulu →
 *            production → shipped → delivered
 * OR: created → payment_pending → paid → submitted_to_lulu → failed
 * OR: created → payment_pending → cancelled
 */
export const printOrders = mysqlTable("print_orders", {
  id: int("id").autoincrement().primaryKey(),
  /** User who placed the order */
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Project this print belongs to */
  projectId: int("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** Episode/chapter ID (nullable for full-volume orders) */
  episodeId: int("episode_id"),
  /** Order status */
  status: mysqlEnum("status", [
    "created",
    "payment_pending",
    "paid",
    "submitted_to_lulu",
    "production",
    "shipped",
    "delivered",
    "failed",
    "cancelled",
    "refunded",
  ]).default("created").notNull(),
  /** Trim size selected */
  trimSize: mysqlEnum("trim_size", ["b5", "a5", "tankobon", "us_trade"]).default("b5").notNull(),
  /** Number of pages in the print */
  pageCount: int("page_count").notNull(),
  /** Interior PDF S3 URL */
  interiorPdfUrl: text("interior_pdf_url"),
  /** Cover PDF S3 URL */
  coverPdfUrl: text("cover_pdf_url"),
  /** Lulu pod_package_id */
  luluPackageId: varchar("lulu_package_id", { length: 64 }),
  /** Lulu print job ID (from their API) */
  luluPrintJobId: varchar("lulu_print_job_id", { length: 128 }),
  /** Lulu line item ID */
  luluLineItemId: varchar("lulu_line_item_id", { length: 128 }),
  /** Stripe checkout session ID */
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id", { length: 255 }),
  /** Stripe payment intent ID */
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  /** Total price charged to customer (cents) */
  totalPriceCents: int("total_price_cents").notNull(),
  /** Print cost from Lulu (cents) — what we pay Lulu */
  printCostCents: int("print_cost_cents"),
  /** Platform margin (cents) — our cut */
  platformMarginCents: int("platform_margin_cents"),
  /** Creator royalty (cents) — creator's cut */
  creatorRoyaltyCents: int("creator_royalty_cents"),
  /** Creator user ID (project owner who gets royalty) */
  creatorUserId: int("creator_user_id").references(() => users.id),
  /** Shipping address (JSON) */
  shippingAddress: json("shipping_address"),
  /** Shipping method */
  shippingMethod: mysqlEnum("shipping_method", ["MAIL", "GROUND", "EXPEDITED", "EXPRESS"]).default("MAIL"),
  /** Shipping cost (cents) */
  shippingCostCents: int("shipping_cost_cents"),
  /** Tracking number (from Lulu webhook) */
  trackingNumber: varchar("tracking_number", { length: 128 }),
  /** Tracking URL */
  trackingUrl: text("tracking_url"),
  /** Lulu webhook event log (JSON array of events) */
  webhookEvents: json("webhook_events"),
  /** Error message if failed */
  errorMessage: text("error_message"),
  /** Quantity ordered */
  quantity: int("quantity").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  /** When payment was confirmed */
  paidAt: timestamp("paid_at"),
  /** When submitted to Lulu */
  submittedAt: timestamp("submitted_at"),
  /** When shipped */
  shippedAt: timestamp("shipped_at"),
  /** When delivered */
  deliveredAt: timestamp("delivered_at"),
});
export type PrintOrder = typeof printOrders.$inferSelect;
export type InsertPrintOrder = typeof printOrders.$inferInsert;

/**
 * Creator Payouts — tracks owed and paid royalties per creator.
 *
 * Wave 5A: Manual payout workflow only (admin views balances, triggers
 * manual Stripe transfers). Automated Stripe Connect onboarding → Wave 5B.
 */
export const creatorPayouts = mysqlTable("creator_payouts", {
  id: int("id").autoincrement().primaryKey(),
  /** Creator user ID */
  creatorUserId: int("creator_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Related print order */
  printOrderId: int("print_order_id").notNull().references(() => printOrders.id, { onDelete: "cascade" }),
  /** Amount owed (cents) */
  amountCents: int("amount_cents").notNull(),
  /** Payout status */
  status: mysqlEnum("status", ["pending", "approved", "paid", "failed"]).default("pending").notNull(),
  /** Admin who approved/processed the payout */
  processedByUserId: int("processed_by_user_id").references(() => users.id),
  /** Stripe transfer ID (when paid manually) */
  stripeTransferId: varchar("stripe_transfer_id", { length: 255 }),
  /** Notes from admin */
  adminNotes: text("admin_notes"),
  /** When payout was approved */
  approvedAt: timestamp("approved_at"),
  /** When payout was actually sent */
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CreatorPayout = typeof creatorPayouts.$inferSelect;
export type InsertCreatorPayout = typeof creatorPayouts.$inferInsert;


// ─── Resolution Flow (D2.5 Sakuga Kantoku) ────────────────────────────────────

/**
 * Resolution Issues — individual consistency problems flagged by the
 * Sakuga Kantoku engine across a genga set.
 */
export const resolutionIssues = mysqlTable("resolution_issues", {
  id: int("id").autoincrement().primaryKey(),
  /** The genga set (project + episode) this issue belongs to */
  projectId: int("project_id").notNull(),
  episodeId: int("episode_id").notNull(),
  /** Specific panel with the issue */
  panelId: int("panel_id").notNull(),
  /** Issue classification */
  issueType: mysqlEnum("issue_type", [
    "proportion_drift",
    "color_inconsistency",
    "off_model_face",
    "pose_break",
    "bg_mismatch",
    "style_deviation",
    "line_weight_mismatch",
  ]).notNull(),
  /** Severity level (1-5, 5 = critical) */
  severity: int("severity").notNull(),
  /** Human-readable description of the issue */
  description: text("description").notNull(),
  /** Current status */
  status: mysqlEnum("status", [
    "open",
    "in_progress",
    "resolved",
    "approved",
    "escalated",
    "wont_fix",
  ]).default("open").notNull(),
  /** Assigned reviewer (creator or admin) */
  assignedToUserId: int("assigned_to_user_id").references(() => users.id),
  /** Reference panel (the "correct" version to compare against) */
  referencePanelUrl: text("reference_panel_url"),
  /** Confidence score from the engine (0-1) */
  confidenceScore: float("confidence_score"),
  /** JSON metadata: bounding box, specific coordinates, etc. */
  metadata: json("metadata"),
  /** Number of regen rounds attempted */
  roundCount: int("round_count").default(0).notNull(),
  /** Resolved at timestamp */
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ResolutionIssue = typeof resolutionIssues.$inferSelect;
export type InsertResolutionIssue = typeof resolutionIssues.$inferInsert;

/**
 * Resolution Rounds — each regeneration attempt for a flagged issue.
 * Tracks the multi-round auto-regen flow with creator approval.
 */
export const resolutionRounds = mysqlTable("resolution_rounds", {
  id: int("id").autoincrement().primaryKey(),
  /** Parent issue */
  issueId: int("issue_id").notNull().references(() => resolutionIssues.id, { onDelete: "cascade" }),
  /** Round number (1-indexed) */
  roundNumber: int("round_number").notNull(),
  /** Regen parameters used (prompt modifications, seed, model config) */
  regenParams: json("regen_params").notNull(),
  /** URL of the regenerated panel result */
  resultUrl: text("result_url"),
  /** Reviewer's verdict on this round */
  reviewerVerdict: mysqlEnum("reviewer_verdict", [
    "pending",
    "approved",
    "rejected",
    "partial_improvement",
  ]).default("pending").notNull(),
  /** Improvement score vs original (0-1, computed by engine) */
  improvementScore: float("improvement_score"),
  /** Reviewer notes */
  reviewerNotes: text("reviewer_notes"),
  /** Who reviewed this round */
  reviewedByUserId: int("reviewed_by_user_id").references(() => users.id),
  /** When the regen was triggered */
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  /** When the result was reviewed */
  reviewedAt: timestamp("reviewed_at"),
});
export type ResolutionRound = typeof resolutionRounds.$inferSelect;
export type InsertResolutionRound = typeof resolutionRounds.$inferInsert;

/**
 * Genga Consistency Scores — per-episode aggregate consistency metrics.
 * Updated after each resolution round completes.
 */
export const gengaConsistencyScores = mysqlTable("genga_consistency_scores", {
  id: int("id").autoincrement().primaryKey(),
  /** Project ID */
  projectId: int("project_id").notNull(),
  /** Episode ID */
  episodeId: int("episode_id").notNull(),
  /** Overall consistency score (0-100) */
  consistencyScore: float("consistency_score").notNull(),
  /** Number of panels that drifted from reference */
  driftPanelCount: int("drift_panel_count").default(0).notNull(),
  /** Total panels in the episode */
  totalPanelCount: int("total_panel_count").notNull(),
  /** Breakdown by issue type (JSON: { type: count }) */
  issueBreakdown: json("issue_breakdown"),
  /** Last computed timestamp */
  computedAt: timestamp("computed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type GengaConsistencyScore = typeof gengaConsistencyScores.$inferSelect;
export type InsertGengaConsistencyScore = typeof gengaConsistencyScores.$inferInsert;

// ─── LoRA Training Tables ─────────────────────────────────────────────────────

export const sakufuuLoraJobs = mysqlTable("sakufuu_lora_jobs", {
  id: int("id").autoincrement().primaryKey(),
  /** Creator who owns this LoRA model */
  creatorId: int("creator_id").notNull(),
  /** Project ID (style source) */
  projectId: int("project_id"),
  /** Training provider: replicate | modal */
  provider: varchar("provider", { length: 32 }).default("replicate").notNull(),
  /** External job ID from provider */
  externalJobId: varchar("external_job_id", { length: 255 }),
  /** Status of the training job */
  status: mysqlEnum("sakufuu_lora_status", ["pending_admin_approval", "pending", "preparing", "training", "completed", "failed", "cancelled"]).default("pending_admin_approval").notNull(),
  /** Training configuration (JSON) */
  config: json("config"),
  /** Number of training images used */
  sampleCount: int("sample_count").default(0).notNull(),
  /** Total training steps */
  trainingSteps: int("training_steps").default(1000).notNull(),
  /** Trained model URL (S3 or provider URL) */
  modelUrl: text("model_url"),
  /** S3 key for the model weights */
  modelFileKey: varchar("model_file_key", { length: 512 }),
  /** Training cost in USD cents */
  costCents: int("cost_cents").default(0).notNull(),
  /** Pre-submission cost estimate (before admin approval) */
  estimatedCostCents: int("estimated_cost_cents").default(0).notNull(),
  /** Training duration in seconds */
  durationSeconds: int("duration_seconds"),
  /** Error message if failed */
  errorMessage: text("error_message"),
  /** Admin approval status (for completed model use) */
  approved: mysqlEnum("sakufuu_lora_approved", ["pending", "approved", "rejected"]).default("pending").notNull(),
  /** Admin who approved the training submission */
  adminApprovedBy: int("admin_approved_by"),
  /** When admin approved the training submission */
  adminApprovedAt: timestamp("admin_approved_at"),
  /** Metadata (trigger word, base model, etc.) */
  metadata: json("metadata"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type SakufuuLoraJob = typeof sakufuuLoraJobs.$inferSelect;
export type InsertSakufuuLoraJob = typeof sakufuuLoraJobs.$inferInsert;

export const sakufuuStyleSamples = mysqlTable("sakufuu_style_samples", {
  id: int("id").autoincrement().primaryKey(),
  /** Training job this sample belongs to */
  trainingJobId: int("training_job_id").notNull(),
  /** Creator who owns the source material */
  creatorId: int("creator_id").notNull(),
  /** Source panel/image URL */
  sourceUrl: text("source_url").notNull(),
  /** S3 key for the processed training image */
  processedFileKey: varchar("processed_file_key", { length: 512 }),
  /** Processed image URL */
  processedUrl: text("processed_url"),
  /** Auto-generated caption for the image */
  caption: text("caption"),
  /** Source type: panel, character_sheet, cover, custom */
  sourceType: mysqlEnum("source_type", ["panel", "character_sheet", "cover", "custom"]).default("panel").notNull(),
  /** Quality score (0-1) from auto-curation */
  qualityScore: float("quality_score"),
  /** Whether this sample was manually selected or auto-curated */
  autoSelected: int("auto_selected").default(1).notNull(),
  /** Crop region if extracted from larger image (JSON: { x, y, w, h }) */
  cropRegion: json("crop_region"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SakufuuStyleSample = typeof sakufuuStyleSamples.$inferSelect;
export type InsertSakufuuStyleSample = typeof sakufuuStyleSamples.$inferInsert;


// ─── Stripe Connect Accounts ──────────────────────────────────────────────
export const stripeConnectAccounts = mysqlTable("stripe_connect_accounts", {
  id: int("id").autoincrement().primaryKey(),
  /** Creator user ID */
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Stripe Connect account ID (acct_xxx) */
  stripeAccountId: varchar("stripe_account_id", { length: 255 }).notNull(),
  /** Account type (always express for now) */
  accountType: mysqlEnum("account_type", ["express", "standard", "custom"]).default("express").notNull(),
  /** Onboarding status */
  onboardingStatus: mysqlEnum("onboarding_status", ["pending", "incomplete", "complete"]).default("pending").notNull(),
  /** Whether charges are enabled */
  chargesEnabled: int("charges_enabled").default(0).notNull(),
  /** Whether payouts are enabled */
  payoutsEnabled: int("payouts_enabled").default(0).notNull(),
  /** Country code */
  country: varchar("country", { length: 2 }),
  /** Default currency */
  defaultCurrency: varchar("default_currency", { length: 3 }),
  /** Metadata from Stripe */
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;
export type InsertStripeConnectAccount = typeof stripeConnectAccounts.$inferInsert;
