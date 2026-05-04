/**
 * D4 Timing Director — LLM-based X-Sheet Auto-Generation
 *
 * Generates an initial X-Sheet from script + slice metadata (emotion arcs,
 * dialogue timecodes, scene boundaries). The output is stored as a "d4_auto"
 * source X-Sheet that users review at the Stage 12 blocking gate.
 *
 * Inputs:
 *   - Episode panels with dialogue, emotion, scene boundaries
 *   - Character voice profiles (pacing preferences)
 *   - Mood arc from episode metadata
 *   - BPM hint from style bundle (if available)
 *
 * Outputs:
 *   - Complete X-Sheet with per-slice timing entries
 *   - Music cue points aligned to scene boundaries
 *   - SFX trigger suggestions from panel descriptions
 *   - Voice timing estimates based on dialogue word count + emotion
 */
import { invokeLLM } from "../../_core/llm.js";
import { pipelineLog } from "../../observability/logger.js";
import {
  createXSheet,
  createXSheetEntries,
  updateXSheetStatus,
  getLatestXSheet,
} from "./db-helpers.js";
import type { InsertXSheetEntry } from "../../../drizzle/schema.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PanelTimingInput {
  panelId: number;
  panelNumber: number;
  sceneNumber: number;
  dialogue?: { character: string; text: string; emotion?: string }[];
  visualDescription?: string;
  cameraAngle?: string;
  transition?: string;
  transitionDuration?: number;
  sfx?: string;
  mood?: string;
}

export interface TimingDirectorOptions {
  episodeId: number;
  projectId: number;
  panels: PanelTimingInput[];
  moodArc?: string[];
  bpmHint?: number;
  targetDurationMs?: number;
  characterVoiceProfiles?: Record<string, { pacing: "slow" | "normal" | "fast"; avgWpm: number }>;
}

export interface GeneratedXSheetResult {
  xSheetId: number;
  totalDurationMs: number;
  entryCount: number;
  musicCueCount: number;
  sfxTriggerCount: number;
  confidence: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default duration per panel if no dialogue/action context (ms) */
const DEFAULT_PANEL_DURATION_MS = 3000;
/** Minimum slice duration (ms) */
const MIN_SLICE_DURATION_MS = 1500;
/** Maximum slice duration (ms) */
const MAX_SLICE_DURATION_MS = 15000;
/** Words per minute for normal pacing */
const NORMAL_WPM = 150;
/** Padding after voice ends before next slice (ms) */
const VOICE_TAIL_PADDING_MS = 300;

// ─── Voice Duration Estimation ──────────────────────────────────────────────

function estimateVoiceDurationMs(
  text: string,
  pacing: "slow" | "normal" | "fast" = "normal",
  avgWpm?: number
): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const wpm = avgWpm || (pacing === "slow" ? 120 : pacing === "fast" ? 180 : NORMAL_WPM);
  return Math.round((wordCount / wpm) * 60 * 1000);
}

// ─── LLM Prompt for Timing Analysis ────────────────────────────────────────

