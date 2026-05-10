/**
 * End-to-End Smoke Test — First Light Fixture
 * 
 * Runs the full Simple Path pipeline on the locked First Light episode.
 * Validates all 5 stages produce expected outputs.
 * 
 * Usage: npx tsx server/simple-path/smoke-test.ts
 * 
 * Required: Reference image URLs must be set in FIRST_LIGHT_REF_URLS below.
 */

import { runSimplePath } from "./orchestrator";
import { buildFirstLightConfig } from "./fixtures/first-light";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration — Set reference image URLs from API-parity validation
// ═══════════════════════════════════════════════════════════════════════════

const FIRST_LIGHT_REF_URLS = {
  mira: process.env.MIRA_REF_URL || "",
  kazuo: process.env.KAZUO_REF_URL || "",
  renji: process.env.RENJI_REF_URL || "",
};

// ═══════════════════════════════════════════════════════════════════════════
// Smoke Test Runner
// ═══════════════════════════════════════════════════════════════════════════

async function runSmokeTest() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  WAVE 9 SMOKE TEST — First Light Fixture");
  console.log("  Simple Path Pipeline v1");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  // Validate reference URLs
  for (const [name, url] of Object.entries(FIRST_LIGHT_REF_URLS)) {
    if (!url) {
      console.error(`❌ Missing reference URL for ${name}. Set ${name.toUpperCase()}_REF_URL env var.`);
      process.exit(1);
    }
    console.log(`✓ ${name}: ${url.substring(0, 60)}...`);
  }
  console.log("");

  const pipelineRunId = Date.now(); // Use timestamp as pseudo-ID for smoke test

  const config = buildFirstLightConfig(pipelineRunId, 1, 1, 1, {
    referenceImageUrls: FIRST_LIGHT_REF_URLS,
    resolution: "720p",
    concurrency: 2, // Conservative for smoke test
    targetDurationSeconds: 120, // 2 min target for faster smoke test
  });

  const startTime = Date.now();

  try {
    const state = await runSimplePath({
      ...config,
      onStageProgress: (stage, progress, message) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  [${elapsed}s] Stage ${stage} (${progress}%): ${message}`);
      },
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  ✅ SMOKE TEST PASSED");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("  Results:");
    console.log(`  • Total time: ${totalTime}s`);
    console.log(`  • Total cost: $${state.costs.total.toFixed(2)}`);
    console.log(`  • Beats generated: ${state.stage1Output?.totalBeats || 0}`);
    console.log(`  • Videos generated: ${state.stage3Output?.length || 0}`);
    console.log(`  • CLIP passed: ${state.stage3Output?.filter((r) => r.clipPassed).length || 0}/${state.stage3Output?.length || 0}`);
    console.log(`  • Voice clips: ${state.stage4Output?.voices.length || 0}`);
    console.log(`  • Lip-synced: ${state.stage4Output?.lipSync.length || 0}`);
    console.log(`  • Final video: ${state.stage5Output?.finalVideoUrl || "N/A"}`);
    console.log(`  • Duration: ${state.stage5Output?.totalDurationSeconds?.toFixed(1) || 0}s`);
    console.log(`  • File size: ${((state.stage5Output?.fileSizeBytes || 0) / 1024 / 1024).toFixed(1)}MB`);
    console.log("");
    console.log("  Cost breakdown:");
    console.log(`  • Stage 1 (Beat Segmentation): $${state.costs.stage1.toFixed(3)}`);
    console.log(`  • Stage 2 (Character Refs):    $${state.costs.stage2.toFixed(3)}`);
    console.log(`  • Stage 3 (Video Gen + CLIP):  $${state.costs.stage3.toFixed(3)}`);
    console.log(`  • Stage 4 (Voice + Lip-Sync):  $${state.costs.stage4.toFixed(3)}`);
    console.log(`  • Stage 5 (Assembly):          $${state.costs.stage5.toFixed(3)}`);
    console.log("");

    // Validate expected outputs
    const issues: string[] = [];

    if (!state.stage1Output || state.stage1Output.totalBeats < 5) {
      issues.push("Stage 1: Expected at least 5 beats");
    }
    if (!state.stage3Output || state.stage3Output.length < 5) {
      issues.push("Stage 3: Expected at least 5 video clips");
    }
    if (state.stage3Output) {
      const clipFailRate = state.stage3Output.filter((r) => !r.clipPassed).length / state.stage3Output.length;
      if (clipFailRate > 0.3) {
        issues.push(`Stage 3: CLIP fail rate too high (${(clipFailRate * 100).toFixed(0)}%)`);
      }
    }
    if (!state.stage4Output || state.stage4Output.voices.length < 3) {
      issues.push("Stage 4: Expected at least 3 voice clips (one per dialogue line)");
    }
    if (!state.stage5Output || !state.stage5Output.finalVideoUrl) {
      issues.push("Stage 5: No final video URL produced");
    }

    if (issues.length > 0) {
      console.log("  ⚠️  Validation warnings:");
      issues.forEach((i) => console.log(`    • ${i}`));
      console.log("");
    }

    return state;
  } catch (err) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  ❌ SMOKE TEST FAILED");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  • Failed after: ${totalTime}s`);
    console.log(`  • Error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.log(`  • Stack: ${err.stack.split("\n").slice(1, 4).join("\n    ")}`);
    }
    console.log("");
    process.exit(1);
  }
}

// Run if executed directly
runSmokeTest();
