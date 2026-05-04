/**
 * H1 Card-Legibility Probe Integration Test
 *
 * Call flow per card in analyzeCard:
 *   1. extractFrame → execSync (ffmpeg extract) + fs.existsSync(outputPath)
 *   2. analyzeFrameLuminance → execSync (center signalstats) + execSync (bg signalstats)
 *   3. fs.unlinkSync (cleanup)
 *
 * Call flow in runCardLegibilityCheck:
 *   1. fs.existsSync(tempDir) → if false, mkdirSync
 *   2. For each card: analyzeCard (3 execSync + 1 existsSync + 1 unlinkSync)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock fs - use a factory that returns both default and named exports
vi.mock("fs", () => {
  const existsSync = vi.fn(() => true);
  const mkdirSync = vi.fn();
  const unlinkSync = vi.fn();
  return {
    default: { existsSync, mkdirSync, unlinkSync },
    existsSync,
    mkdirSync,
    unlinkSync,
  };
});

import { execSync } from "child_process";
import fs from "fs";
import {
  calculateContrastRatio,
  parseSignalstatsYAvg,
  parseSignalstatsYVariance,
  analyzeCard,
  runCardLegibilityCheck,
  WCAG_AA_CONTRAST,
  WCAG_AAA_CONTRAST,
  BLANK_FRAME_THRESHOLD,
  TEXT_DETECTION_VARIANCE_THRESHOLD,
  type CardLegibilityOptions,
} from "./benchmarks/harness/checks/card-legibility-check";

const mockExecSync = vi.mocked(execSync);
const mockFsExists = vi.mocked(fs.existsSync);

// Helper: signalstats output with specific YAVG, YLOW, YHIGH
function statsOutput(yavg: number, ylow: number, yhigh: number): Buffer {
  return Buffer.from(
    `[Parsed_signalstats_0 @ 0x55a] YMIN:0 YLOW:${ylow} YAVG:${yavg} YHIGH:${yhigh} YMAX:255`
  );
}

/**
 * Setup mocks for a single card analysis (3 execSync + 1 existsSync for extraction).
 * The existsSync for extraction returns true by default (from beforeEach).
 */
function mockCardAnalysis(
  centerYavg: number, centerYlow: number, centerYhigh: number,
  bgYavg: number, bgYlow: number, bgYhigh: number,
) {
  mockExecSync
    .mockReturnValueOnce(Buffer.from("")) // frame extraction
    .mockReturnValueOnce(statsOutput(centerYavg, centerYlow, centerYhigh)) // center signalstats
    .mockReturnValueOnce(statsOutput(bgYavg, bgYlow, bgYhigh)); // bg signalstats
}

