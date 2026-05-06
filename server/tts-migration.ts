/**
 * Wave 6A Item 6: TTS Migration to Inworld + Kokoro
 * 
 * Replaces ElevenLabs as primary TTS with:
 * - Inworld TTS-1.5-Max (Creator+ tiers) — $10/M chars, ELO 1,236, voice cloning
 * - Kokoro (Free tier) — $0.70/M chars, ELO 1,059, no voice cloning
 * - ElevenLabs retained as fallback only
 * 
 * Architecture:
 * - Both adapters use the existing createVoiceAdapter() factory pattern
 * - Tier routing: Free → Kokoro, Creator+ → Inworld, ElevenLabs → fallback
 * - D8 retry budget: 2 → 3 per dialogue line (cost-favorable with Inworld pricing)
 */

import type { ProviderTier } from "./provider-router/types";

// ─── Inworld TTS-1.5-Max Configuration ──────────────────────────────────────
export const INWORLD_CONFIG = {
  providerId: "inworld_tts_15_max",
  displayName: "Inworld TTS-1.5-Max",
  vendor: "inworld",
  modality: "voice" as const,
  tier: "standard" as ProviderTier,
  modelName: "tts-1.5-max",
  baseUrl: "https://api.inworld.ai/v1",
  costPerChar: 0.00001, // $10/M chars = $0.01/1000 chars = $0.00001/char
  maxChars: 8000,
  submitEndpoint: "/tts/generate",
  capabilities: {
    voiceCloning: true,
    voiceCloningSampleDuration: { min: 5, max: 15 }, // seconds
    contextAwareProsody: true,
    emotionControl: true,
    multiLanguage: true,
    maxSampleRate: 48000,
    outputFormats: ["mp3", "wav", "ogg"],
    streamingSupport: true,
  },
  pricing: {
    unit: "character",
    rate: 0.00001, // $10/M chars
    currency: "USD",
    effectiveDate: "2026-05-01",
  },
} as const;

// ─── Kokoro Free-Tier Configuration ─────────────────────────────────────────
export const KOKORO_CONFIG = {
  providerId: "kokoro_free",
  displayName: "Kokoro TTS",
  vendor: "kokoro",
  modality: "voice" as const,
  tier: "budget" as ProviderTier,
  modelName: "kokoro-v1",
  baseUrl: "https://api.kokoro.ai/v1", // or fal.ai self-hosted endpoint
  costPerChar: 0.0000007, // $0.70/M chars
  maxChars: 5000,
  submitEndpoint: "/tts/synthesize",
  capabilities: {
    voiceCloning: false,
    contextAwareProsody: false,
    emotionControl: false,
    multiLanguage: true,
    maxSampleRate: 24000,
    outputFormats: ["mp3", "wav"],
    streamingSupport: false,
  },
  pricing: {
    unit: "character",
    rate: 0.0000007, // $0.70/M chars
    currency: "USD",
    effectiveDate: "2026-05-01",
  },
} as const;

// ─── Tier Routing Configuration ─────────────────────────────────────────────
/**
 * TTS provider routing by subscription tier:
 * - Free → Kokoro (cheapest, no voice cloning)
 * - Creator → Inworld TTS-1.5-Max (voice cloning, context-aware prosody)
 * - Creator+ → Inworld TTS-1.5-Max
 * - Studio → Inworld TTS-1.5-Max
 * - Studio Pro → Inworld TTS-1.5-Max with priority queue
 * - Enterprise → Inworld TTS-1.5-Max with dedicated capacity
 * - Fallback (all tiers) → ElevenLabs Turbo v2.5
 */
export interface TTSTierRoute {
  primary: string;
  fallback: string;
  voiceCloningEnabled: boolean;
  maxRetriesPerLine: number;
}

export const TTS_TIER_ROUTING: Record<string, TTSTierRoute> = {
  free: {
    primary: "kokoro_free",
    fallback: "elevenlabs_turbo_v25",
    voiceCloningEnabled: false,
    maxRetriesPerLine: 3,
  },
  creator: {
    primary: "inworld_tts_15_max",
    fallback: "elevenlabs_turbo_v25",
    voiceCloningEnabled: true,
    maxRetriesPerLine: 3,
  },
  "creator_plus": {
    primary: "inworld_tts_15_max",
    fallback: "elevenlabs_turbo_v25",
    voiceCloningEnabled: true,
    maxRetriesPerLine: 3,
  },
  studio: {
    primary: "inworld_tts_15_max",
    fallback: "elevenlabs_turbo_v25",
    voiceCloningEnabled: true,
    maxRetriesPerLine: 3,
  },
  "studio_pro": {
    primary: "inworld_tts_15_max",
    fallback: "elevenlabs_turbo_v25",
    voiceCloningEnabled: true,
    maxRetriesPerLine: 3,
  },
  enterprise: {
    primary: "inworld_tts_15_max",
    fallback: "elevenlabs_turbo_v25",
    voiceCloningEnabled: true,
    maxRetriesPerLine: 3,
  },
};

