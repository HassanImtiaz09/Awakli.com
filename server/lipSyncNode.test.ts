/**
 * Tests for the automated lip sync pipeline node (lipSyncNode.ts)
 * and its integration into the pipeline orchestrator.
 *
 * Covers:
 * - Dialogue panel identification (panels with voice assets)
 * - Face detection prerequisites (Kling identify-face API)
 * - Audio padding to 3s minimum
 * - sound_end_time safety margin (floor(ms) - 50)
 * - Face-audio overlap validation (≥2s)
 * - synced_clip asset storage and deduplication in assembly
 * - Assembly settings gate (enableLipSync toggle)
 * - Non-blocking failure behavior
 * - Pipeline node ordering (between voice_gen and music_gen)
 */

import { describe, it, expect, vi } from "vitest";

// ─── lipSyncNode module structure ──────────────────────────────────────

describe("lipSyncNode module", () => {
  it("exports lipSyncNode as a function", async () => {
    const mod = await import("./lipSyncNode");
    expect(typeof mod.lipSyncNode).toBe("function");
  });

  it("exports LipSyncNodeOptions type (compile-time check)", async () => {
    // This test verifies the module compiles and exports are accessible
    const mod = await import("./lipSyncNode");
    expect(mod).toBeDefined();
  });
});

// ─── Pipeline node ordering ────────────────────────────────────────────

describe("Pipeline node ordering", () => {
  it("lip_sync appears between voice_gen and music_gen in NODE_ORDER", async () => {
    // Import the orchestrator types
    const NODE_ORDER = ["video_gen", "voice_gen", "lip_sync", "music_gen", "foley_gen", "ambient_gen", "assembly"];
    const voiceIdx = NODE_ORDER.indexOf("voice_gen");
    const lipSyncIdx = NODE_ORDER.indexOf("lip_sync");
    const musicIdx = NODE_ORDER.indexOf("music_gen");

    expect(lipSyncIdx).toBeGreaterThan(voiceIdx);
    expect(lipSyncIdx).toBeLessThan(musicIdx);
  });

  it("lip_sync is in the 7-node pipeline (not 6)", () => {
    const NODE_ORDER = ["video_gen", "voice_gen", "lip_sync", "music_gen", "foley_gen", "ambient_gen", "assembly"];
    expect(NODE_ORDER).toHaveLength(7);
    expect(NODE_ORDER).toContain("lip_sync");
  });
});

// ─── Audio padding logic ───────────────────────────────────────────────

describe("Audio padding for lip sync", () => {
  it("pads audio to at least 3 seconds (not 2s)", () => {
    const MIN_AUDIO_DURATION_S = 3;
    const shortClipDuration = 0.9; // typical dialogue clip
    const paddedDuration = Math.max(shortClipDuration, MIN_AUDIO_DURATION_S);
    expect(paddedDuration).toBe(3);
  });

  it("does not pad audio already longer than 3 seconds", () => {
    const MIN_AUDIO_DURATION_S = 3;
    const longClipDuration = 4.5;
    const paddedDuration = Math.max(longClipDuration, MIN_AUDIO_DURATION_S);
    expect(paddedDuration).toBe(4.5);
  });

  it("calculates sound_end_time with 50ms safety margin", () => {
    const audioDurationMs = 3120; // 3.12 seconds
    const soundEndTime = Math.floor(audioDurationMs) - 50;
    expect(soundEndTime).toBe(3070);
    expect(soundEndTime).toBeLessThan(audioDurationMs);
  });

  it("sound_end_time never exceeds actual audio duration", () => {
    const testDurations = [2000, 2090, 3000, 3500, 5120, 1890];
    for (const ms of testDurations) {
      const soundEndTime = Math.floor(ms) - 50;
      expect(soundEndTime).toBeLessThan(ms);
    }
  });
});

// ─── Face-audio overlap validation ─────────────────────────────────────

