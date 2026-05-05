/**
 * Tests for Sakufuu LoRA Training Pipeline
 * Wave 5B Item 3: TrainingProvider interface, sample extraction, data prep, D9 integration
 */

import { describe, it, expect, vi } from "vitest";
import {
  extractStyleSamples,
  generateTrainingCaption,
  prepareTrainingData,
  runTrainingPipeline,
  getCreatorLoraStatus,
  ReplicateTrainingProvider,
  type TrainingProvider,
  type StyleSampleCandidate,
  type TrainingConfig,
  type TrainingJobStatus,
} from "./lora-training";

// ─── Mock TrainingProvider ──────────────────────────────────────────────────

class MockTrainingProvider implements TrainingProvider {
  name = "mock";
  submittedJobs: Array<{ images: any[]; config: TrainingConfig }> = [];
  jobStatuses: Map<string, TrainingJobStatus> = new Map();

  async submitTraining(params: {
    images: Array<{ url: string; caption?: string }>;
    config: TrainingConfig;
  }) {
    const jobId = `mock-job-${Date.now()}`;
    this.submittedJobs.push(params);
    this.jobStatuses.set(jobId, { id: jobId, status: "processing" });
    return { jobId, estimatedCostCents: 80 };
  }

  async getJobStatus(jobId: string): Promise<TrainingJobStatus> {
    return this.jobStatuses.get(jobId) || { id: jobId, status: "failed", error: "Not found" };
  }

  async cancelJob(jobId: string) {
    this.jobStatuses.set(jobId, { id: jobId, status: "canceled" });
  }

  async getModelUrl(jobId: string) {
    return `https://models.example.com/${jobId}/weights.safetensors`;
  }
}

// ─── Style Sample Extraction Tests ──────────────────────────────────────────

describe("extractStyleSamples", () => {
  const mockPanels = [
    { url: "https://cdn.example.com/panel1.png", sourceType: "panel" },
    { url: "https://cdn.example.com/panel2.png", sourceType: "panel" },
    { url: "https://cdn.example.com/charsheet1.png", sourceType: "character_sheet" },
    { url: "https://cdn.example.com/cover1.png", sourceType: "cover" },
    { url: "https://cdn.example.com/panel3.png", sourceType: "panel" },
    { url: "https://cdn.example.com/panel4.png", sourceType: "panel" },
    { url: "https://cdn.example.com/panel5.png", sourceType: "panel" },
    { url: "https://cdn.example.com/custom1.png", sourceType: "custom" },
  ];

  it("should extract samples with quality scores", () => {
    const samples = extractStyleSamples(mockPanels);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(s => s.qualityScore >= 0 && s.qualityScore <= 1)).toBe(true);
  });

  it("should prioritize character_sheet source type", () => {
    const samples = extractStyleSamples(mockPanels);
    // Character sheet should have highest score
    const charSheet = samples.find(s => s.sourceType === "character_sheet");
    const regularPanel = samples.find(s => s.sourceType === "panel");
    expect(charSheet).toBeDefined();
    expect(regularPanel).toBeDefined();
    expect(charSheet!.qualityScore).toBeGreaterThan(regularPanel!.qualityScore);
  });

  it("should respect maxSamples config", () => {
    const samples = extractStyleSamples(mockPanels, {
      minQuality: 0,
      maxSamples: 3,
      preferredSources: ["panel", "character_sheet", "cover"],
      generateCaptions: true,
    });
    expect(samples.length).toBeLessThanOrEqual(3);
  });

  it("should filter by minimum quality", () => {
    const samples = extractStyleSamples(mockPanels, {
      minQuality: 0.9,
      maxSamples: 30,
      preferredSources: ["character_sheet"],
      generateCaptions: true,
    });
    expect(samples.every(s => s.qualityScore >= 0.9)).toBe(true);
  });

  it("should return empty array for empty input", () => {
    const samples = extractStyleSamples([]);
    expect(samples).toEqual([]);
  });

  it("should sort by quality descending", () => {
    const samples = extractStyleSamples(mockPanels);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i - 1].qualityScore).toBeGreaterThanOrEqual(samples[i].qualityScore);
    }
  });
});

// ─── Training Caption Generation Tests ──────────────────────────────────────

