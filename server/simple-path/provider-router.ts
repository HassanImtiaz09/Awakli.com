/**
 * Provider Router — Abstraction Layer for Video/Voice/LipSync Providers
 * 
 * Enables one-config-flag switching between:
 * - fal.ai (default, validated)
 * - Direct PixVerse API (contingency, registered but inactive)
 * - Kling (backup for lip-sync)
 * 
 * Per Wave 9 spec: "wire the abstraction layer in the provider router so
 * swapping from fal.ai to direct PixVerse is a one-config-flag change"
 */

import { ENV } from "../_core/env";
import type { Beat, CharacterReference, VideoGenerationResult } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Provider Configuration
// ═══════════════════════════════════════════════════════════════════════════

export type VideoProvider = "fal_pixverse_c1" | "direct_pixverse_c1" | "fal_kling_v3";
export type VoiceProvider = "elevenlabs" | "cartesia";
export type LipSyncProvider = "fal_pixverse_lipsync" | "direct_pixverse_lipsync" | "kling_lipsync";

export interface ProviderRouterConfig {
  video: {
    primary: VideoProvider;
    fallback: VideoProvider;
  };
  voice: {
    primary: VoiceProvider;
    fallback: VoiceProvider;
  };
  lipSync: {
    primary: LipSyncProvider;
    fallback: LipSyncProvider;
  };
}

/** Default config: fal.ai for everything, Kling as lip-sync backup */
export const DEFAULT_PROVIDER_CONFIG: ProviderRouterConfig = {
  video: {
    primary: "fal_pixverse_c1",
    fallback: "fal_kling_v3",
  },
  voice: {
    primary: "elevenlabs",
    fallback: "cartesia",
  },
  lipSync: {
    primary: "fal_pixverse_lipsync",
    fallback: "kling_lipsync",
  },
};

/** Direct PixVerse config (for when fal.ai is down or we need Motion Control) */
export const DIRECT_PIXVERSE_CONFIG: ProviderRouterConfig = {
  video: {
    primary: "direct_pixverse_c1",
    fallback: "fal_kling_v3",
  },
  voice: {
    primary: "elevenlabs",
    fallback: "cartesia",
  },
  lipSync: {
    primary: "direct_pixverse_lipsync",
    fallback: "kling_lipsync",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Provider Health Check
// ═══════════════════════════════════════════════════════════════════════════

export interface ProviderHealth {
  provider: string;
  available: boolean;
  latencyMs?: number;
  error?: string;
}

export async function checkProviderHealth(provider: VideoProvider | LipSyncProvider): Promise<ProviderHealth> {
  switch (provider) {
    case "fal_pixverse_c1":
    case "fal_pixverse_lipsync":
      return checkFalHealth();
    case "direct_pixverse_c1":
    case "direct_pixverse_lipsync":
      return checkDirectPixVerseHealth();
    case "fal_kling_v3":
    case "kling_lipsync":
      return checkKlingHealth();
    default:
      return { provider, available: false, error: "Unknown provider" };
  }
}

async function checkFalHealth(): Promise<ProviderHealth> {
  const apiKey = ENV.falApiKey;
  if (!apiKey) return { provider: "fal.ai", available: false, error: "FAL_API_KEY not configured" };

  try {
    const start = Date.now();
    const response = await fetch("https://queue.fal.run/fal-ai/pixverse/c1/reference-to-video", {
      method: "OPTIONS",
      headers: { Authorization: `Key ${apiKey}` },
    });
    const latency = Date.now() - start;
    return { provider: "fal.ai", available: response.status < 500, latencyMs: latency };
  } catch (err) {
    return { provider: "fal.ai", available: false, error: String(err) };
  }
}

async function checkDirectPixVerseHealth(): Promise<ProviderHealth> {
  const apiKey = ENV.pixverseApiKey;
  if (!apiKey) return { provider: "direct_pixverse", available: false, error: "PIXVERSE_API_KEY not configured" };

  try {
    const start = Date.now();
    const response = await fetch("https://app-api.pixverse.ai/openapi/v2/video/task/list", {
      method: "GET",
      headers: { "API-KEY": apiKey },
    });
    const latency = Date.now() - start;
    return { provider: "direct_pixverse", available: response.ok, latencyMs: latency };
  } catch (err) {
    return { provider: "direct_pixverse", available: false, error: String(err) };
  }
}

async function checkKlingHealth(): Promise<ProviderHealth> {
  const apiKey = ENV.falApiKey; // Kling via fal.ai
  if (!apiKey) return { provider: "kling", available: false, error: "FAL_API_KEY not configured" };
  return { provider: "kling", available: true, latencyMs: 0 }; // Assume available if fal.ai key exists
}

// ═══════════════════════════════════════════════════════════════════════════
// Direct PixVerse API Adapter (Contingency — Not Active)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Direct PixVerse C1 Reference-to-Video API
 * 
 * Endpoint: POST https://app-api.pixverse.ai/openapi/v2/video/generate/with_character
 * Auth: API-KEY header
 * 
 * NOT ACTIVE — registered in secrets infrastructure for immediate-activation capability.
 * To activate: set PIXVERSE_API_KEY in secrets, change config to DIRECT_PIXVERSE_CONFIG.
 */
export async function generateVideoDirectPixVerse(
  prompt: string,
  characterImages: Array<{ url: string; name: string }>,
  options: {
    duration?: number;
    quality?: string;
    resolution?: string;
  } = {}
): Promise<{ taskId: string; videoUrl?: string }> {
  const apiKey = ENV.pixverseApiKey;
  if (!apiKey) throw new Error("PIXVERSE_API_KEY not configured — activate contingency plan first");

  // Step 1: Upload character images to PixVerse
  const characterIds: string[] = [];
  for (const char of characterImages) {
    const uploadResp = await fetch("https://app-api.pixverse.ai/openapi/v2/character/create", {
      method: "POST",
      headers: {
        "API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: char.url,
        name: char.name,
      }),
    });
    if (!uploadResp.ok) throw new Error(`PixVerse character upload failed: ${uploadResp.status}`);
    const data = await uploadResp.json();
    characterIds.push(data.data?.character_id || data.character_id);
  }

  // Step 2: Generate video with character references
  const genResp = await fetch("https://app-api.pixverse.ai/openapi/v2/video/generate/with_character", {
    method: "POST",
    headers: {
      "API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      character_ids: characterIds,
      duration: options.duration || 5,
      quality: options.quality || "720p",
      model: "v3.5", // C1 model
    }),
  });

  if (!genResp.ok) throw new Error(`PixVerse generation failed: ${genResp.status}`);
  const genData = await genResp.json();
  const taskId = genData.data?.task_id || genData.task_id;

  // Step 3: Poll for completion
  let videoUrl: string | undefined;
  const maxPolls = 120; // 10 minutes max
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 5000)); // 5s intervals

    const statusResp = await fetch(`https://app-api.pixverse.ai/openapi/v2/video/task/${taskId}`, {
      headers: { "API-KEY": apiKey },
    });
    if (!statusResp.ok) continue;

    const statusData = await statusResp.json();
    const status = statusData.data?.status || statusData.status;

    if (status === "completed" || status === "success") {
      videoUrl = statusData.data?.video_url || statusData.video_url;
      break;
    } else if (status === "failed") {
      throw new Error(`PixVerse task ${taskId} failed: ${JSON.stringify(statusData)}`);
    }
  }

  return { taskId, videoUrl };
}