/**
 * Resolve the TTS provider for a given subscription tier
 */
export function resolveTTSProvider(subscriptionTier: string): TTSTierRoute {
  return TTS_TIER_ROUTING[subscriptionTier] ?? TTS_TIER_ROUTING.free;
}

/**
 * Check if voice cloning is available for a given tier
 */
export function isVoiceCloningAvailable(subscriptionTier: string): boolean {
  const route = resolveTTSProvider(subscriptionTier);
  return route.voiceCloningEnabled;
}

// ─── D8 Retry Budget Update ─────────────────────────────────────────────────
/**
 * Updated retry budget: 2 → 3 per dialogue line
 * 
 * Rationale: With Inworld at $10/M chars (vs ElevenLabs at $50/M chars),
 * an extra retry costs ~$0.003 per line vs ~$0.015 previously.
 * The quality improvement from 3 retries justifies the marginal cost increase.
 */
export const D8_RETRY_BUDGET = {
  /** Previous default (ElevenLabs era) */
  LEGACY_MAX_RETRIES: 2,
  /** New default (Inworld/Kokoro era) */
  MAX_RETRIES_PER_LINE: 3,
  /** Cost threshold per line before escalation ($) */
  MAX_COST_PER_LINE_USD: 0.05,
  /** Total retry budget per episode ($) */
  MAX_RETRY_BUDGET_PER_EPISODE_USD: 1.50,
} as const;

/**
 * Calculate whether another retry is within budget
 */
export function isRetryWithinBudget(params: {
  currentRetryCount: number;
  currentLineCostUsd: number;
  currentEpisodeCostUsd: number;
  subscriptionTier: string;
}): { allowed: boolean; reason?: string } {
  const route = resolveTTSProvider(params.subscriptionTier);

  if (params.currentRetryCount >= route.maxRetriesPerLine) {
    return { allowed: false, reason: `Max retries (${route.maxRetriesPerLine}) reached for this line` };
  }

  if (params.currentLineCostUsd >= D8_RETRY_BUDGET.MAX_COST_PER_LINE_USD) {
    return { allowed: false, reason: `Line cost ceiling ($${D8_RETRY_BUDGET.MAX_COST_PER_LINE_USD}) reached` };
  }

  if (params.currentEpisodeCostUsd >= D8_RETRY_BUDGET.MAX_RETRY_BUDGET_PER_EPISODE_USD) {
    return { allowed: false, reason: `Episode retry budget ($${D8_RETRY_BUDGET.MAX_RETRY_BUDGET_PER_EPISODE_USD}) exhausted` };
  }

  return { allowed: true };
}

// ─── Inworld Voice Cloning ──────────────────────────────────────────────────
export interface VoiceCloneRequest {
  /** User-uploaded audio sample (5-15 seconds) */
  sampleUrl: string;
  /** Sample duration in seconds */
  sampleDurationSec: number;
  /** Character name for the voice profile */
  characterName: string;
  /** Language code */
  language?: string;
}

export interface VoiceCloneResult {
  voiceId: string;
  characterName: string;
  status: "ready" | "processing" | "failed";
  estimatedReadyAt?: Date;
}

/**
 * Validate a voice cloning request
 */
export function validateVoiceCloneRequest(req: VoiceCloneRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!req.sampleUrl) {
    errors.push("Sample audio URL is required");
  }

  if (req.sampleDurationSec < INWORLD_CONFIG.capabilities.voiceCloningSampleDuration.min) {
    errors.push(`Sample must be at least ${INWORLD_CONFIG.capabilities.voiceCloningSampleDuration.min}s (got ${req.sampleDurationSec}s)`);
  }

  if (req.sampleDurationSec > INWORLD_CONFIG.capabilities.voiceCloningSampleDuration.max) {
    errors.push(`Sample must be at most ${INWORLD_CONFIG.capabilities.voiceCloningSampleDuration.max}s (got ${req.sampleDurationSec}s)`);
  }

  if (!req.characterName || req.characterName.trim().length === 0) {
    errors.push("Character name is required");
  }

  return { valid: errors.length === 0, errors };
}

// ─── Adapter Builder Functions ──────────────────────────────────────────────
/**
 * Build the Inworld adapter configuration for createVoiceAdapter()
 */
