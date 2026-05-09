/**
 * Prompt-Style Adapter (Wave 6B Item 2)
 *
 * Style-aware prompt augmentation that composes genre templates, sakufuu bias,
 * and character bible traits into a unified prompt modifier for the generation pipeline.
 *
 * Architecture:
 * - PromptStyleAdapter interface: provider-agnostic style injection
 * - Genre-specific prompt templates: per GENRE_TAXONOMY (10 genres)
 * - Sakufuu style injection: D9 pipeline integration (bias → prompt modifiers)
 * - Character-specific prompt modifiers: from character bible traits
 *
 * Integration points:
 * - AdapterComposer (Wave 6A Item 1): composition requests include style context
 * - D0/D1.5 generation: prompt augmentation before image generation
 * - D9 Sakufuu Tracker: bias recommendations → prompt style modifiers
 * - Character Bible: visual traits → prompt descriptors
 */

import type { GenreTag } from "./benchmarks/d10/genre-retrieval-pool";
import { GENRE_TAXONOMY, GENRE_DESCRIPTIONS } from "./benchmarks/d10/genre-retrieval-pool";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PromptStyleContext {
  /** Genre of the project/episode */
  genre: GenreTag;
  /** Art style from project settings */
  artStyle?: string;
  /** Camera angle for the panel */
  cameraAngle?: string;
  /** Scene mood/atmosphere */
  mood?: string;
  /** Time of day */
  timeOfDay?: string;
  /** Location/setting */
  location?: string;
  /** Characters present in the panel */
  characters?: CharacterPromptInfo[];
  /** Sakufuu bias (from D9 tracker, episodes 2+) */
  sakufuuBias?: SakufuuStyleBias | null;
  /** Whether this is a key frame (more detail) or in-between (less detail) */
  frameType?: "key" | "inbetween";
}

export interface CharacterPromptInfo {
  name: string;
  role: "protagonist" | "antagonist" | "supporting" | "background";
  /** Visual traits from character bible */
  visualTraits: {
    hairColor?: string;
    hairStyle?: string;
    eyeColor?: string;
    bodyType?: string;
    clothing?: string;
    distinguishingFeatures?: string[];
  };
  /** LoRA trigger word if trained */
  loraTriggerWord?: string;
  /** Emotion for this panel */
  emotion?: string;
}

export interface SakufuuStyleBias {
  active: boolean;
  signatureFx: string[];
  suggestedPalette: Array<{ name: string; hex: string }>;
  suggestedTemperature: "warm" | "cool" | "neutral";
  suggestedPacing: "fast" | "moderate" | "slow" | "dynamic";
  suggestedCameraStyle: Record<string, number>;
  confidence: number;
}

export interface PromptAugmentation {
  /** The augmented prompt (full prompt ready for generation) */
  prompt: string;
  /** Negative prompt */
  negativePrompt: string;
  /** Style weight (0-1, how strongly to apply style modifiers) */
  styleWeight: number;
  /** Quality tags applied */
  qualityTags: string[];
  /** Style tags applied */
  styleTags: string[];
  /** Character descriptors injected */
  characterDescriptors: string[];
  /** Sakufuu modifiers applied */
  sakufuuModifiers: string[];
}

export interface PromptStyleAdapter {
  /** Augment a base prompt with style context */
  augment(basePrompt: string, context: PromptStyleContext): PromptAugmentation;
  /** Get the genre template for a specific genre */
  getGenreTemplate(genre: GenreTag): GenrePromptTemplate;
  /** Get negative prompt for a genre */
  getNegativePrompt(genre: GenreTag): string;
  /** Build character descriptor from traits */
  buildCharacterDescriptor(character: CharacterPromptInfo): string;
  /** Apply sakufuu bias modifiers */
  applySakufuuBias(bias: SakufuuStyleBias): string[];
}

// ─── Genre Prompt Templates ──────────────────────────────────────────────────

export interface GenrePromptTemplate {
  /** Base style prefix for the genre */
  stylePrefix: string;
  /** Quality modifiers specific to this genre */
  qualityModifiers: string[];
  /** Negative prompt additions for this genre */
  negativeAdditions: string[];
  /** Recommended CFG scale */
  cfgScale: number;
  /** Recommended steps */
  steps: number;
  /** Color palette hints */
  colorHints: string[];
  /** Lighting style */
  lightingStyle: string;
  /** Line art style */
  lineArtStyle: string;
}