// ═══════════════════════════════════════════════════════════════════════════
// Direct PixVerse Lip-Sync Adapter (Contingency)
// ═══════════════════════════════════════════════════════════════════════════

export async function lipSyncDirectPixVerse(
  videoUrl: string,
  audioUrl: string
): Promise<{ taskId: string; videoUrl?: string }> {
  const apiKey = ENV.pixverseApiKey;
  if (!apiKey) throw new Error("PIXVERSE_API_KEY not configured");

  const resp = await fetch("https://app-api.pixverse.ai/openapi/v2/video/lipsync", {
    method: "POST",
    headers: {
      "API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      video_url: videoUrl,
      audio_url: audioUrl,
    }),
  });

  if (!resp.ok) throw new Error(`PixVerse lip-sync failed: ${resp.status}`);
  const data = await resp.json();
  const taskId = data.data?.task_id || data.task_id;

  // Poll for completion
  let resultUrl: string | undefined;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusResp = await fetch(`https://app-api.pixverse.ai/openapi/v2/video/task/${taskId}`, {
      headers: { "API-KEY": apiKey },
    });
    if (!statusResp.ok) continue;
    const statusData = await statusResp.json();
    if (statusData.data?.status === "completed") {
      resultUrl = statusData.data?.video_url;
      break;
    }
  }

  return { taskId, videoUrl: resultUrl };
}

// ═══════════════════════════════════════════════════════════════════════════
// Route Request to Active Provider
// ═══════════════════════════════════════════════════════════════════════════

export function getActiveConfig(): ProviderRouterConfig {
  // Check if direct PixVerse is configured and should be primary
  const pixverseKey = (ENV as any).pixverseApiKey;
  if (pixverseKey && process.env.USE_DIRECT_PIXVERSE === "true") {
    return DIRECT_PIXVERSE_CONFIG;
  }
  return DEFAULT_PROVIDER_CONFIG;
}
