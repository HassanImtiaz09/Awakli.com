/**
 * Simple Path Pipeline — Unit Tests
 * 
 * Tests the individual stages and orchestrator logic.
 * Does NOT call external APIs (mocked).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Beat, CharacterReference, BeatSegmentationOutput } from "./types";

// Mock the LLM helper
const mockLLMResponse: BeatSegmentationOutput = {
  beats: [
    {
      id: "beat_001",
      sceneNumber: 1,
      beatNumber: 1,
      description: "@mira throws a spinning kick at @kazuo in the dojo, cherry blossoms drifting through open windows",
      characters: ["mira", "kazuo"],
      cameraAngle: "tracking_pan",
      lighting: "warm afternoon sunlight",
      mood: "intense",
      durationTargetSeconds: 5,
      dialogue: [],
      sfx: [{ type: "whoosh", timestampOffsetMs: 0, volume: 0.8 }],
      transition: "cut",
      styleAnchor: "Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic, sakuga action",
    },
    {
      id: "beat_002",
      sceneNumber: 1,
      beatNumber: 2,
      description: "@mira stands breathing heavily, wiping sweat from her brow in the dojo",
      characters: ["mira"],
      cameraAngle: "medium_close_up",
      lighting: "soft diffused light",
      mood: "reflective",
      durationTargetSeconds: 4,
      dialogue: [
        { characterName: "mira", text: "I won't hold back anymore.", emotion: "determined", estimatedDurationSeconds: 2 },
      ],
      sfx: [],
      transition: "cut",
      styleAnchor: "Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic, character moment",
    },
    {
      id: "beat_003",
      sceneNumber: 1,
      beatNumber: 3,
      description: "Wide shot of the traditional Japanese dojo at sunset, warm golden light streaming through paper screens",
      characters: [],
      cameraAngle: "wide_establishing",
      lighting: "golden hour sunset",
      mood: "serene",
      durationTargetSeconds: 3,
      dialogue: [],
      sfx: [{ type: "wind", timestampOffsetMs: 0, volume: 0.4 }],
      transition: "fade_to_black",
      styleAnchor: "Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic, establishing beauty",
    },
  ],
  totalDurationSeconds: 12,
  totalBeats: 3,
  musicCues: [
    {
      startBeatId: "beat_001",
      endBeatId: "beat_003",
      mood: "epic_tension",
      intensity: 0.7,
    },
  ],
};

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify(mockLLMResponse),
        },
      },
    ],
  }),
}));

// Mock fal.ai client
vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    subscribe: vi.fn().mockResolvedValue({
      data: {
        video: { url: "https://example.com/generated-video.mp4" },
      },
      requestId: "req_test_123",
    }),
  },
}));

// Mock fetch for voice/lip-sync APIs
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("Simple Path Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("Stage 1: Beat Segmentation", () => {
    it("should parse LLM response into typed beats", async () => {
      const { runBeatSegmentation } = await import("./stages/stage1-beat-segmentation");

      const result = await runBeatSegmentation({
        script: "Mira trains in the dojo. She faces Kazuo in a sparring match. The sun sets over the mountains.",
        episodeTitle: "First Light - Episode 1",
        characterNames: ["mira", "kazuo", "renji"],
      });

      expect(result).toBeDefined();
      expect(result.beats).toHaveLength(3);
      expect(result.totalBeats).toBe(3);
      expect(result.totalDurationSeconds).toBe(12);

      // Validate beat structure
      const beat1 = result.beats[0];
      expect(beat1.id).toBe("beat_001");
      expect(beat1.characters).toContain("mira");
      expect(beat1.characters).toContain("kazuo");
      expect(beat1.durationTargetSeconds).toBe(5);
      expect(beat1.description).toContain("@mira");

      // Dialogue beat
      const beat2 = result.beats[1];
      expect(beat2.dialogue).toHaveLength(1);
      expect(beat2.dialogue[0].characterName).toBe("mira");
      expect(beat2.dialogue[0].text).toBe("I won't hold back anymore.");
    });

    it("should throw when LLM returns no beats", async () => {
      const { invokeLLM } = await import("../_core/llm");
      (invokeLLM as any).mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                beats: [],
                totalDurationSeconds: 0,
                totalBeats: 0,
                musicCues: [],
              }),
            },
          },
        ],
      });

      const { runBeatSegmentation } = await import("./stages/stage1-beat-segmentation");

      await expect(
        runBeatSegmentation({
          script: "Short scene.",
          episodeTitle: "Test",
          characterNames: ["mira"],
        })
      ).rejects.toThrow("No beats generated");
    });
  });

  describe("Stage 2: Character References", () => {
    it("should build character reference map from input", async () => {
      const { buildCharacterRefs } = await import("./stages/stage2-character-refs");

      const refs = await buildCharacterRefs({
        characters: [
          {
            name: "mira",
            referenceImageUrl: "https://example.com/mira.png",
            descriptor: "16-year-old martial artist",
            visualTraits: {
              hair: "black ponytail with magenta tips",
              eyes: "brown, determined",
              clothing: "white sleeveless gi with red sash",
              distinguishingFeatures: ["black fingerless gloves", "bandaged shins"],
            },
            isDarkCharacter: false,
          },
          {
            name: "renji",
            referenceImageUrl: "https://example.com/renji.png",
            descriptor: "half-demon mercenary",
            visualTraits: {
              hair: "long black, wild",
              eyes: "one green, one glowing red",
              clothing: "dark grey sleeveless combat top",
              distinguishingFeatures: ["burned/scaled right side of face", "demonic markings"],
            },
            isDarkCharacter: true,
          },
        ],
      });

      expect(refs).toHaveLength(2);
      expect(refs[0].name).toBe("mira");
      expect(refs[0].referenceImageUrl).toBe("https://example.com/mira.png");
      expect(refs[0].isDarkCharacter).toBe(false);
      expect(refs[1].name).toBe("renji");
      expect(refs[1].isDarkCharacter).toBe(true);
    });

    it("should include FIRST_LIGHT_CHARACTERS fixture", async () => {
      const { FIRST_LIGHT_CHARACTERS } = await import("./stages/stage2-character-refs");

      expect(FIRST_LIGHT_CHARACTERS).toHaveLength(3);
      const names = FIRST_LIGHT_CHARACTERS.map((c) => c.name);
      expect(names).toContain("mira");
      expect(names).toContain("kazuo");
      expect(names).toContain("renji");

      // Renji should be marked as dark character
      const renji = FIRST_LIGHT_CHARACTERS.find((c) => c.name === "renji");
      expect(renji?.isDarkCharacter).toBe(true);
    });
  });

  describe("Stage 3: Video Generation", () => {
    it("should call fal.ai with correct C1 parameters", async () => {
      const { fal } = await import("@fal-ai/client");
      const { generateC1Video } = await import("./stages/stage3-video-gen");

      const testBeat: Beat = {
        id: "beat_test",
        sceneNumber: 1,
        beatNumber: 1,
        description: "@mira throws a kick in the dojo",
        characters: ["mira"],
        cameraAngle: "medium_shot",
        lighting: "bright daylight",
        mood: "action",
        durationTargetSeconds: 5,
        dialogue: [],
        sfx: [],
        transition: "cut",
        styleAnchor: "sakuga_action",
      };

      const testCharRef: CharacterReference = {
        name: "mira",
        referenceImageUrl: "https://example.com/mira.png",
        croppedRegionUrl: "https://example.com/mira.png",
        descriptor: "martial artist",
        visualTraits: {
          hair: "black ponytail",
          eyes: "brown",
          clothing: "white gi",
          distinguishingFeatures: [],
        },
        isDarkCharacter: false,
      };

      const result = await generateC1Video({
        beat: testBeat,
        characters: [testCharRef],
        resolution: "720p",
      });

      expect(fal.subscribe).toHaveBeenCalledWith(
        "fal-ai/pixverse/c1/reference-to-video",
        expect.objectContaining({
          input: expect.objectContaining({
            image_references: expect.arrayContaining([
              expect.objectContaining({
                ref_name: "mira",
                type: "subject",
              }),
            ]),
          }),
        })
      );

      expect(result.videoUrl).toBe("https://example.com/generated-video.mp4");
    });
  });

  describe("Stage 4: Voice + Lip-Sync", () => {
    it("should have First Light voice assignments for all 3 characters", async () => {
      const { FIRST_LIGHT_VOICE_ASSIGNMENTS } = await import("./stages/stage4-voice-lipsync");

      expect(FIRST_LIGHT_VOICE_ASSIGNMENTS).toHaveLength(3);
      const names = FIRST_LIGHT_VOICE_ASSIGNMENTS.map((v) => v.characterName);
      expect(names).toContain("mira");
      expect(names).toContain("kazuo");
      expect(names).toContain("renji");

      // All should use elevenlabs as primary
      FIRST_LIGHT_VOICE_ASSIGNMENTS.forEach((v) => {
        expect(v.provider).toBe("elevenlabs");
        expect(v.voiceId).toBeTruthy();
      });
    });
  });

  describe("Prompt Templates", () => {
    it("should apply dark character lighting mitigation", async () => {
      const { applyDarkCharLighting } = await import("./templates/prompt-templates");

      const darkBeat: Beat = {
        id: "beat_dark",
        sceneNumber: 1,
        beatNumber: 1,
        description: "@renji stands in the shadows of a dark alley at night",
        characters: ["renji"],
        cameraAngle: "low_angle",
        lighting: "dim moonlight",
        mood: "menacing",
        durationTargetSeconds: 5,
        dialogue: [],
        sfx: [],
        transition: "cut",
        styleAnchor: "dark_atmosphere",
      };

      const darkCharRef: CharacterReference = {
        name: "renji",
        referenceImageUrl: "https://example.com/renji.png",
        croppedRegionUrl: "https://example.com/renji.png",
        descriptor: "half-demon",
        visualTraits: {
          hair: "long black, wild",
          eyes: "one green, one glowing red",
          clothing: "dark grey combat top",
          distinguishingFeatures: ["burned/scaled right side of face", "glowing red eye"],
        },
        isDarkCharacter: true,
      };

      const enhanced = applyDarkCharLighting(darkBeat, [darkCharRef]);

      // Should return a lighting override string for dark characters on dark backgrounds
      expect(enhanced).toBeDefined();
      if (enhanced) {
        // Lighting mitigation should mention the character's distinguishing features
        expect(enhanced.toLowerCase()).toContain("renji");
      }
    });

    it("should return undefined for non-dark characters", async () => {
      const { applyDarkCharLighting } = await import("./templates/prompt-templates");

      const brightBeat: Beat = {
        id: "beat_bright",
        sceneNumber: 1,
        beatNumber: 1,
        description: "@mira trains in the bright dojo",
        characters: ["mira"],
        cameraAngle: "medium",
        lighting: "bright sunlight",
        mood: "energetic",
        durationTargetSeconds: 4,
        dialogue: [],
        sfx: [],
        transition: "cut",
        styleAnchor: "training",
      };

      const lightCharRef: CharacterReference = {
        name: "mira",
        referenceImageUrl: "https://example.com/mira.png",
        croppedRegionUrl: "https://example.com/mira.png",
        descriptor: "martial artist",
        visualTraits: {
          hair: "black ponytail",
          eyes: "brown",
          clothing: "white gi",
          distinguishingFeatures: [],
        },
        isDarkCharacter: false,
      };

      const result = applyDarkCharLighting(brightBeat, [lightCharRef]);
      // No dark characters, should return undefined
      expect(result).toBeUndefined();
    });
  });

  describe("Provider Router", () => {
    it("should return default fal.ai config", async () => {
      const { getActiveConfig } = await import("./provider-router");

      const config = getActiveConfig();
      expect(config.video.primary).toBe("fal_pixverse_c1");
      expect(config.lipSync.primary).toBe("fal_pixverse_lipsync");
      expect(config.voice.primary).toBe("elevenlabs");
    });

    it("should have direct PixVerse config available for contingency", async () => {
      const { DIRECT_PIXVERSE_CONFIG } = await import("./provider-router");

      expect(DIRECT_PIXVERSE_CONFIG.video.primary).toBe("direct_pixverse_c1");
      expect(DIRECT_PIXVERSE_CONFIG.lipSync.primary).toBe("direct_pixverse_lipsync");
      // Voice stays elevenlabs regardless
      expect(DIRECT_PIXVERSE_CONFIG.voice.primary).toBe("elevenlabs");
    });
  });

  describe("Fixtures", () => {
    it("should build First Light config with all required fields", async () => {
      const { buildFirstLightConfig } = await import("./fixtures/first-light");

      const config = buildFirstLightConfig(1, 1, 1, 1, {
        referenceImageUrls: {
          mira: "https://example.com/mira.png",
          kazuo: "https://example.com/kazuo.png",
          renji: "https://example.com/renji.png",
        },
      });

      expect(config.pipelineRunId).toBe(1);
      expect(config.episodeTitle).toContain("First Light");
      expect(config.characters).toHaveLength(3);
      expect(config.voiceAssignments).toHaveLength(3);
      expect(config.script).toBeTruthy();
      expect(config.script.length).toBeGreaterThan(100);
    });
  });
});