describe("generateTrainingCaption", () => {
  it("should include trigger word", () => {
    const sample: StyleSampleCandidate = {
      url: "https://example.com/panel.png",
      sourceType: "panel",
      qualityScore: 0.7,
    };
    const caption = generateTrainingCaption(sample, "sakufuu_creator1");
    expect(caption).toContain("sakufuu_creator1");
  });

  it("should include genre when provided", () => {
    const sample: StyleSampleCandidate = {
      url: "https://example.com/panel.png",
      sourceType: "panel",
      qualityScore: 0.7,
    };
    const caption = generateTrainingCaption(sample, "sakufuu_style", "shonen");
    expect(caption).toContain("shonen");
  });

  it("should describe character_sheet source type", () => {
    const sample: StyleSampleCandidate = {
      url: "https://example.com/charsheet.png",
      sourceType: "character_sheet",
      qualityScore: 0.9,
    };
    const caption = generateTrainingCaption(sample, "trigger_word");
    expect(caption).toContain("character design reference sheet");
  });

  it("should describe cover source type", () => {
    const sample: StyleSampleCandidate = {
      url: "https://example.com/cover.png",
      sourceType: "cover",
      qualityScore: 0.8,
    };
    const caption = generateTrainingCaption(sample, "trigger_word");
    expect(caption).toContain("manga cover illustration");
  });

  it("should add quality indicator for high-quality samples", () => {
    const sample: StyleSampleCandidate = {
      url: "https://example.com/panel.png",
      sourceType: "panel",
      qualityScore: 0.9,
    };
    const caption = generateTrainingCaption(sample, "trigger_word");
    expect(caption).toContain("high quality");
  });
});

// ─── Training Data Preparation Tests ────────────────────────────────────────

describe("prepareTrainingData", () => {
  it("should prepare training data with captions", async () => {
    const samples: StyleSampleCandidate[] = [
      { url: "https://example.com/1.png", sourceType: "panel", qualityScore: 0.8 },
      { url: "https://example.com/2.png", sourceType: "character_sheet", qualityScore: 0.9 },
    ];

    const prepared = await prepareTrainingData(samples, "my_trigger", "seinen");
    expect(prepared).toHaveLength(2);
    expect(prepared[0].url).toBe("https://example.com/1.png");
    expect(prepared[0].caption).toContain("my_trigger");
    expect(prepared[0].caption).toContain("seinen");
    expect(prepared[1].caption).toContain("character design");
  });

  it("should handle empty samples", async () => {
    const prepared = await prepareTrainingData([], "trigger");
    expect(prepared).toEqual([]);
  });
});

// ─── Training Pipeline Orchestration Tests ──────────────────────────────────

describe("runTrainingPipeline", () => {
  it("should submit training with valid samples", async () => {
    const provider = new MockTrainingProvider();
    const result = await runTrainingPipeline({
      creatorId: 1,
      triggerWord: "creator1_style",
      genre: "shonen",
      samples: [
        { url: "https://example.com/1.png", sourceType: "panel", qualityScore: 0.8 },
        { url: "https://example.com/2.png", sourceType: "panel", qualityScore: 0.7 },
        { url: "https://example.com/3.png", sourceType: "panel", qualityScore: 0.75 },
        { url: "https://example.com/4.png", sourceType: "character_sheet", qualityScore: 0.9 },
        { url: "https://example.com/5.png", sourceType: "panel", qualityScore: 0.65 },
      ],
    }, provider);

    expect(result.status).toBe("submitted");
    expect(result.jobId).toBeTruthy();
    expect(result.sampleCount).toBe(5);
    expect(result.estimatedCostCents).toBeGreaterThan(0);
    expect(result.config.triggerWord).toBe("creator1_style");
    expect(provider.submittedJobs).toHaveLength(1);
  });

  it("should auto-extract samples from available panels", async () => {
    const provider = new MockTrainingProvider();
    const panels = Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.com/panel${i}.png`,
      sourceType: "panel",
    }));

    const result = await runTrainingPipeline({
      creatorId: 2,
      triggerWord: "creator2_style",
      availablePanels: panels,
    }, provider);

    expect(result.status).toBe("submitted");
    expect(result.sampleCount).toBeGreaterThan(0);
    expect(result.sampleCount).toBeLessThanOrEqual(30);
  });

  it("should return no_samples when no panels available", async () => {
    const provider = new MockTrainingProvider();
    const result = await runTrainingPipeline({
      creatorId: 3,
      triggerWord: "creator3_style",
      availablePanels: [],
    }, provider);

    expect(result.status).toBe("no_samples");
    expect(result.sampleCount).toBe(0);
    expect(provider.submittedJobs).toHaveLength(0);
  });

  it("should apply config overrides", async () => {
    const provider = new MockTrainingProvider();
    const result = await runTrainingPipeline({
      creatorId: 4,
      triggerWord: "creator4_style",
      samples: Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/${i}.png`,
        sourceType: "panel" as const,
        qualityScore: 0.8,
      })),
      configOverrides: {
        steps: 2000,
        learningRate: 0.0002,
        loraRank: 32,
      },
    }, provider);

    expect(result.config.steps).toBe(2000);
    expect(result.config.learningRate).toBe(0.0002);
    expect(result.config.loraRank).toBe(32);
    expect(result.config.triggerWord).toBe("creator4_style");
  });
});

