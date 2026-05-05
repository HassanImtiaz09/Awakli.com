/**
 * H1 · Rules-Based Release Harness (Tier 1)
 *
 * Top-level runner that executes all 8 deterministic checks in sequence.
 * Returns a HarnessVerdict with pass/fail per check and routing hints.
 *
 * Cost: $0/episode. Wall-clock: ~30s for a 3-min episode.
 */

import type { HarnessVerdict, HarnessCheckResult } from "./types.js";
import { runSilenceCheck, type SilenceCheckOptions } from "./checks/silence-check.js";
import { runLoudnessCheck, type LoudnessCheckOptions } from "./checks/loudness-check.js";
import { runAspectCheck, type AspectCheckOptions } from "./checks/aspect-check.js";
import { runDurationCheck, type DurationCheckOptions } from "./checks/duration-check.js";
import { runFaceCountCheck, type FaceCountCheckOptions } from "./checks/face-count-check.js";
import { runWatermarkCheck, type WatermarkCheckOptions } from "./checks/watermark-check.js";
import { runFileIntegrityCheck, type FileIntegrityCheckOptions } from "./checks/file-integrity-check.js";
import { runCardLegibilityCheck, type CardLegibilityOptions } from "./checks/card-legibility-check.js";

export interface RulesHarnessOptions {
  /** Path to the assembled video file */
  videoPath: string;
  /** Number of content slices (excluding title/end cards) */
  sliceCount: number;
  /** Duration of each content slice in seconds (default: 10) — used only if actualClipDurations not provided */
  sliceDurationSec?: number;
  /** Title card duration in seconds */
  titleCardDurationSec: number;
  /** End card duration in seconds */
  endCardDurationSec: number;
  /** Total video duration (auto-detected if not provided) */
  totalDurationSec?: number;
  /** Measured durations of each clip in seconds — used for accurate expected duration */
  actualClipDurations?: number[];
  /** Total seconds lost to transition overlaps */
  transitionOverlapSec?: number;
  /** Dialogue slice metadata for face-count check */
  dialogueSlices: Array<{
    sliceId: number;
    startSec: number;
    durationSec: number;
    isDialogue: boolean;
  }>;
  /** Whether this is an Apprentice tier project requiring watermark */
  requireWatermark?: boolean;
  /** Temp directory for intermediate files */
  tempDir: string;
  /** Custom LUFS range for loudness check (default: [-17, -15]) */
  lufsRange?: [number, number];
  /** Custom LRA range for loudness check (default: [6, 14]) */
  lraRange?: [number, number];
  /** Skip card legibility check (default: false) */
  skipCardLegibility?: boolean;
}

