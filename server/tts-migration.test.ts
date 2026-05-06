/**
 * Wave 6A Item 6: TTS Migration Tests
 * 
 * Validates:
 * - Inworld TTS-1.5-Max adapter configuration
 * - Kokoro Free-tier adapter configuration
 * - Tier routing (Free → Kokoro, Creator+ → Inworld, ElevenLabs → fallback)
 * - D8 retry budget update (2 → 3)
 * - Voice cloning validation
 * - Cost comparison utility
 * - Migration status tracking
 */
import { describe, it, expect } from "vitest";
import {
  INWORLD_CONFIG,
  KOKORO_CONFIG,
  TTS_TIER_ROUTING,
  resolveTTSProvider,
  isVoiceCloningAvailable,
  D8_RETRY_BUDGET,
  isRetryWithinBudget,
  validateVoiceCloneRequest,
  buildInworldAdapterConfig,
  buildKokoroAdapterConfig,
  compareTTSCosts,
  checkMigrationStatus,
} from "./tts-migration";

describe("TTS Migration — Inworld TTS-1.5-Max Adapter", () => {
  it("has correct provider ID and vendor", () => {
    expect(INWORLD_CONFIG.providerId).toBe("inworld_tts_15_max");
    expect(INWORLD_CONFIG.vendor).toBe("inworld");
    expect(INWORLD_CONFIG.modality).toBe("voice");
  });

  it("pricing is $10/M chars ($0.00001/char)", () => {
    expect(INWORLD_CONFIG.costPerChar).toBe(0.00001);
    expect(INWORLD_CONFIG.pricing.rate).toBe(0.00001);
  });

  it("supports voice cloning with 5-15s samples", () => {
    expect(INWORLD_CONFIG.capabilities.voiceCloning).toBe(true);
    expect(INWORLD_CONFIG.capabilities.voiceCloningSampleDuration.min).toBe(5);
    expect(INWORLD_CONFIG.capabilities.voiceCloningSampleDuration.max).toBe(15);
  });

  it("supports context-aware prosody and emotion control", () => {
    expect(INWORLD_CONFIG.capabilities.contextAwareProsody).toBe(true);
    expect(INWORLD_CONFIG.capabilities.emotionControl).toBe(true);
  });

  it("is classified as standard tier (available to Creator+)", () => {
    expect(INWORLD_CONFIG.tier).toBe("standard");
  });

  it("buildInworldAdapterConfig returns valid factory config", () => {
    const config = buildInworldAdapterConfig();
    expect(config.providerId).toBe("inworld_tts_15_max");
    expect(config.isStreaming).toBe(true);
    expect(config.maxChars).toBe(8000);

    const body = config.buildBody({ text: "Hello world", voiceId: "char-voice-1" });
    expect(body.text).toBe("Hello world");
    expect(body.voice_id).toBe("char-voice-1");
    expect(body.model).toBe("tts-1.5-max");
    expect(body.emotion_control).toBe(true);
    expect(body.context_aware).toBe(true);
  });

  it("buildInworldAdapterConfig uses default voice when none specified", () => {
    const config = buildInworldAdapterConfig();
    const body = config.buildBody({ text: "Test" });
    expect(body.voice_id).toBe("default-anime-narrator");
  });

  it("auth header uses Bearer token", () => {
    const config = buildInworldAdapterConfig();
    const headers = config.authHeader("test-key-123");
    expect(headers["Authorization"]).toBe("Bearer test-key-123");
  });
});

describe("TTS Migration — Kokoro Free-Tier Adapter", () => {
  it("has correct provider ID and vendor", () => {
    expect(KOKORO_CONFIG.providerId).toBe("kokoro_free");
    expect(KOKORO_CONFIG.vendor).toBe("kokoro");
    expect(KOKORO_CONFIG.modality).toBe("voice");
  });

  it("pricing is $0.70/M chars ($0.0000007/char)", () => {
    expect(KOKORO_CONFIG.costPerChar).toBe(0.0000007);
    expect(KOKORO_CONFIG.pricing.rate).toBe(0.0000007);
  });

  it("does NOT support voice cloning", () => {
    expect(KOKORO_CONFIG.capabilities.voiceCloning).toBe(false);
  });

  it("is classified as budget tier (available to Free users)", () => {
    expect(KOKORO_CONFIG.tier).toBe("budget");
  });

  it("buildKokoroAdapterConfig returns valid factory config", () => {
    const config = buildKokoroAdapterConfig();
    expect(config.providerId).toBe("kokoro_free");
    expect(config.isStreaming).toBe(true);
    expect(config.maxChars).toBe(5000);

    const body = config.buildBody({ text: "Hello world", voiceId: "narrator" });
    expect(body.text).toBe("Hello world");
    expect(body.voice).toBe("narrator");
    expect(body.format).toBe("mp3");
  });

  it("buildKokoroAdapterConfig uses default voice when none specified", () => {
    const config = buildKokoroAdapterConfig();
    const body = config.buildBody({ text: "Test" });
    expect(body.voice).toBe("default");
  });
});

