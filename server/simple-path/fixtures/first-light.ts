/**
 * First Light Fixture — Locked Episode 1 Script + Character Config
 * 
 * This is the canonical test fixture for Wave 9 smoke testing.
 * Based on Phase 1.6 validated characters (mira, kazuo, renji).
 */

import type { VoiceAssignment } from "../stages/stage4-voice-lipsync";
import { FIRST_LIGHT_CHARACTERS } from "../stages/stage2-character-refs";

// ═══════════════════════════════════════════════════════════════════════════
// Episode 1 Script (First Light)
// ═══════════════════════════════════════════════════════════════════════════

export const FIRST_LIGHT_SCRIPT = `
EPISODE 1: "FIRST LIGHT"

SCENE 1 — THE STONE ARENA (SUNSET)

The sun hangs low over an ancient stone training arena, casting long orange shadows across weathered flagstones. Cherry blossom petals drift on the warm evening breeze.

MIRA stands at the center of the arena, feet planted in a low stance, fists raised. Her white gi billows slightly in the wind, the red sash tight around her waist. Her magenta-tipped ponytail sways as she shifts her weight.

KAZUO approaches from her left, his massive frame casting a long shadow. His bare feet are silent on the stone. The Kyokushin kanji on his black top catches the sunset light. He drops into a fighting stance without a word.

From her right, RENJI emerges from the shadows at the arena's edge. His glowing red eye pulses brighter as he steps into the fading light. The burned side of his face is partially illuminated by the sunset, revealing the demonic scarring that crawls down his neck.

MIRA: (determined) "Two against one again? Fine. I've been training for this."

KAZUO: (stoic) "Training means nothing if you can't adapt."

RENJI: (cold, amused) "She'll break before the first exchange."

The three fighters circle each other. Tension builds. Cherry blossoms swirl between them.

KAZUO charges first — a thundering straight punch aimed at Mira's center. She reads it, ducks low, feeling the wind of his fist pass over her head.

Simultaneously, RENJI lunges from her blind side, clawed hand extended, his red eye blazing with demonic energy. 

MIRA spins low, sweeping her leg to kick Kazuo's planted foot, sending him stumbling. In the same fluid motion, she rises and catches Renji's clawed strike on her forearm guard. The impact sends sparks of red energy scattering.

MIRA: (fierce) "I can see both of you."

She pushes Renji back and resets her stance. The sunset behind her creates a silhouette effect, her ponytail whipping in the displaced air.

SCENE 2 — FLASHBACK: THE DOJO (MORNING, ONE YEAR AGO)

A traditional wooden dojo, morning light streaming through paper screens. Young MIRA (15) kneels before a worn training dummy, wrapping her hands methodically.

An older SENSEI's voice echoes (off-screen): "The strongest fighter isn't the one who hits hardest. It's the one who sees everything."

Young Mira closes her eyes, breathes deeply. When she opens them, there's a new intensity — the beginning of her observation technique.

SCENE 3 — BACK TO THE ARENA (SUNSET, CONTINUOUS)

The fight resumes. KAZUO and RENJI attack in coordinated strikes now — Kazuo's raw power from the front, Renji's speed and demonic reach from the flank.

MIRA weaves between their attacks, her eyes tracking both opponents simultaneously. Each dodge is minimal — just enough to avoid, conserving energy.

KAZUO throws a devastating roundhouse kick. MIRA drops under it and counters with an open-palm strike to his solar plexus. He staggers back, winded.

RENJI uses the opening to close distance, his demonic arm glowing brighter. He grabs for Mira's throat.

MIRA catches his wrist, redirects his momentum, and throws him over her hip into KAZUO. The two collide and tumble across the stone.

MIRA stands alone in the center of the arena, breathing hard but standing. The sunset blazes behind her.

MIRA: (quietly, to herself) "I can see everything now."

The episode ends on her silhouette against the dying sun, cherry blossoms frozen in the air around her.

END EPISODE 1
`;

// ═══════════════════════════════════════════════════════════════════════════
// Character Reference Image URLs (Phase 1.6 validated)
// These must be set to the actual uploaded URLs before running the smoke test
// ═══════════════════════════════════════════════════════════════════════════

export interface FirstLightFixtureConfig {
  /** Uploaded reference image URLs (from manus-upload-file) */
  referenceImageUrls: {
    mira: string;
    kazuo: string;
    renji: string;
  };
  /** Background music URL (optional) */
  musicUrl?: string;
  /** Target duration in seconds */
  targetDurationSeconds?: number;
  /** Video resolution */
  resolution?: string;
  /** Max concurrent video generations */
  concurrency?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Voice Assignments (First Light)
// ═══════════════════════════════════════════════════════════════════════════

export const FIRST_LIGHT_VOICE_ASSIGNMENTS: VoiceAssignment[] = [
  {
    characterName: "mira",
    provider: "elevenlabs",
    voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah - young determined female
    settings: { stability: 0.5, similarityBoost: 0.75, style: 0.3 },
  },
  {
    characterName: "kazuo",
    provider: "elevenlabs",
    voiceId: "VR6AewLTigWG4xSOukaG", // Arnold - deep stoic male
    settings: { stability: 0.6, similarityBoost: 0.8, style: 0.2 },
  },
  {
    characterName: "renji",
    provider: "elevenlabs",
    voiceId: "N2lVS1w4EtoT3dr4eOWO", // Callum - cold/dark male
    settings: { stability: 0.4, similarityBoost: 0.7, style: 0.4 },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Build Full Config for Smoke Test
// ═══════════════════════════════════════════════════════════════════════════

export function buildFirstLightConfig(
  pipelineRunId: number,
  episodeId: number,
  projectId: number,
  userId: number,
  fixtureConfig: FirstLightFixtureConfig
) {
  return {
    pipelineRunId,
    episodeId,
    projectId,
    userId,
    script: FIRST_LIGHT_SCRIPT,
    episodeTitle: "First Light - Episode 1",
    characters: FIRST_LIGHT_CHARACTERS.map((char) => ({
      ...char,
      referenceImageUrl: fixtureConfig.referenceImageUrls[char.name as keyof typeof fixtureConfig.referenceImageUrls],
    })),
    voiceAssignments: FIRST_LIGHT_VOICE_ASSIGNMENTS,
    clipConfig: {
      wholeFrameThreshold: 0.70,
      characterRegionThreshold: 0.80,
      maxRegenerationAttempts: 3,
      useCharacterRegionCropping: false, // Whole-frame for smoke test, calibrate later
    },
    resolution: fixtureConfig.resolution || "720p",
    concurrency: fixtureConfig.concurrency || 2, // Conservative for smoke test
    musicUrl: fixtureConfig.musicUrl,
    targetDurationSeconds: fixtureConfig.targetDurationSeconds || 180, // 3 min for smoke test
    genre: "shonen",
    outputKeyPrefix: `pipeline/${pipelineRunId}`,
  };
}
