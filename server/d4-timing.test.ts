/**
 * D4 Timing Director + X-Sheet Integration Tests
 *
 * Tests:
 * - LLM-based X-Sheet generation from panel inputs
 * - Heuristic fallback when LLM fails
 * - Voice duration estimation
 * - Entry validation and clamping
 * - DB persistence (create, read, override merge)
 * - Version supersession logic
 * - Pipeline integration (Stage 12 blocking gate)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./observability/logger", () => ({
  pipelineLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock db-helpers at the module level (timing-director imports from ./db-helpers.js)
const mockCreateXSheet = vi.fn();
const mockCreateXSheetEntries = vi.fn();
const mockUpdateXSheetStatus = vi.fn();
const mockGetLatestXSheet = vi.fn();

vi.mock("./benchmarks/d4-timing/db-helpers", () => ({
  createXSheet: (...args: any[]) => mockCreateXSheet(...args),
  createXSheetEntries: (...args: any[]) => mockCreateXSheetEntries(...args),
  updateXSheetStatus: (...args: any[]) => mockUpdateXSheetStatus(...args),
  getLatestXSheet: (...args: any[]) => mockGetLatestXSheet(...args),
  mergeEntriesWithOverrides: (entries: any[], overrides: any[]) => {
    // Real implementation for testing
    if (!overrides.length) return entries;
    const overrideMap = new Map<number, any>();
    for (const o of overrides) {
      overrideMap.set(o.sliceNumber, o.overrideData);
    }
    return entries.map((entry) => {
      const override = overrideMap.get(entry.sliceNumber);
      return override ? { ...entry, ...override } : entry;
    });
  },
  getResolvedXSheet: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
import type { TimingDirectorOptions, PanelTimingInput } from "./benchmarks/d4-timing/timing-director";
import { mergeEntriesWithOverrides } from "./benchmarks/d4-timing/db-helpers";

// ─── Test Data ──────────────────────────────────────────────────────────────

function makePanels(count: number): PanelTimingInput[] {
  return Array.from({ length: count }, (_, i) => ({
    panelId: 100 + i,
    panelNumber: i + 1,
    sceneNumber: Math.floor(i / 3) + 1,
    dialogue: i % 2 === 0
      ? [{ character: "Hiro", text: "This is a test dialogue for panel timing estimation.", emotion: "determined" }]
      : undefined,
    visualDescription: `Panel ${i + 1} shows a dynamic action scene with character movement`,
    cameraAngle: i % 3 === 0 ? "close-up" : "medium",
    transition: i % 4 === 0 ? "crossfade" : "cut",
    sfx: i % 5 === 0 ? "impact" : undefined,
    mood: ["tense", "calm", "excited", "melancholy"][i % 4],
  }));
}

function makeOptions(panelCount = 8): TimingDirectorOptions {
  return {
    episodeId: 1,
    projectId: 1,
    panels: makePanels(panelCount),
    moodArc: ["calm", "rising", "climax", "resolution"],
    bpmHint: 128,
    targetDurationMs: 180000,
    characterVoiceProfiles: {
      Hiro: { pacing: "normal", avgWpm: 155 },
    },
  };
}

function makeLLMResponse(panels: PanelTimingInput[]) {
  let currentMs = 0;
  const entries = panels.map((p, i) => {
    const duration = p.dialogue ? 4000 : 3000;
    const entry = {
      sliceNumber: p.panelNumber,
      panelId: p.panelId,
      startMs: currentMs,
      endMs: currentMs + duration,
      durationMs: duration,
      voiceStartMs: p.dialogue ? 300 : null,
      voiceEndMs: p.dialogue ? 2800 : null,
      voiceEmotion: p.dialogue?.[0]?.emotion || null,
      voicePacing: "normal",
      musicCueType: i % 3 === 0 ? "start" : "none",
      musicMoodShift: i % 3 === 0 ? p.mood : null,
      musicIntensity: 40 + i * 5,
      sfxTriggers: p.sfx ? [{ type: p.sfx, offsetMs: 500, durationMs: 800, category: "effect" }] : null,
      transitionType: p.transition || "cut",
      transitionDurationMs: p.transition === "crossfade" ? 500 : 0,
      sceneNumber: p.sceneNumber,
      emotion: p.mood || "neutral",
      energyLevel: Math.min(10, 3 + i),
      cameraNote: p.cameraAngle || null,
    };
    currentMs += duration;
    return entry;
  });

  return {
    bpm: 128,
    totalDurationMs: currentMs,
    confidence: 0.85,
    entries,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("D4 Timing Director", () => {
  let capturedEntries: any[] = [];

  beforeEach(() => {
    capturedEntries = [];
    mockCreateXSheet.mockReset();
    mockCreateXSheetEntries.mockReset();
    mockUpdateXSheetStatus.mockReset();
    mockGetLatestXSheet.mockReset();
    (invokeLLM as any).mockReset();

    // Default: no existing sheet
    mockGetLatestXSheet.mockResolvedValue(null);

    // Default: createXSheet returns a new sheet
    mockCreateXSheet.mockImplementation((data: any) => ({
      id: 1,
      ...data,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Capture entries for validation
    mockCreateXSheetEntries.mockImplementation((entries: any[]) => {
      capturedEntries = entries;
    });

    mockUpdateXSheetStatus.mockResolvedValue(undefined);
  });

  describe("generateXSheet — LLM path", () => {
    it("generates a complete X-Sheet from panel inputs via LLM", async () => {
      const options = makeOptions(8);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      const result = await generateXSheet(options);

      expect(result.xSheetId).toBe(1);
      expect(result.entryCount).toBe(8);
      expect(result.totalDurationMs).toBeGreaterThan(0);
      expect(result.confidence).toBe(0.85);
      expect(invokeLLM).toHaveBeenCalledOnce();
      expect(mockCreateXSheet).toHaveBeenCalledOnce();
      expect(mockCreateXSheetEntries).toHaveBeenCalledOnce();
    });

    it("includes music cue counts from LLM response", async () => {
      const options = makeOptions(6);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      const result = await generateXSheet(options);

      // Panels 0, 3 have musicCueType "start" (every 3rd panel)
      expect(result.musicCueCount).toBe(2);
    });

    it("includes SFX trigger counts", async () => {
      const options = makeOptions(10);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      const result = await generateXSheet(options);

      // Panels 0, 5 have sfx (every 5th panel)
      expect(result.sfxTriggerCount).toBe(2);
    });

    it("passes character voice profiles and mood arc to LLM prompt", async () => {
      const options = makeOptions(4);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      // Verify LLM was called with user prompt containing character dialogue and mood arc
      const llmCall = (invokeLLM as any).mock.calls[0][0];
      const userMsg = llmCall.messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("Hiro"); // character name from dialogue
      expect(userMsg.content).toContain("calm \u2192 rising \u2192 climax \u2192 resolution"); // mood arc
    });
  });

  describe("generateXSheet — heuristic fallback", () => {
    it("falls back to heuristic when LLM fails", async () => {
      const options = makeOptions(4);

      (invokeLLM as any).mockRejectedValueOnce(new Error("LLM timeout"));

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      const result = await generateXSheet(options);

      expect(result.xSheetId).toBe(1);
      expect(result.entryCount).toBe(4);
      expect(result.confidence).toBe(0.6); // heuristic confidence
    });

    it("heuristic assigns music cues at scene boundaries", async () => {
      const options = makeOptions(6); // 2 scenes (3 panels each)

      (invokeLLM as any).mockRejectedValueOnce(new Error("fail"));

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      const result = await generateXSheet(options);

      // 2 scenes = 2 "start" cues
      expect(result.musicCueCount).toBe(2);
    });

    it("heuristic estimates voice duration from dialogue word count", async () => {
      const options: TimingDirectorOptions = {
        episodeId: 1,
        projectId: 1,
        panels: [
          {
            panelId: 1, panelNumber: 1, sceneNumber: 1,
            dialogue: [{ character: "Hiro", text: "This is a long sentence with many words that should take several seconds to speak aloud clearly and distinctly." }],
          },
          {
            panelId: 2, panelNumber: 2, sceneNumber: 1,
            dialogue: [{ character: "Hiro", text: "Short." }],
          },
        ],
        characterVoiceProfiles: { Hiro: { pacing: "normal", avgWpm: 150 } },
      };

      (invokeLLM as any).mockRejectedValueOnce(new Error("fail"));

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      const result = await generateXSheet(options);

      expect(result.entryCount).toBe(2);
      // Long dialogue panel should have longer duration than short one
      expect(capturedEntries[0].durationMs).toBeGreaterThan(capturedEntries[1].durationMs);
    });
  });

  describe("generateXSheet — version management", () => {
    it("supersedes previous version when generating new X-Sheet", async () => {
      const options = makeOptions(4);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      // Existing sheet at version 2
      mockGetLatestXSheet.mockResolvedValueOnce({
        id: 10, episodeId: 1, projectId: 1, version: 2, source: "d4_auto",
        status: "approved", createdAt: new Date(), updatedAt: new Date(),
      });

      // createXSheet returns version 3
      mockCreateXSheet.mockImplementationOnce((data: any) => ({
        id: 11, ...data, version: 3, createdAt: new Date(), updatedAt: new Date(),
      }));

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      const result = await generateXSheet(options);

      expect(result.xSheetId).toBe(11);
      // Should have called updateXSheetStatus to supersede the old sheet
      expect(mockUpdateXSheetStatus).toHaveBeenCalledWith(10, "superseded");
    });

    it("increments version number from latest sheet", async () => {
      const options = makeOptions(4);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      mockGetLatestXSheet.mockResolvedValueOnce({
        id: 5, episodeId: 1, projectId: 1, version: 3, source: "d4_auto",
        status: "pending_review", createdAt: new Date(), updatedAt: new Date(),
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      // createXSheet should be called with version = 4
      const createCall = mockCreateXSheet.mock.calls[0][0];
      expect(createCall.version).toBe(4);
    });
  });

  describe("DB helpers — mergeEntriesWithOverrides", () => {
    it("returns base entries unchanged when no overrides exist", () => {
      const entries = [
        { id: 1, xSheetId: 1, sliceNumber: 1, startMs: 0, endMs: 3000, durationMs: 3000, emotion: "calm" },
        { id: 2, xSheetId: 1, sliceNumber: 2, startMs: 3000, endMs: 6000, durationMs: 3000, emotion: "tense" },
      ] as any[];

      const result = mergeEntriesWithOverrides(entries, []);
      expect(result).toEqual(entries);
    });

    it("merges override data on top of base entry by sliceNumber", () => {
      const entries = [
        { id: 1, xSheetId: 1, sliceNumber: 1, startMs: 0, endMs: 3000, durationMs: 3000, emotion: "calm", musicCueType: "none" },
        { id: 2, xSheetId: 1, sliceNumber: 2, startMs: 3000, endMs: 6000, durationMs: 3000, emotion: "tense", musicCueType: "start" },
      ] as any[];

      const overrides = [
        { id: 1, xSheetId: 1, userId: 1, sliceNumber: 2, overrideData: { durationMs: 5000, endMs: 8000, emotion: "excited" }, reason: "needs more time" },
      ] as any[];

      const result = mergeEntriesWithOverrides(entries, overrides);

      expect(result[0].emotion).toBe("calm");
      expect(result[0].durationMs).toBe(3000);
      expect(result[1].emotion).toBe("excited");
      expect(result[1].durationMs).toBe(5000);
      expect(result[1].endMs).toBe(8000);
      expect(result[1].musicCueType).toBe("start");
    });

    it("handles multiple overrides for different slices", () => {
      const entries = [
        { id: 1, xSheetId: 1, sliceNumber: 1, durationMs: 3000, musicIntensity: 50 },
        { id: 2, xSheetId: 1, sliceNumber: 2, durationMs: 3000, musicIntensity: 60 },
        { id: 3, xSheetId: 1, sliceNumber: 3, durationMs: 3000, musicIntensity: 70 },
      ] as any[];

      const overrides = [
        { id: 1, xSheetId: 1, userId: 1, sliceNumber: 1, overrideData: { musicIntensity: 80 } },
        { id: 2, xSheetId: 1, userId: 1, sliceNumber: 3, overrideData: { musicIntensity: 90, durationMs: 4000 } },
      ] as any[];

      const result = mergeEntriesWithOverrides(entries, overrides);

      expect(result[0].musicIntensity).toBe(80);
      expect(result[1].musicIntensity).toBe(60);
      expect(result[2].musicIntensity).toBe(90);
      expect(result[2].durationMs).toBe(4000);
    });
  });

  describe("Entry validation", () => {
    it("clamps duration to MIN/MAX bounds", async () => {
      const options = makeOptions(2);
      const llmResponse = makeLLMResponse(options.panels);
      llmResponse.entries[0].durationMs = 500; // below MIN (1500)
      llmResponse.entries[1].durationMs = 20000; // above MAX (15000)

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      expect(capturedEntries[0].durationMs).toBeGreaterThanOrEqual(1500);
      expect(capturedEntries[1].durationMs).toBeLessThanOrEqual(15000);
    });

    it("clamps energy level to 1-10 range", async () => {
      const options = makeOptions(2);
      const llmResponse = makeLLMResponse(options.panels);
      llmResponse.entries[0].energyLevel = 0; // falsy → defaults to 5
      llmResponse.entries[1].energyLevel = 15; // above max → clamped to 10

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      // 0 is falsy so code defaults to 5, then clamps to max(1, min(10, 5)) = 5
      expect(capturedEntries[0].energyLevel).toBe(5);
      expect(capturedEntries[1].energyLevel).toBe(10);
    });

    it("sets transition duration to 0 for cut transitions", async () => {
      const options = makeOptions(2);
      const llmResponse = makeLLMResponse(options.panels);
      llmResponse.entries[0].transitionType = "cut";
      llmResponse.entries[0].transitionDurationMs = 1000; // should be forced to 0

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      expect(capturedEntries[0].transitionDurationMs).toBe(0);
    });
  });

  describe("Pipeline integration — Stage 12 gate", () => {
    it("X-Sheet is created with pending_review status for blocking gate", async () => {
      const options = makeOptions(4);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      // Verify createXSheet was called with pending_review status
      const createCall = mockCreateXSheet.mock.calls[0][0];
      expect(createCall.status).toBe("pending_review");
    });

    it("createXSheet is called with source d4_auto", async () => {
      const options = makeOptions(4);
      const llmResponse = makeLLMResponse(options.panels);

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      const createCall = mockCreateXSheet.mock.calls[0][0];
      expect(createCall.source).toBe("d4_auto");
      expect(createCall.episodeId).toBe(1);
      expect(createCall.projectId).toBe(1);
    });

    it("stores BPM from LLM response in the X-Sheet", async () => {
      const options = makeOptions(4);
      const llmResponse = makeLLMResponse(options.panels);
      llmResponse.bpm = 140;

      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });

      const { generateXSheet } = await import("./benchmarks/d4-timing/timing-director");
      await generateXSheet(options);

      const createCall = mockCreateXSheet.mock.calls[0][0];
      expect(createCall.bpm).toBe(140);
    });
  });
});