export const GENRE_PROMPT_TEMPLATES: Record<GenreTag, GenrePromptTemplate> = {
  shonen: {
    stylePrefix: "dynamic shonen anime style, high energy, bold lines",
    qualityModifiers: ["masterpiece", "best quality", "dynamic composition", "action lines", "speed lines"],
    negativeAdditions: ["static pose", "dull colors", "flat composition"],
    cfgScale: 7.5,
    steps: 30,
    colorHints: ["vibrant", "saturated", "warm highlights", "cool shadows"],
    lightingStyle: "dramatic rim lighting, strong contrast",
    lineArtStyle: "bold thick outlines, confident strokes",
  },
  seinen: {
    stylePrefix: "mature seinen anime style, detailed, atmospheric",
    qualityModifiers: ["masterpiece", "best quality", "intricate details", "atmospheric", "cinematic"],
    negativeAdditions: ["childish", "overly bright", "simple shading"],
    cfgScale: 8.0,
    steps: 35,
    colorHints: ["muted", "desaturated", "earth tones", "selective color"],
    lightingStyle: "natural lighting, subtle shadows, volumetric",
    lineArtStyle: "fine detailed lines, hatching, cross-hatching",
  },
  shoujo: {
    stylePrefix: "elegant shoujo anime style, soft, romantic",
    qualityModifiers: ["masterpiece", "best quality", "soft lighting", "sparkles", "flower motifs"],
    negativeAdditions: ["harsh shadows", "gritty", "dark atmosphere"],
    cfgScale: 7.0,
    steps: 28,
    colorHints: ["pastel", "pink", "lavender", "soft gradients", "warm"],
    lightingStyle: "soft diffused lighting, backlit, lens flare",
    lineArtStyle: "thin elegant lines, flowing curves, decorative",
  },
  mecha: {
    stylePrefix: "mecha anime style, mechanical detail, sci-fi",
    qualityModifiers: ["masterpiece", "best quality", "mechanical precision", "reflective surfaces", "hard surface"],
    negativeAdditions: ["organic only", "soft edges", "watercolor"],
    cfgScale: 8.0,
    steps: 35,
    colorHints: ["metallic", "chrome", "neon accents", "dark steel"],
    lightingStyle: "industrial lighting, reflections, HDR",
    lineArtStyle: "precise technical lines, sharp edges, panel lines",
  },
  chibi: {
    stylePrefix: "chibi anime style, cute, super-deformed, big head small body",
    qualityModifiers: ["masterpiece", "best quality", "cute", "kawaii", "simplified"],
    negativeAdditions: ["realistic proportions", "detailed anatomy", "dark"],
    cfgScale: 7.0,
    steps: 25,
    colorHints: ["bright", "pastel", "candy colors", "cheerful"],
    lightingStyle: "flat bright lighting, minimal shadows, even illumination",
    lineArtStyle: "thick rounded outlines, simplified features, cute proportions",
  },
  cyberpunk: {
    stylePrefix: "cyberpunk anime style, neon-lit, dystopian",
    qualityModifiers: ["masterpiece", "best quality", "neon glow", "rain reflections", "holographic"],
    negativeAdditions: ["natural setting", "bright daylight", "pastoral"],
    cfgScale: 7.5,
    steps: 32,
    colorHints: ["neon pink", "electric blue", "deep purple", "dark backgrounds"],
    lightingStyle: "neon lighting, volumetric fog, wet reflections",
    lineArtStyle: "sharp angular lines, glitch effects, digital artifacts",
  },
  watercolor: {
    stylePrefix: "watercolor anime style, soft washes, paper texture, flowing colors",
    qualityModifiers: ["masterpiece", "best quality", "watercolor painting", "soft edges", "color bleeding"],
    negativeAdditions: ["sharp lines", "digital look", "flat colors", "hard edges"],
    cfgScale: 7.0,
    steps: 30,
    colorHints: ["transparent washes", "soft gradients", "wet-on-wet", "paper white"],
    lightingStyle: "soft diffused lighting, watercolor luminosity, paper texture showing through",
    lineArtStyle: "light pencil underdrawing, ink wash outlines, organic edges",
  },
  noir: {
    stylePrefix: "noir anime style, high contrast, dramatic shadows, film noir",
    qualityModifiers: ["masterpiece", "best quality", "high contrast", "dramatic shadows", "cinematic"],
    negativeAdditions: ["bright", "cheerful", "colorful", "flat lighting"],
    cfgScale: 8.5,
    steps: 35,
    colorHints: ["monochrome", "deep blacks", "selective color", "smoke gray"],
    lightingStyle: "low-key lighting, venetian blind shadows, single harsh light source",
    lineArtStyle: "heavy inking, stark black areas, minimal midtones, chiaroscuro",
  },
  realistic: {
    stylePrefix: "realistic anime style, semi-realistic, detailed anatomy, photorealistic lighting",
    qualityModifiers: ["masterpiece", "best quality", "highly detailed", "photorealistic", "anatomically correct"],
    negativeAdditions: ["chibi", "super-deformed", "flat colors", "simple"],
    cfgScale: 8.0,
    steps: 35,
    colorHints: ["natural skin tones", "realistic shadows", "subsurface scattering", "ambient occlusion"],
    lightingStyle: "physically-based lighting, global illumination, realistic shadows",
    lineArtStyle: "fine detailed lines, minimal outlines, rendering-focused, subtle edges",
  },
  default: {
    stylePrefix: "anime style, high quality illustration",
    qualityModifiers: ["masterpiece", "best quality", "detailed", "sharp"],
    negativeAdditions: ["low quality", "blurry", "deformed"],
    cfgScale: 7.5,
    steps: 30,
    colorHints: ["balanced", "harmonious"],
    lightingStyle: "balanced lighting, soft shadows",
    lineArtStyle: "clean anime lines, consistent weight",
  },
};

