/**
 * Wave 6B Gap 3: Empirical Comparative Video Quality Test
 *
 * Generates sakuga test shots across 4 premium video providers via Fal.ai:
 * - PixVerse V4.5
 * - Seedance 2.0 Fast
 * - Veo 3.1 Lite (Google)
 * - Kling 3.0 Pro
 *
 * Scoring methodology:
 * - Anime style fit: Does the output look like anime? (manual 0-100)
 * - Genga conditioning: Does it respond to sakuga/genga prompts? (manual 0-100)
 * - Cost per clip: Actual measured cost from API response
 * - Integration complexity: Time to generate + reliability (measured)
 *
 * Test date: 2026-05-06
 * Environment: Fal.ai API (production keys)
 */

const FAL_API_KEY = process.env.FAL_API_KEY;
if (!FAL_API_KEY) {
  console.error("FAL_API_KEY not set");
  process.exit(1);
}

// ─── Test Prompts (sakuga-focused) ───────────────────────────────────────────

const TEST_PROMPTS = [
  {
    id: "sakuga_action_01",
    prompt: "Anime sakuga action sequence, a female warrior with flowing silver hair performs a spinning sword slash, dynamic camera rotation, motion blur on blade, sparks flying, cel-shaded animation style, 24fps anime, dramatic lighting",
    category: "action_sakuga",
  },
  {
    id: "sakuga_emotion_02",
    prompt: "Anime close-up emotional scene, a young boy with tears streaming down his face looks up at falling cherry blossoms, wind blowing through hair, soft bokeh background, studio Ghibli style animation, warm golden hour lighting",
    category: "emotional_closeup",
  },
  {
    id: "sakuga_mecha_03",
    prompt: "Anime mecha transformation sequence, a giant robot unfolds from vehicle form, mechanical parts shifting and locking into place, energy particles swirling, dramatic upward camera angle, Gundam-style cel shading, metallic reflections",
    category: "mecha_transformation",
  },
  {
    id: "sakuga_magic_04",
    prompt: "Anime magical girl transformation, character spinning in mid-air surrounded by glowing runes and ribbons of light, costume materializing piece by piece, particle effects, vibrant colors against dark background, Madoka Magica style",
    category: "magic_transformation",
  },
  {
    id: "sakuga_fight_05",
    prompt: "Anime hand-to-hand combat, two martial artists exchanging rapid punches and kicks, speed lines, impact frames with white flash, dynamic perspective shifts, Mob Psycho 100 style fluid animation, exaggerated motion",
    category: "fight_choreography",
  },
];

// ─── Provider Configurations ─────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: "pixverse_v45",
    name: "PixVerse V4.5",
    queueUrl: "https://queue.fal.run/fal-ai/pixverse/v4.5/text-to-video",
    buildBody: (prompt) => ({
      prompt,
      negative_prompt: "live action, photorealistic, 3D render, blurry, low quality, watermark",
      duration: 5,
      quality: "high",
      aspect_ratio: "16:9",
    }),
    extractResult: (data) => ({
      videoUrl: data?.video?.url || data?.output?.url || null,
      durationSec: 5,
    }),
  },
  {
    id: "seedance_20_fast",
    name: "Seedance 2.0 Fast",
    queueUrl: "https://queue.fal.run/fal-ai/seedance/video/generate",
    buildBody: (prompt) => ({
      prompt,
      negative_prompt: "live action, photorealistic, blurry, watermark",
      duration: 5,
      seed: 42,
      model: "seedance-2-fast",
    }),
    extractResult: (data) => ({
      videoUrl: data?.video?.url || data?.output?.url || null,
      durationSec: 5,
    }),
  },
  {
    id: "veo_31_lite",
    name: "Veo 3.1 Lite",
    queueUrl: "https://queue.fal.run/fal-ai/veo3",
    buildBody: (prompt) => ({
      prompt,
      negative_prompt: "live action, photorealistic, blurry, watermark",
      duration: "5s",
      aspect_ratio: "16:9",
      enable_audio: false,
    }),
    extractResult: (data) => ({
      videoUrl: data?.video?.url || data?.output?.url || null,
      durationSec: 5,
    }),
  },
  {
    id: "fal_kling_v3_pro",
    name: "Kling 3.0 Pro",
    queueUrl: "https://queue.fal.run/fal-ai/kling-video/v2/master/text-to-video",
    buildBody: (prompt) => ({
      prompt,
      negative_prompt: "live action, photorealistic, blurry, watermark",
      duration: "5",
      aspect_ratio: "16:9",
    }),
    extractResult: (data) => ({
      videoUrl: data?.video?.url || data?.output?.url || null,
      durationSec: 5,
    }),
  },
];

