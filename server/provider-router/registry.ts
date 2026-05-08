/**
 * Provider Registry — In-memory adapter registry + DB-backed provider info.
 *
 * Adapters register themselves at import time. The registry resolves
 * a provider ID to its adapter instance and DB-sourced metadata.
 */
import { getDb } from "../db";
import { eq, and } from "drizzle-orm";
import {
  providers as providersTable,
  providerApiKeys,
  providerHealth as providerHealthTable,
} from "../../drizzle/schema";
import type {
  ProviderAdapter,
  ProviderInfo,
  Modality,
  ProviderTier,
  CircuitState,
} from "./types";

// ─── In-Memory Adapter Map ───────────────────────────────────────────────

const adapterMap = new Map<string, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  if (adapterMap.has(adapter.providerId)) {
    console.warn(`[Registry] Overwriting adapter for ${adapter.providerId}`);
  }
  adapterMap.set(adapter.providerId, adapter);
}

export function getAdapter(providerId: string): ProviderAdapter | undefined {
  return adapterMap.get(providerId);
}

export function listAdapters(): ProviderAdapter[] {
  return Array.from(adapterMap.values());
}

export function hasAdapter(providerId: string): boolean {
  return adapterMap.has(providerId);
}

// ─── DB-backed Provider Queries ──────────────────────────────────────────

export async function getProviderInfo(providerId: string): Promise<ProviderInfo | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, providerId))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToProviderInfo(rows[0]);
}

export async function listProviders(filters?: {
  modality?: Modality;
  tier?: ProviderTier;
  status?: "active" | "disabled" | "deprecated";
}): Promise<ProviderInfo[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.modality) conditions.push(eq(providersTable.modality, filters.modality));
  if (filters?.tier) conditions.push(eq(providersTable.tier, filters.tier));
  if (filters?.status) conditions.push(eq(providersTable.status, filters.status));

  const rows = conditions.length > 0
    ? await db.select().from(providersTable).where(and(...conditions))
    : await db.select().from(providersTable);

  return rows.map(rowToProviderInfo);
}

export async function getProvidersByModality(modality: Modality): Promise<ProviderInfo[]> {
  return listProviders({ modality, status: "active" });
}

export async function getProviderHealth(providerId: string): Promise<{
  circuitState: CircuitState;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  successRate1h: number | null;
  requestCount1h: number | null;
  openedAt: Date | null;
  nextRetryAt: Date | null;
} | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(providerHealthTable)
    .where(eq(providerHealthTable.providerId, providerId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    circuitState: r.circuitState as CircuitState,
    consecutiveFailures: r.consecutiveFailures,
    lastSuccessAt: r.lastSuccessAt,
    lastFailureAt: r.lastFailureAt,
    latencyP50Ms: r.latencyP50Ms,
    latencyP95Ms: r.latencyP95Ms,
    successRate1h: r.successRate1h ? Number(r.successRate1h) : null,
    requestCount1h: r.requestCount1h,
    openedAt: r.openedAt,
    nextRetryAt: r.nextRetryAt,
  };
}

/**
 * Providers that are hosted on Fal.ai and share the FAL_API_KEY env variable.
 * When no DB-stored key exists, these providers fall back to the ENV key.
 */
const FAL_AI_PROVIDERS = new Set(["wan_21", "sdxl_lightning", "flux_11_pro", "pika_22", "hailuo_director", "ideogram_3", "recraft_v3", "elevenlabs_turbo_v25", "fal_kling_v3_std", "fal_kling_v3_pro", "fal_kling_v3_omni", "fal_kling_lipsync", "pixverse_v45", "seedance_20_fast", "veo_31_lite"]);

/**
 * Get an active, non-cap-exceeded API key for a provider.
 * Returns decrypted key + metadata. Keys are AES encrypted at rest.
 *
 * For Fal.ai-hosted providers (wan_21, sdxl_lightning), falls back to
 * the FAL_API_KEY environment variable when no DB key is found.
 */