// ─── Negative Prompt Base ────────────────────────────────────────────────────

const BASE_NEGATIVE_PROMPT = [
  "low quality", "worst quality", "blurry", "deformed", "disfigured",
  "bad anatomy", "bad hands", "extra fingers", "missing fingers",
  "text", "watermark", "signature", "username", "jpeg artifacts",
  "cropped", "out of frame", "duplicate", "morbid", "mutilated",
].join(", ");

// ─── Camera Angle Modifiers ──────────────────────────────────────────────────

const CAMERA_ANGLE_MODIFIERS: Record<string, string> = {
  "close-up": "close-up shot, face detail, shallow depth of field",
  "medium": "medium shot, waist up, balanced composition",
  "wide": "wide shot, full body, environment visible",
  "extreme_close_up": "extreme close-up, eye detail, macro",
  "bird_eye": "bird's eye view, top-down perspective, overhead",
  "worm_eye": "worm's eye view, looking up, dramatic perspective",
  "dutch_angle": "dutch angle, tilted frame, dynamic tension",
  "over_shoulder": "over the shoulder shot, depth, foreground blur",
  "establishing": "establishing shot, wide landscape, setting context",
  "action": "dynamic action shot, motion blur, impact frame",
};

// ─── Mood Modifiers ──────────────────────────────────────────────────────────

const MOOD_MODIFIERS: Record<string, string> = {
  "tense": "tense atmosphere, tight framing, dark shadows",
  "peaceful": "peaceful atmosphere, soft lighting, calm composition",
  "dramatic": "dramatic atmosphere, high contrast, strong shadows",
  "comedic": "bright atmosphere, exaggerated expressions, chibi elements",
  "romantic": "romantic atmosphere, soft focus, warm tones, sparkles",
  "mysterious": "mysterious atmosphere, fog, silhouettes, hidden details",
  "epic": "epic scale, vast landscape, dramatic sky, heroic pose",
  "melancholic": "melancholic atmosphere, rain, muted colors, solitude",
  "energetic": "high energy, speed lines, bright colors, dynamic pose",
  "dark": "dark atmosphere, minimal lighting, ominous shadows",
};

// ─── Time of Day Modifiers ───────────────────────────────────────────────────

const TIME_OF_DAY_MODIFIERS: Record<string, string> = {
  "dawn": "dawn lighting, pink sky, long shadows, misty",
  "morning": "morning light, bright, fresh, clear sky",
  "noon": "midday sun, harsh shadows, bright colors",
  "afternoon": "afternoon golden light, warm tones",
  "sunset": "sunset, orange sky, golden hour, long shadows",
  "dusk": "dusk, purple sky, fading light, silhouettes",
  "night": "nighttime, moonlight, stars, artificial lights",
  "midnight": "deep night, minimal light, darkness, neon",
};