function buildTimingPrompt(options: TimingDirectorOptions): string {
  const panelSummaries = options.panels.map((p) => {
    const dialogueStr = p.dialogue?.map((d) => `${d.character}: "${d.text}" [${d.emotion || "neutral"}]`).join("; ") || "no dialogue";
    return `Panel ${p.panelNumber} (Scene ${p.sceneNumber}): ${p.visualDescription?.slice(0, 80) || "visual"} | Dialogue: ${dialogueStr} | Camera: ${p.cameraAngle || "medium"} | SFX: ${p.sfx || "none"} | Mood: ${p.mood || "neutral"}`;
  }).join("\n");

  return `You are D4, an anime timing director. Generate a timing chart (X-Sheet) for this episode.

EPISODE CONTEXT:
- Total panels: ${options.panels.length}
- Target duration: ${options.targetDurationMs ? `${options.targetDurationMs}ms` : "auto (3-5 min)"}
- Mood arc: ${options.moodArc?.join(" → ") || "not specified"}
- BPM hint: ${options.bpmHint || "auto-detect from mood"}

PANELS:
${panelSummaries}

RULES:
1. Each panel gets a timing entry with start_ms, end_ms, duration_ms
2. Dialogue panels need voice_start_ms (200-500ms after slice start for breathing room)
3. Action panels without dialogue get shorter durations (2-3s)
4. Emotional/dramatic panels get longer holds (4-6s)
5. Music cue types: "start" at scene openings, "transition" at mood shifts, "crescendo" before climax, "stinger" at reveals
6. SFX triggers: extract from panel SFX field and visual description (impacts, doors, footsteps, etc.)
7. Transitions: "crossfade" between scenes, "cut" within scenes, "dip_to_black" at major breaks
8. Energy level 1-10 should follow the mood arc
9. Total duration should feel natural for the content density

OUTPUT FORMAT (JSON):
{
  "bpm": number,
  "totalDurationMs": number,
  "confidence": number (0.0-1.0),
  "entries": [
    {
      "sliceNumber": number,
      "panelId": number,
      "startMs": number,
      "endMs": number,
      "durationMs": number,
      "voiceStartMs": number | null,
      "voiceEndMs": number | null,
      "voiceEmotion": string | null,
      "voicePacing": "slow" | "normal" | "fast" | null,
      "musicCueType": "none" | "start" | "stop" | "transition" | "crescendo" | "diminuendo" | "accent" | "stinger",
      "musicMoodShift": string | null,
      "musicIntensity": number (0-100),
      "sfxTriggers": [{"type": string, "offsetMs": number, "durationMs": number, "category": string}] | null,
      "transitionType": "cut" | "crossfade" | "dip_to_black" | "soft_fade" | "audio_cross" | "wipe" | "none",
      "transitionDurationMs": number,
      "sceneNumber": number,
      "emotion": string,
      "energyLevel": number (1-10),
      "cameraNote": string | null
    }
  ]
}`;
}

// ─── Main Generation Function ───────────────────────────────────────────────

