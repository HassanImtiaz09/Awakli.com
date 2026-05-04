/**
 * H1 · cardLegibilityCheck
 *
 * Validates that title cards and end cards have sufficient text contrast
 * and legibility by extracting representative frames and measuring
 * luminance contrast between text regions and background.
 *
 * Uses FFmpeg to extract frames at specific timecodes, then analyzes
 * pixel luminance in text-expected regions vs. surrounding background.
 *
 * PASS criteria:
 *   - Contrast ratio ≥ 4.5:1 (WCAG AA for normal text)
 *   - Text region detected (non-uniform luminance in center)
 *   - No full-black or full-white frames (indicates generation failure)
 *
 * Routing: assembly_reencode (re-render title/end card with adjusted params)
 */
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import type { HarnessCheckResult } from "../types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CardLegibilityOptions {
  /** Path to the assembled video file */
  videoPath: string;
  /** Title card duration in seconds (frame extracted at midpoint) */
  titleCardDurationSec: number;
  /** End card duration in seconds */
  endCardDurationSec: number;
  /** Total video duration in seconds (needed to locate end card) */
  totalDurationSec: number;
  /** Temp directory for frame extraction */
  tempDir: string;
  /** Minimum WCAG contrast ratio (default: 4.5 for AA) */
  minContrastRatio?: number;
  /** Video width (default: 1280) */
  width?: number;
  /** Video height (default: 720) */
  height?: number;
}

export interface CardAnalysis {
  cardType: "title" | "end";
  frameTimecode: number;
  textRegionLuminance: number;
  bgRegionLuminance: number;
  contrastRatio: number;
  hasTextRegion: boolean;
  isBlankFrame: boolean;
  passed: boolean;
  issues: string[];
}

