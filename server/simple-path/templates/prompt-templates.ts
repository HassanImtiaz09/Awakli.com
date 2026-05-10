/**
 * Prompt Template Library
 * 
 * Contains reusable prompt patterns for video generation, including:
 * - Dark-character lighting mitigation patterns
 * - Style anchors per genre
 * - Camera angle descriptions
 * - Mood-to-lighting mappings
 */

import type { CharacterReference, Beat } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// Dark-Character Lighting Mitigation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Documented pattern from Wave 9 API-parity validation:
 * 
 * PROBLEM: Characters with dark skin, dark clothing, or dark features (e.g., Renji)
 * score lower on CLIP when placed against dark/sunset/night backgrounds because
 * their distinguishing features become invisible.
 * 
 * SOLUTION: Prepend explicit lighting direction that illuminates the character's
 * signature features, ensuring CLIP can detect them.
 * 
 * CALIBRATION: Renji scored 0.625 whole-frame without mitigation.
 * Target with mitigation: 0.70+ whole-frame, 0.80+ character-region.
 */

export interface LightingMitigation {
  pattern: string;
  /** When to apply this pattern */
  triggers: {
    backgroundKeywords: string[];
    timeOfDay?: string[];
  };
  /** Template with {character}, {signature_feature}, {background} placeholders */
  template: string;
}

export const DARK_CHARACTER_LIGHTING_MITIGATIONS: LightingMitigation[] = [
  {
    pattern: "rim_light_warm",
    triggers: {
      backgroundKeywords: ["sunset", "dusk", "twilight", "golden hour"],
      timeOfDay: ["evening", "sunset"],
    },
    template: "warm rim-light catching {character}'s silhouette, {signature_feature} clearly visible against the {background} background,",
  },
  {
    pattern: "rim_light_cool",
    triggers: {
      backgroundKeywords: ["night", "moonlit", "starlit", "midnight"],
      timeOfDay: ["night", "midnight"],
    },
    template: "cool moonlight casting silver highlights on {character}, {signature_feature} visible in pale blue illumination,",
  },
  {
    pattern: "fire_light",
    triggers: {
      backgroundKeywords: ["fire", "torch", "campfire", "explosion", "lava", "inferno"],
    },
    template: "flickering firelight illuminating {character}'s face from below, {signature_feature} highlighted by warm orange glow,",
  },
  {
    pattern: "energy_glow",
    triggers: {
      backgroundKeywords: ["battle", "power", "energy", "aura", "transformation", "arena"],
    },
    template: "supernatural energy emanating from {character}, {signature_feature} backlit by intense aura,",
  },
  {
    pattern: "spotlight",
    triggers: {
      backgroundKeywords: ["dark", "shadow", "cave", "underground", "void", "abyss"],
    },
    template: "dramatic spotlight from above illuminating {character}, {signature_feature} sharply defined against deep shadows,",
  },
  {
    pattern: "contrast_bounce",
    triggers: {
      backgroundKeywords: ["storm", "rain", "overcast", "cloudy"],
    },
    template: "lightning flash revealing {character} in stark contrast, {signature_feature} momentarily illuminated,",
  },
];

/**
 * Apply dark-character lighting mitigation to a beat's prompt.
 * Only applies when:
 * 1. A dark character is present in the beat
 * 2. The background/lighting matches trigger keywords
 */