describe("H1 Card-Legibility Probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all fs.existsSync calls return true (tempDir exists, frames exist)
    mockFsExists.mockReturnValue(true);
  });

  // ─── Contrast Ratio Calculation ───────────────────────────────────────

  describe("calculateContrastRatio", () => {
    it("returns 21:1 for white on black (maximum contrast)", () => {
      const ratio = calculateContrastRatio(1.0, 0.0);
      expect(ratio).toBeCloseTo(21.0, 1);
    });

    it("returns 1:1 for same luminance (no contrast)", () => {
      const ratio = calculateContrastRatio(0.5, 0.5);
      expect(ratio).toBeCloseTo(1.0, 1);
    });

    it("is commutative (order doesn't matter)", () => {
      const r1 = calculateContrastRatio(0.8, 0.2);
      const r2 = calculateContrastRatio(0.2, 0.8);
      expect(r1).toBeCloseTo(r2);
    });

    it("returns ~4.5 for WCAG AA boundary", () => {
      // Solve: (L1 + 0.05) / (L2 + 0.05) = 4.5
      // For L2 = 0.1: L1 = 4.5 * 0.15 - 0.05 = 0.625
      const ratio = calculateContrastRatio(0.625, 0.1);
      expect(ratio).toBeCloseTo(4.5, 1);
    });

    it("handles very small luminance values", () => {
      const ratio = calculateContrastRatio(0.01, 0.001);
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(2);
    });
  });

  // ─── Signalstats Parsing ──────────────────────────────────────────────

  describe("parseSignalstatsYAvg", () => {
    it("parses YAVG from signalstats output", () => {
      const output = `[Parsed_signalstats_0 @ 0x55a] YMIN:0 YLOW:12 YAVG:128.5 YHIGH:240 YMAX:255`;
      expect(parseSignalstatsYAvg(output)).toBeCloseTo(128.5);
    });

    it("parses YAVG with integer value", () => {
      const output = `YAVG:200`;
      expect(parseSignalstatsYAvg(output)).toBe(200);
    });

    it("returns null when YAVG not found", () => {
      const output = `Some random ffmpeg output without stats`;
      expect(parseSignalstatsYAvg(output)).toBeNull();
    });
  });

  describe("parseSignalstatsYVariance", () => {
    it("computes variance proxy from YLOW and YHIGH", () => {
      const output = `YLOW:50 YHIGH:200`;
      const variance = parseSignalstatsYVariance(output);
      expect(variance).toBe((200 - 50) * (200 - 50)); // 22500
    });

    it("returns null when YLOW/YHIGH not found", () => {
      expect(parseSignalstatsYVariance("no stats here")).toBeNull();
    });

    it("returns 0 variance for uniform frame", () => {
      const output = `YLOW:128 YHIGH:128`;
      expect(parseSignalstatsYVariance(output)).toBe(0);
    });
  });

  // ─── Card Analysis ────────────────────────────────────────────────────

  describe("analyzeCard", () => {
    it("passes for high-contrast white-on-black title card", () => {
      // White text (YAVG=230, YLOW=20, YHIGH=250 → high variance = text present)
      // Black bg (YAVG=10)
      mockCardAnalysis(230, 20, 250, 10, 5, 15);

      const result = analyzeCard(
        "/tmp/video.mp4", "title", 2.5, "/tmp", 1280, 720, WCAG_AA_CONTRAST,
      );

      expect(result.passed).toBe(true);
      expect(result.cardType).toBe("title");
      // textLuminance = 230/255 ≈ 0.902, bgLuminance = 10/255 ≈ 0.039
      // contrast = (0.902 + 0.05) / (0.039 + 0.05) ≈ 10.7
      expect(result.contrastRatio).toBeGreaterThan(WCAG_AA_CONTRAST);
      expect(result.hasTextRegion).toBe(true);
      expect(result.isBlankFrame).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it("fails for low-contrast gray-on-gray card", () => {
      // Center: mid-gray (YAVG=130, YLOW=110, YHIGH=150 → variance=(150-110)^2=1600 → normalized=1600/65025≈0.025 > threshold)
      // Background: slightly darker gray (YAVG=120)
      mockCardAnalysis(130, 110, 150, 120, 100, 130);

      const result = analyzeCard(
        "/tmp/video.mp4", "end", 120.0, "/tmp", 1280, 720, WCAG_AA_CONTRAST,
      );

      expect(result.passed).toBe(false);
      // textLuminance = 130/255 ≈ 0.510, bgLuminance = 120/255 ≈ 0.471
      // contrast = (0.510 + 0.05) / (0.471 + 0.05) ≈ 1.07 → below 4.5
      expect(result.contrastRatio).toBeLessThan(WCAG_AA_CONTRAST);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some(i => i.includes("contrast ratio"))).toBe(true);
    });

    it("fails for blank (all-black) frame", () => {
      // Center: all black (YAVG=1 → 1/255 ≈ 0.004 < BLANK_FRAME_THRESHOLD=0.01)
      // Background: all black
      mockCardAnalysis(1, 0, 2, 1, 0, 1);

      const result = analyzeCard(
        "/tmp/video.mp4", "title", 2.5, "/tmp", 1280, 720, WCAG_AA_CONTRAST,
      );

      expect(result.passed).toBe(false);
      expect(result.isBlankFrame).toBe(true);
      expect(result.issues[0]).toContain("blank");
    });

    it("fails when frame extraction fails (execSync throws)", () => {
      // Make execSync throw to simulate ffmpeg failure
      mockExecSync.mockImplementationOnce(() => { throw new Error("ffmpeg not found"); });
      // Also make fs.existsSync return false for the output path check
      // But since execSync throws, extractFrame catches it and returns false
      // Actually: extractFrame has try/catch around execSync, so if it throws, returns false

      const result = analyzeCard(
        "/tmp/video.mp4", "title", 2.5, "/tmp", 1280, 720, WCAG_AA_CONTRAST,
      );

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain("Failed to extract");
    });

    it("fails when frame file not created after extraction", () => {
      // execSync succeeds but file doesn't exist
      mockExecSync.mockReturnValueOnce(Buffer.from(""));
      // Override existsSync to return false for this specific call
      mockFsExists.mockReturnValueOnce(false);

      const result = analyzeCard(
        "/tmp/video.mp4", "title", 2.5, "/tmp", 1280, 720, WCAG_AA_CONTRAST,
      );

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain("Failed to extract");
    });

    it("detects missing text region (uniform center)", () => {
      // Center: uniform luminance (YLOW=128, YHIGH=130 → variance=(130-128)^2=4 → normalized=4/65025≈0.00006 < threshold)
      // But high YAVG=128 → textLuminance = 128/255 ≈ 0.502
      // Background: black (YAVG=10 → bgLuminance = 10/255 ≈ 0.039)
      // contrast = (0.502 + 0.05) / (0.039 + 0.05) ≈ 6.2 → passes contrast
      // But variance is too low → no text detected → fails
      mockCardAnalysis(128, 128, 130, 10, 5, 10);

      const result = analyzeCard(
        "/tmp/video.mp4", "end", 120.0, "/tmp", 1280, 720, WCAG_AA_CONTRAST,
      );

      // variance = (130-128)^2 / 65025 = 4/65025 ≈ 0.000061 < TEXT_DETECTION_VARIANCE_THRESHOLD (0.02)
      expect(result.hasTextRegion).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.includes("No text detected"))).toBe(true);
    });

    it("fails when signalstats parsing returns null", () => {
      mockExecSync
        .mockReturnValueOnce(Buffer.from("")) // extract
        .mockReturnValueOnce(Buffer.from("random garbage with no stats")) // center
        .mockReturnValueOnce(Buffer.from("more garbage")); // bg

      const result = analyzeCard(
        "/tmp/video.mp4", "title", 2.5, "/tmp", 1280, 720, WCAG_AA_CONTRAST,
      );

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain("Failed to analyze luminance");
    });
  });

  // ─── Full Check Runner ────────────────────────────────────────────────

  describe("runCardLegibilityCheck", () => {
    const baseOptions: CardLegibilityOptions = {
      videoPath: "/tmp/episode.mp4",
      titleCardDurationSec: 5,
      endCardDurationSec: 4,
      totalDurationSec: 180,
      tempDir: "/tmp/harness",
    };

    it("passes when both cards have good contrast", () => {
      // Title card: high contrast white on black
      mockCardAnalysis(230, 20, 250, 10, 5, 15);
      // End card: high contrast white on black
      mockCardAnalysis(220, 15, 245, 8, 3, 10);

      const result = runCardLegibilityCheck(baseOptions);

      expect(result.checkName).toBe("card_legibility_check");
      expect(result.passed).toBe(true);
      expect(result.routingHint.target).toBe("none");
      expect(result.details).toContain("compliant");
    });

    it("fails when title card has low contrast", () => {
      // Title card: low contrast (gray on gray, but with text variance)
      mockCardAnalysis(130, 80, 150, 120, 100, 130);
      // End card: good contrast
      mockCardAnalysis(230, 20, 250, 10, 5, 15);

      const result = runCardLegibilityCheck(baseOptions);

      expect(result.passed).toBe(false);
      expect(result.routingHint.target).toBe("assembly_reencode");
      expect(result.details).toContain("contrast ratio");
    });

    it("routes to assembly_reencode on failure", () => {
      // Both cards: uniform gray (no text, low contrast)
      mockCardAnalysis(128, 128, 128, 128, 128, 128);
      mockCardAnalysis(128, 128, 128, 128, 128, 128);

      const result = runCardLegibilityCheck(baseOptions);

      expect(result.passed).toBe(false);
      expect(result.routingHint.target).toBe("assembly_reencode");
      expect(result.routingHint.reason).toContain("re-render");
    });

    it("extracts title frame at midpoint of title duration", () => {
      mockCardAnalysis(230, 20, 250, 10, 5, 15);
      mockCardAnalysis(230, 20, 250, 10, 5, 15);

      runCardLegibilityCheck(baseOptions);

      // Title card midpoint: 5/2 = 2.5s
      const firstCall = mockExecSync.mock.calls[0][0] as string;
      expect(firstCall).toContain("-ss 2.50");
    });

    it("extracts end frame at video_duration - end_duration/2", () => {
      mockCardAnalysis(230, 20, 250, 10, 5, 15);
      mockCardAnalysis(230, 20, 250, 10, 5, 15);

      runCardLegibilityCheck(baseOptions);

      // End card midpoint: 180 - 4/2 = 178s
      // End card extraction is the 4th execSync call (title: extract, center, bg; end: extract)
      const endExtractCall = mockExecSync.mock.calls[3][0] as string;
      expect(endExtractCall).toContain("-ss 178.00");
    });

    it("skips title card when titleCardDurationSec is 0", () => {
      // Only end card: 3 calls
      mockCardAnalysis(230, 20, 250, 10, 5, 15);

      const result = runCardLegibilityCheck({
        ...baseOptions,
        titleCardDurationSec: 0,
      });

      // Only end card analyzed (3 execSync calls, not 6)
      expect(mockExecSync).toHaveBeenCalledTimes(3);
      expect(result.passed).toBe(true);
    });

    it("includes WCAG AAA level in details for very high contrast", () => {
      // Title: very high contrast (near-white on near-black → ~21:1 > 7.0 AAA)
      // YAVG=250, YLOW=10, YHIGH=252 → textLum=250/255≈0.98, variance=(252-10)^2/65025≈0.9 → text present
      mockCardAnalysis(250, 10, 252, 5, 0, 5);
      // End: very high contrast
      mockCardAnalysis(248, 10, 250, 5, 0, 5);

      const result = runCardLegibilityCheck(baseOptions);

      expect(result.passed).toBe(true);
      expect(result.details).toContain("AAA");
    });

    it("reports duration in milliseconds", () => {
      mockCardAnalysis(230, 20, 250, 10, 5, 15);
      mockCardAnalysis(230, 20, 250, 10, 5, 15);

      const result = runCardLegibilityCheck(baseOptions);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe("number");
    });

    it("handles custom minContrastRatio", () => {
      // Cards with moderate contrast (~2.5:1, fails AA but passes custom 2.0)
      // textLum = 180/255 ≈ 0.706, bgLum = 100/255 ≈ 0.392
      // contrast = (0.706+0.05)/(0.392+0.05) ≈ 1.71 → hmm that's too low
      // Let's use: textLum = 200/255 ≈ 0.784, bgLum = 80/255 ≈ 0.314
      // contrast = (0.784+0.05)/(0.314+0.05) ≈ 2.29 → passes 2.0
      // Need text variance: YLOW=50, YHIGH=200 → (200-50)^2/65025 ≈ 0.35 → text present
      mockCardAnalysis(200, 50, 220, 80, 60, 90);
      mockCardAnalysis(200, 50, 220, 80, 60, 90);

      const result = runCardLegibilityCheck({
        ...baseOptions,
        minContrastRatio: 2.0,
      });

      expect(result.passed).toBe(true);
    });
  });

  // ─── Constants Validation ─────────────────────────────────────────────

  describe("Constants", () => {
    it("WCAG AA is 4.5", () => {
      expect(WCAG_AA_CONTRAST).toBe(4.5);
    });

    it("WCAG AAA is 7.0", () => {
      expect(WCAG_AAA_CONTRAST).toBe(7.0);
    });

    it("TEXT_DETECTION_VARIANCE_THRESHOLD is reasonable", () => {
      expect(TEXT_DETECTION_VARIANCE_THRESHOLD).toBeGreaterThan(0);
      expect(TEXT_DETECTION_VARIANCE_THRESHOLD).toBeLessThan(0.1);
    });

    it("BLANK_FRAME_THRESHOLD is very small", () => {
      expect(BLANK_FRAME_THRESHOLD).toBeGreaterThan(0);
      expect(BLANK_FRAME_THRESHOLD).toBeLessThan(0.05);
    });
  });
});