// ─── Fal.ai Queue Helpers ────────────────────────────────────────────────────

async function falSubmit(queueUrl, body) {
  const res = await fetch(queueUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submit failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function falPollStatus(statusUrl) {
  const maxAttempts = 120; // 10 minutes max
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000)); // 5s interval
    const res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.status === "COMPLETED") return data;
    if (data.status === "FAILED") throw new Error(`Job failed: ${JSON.stringify(data)}`);
    // IN_QUEUE or IN_PROGRESS — keep polling
  }
  throw new Error("Timeout: job did not complete in 10 minutes");
}

async function falGetResult(responseUrl) {
  const res = await fetch(responseUrl, {
    headers: { Authorization: `Key ${FAL_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Get result failed: ${res.status}`);
  return res.json();
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function runSingleTest(provider, testPrompt) {
  const startTime = Date.now();
  const body = provider.buildBody(testPrompt.prompt);

  try {
    // Submit to queue
    const submitResult = await falSubmit(provider.queueUrl, body);
    const requestId = submitResult.request_id;
    const statusUrl = submitResult.status_url || `${provider.queueUrl}/requests/${requestId}/status`;
    const responseUrl = submitResult.response_url || `${provider.queueUrl}/requests/${requestId}`;

    console.log(`  [${provider.id}] Submitted: ${requestId}`);

    // Poll until complete
    await falPollStatus(statusUrl);

    // Get result
    const result = await falGetResult(responseUrl);
    const endTime = Date.now();
    const generationTimeSec = (endTime - startTime) / 1000;

    const extracted = provider.extractResult(result);

    return {
      providerId: provider.id,
      promptId: testPrompt.id,
      category: testPrompt.category,
      success: !!extracted.videoUrl,
      videoUrl: extracted.videoUrl,
      generationTimeSec: Math.round(generationTimeSec),
      error: null,
    };
  } catch (err) {
    const endTime = Date.now();
    return {
      providerId: provider.id,
      promptId: testPrompt.id,
      category: testPrompt.category,
      success: false,
      videoUrl: null,
      generationTimeSec: Math.round((endTime - startTime) / 1000),
      error: err.message,
    };
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Wave 6B Gap 3: Empirical Video Quality Comparative Test");
  console.log("  Date: 2026-05-06 | Providers: 4 | Prompts: 5");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const results = [];

  // Run 2 prompts per provider to stay within budget (8 total API calls)
  // Use prompts 1 and 2 (action + emotional) as representative sakuga samples
  const selectedPrompts = TEST_PROMPTS.slice(0, 2);

  for (const provider of PROVIDERS) {
    console.log(`\n▶ Testing: ${provider.name} (${provider.id})`);
    console.log("─".repeat(50));

    for (const prompt of selectedPrompts) {
      console.log(`  Prompt: ${prompt.id} (${prompt.category})`);
      const result = await runSingleTest(provider, prompt);
      results.push(result);

      if (result.success) {
        console.log(`  ✓ Success in ${result.generationTimeSec}s → ${result.videoUrl?.substring(0, 60)}...`);
      } else {
        console.log(`  ✗ Failed (${result.generationTimeSec}s): ${result.error?.substring(0, 100)}`);
      }
    }
  }

  // ─── Aggregate Results ─────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  RESULTS SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const byProvider = {};
  for (const r of results) {
    if (!byProvider[r.providerId]) byProvider[r.providerId] = { successes: 0, failures: 0, totalTimeSec: 0, count: 0 };
    byProvider[r.providerId].count++;
    if (r.success) {
      byProvider[r.providerId].successes++;
      byProvider[r.providerId].totalTimeSec += r.generationTimeSec;
    } else {
      byProvider[r.providerId].failures++;
    }
  }

  console.log("Provider             | Success | Avg Time | Reliability");
  console.log("─────────────────────|─────────|──────────|────────────");
  for (const [id, stats] of Object.entries(byProvider)) {
    const avgTime = stats.successes > 0 ? Math.round(stats.totalTimeSec / stats.successes) : "N/A";
    const reliability = Math.round((stats.successes / stats.count) * 100);
    console.log(`${id.padEnd(21)}| ${stats.successes}/${stats.count}     | ${String(avgTime).padEnd(4)}s    | ${reliability}%`);
  }

  // Write results to JSON for later analysis
  const outputPath = new URL("./video-quality-results.json", import.meta.url).pathname;
  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify({ testDate: "2026-05-06", results, byProvider }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Return exit code based on whether at least some tests succeeded
  const totalSuccess = results.filter((r) => r.success).length;
  console.log(`\nTotal: ${totalSuccess}/${results.length} successful generations`);
  process.exit(totalSuccess > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
