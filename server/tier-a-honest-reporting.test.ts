/**
 * Tier A — Honest Failure Reporting Tests
 *
 * Validates the 3 P0 bug fixes:
 * 1. Assembly error swallow → now re-throws (Surface #1)
 * 2. Video gen asset validation → throws on 0 clips (Surface #2)
 * 3. Coherence scoring methodology → CLIP ViT-B/32 replaces LLM (Surface #3)
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ─── Fix #1: Assembly error re-throw ────────────────────────────────────────

describe("Surface #1: Assembly error re-throw", () => {
  it("pipelineOrchestrator.ts has throw after assembly catch block", () => {
    const orchestratorPath = resolve(__dirname, "pipelineOrchestrator.ts");
    const source = readFileSync(orchestratorPath, "utf-8");

    // Find the assembly catch block pattern
    const assemblyFailedPattern = /pipelineLog\.error\("\[Pipeline\] Assembly failed:"/;
    expect(source).toMatch(assemblyFailedPattern);

    // The throw statement must follow the error log
    const lines = source.split("\n");
    let foundLog = false;
    let foundThrow = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('[Pipeline] Assembly failed:')) {
        foundLog = true;
      }
      if (foundLog && !foundThrow && lines[i].includes("throw err;")) {
        foundThrow = true;
        break;
      }
      // If we hit another function or a different catch, reset
      if (foundLog && !foundThrow && i > 0 && lines[i].match(/^\s*\} catch/)) {
        break;
      }
    }

    expect(foundLog).toBe(true);
    expect(foundThrow).toBe(true);
  });

  it("assembly catch block does NOT silently swallow errors", () => {
    const orchestratorPath = resolve(__dirname, "pipelineOrchestrator.ts");
    const source = readFileSync(orchestratorPath, "utf-8");

    // Extract the assembly catch block (multi-line, includes throw)
    const catchBlockRegex = /\} catch \(err\) \{\s*\n\s*pipelineLog\.error\("\[Pipeline\] Assembly failed:"[\s\S]*?throw err;/;
    const match = source.match(catchBlockRegex);
    expect(match).not.toBeNull();

    // The catch block must contain "throw err"
    expect(match![0]).toContain("throw err");
  });
});

// ─── Fix #2: Video gen asset validation ─────────────────────────────────────

describe("Surface #2: Video gen asset validation", () => {
  it("pipelineOrchestrator.ts validates video clip count after batch polling", () => {
    const orchestratorPath = resolve(__dirname, "pipelineOrchestrator.ts");
    const source = readFileSync(orchestratorPath, "utf-8");

    // Must contain the validation check
    expect(source).toContain("Video generation produced 0 clips");
    expect(source).toContain("Pipeline cannot proceed to assembly");
  });

  it("validation throws Error when videoClipCount === 0 and panels > 0", () => {
    const orchestratorPath = resolve(__dirname, "pipelineOrchestrator.ts");
    const source = readFileSync(orchestratorPath, "utf-8");

    // The validation pattern: if count === 0 && panels > 0, throw
    const validationPattern = /if \(videoClipCount === 0 && panelsToProcess\.length > 0\)/;
    expect(source).toMatch(validationPattern);

    // Must throw an Error (not just log)
    const lines = source.split("\n");
    let foundIf = false;
    let foundThrow = false;
    for (const line of lines) {
      if (line.match(validationPattern)) {
        foundIf = true;
      }
      if (foundIf && line.includes("throw new Error(")) {
        foundThrow = true;
        break;
      }
      if (foundIf && line.trim() === "}") {
        break;
      }
    }
    expect(foundThrow).toBe(true);
  });

  it("validation logs clip count after successful generation", () => {
    const orchestratorPath = resolve(__dirname, "pipelineOrchestrator.ts");
    const source = readFileSync(orchestratorPath, "utf-8");

    expect(source).toContain("Video gen validation:");
    expect(source).toContain("clips stored");
  });
});

// ─── Fix #3: CLIP scoring methodology ──────────────────────────────────────

describe("Surface #3: CLIP scoring replaces LLM self-assessment", () => {
  it("smoke test runner no longer uses LLM scoring", () => {
    const runnerPath = resolve(__dirname, "benchmarks/wave8-smoke-test-runner.mjs");
    const source = readFileSync(runnerPath, "utf-8");

    // Must NOT contain the old LLM scoring function call
    expect(source).not.toContain("scorePanelCoherence(b64,");
    expect(source).not.toContain("costs.llmScoring");

    // Must NOT contain the old 0.70 threshold as active code
    // (comments about removal are OK)
    const activeThresholdLines = source.split("\n").filter(
      (line) => line.includes("threshold = 0.70") && !line.trim().startsWith("//")
    );
    expect(activeThresholdLines).toHaveLength(0);
  });

  it("smoke test runner uses CLIP ViT-B/32 scoring", () => {
    const runnerPath = resolve(__dirname, "benchmarks/wave8-smoke-test-runner.mjs");
    const source = readFileSync(runnerPath, "utf-8");

    // Must contain CLIP-related code
    expect(source).toContain("runClipConsistencyScoring");
    expect(source).toContain("CLIP ViT-B/32");
    expect(source).toContain("clip-scoring.py");
    expect(source).toContain("meanMaxSimilarity");
  });

  it("smoke test runner uses 0.75 threshold (not 0.70)", () => {
    const runnerPath = resolve(__dirname, "benchmarks/wave8-smoke-test-runner.mjs");
    const source = readFileSync(runnerPath, "utf-8");

    // The active threshold must be 0.75
    expect(source).toContain("threshold = 0.75");
    expect(source).toContain("≥0.75 mean max-sim");
  });

  it("smoke test runner logs HARD TEST FAILURE when below threshold", () => {
    const runnerPath = resolve(__dirname, "benchmarks/wave8-smoke-test-runner.mjs");
    const source = readFileSync(runnerPath, "utf-8");

    expect(source).toContain("HARD TEST FAILURE");
    expect(source).toContain("< ${threshold} threshold");
  });

  it("CLIP scoring Python script exists and has correct model", () => {
    const clipScriptPath = resolve(__dirname, "../wave8-artifacts/clip-scoring.py");
    expect(existsSync(clipScriptPath)).toBe(true);

    const source = readFileSync(clipScriptPath, "utf-8");
    expect(source).toContain("openai/clip-vit-base-patch32");
    expect(source).toContain("cosine_similarity");
    expect(source).toContain("meanMaxSimilarity");
  });

  it("costs object uses clipScoring instead of llmScoring", () => {
    const runnerPath = resolve(__dirname, "benchmarks/wave8-smoke-test-runner.mjs");
    const source = readFileSync(runnerPath, "utf-8");

    expect(source).toContain("clipScoring: 0");
    expect(source).not.toContain("llmScoring: 0");
  });
});