// ─── Implementation ──────────────────────────────────────────────────────────

export class DefaultPromptStyleAdapter implements PromptStyleAdapter {
  augment(basePrompt: string, context: PromptStyleContext): PromptAugmentation {
    const template = this.getGenreTemplate(context.genre);
    const qualityTags: string[] = [...template.qualityModifiers];
    const styleTags: string[] = [template.stylePrefix];
    const characterDescriptors: string[] = [];
    const sakufuuModifiers: string[] = [];

    // 1. Add camera angle modifier
    if (context.cameraAngle) {
      const camMod = CAMERA_ANGLE_MODIFIERS[context.cameraAngle] ||
        CAMERA_ANGLE_MODIFIERS[context.cameraAngle.toLowerCase().replace(/\s+/g, "_")];
      if (camMod) styleTags.push(camMod);
    }

    // 2. Add mood modifier
    if (context.mood) {
      const moodMod = MOOD_MODIFIERS[context.mood] ||
        MOOD_MODIFIERS[context.mood.toLowerCase()];
      if (moodMod) styleTags.push(moodMod);
    }

    // 3. Add time of day
    if (context.timeOfDay) {
      const timeMod = TIME_OF_DAY_MODIFIERS[context.timeOfDay] ||
        TIME_OF_DAY_MODIFIERS[context.timeOfDay.toLowerCase()];
      if (timeMod) styleTags.push(timeMod);
    }

    // 4. Add lighting and line art from genre template
    styleTags.push(template.lightingStyle);
    styleTags.push(template.lineArtStyle);

    // 5. Build character descriptors
    if (context.characters && context.characters.length > 0) {
      for (const char of context.characters) {
        const descriptor = this.buildCharacterDescriptor(char);
        characterDescriptors.push(descriptor);
      }
    }

    // 6. Apply sakufuu bias
    if (context.sakufuuBias?.active) {
      const mods = this.applySakufuuBias(context.sakufuuBias);
      sakufuuModifiers.push(...mods);
    }

    // 7. Frame type modifier
    if (context.frameType === "key") {
      qualityTags.push("highly detailed", "key frame");
    } else if (context.frameType === "inbetween") {
      qualityTags.push("smooth motion", "in-between frame");
    }

    // 8. Location context
    if (context.location) {
      styleTags.push(`setting: ${context.location}`);
    }

    // 9. Compose the final prompt
    const promptParts: string[] = [];

    // Quality tags first
    promptParts.push(qualityTags.join(", "));

    // Style prefix and modifiers
    promptParts.push(styleTags.join(", "));

    // Character descriptors (with trigger words)
    if (characterDescriptors.length > 0) {
      promptParts.push(characterDescriptors.join(", "));
    }

    // Sakufuu modifiers
    if (sakufuuModifiers.length > 0) {
      promptParts.push(sakufuuModifiers.join(", "));
    }

    // Base prompt (user's visual description)
    promptParts.push(basePrompt);

    // Style weight based on confidence
    let styleWeight = 0.7; // Default
    if (context.sakufuuBias?.active) {
      styleWeight = Math.min(0.9, 0.7 + context.sakufuuBias.confidence * 0.2);
    }

    // Build negative prompt
    const negativePrompt = this.getNegativePrompt(context.genre);

    return {
      prompt: promptParts.filter(Boolean).join(", "),
      negativePrompt,
      styleWeight,
      qualityTags,
      styleTags,
      characterDescriptors,
      sakufuuModifiers,
    };
  }

  getGenreTemplate(genre: GenreTag): GenrePromptTemplate {
    return GENRE_PROMPT_TEMPLATES[genre] || GENRE_PROMPT_TEMPLATES.default;
  }

  getNegativePrompt(genre: GenreTag): string {
    const template = this.getGenreTemplate(genre);
    const additions = template.negativeAdditions.join(", ");
    return `${BASE_NEGATIVE_PROMPT}, ${additions}`;
  }

