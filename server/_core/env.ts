/**
 * Validated environment variables — fail fast at boot if critical secrets are missing.
 *
 * Audit fixes: C-1 (removed ownerOpenId), C-2 (JWT_SECRET required), C-3 (KEK required)
 */
import * as crypto from "crypto";
import { serverLog } from "../observability/logger";

// ─── Validation Helpers ─────────────────────────────────────────────────

function requireEnv(name: string, minLength: number = 1): string {
  const value = process.env[name] ?? "";
  if (!value || value.length < minLength) {
    const msg = `[FATAL] ${name} must be set to a ${minLength}+ character secret. Server cannot start.\n` +
      `  Hint: generate with \`openssl rand -hex ${Math.ceil(minLength / 2)}\``;
    serverLog.error(msg);
    throw new Error(msg);
  }
  return value;
}

function optionalEnv(name: string, fallback: string = ""): string {
  return process.env[name] ?? fallback;
}

// ─── Boot-time Validation ───────────────────────────────────────────────

// C-2: JWT_SECRET must be non-empty, min 16 chars (platform provides 22-char secrets)
const jwtSecret = requireEnv("JWT_SECRET", 16);

// C-3: Provider-router KEK derived from JWT_SECRET (must be 32 bytes for AES-256)
// The KEK is the first 32 bytes of the SHA-256 hash of JWT_SECRET
const kekBuffer = crypto.createHash("sha256").update(jwtSecret).digest();
const PROVIDER_KEK = kekBuffer.subarray(0, 32);

// C-3: Boot-time canary self-test — encrypt then decrypt a known value
function kekSelfTest(): void {
  const canary = "awakli-kek-canary-" + Date.now();
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", PROVIDER_KEK, iv);
    let encrypted = cipher.update(canary, "utf8", "base64");
    encrypted += cipher.final("base64");
    const tag = cipher.getAuthTag();

    const decipher = crypto.createDecipheriv("aes-256-gcm", PROVIDER_KEK, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");

    if (decrypted !== canary) {
      throw new Error("Round-trip mismatch");
    }
    serverLog.info("KEK canary self-test passed");
  } catch (err) {
    const msg = `[FATAL] KEK canary self-test FAILED. Encryption key is broken or rotated.\n` +
      `  If the KEK was rotated, existing encrypted provider credentials must be re-entered.\n` +
      `  Error: ${err}`;
    serverLog.error(msg);
    throw new Error(msg);
  }
}

// Run self-test at module load (boot time)
kekSelfTest();

// ─── Exported ENV ───────────────────────────────────────────────────────

export const ENV = {
  appId: optionalEnv("VITE_APP_ID"),
  cookieSecret: jwtSecret,
  databaseUrl: optionalEnv("DATABASE_URL"),
  oAuthServerUrl: optionalEnv("OAUTH_SERVER_URL"),
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: optionalEnv("BUILT_IN_FORGE_API_URL"),
  forgeApiKey: optionalEnv("BUILT_IN_FORGE_API_KEY"),
  stripeSecretKey: optionalEnv("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: optionalEnv("STRIPE_WEBHOOK_SECRET"),
  elevenLabsApiKey: optionalEnv("ELEVENLABS_API_KEY"),
  klingAccessKey: optionalEnv("KLING_ACCESS_KEY"),
  klingSecretKey: optionalEnv("KLING_SECRET_KEY"),
  minimaxApiKey: optionalEnv("MINIMAX_API_KEY"),
  cloudflareAccountId: optionalEnv("CLOUDFLARE_ACCOUNT_ID"),
  cloudflareStreamToken: optionalEnv("CLOUDFLARE_STREAM_TOKEN"),
  falApiKey: optionalEnv("FAL_API_KEY"),
  fishAudioApiKey: optionalEnv("FISH_AUDIO_API_KEY"),
  runwayApiKey: optionalEnv("RUNWAY_API_KEY"),
  cartesiaApiKey: optionalEnv("CARTESIA_API_KEY"),
  pixverseApiKey: optionalEnv("PIXVERSE_API_KEY"),
};

/** Provider-router encryption key (32 bytes, derived from JWT_SECRET) */
export const PROVIDER_ENCRYPTION_KEY = PROVIDER_KEK;