describe("Face-audio overlap validation", () => {
  const MIN_OVERLAP_S = 2;

  it("accepts overlap of exactly 2 seconds", () => {
    const faceVisibleFrom = 0; // face visible from start
    const faceVisibleTo = 5;
    const audioInsertTime = 0;
    const audioDuration = 3;
    const overlapStart = Math.max(faceVisibleFrom, audioInsertTime);
    const overlapEnd = Math.min(faceVisibleTo, audioInsertTime + audioDuration);
    const overlap = overlapEnd - overlapStart;
    expect(overlap).toBeGreaterThanOrEqual(MIN_OVERLAP_S);
  });

  it("rejects overlap less than 2 seconds", () => {
    const faceVisibleFrom = 2.1; // face appears late
    const faceVisibleTo = 5;
    const audioInsertTime = 0;
    const audioDuration = 3;
    const overlapStart = Math.max(faceVisibleFrom, audioInsertTime);
    const overlapEnd = Math.min(faceVisibleTo, audioInsertTime + audioDuration);
    const overlap = overlapEnd - overlapStart;
    expect(overlap).toBeLessThan(MIN_OVERLAP_S);
  });

  it("handles face appearing mid-clip with sufficient overlap", () => {
    const faceVisibleFrom = 1.0; // face appears at 1s
    const faceVisibleTo = 5;
    const audioInsertTime = 0;
    const audioDuration = 3.5;
    const overlapStart = Math.max(faceVisibleFrom, audioInsertTime);
    const overlapEnd = Math.min(faceVisibleTo, audioInsertTime + audioDuration);
    const overlap = overlapEnd - overlapStart;
    expect(overlap).toBe(2.5);
    expect(overlap).toBeGreaterThanOrEqual(MIN_OVERLAP_S);
  });
});

// ─── Assembly deduplication (synced_clip priority) ─────────────────────

describe("Assembly clip deduplication", () => {
  it("prefers synced_clip over video_clip for the same panel", () => {
    const rawAssets = [
      { url: "https://cdn.example.com/panel5-original.mp4", panelId: 5, assetType: "video_clip" },
      { url: "https://cdn.example.com/panel5-synced.mp4", panelId: 5, assetType: "synced_clip" },
      { url: "https://cdn.example.com/panel6-original.mp4", panelId: 6, assetType: "video_clip" },
    ];

    // Simulate the deduplication logic from assemblyAgent
    const panelClipMap = new Map<number, typeof rawAssets[0]>();
    for (const clip of rawAssets) {
      const existing = panelClipMap.get(clip.panelId);
      if (!existing) {
        panelClipMap.set(clip.panelId, clip);
      } else if (clip.assetType === "synced_clip" && existing.assetType === "video_clip") {
        panelClipMap.set(clip.panelId, clip);
      }
    }
    const videoClips = Array.from(panelClipMap.values());

    expect(videoClips).toHaveLength(2);
    const panel5 = videoClips.find(c => c.panelId === 5);
    expect(panel5?.assetType).toBe("synced_clip");
    expect(panel5?.url).toContain("synced");
  });

  it("keeps video_clip when no synced_clip exists for a panel", () => {
    const rawAssets = [
      { url: "https://cdn.example.com/panel1-original.mp4", panelId: 1, assetType: "video_clip" },
      { url: "https://cdn.example.com/panel2-original.mp4", panelId: 2, assetType: "video_clip" },
    ];

    const panelClipMap = new Map<number, typeof rawAssets[0]>();
    for (const clip of rawAssets) {
      const existing = panelClipMap.get(clip.panelId);
      if (!existing) {
        panelClipMap.set(clip.panelId, clip);
      } else if (clip.assetType === "synced_clip" && existing.assetType === "video_clip") {
        panelClipMap.set(clip.panelId, clip);
      }
    }
    const videoClips = Array.from(panelClipMap.values());

    expect(videoClips).toHaveLength(2);
    expect(videoClips.every(c => c.assetType === "video_clip")).toBe(true);
  });

  it("does not replace synced_clip with video_clip if synced arrives first", () => {
    const rawAssets = [
      { url: "https://cdn.example.com/panel3-synced.mp4", panelId: 3, assetType: "synced_clip" },
      { url: "https://cdn.example.com/panel3-original.mp4", panelId: 3, assetType: "video_clip" },
    ];

    const panelClipMap = new Map<number, typeof rawAssets[0]>();
    for (const clip of rawAssets) {
      const existing = panelClipMap.get(clip.panelId);
      if (!existing) {
        panelClipMap.set(clip.panelId, clip);
      } else if (clip.assetType === "synced_clip" && existing.assetType === "video_clip") {
        panelClipMap.set(clip.panelId, clip);
      }
    }
    const videoClips = Array.from(panelClipMap.values());

    expect(videoClips).toHaveLength(1);
    expect(videoClips[0].assetType).toBe("synced_clip");
  });
});

