/**
 * Wave 8 — Video Generation & Assembly Script
 *
 * Takes the 21 panel keyframe images from the smoke test episode,
 * generates 5-second video clips via fal.ai (Kling V3 Standard),
 * then assembles them with existing voice clips + BGM into a final MP4.
 *
 * Usage: npx tsx server/benchmarks/wave8-video-gen.mjs
 */

import { fal } from "@fal-ai/client";
import { ENV } from "../_core/env.ts";
import { storagePut } from "../storage.ts";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import { execSync, spawnSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import path from "path";

// ─── Configuration ──────────────────────────────────────────────────────────
const EPISODE_ID = 870004;
const PIPELINE_RUN_ID = 120003;
const CONCURRENCY = 3; // Generate 3 clips at a time to avoid rate limits
const CLIP_DURATION = "5"; // 5 seconds per clip (faster, cheaper for smoke test)
const MODE = "standard"; // Use standard mode for cost efficiency

// ─── Database Connection ────────────────────────────────────────────────────
let db;
async function getDb() {
  if (db) return db;
  const connection = await mysql.createConnection(ENV.databaseUrl);
  db = drizzle(connection);
  return db;
}

// ─── fal.ai Configuration ───────────────────────────────────────────────────
function configureFal() {
  if (!ENV.falApiKey) throw new Error("FAL_API_KEY not set");
  fal.config({ credentials: ENV.falApiKey });
}

// ─── Generate a single video clip from a panel image ────────────────────────
async function generateClip(panel, index, total) {
  const endpoint = MODE === "pro"
    ? "fal-ai/kling-video/v3/pro/image-to-video"
    : "fal-ai/kling-video/v3/standard/image-to-video";

  const prompt = panel.visualDescription
    ? `Anime scene: ${panel.visualDescription.slice(0, 200)}. Smooth animation, cinematic motion.`
    : "Anime scene with smooth character animation and cinematic camera movement.";

  console.log(`  [${index + 1}/${total}] Panel ${panel.panelNumber}: Generating ${CLIP_DURATION}s clip...`);
  const startTime = Date.now();

  try {
    const result = await fal.subscribe(endpoint, {
      input: {
        prompt,
        start_image_url: panel.imageUrl,
        duration: CLIP_DURATION,
        generate_audio: false,
      },
      logs: false,
      pollInterval: 5000,
    });

    const video = result.data?.video;
    if (!video?.url) {
      throw new Error("No video URL in fal.ai response");
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`    → Generated in ${elapsed}s (${video.file_size ? (video.file_size / 1024 / 1024).toFixed(1) + "MB" : "?"})`);

    // Download video and upload to S3
    const videoRes = await fetch(video.url);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoKey = `pipeline/${PIPELINE_RUN_ID}/smoke-clip-panel${panel.id}-${Date.now().toString(36)}.mp4`;
    const { url: storedUrl } = await storagePut(videoKey, videoBuffer, "video/mp4");

    return {
      panelId: panel.id,
      panelNumber: panel.panelNumber,
      url: storedUrl,
      duration: parseInt(CLIP_DURATION),
      fileSize: videoBuffer.length,
      success: true,
    };
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`    ✗ Failed after ${elapsed}s: ${err.message}`);
    return {
      panelId: panel.id,
      panelNumber: panel.panelNumber,
      url: null,
      duration: 0,
      error: err.message,
      success: false,
    };
  }
}