// ─── D9 Integration: Creator LoRA Status ────────────────────────────────────

describe("getCreatorLoraStatus", () => {
  it("should return unavailable when no jobs exist", () => {
    const status = getCreatorLoraStatus([]);
    expect(status.available).toBe(false);
    expect(status.confidence).toBe(0);
  });

  it("should return unavailable when no approved models", () => {
    const jobs = [
      { status: "completed", approved: "pending", modelUrl: "https://example.com/model.safetensors", metadata: null, completedAt: new Date() },
      { status: "failed", approved: "pending", modelUrl: null, metadata: null, completedAt: null },
    ];
    const status = getCreatorLoraStatus(jobs);
    expect(status.available).toBe(false);
  });

  it("should return available with approved model", () => {
    const jobs = [
      {
        status: "completed",
        approved: "approved",
        modelUrl: "https://example.com/model.safetensors",
        metadata: { triggerWord: "my_style" },
        completedAt: new Date("2026-01-15"),
      },
    ];
    const status = getCreatorLoraStatus(jobs);
    expect(status.available).toBe(true);
    expect(status.modelUrl).toBe("https://example.com/model.safetensors");
    expect(status.triggerWord).toBe("my_style");
    expect(status.confidence).toBe(0.85);
  });

  it("should return most recent approved model", () => {
    const jobs = [
      {
        status: "completed",
        approved: "approved",
        modelUrl: "https://example.com/old-model.safetensors",
        metadata: { triggerWord: "old_style" },
        completedAt: new Date("2026-01-01"),
      },
      {
        status: "completed",
        approved: "approved",
        modelUrl: "https://example.com/new-model.safetensors",
        metadata: { triggerWord: "new_style" },
        completedAt: new Date("2026-02-01"),
      },
    ];
    const status = getCreatorLoraStatus(jobs);
    expect(status.available).toBe(true);
    expect(status.modelUrl).toBe("https://example.com/new-model.safetensors");
    expect(status.triggerWord).toBe("new_style");
  });

  it("should use default trigger word when metadata is null", () => {
    const jobs = [
      {
        status: "completed",
        approved: "approved",
        modelUrl: "https://example.com/model.safetensors",
        metadata: null,
        completedAt: new Date(),
      },
    ];
    const status = getCreatorLoraStatus(jobs);
    expect(status.triggerWord).toBe("sakufuu_style");
  });
});

// ─── Replicate Provider Unit Tests ──────────────────────────────────────────

describe("ReplicateTrainingProvider", () => {
  it("should construct with API token", () => {
    const provider = new ReplicateTrainingProvider("test-token");
    expect(provider.name).toBe("replicate");
  });

  it("should handle submitTraining API errors gracefully", async () => {
    const provider = new ReplicateTrainingProvider("invalid-token");
    // Mock fetch to simulate API error
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(provider.submitTraining({
      images: [{ url: "https://example.com/img.png", caption: "test" }],
      config: {
        baseModel: "test",
        triggerWord: "test",
        steps: 1000,
        learningRate: 0.0001,
        loraRank: 16,
        resolution: 512,
        batchSize: 1,
        useCaptions: true,
      },
    })).rejects.toThrow("Replicate training submission failed: 401");

    global.fetch = originalFetch;
  });

  it("should handle getJobStatus API errors", async () => {
    const provider = new ReplicateTrainingProvider("test-token");
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(provider.getJobStatus("nonexistent-job")).rejects.toThrow("Failed to get training status");

    global.fetch = originalFetch;
  });

  it("should parse successful job status", async () => {
    const provider = new ReplicateTrainingProvider("test-token");
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "job-123",
        status: "succeeded",
        output: { weights: "https://replicate.delivery/model.safetensors" },
        metrics: { predict_time: 600 },
      }),
    });

    const status = await provider.getJobStatus("job-123");
    expect(status.id).toBe("job-123");
    expect(status.status).toBe("succeeded");
    expect(status.outputUrl).toBe("https://replicate.delivery/model.safetensors");
    expect(status.metrics?.elapsedSeconds).toBe(600);

    global.fetch = originalFetch;
  });

  it("should get model URL from completed job", async () => {
    const provider = new ReplicateTrainingProvider("test-token");
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "job-456",
        status: "succeeded",
        output: { weights: "https://replicate.delivery/final-model.safetensors" },
      }),
    });

    const url = await provider.getModelUrl("job-456");
    expect(url).toBe("https://replicate.delivery/final-model.safetensors");

    global.fetch = originalFetch;
  });

  it("should throw when getting model URL for incomplete job", async () => {
    const provider = new ReplicateTrainingProvider("test-token");
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "job-789",
        status: "processing",
        output: null,
      }),
    });

    await expect(provider.getModelUrl("job-789")).rejects.toThrow("Training not complete");

    global.fetch = originalFetch;
  });
});