  buildCharacterDescriptor(character: CharacterPromptInfo): string {
    const parts: string[] = [];

    // Add LoRA trigger word first if available
    if (character.loraTriggerWord) {
      parts.push(character.loraTriggerWord);
    }

    // Name reference
    parts.push(`${character.name}`);

    // Visual traits
    const traits = character.visualTraits;
    if (traits.hairColor && traits.hairStyle) {
      parts.push(`${traits.hairColor} ${traits.hairStyle} hair`);
    } else if (traits.hairColor) {
      parts.push(`${traits.hairColor} hair`);
    }

    if (traits.eyeColor) {
      parts.push(`${traits.eyeColor} eyes`);
    }

    if (traits.bodyType) {
      parts.push(traits.bodyType);
    }

    if (traits.clothing) {
      parts.push(`wearing ${traits.clothing}`);
    }

    if (traits.distinguishingFeatures && traits.distinguishingFeatures.length > 0) {
      // Handle both string and array formats (smoke test seeds strings, app UI seeds arrays)
      const features = Array.isArray(traits.distinguishingFeatures)
        ? traits.distinguishingFeatures.join(", ")
        : String(traits.distinguishingFeatures);
      parts.push(features);
    }

    // Emotion
    if (character.emotion) {
      parts.push(`${character.emotion} expression`);
    }

    return `[${parts.join(", ")}]`;
  }

  applySakufuuBias(bias: SakufuuStyleBias): string[] {
    const modifiers: string[] = [];

    // Signature FX
    if (bias.signatureFx.length > 0) {
      modifiers.push(`effects: ${bias.signatureFx.join(", ")}`);
    }

    // Color palette
    if (bias.suggestedPalette.length > 0) {
      const colors = bias.suggestedPalette.slice(0, 3).map(c => c.name).join(", ");
      modifiers.push(`color palette: ${colors}`);
    }

    // Temperature
    if (bias.suggestedTemperature !== "neutral") {
      modifiers.push(`${bias.suggestedTemperature} color temperature`);
    }

    // Camera style (apply top 2 recommendations)
    const topCameras = Object.entries(bias.suggestedCameraStyle)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2);
    if (topCameras.length > 0) {
      const camStyle = topCameras.map(([cam]) => cam).join(", ");
      modifiers.push(`camera tendency: ${camStyle}`);
    }

    return modifiers;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _adapter: PromptStyleAdapter | null = null;

export function getPromptStyleAdapter(): PromptStyleAdapter {
  if (!_adapter) {
    _adapter = new DefaultPromptStyleAdapter();
  }
  return _adapter;
}

/**
 * Override the adapter (for testing or custom implementations).
 */
export function setPromptStyleAdapter(adapter: PromptStyleAdapter): void {
  _adapter = adapter;
}

// ─── Pipeline Integration Helper ─────────────────────────────────────────────

/**
 * Convenience function for pipeline stages (D0/D1.5/D7).
 * Takes a raw visual description and context, returns a fully augmented prompt.
 *
 * @param visualDescription - The panel's visual description
 * @param context - Style context including genre, characters, sakufuu bias
 * @returns Augmented prompt ready for image generation
 */
export function augmentPromptForGeneration(
  visualDescription: string,
  context: PromptStyleContext
): PromptAugmentation {
  const adapter = getPromptStyleAdapter();
  return adapter.augment(visualDescription, context);
}

/**
 * Build a minimal prompt context from project/episode metadata.
 * Used when full context isn't available (e.g., quick generation).
 */
export function buildMinimalContext(
  genre: GenreTag,
  artStyle?: string,
  cameraAngle?: string
): PromptStyleContext {
  return {
    genre,
    artStyle,
    cameraAngle,
    frameType: "key",
  };
}

/**
 * Convert a SakufuuBias (from D9 tracker) to the adapter's SakufuuStyleBias format.
 * This bridges the D9 output format to the prompt adapter input format.
 */
export function convertSakufuuBias(d9Bias: {
  active: boolean;
  signatureFx: string[];
  suggestedPalette: Array<{ name: string; hex: string }>;
  suggestedTemperature: string;
  suggestedPacing: string;
  suggestedCameraStyle: Record<string, number>;
  confidence: number;
}): SakufuuStyleBias {
  return {
    active: d9Bias.active,
    signatureFx: d9Bias.signatureFx,
    suggestedPalette: d9Bias.suggestedPalette,
    suggestedTemperature: (d9Bias.suggestedTemperature as "warm" | "cool" | "neutral") || "neutral",
    suggestedPacing: (d9Bias.suggestedPacing as "fast" | "moderate" | "slow" | "dynamic") || "moderate",
    suggestedCameraStyle: d9Bias.suggestedCameraStyle,
    confidence: d9Bias.confidence,
  };
}