describe("TTS Migration — Tier Routing", () => {
  it("Free tier routes to Kokoro primary", () => {
    const route = resolveTTSProvider("free");
    expect(route.primary).toBe("kokoro_free");
    expect(route.fallback).toBe("elevenlabs_turbo_v25");
    expect(route.voiceCloningEnabled).toBe(false);
  });

  it("Creator tier routes to Inworld primary", () => {
    const route = resolveTTSProvider("creator");
    expect(route.primary).toBe("inworld_tts_15_max");
    expect(route.fallback).toBe("elevenlabs_turbo_v25");
    expect(route.voiceCloningEnabled).toBe(true);
  });

  it("Creator+ tier routes to Inworld primary", () => {
    const route = resolveTTSProvider("creator_plus");
    expect(route.primary).toBe("inworld_tts_15_max");
    expect(route.voiceCloningEnabled).toBe(true);
  });

  it("Studio tier routes to Inworld primary", () => {
    const route = resolveTTSProvider("studio");
    expect(route.primary).toBe("inworld_tts_15_max");
  });

  it("Studio Pro tier routes to Inworld primary", () => {
    const route = resolveTTSProvider("studio_pro");
    expect(route.primary).toBe("inworld_tts_15_max");
  });

  it("Enterprise tier routes to Inworld primary", () => {
    const route = resolveTTSProvider("enterprise");
    expect(route.primary).toBe("inworld_tts_15_max");
  });

  it("Unknown tier defaults to Free routing (Kokoro)", () => {
    const route = resolveTTSProvider("unknown_tier");
    expect(route.primary).toBe("kokoro_free");
    expect(route.voiceCloningEnabled).toBe(false);
  });

  it("All tiers have ElevenLabs as fallback", () => {
    for (const tier of Object.keys(TTS_TIER_ROUTING)) {
      expect(TTS_TIER_ROUTING[tier].fallback).toBe("elevenlabs_turbo_v25");
    }
  });

  it("All tiers have maxRetriesPerLine = 3 (updated from 2)", () => {
    for (const tier of Object.keys(TTS_TIER_ROUTING)) {
      expect(TTS_TIER_ROUTING[tier].maxRetriesPerLine).toBe(3);
    }
  });

  it("voice cloning is available for Creator+ but not Free", () => {
    expect(isVoiceCloningAvailable("free")).toBe(false);
    expect(isVoiceCloningAvailable("creator")).toBe(true);
    expect(isVoiceCloningAvailable("creator_plus")).toBe(true);
    expect(isVoiceCloningAvailable("studio")).toBe(true);
    expect(isVoiceCloningAvailable("studio_pro")).toBe(true);
  });
});

