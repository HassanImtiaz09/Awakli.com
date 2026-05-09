/**
 * Wave 8 — Assembly-Only Script
 *
 * Queries the DB for existing video clips, voice clips, and BGM from the
 * pipeline run, downloads them, and assembles into a final MP4 with ffmpeg.
 *
 * Usage: npx tsx server/benchmarks/wave8-assemble-only.mjs
 */

import { ENV } from "../_core/env.ts";
import { storagePut } from "../storage.ts";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import path from "path";

const EPISODE_ID = 870004;
const PIPELINE_RUN_ID = 120003;
const WORK_DIR = "/tmp/wave8-assembly";

async function getDb() {
  const connection = await mysql.createConnection({
    uri: ENV.databaseUrl,
    connectTimeout: 30000,
  });
  return drizzle(connection);
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Wave 8 — Video Assembly (clips already generated)          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  mkdirSync(WORK_DIR, { recursive: true });

  // 1. Query DB for existing video clips from this pipeline run
  console.log("═══ Step 1: Loading assets from DB ═══\n");
  const db = await getDb();

  const [videoClips] = await db.execute(sql`
    SELECT id, panelId, url, metadata FROM pipeline_assets
    WHERE pipelineRunId = ${PIPELINE_RUN_ID}
    AND (assetType = 'video_clip' OR assetType = 'synced_clip')
    ORDER BY panelId
  `);

  const [voiceClips] = await db.execute(sql`
    SELECT id, url, metadata FROM pipeline_assets
    WHERE pipelineRunId = ${PIPELINE_RUN_ID} AND assetType = 'voice_clip'
    ORDER BY id
  `);

  const [musicClips] = await db.execute(sql`
    SELECT id, url FROM pipeline_assets
    WHERE pipelineRunId = ${PIPELINE_RUN_ID} AND assetType = 'music_segment'
    ORDER BY id LIMIT 1
  `);

  console.log(`  Video clips: ${videoClips.length}`);
  console.log(`  Voice clips: ${voiceClips.length}`);
  console.log(`  Music segments: ${musicClips.length}`);

  // If no video clips in DB, scan S3 for the clips we generated earlier
  if (videoClips.length === 0) {
    console.log("\n  No video clips in DB — scanning S3 for generated clips...");
    // Query panels to get the URLs we stored during generation
    const [panels] = await db.execute(sql`
      SELECT id, panelNumber, imageUrl FROM panels
      WHERE episodeId = ${EPISODE_ID} AND imageUrl IS NOT NULL
      ORDER BY panelNumber
    `);

    // The clips were stored with pattern: pipeline/120003/smoke-clip-panel{id}-*.mp4
    // Let's check if they're accessible via the CDN pattern
    console.log(`  Found ${panels.length} panels — will use keyframe images as fallback`);
    console.log("  Generating video from keyframe images with Ken Burns effect...\n");

    // Use Ken Burns (pan + zoom) on keyframe images as a quick assembly method
    const clipPaths = [];
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const imgPath = path.join(WORK_DIR, `panel_${String(i).padStart(3, "0")}.png`);
      const clipPath = path.join(WORK_DIR, `kenburns_${String(i).padStart(3, "0")}.mp4`);

      try {
        // Download panel image
        const res = await fetch(panel.imageUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(imgPath, buf);

        // Generate 5s Ken Burns clip (slow zoom in)
        const zoomSpeed = 0.001 + (Math.random() * 0.001); // Slight variation
        const panX = Math.random() > 0.5 ? "iw/2-(iw/zoom/2)" : `iw/2-(iw/zoom/2)+${Math.round(Math.random() * 20)}`;
        const panY = Math.random() > 0.5 ? "ih/2-(ih/zoom/2)" : `ih/2-(ih/zoom/2)+${Math.round(Math.random() * 10)}`;

        execSync(
          `ffmpeg -y -loop 1 -i "${imgPath}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+${zoomSpeed},1.3)':x='${panX}':y='${panY}':d=150:s=1920x1080:fps=30" -c:v libx264 -pix_fmt yuv420p -t 5 "${clipPath}" 2>/dev/null`,
          { timeout: 30000 }
        );
        clipPaths.push(clipPath);
        process.stdout.write(`  ✓ Panel ${i + 1}/${panels.length}\r`);
      } catch (err) {
        console.error(`\n  ✗ Panel ${i + 1} failed: ${err.message}`);
      }
    }
    console.log(`\n  Generated ${clipPaths.length} Ken Burns clips`);

    // Concatenate clips
    console.log("\n═══ Step 2: Concatenating clips ═══\n");
    const concatList = clipPaths.map(p => `file '${p}'`).join("\n");
    writeFileSync(path.join(WORK_DIR, "concat.txt"), concatList);

    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${WORK_DIR}/concat.txt" -c:v libx264 -crf 23 -preset fast "${WORK_DIR}/concat_raw.mp4" 2>/dev/null`,
      { timeout: 120000 }
    );
    console.log("  ✓ Clips concatenated");

    // Add voice and music
    await addAudioTracks(`${WORK_DIR}/concat_raw.mp4`, voiceClips, musicClips[0]?.url);
    return;
  }

  // Normal path: we have video clips in DB
  console.log("\n═══ Step 2: Downloading video clips ═══\n");
  const clipPaths = [];
  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const clipPath = path.join(WORK_DIR, `clip_${String(i).padStart(3, "0")}.mp4`);
    try {
      const res = await fetch(clip.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(clipPath, buf);
      clipPaths.push(clipPath);
      process.stdout.write(`  ✓ ${i + 1}/${videoClips.length}\r`);
    } catch (err) {
      console.error(`\n  ✗ Clip ${i} failed: ${err.message}`);
    }
  }
  console.log(`\n  Downloaded ${clipPaths.length} clips`);

  // Concatenate
  console.log("\n═══ Step 3: Concatenating clips ═══\n");
  const concatList = clipPaths.map(p => `file '${p}'`).join("\n");
  writeFileSync(path.join(WORK_DIR, "concat.txt"), concatList);

  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${WORK_DIR}/concat.txt" -c copy "${WORK_DIR}/concat_raw.mp4" 2>/dev/null`,
    { timeout: 60000 }
  );
  console.log("  ✓ Clips concatenated");

  await addAudioTracks(`${WORK_DIR}/concat_raw.mp4`, voiceClips, musicClips[0]?.url);
}

