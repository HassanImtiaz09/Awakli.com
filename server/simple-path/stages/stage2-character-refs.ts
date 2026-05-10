/**
 * Stage 2: Character Reference Generation
 * 
 * Generates or ingests character reference images for PixVerse C1 Subject Reference.
 * Supports:
 * - Upload existing reference images (Phase 1.6 refs)
 * - Generate new references via image generation
 * - Crop character regions for CLIP comparison
 */

import { storagePut } from "../../storage";
import type { CharacterReference } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// Character Reference from Existing Image (Upload Path)
// ═══════════════════════════════════════════════════════════════════════════

export interface ExistingRefInput {
  name: string;
  imageUrl: string;
  descriptor: string;
  visualTraits: {
    hair: string;
    eyes: string;
    clothing: string;
    distinguishingFeatures: string[];
  };
  isDarkCharacter: boolean;
}

/**
 * Create a CharacterReference from an existing uploaded image.
 * For Phase 1.6 refs (mira, kazuo, renji) that are already validated.
 */
export async function createRefFromExisting(
  input: ExistingRefInput
): Promise<CharacterReference> {
  // For now, use the full image as both reference and cropped region
  // Production: face detection → crop → upload cropped version
  return {
    name: input.name,
    referenceImageUrl: input.imageUrl,
    croppedRegionUrl: input.imageUrl, // TODO: Stage 3 will crop on-demand
    descriptor: input.descriptor,
    visualTraits: input.visualTraits,
    isDarkCharacter: input.isDarkCharacter,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// First Light Fixture Characters (Canonical Phase 1.6)
// ═══════════════════════════════════════════════════════════════════════════

export interface FirstLightCharacterConfig {
  name: string;
  descriptor: string;
  visualTraits: {
    hair: string;
    eyes: string;
    clothing: string;
    distinguishingFeatures: string[];
  };
  isDarkCharacter: boolean;
}

export const FIRST_LIGHT_CHARACTERS: FirstLightCharacterConfig[] = [
  {
    name: "mira",
    descriptor: "16-year-old female martial artist, white sleeveless gi with red sash, black ponytail with magenta tips, determined expression",
    visualTraits: {
      hair: "black ponytail with magenta/pink tips",
      eyes: "brown, large anime-style",
      clothing: "white sleeveless gi with red sash, black fingerless gloves, white leg wraps",
      distinguishingFeatures: ["magenta-tipped ponytail", "red sash belt", "black fingerless gloves"],
    },
    isDarkCharacter: false,
  },
  {
    name: "kazuo",
    descriptor: "28-year-old male martial artist, shaved head, muscular build, black sleeveless top with Kyokushin kanji, black gi pants",
    visualTraits: {
      hair: "shaved/bald",
      eyes: "narrow, intense, dark",
      clothing: "black sleeveless top with 極真 kanji, black gi pants, bare feet",
      distinguishingFeatures: ["shaved head", "muscular build", "Kyokushin kanji on chest"],
    },
    isDarkCharacter: false,
  },
  {
    name: "renji",
    descriptor: "Mid-30s half-demon mercenary, burned right side of face, glowing red right eye, long black hair, dark grey combat top, demonic scarring",
    visualTraits: {
      hair: "long black, wild/unkempt",
      eyes: "left eye green, right eye glowing red (demonic)",
      clothing: "dark grey sleeveless combat top, black pants, wrist wraps",
      distinguishingFeatures: ["burned/scarred right face", "glowing red right eye", "demonic scarring on arms"],
    },
    isDarkCharacter: true, // Dark clothing + dark scarring on dark backgrounds
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Build Character References for Pipeline Run
// ═══════════════════════════════════════════════════════════════════════════

export interface BuildRefsInput {
  /** Character configs with their reference image URLs */
  characters: Array<FirstLightCharacterConfig & { referenceImageUrl: string }>;
}

/**
 * Build the full CharacterReference[] array for a pipeline run.
 * Accepts pre-uploaded reference images and enriches with metadata.
 */
export async function buildCharacterRefs(
  input: BuildRefsInput
): Promise<CharacterReference[]> {
  const refs: CharacterReference[] = [];

  for (const char of input.characters) {
    refs.push({
      name: char.name,
      referenceImageUrl: char.referenceImageUrl,
      croppedRegionUrl: char.referenceImageUrl, // Full image for now; CLIP harness crops on-demand
      descriptor: char.descriptor,
      visualTraits: char.visualTraits,
      isDarkCharacter: char.isDarkCharacter,
    });
  }

  return refs;
}

// ═══════════════════════════════════════════════════════════════════════════
// Generate New Character Reference (Future: ChatGPT Image 2 / FLUX)
// ═══════════════════════════════════════════════════════════════════════════

export interface GenerateRefInput {
  name: string;
  descriptor: string;
  visualTraits: {
    hair: string;
    eyes: string;
    clothing: string;
    distinguishingFeatures: string[];
  };
  isDarkCharacter: boolean;
  /** Art style for generation */
  artStyle?: string;
}

/**
 * Generate a new character reference image using AI image generation.
 * For new characters that don't have existing Phase 1.6 refs.
 */
export async function generateCharacterRef(
  input: GenerateRefInput
): Promise<CharacterReference> {
  // Build generation prompt
  const prompt = buildRefGenerationPrompt(input);

  // Import image generation helper
  const { generateImage } = await import("../../_core/imageGeneration");

  const { url: imageUrl } = await generateImage({
    prompt,
  });

  // Upload to S3 for persistence
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileKey = `character-refs/${input.name}-${Date.now()}.png`;
  const { url: s3Url } = await storagePut(fileKey, buffer, "image/png");

  return {
    name: input.name,
    referenceImageUrl: s3Url,
    croppedRegionUrl: s3Url, // TODO: crop face region
    descriptor: input.descriptor,
    visualTraits: input.visualTraits,
    isDarkCharacter: input.isDarkCharacter,
  };
}

function buildRefGenerationPrompt(input: GenerateRefInput): string {
  const style = input.artStyle || "Hand-drawn 2D anime character reference sheet, traditional cel-shaded, clean lines";
  const traits = [
    `Hair: ${input.visualTraits.hair}`,
    `Eyes: ${input.visualTraits.eyes}`,
    `Clothing: ${input.visualTraits.clothing}`,
    ...input.visualTraits.distinguishingFeatures.map((f) => `Feature: ${f}`),
  ].join(". ");

  return `${style}. Full-body character reference sheet with front view, side view, and 3/4 view. ${input.descriptor}. ${traits}. Clean white background, professional anime character design sheet. No text, no labels, no watermarks.`;
}
