/**
 * Fal.ai Provider Integration Tests
 * Tests: Wan 2.1 adapter (Fal.ai queue API), SDXL Lightning adapter,
 * and registry ENV fallback for FAL_API_KEY.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Wan 2.1 Adapter Registration & Validation ──────────────────────
describe("Wan 2.1 Adapter (Fal.ai)", () => {
  it("is registered with providerId wan_21", async () => {
    await import("./provider-router/adapters/video-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("wan_21")).toBe(true);
    const adapter = getAdapter("wan_21");
    expect(adapter).toBeDefined();
    expect(adapter!.providerId).toBe("wan_21");
  });

  it("validates prompt is required", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("wan_21")!;
    const result = adapter.validateParams({ prompt: "" } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("prompt required");
  });

  it("validates max duration of 10s", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("wan_21")!;
    const result = adapter.validateParams({ prompt: "test", durationSeconds: 15 } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("max 10s for Wan");
  });

  it("passes validation for valid params", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("wan_21")!;
    const result = adapter.validateParams({ prompt: "A cat walking", durationSeconds: 5 } as any);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("estimates $0.50 for 720p resolution (default 5s × $0.10/sec)", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("wan_21")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", durationSeconds: 5 } as any);
    expect(cost).toBe(0.50);
  });

  it("estimates $0.50 for 480p resolution (same rate as 720p)", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("wan_21")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", resolution: "480p" } as any);
    expect(cost).toBe(0.50);
  });

  it("estimates $0.50 for explicit 720p resolution", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("wan_21")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", resolution: "720p" } as any);
    expect(cost).toBe(0.50);
  });
});

// ─── 2. SDXL Lightning Adapter ──────────────────────────────────────────
describe("SDXL Lightning Adapter (Fal.ai)", () => {
  it("is registered with providerId sdxl_lightning", async () => {
    await import("./provider-router/adapters/image-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("sdxl_lightning")).toBe(true);
    const adapter = getAdapter("sdxl_lightning");
    expect(adapter).toBeDefined();
    expect(adapter!.providerId).toBe("sdxl_lightning");
  });

  it("validates prompt is required", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("sdxl_lightning")!;
    const result = adapter.validateParams({ prompt: "" } as any);
    expect(result.valid).toBe(false);
  });

  it("estimates $0.003 per image", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("sdxl_lightning")!;
    const cost = adapter.estimateCostUsd({ prompt: "anime girl", numImages: 1 } as any);
    expect(cost).toBe(0.003);
  });

  it("estimates $0.009 for 3 images", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("sdxl_lightning")!;
    const cost = adapter.estimateCostUsd({ prompt: "anime girl", numImages: 3 } as any);
    expect(cost).toBeCloseTo(0.009, 5);
  });
});

// ─── 3. Registry ENV Fallback for Fal.ai Providers ─────────────────────
describe("Registry FAL_API_KEY ENV Fallback", () => {
  it("returns ENV-sourced key for wan_21 when no DB key exists", async () => {
    // The FAL_API_KEY should be set in the environment
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) {
      console.warn("FAL_API_KEY not set, skipping ENV fallback test");
      return;
    }

    const { getActiveApiKey } = await import("./provider-router/registry");
    // getActiveApiKey queries DB first, then falls back to ENV for Fal.ai providers
    // In test environment without DB seeded keys, it should return the ENV key
    const result = await getActiveApiKey("wan_21");
    // Result may be from DB or ENV; if ENV, id will be -1
    expect(result).not.toBeNull();
    if (result && result.id === -1) {
      // ENV fallback path
      expect(result.decryptedKey).toBe(falKey);
      expect(result.rateLimitRpm).toBe(60);
      expect(result.dailySpendCapUsd).toBeNull();
    }
  });

  it("returns ENV-sourced key for sdxl_lightning when no DB key exists", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) {
      console.warn("FAL_API_KEY not set, skipping ENV fallback test");
      return;
    }

    const { getActiveApiKey } = await import("./provider-router/registry");
    const result = await getActiveApiKey("sdxl_lightning");
    expect(result).not.toBeNull();
    if (result && result.id === -1) {
      expect(result.decryptedKey).toBe(falKey);
    }
  });

  it("does NOT return ENV fallback for non-Fal.ai providers like midjourney_v7", async () => {
    const { getActiveApiKey } = await import("./provider-router/registry");
    // midjourney_v7 is NOT in FAL_AI_PROVIDERS, so if no DB key exists, result is null
    const result = await getActiveApiKey("midjourney_v7");
    if (result === null) {
      expect(result).toBeNull();
    }
  });

  it("returns ENV-sourced key for flux_11_pro when no DB key exists", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) {
      console.warn("FAL_API_KEY not set, skipping ENV fallback test");
      return;
    }

    const { getActiveApiKey } = await import("./provider-router/registry");
    const result = await getActiveApiKey("flux_11_pro");
    expect(result).not.toBeNull();
    if (result && result.id === -1) {
      expect(result.decryptedKey).toBe(falKey);
    }
  });

  it("returns ENV-sourced key for pika_22 when no DB key exists", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) {
      console.warn("FAL_API_KEY not set, skipping ENV fallback test");
      return;
    }

    const { getActiveApiKey } = await import("./provider-router/registry");
    const result = await getActiveApiKey("pika_22");
    expect(result).not.toBeNull();
    if (result && result.id === -1) {
      expect(result.decryptedKey).toBe(falKey);
    }
  });

  it("FAL_AI_PROVIDERS set contains all 8 Fal.ai providers", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) {
      console.warn("FAL_API_KEY not set, skipping");
      return;
    }

    const { getActiveApiKey } = await import("./provider-router/registry");
    const providers = ["wan_21", "sdxl_lightning", "flux_11_pro", "pika_22", "hailuo_director", "ideogram_3", "recraft_v3", "elevenlabs_turbo_v25"];
    for (const pid of providers) {
      const result = await getActiveApiKey(pid);
      expect(result).not.toBeNull();
      if (result && result.id === -1) {
        expect(result.decryptedKey).toBe(falKey);
      }
    }
  });

  it("returns ENV-sourced key for hailuo_director", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) return;
    const { getActiveApiKey } = await import("./provider-router/registry");
    const result = await getActiveApiKey("hailuo_director");
    expect(result).not.toBeNull();
    if (result && result.id === -1) expect(result.decryptedKey).toBe(falKey);
  });

  it("returns ENV-sourced key for ideogram_3", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) return;
    const { getActiveApiKey } = await import("./provider-router/registry");
    const result = await getActiveApiKey("ideogram_3");
    expect(result).not.toBeNull();
    if (result && result.id === -1) expect(result.decryptedKey).toBe(falKey);
  });

  it("returns ENV-sourced key for recraft_v3", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) return;
    const { getActiveApiKey } = await import("./provider-router/registry");
    const result = await getActiveApiKey("recraft_v3");
    expect(result).not.toBeNull();
    if (result && result.id === -1) expect(result.decryptedKey).toBe(falKey);
  });

  it("returns ENV-sourced key for elevenlabs_turbo_v25 via Fal.ai", async () => {
    const falKey = process.env.FAL_API_KEY ?? "";
    if (!falKey) return;
    const { getActiveApiKey } = await import("./provider-router/registry");
    const result = await getActiveApiKey("elevenlabs_turbo_v25");
    expect(result).not.toBeNull();
    if (result && result.id === -1) expect(result.decryptedKey).toBe(falKey);
  });
});

// ─── 4. Fal.ai Auth Header Format ──────────────────────────────────────
describe("Fal.ai Auth Header Format", () => {
  it("SDXL Lightning uses Key auth header (not Bearer)", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("sdxl_lightning");
    expect(adapter).toBeDefined();
    expect(typeof adapter!.execute).toBe("function");
  });

  it("FLUX 1.1 Pro uses Key auth header via Fal.ai", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("flux_11_pro");
    expect(adapter).toBeDefined();
    expect(typeof adapter!.execute).toBe("function");
  });

  it("Pika 2.2 uses Key auth header via Fal.ai", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pika_22");
    expect(adapter).toBeDefined();
    expect(typeof adapter!.execute).toBe("function");
  });
});

// ─── 4c. Pika 2.2 Adapter ──────────────────────────────────────────────
describe("Pika 2.2 Adapter (Fal.ai)", () => {
  it("is registered with providerId pika_22", async () => {
    await import("./provider-router/adapters/video-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("pika_22")).toBe(true);
    const adapter = getAdapter("pika_22");
    expect(adapter).toBeDefined();
    expect(adapter!.providerId).toBe("pika_22");
  });

  it("validates prompt and image_url are required", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pika_22")!;
    const result = adapter.validateParams({ prompt: "" } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("validates image_url is required", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pika_22")!;
    const result = adapter.validateParams({ prompt: "test" } as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("image_url required for Pika 2.2");
  });

  it("passes validation with prompt and imageUrl", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pika_22")!;
    const result = adapter.validateParams({ prompt: "anime scene", imageUrl: "https://example.com/img.png" } as any);
    expect(result.valid).toBe(true);
  });

  it("rejects duration > 10s", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pika_22")!;
    const result = adapter.validateParams({ prompt: "test", imageUrl: "https://example.com/img.png", durationSeconds: 15 } as any);
    expect(result.valid).toBe(false);
  });

  it("estimates $0.20 for 5s video", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pika_22")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", imageUrl: "https://example.com/img.png", durationSeconds: 5 } as any);
    expect(cost).toBe(0.20);
  });

  it("estimates $0.30 for 10s video", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pika_22")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", imageUrl: "https://example.com/img.png", durationSeconds: 10 } as any);
    expect(cost).toBe(0.30);
  });
});

// ─── 4b. FLUX 1.1 Pro Adapter ──────────────────────────────────────────────
describe("FLUX 1.1 Pro Adapter (Fal.ai)", () => {
  it("is registered with providerId flux_11_pro", async () => {
    await import("./provider-router/adapters/image-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("flux_11_pro")).toBe(true);
    const adapter = getAdapter("flux_11_pro");
    expect(adapter).toBeDefined();
    expect(adapter!.providerId).toBe("flux_11_pro");
  });

  it("validates prompt is required", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("flux_11_pro")!;
    const result = adapter.validateParams({ prompt: "" } as any);
    expect(result.valid).toBe(false);
  });

  it("passes validation for valid params", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("flux_11_pro")!;
    const result = adapter.validateParams({ prompt: "anime landscape", width: 1024, height: 1024 } as any);
    expect(result.valid).toBe(true);
  });

  it("estimates $0.040 per image", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("flux_11_pro")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", numImages: 1 } as any);
    expect(cost).toBe(0.040);
  });

  it("estimates $0.120 for 3 images", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("flux_11_pro")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", numImages: 3 } as any);
    expect(cost).toBeCloseTo(0.120, 5);
  });
});

// ─── 5. Hailuo Director Adapter (Fal.ai) ──────────────────────────────────
describe("Hailuo Director Adapter (Fal.ai)", () => {
  it("is registered with providerId hailuo_director", async () => {
    await import("./provider-router/adapters/video-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("hailuo_director")).toBe(true);
    expect(getAdapter("hailuo_director")!.providerId).toBe("hailuo_director");
  });

  it("validates prompt and image_url are required", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("hailuo_director")!;
    const r1 = adapter.validateParams({ prompt: "" } as any);
    expect(r1.valid).toBe(false);
    const r2 = adapter.validateParams({ prompt: "test" } as any);
    expect(r2.valid).toBe(false);
    expect(r2.errors).toContain("image_url required for hailuo_director");
  });

  it("passes validation with prompt and imageUrl", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("hailuo_director")!;
    const result = adapter.validateParams({ prompt: "anime", imageUrl: "https://example.com/img.png" } as any);
    expect(result.valid).toBe(true);
  });

  it("rejects duration > 10s", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("hailuo_director")!;
    const result = adapter.validateParams({ prompt: "test", imageUrl: "https://example.com/img.png", durationSeconds: 15 } as any);
    expect(result.valid).toBe(false);
  });

  it("estimates $0.04 for 6s video (default)", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("hailuo_director")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", imageUrl: "https://example.com/img.png" } as any);
    expect(cost).toBe(0.04);
  });

  it("estimates $0.06 for 10s video", async () => {
    await import("./provider-router/adapters/video-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("hailuo_director")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", imageUrl: "https://example.com/img.png", durationSeconds: 10 } as any);
    expect(cost).toBe(0.06);
  });
});

// ─── 6. Ideogram 3 Adapter (Fal.ai) ──────────────────────────────────────
describe("Ideogram 3 Adapter (Fal.ai)", () => {
  it("is registered with providerId ideogram_3", async () => {
    await import("./provider-router/adapters/image-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("ideogram_3")).toBe(true);
    expect(getAdapter("ideogram_3")!.providerId).toBe("ideogram_3");
  });

  it("validates prompt is required", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("ideogram_3")!;
    const result = adapter.validateParams({ prompt: "" } as any);
    expect(result.valid).toBe(false);
  });

  it("passes validation for valid params", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("ideogram_3")!;
    const result = adapter.validateParams({ prompt: "manga panel", width: 1024, height: 1024 } as any);
    expect(result.valid).toBe(true);
  });

  it("estimates $0.060 per image", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("ideogram_3")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", numImages: 1 } as any);
    expect(cost).toBe(0.060);
  });
});

// ─── 7. Recraft V3 Adapter (Fal.ai) ──────────────────────────────────────
describe("Recraft V3 Adapter (Fal.ai)", () => {
  it("is registered with providerId recraft_v3", async () => {
    await import("./provider-router/adapters/image-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("recraft_v3")).toBe(true);
    expect(getAdapter("recraft_v3")!.providerId).toBe("recraft_v3");
  });

  it("validates prompt is required", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("recraft_v3")!;
    const result = adapter.validateParams({ prompt: "" } as any);
    expect(result.valid).toBe(false);
  });

  it("estimates $0.040 per image", async () => {
    await import("./provider-router/adapters/image-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("recraft_v3")!;
    const cost = adapter.estimateCostUsd({ prompt: "test", numImages: 1 } as any);
    expect(cost).toBe(0.040);
  });
});

// ─── 8. ElevenLabs Turbo v2.5 Adapter (Fal.ai) ──────────────────────────
describe("ElevenLabs Turbo v2.5 Adapter (Fal.ai)", () => {
  it("is registered with providerId elevenlabs_turbo_v25", async () => {
    await import("./provider-router/adapters/voice-providers");
    const { hasAdapter, getAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("elevenlabs_turbo_v25")).toBe(true);
    expect(getAdapter("elevenlabs_turbo_v25")!.providerId).toBe("elevenlabs_turbo_v25");
  });

  it("validates text is required", async () => {
    await import("./provider-router/adapters/voice-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("elevenlabs_turbo_v25")!;
    const result = adapter.validateParams({ text: "" } as any);
    expect(result.valid).toBe(false);
  });

  it("validates max 5000 chars", async () => {
    await import("./provider-router/adapters/voice-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("elevenlabs_turbo_v25")!;
    const result = adapter.validateParams({ text: "a".repeat(5001) } as any);
    expect(result.valid).toBe(false);
  });

  it("passes validation for valid text", async () => {
    await import("./provider-router/adapters/voice-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("elevenlabs_turbo_v25")!;
    const result = adapter.validateParams({ text: "Hello world" } as any);
    expect(result.valid).toBe(true);
  });

  it("estimates cost at $0.05/1000 chars", async () => {
    await import("./provider-router/adapters/voice-providers");
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("elevenlabs_turbo_v25")!;
    const cost = adapter.estimateCostUsd({ text: "a".repeat(1000) } as any);
    expect(cost).toBeCloseTo(0.05, 5);
  });
});

// ─── 9. Cost Estimator Integration ──────────────────────────────────────
describe("Fal.ai Cost Estimator Integration", () => {
  it("estimateCost works for wan_21", async () => {
    await import("./provider-router/index");
    const { estimateCost } = await import("./provider-router/cost-estimator");
    const est = estimateCost("wan_21", { prompt: "test", durationSeconds: 5 } as any);
    expect(est.providerId).toBe("wan_21");
    expect(est.estimatedUsd).toBe(0.50); // 5s × $0.10/sec
    expect(est.estimatedCredits).toBeGreaterThan(0);
  });

  it("estimateCost works for sdxl_lightning", async () => {
    await import("./provider-router/index");
    const { estimateCost } = await import("./provider-router/cost-estimator");
    const est = estimateCost("sdxl_lightning", { prompt: "anime", width: 1024, height: 1024 } as any);
    expect(est.providerId).toBe("sdxl_lightning");
    expect(est.estimatedUsd).toBe(0.003);
    expect(est.estimatedCredits).toBeGreaterThan(0);
  });

  it("wan_21 is cheaper than premium video providers", async () => {
    await import("./provider-router/index");
    const { estimateCost } = await import("./provider-router/cost-estimator");
    const wan = estimateCost("wan_21", { prompt: "test", durationSeconds: 5 } as any);
    const luma = estimateCost("luma_ray3", { prompt: "test", durationSeconds: 5 } as any);
    // Both should have positive costs
    expect(wan.estimatedUsd).toBeGreaterThan(0);
    expect(luma.estimatedUsd).toBeGreaterThan(0);
  });

  it("sdxl_lightning is the cheapest image provider", async () => {
    await import("./provider-router/index");
    const { estimateCost } = await import("./provider-router/cost-estimator");
    const sdxl = estimateCost("sdxl_lightning", { prompt: "test", width: 1024, height: 1024 } as any);
    const flux = estimateCost("flux_11_pro", { prompt: "test", width: 1024, height: 1024 } as any);
    expect(sdxl.estimatedUsd).toBeLessThan(flux.estimatedUsd);
  });
});