export async function generateXSheet(
  options: TimingDirectorOptions
): Promise<GeneratedXSheetResult> {
  pipelineLog.info(`[D4] Generating X-Sheet for episode ${options.episodeId} (${options.panels.length} panels)`);

  // Step 1: Pre-compute voice durations for dialogue panels
  const voiceDurations = new Map<number, number>();
  for (const panel of options.panels) {
    if (panel.dialogue && panel.dialogue.length > 0) {
      const fullText = panel.dialogue.map((d) => d.text).join(" ");
      const charProfile = panel.dialogue[0]?.character
        ? options.characterVoiceProfiles?.[panel.dialogue[0].character]
        : undefined;
      const duration = estimateVoiceDurationMs(
        fullText,
        charProfile?.pacing || "normal",
        charProfile?.avgWpm
      );
      voiceDurations.set(panel.panelNumber, duration);
    }
  }

  // Step 2: Call LLM for timing analysis
  const prompt = buildTimingPrompt(options);
  let llmResult: any;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are D4, an expert anime timing director. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "x_sheet_timing",
          strict: true,
          schema: {
            type: "object",
            properties: {
              bpm: { type: "integer" },
              totalDurationMs: { type: "integer" },
              confidence: { type: "number" },
              entries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sliceNumber: { type: "integer" },
                    panelId: { type: "integer" },
                    startMs: { type: "integer" },
                    endMs: { type: "integer" },
                    durationMs: { type: "integer" },
                    voiceStartMs: { type: ["integer", "null"] },
                    voiceEndMs: { type: ["integer", "null"] },
                    voiceEmotion: { type: ["string", "null"] },
                    voicePacing: { type: ["string", "null"] },
                    musicCueType: { type: "string" },
                    musicMoodShift: { type: ["string", "null"] },
                    musicIntensity: { type: "integer" },
                    sfxTriggers: { type: ["array", "null"] },
                    transitionType: { type: "string" },
                    transitionDurationMs: { type: "integer" },
                    sceneNumber: { type: "integer" },
                    emotion: { type: "string" },
                    energyLevel: { type: "integer" },
                    cameraNote: { type: ["string", "null"] },
                  },
                  required: [
                    "sliceNumber", "panelId", "startMs", "endMs", "durationMs",
                    "musicCueType", "musicIntensity", "transitionType",
                    "transitionDurationMs", "sceneNumber", "emotion", "energyLevel",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["bpm", "totalDurationMs", "confidence", "entries"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("Empty LLM response");
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    llmResult = JSON.parse(content);
  } catch (err) {
    pipelineLog.warn(`[D4] LLM timing generation failed, falling back to heuristic`, { error: String(err) });
    llmResult = generateHeuristicXSheet(options, voiceDurations);
  }

  // Step 3: Validate and clamp timing values
  const validatedEntries = validateEntries(llmResult.entries, options.panels, voiceDurations);

  // Step 4: Persist to database
  const existingSheet = await getLatestXSheet(options.episodeId);
  const version = existingSheet ? existingSheet.version + 1 : 1;

  // Supersede previous version if exists
  if (existingSheet && existingSheet.status !== "superseded") {
    await updateXSheetStatus(existingSheet.id, "superseded");
  }

  const sheet = await createXSheet({
    episodeId: options.episodeId,
    projectId: options.projectId,
    version,
    source: "d4_auto",
    totalDurationMs: llmResult.totalDurationMs,
    bpm: llmResult.bpm,
    emotionArc: options.moodArc || null,
    generationMetadata: {
      panelCount: options.panels.length,
      confidence: llmResult.confidence,
      voiceDurationEstimates: Object.fromEntries(voiceDurations),
      bpmHint: options.bpmHint,
    },
    status: "pending_review",
  });

  const dbEntries: InsertXSheetEntry[] = validatedEntries.map((e: any) => ({
    xSheetId: sheet.id,
    sliceNumber: e.sliceNumber,
    panelId: e.panelId,
    startMs: e.startMs,
    endMs: e.endMs,
    durationMs: e.durationMs,
    voiceStartMs: e.voiceStartMs || null,
    voiceEndMs: e.voiceEndMs || null,
    voiceCharacterId: null,
    voiceEmotion: e.voiceEmotion || null,
    voicePacing: e.voicePacing || null,
    musicCueType: e.musicCueType || "none",
    musicMoodShift: e.musicMoodShift || null,
    musicIntensity: e.musicIntensity ?? null,
    sfxTriggers: e.sfxTriggers || null,
    transitionType: e.transitionType || "cut",
    transitionDurationMs: e.transitionDurationMs || 0,
    sceneNumber: e.sceneNumber,
    emotion: e.emotion || null,
    energyLevel: e.energyLevel ?? null,
    cameraNote: e.cameraNote || null,
    confidence: llmResult.confidence,
  }));

  await createXSheetEntries(dbEntries);

  const musicCueCount = validatedEntries.filter((e: any) => e.musicCueType && e.musicCueType !== "none").length;
  const sfxTriggerCount = validatedEntries.reduce((sum: number, e: any) => sum + (e.sfxTriggers?.length || 0), 0);

  pipelineLog.info(`[D4] X-Sheet generated: ${validatedEntries.length} entries, ${musicCueCount} music cues, ${sfxTriggerCount} SFX triggers, confidence=${llmResult.confidence}`);

  return {
    xSheetId: sheet.id,
    totalDurationMs: llmResult.totalDurationMs,
    entryCount: validatedEntries.length,
    musicCueCount,
    sfxTriggerCount,
    confidence: llmResult.confidence,
  };
}

// ─── Heuristic Fallback ─────────────────────────────────────────────────────

function generateHeuristicXSheet(
  options: TimingDirectorOptions,
  voiceDurations: Map<number, number>
): any {
  let currentMs = 0;
  const entries: any[] = [];

  for (const panel of options.panels) {
    const voiceDur = voiceDurations.get(panel.panelNumber) || 0;
    const baseDuration = voiceDur > 0
      ? voiceDur + VOICE_TAIL_PADDING_MS + 500 // voice + padding + visual buffer
      : DEFAULT_PANEL_DURATION_MS;
    const duration = Math.max(MIN_SLICE_DURATION_MS, Math.min(MAX_SLICE_DURATION_MS, baseDuration));

    const voiceStartMs = voiceDur > 0 ? 300 : null;
    const voiceEndMs = voiceDur > 0 ? 300 + voiceDur : null;

    // Determine music cue based on scene boundaries
    let musicCueType = "none";
    const isFirstInScene = entries.length === 0 || entries[entries.length - 1]?.sceneNumber !== panel.sceneNumber;
    if (isFirstInScene) musicCueType = "start";

    // Determine transition
    const transitionType = isFirstInScene && entries.length > 0 ? "crossfade" : (panel.transition || "cut");
    const transitionDurationMs = transitionType === "cut" ? 0 : 500;

    entries.push({
      sliceNumber: panel.panelNumber,
      panelId: panel.panelId,
      startMs: currentMs,
      endMs: currentMs + duration,
      durationMs: duration,
      voiceStartMs,
      voiceEndMs,
      voiceEmotion: panel.dialogue?.[0]?.emotion || null,
      voicePacing: "normal",
      musicCueType,
      musicMoodShift: isFirstInScene ? (panel.mood || null) : null,
      musicIntensity: 50,
      sfxTriggers: panel.sfx ? [{ type: panel.sfx, offsetMs: 0, durationMs: 1000, category: "effect" }] : null,
      transitionType,
      transitionDurationMs,
      sceneNumber: panel.sceneNumber,
      emotion: panel.mood || "neutral",
      energyLevel: 5,
      cameraNote: panel.cameraAngle || null,
    });

    currentMs += duration;
  }

  return {
    bpm: 120,
    totalDurationMs: currentMs,
    confidence: 0.6,
    entries,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateEntries(
  entries: any[],
  panels: PanelTimingInput[],
  voiceDurations: Map<number, number>
): any[] {
  return entries.map((entry, i) => {
    // Clamp duration
    entry.durationMs = Math.max(MIN_SLICE_DURATION_MS, Math.min(MAX_SLICE_DURATION_MS, entry.durationMs || DEFAULT_PANEL_DURATION_MS));
    entry.endMs = entry.startMs + entry.durationMs;

    // Validate voice timing against estimated duration
    const voiceDur = voiceDurations.get(entry.sliceNumber);
    if (voiceDur && entry.voiceStartMs != null) {
      const maxVoiceEnd = entry.voiceStartMs + voiceDur;
      if (maxVoiceEnd > entry.durationMs) {
        // Extend slice to fit voice
        entry.durationMs = maxVoiceEnd + VOICE_TAIL_PADDING_MS;
        entry.endMs = entry.startMs + entry.durationMs;
      }
      entry.voiceEndMs = entry.voiceStartMs + voiceDur;
    }

    // Clamp energy level
    entry.energyLevel = Math.max(1, Math.min(10, entry.energyLevel || 5));

    // Clamp music intensity
    entry.musicIntensity = Math.max(0, Math.min(100, entry.musicIntensity || 50));

    // Validate transition duration
    if (entry.transitionType === "cut") {
      entry.transitionDurationMs = 0;
    } else {
      entry.transitionDurationMs = Math.max(200, Math.min(2000, entry.transitionDurationMs || 500));
    }

    return entry;
  });
}