export async function runRulesHarness(options: RulesHarnessOptions): Promise<HarnessVerdict> {
  const start = Date.now();
  const checks: HarnessCheckResult[] = [];

  console.log("  ┌─ H1 Tier 1: Rules-Based Release Gate ─────────────────");

  // 1. File Integrity (run first — if file is corrupt, other checks are meaningless)
  const fileIntegrity = runFileIntegrityCheck({
    videoPath: options.videoPath,
  });
  checks.push(fileIntegrity);
  console.log(`  │ fileIntegrity: ${fileIntegrity.passed ? "✓" : "✗"} (${fileIntegrity.durationMs}ms)`);
  if (!fileIntegrity.passed) {
    console.log(`  │   → ${fileIntegrity.details}`);
  }

  // 2. Aspect Check
  const aspect = runAspectCheck({
    videoPath: options.videoPath,
  });
  checks.push(aspect);
  console.log(`  │ aspect:        ${aspect.passed ? "✓" : "✗"} (${aspect.durationMs}ms)`);
  if (!aspect.passed) {
    console.log(`  │   → ${aspect.details}`);
  }

  // 3. Duration Check — uses actual clip durations when available for accuracy
  const duration = runDurationCheck({
    videoPath: options.videoPath,
    sliceCount: options.sliceCount,
    sliceDurationSec: options.sliceDurationSec,
    titleCardDurationSec: options.titleCardDurationSec,
    endCardDurationSec: options.endCardDurationSec,
    actualClipDurations: options.actualClipDurations,
    transitionOverlapSec: options.transitionOverlapSec,
  });
  checks.push(duration);
  console.log(`  │ duration:      ${duration.passed ? "✓" : "✗"} (${duration.durationMs}ms)`);
  if (!duration.passed) {
    console.log(`  │   → ${duration.details}`);
  }

  // 4. Silence Check
  const silence = runSilenceCheck({
    videoPath: options.videoPath,
    titleCardDurationSec: options.titleCardDurationSec,
    endCardDurationSec: options.endCardDurationSec,
    totalDurationSec: options.totalDurationSec,
  });
  checks.push(silence);
  console.log(`  │ silence:       ${silence.passed ? "✓" : "✗"} (${silence.durationMs}ms)`);
  if (!silence.passed) {
    console.log(`  │   → ${silence.details}`);
  }

  // 5. Loudness Check — widened LRA default to [6, 14] to accommodate music bed dynamic range
  const loudness = runLoudnessCheck({
    videoPath: options.videoPath,
    lufsRange: options.lufsRange,
    lraRange: options.lraRange ?? [6, 14],
  });
  checks.push(loudness);
  console.log(`  │ loudness:      ${loudness.passed ? "✓" : "✗"} (${loudness.durationMs}ms)`);
  if (!loudness.passed) {
    console.log(`  │   → ${loudness.details}`);
  }

  // 6. Face Count Check
  const faceCount = runFaceCountCheck({
    videoPath: options.videoPath,
    dialogueSlices: options.dialogueSlices,
    titleCardDurationSec: options.titleCardDurationSec,
    tempDir: options.tempDir,
  });
  checks.push(faceCount);
  console.log(`  │ faceCount:     ${faceCount.passed ? "✓" : "✗"} (${faceCount.durationMs}ms)`);
  if (!faceCount.passed) {
    console.log(`  │   → ${faceCount.details}`);
  }

  // 7. Watermark Check
  const watermark = runWatermarkCheck({
    videoPath: options.videoPath,
    requireWatermark: options.requireWatermark ?? false,
    tempDir: options.tempDir,
  });
  checks.push(watermark);
  console.log(`  │ watermark:     ${watermark.passed ? "✓" : "✗"} (${watermark.durationMs}ms)`);
  if (!watermark.passed && options.requireWatermark) {
    console.log(`  │   → ${watermark.details}`);
  }

  // 8. Card Legibility Check (title + end card text contrast)
  if (!options.skipCardLegibility) {
    const cardLegibility = runCardLegibilityCheck({
      videoPath: options.videoPath,
      titleCardDurationSec: options.titleCardDurationSec,
      endCardDurationSec: options.endCardDurationSec,
      totalDurationSec: options.totalDurationSec ?? 0,
      tempDir: options.tempDir,
    });
    checks.push(cardLegibility);
    console.log(`  │ cardLegibility: ${cardLegibility.passed ? "✓" : "✗"} (${cardLegibility.durationMs}ms)`);
    if (!cardLegibility.passed) {
      console.log(`  │   → ${cardLegibility.details}`);
    }
  }

  const totalDurationMs = Date.now() - start;
  const allPassed = checks.every((c) => c.passed);

  console.log(`  │`);
  console.log(`  │ VERDICT: ${allPassed ? "ALL PASSED ✓" : "FAILED ✗"} (${totalDurationMs}ms total)`);
  if (!allPassed) {
    const failed = checks.filter((c) => !c.passed);
    console.log(`  │ Failed checks: ${failed.map((c) => c.checkName).join(", ")}`);
  }
  console.log(`  └────────────────────────────────────────────────────────`);

  return {
    tier: "tier1_rules",
    passed: allPassed,
    checks,
    totalDurationMs,
    totalCostUsd: 0, // Rules-based checks are free
  };
}
