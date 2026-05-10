/**
 * Stage 1: LLM Beat Segmentation
 * 
 * Accepts episode script + metadata → outputs structured Beat[] array
 * Uses Claude via invokeLLM with JSON schema response format
 */

import { invokeLLM } from "../../_core/llm";
import type { Beat, BeatSegmentationOutput, CharacterReference, DARK_CHARACTER_LIGHTING_PATTERNS } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// Dark-Character Lighting Detection
// ═══════════════════════════════════════════════════════════════════════════

const DARK_BACKGROUNDS = ["sunset", "night", "dark", "shadow", "cave", "underground", "dusk", "twilight", "storm"];

function detectDarkCharacterLighting(
  beat: Beat,
  characters: CharacterReference[]
): string | undefined {
  const darkCharsInBeat = characters.filter(
    (c) => c.isDarkCharacter && beat.characters.includes(c.name)
  );
  if (darkCharsInBeat.length === 0) return undefined;

  const bgLower = (beat.lighting + " " + beat.description).toLowerCase();
  const isDarkBg = DARK_BACKGROUNDS.some((bg) => bgLower.includes(bg));
  if (!isDarkBg) return undefined;

  // Apply rim-light pattern by default for dark chars on dark backgrounds
  const char = darkCharsInBeat[0];
  const signatureFeature = char.visualTraits.distinguishingFeatures[0] || "distinctive features";
  return `warm rim-light catching ${char.name}'s silhouette, ${signatureFeature} clearly visible against the background,`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Beat Segmentation System Prompt
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are an expert anime director and storyboard artist. Your job is to segment an episode script into individual "beats" — each beat becomes one video clip (3-15 seconds) in the final anime.

RULES:
1. Each beat must be a single continuous action that can be captured in one camera shot (3-15 seconds)
2. Dialogue-heavy beats should be 5-8 seconds. Action beats can be 3-6 seconds. Establishing shots 4-6 seconds.
3. Every character mentioned must use their EXACT name (case-sensitive) as it appears in the character list
4. Camera angles must be specific: "close-up", "medium shot", "wide shot", "over-the-shoulder", "low angle", "high angle", "dutch angle", "tracking shot", "pan left/right"
5. Lighting must be explicit and specific — never leave it vague. Include direction (from left, from above, rim-light, backlit) and color temperature
6. For dark-skinned or dark-clothed characters in dark/night/sunset scenes, ALWAYS include explicit lighting that illuminates their distinguishing features
7. Style anchor must always include: "Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic"
8. Transitions between beats: "cut" (default), "crossfade" (scene change), "fade_to_black" (time skip), "wipe" (parallel action)
9. Duration targets must respect the 3-15 second range of PixVerse C1
10. Each beat's description should be a complete visual prompt — include character actions, expressions, environment details

OUTPUT: Return a JSON object matching the schema exactly. Do not include any text outside the JSON.`;

// ═══════════════════════════════════════════════════════════════════════════
// JSON Schema for Structured Output
// ═══════════════════════════════════════════════════════════════════════════

const BEAT_SEGMENTATION_SCHEMA = {
  name: "beat_segmentation",
  strict: true,
  schema: {
    type: "object",
    properties: {
      episodeTitle: { type: "string", description: "Title of the episode" },
      totalBeats: { type: "integer", description: "Total number of beats" },
      estimatedDurationSeconds: { type: "integer", description: "Total estimated duration in seconds" },
      beats: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique beat ID (format: beat_001, beat_002, ...)" },
            sceneNumber: { type: "integer", description: "Scene number (1-based)" },
            beatNumber: { type: "integer", description: "Beat number within scene (1-based)" },
            description: { type: "string", description: "Full visual description for video generation. Include character actions, expressions, environment, and style." },
            characters: {
              type: "array",
              items: { type: "string" },
              description: "Character names present in this beat (must match reference names exactly)"
            },
            cameraAngle: { type: "string", description: "Specific camera angle/movement" },
            lighting: { type: "string", description: "Explicit lighting direction, color temperature, and source" },
            mood: { type: "string", description: "Emotional mood of the beat" },
            durationTargetSeconds: { type: "integer", description: "Target duration 3-15 seconds" },
            dialogue: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  characterName: { type: "string" },
                  text: { type: "string" },
                  emotion: { type: "string" },
                  estimatedDurationSeconds: { type: "number" }
                },
                required: ["characterName", "text", "emotion", "estimatedDurationSeconds"],
                additionalProperties: false
              }
            },
            sfx: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  timestampOffsetMs: { type: "integer" },
                  volume: { type: "number" }
                },
                required: ["type", "timestampOffsetMs", "volume"],
                additionalProperties: false
              }
            },
            transition: { type: "string", enum: ["cut", "crossfade", "fade_to_black", "wipe"] },
            styleAnchor: { type: "string", description: "Must include 'Hand-drawn 2D anime, traditional cel-shaded animation'" }
          },
          required: ["id", "sceneNumber", "beatNumber", "description", "characters", "cameraAngle", "lighting", "mood", "durationTargetSeconds", "dialogue", "sfx", "transition", "styleAnchor"],
          additionalProperties: false
        }
      }
    },
    required: ["episodeTitle", "totalBeats", "estimatedDurationSeconds", "beats"],
    additionalProperties: false
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Main Function
// ═══════════════════════════════════════════════════════════════════════════

export interface BeatSegmentationInput {
  /** Episode script (structured JSON or plain text) */
  script: string;
  /** Episode title */
  episodeTitle: string;
  /** Available character names (must be used exactly in beats) */
  characterNames: string[];
  /** Character references (for dark-character detection) */
  characterRefs?: CharacterReference[];
  /** Target total duration in seconds (default: 300 = 5 min) */
  targetDurationSeconds?: number;
  /** Genre context for style */
  genre?: string;
}

export async function runBeatSegmentation(
  input: BeatSegmentationInput
): Promise<BeatSegmentationOutput> {
  const targetDuration = input.targetDurationSeconds || 300;

  const userPrompt = `EPISODE: "${input.episodeTitle}"
GENRE: ${input.genre || "shōnen action"}
TARGET DURATION: ${targetDuration} seconds (${Math.round(targetDuration / 60)} minutes)
AVAILABLE CHARACTERS: ${input.characterNames.join(", ")}

SCRIPT:
${input.script}

Segment this script into beats. Each beat = one video clip (3-15 seconds). 
Total beats should sum to approximately ${targetDuration} seconds.
Use ONLY the character names listed above (case-sensitive).
Every beat's styleAnchor MUST include "Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic".`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: BEAT_SEGMENTATION_SCHEMA,
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Stage 1: LLM returned empty or non-string content");
  }

  const parsed: BeatSegmentationOutput = JSON.parse(content);

  // Post-processing: apply dark-character lighting overrides
  if (input.characterRefs) {
    for (const beat of parsed.beats) {
      const override = detectDarkCharacterLighting(beat, input.characterRefs);
      if (override) {
        (beat as Beat).darkCharLightingOverride = override;
      }
    }
  }

  // Validation
  validateBeats(parsed, input.characterNames);

  // Add generation metadata
  parsed.generationMetadata = {
    model: response.model || "claude",
    tokensUsed: response.usage?.total_tokens || 0,
    generatedAt: new Date().toISOString(),
  };

  return parsed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

function validateBeats(output: BeatSegmentationOutput, validCharacters: string[]): void {
  if (!output.beats || output.beats.length === 0) {
    throw new Error("Stage 1 validation: No beats generated");
  }

  const errors: string[] = [];

  for (const beat of output.beats) {
    // Check duration range
    if (beat.durationTargetSeconds < 3 || beat.durationTargetSeconds > 15) {
      errors.push(`Beat ${beat.id}: duration ${beat.durationTargetSeconds}s outside 3-15s range`);
    }

    // Check character names are valid
    for (const char of beat.characters) {
      if (!validCharacters.includes(char)) {
        errors.push(`Beat ${beat.id}: unknown character "${char}" (valid: ${validCharacters.join(", ")})`);
      }
    }

    // Check dialogue character names
    for (const line of beat.dialogue) {
      if (!validCharacters.includes(line.characterName)) {
        errors.push(`Beat ${beat.id}: dialogue by unknown character "${line.characterName}"`);
      }
    }

    // Check style anchor
    if (!beat.styleAnchor.includes("2D anime")) {
      errors.push(`Beat ${beat.id}: styleAnchor missing "2D anime" requirement`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Stage 1 validation failed:\n${errors.join("\n")}`);
  }
}