export function buildInworldAdapterConfig() {
  return {
    providerId: INWORLD_CONFIG.providerId,
    modelName: INWORLD_CONFIG.modelName,
    baseUrl: INWORLD_CONFIG.baseUrl,
    costPerChar: INWORLD_CONFIG.costPerChar,
    maxChars: INWORLD_CONFIG.maxChars,
    submitEndpoint: INWORLD_CONFIG.submitEndpoint,
    isStreaming: true,
    buildBody: (v: { text?: string; ssml?: string; voiceId?: string; speed?: number; language?: string }) => ({
      text: v.text ?? "",
      voice_id: v.voiceId ?? "default-anime-narrator",
      model: INWORLD_CONFIG.modelName,
      output_format: "mp3",
      speed: v.speed ?? 1.0,
      language: v.language ?? "en",
      emotion_control: true,
      context_aware: true,
    }),
    authHeader: (key: string) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
  };
}

/**
 * Build the Kokoro adapter configuration for createVoiceAdapter()
 */
export function buildKokoroAdapterConfig() {
  return {
    providerId: KOKORO_CONFIG.providerId,
    modelName: KOKORO_CONFIG.modelName,
    baseUrl: KOKORO_CONFIG.baseUrl,
    costPerChar: KOKORO_CONFIG.costPerChar,
    maxChars: KOKORO_CONFIG.maxChars,
    submitEndpoint: KOKORO_CONFIG.submitEndpoint,
    isStreaming: true,
    buildBody: (v: { text?: string; ssml?: string; voiceId?: string; speed?: number }) => ({
      text: v.text ?? "",
      voice: v.voiceId ?? "default",
      format: "mp3",
      speed: v.speed ?? 1.0,
    }),
    authHeader: (key: string) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
  };
}

// ─── Cost Comparison Utility ────────────────────────────────────────────────
export interface TTSCostComparison {
  provider: string;
  costPerEpisode: number;
  costPer1000Chars: number;
  savingsVsElevenLabs: number;
  savingsPercent: number;
}

const ELEVENLABS_COST_PER_CHAR = 0.00005; // $50/M chars (via fal.ai at $0.05/1000)

/**
 * Compare TTS costs for a given text length
 */
export function compareTTSCosts(textLengthChars: number): TTSCostComparison[] {
  const elevenLabsCost = textLengthChars * ELEVENLABS_COST_PER_CHAR;

  return [
    {
      provider: "inworld_tts_15_max",
      costPerEpisode: textLengthChars * INWORLD_CONFIG.costPerChar,
      costPer1000Chars: INWORLD_CONFIG.costPerChar * 1000,
      savingsVsElevenLabs: elevenLabsCost - (textLengthChars * INWORLD_CONFIG.costPerChar),
      savingsPercent: ((elevenLabsCost - (textLengthChars * INWORLD_CONFIG.costPerChar)) / elevenLabsCost) * 100,
    },
    {
      provider: "kokoro_free",
      costPerEpisode: textLengthChars * KOKORO_CONFIG.costPerChar,
      costPer1000Chars: KOKORO_CONFIG.costPerChar * 1000,
      savingsVsElevenLabs: elevenLabsCost - (textLengthChars * KOKORO_CONFIG.costPerChar),
      savingsPercent: ((elevenLabsCost - (textLengthChars * KOKORO_CONFIG.costPerChar)) / elevenLabsCost) * 100,
    },
    {
      provider: "elevenlabs_turbo_v25",
      costPerEpisode: elevenLabsCost,
      costPer1000Chars: ELEVENLABS_COST_PER_CHAR * 1000,
      savingsVsElevenLabs: 0,
      savingsPercent: 0,
    },
  ];
}

// ─── Migration Utility ──────────────────────────────────────────────────────
export interface TTSMigrationStatus {
  currentPrimary: string;
  targetPrimary: string;
  migrationComplete: boolean;
  fallbackActive: boolean;
  voiceClonesMigrated: number;
  voiceClonesPending: number;
}

/**
 * Check the migration status from ElevenLabs to Inworld/Kokoro
 */
export function checkMigrationStatus(params: {
  activeProvider: string;
  totalVoiceClones: number;
  migratedVoiceClones: number;
  subscriptionTier: string;
}): TTSMigrationStatus {
  const route = resolveTTSProvider(params.subscriptionTier);

  return {
    currentPrimary: params.activeProvider,
    targetPrimary: route.primary,
    migrationComplete: params.activeProvider === route.primary,
    fallbackActive: params.activeProvider === route.fallback,
    voiceClonesMigrated: params.migratedVoiceClones,
    voiceClonesPending: params.totalVoiceClones - params.migratedVoiceClones,
  };
}
