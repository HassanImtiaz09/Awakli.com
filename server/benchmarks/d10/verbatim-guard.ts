/**
 * D10 Craft Library — Verbatim Guard
 *
 * Prevents the LLM synthesis from reproducing copyrighted source material verbatim.
 * Uses a sliding-window n-gram approach to detect overlap between the generated
 * guidance and the source chunks that informed it.
 *
 * Default: 15-gram window, max 25% overlap ratio.
 * If triggered, the output is flagged for re-synthesis with stronger paraphrase instructions.
 */

import { DEFAULT_VERBATIM_CONFIG, type VerbatimGuardConfig } from "./types";

/**
 * Normalise text for n-gram comparison:
 * - lowercase
 * - collapse whitespace
 * - strip punctuation
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract all n-grams (word-level) from normalised text.
 */
function extractNgrams(text: string, n: number): Set<string> {
  const words = text.split(" ");
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

export interface VerbatimCheckResult {
  /** Whether the output passed the verbatim guard */
  passed: boolean;
  /** Overlap ratio (0-1) — fraction of output n-grams found in source */
  overlapRatio: number;
  /** Number of overlapping n-grams */
  overlappingNgrams: number;
  /** Total n-grams in the output */
  totalOutputNgrams: number;
  /** The offending n-grams (first 5 for debugging) */
  sampleOverlaps: string[];
}

/**
 * Check whether the generated guidance contains too much verbatim overlap
 * with the source chunks that informed it.
 *
 * @param output - The LLM-generated guidance text
 * @param sourceTexts - Array of source chunk texts used for retrieval
 * @param config - Optional override for n-gram size and max overlap ratio
 */
export function checkVerbatimOverlap(
  output: string,
  sourceTexts: string[],
  config: VerbatimGuardConfig = DEFAULT_VERBATIM_CONFIG,
): VerbatimCheckResult {
  const normOutput = normalise(output);
  const outputNgrams = extractNgrams(normOutput, config.ngramSize);

  if (outputNgrams.size === 0) {
    return {
      passed: true,
      overlapRatio: 0,
      overlappingNgrams: 0,
      totalOutputNgrams: 0,
      sampleOverlaps: [],
    };
  }

  // Build a combined set of all source n-grams
  const sourceNgramSet = new Set<string>();
  for (const src of sourceTexts) {
    const normSrc = normalise(src);
    const srcNgrams = extractNgrams(normSrc, config.ngramSize);
    const srcNgramArr = Array.from(srcNgrams);
    for (let i = 0; i < srcNgramArr.length; i++) {
      sourceNgramSet.add(srcNgramArr[i]);
    }
  }

  // Find overlapping n-grams
  const overlaps: string[] = [];
  const outputNgramArr = Array.from(outputNgrams);
  for (let i = 0; i < outputNgramArr.length; i++) {
    if (sourceNgramSet.has(outputNgramArr[i])) {
      overlaps.push(outputNgramArr[i]);
    }
  }

  const overlapRatio = overlaps.length / outputNgrams.size;

  return {
    passed: overlapRatio <= config.maxOverlapRatio,
    overlapRatio,
    overlappingNgrams: overlaps.length,
    totalOutputNgrams: outputNgrams.size,
    sampleOverlaps: overlaps.slice(0, 5),
  };
}

/**
 * Utility: estimate the n-gram count for a given text at a given n-gram size.
 * Useful for pre-flight checks before running the full guard.
 */
export function estimateNgramCount(text: string, ngramSize: number = 15): number {
  const words = normalise(text).split(" ");
  return Math.max(0, words.length - ngramSize + 1);
}