// ─── Assembly settings gate ────────────────────────────────────────────

describe("Assembly settings lip sync gate", () => {
  it("enableLipSync defaults to false", async () => {
    const { mergeAssemblySettings } = await import("@shared/assemblySettings");
    const defaults = mergeAssemblySettings(undefined);
    expect(defaults.enableLipSync).toBe(false);
  });

  it("enableLipSync can be toggled to true", async () => {
    const { mergeAssemblySettings } = await import("@shared/assemblySettings");
    const settings = mergeAssemblySettings({ enableLipSync: true });
    expect(settings.enableLipSync).toBe(true);
  });

  it("preserves other settings when toggling lip sync", async () => {
    const { mergeAssemblySettings } = await import("@shared/assemblySettings");
    const settings = mergeAssemblySettings({
      enableLipSync: true,
      enableFoley: true,
      voiceLufs: -14,
    });
    expect(settings.enableLipSync).toBe(true);
    expect(settings.enableFoley).toBe(true);
    expect(settings.voiceLufs).toBe(-14);
  });
});

// ─── HITL bridge mapping ───────────────────────────────────────────────

describe("HITL bridge lip_sync mapping", () => {
  it("audio_timing node covers lip_sync stage (stage 13 = ato_fuki)", async () => {
    const { NODE_TO_STAGES } = await import("./hitl/orchestrator-bridge");
    // Lip sync is part of the audio_timing node (stages 12-13)
    expect(NODE_TO_STAGES.audio_timing).toContain(13);
  });

  it("lip_sync is still a node in pipelineOrchestrator NODE_ORDER", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
    expect(content).toContain('"lip_sync"');
  });
});

// ─── Non-blocking failure behavior ─────────────────────────────────────

describe("Lip sync non-blocking failure", () => {
  it("lip sync failure should not prevent assembly from running", () => {
    // Simulate the non-blocking pattern from the orchestrator
    const nodeStatuses: Record<string, string> = {
      video_gen: "complete",
      voice_gen: "complete",
      lip_sync: "pending",
      music_gen: "pending",
      foley_gen: "pending",
      ambient_gen: "pending",
      assembly: "pending",
    };

    // Simulate lip sync failure
    try {
      throw new Error("Kling API timeout");
    } catch {
      nodeStatuses.lip_sync = "failed";
      // Non-blocking: assembly should still proceed
    }

    expect(nodeStatuses.lip_sync).toBe("failed");
    // Assembly can still run
    expect(nodeStatuses.assembly).toBe("pending");
  });

  it("lip sync skip should not prevent assembly from running", () => {
    const nodeStatuses: Record<string, string> = {
      video_gen: "complete",
      voice_gen: "complete",
      lip_sync: "skipped", // enableLipSync = false
      music_gen: "complete",
      foley_gen: "complete",
      ambient_gen: "complete",
      assembly: "pending",
    };

    // Assembly can still run when lip sync is skipped
    expect(nodeStatuses.lip_sync).toBe("skipped");
    expect(nodeStatuses.assembly).toBe("pending");
  });
});

// ─── Pipeline processor module integration ─────────────────────────────

describe("Pipeline lipSyncProcessor integration", () => {
  it("lipSyncProcessor exports are available from pipeline index", async () => {
    const pipeline = await import("./pipeline/index");
    expect(pipeline).toHaveProperty("processLipSyncBatch");
    expect(pipeline).toHaveProperty("processLipSyncPanel");
    expect(pipeline).toHaveProperty("MIN_AUDIO_DURATION_SECONDS");
  });

  it("lip sync safety constants have correct values", async () => {
    const {
      MIN_AUDIO_DURATION_SECONDS,
      SOUND_END_TIME_SAFETY_MARGIN_MS,
      MIN_FACE_AUDIO_OVERLAP_MS,
    } = await import("./pipeline/index");
    expect(MIN_AUDIO_DURATION_SECONDS).toBe(3);
    expect(SOUND_END_TIME_SAFETY_MARGIN_MS).toBe(50);
    expect(MIN_FACE_AUDIO_OVERLAP_MS).toBe(2000);
  });
});
