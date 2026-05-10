/**
 * Stage 5: Audio Mastering + Assembly
 * 
 * 1. Generate background music (MiniMax or fallback)
 * 2. Mix 4-bus audio: voice + music + SFX + ambient
 * 3. FFmpeg assembly: concat all beat clips with transitions
 * 4. Final validation: file size, format, duration, audio levels
 * 5. Upload final video to S3/CDN
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { storagePut } from "../../storage";
import type {
  Beat,
  VoiceGenerationResult,
  LipSyncResult,
  AssemblyResult,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// Working Directory Management
// ═══════════════════════════════════════════════════════════════════════════

function getWorkDir(pipelineRunId: number): string {
  const dir = join("/tmp", `simple-path-assembly-${pipelineRunId}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(workDir: string): void {
  try {
    execSync(`rm -rf "${workDir}"`, { stdio: "ignore" });
  } catch { /* ignore cleanup errors */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Download Helper
// ═══════════════════════════════════════════════════════════════════════════

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url} (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destPath, buffer);
}

// ═══════════════════════════════════════════════════════════════════════════
// Audio Normalization
// ═══════════════════════════════════════════════════════════════════════════

function normalizeAudio(inputPath: string, outputPath: string, targetLufs: number): void {
  // Two-pass loudness normalization
  execSync(
    `ffmpeg -y -i "${inputPath}" -af loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json -f null /dev/null 2>&1 | grep -A20 "Parsed_loudnorm" > /dev/null || true`,
    { stdio: "ignore" }
  );
  execSync(
    `ffmpeg -y -i "${inputPath}" -af "loudnorm=I=${targetLufs}:TP=-1.5:LRA=11" "${outputPath}"`,
    { stdio: "ignore" }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Music Generation (Placeholder — uses existing music or silence)
// ═══════════════════════════════════════════════════════════════════════════

export interface MusicGenInput {
  totalDurationSeconds: number;
  mood: string;
  genre?: string;
  /** Existing music URL to use (skip generation) */
  existingMusicUrl?: string;
}

export async function generateOrFetchMusic(input: MusicGenInput, workDir: string): Promise<string> {
  const musicPath = join(workDir, "background_music.mp3");

  if (input.existingMusicUrl) {
    await downloadFile(input.existingMusicUrl, musicPath);
    return musicPath;
  }

  // Generate silence as placeholder if no music available
  // Production: integrate MiniMax or Suno
  const duration = Math.ceil(input.totalDurationSeconds);
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${duration} -q:a 9 "${musicPath}"`,
    { stdio: "ignore" }
  );

  return musicPath;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4-Bus Audio Mix
// ═══════════════════════════════════════════════════════════════════════════

export interface AudioMixInput {
  /** Voice clips with their beat timing */
  voiceClips: Array<{ path: string; startSeconds: number; durationSeconds: number }>;
  /** Background music path */
  musicPath: string;
  /** Total duration */
  totalDurationSeconds: number;
  /** Target levels */
  levels: {
    voiceLufs: number;
    musicLufs: number;
    sfxLufs: number;
    masterLufs: number;
  };
}

export function mixAudio(input: AudioMixInput, workDir: string): string {
  const outputPath = join(workDir, "mixed_audio.mp3");
  const { voiceClips, musicPath, totalDurationSeconds, levels } = input;

  if (voiceClips.length === 0) {
    // No voice — just use music (normalized)
    normalizeAudio(musicPath, outputPath, levels.musicLufs);
    return outputPath;
  }

  // Build FFmpeg filter complex for 4-bus mix
  // Bus 1: Voice (normalized to voiceLufs, placed at correct timestamps)
  // Bus 2: Music (normalized to musicLufs, full duration, ducked during voice)
  // Bus 3: SFX (placeholder — silent for now)
  // Bus 4: Ambient (placeholder — silent for now)

  // Normalize music
  const normalizedMusic = join(workDir, "music_normalized.mp3");
  normalizeAudio(musicPath, normalizedMusic, levels.musicLufs);

  // Build voice overlay using sequential adelay + amix
  // Strategy: create a silent base track, then overlay each voice clip at its timestamp
  const silentBase = join(workDir, "silent_base.mp3");
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${Math.ceil(totalDurationSeconds)} -q:a 9 "${silentBase}"`,
    { stdio: "ignore" }
  );

  // Overlay voice clips one by one onto the silent base
  let currentBase = silentBase;
  for (let i = 0; i < voiceClips.length; i++) {
    const clip = voiceClips[i];
    const nextBase = join(workDir, `voice_overlay_${i}.mp3`);
    const delayMs = Math.round(clip.startSeconds * 1000);

    execSync(
      `ffmpeg -y -i "${currentBase}" -i "${clip.path}" -filter_complex "[1:a]adelay=${delayMs}|${delayMs}[delayed];[0:a][delayed]amix=inputs=2:duration=first:weights=1 1:normalize=0[out]" -map "[out]" "${nextBase}"`,
      { stdio: "ignore" }
    );

    if (currentBase !== silentBase) {
      try { unlinkSync(currentBase); } catch { /* ignore */ }
    }
    currentBase = nextBase;
  }

  // Normalize voice bus
  const voiceNormalized = join(workDir, "voice_normalized.mp3");
  normalizeAudio(currentBase, voiceNormalized, levels.voiceLufs);

  // Final mix: voice + music (music ducked by -6dB during voice)
  execSync(
    `ffmpeg -y -i "${voiceNormalized}" -i "${normalizedMusic}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest:weights=1 0.4:normalize=0,loudnorm=I=${levels.masterLufs}:TP=-1.5:LRA=11[out]" -map "[out]" "${outputPath}"`,
    { stdio: "ignore" }
  );

  return outputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
// Video Assembly (FFmpeg Concat)
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoAssemblyInput {
  /** Beat video clips in order */
  beatClips: Array<{
    beatId: string;
    videoPath: string;
    durationSeconds: number;
    transition: "cut" | "crossfade" | "fade_to_black" | "wipe";
  }>;
  /** Mixed audio track */
  audioPath: string;
}

export function assembleVideo(input: VideoAssemblyInput, workDir: string): string {
  const outputPath = join(workDir, "final_video.mp4");
  const { beatClips, audioPath } = input;

  if (beatClips.length === 0) {
    throw new Error("Stage 5: No beat clips to assemble");
  }

  // For simple cut transitions, use FFmpeg concat demuxer
  // (crossfade/wipe transitions require xfade filter — implement in production)
  const concatListPath = join(workDir, "concat_list.txt");
  const concatLines = beatClips.map((clip) => `file '${clip.videoPath}'`).join("\n");
  writeFileSync(concatListPath, concatLines);

  // Concat video clips
  const videoOnly = join(workDir, "video_concat.mp4");
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -preset fast -crf 23 -an "${videoOnly}"`,
    { stdio: "ignore" }
  );

  // Mux with mixed audio
  execSync(
    `ffmpeg -y -i "${videoOnly}" -i "${audioPath}" -c:v copy -c:a aac -b:a 192k -shortest "${outputPath}"`,
    { stdio: "ignore" }
  );

  return outputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
// Final Validation
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  fileSize: number;
  durationSeconds: number;
  format: string;
  audioLevels: {
    voiceLufs: number;
    musicLufs: number;
    sfxLufs: number;
    masterLufs: number;
  };
  errors: string[];
}

export function validateFinalVideo(videoPath: string): ValidationResult {
  const errors: string[] = [];

  // Check file exists and size
  const stats = require("fs").statSync(videoPath);
  const fileSizeMB = stats.size / (1024 * 1024);
  if (fileSizeMB > 500) errors.push(`File too large: ${fileSizeMB.toFixed(1)}MB (max 500MB)`);
  if (fileSizeMB < 0.1) errors.push(`File suspiciously small: ${fileSizeMB.toFixed(3)}MB`);

  // Get duration via ffprobe
  let duration = 0;
  try {
    const probeResult = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { encoding: "utf-8" }
    ).trim();
    duration = parseFloat(probeResult);
  } catch {
    errors.push("Could not determine video duration");
  }

  // Get audio loudness
  let masterLufs = -16;
  try {
    const loudnessResult = execSync(
      `ffmpeg -i "${videoPath}" -af "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" -f null /dev/null 2>&1`,
      { encoding: "utf-8" }
    );
    const match = loudnessResult.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
    if (match) masterLufs = parseFloat(match[1]);
  } catch { /* ignore loudness check errors */ }

  return {
    valid: errors.length === 0,
    fileSize: stats.size,
    durationSeconds: duration,
    format: "mp4",
    audioLevels: {
      voiceLufs: -16, // Targets (actual measurement requires per-bus analysis)
      musicLufs: -22,
      sfxLufs: -18,
      masterLufs,
    },
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Full Stage 5: Assembly Pipeline
// ═══════════════════════════════════════════════════════════════════════════

export interface Stage5Input {
  pipelineRunId: number;
  beats: Beat[];
  /** Video URLs from Stage 3/4 (lip-synced if available, otherwise raw) */
  videoUrls: Record<string, string>;
  /** Voice generation results from Stage 4 */
  voices: VoiceGenerationResult[];
  /** Lip-sync results from Stage 4 */
  lipSync: LipSyncResult[];
  /** Background music URL (optional) */
  musicUrl?: string;
  /** Audio levels */
  levels?: {
    voiceLufs: number;
    musicLufs: number;
    sfxLufs: number;
    masterLufs: number;
  };
  /** S3 key prefix for final output */
  outputKeyPrefix: string;
}

export async function runStage5(input: Stage5Input): Promise<AssemblyResult> {
  const workDir = getWorkDir(input.pipelineRunId);
  const levels = input.levels || { voiceLufs: -16, musicLufs: -22, sfxLufs: -18, masterLufs: -16 };

  try {
    // 1. Download all video clips
    const beatClips: Array<{
      beatId: string;
      videoPath: string;
      durationSeconds: number;
      transition: "cut" | "crossfade" | "fade_to_black" | "wipe";
    }> = [];

    let cumulativeTime = 0;
    const beatTimeline: Array<{ beatId: string; startSeconds: number; endSeconds: number }> = [];

    for (const beat of input.beats) {
      // Use lip-synced video if available, otherwise raw from Stage 3
      const lipSyncResult = input.lipSync.find((ls) => ls.beatId === beat.id);
      const videoUrl = lipSyncResult?.lipSyncedVideoUrl || input.videoUrls[beat.id];

      if (!videoUrl) {
        console.warn(`Stage 5: No video for beat ${beat.id}, skipping`);
        continue;
      }

      const videoPath = join(workDir, `beat_${beat.id}.mp4`);
      await downloadFile(videoUrl, videoPath);

      beatClips.push({
        beatId: beat.id,
        videoPath,
        durationSeconds: beat.durationTargetSeconds,
        transition: beat.transition,
      });

      beatTimeline.push({
        beatId: beat.id,
        startSeconds: cumulativeTime,
        endSeconds: cumulativeTime + beat.durationTargetSeconds,
      });
      cumulativeTime += beat.durationTargetSeconds;
    }

    if (beatClips.length === 0) {
      throw new Error("Stage 5: No video clips available for assembly");
    }

    // 2. Download voice clips and compute their placement
    const voiceClipPaths: Array<{ path: string; startSeconds: number; durationSeconds: number }> = [];

    for (const voice of input.voices) {
      const beatTiming = beatTimeline.find((bt) => bt.beatId === voice.beatId);
      if (!beatTiming) continue;

      const voicePath = join(workDir, `voice_${voice.beatId}_${voice.dialogueIndex}.mp3`);
      await downloadFile(voice.audioUrl, voicePath);

      // Place voice at beat start + small offset for natural timing
      const offset = voice.dialogueIndex * 1.5; // Stagger multiple lines
      voiceClipPaths.push({
        path: voicePath,
        startSeconds: beatTiming.startSeconds + offset,
        durationSeconds: voice.durationSeconds,
      });
    }

    // 3. Generate or fetch background music
    const totalDuration = cumulativeTime;
    const musicPath = await generateOrFetchMusic(
      {
        totalDurationSeconds: totalDuration,
        mood: input.beats[0]?.mood || "epic",
        existingMusicUrl: input.musicUrl,
      },
      workDir
    );

    // 4. Mix audio (4-bus)
    const mixedAudioPath = mixAudio(
      {
        voiceClips: voiceClipPaths,
        musicPath,
        totalDurationSeconds: totalDuration,
        levels,
      },
      workDir
    );

    // 5. Assemble final video
    const finalVideoPath = assembleVideo(
      { beatClips, audioPath: mixedAudioPath },
      workDir
    );

    // 6. Validate
    const validation = validateFinalVideo(finalVideoPath);
    if (!validation.valid) {
      console.warn(`Stage 5: Validation warnings: ${validation.errors.join(", ")}`);
    }

    // 7. Upload to S3
    const finalBuffer = require("fs").readFileSync(finalVideoPath);
    const outputKey = `${input.outputKeyPrefix}/final-${Date.now()}.mp4`;
    const { url: finalVideoUrl } = await storagePut(outputKey, finalBuffer, "video/mp4");

    return {
      finalVideoUrl,
      totalDurationSeconds: validation.durationSeconds || totalDuration,
      fileSizeBytes: validation.fileSize,
      audioLevels: validation.audioLevels,
      beatTimeline,
    };
  } finally {
    cleanup(workDir);
  }
}