export function applyDarkCharLighting(
  beat: Beat,
  characters: CharacterReference[]
): string | undefined {
  const darkChars = characters.filter(
    (c) => c.isDarkCharacter && beat.characters.includes(c.name)
  );

  if (darkChars.length === 0) return undefined;

  // Check if background triggers mitigation
  const contextText = `${beat.description} ${beat.lighting} ${beat.mood}`.toLowerCase();

  for (const mitigation of DARK_CHARACTER_LIGHTING_MITIGATIONS) {
    const triggered = mitigation.triggers.backgroundKeywords.some((kw) =>
      contextText.includes(kw)
    );

    if (triggered) {
      const char = darkChars[0];
      const signatureFeature = char.visualTraits.distinguishingFeatures[0] || "distinctive features";
      const background = mitigation.triggers.backgroundKeywords.find((kw) => contextText.includes(kw)) || "dark";

      return mitigation.template
        .replace("{character}", char.name)
        .replace("{signature_feature}", signatureFeature)
        .replace("{background}", background);
    }
  }

  // Default fallback for any dark background without specific trigger
  const char = darkChars[0];
  const feature = char.visualTraits.distinguishingFeatures[0] || "distinctive features";
  return `strong directional lighting illuminating ${char.name}, ${feature} clearly visible,`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Style Anchors (per genre)
// ═══════════════════════════════════════════════════════════════════════════

export const STYLE_ANCHORS: Record<string, string> = {
  shonen: "Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic, dynamic action lines, bold colors",
  seinen: "Hand-drawn 2D anime, mature cel-shaded animation, seinen aesthetic, detailed backgrounds, muted color palette",
  shoujo: "Hand-drawn 2D anime, soft cel-shaded animation, shōjo aesthetic, sparkle effects, pastel colors, flowing lines",
  mecha: "Hand-drawn 2D anime, mechanical cel-shaded animation, mecha aesthetic, detailed machinery, metallic highlights",
  horror: "Hand-drawn 2D anime, dark cel-shaded animation, horror aesthetic, high contrast shadows, desaturated palette",
  slice_of_life: "Hand-drawn 2D anime, warm cel-shaded animation, slice-of-life aesthetic, soft lighting, natural colors",
  fantasy: "Hand-drawn 2D anime, rich cel-shaded animation, fantasy aesthetic, magical particle effects, vibrant colors",
  default: "Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic",
};

export function getStyleAnchor(genre?: string): string {
  return STYLE_ANCHORS[genre || "default"] || STYLE_ANCHORS.default;
}

// ═══════════════════════════════════════════════════════════════════════════
// Camera Angle Descriptions (for C1 prompts)
// ═══════════════════════════════════════════════════════════════════════════

export const CAMERA_ANGLES: Record<string, string> = {
  "close-up": "extreme close-up shot focusing on face and upper body, shallow depth of field",
  "medium shot": "medium shot from waist up, balanced framing showing character and immediate surroundings",
  "wide shot": "wide establishing shot showing full environment and character placement",
  "over-the-shoulder": "over-the-shoulder perspective, creating intimacy and spatial relationship",
  "low angle": "low angle shot looking up at character, conveying power and dominance",
  "high angle": "high angle shot looking down, creating vulnerability or overview perspective",
  "dutch angle": "tilted dutch angle creating tension and unease",
  "tracking shot": "smooth tracking shot following character movement",
  "pan left": "slow pan from right to left revealing the scene",
  "pan right": "slow pan from left to right revealing the scene",
  "zoom in": "gradual zoom into subject, building intensity",
  "zoom out": "gradual zoom out revealing broader context",
};

export function getCameraDescription(angle: string): string {
  return CAMERA_ANGLES[angle.toLowerCase()] || angle;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mood-to-Lighting Mappings
// ═══════════════════════════════════════════════════════════════════════════

export const MOOD_LIGHTING: Record<string, string> = {
  tense: "harsh directional lighting with deep shadows, high contrast, cold blue undertones",
  calm: "soft diffused lighting, warm golden tones, gentle shadows",
  epic: "dramatic backlighting with lens flare, saturated warm colors, god-rays",
  sad: "overcast flat lighting, desaturated cool tones, soft shadows",
  angry: "harsh red-orange lighting from below, deep shadows, high contrast",
  mysterious: "low-key lighting with single source, deep shadows, cool purple undertones",
  joyful: "bright even lighting, warm yellow-orange tones, minimal shadows",
  romantic: "soft pink-golden lighting, bokeh background, warm diffusion",
  fearful: "flickering unstable lighting, deep shadows, cold green undertones",
  determined: "strong directional lighting from above-left, warm tones, defined shadows",
};

export function getMoodLighting(mood: string): string {
  return MOOD_LIGHTING[mood.toLowerCase()] || MOOD_LIGHTING.determined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Negative Prompt Library
// ═══════════════════════════════════════════════════════════════════════════

export const NEGATIVE_PROMPTS: Record<string, string> = {
  default: "3D rendering, CGI, photorealistic, video game graphics, smooth gradients, plastic texture, wax figure, blurry, low quality, watermark, text overlay",
  strict_2d: "3D rendering, CGI, photorealistic, video game graphics, smooth gradients, plastic texture, wax figure, blurry, low quality, watermark, text overlay, 3D model, Unreal Engine, Unity, computer generated, digital painting, concept art",
  quality: "blurry, low quality, pixelated, jpeg artifacts, noise, grain, watermark, text, logo, signature, out of focus, bad anatomy, deformed",
};

export function getNegativePrompt(style: string = "default"): string {
  return NEGATIVE_PROMPTS[style] || NEGATIVE_PROMPTS.default;
}