describe("TTS Migration — D8 Retry Budget Update", () => {
  it("legacy max retries was 2", () => {
    expect(D8_RETRY_BUDGET.LEGACY_MAX_RETRIES).toBe(2);
  });

  it("new max retries is 3", () => {
    expect(D8_RETRY_BUDGET.MAX_RETRIES_PER_LINE).toBe(3);
  });

  it("allows retry when under budget", () => {
    const result = isRetryWithinBudget({
      currentRetryCount: 1,
      currentLineCostUsd: 0.01,
      currentEpisodeCostUsd: 0.50,
      subscriptionTier: "creator",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks retry when max retries reached", () => {
    const result = isRetryWithinBudget({
      currentRetryCount: 3,
      currentLineCostUsd: 0.01,
      currentEpisodeCostUsd: 0.50,
      subscriptionTier: "creator",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Max retries");
  });

  it("blocks retry when line cost ceiling reached", () => {
    const result = isRetryWithinBudget({
      currentRetryCount: 1,
      currentLineCostUsd: 0.06,
      currentEpisodeCostUsd: 0.50,
      subscriptionTier: "creator",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Line cost ceiling");
  });

  it("blocks retry when episode budget exhausted", () => {
    const result = isRetryWithinBudget({
      currentRetryCount: 1,
      currentLineCostUsd: 0.01,
      currentEpisodeCostUsd: 1.60,
      subscriptionTier: "creator",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Episode retry budget");
  });

  it("respects tier-specific max retries", () => {
    // Free tier also has 3 retries now
    const result = isRetryWithinBudget({
      currentRetryCount: 2,
      currentLineCostUsd: 0.001,
      currentEpisodeCostUsd: 0.01,
      subscriptionTier: "free",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("TTS Migration — Voice Cloning Validation", () => {
  it("accepts valid voice clone request", () => {
    const result = validateVoiceCloneRequest({
      sampleUrl: "https://storage.example.com/sample.mp3",
      sampleDurationSec: 10,
      characterName: "Naruto",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing sample URL", () => {
    const result = validateVoiceCloneRequest({
      sampleUrl: "",
      sampleDurationSec: 10,
      characterName: "Naruto",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Sample audio URL is required");
  });

  it("rejects sample shorter than 5 seconds", () => {
    const result = validateVoiceCloneRequest({
      sampleUrl: "https://example.com/short.mp3",
      sampleDurationSec: 3,
      characterName: "Naruto",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("at least 5s");
  });

  it("rejects sample longer than 15 seconds", () => {
    const result = validateVoiceCloneRequest({
      sampleUrl: "https://example.com/long.mp3",
      sampleDurationSec: 20,
      characterName: "Naruto",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("at most 15s");
  });

  it("rejects empty character name", () => {
    const result = validateVoiceCloneRequest({
      sampleUrl: "https://example.com/sample.mp3",
      sampleDurationSec: 10,
      characterName: "  ",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Character name is required");
  });

  it("accumulates multiple errors", () => {
    const result = validateVoiceCloneRequest({
      sampleUrl: "",
      sampleDurationSec: 2,
      characterName: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("TTS Migration — Cost Comparison", () => {
  it("compares costs for typical episode (7000 chars)", () => {
    const comparison = compareTTSCosts(7000);
    expect(comparison).toHaveLength(3);

    const inworld = comparison.find(c => c.provider === "inworld_tts_15_max")!;
    const kokoro = comparison.find(c => c.provider === "kokoro_free")!;
    const elevenlabs = comparison.find(c => c.provider === "elevenlabs_turbo_v25")!;

    // Inworld: 7000 * $0.00001 = $0.07
    expect(inworld.costPerEpisode).toBeCloseTo(0.07, 4);
    // Kokoro: 7000 * $0.0000007 = $0.0049
    expect(kokoro.costPerEpisode).toBeCloseTo(0.0049, 4);
    // ElevenLabs: 7000 * $0.00005 = $0.35
    expect(elevenlabs.costPerEpisode).toBeCloseTo(0.35, 4);
  });

  it("Inworld saves ~80% vs ElevenLabs", () => {
    const comparison = compareTTSCosts(10000);
    const inworld = comparison.find(c => c.provider === "inworld_tts_15_max")!;
    expect(inworld.savingsPercent).toBeCloseTo(80, 0);
  });

  it("Kokoro saves ~98.6% vs ElevenLabs", () => {
    const comparison = compareTTSCosts(10000);
    const kokoro = comparison.find(c => c.provider === "kokoro_free")!;
    expect(kokoro.savingsPercent).toBeGreaterThan(98);
  });

  it("ElevenLabs has zero savings (baseline)", () => {
    const comparison = compareTTSCosts(5000);
    const elevenlabs = comparison.find(c => c.provider === "elevenlabs_turbo_v25")!;
    expect(elevenlabs.savingsVsElevenLabs).toBe(0);
    expect(elevenlabs.savingsPercent).toBe(0);
  });
});

describe("TTS Migration — Migration Status", () => {
  it("reports migration complete when using target provider", () => {
    const status = checkMigrationStatus({
      activeProvider: "inworld_tts_15_max",
      totalVoiceClones: 5,
      migratedVoiceClones: 5,
      subscriptionTier: "creator",
    });
    expect(status.migrationComplete).toBe(true);
    expect(status.fallbackActive).toBe(false);
    expect(status.voiceClonesPending).toBe(0);
  });

  it("reports fallback active when using ElevenLabs", () => {
    const status = checkMigrationStatus({
      activeProvider: "elevenlabs_turbo_v25",
      totalVoiceClones: 5,
      migratedVoiceClones: 2,
      subscriptionTier: "creator",
    });
    expect(status.migrationComplete).toBe(false);
    expect(status.fallbackActive).toBe(true);
    expect(status.voiceClonesPending).toBe(3);
  });

  it("reports correct target for Free tier", () => {
    const status = checkMigrationStatus({
      activeProvider: "elevenlabs_turbo_v25",
      totalVoiceClones: 0,
      migratedVoiceClones: 0,
      subscriptionTier: "free",
    });
    expect(status.targetPrimary).toBe("kokoro_free");
  });

  it("reports correct target for Creator tier", () => {
    const status = checkMigrationStatus({
      activeProvider: "kokoro_free",
      totalVoiceClones: 3,
      migratedVoiceClones: 0,
      subscriptionTier: "creator",
    });
    expect(status.targetPrimary).toBe("inworld_tts_15_max");
    expect(status.migrationComplete).toBe(false);
  });
});
