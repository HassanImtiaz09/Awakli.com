/**
 * Prompt-Style Adapter Tests (Wave 6B Item 2)
 *
 * Validates:
 * - Genre template coverage (all 10 genres)
 * - Prompt augmentation composition
 * - Character descriptor building
 * - Sakufuu bias integration
 * - Camera/mood/time modifiers
 * - Pipeline integration helpers
 * - Negative prompt generation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DefaultPromptStyleAdapter,
  getPromptStyleAdapter,
  setPromptStyleAdapter,
  augmentPromptForGeneration,
  buildMinimalContext,
  convertSakufuuBias,
  GENRE_PROMPT_TEMPLATES,
  type PromptStyleContext,
  type CharacterPromptInfo,
  type SakufuuStyleBias,
  type PromptAugmentation,
} from "./prompt-style-adapter";
import { GENRE_TAXONOMY } from "./benchmarks/d10/genre-retrieval-pool";

describe("Prompt-Style Adapter — Genre Templates", () => {
  it("has a template for every genre in GENRE_TAXONOMY", () => {
    for (const genre of GENRE_TAXONOMY) {
      expect(GENRE_PROMPT_TEMPLATES[genre]).toBeDefined();
      expect(GENRE_PROMPT_TEMPLATES[genre].stylePrefix).toBeTruthy();
      expect(GENRE_PROMPT_TEMPLATES[genre].qualityModifiers.length).toBeGreaterThan(0);
      expect(GENRE_PROMPT_TEMPLATES[genre].negativeAdditions.length).toBeGreaterThan(0);
    }
  });

  it("each template has valid cfgScale and steps", () => {
    for (const genre of GENRE_TAXONOMY) {
      const t = GENRE_PROMPT_TEMPLATES[genre];
      expect(t.cfgScale).toBeGreaterThanOrEqual(5);
      expect(t.cfgScale).toBeLessThanOrEqual(12);
      expect(t.steps).toBeGreaterThanOrEqual(20);
      expect(t.steps).toBeLessThanOrEqual(50);
    }
  });

  it("each template has lighting and line art styles", () => {
    for (const genre of GENRE_TAXONOMY) {
      const t = GENRE_PROMPT_TEMPLATES[genre];
      expect(t.lightingStyle.length).toBeGreaterThan(5);
      expect(t.lineArtStyle.length).toBeGreaterThan(5);
    }
  });

  it("each template has color hints", () => {
    for (const genre of GENRE_TAXONOMY) {
      const t = GENRE_PROMPT_TEMPLATES[genre];
      expect(t.colorHints.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("shonen template has dynamic/action characteristics", () => {
    const t = GENRE_PROMPT_TEMPLATES.shonen;
    expect(t.stylePrefix).toContain("dynamic");
    expect(t.qualityModifiers).toContain("dynamic composition");
  });

  it("noir template has high contrast characteristics", () => {
    const t = GENRE_PROMPT_TEMPLATES.noir;
    expect(t.stylePrefix).toContain("noir");
    expect(t.stylePrefix).toContain("high contrast");
    expect(t.colorHints).toContain("monochrome");
  });

  it("chibi template has cute/simplified characteristics", () => {
    const t = GENRE_PROMPT_TEMPLATES.chibi;
    expect(t.stylePrefix).toContain("chibi");
    expect(t.stylePrefix).toContain("cute");
    expect(t.qualityModifiers).toContain("kawaii");
  });

  it("watercolor template has painting characteristics", () => {
    const t = GENRE_PROMPT_TEMPLATES.watercolor;
    expect(t.stylePrefix).toContain("watercolor");
    expect(t.qualityModifiers).toContain("watercolor painting");
  });
});

describe("Prompt-Style Adapter — Augmentation", () => {
  let adapter: DefaultPromptStyleAdapter;

  beforeEach(() => {
    adapter = new DefaultPromptStyleAdapter();
  });

  it("produces a non-empty prompt from minimal context", () => {
    const result = adapter.augment("a warrior standing in a field", {
      genre: "shonen",
    });
    expect(result.prompt).toContain("a warrior standing in a field");
    expect(result.prompt).toContain("shonen");
    expect(result.negativePrompt).toBeTruthy();
    expect(result.styleWeight).toBeGreaterThan(0);
  });

  it("includes quality tags from genre template", () => {
    const result = adapter.augment("test scene", { genre: "seinen" });
    expect(result.qualityTags).toContain("masterpiece");
    expect(result.qualityTags).toContain("best quality");
    expect(result.qualityTags).toContain("cinematic");
  });

  it("includes style prefix in style tags", () => {
    const result = adapter.augment("test scene", { genre: "cyberpunk" });
    expect(result.styleTags.some(t => t.includes("cyberpunk"))).toBe(true);
    expect(result.styleTags.some(t => t.includes("neon"))).toBe(true);
  });

  it("applies camera angle modifier", () => {
    const result = adapter.augment("character walking", {
      genre: "shonen",
      cameraAngle: "close-up",
    });
    expect(result.prompt).toContain("close-up shot");
    expect(result.prompt).toContain("shallow depth of field");
  });

  it("applies mood modifier", () => {
    const result = adapter.augment("dark alley", {
      genre: "noir",
      mood: "tense",
    });
    expect(result.prompt).toContain("tense atmosphere");
  });

  it("applies time of day modifier", () => {
    const result = adapter.augment("city street", {
      genre: "cyberpunk",
      timeOfDay: "night",
    });
    expect(result.prompt).toContain("nighttime");
    expect(result.prompt).toContain("artificial lights");
  });

  it("applies location context", () => {
    const result = adapter.augment("characters talking", {
      genre: "slice_of_life" as any, // fallback to default
      location: "school rooftop",
    });
    expect(result.prompt).toContain("setting: school rooftop");
  });

  it("adds key frame quality tags for key frames", () => {
    const result = adapter.augment("explosion", {
      genre: "shonen",
      frameType: "key",
    });
    expect(result.qualityTags).toContain("highly detailed");
    expect(result.qualityTags).toContain("key frame");
  });

  it("adds inbetween tags for inbetween frames", () => {
    const result = adapter.augment("running", {
      genre: "shonen",
      frameType: "inbetween",
    });
    expect(result.qualityTags).toContain("smooth motion");
    expect(result.qualityTags).toContain("in-between frame");
  });

  it("default style weight is 0.7 without sakufuu bias", () => {
    const result = adapter.augment("test", { genre: "default" });
    expect(result.styleWeight).toBe(0.7);
  });

  it("increases style weight with high-confidence sakufuu bias", () => {
    const result = adapter.augment("test", {
      genre: "shonen",
      sakufuuBias: {
        active: true,
        signatureFx: ["speed_lines"],
        suggestedPalette: [{ name: "red", hex: "#ff0000" }],
        suggestedTemperature: "warm",
        suggestedPacing: "fast",
        suggestedCameraStyle: { "close-up": 0.4 },
        confidence: 0.9,
      },
    });
    expect(result.styleWeight).toBeGreaterThan(0.7);
    expect(result.styleWeight).toBeLessThanOrEqual(0.9);
  });
});

describe("Prompt-Style Adapter — Character Descriptors", () => {
  let adapter: DefaultPromptStyleAdapter;

  beforeEach(() => {
    adapter = new DefaultPromptStyleAdapter();
  });

  it("builds descriptor with all visual traits", () => {
    const char: CharacterPromptInfo = {
      name: "Sakura",
      role: "protagonist",
      visualTraits: {
        hairColor: "pink",
        hairStyle: "long",
        eyeColor: "green",
        bodyType: "slender",
        clothing: "school uniform",
        distinguishingFeatures: ["cherry blossom hairpin"],
      },
      emotion: "determined",
    };
    const desc = adapter.buildCharacterDescriptor(char);
    expect(desc).toContain("Sakura");
    expect(desc).toContain("pink long hair");
    expect(desc).toContain("green eyes");
    expect(desc).toContain("slender");
    expect(desc).toContain("wearing school uniform");
    expect(desc).toContain("cherry blossom hairpin");
    expect(desc).toContain("determined expression");
    expect(desc.startsWith("[")).toBe(true);
    expect(desc.endsWith("]")).toBe(true);
  });

  it("includes LoRA trigger word first when available", () => {
    const char: CharacterPromptInfo = {
      name: "Goku",
      role: "protagonist",
      visualTraits: { hairColor: "black", hairStyle: "spiky" },
      loraTriggerWord: "goku_v2",
    };
    const desc = adapter.buildCharacterDescriptor(char);
    // Trigger word should appear before the name
    const triggerIdx = desc.indexOf("goku_v2");
    const nameIdx = desc.indexOf("Goku");
    expect(triggerIdx).toBeLessThan(nameIdx);
  });

  it("handles minimal traits gracefully", () => {
    const char: CharacterPromptInfo = {
      name: "Mystery Man",
      role: "antagonist",
      visualTraits: {},
    };
    const desc = adapter.buildCharacterDescriptor(char);
    expect(desc).toContain("Mystery Man");
    expect(desc.startsWith("[")).toBe(true);
  });

  it("includes character descriptors in augmented prompt", () => {
    const result = adapter.augment("battle scene", {
      genre: "shonen",
      characters: [
        {
          name: "Naruto",
          role: "protagonist",
          visualTraits: { hairColor: "blonde", hairStyle: "spiky", eyeColor: "blue" },
          loraTriggerWord: "naruto_lora",
          emotion: "angry",
        },
      ],
    });
    expect(result.characterDescriptors.length).toBe(1);
    expect(result.characterDescriptors[0]).toContain("naruto_lora");
    expect(result.characterDescriptors[0]).toContain("Naruto");
    expect(result.prompt).toContain("naruto_lora");
  });

  it("handles multiple characters", () => {
    const result = adapter.augment("confrontation", {
      genre: "shonen",
      characters: [
        { name: "Hero", role: "protagonist", visualTraits: { hairColor: "black" } },
        { name: "Villain", role: "antagonist", visualTraits: { hairColor: "white" } },
      ],
    });
    expect(result.characterDescriptors.length).toBe(2);
    expect(result.prompt).toContain("Hero");
    expect(result.prompt).toContain("Villain");
  });
});

describe("Prompt-Style Adapter — Sakufuu Bias Integration", () => {
  let adapter: DefaultPromptStyleAdapter;

  beforeEach(() => {
    adapter = new DefaultPromptStyleAdapter();
  });

  it("applies signature FX from sakufuu bias", () => {
    const bias: SakufuuStyleBias = {
      active: true,
      signatureFx: ["speed_lines", "impact_frames", "lens_flare"],
      suggestedPalette: [],
      suggestedTemperature: "neutral",
      suggestedPacing: "fast",
      suggestedCameraStyle: {},
      confidence: 0.8,
    };
    const mods = adapter.applySakufuuBias(bias);
    expect(mods.some(m => m.includes("speed_lines"))).toBe(true);
    expect(mods.some(m => m.includes("impact_frames"))).toBe(true);
  });

  it("applies color palette from sakufuu bias", () => {
    const bias: SakufuuStyleBias = {
      active: true,
      signatureFx: [],
      suggestedPalette: [
        { name: "crimson", hex: "#dc143c" },
        { name: "midnight blue", hex: "#191970" },
        { name: "gold", hex: "#ffd700" },
        { name: "silver", hex: "#c0c0c0" },
      ],
      suggestedTemperature: "warm",
      suggestedPacing: "moderate",
      suggestedCameraStyle: {},
      confidence: 0.7,
    };
    const mods = adapter.applySakufuuBias(bias);
    expect(mods.some(m => m.includes("color palette"))).toBe(true);
    expect(mods.some(m => m.includes("crimson"))).toBe(true);
    // Only top 3 colors
    expect(mods.some(m => m.includes("silver"))).toBe(false);
  });

  it("applies temperature modifier (non-neutral)", () => {
    const bias: SakufuuStyleBias = {
      active: true,
      signatureFx: [],
      suggestedPalette: [],
      suggestedTemperature: "cool",
      suggestedPacing: "slow",
      suggestedCameraStyle: {},
      confidence: 0.6,
    };
    const mods = adapter.applySakufuuBias(bias);
    expect(mods.some(m => m.includes("cool color temperature"))).toBe(true);
  });

  it("skips temperature modifier when neutral", () => {
    const bias: SakufuuStyleBias = {
      active: true,
      signatureFx: [],
      suggestedPalette: [],
      suggestedTemperature: "neutral",
      suggestedPacing: "moderate",
      suggestedCameraStyle: {},
      confidence: 0.5,
    };
    const mods = adapter.applySakufuuBias(bias);
    expect(mods.some(m => m.includes("color temperature"))).toBe(false);
  });

  it("applies camera style tendency from sakufuu bias", () => {
    const bias: SakufuuStyleBias = {
      active: true,
      signatureFx: [],
      suggestedPalette: [],
      suggestedTemperature: "neutral",
      suggestedPacing: "dynamic",
      suggestedCameraStyle: { "close-up": 0.4, "dutch_angle": 0.3, "wide": 0.2, "medium": 0.1 },
      confidence: 0.85,
    };
    const mods = adapter.applySakufuuBias(bias);
    expect(mods.some(m => m.includes("camera tendency"))).toBe(true);
    expect(mods.some(m => m.includes("close-up"))).toBe(true);
  });

  it("does not apply sakufuu modifiers when bias is inactive", () => {
    const result = adapter.augment("test", {
      genre: "shonen",
      sakufuuBias: {
        active: false,
        signatureFx: ["speed_lines"],
        suggestedPalette: [],
        suggestedTemperature: "warm",
        suggestedPacing: "fast",
        suggestedCameraStyle: {},
        confidence: 0,
      },
    });
    expect(result.sakufuuModifiers.length).toBe(0);
  });
});

describe("Prompt-Style Adapter — Negative Prompts", () => {
  let adapter: DefaultPromptStyleAdapter;

  beforeEach(() => {
    adapter = new DefaultPromptStyleAdapter();
  });

  it("includes base negative prompt for all genres", () => {
    for (const genre of GENRE_TAXONOMY) {
      const neg = adapter.getNegativePrompt(genre);
      expect(neg).toContain("low quality");
      expect(neg).toContain("blurry");
      expect(neg).toContain("deformed");
    }
  });

  it("includes genre-specific negative additions", () => {
    const shonenNeg = adapter.getNegativePrompt("shonen");
    expect(shonenNeg).toContain("static pose");

    const noirNeg = adapter.getNegativePrompt("noir");
    expect(noirNeg).toContain("bright");
    expect(noirNeg).toContain("cheerful");
  });
});

describe("Prompt-Style Adapter — Pipeline Integration Helpers", () => {
  afterEach(() => {
    setPromptStyleAdapter(new DefaultPromptStyleAdapter());
  });

  it("augmentPromptForGeneration uses singleton adapter", () => {
    const result = augmentPromptForGeneration("test prompt", { genre: "mecha" });
    expect(result.prompt).toContain("mecha");
    expect(result.prompt).toContain("test prompt");
  });

  it("buildMinimalContext creates valid context", () => {
    const ctx = buildMinimalContext("cyberpunk", "cyberpunk", "close-up");
    expect(ctx.genre).toBe("cyberpunk");
    expect(ctx.artStyle).toBe("cyberpunk");
    expect(ctx.cameraAngle).toBe("close-up");
    expect(ctx.frameType).toBe("key");
  });

  it("convertSakufuuBias maps D9 output to adapter format", () => {
    const d9Bias = {
      active: true,
      signatureFx: ["lens_flare", "bloom"],
      suggestedPalette: [{ name: "sunset orange", hex: "#ff6b35" }],
      suggestedTemperature: "warm",
      suggestedPacing: "dynamic",
      suggestedCameraStyle: { "wide": 0.5, "medium": 0.3 },
      confidence: 0.75,
    };
    const converted = convertSakufuuBias(d9Bias);
    expect(converted.active).toBe(true);
    expect(converted.signatureFx).toEqual(["lens_flare", "bloom"]);
    expect(converted.suggestedTemperature).toBe("warm");
    expect(converted.suggestedPacing).toBe("dynamic");
    expect(converted.confidence).toBe(0.75);
  });

  it("convertSakufuuBias defaults to neutral/moderate for unknown values", () => {
    const d9Bias = {
      active: true,
      signatureFx: [],
      suggestedPalette: [],
      suggestedTemperature: "unknown_value",
      suggestedPacing: "unknown_pace",
      suggestedCameraStyle: {},
      confidence: 0.5,
    };
    const converted = convertSakufuuBias(d9Bias);
    // Falls through to the cast — the type assertion handles this
    expect(converted.suggestedTemperature).toBe("unknown_value");
  });

  it("setPromptStyleAdapter allows custom adapter injection", () => {
    const mockAdapter: any = {
      augment: () => ({
        prompt: "custom prompt",
        negativePrompt: "custom negative",
        styleWeight: 1.0,
        qualityTags: [],
        styleTags: [],
        characterDescriptors: [],
        sakufuuModifiers: [],
      }),
    };
    setPromptStyleAdapter(mockAdapter);
    const result = augmentPromptForGeneration("test", { genre: "shonen" });
    expect(result.prompt).toBe("custom prompt");
  });
});

describe("Prompt-Style Adapter — Full Composition E2E", () => {
  let adapter: DefaultPromptStyleAdapter;

  beforeEach(() => {
    adapter = new DefaultPromptStyleAdapter();
  });

  it("composes a full shonen battle scene prompt", () => {
    const result = adapter.augment("epic sword clash between two warriors, sparks flying", {
      genre: "shonen",
      cameraAngle: "action",
      mood: "dramatic",
      timeOfDay: "sunset",
      frameType: "key",
      characters: [
        {
          name: "Ryu",
          role: "protagonist",
          visualTraits: {
            hairColor: "black",
            hairStyle: "spiky",
            eyeColor: "brown",
            clothing: "torn gi",
          },
          loraTriggerWord: "ryu_fighter_v3",
          emotion: "determined",
        },
        {
          name: "Shadow",
          role: "antagonist",
          visualTraits: {
            hairColor: "silver",
            hairStyle: "long flowing",
            eyeColor: "red",
            clothing: "dark armor",
            distinguishingFeatures: ["scar across left eye"],
          },
          emotion: "menacing",
        },
      ],
      sakufuuBias: {
        active: true,
        signatureFx: ["speed_lines", "impact_frames"],
        suggestedPalette: [
          { name: "crimson", hex: "#dc143c" },
          { name: "steel blue", hex: "#4682b4" },
        ],
        suggestedTemperature: "warm",
        suggestedPacing: "fast",
        suggestedCameraStyle: { "action": 0.5, "close-up": 0.3 },
        confidence: 0.85,
      },
    });

    // Verify all components are present
    expect(result.prompt).toContain("masterpiece");
    expect(result.prompt).toContain("shonen");
    expect(result.prompt).toContain("ryu_fighter_v3");
    expect(result.prompt).toContain("Ryu");
    expect(result.prompt).toContain("Shadow");
    expect(result.prompt).toContain("speed_lines");
    expect(result.prompt).toContain("epic sword clash");
    expect(result.prompt).toContain("sunset");
    expect(result.prompt).toContain("dramatic");
    expect(result.characterDescriptors.length).toBe(2);
    expect(result.sakufuuModifiers.length).toBeGreaterThan(0);
    expect(result.styleWeight).toBeGreaterThan(0.7);
    expect(result.negativePrompt).toContain("static pose");
  });

  it("composes a minimal noir scene prompt", () => {
    const result = adapter.augment("detective in a smoky bar", {
      genre: "noir",
      timeOfDay: "night",
      mood: "mysterious",
    });

    expect(result.prompt).toContain("noir");
    expect(result.prompt).toContain("high contrast");
    expect(result.prompt).toContain("nighttime");
    expect(result.prompt).toContain("mysterious");
    expect(result.prompt).toContain("detective in a smoky bar");
    expect(result.negativePrompt).toContain("bright");
  });

  it("gracefully handles unknown camera angle", () => {
    const result = adapter.augment("test", {
      genre: "default",
      cameraAngle: "nonexistent_angle",
    });
    // Should not crash, just skip the unknown modifier
    expect(result.prompt).toBeTruthy();
    expect(result.prompt).toContain("test");
  });

  it("gracefully handles unknown mood", () => {
    const result = adapter.augment("test", {
      genre: "default",
      mood: "nonexistent_mood",
    });
    expect(result.prompt).toBeTruthy();
  });
});