export interface CardLegibilityMetrics {
  titleCard: CardAnalysis | null;
  endCard: CardAnalysis | null;
  overallPassed: boolean;
  wcagLevel: "AAA" | "AA" | "below_AA";
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** WCAG AA minimum contrast ratio for normal text */
export const WCAG_AA_CONTRAST = 4.5;
/** WCAG AAA minimum contrast ratio for normal text */
export const WCAG_AAA_CONTRAST = 7.0;
/** Luminance variance threshold to detect text presence */
export const TEXT_DETECTION_VARIANCE_THRESHOLD = 0.02;
/** Luminance threshold for blank frame detection (all black or all white) */
export const BLANK_FRAME_THRESHOLD = 0.01;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract a single frame from a video at a given timecode.
 * Returns the path to the extracted PNG frame.
 */
export function extractFrame(
  videoPath: string,
  timecode: number,
  outputPath: string,
): boolean {
  try {
    execSync(
      `ffmpeg -y -ss ${timecode.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}" 2>/dev/null`,
      { timeout: 10000 },
    );
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

/**
 * Analyze a frame's luminance in text and background regions.
 *
 * Strategy:
 *   - Text region: center 60% of frame (where title/credits are rendered)
 *   - Background region: outer 20% border (typically solid color)
 *
 * Uses FFmpeg's signalstats filter to measure average luminance per crop.
 */
export function analyzeFrameLuminance(
  framePath: string,
  width: number,
  height: number,
): { textLuminance: number; bgLuminance: number; textVariance: number } | null {
  try {
    // Center region (60% of frame)
    const cx = Math.round(width * 0.2);
    const cy = Math.round(height * 0.2);
    const cw = Math.round(width * 0.6);
    const ch = Math.round(height * 0.6);

    // Background region (top 15% strip)
    const bw = width;
    const bh = Math.round(height * 0.15);

    // Measure center region luminance
    const centerOut = execSync(
      `ffmpeg -i "${framePath}" -vf "crop=${cw}:${ch}:${cx}:${cy},signalstats" -f null - 2>&1 || true`,
      { timeout: 10000 },
    ).toString();

    // Measure background region luminance
    const bgOut = execSync(
      `ffmpeg -i "${framePath}" -vf "crop=${bw}:${bh}:0:0,signalstats" -f null - 2>&1 || true`,
      { timeout: 10000 },
    ).toString();

    const centerLum = parseSignalstatsYAvg(centerOut);
    const bgLum = parseSignalstatsYAvg(bgOut);

    // Measure variance in center region (text detection)
    const centerVariance = parseSignalstatsYVariance(centerOut);

    if (centerLum === null || bgLum === null) return null;

    return {
      textLuminance: centerLum / 255, // Normalize to 0-1
      bgLuminance: bgLum / 255,
      textVariance: centerVariance !== null ? centerVariance / (255 * 255) : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the average Y (luminance) from FFmpeg signalstats output.
 */
export function parseSignalstatsYAvg(output: string): number | null {
  // signalstats outputs lines like: [Parsed_signalstats_0 @ ...] YAVG:128.5
  const match = output.match(/YAVG[:\s]+(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Parse the Y variance from FFmpeg signalstats output.
 */
export function parseSignalstatsYVariance(output: string): number | null {
  // Look for YLOW and YHIGH to compute variance proxy
  const lowMatch = output.match(/YLOW[:\s]+(\d+\.?\d*)/);
  const highMatch = output.match(/YHIGH[:\s]+(\d+\.?\d*)/);
  if (lowMatch && highMatch) {
    const low = parseFloat(lowMatch[1]);
    const high = parseFloat(highMatch[1]);
    return (high - low) * (high - low); // Simplified variance proxy
  }
  return null;
}

/**
 * Calculate WCAG contrast ratio from two relative luminance values (0-1 scale).
 * Formula: (L1 + 0.05) / (L2 + 0.05) where L1 >= L2
 */
export function calculateContrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Analyze a single card (title or end).
 */
export function analyzeCard(
  videoPath: string,
  cardType: "title" | "end",
  timecode: number,
  tempDir: string,
  width: number,
  height: number,
  minContrastRatio: number,
): CardAnalysis {
  const framePath = path.join(tempDir, `${cardType}_card_frame.png`);
  const issues: string[] = [];

  // Extract frame
  const extracted = extractFrame(videoPath, timecode, framePath);
  if (!extracted) {
    return {
      cardType,
      frameTimecode: timecode,
      textRegionLuminance: 0,
      bgRegionLuminance: 0,
      contrastRatio: 0,
      hasTextRegion: false,
      isBlankFrame: true,
      passed: false,
      issues: [`Failed to extract ${cardType} card frame at t=${timecode.toFixed(2)}s`],
    };
  }

  // Analyze luminance
  const luminance = analyzeFrameLuminance(framePath, width, height);
  if (!luminance) {
    return {
      cardType,
      frameTimecode: timecode,
      textRegionLuminance: 0,
      bgRegionLuminance: 0,
      contrastRatio: 0,
      hasTextRegion: false,
      isBlankFrame: true,
      passed: false,
      issues: [`Failed to analyze luminance for ${cardType} card`],
    };
  }

  const { textLuminance, bgLuminance, textVariance } = luminance;

  // Check for blank frame (all black or all white)
  const isBlankFrame =
    (textLuminance < BLANK_FRAME_THRESHOLD && bgLuminance < BLANK_FRAME_THRESHOLD) ||
    (textLuminance > 1 - BLANK_FRAME_THRESHOLD && bgLuminance > 1 - BLANK_FRAME_THRESHOLD);

  if (isBlankFrame) {
    issues.push(`${cardType} card appears blank (uniform luminance ${textLuminance.toFixed(3)})`);
  }

  // Check text region presence (variance in center indicates text)
  const hasTextRegion = textVariance > TEXT_DETECTION_VARIANCE_THRESHOLD;
  if (!hasTextRegion && !isBlankFrame) {
    issues.push(`No text detected in ${cardType} card center region (variance ${textVariance.toFixed(4)} < ${TEXT_DETECTION_VARIANCE_THRESHOLD})`);
  }

  // Calculate contrast ratio
  const contrastRatio = calculateContrastRatio(textLuminance, bgLuminance);
  if (contrastRatio < minContrastRatio) {
    issues.push(
      `${cardType} card contrast ratio ${contrastRatio.toFixed(2)}:1 < ${minContrastRatio}:1 (WCAG AA)`,
    );
  }

  const passed = !isBlankFrame && hasTextRegion && contrastRatio >= minContrastRatio;

  // Clean up extracted frame
  try { fs.unlinkSync(framePath); } catch { /* ignore */ }

  return {
    cardType,
    frameTimecode: timecode,
    textRegionLuminance: textLuminance,
    bgRegionLuminance: bgLuminance,
    contrastRatio,
    hasTextRegion,
    isBlankFrame,
    passed,
    issues,
  };
}

// ─── Main Check ─────────────────────────────────────────────────────────────

/**
 * Run the card legibility check on title and end cards.
 *
 * Extracts frames at the midpoint of each card's duration and validates
 * contrast, text presence, and non-blankness.
 */
export function runCardLegibilityCheck(options: CardLegibilityOptions): HarnessCheckResult {
  const start = Date.now();
  const {
    videoPath,
    titleCardDurationSec,
    endCardDurationSec,
    totalDurationSec,
    tempDir,
    minContrastRatio = WCAG_AA_CONTRAST,
    width = 1280,
    height = 720,
  } = options;

  // Ensure temp dir exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const results: CardAnalysis[] = [];
  const allIssues: string[] = [];

  // Analyze title card (frame at midpoint of title duration)
  if (titleCardDurationSec > 0) {
    const titleTimecode = titleCardDurationSec / 2;
    const titleAnalysis = analyzeCard(
      videoPath, "title", titleTimecode, tempDir, width, height, minContrastRatio,
    );
    results.push(titleAnalysis);
    allIssues.push(...titleAnalysis.issues);
  }

  // Analyze end card (frame at midpoint of end card, measured from video end)
  if (endCardDurationSec > 0) {
    const endTimecode = totalDurationSec - (endCardDurationSec / 2);
    if (endTimecode > 0) {
      const endAnalysis = analyzeCard(
        videoPath, "end", endTimecode, tempDir, width, height, minContrastRatio,
      );
      results.push(endAnalysis);
      allIssues.push(...endAnalysis.issues);
    }
  }

  const allPassed = results.length > 0 && results.every((r) => r.passed);

  // Determine WCAG level
  let wcagLevel: "AAA" | "AA" | "below_AA" = "below_AA";
  if (allPassed) {
    const minContrast = Math.min(...results.map((r) => r.contrastRatio));
    if (minContrast >= WCAG_AAA_CONTRAST) {
      wcagLevel = "AAA";
    } else if (minContrast >= WCAG_AA_CONTRAST) {
      wcagLevel = "AA";
    }
  }

  const metrics: CardLegibilityMetrics = {
    titleCard: results.find((r) => r.cardType === "title") || null,
    endCard: results.find((r) => r.cardType === "end") || null,
    overallPassed: allPassed,
    wcagLevel,
  };

  return {
    checkName: "card_legibility_check",
    passed: allPassed,
    details: allPassed
      ? `Card legibility: ${wcagLevel} compliant (contrast ${results.map((r) => `${r.cardType}=${r.contrastRatio.toFixed(1)}:1`).join(", ")})`
      : `Card legibility issues: ${allIssues.join("; ")}`,
    durationMs: Date.now() - start,
    routingHint: allPassed
      ? { target: "none", reason: "Card legibility passed" }
      : { target: "assembly_reencode", reason: `Card legibility failed — re-render title/end cards with adjusted contrast` },
    metrics: metrics as unknown as Record<string, number | string | boolean>,
  };
}