// ─── Process panels in batches ──────────────────────────────────────────────
async function generateAllClips(panels) {
  const results = [];
  for (let i = 0; i < panels.length; i += CONCURRENCY) {
    const batch = panels.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((panel, batchIdx) => generateClip(panel, i + batchIdx, panels.length))
    );
    results.push(...batchResults);

    // Brief pause between batches to avoid rate limiting
    if (i + CONCURRENCY < panels.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return results;
}

// ─── Assemble video with ffmpeg ─────────────────────────────────────────────
async function assembleVideo(clips, voiceClips, musicUrl) {
  const workDir = "/tmp/wave8-assembly";
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

  // Download all video clips
  console.log("\n  Downloading video clips...");
  const clipPaths = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!clip.success || !clip.url) continue;
    const clipPath = path.join(workDir, `clip_${String(i).padStart(3, "0")}.mp4`);
    try {
      const res = await fetch(clip.url);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(clipPath, buf);
      clipPaths.push(clipPath);
      process.stdout.write(`    ✓ clip ${i + 1}/${clips.length}\r`);
    } catch (err) {
      console.error(`    ✗ Failed to download clip ${i}: ${err.message}`);
    }
  }
  console.log(`\n    Downloaded ${clipPaths.length} clips`);

  if (clipPaths.length === 0) {
    throw new Error("No video clips available for assembly");
  }

  // Download voice clips
  console.log("  Downloading voice clips...");
  const voicePaths = [];
  for (let i = 0; i < voiceClips.length; i++) {
    const vc = voiceClips[i];
    const vcPath = path.join(workDir, `voice_${String(i).padStart(3, "0")}.mp3`);
    try {
      const res = await fetch(vc.url);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(vcPath, buf);
      voicePaths.push(vcPath);
    } catch (err) {
      console.error(`    ✗ Failed to download voice ${i}: ${err.message}`);
    }
  }
  console.log(`    Downloaded ${voicePaths.length} voice clips`);

  // Download BGM
  let bgmPath = null;
  if (musicUrl) {
    console.log("  Downloading BGM...");
    try {
      const res = await fetch(musicUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      bgmPath = path.join(workDir, "bgm.mp3");
      writeFileSync(bgmPath, buf);
      console.log("    ✓ BGM downloaded");
    } catch (err) {
      console.error(`    ✗ BGM download failed: ${err.message}`);
    }
  }

  // Step 1: Concatenate all video clips
  console.log("  Concatenating video clips...");
  const concatList = clipPaths.map(p => `file '${p}'`).join("\n");
  const concatFile = path.join(workDir, "concat.txt");
  writeFileSync(concatFile, concatList);

  const concatOutput = path.join(workDir, "concat_raw.mp4");
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${concatOutput}" 2>/dev/null`,
    { timeout: 60000 }
  );
  console.log("    ✓ Video concatenated");

  // Step 2: Mix in voice clips (overlay at intervals)
  let currentInput = concatOutput;

  if (voicePaths.length > 0) {
    console.log("  Mixing voice clips...");
    // Create a voice mix that places voices at intervals matching clip positions
    const voiceMixOutput = path.join(workDir, "voice_mix.mp3");
    const clipDuration = parseInt(CLIP_DURATION);

    // Build ffmpeg filter to place voice clips at correct timestamps
    let filterInputs = voicePaths.map((_, i) => `-i "${voicePaths[i]}"`).join(" ");
    let filterComplex = "";
    let mixInputs = "";

    // Place each voice clip at the start of its corresponding panel's time slot
    // Voice clips correspond to panels with dialogue (not all panels have voice)
    for (let i = 0; i < voicePaths.length; i++) {
      const delay = i * clipDuration * 1000 * 2.5; // Spread voices across the video
      filterComplex += `[${i}]adelay=${Math.round(delay)}|${Math.round(delay)},volume=1.5[v${i}];`;
      mixInputs += `[v${i}]`;
    }
    filterComplex += `${mixInputs}amix=inputs=${voicePaths.length}:duration=longest:normalize=0[voiceout]`;

    try {
      execSync(
        `ffmpeg -y ${filterInputs} -filter_complex "${filterComplex}" -map "[voiceout]" "${voiceMixOutput}" 2>/dev/null`,
        { timeout: 30000 }
      );

      // Merge voice mix with video
      const withVoice = path.join(workDir, "with_voice.mp4");
      execSync(
        `ffmpeg -y -i "${currentInput}" -i "${voiceMixOutput}" -c:v copy -c:a aac -shortest "${withVoice}" 2>/dev/null`,
        { timeout: 30000 }
      );
      currentInput = withVoice;
      console.log("    ✓ Voice mixed");
    } catch (err) {
      console.warn(`    ⚠ Voice mixing failed (${err.message}), continuing without voice`);
    }
  }

  // Step 3: Add BGM (lower volume, loop to match video length)
  if (bgmPath) {
    console.log("  Adding BGM...");
    const finalOutput = path.join(workDir, "final_output.mp4");
    try {
      // Get video duration
      const durationStr = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${currentInput}" 2>/dev/null`
      ).toString().trim();
      const videoDuration = parseFloat(durationStr);

      execSync(
        `ffmpeg -y -i "${currentInput}" -stream_loop -1 -i "${bgmPath}" -c:v copy -filter_complex "[1:a]volume=0.3,afade=t=out:st=${videoDuration - 3}:d=3[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0[aout]" -map 0:v -map "[aout]" -c:a aac -t ${videoDuration} "${finalOutput}" 2>/dev/null`,
        { timeout: 60000 }
      );
      currentInput = finalOutput;
      console.log("    ✓ BGM added");
    } catch (err) {
      // If video has no audio track, just add BGM directly
      try {
        const finalOutput2 = path.join(workDir, "final_with_bgm.mp4");
        const durationStr = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${currentInput}" 2>/dev/null`
        ).toString().trim();
        const videoDuration = parseFloat(durationStr);

        execSync(
          `ffmpeg -y -i "${currentInput}" -stream_loop -1 -i "${bgmPath}" -c:v copy -filter_complex "[1:a]volume=0.4,afade=t=out:st=${videoDuration - 3}:d=3[bgm]" -map 0:v -map "[bgm]" -c:a aac -t ${videoDuration} "${finalOutput2}" 2>/dev/null`,
          { timeout: 60000 }
        );
        currentInput = finalOutput2;
        console.log("    ✓ BGM added (no existing audio track)");
      } catch (err2) {
        console.warn(`    ⚠ BGM mixing failed (${err2.message}), continuing without BGM`);
      }
    }
  }

  // Get final video info
  const finalInfo = execSync(
    `ffprobe -v error -show_entries format=duration,size -of json "${currentInput}" 2>/dev/null`
  ).toString();
  const info = JSON.parse(finalInfo);

  return {
    path: currentInput,
    duration: parseFloat(info.format?.duration || "0"),
    sizeBytes: parseInt(info.format?.size || "0"),
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Wave 8 — Video Generation & Assembly                       ║");
  console.log("║  First Light Episode: 21 panels → video clips → final MP4   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  configureFal();
  const database = await getDb();
  const startTime = Date.now();

  // 1. Get all panels with images
  console.log("═══ Step 1: Loading panels ═══\n");
  const [panels] = await database.execute(sql`
    SELECT id, panelNumber, imageUrl, visualDescription
    FROM panels
    WHERE episodeId = ${EPISODE_ID} AND imageUrl IS NOT NULL
    ORDER BY panelNumber
  `);
  console.log(`  Found ${panels.length} panels with keyframe images\n`);

  // 2. Generate video clips
  console.log("═══ Step 2: Generating video clips via fal.ai ═══\n");
  console.log(`  Mode: ${MODE} | Duration: ${CLIP_DURATION}s | Concurrency: ${CONCURRENCY}\n`);
  const clipResults = await generateAllClips(panels);

  const successClips = clipResults.filter(c => c.success);
  const failedClips = clipResults.filter(c => !c.success);
  console.log(`\n  Results: ${successClips.length} succeeded, ${failedClips.length} failed`);
  if (failedClips.length > 0) {
    console.log(`  Failed panels: ${failedClips.map(c => c.panelNumber).join(", ")}`);
  }

  // 3. Get existing voice clips and BGM
  console.log("\n═══ Step 3: Loading existing audio assets ═══\n");
  const [voiceAssets] = await database.execute(sql`
    SELECT url FROM pipeline_assets
    WHERE pipelineRunId = ${PIPELINE_RUN_ID} AND assetType = 'voice_clip'
    ORDER BY id
  `);
  const [musicAssets] = await database.execute(sql`
    SELECT url FROM pipeline_assets
    WHERE pipelineRunId = ${PIPELINE_RUN_ID} AND assetType = 'music_segment'
    ORDER BY id LIMIT 1
  `);
  console.log(`  Voice clips: ${voiceAssets.length}`);
  console.log(`  Music segments: ${musicAssets.length}`);

  // 4. Assemble final video
  console.log("\n═══ Step 4: Assembling final video ═══\n");
  const assemblyResult = await assembleVideo(
    successClips,
    voiceAssets,
    musicAssets[0]?.url || null
  );

  console.log(`\n  Final video: ${assemblyResult.duration.toFixed(1)}s, ${(assemblyResult.sizeBytes / 1024 / 1024).toFixed(1)}MB`);

  // 5. Upload to S3
  console.log("\n═══ Step 5: Uploading final video to S3 ═══\n");
  const { readFileSync } = await import("fs");
  const videoBuffer = readFileSync(assemblyResult.path);
  const finalKey = `pipeline/${PIPELINE_RUN_ID}/first-light-assembled-${Date.now().toString(36)}.mp4`;
  const { url: finalUrl } = await storagePut(finalKey, videoBuffer, "video/mp4");
  console.log(`  ✓ Uploaded: ${finalUrl}`);

  // 6. Update episode with video URL
  await database.execute(sql`
    UPDATE episodes SET videoUrl = ${finalUrl} WHERE id = ${EPISODE_ID}
  `);

  // 7. Store as pipeline asset
  await database.execute(sql`
    INSERT INTO pipeline_assets (pipelineRunId, episodeId, assetType, url, metadata, nodeSource)
    VALUES (${PIPELINE_RUN_ID}, ${EPISODE_ID}, 'final_video', ${finalUrl},
      ${JSON.stringify({
        duration: assemblyResult.duration,
        sizeBytes: assemblyResult.sizeBytes,
        clipCount: successClips.length,
        voiceClipCount: voiceAssets.length,
        hasMusic: musicAssets.length > 0,
        generatedAt: new Date().toISOString(),
      })},
      'assembly')
  `);

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const estimatedCost = successClips.length * 5 * 0.084; // $0.084/s standard

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  COMPLETE                                                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\n  Duration: ${totalTime} minutes`);
  console.log(`  Clips generated: ${successClips.length}/${panels.length}`);
  console.log(`  Final video: ${assemblyResult.duration.toFixed(1)}s`);
  console.log(`  Estimated cost: $${estimatedCost.toFixed(2)}`);
  console.log(`\n  🎬 Video URL: ${finalUrl}\n`);

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    episodeId: EPISODE_ID,
    pipelineRunId: PIPELINE_RUN_ID,
    videoUrl: finalUrl,
    duration: assemblyResult.duration,
    sizeBytes: assemblyResult.sizeBytes,
    clipsGenerated: successClips.length,
    clipsFailed: failedClips.length,
    totalPanels: panels.length,
    voiceClips: voiceAssets.length,
    hasMusic: musicAssets.length > 0,
    estimatedCostUsd: estimatedCost,
    totalTimeMinutes: parseFloat(totalTime),
    failedPanels: failedClips.map(c => ({ panelNumber: c.panelNumber, error: c.error })),
  };

  const resultsPath = path.join(process.cwd(), "test-results", "wave8-video-gen-results.json");
  mkdirSync(path.dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`  Results saved to: ${resultsPath}`);

  process.exit(0);
}

main().catch(err => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