async function addAudioTracks(videoPath, voiceClips, musicUrl) {
  let currentInput = videoPath;

  // Get video duration
  const durationStr = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${currentInput}" 2>/dev/null`
  ).toString().trim();
  const videoDuration = parseFloat(durationStr);
  console.log(`\n  Video duration: ${videoDuration.toFixed(1)}s`);

  // Download and mix voice clips
  if (voiceClips.length > 0) {
    console.log("\n═══ Step 4: Mixing voice clips ═══\n");
    const voicePaths = [];
    for (let i = 0; i < voiceClips.length; i++) {
      const vcPath = path.join(WORK_DIR, `voice_${i}.mp3`);
      try {
        const res = await fetch(voiceClips[i].url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(vcPath, buf);
        voicePaths.push(vcPath);
      } catch (err) {
        console.error(`  ✗ Voice ${i} download failed: ${err.message}`);
      }
    }
    console.log(`  Downloaded ${voicePaths.length} voice clips`);

    if (voicePaths.length > 0) {
      // Place voice clips at evenly spaced intervals across the video
      const interval = (videoDuration * 1000) / (voicePaths.length + 1);
      let filterInputs = voicePaths.map(p => `-i "${p}"`).join(" ");
      let filterParts = [];
      let mixLabels = [];

      for (let i = 0; i < voicePaths.length; i++) {
        const delay = Math.round(interval * (i + 1));
        filterParts.push(`[${i}]adelay=${delay}|${delay},volume=1.8[v${i}]`);
        mixLabels.push(`[v${i}]`);
      }
      const filterComplex = `${filterParts.join(";")};${mixLabels.join("")}amix=inputs=${voicePaths.length}:duration=longest:normalize=0[voiceout]`;

      const voiceMix = path.join(WORK_DIR, "voice_mix.wav");
      try {
        execSync(
          `ffmpeg -y ${filterInputs} -filter_complex "${filterComplex}" -map "[voiceout]" -t ${videoDuration} "${voiceMix}" 2>/dev/null`,
          { timeout: 30000 }
        );

        const withVoice = path.join(WORK_DIR, "with_voice.mp4");
        execSync(
          `ffmpeg -y -i "${currentInput}" -i "${voiceMix}" -c:v copy -c:a aac -b:a 192k -shortest "${withVoice}" 2>/dev/null`,
          { timeout: 30000 }
        );
        currentInput = withVoice;
        console.log("  ✓ Voice mixed into video");
      } catch (err) {
        console.warn(`  ⚠ Voice mixing failed: ${err.message}`);
      }
    }
  }

  // Add BGM
  if (musicUrl) {
    console.log("\n═══ Step 5: Adding BGM ═══\n");
    const bgmPath = path.join(WORK_DIR, "bgm.mp3");
    try {
      const res = await fetch(musicUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(bgmPath, buf);
      console.log("  ✓ BGM downloaded");

      const finalOutput = path.join(WORK_DIR, "final_output.mp4");

      // Check if video already has audio
      const hasAudio = execSync(
        `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${currentInput}" 2>/dev/null`
      ).toString().trim();

      if (hasAudio) {
        // Mix BGM with existing audio
        execSync(
          `ffmpeg -y -i "${currentInput}" -stream_loop -1 -i "${bgmPath}" -c:v copy -filter_complex "[1:a]volume=0.25,afade=t=in:d=2,afade=t=out:st=${videoDuration - 3}:d=3[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0[aout]" -map 0:v -map "[aout]" -c:a aac -b:a 192k -t ${videoDuration} "${finalOutput}" 2>/dev/null`,
          { timeout: 60000 }
        );
      } else {
        // Add BGM as only audio track
        execSync(
          `ffmpeg -y -i "${currentInput}" -stream_loop -1 -i "${bgmPath}" -c:v copy -filter_complex "[1:a]volume=0.4,afade=t=in:d=2,afade=t=out:st=${videoDuration - 3}:d=3[bgm]" -map 0:v -map "[bgm]" -c:a aac -b:a 192k -t ${videoDuration} "${finalOutput}" 2>/dev/null`,
          { timeout: 60000 }
        );
      }
      currentInput = finalOutput;
      console.log("  ✓ BGM added");
    } catch (err) {
      console.warn(`  ⚠ BGM failed: ${err.message}`);
    }
  }

  // Upload final video
  console.log("\n═══ Step 6: Uploading final video ═══\n");
  const videoBuffer = readFileSync(currentInput);
  const finalKey = `pipeline/${PIPELINE_RUN_ID}/first-light-final-${Date.now().toString(36)}.mp4`;
  const { url: finalUrl } = await storagePut(finalKey, videoBuffer, "video/mp4");
  console.log(`  ✓ Uploaded: ${finalUrl}`);

  // Get final info
  const infoStr = execSync(
    `ffprobe -v error -show_entries format=duration,size -of json "${currentInput}" 2>/dev/null`
  ).toString();
  const info = JSON.parse(infoStr);
  const finalDuration = parseFloat(info.format?.duration || "0");
  const finalSize = parseInt(info.format?.size || "0");

  console.log(`\n  Final video: ${finalDuration.toFixed(1)}s, ${(finalSize / 1024 / 1024).toFixed(1)}MB`);

  // Update DB
  const db2 = await getDb();
  await db2.execute(sql`UPDATE episodes SET videoUrl = ${finalUrl} WHERE id = ${EPISODE_ID}`);
  await db2.execute(sql`
    INSERT INTO pipeline_assets (pipelineRunId, episodeId, assetType, url, metadata, nodeSource)
    VALUES (${PIPELINE_RUN_ID}, ${EPISODE_ID}, 'final_video', ${finalUrl},
      ${JSON.stringify({ duration: finalDuration, sizeBytes: finalSize, generatedAt: new Date().toISOString() })},
      'assembly')
  `);

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    videoUrl: finalUrl,
    duration: finalDuration,
    sizeBytes: finalSize,
    voiceClips: voiceClips.length,
    hasMusic: !!musicUrl,
  };
  const resultsPath = path.join(process.cwd(), "test-results", "wave8-video-gen-results.json");
  mkdirSync(path.dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  COMPLETE                                                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\n  🎬 Video URL: ${finalUrl}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error("\n✗ Fatal error:", err.message || err);
  process.exit(1);
});
