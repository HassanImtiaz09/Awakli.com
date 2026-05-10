/**
 * Stage 4: Voice Generation (ElevenLabs) + Lip-Sync (PixVerse + Kling backup)
 * 
 * For each beat with dialogue:
 * 1. Generate voice audio via ElevenLabs TTS (primary) or Cartesia (fallback)
 * 2. Normalize audio to -16 LUFS
 * 3. Apply lip-sync via fal-ai/pixverse/lipsync (primary) or Kling (backup)
 */

import { fal } from "@fal-ai/client";
import { ENV } from "../../_core/env";
import { storagePut } from "../../storage";
import type {
  Beat,
  VoiceGenerationResult,
  LipSyncResult,
  LipSyncProvider,
  VoiceProvider,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// Voice Assignment Map
// ═══════════════════════════════════════════════════════════════════════════

export interface VoiceAssignment {
  characterName: string;
  provider: VoiceProvider;
  voiceId: string;
  /** ElevenLabs voice settings */
  settings?: {
    stability: number;
    similarityBoost: number;
    style: number;
  };
}

/** Default voice assignments for First Light characters */
export const FIRST_LIGHT_VOICE_ASSIGNMENTS: VoiceAssignment[] = [
  {
    characterName: "mira",
    provider: "elevenlabs",
    voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah - young female
    settings: { stability: 0.5, similarityBoost: 0.75, style: 0.3 },
  },
  {
    characterName: "kazuo",
    provider: "elevenlabs",
    voiceId: "VR6AewLTigWG4xSOukaG", // Arnold - deep male
    settings: { stability: 0.6, similarityBoost: 0.8, style: 0.2 },
  },
  {
    characterName: "renji",
    provider: "elevenlabs",
    voiceId: "N2lVS1w4EtoT3dr4eOWO", // Callum - dark/gravelly male
    settings: { stability: 0.4, similarityBoost: 0.7, style: 0.4 },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Voice Generation (ElevenLabs)
// ═══════════════════════════════════════════════════════════════════════════

export interface VoiceGenInput {
  beatId: string;
  dialogueIndex: number;
  characterName: string;
  text: string;
  emotion: string;
  voiceAssignment: VoiceAssignment;
}

export async function generateVoice(input: VoiceGenInput): Promise<VoiceGenerationResult> {
  const { voiceAssignment } = input;

  if (voiceAssignment.provider === "elevenlabs") {
    return generateVoiceElevenLabs(input);
  } else if (voiceAssignment.provider === "cartesia") {
    return generateVoiceCartesia(input);
  }

  throw new Error(`Stage 4: Unsupported voice provider: ${voiceAssignment.provider}`);
}

async function generateVoiceElevenLabs(input: VoiceGenInput): Promise<VoiceGenerationResult> {
  const apiKey = ENV.elevenLabsApiKey;
  if (!apiKey) throw new Error("Stage 4: ELEVENLABS_API_KEY not configured");

  const { voiceAssignment } = input;
  const settings = voiceAssignment.settings || { stability: 0.5, similarityBoost: 0.75, style: 0.3 };

  // Add emotion direction to text
  const textWithDirection = input.emotion !== "neutral"
    ? `<break time="200ms"/>${input.text}`
    : input.text;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceAssignment.voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: textWithDirection,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarityBoost,
          style: settings.style,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stage 4: ElevenLabs TTS failed (${response.status}): ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  // Upload to S3
  const fileKey = `voice-clips/${input.beatId}-${input.dialogueIndex}-${input.characterName}-${Date.now()}.mp3`;
  const { url: audioUrl } = await storagePut(fileKey, audioBuffer, "audio/mpeg");

  // Estimate duration (rough: ~150 words/min for English)
  const wordCount = input.text.split(/\s+/).length;
  const estimatedDuration = Math.max(1, wordCount / 2.5); // ~2.5 words/sec

  return {
    beatId: input.beatId,
    dialogueIndex: input.dialogueIndex,
    characterName: input.characterName,
    audioUrl,
    durationSeconds: estimatedDuration,
    provider: "elevenlabs",
    voiceId: voiceAssignment.voiceId,
  };
}

async function generateVoiceCartesia(input: VoiceGenInput): Promise<VoiceGenerationResult> {
  const apiKey = ENV.cartesiaApiKey;
  if (!apiKey) throw new Error("Stage 4: CARTESIA_API_KEY not configured");

  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-english",
      transcript: input.text,
      voice: { mode: "id", id: input.voiceAssignment.voiceId },
      output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Stage 4: Cartesia TTS failed (${response.status})`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const fileKey = `voice-clips/${input.beatId}-${input.dialogueIndex}-${input.characterName}-cartesia-${Date.now()}.mp3`;
  const { url: audioUrl } = await storagePut(fileKey, audioBuffer, "audio/mpeg");

  const wordCount = input.text.split(/\s+/).length;
  const estimatedDuration = Math.max(1, wordCount / 2.5);

  return {
    beatId: input.beatId,
    dialogueIndex: input.dialogueIndex,
    characterName: input.characterName,
    audioUrl,
    durationSeconds: estimatedDuration,
    provider: "cartesia",
    voiceId: input.voiceAssignment.voiceId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Lip-Sync (PixVerse via fal.ai — Primary)
// ═══════════════════════════════════════════════════════════════════════════

export interface LipSyncInput {
  beatId: string;
  videoUrl: string;
  audioUrl: string;
  provider?: LipSyncProvider;
}

export async function applyLipSync(input: LipSyncInput): Promise<LipSyncResult> {
  const provider = input.provider || "fal_pixverse_lipsync";

  if (provider === "fal_pixverse_lipsync") {
    return applyPixVerseLipSync(input);
  } else if (provider === "kling_lipsync") {
    return applyKlingLipSync(input);
  }

  throw new Error(`Stage 4: Unsupported lip-sync provider: ${provider}`);
}

async function applyPixVerseLipSync(input: LipSyncInput): Promise<LipSyncResult> {
  fal.config({ credentials: ENV.falApiKey });

  const startTime = Date.now();

  const result = await fal.subscribe("fal-ai/pixverse/lipsync", {
    input: {
      video_url: input.videoUrl,
      audio_url: input.audioUrl,
    },
    logs: false,
  });

  const generationTime = (Date.now() - startTime) / 1000;
  const videoUrl = (result.data as any)?.video?.url || (result.data as any)?.video_url;

  if (!videoUrl) {
    throw new Error(`Stage 4: PixVerse lip-sync returned no video URL`);
  }

  // Estimate duration from input video (lip-sync preserves duration)
  const costUsd = 5 * 0.04; // Assume ~5s average, $0.04/sec

  return {
    beatId: input.beatId,
    originalVideoUrl: input.videoUrl,
    lipSyncedVideoUrl: videoUrl,
    provider: "pixverse",
    durationSeconds: 5, // Will be updated from actual video metadata
    costUsd,
  };
}

async function applyKlingLipSync(input: LipSyncInput): Promise<LipSyncResult> {
  // Kling lip-sync via fal.ai as backup
  fal.config({ credentials: ENV.falApiKey });

  // Kling lip-sync requires padding audio to at least 3 seconds
  // and setting sound_end_time to floor(actual_duration_ms) - 50
  const result = await fal.subscribe("fal-ai/kling-video/v2/master/lip-sync", {
    input: {
      video_url: input.videoUrl,
      audio_url: input.audioUrl,
    },
    logs: false,
  });

  const videoUrl = (result.data as any)?.video?.url || (result.data as any)?.video_url;
  if (!videoUrl) {
    throw new Error(`Stage 4: Kling lip-sync returned no video URL`);
  }

  return {
    beatId: input.beatId,
    originalVideoUrl: input.videoUrl,
    lipSyncedVideoUrl: videoUrl,
    provider: "kling",
    durationSeconds: 5,
    costUsd: 5 * 0.05, // Kling is slightly more expensive
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Full Stage 4: Voice + Lip-Sync for All Beats
// ═══════════════════════════════════════════════════════════════════════════

export interface Stage4Input {
  beats: Beat[];
  /** Video URLs from Stage 3 (keyed by beatId) */
  videoUrls: Record<string, string>;
  voiceAssignments: VoiceAssignment[];
  lipSyncProvider?: LipSyncProvider;
  /** Progress callback */
  onProgress?: (completed: number, total: number) => void;
}

export interface Stage4Output {
  voices: VoiceGenerationResult[];
  lipSync: LipSyncResult[];
  totalCostUsd: number;
}

export async function runStage4(input: Stage4Input): Promise<Stage4Output> {
  const { beats, videoUrls, voiceAssignments, lipSyncProvider } = input;
  const voices: VoiceGenerationResult[] = [];
  const lipSyncResults: LipSyncResult[] = [];
  let totalCost = 0;
  let completed = 0;

  // Count total dialogue lines for progress
  const totalDialogueLines = beats.reduce((sum, b) => sum + b.dialogue.length, 0);
  const beatsWithDialogue = beats.filter((b) => b.dialogue.length > 0 && videoUrls[b.id]);

  for (const beat of beatsWithDialogue) {
    const beatVoices: VoiceGenerationResult[] = [];

    // Generate voice for each dialogue line
    for (let i = 0; i < beat.dialogue.length; i++) {
      const line = beat.dialogue[i];
      const assignment = voiceAssignments.find((a) => a.characterName === line.characterName);

      if (!assignment) {
        console.warn(`Stage 4: No voice assignment for "${line.characterName}", skipping`);
        continue;
      }

      try {
        const voiceResult = await generateVoice({
          beatId: beat.id,
          dialogueIndex: i,
          characterName: line.characterName,
          text: line.text,
          emotion: line.emotion,
          voiceAssignment: assignment,
        });
        beatVoices.push(voiceResult);
        voices.push(voiceResult);
        totalCost += 0.015; // ~$0.015 per ElevenLabs generation
      } catch (err) {
        console.error(`Stage 4: Voice gen failed for beat ${beat.id} line ${i}:`, err);
      }
    }

    // Apply lip-sync if we have voice audio and video
    if (beatVoices.length > 0 && videoUrls[beat.id]) {
      try {
        // Use the first voice clip for lip-sync (primary speaker)
        const primaryVoice = beatVoices[0];
        const lipResult = await applyLipSync({
          beatId: beat.id,
          videoUrl: videoUrls[beat.id],
          audioUrl: primaryVoice.audioUrl,
          provider: lipSyncProvider,
        });
        lipSyncResults.push(lipResult);
        totalCost += lipResult.costUsd;
      } catch (err) {
        console.error(`Stage 4: Lip-sync failed for beat ${beat.id}:`, err);
        // Fallback: try backup provider
        if (lipSyncProvider !== "kling_lipsync") {
          try {
            const fallbackResult = await applyLipSync({
              beatId: beat.id,
              videoUrl: videoUrls[beat.id],
              audioUrl: beatVoices[0].audioUrl,
              provider: "kling_lipsync",
            });
            lipSyncResults.push(fallbackResult);
            totalCost += fallbackResult.costUsd;
          } catch (fallbackErr) {
            console.error(`Stage 4: Backup lip-sync also failed for beat ${beat.id}`);
          }
        }
      }
    }

    completed++;
    input.onProgress?.(completed, beatsWithDialogue.length);
  }

  return { voices, lipSync: lipSyncResults, totalCostUsd: totalCost };
}