export async function getActiveApiKey(providerId: string): Promise<{
  id: number;
  decryptedKey: string;
  rateLimitRpm: number;
  dailySpendCapUsd: number | null;
} | null> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select()
      .from(providerApiKeys)
      .where(
        and(
          eq(providerApiKeys.providerId, providerId),
          eq(providerApiKeys.isActive, 1),
        ),
      )
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0];
      return {
        id: row.id,
        decryptedKey: decryptApiKey(row.encryptedKey),
        rateLimitRpm: row.rateLimitRpm,
        dailySpendCapUsd: row.dailySpendCapUsd ? Number(row.dailySpendCapUsd) : null,
      };
    }
  }

  // Fallback: Fal.ai-hosted providers can use the shared FAL_API_KEY from env
  if (FAL_AI_PROVIDERS.has(providerId)) {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (falKey) {
      return {
        id: -1, // Sentinel: ENV-sourced key, not from DB
        decryptedKey: falKey,
        rateLimitRpm: 60, // Conservative default for ENV keys
        dailySpendCapUsd: null,
      };
    }
  }

  // Fallback: providers with dedicated ENV keys
  const ENV_KEY_MAP: Record<string, string> = {
    fish_audio: "FISH_AUDIO_API_KEY",
    minimax_video02: "MINIMAX_API_KEY",
    minimax_music01: "MINIMAX_API_KEY",
    runway_gen4: "RUNWAY_API_KEY",
    runway_act_two: "RUNWAY_API_KEY",  // Act-Two uses same Runway dev API key
    wan_26: "FAL_API_KEY",  // Wan 2.6 served via fal.ai ($0.10-0.15/sec)
    storymaker_v1: "FAL_API_KEY",  // StoryMaker custom deployment (Wave 7, uses FAL_API_KEY for fal.ai custom inference)
    storydiffusion_v1: "FAL_API_KEY",  // StoryDiffusion intra-episode coherence (Wave 7 Item 2)
    // pulid_v1: DROPPED (Wave 7 close-out) — archived to server/deprecated/pulid-adapter.ts
  };
  const envVarName = ENV_KEY_MAP[providerId];
  if (envVarName) {
    const envKey = process.env[envVarName] ?? "";
    if (envKey) {
      return {
        id: -1, // Sentinel: ENV-sourced key, not from DB
        decryptedKey: envKey,
        rateLimitRpm: 60,
        dailySpendCapUsd: null,
      };
    }
  }

  return null;
}

// ─── Encryption Helpers ──────────────────────────────────────────────────

import crypto from "crypto";
import { PROVIDER_ENCRYPTION_KEY } from "../_core/env";

// C-3: KEK is now derived from validated JWT_SECRET via SHA-256 (32 bytes).
// No more all-zeros fallback. Boot fails if JWT_SECRET is missing.
const ALGORITHM = "aes-256-gcm";

export function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, PROVIDER_ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

export function decryptApiKey(encrypted: string): string {
  try {
    const [ivB64, tagB64, ciphertext] = encrypted.split(":");
    if (!ivB64 || !tagB64 || !ciphertext) {
      // Fallback: assume plaintext (for migration from unencrypted keys)
      return encrypted;
    }
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, PROVIDER_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    // If decryption fails, return as-is (plaintext fallback)
    return encrypted;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function rowToProviderInfo(row: typeof providersTable.$inferSelect): ProviderInfo {
  return {
    id: row.id,
    displayName: row.displayName,
    vendor: row.vendor,
    modality: row.modality as Modality,
    tier: row.tier as ProviderTier,
    capabilities: (row.capabilities ?? {}) as ProviderInfo["capabilities"],
    pricing: (row.pricing ?? {}) as ProviderInfo["pricing"],
    endpointUrl: row.endpointUrl,
    authScheme: row.authScheme as ProviderInfo["authScheme"],
    adapterClass: row.adapterClass,
    status: row.status as ProviderInfo["status"],
  };
}
