/**
 * Wave 4 Item 2: H1 Card-Legibility Registration Test
 *
 * Verifies that runCardLegibilityCheck is properly registered as check #8
 * in the rules-harness.ts runner.
 */
import { describe, it, expect, vi } from "vitest";

// Mock all check modules
vi.mock("./checks/silence-check.js", () => ({
  runSilenceCheck: vi.fn(() => ({ checkName: "silence", passed: true, durationMs: 10, details: "", routingHint: null })),
}));
vi.mock("./checks/loudness-check.js", () => ({
  runLoudnessCheck: vi.fn(() => ({ checkName: "loudness", passed: true, durationMs: 10, details: "", routingHint: null })),
}));
vi.mock("./checks/aspect-check.js", () => ({
  runAspectCheck: vi.fn(() => ({ checkName: "aspect", passed: true, durationMs: 10, details: "", routingHint: null })),
}));
vi.mock("./checks/duration-check.js", () => ({
  runDurationCheck: vi.fn(() => ({ checkName: "duration", passed: true, durationMs: 10, details: "", routingHint: null })),
}));
vi.mock("./checks/face-count-check.js", () => ({
  runFaceCountCheck: vi.fn(() => ({ checkName: "faceCount", passed: true, durationMs: 10, details: "", routingHint: null })),
}));
vi.mock("./checks/watermark-check.js", () => ({
  runWatermarkCheck: vi.fn(() => ({ checkName: "watermark", passed: true, durationMs: 10, details: "", routingHint: null })),
}));
vi.mock("./checks/file-integrity-check.js", () => ({
  runFileIntegrityCheck: vi.fn(() => ({ checkName: "fileIntegrity", passed: true, durationMs: 10, details: "", routingHint: null })),
}));
vi.mock("./checks/card-legibility-check.js", () => ({
  runCardLegibilityCheck: vi.fn(() => ({
    checkName: "cardLegibility",
    passed: true,
    durationMs: 15,
    details: "Title card: contrast 5.2:1 (AA pass). End card: contrast 6.1:1 (AA pass).",
    routingHint: null,
  })),
}));

import { runRulesHarness } from "./rules-harness.js";
import { runCardLegibilityCheck } from "./checks/card-legibility-check.js";

describe("H1 Card-Legibility Registration (Check #8)", () => {
  const baseOptions = {
    videoPath: "/tmp/test-video.mp4",
    sliceCount: 5,
    titleCardDurationSec: 3,
    endCardDurationSec: 3,
    totalDurationSec: 60,
    dialogueSlices: [
      { sliceId: 1, startSec: 3, durationSec: 10, isDialogue: true },
    ],
    tempDir: "/tmp/harness-test",
  };

  it("includes cardLegibility as the 8th check in results", async () => {
    const verdict = await runRulesHarness(baseOptions);

    expect(verdict.checks.length).toBe(8);
    expect(verdict.checks[7].checkName).toBe("cardLegibility");
  });

  it("calls runCardLegibilityCheck with correct options", async () => {
    await runRulesHarness(baseOptions);

    expect(runCardLegibilityCheck).toHaveBeenCalledWith({
      videoPath: "/tmp/test-video.mp4",
      titleCardDurationSec: 3,
      endCardDurationSec: 3,
      totalDurationSec: 60,
      tempDir: "/tmp/harness-test",
    });
  });

  it("cardLegibility failure causes overall verdict to fail", async () => {
    vi.mocked(runCardLegibilityCheck).mockReturnValue({
      checkName: "cardLegibility",
      passed: false,
      durationMs: 20,
      details: "Title card: contrast 2.1:1 (below AA 4.5:1). Routing: assembly_reencode.",
      routingHint: "assembly_reencode",
    });

    const verdict = await runRulesHarness(baseOptions);

    expect(verdict.passed).toBe(false);
    expect(verdict.checks[7].passed).toBe(false);
    expect(verdict.checks[7].routingHint).toBe("assembly_reencode");
  });

  it("skips cardLegibility when skipCardLegibility=true", async () => {
    vi.mocked(runCardLegibilityCheck).mockClear();

    const verdict = await runRulesHarness({
      ...baseOptions,
      skipCardLegibility: true,
    });

    expect(verdict.checks.length).toBe(7); // Only 7 checks
    expect(runCardLegibilityCheck).not.toHaveBeenCalled();
  });

  it("uses totalDurationSec=0 fallback when not provided", async () => {
    const optsWithoutDuration = { ...baseOptions };
    delete (optsWithoutDuration as any).totalDurationSec;

    await runRulesHarness(optsWithoutDuration);

    expect(runCardLegibilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationSec: 0 })
    );
  });

  it("harness passes when all 8 checks pass including cardLegibility", async () => {
    vi.mocked(runCardLegibilityCheck).mockReturnValue({
      checkName: "cardLegibility",
      passed: true,
      durationMs: 12,
      details: "Both cards pass WCAG AA contrast.",
      routingHint: null,
    });

    const verdict = await runRulesHarness(baseOptions);

    expect(verdict.passed).toBe(true);
    expect(verdict.tier).toBe("tier1_rules");
    expect(verdict.totalCostUsd).toBe(0);
  });
});
