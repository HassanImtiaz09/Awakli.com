/**
 * D7 FX Compositor Integration Test
 *
 * Tests the full FX compositor flow:
 *   - Ekonte tag parsing (PRIMARY source)
 *   - Genre profile classification and FX filtering
 *   - LLM suggestion (SECONDARY, only when ekonte absent)
 *   - User preference modulation
 *   - FFmpeg filter chain building
 *   - Batch composition with cost tracking
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// Mock logger
vi.mock("./observability/logger", () => ({
  pipelineLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  parseEkonteTags,
  suggestFxFromLlm,
  buildFilterComplex,
  buildFfmpegCommand,
  applyUserPreferences,
  composeFxBatch,
  classifyAnimeType,
  GENRE_PROFILES,
  EKONTE_TAG_MAP,
  FX_CATEGORIES,
  FFMPEG_FILTERS,
  COST_PER_FX_RENDER,
  COST_PER_LLM_SUGGESTION,
  type AnimeFxType,
  type FxSpec,
  type UserFxPreferences,
  type CompositorInput,
} from "./benchmarks/d7-fx-compositor/fx-compositor";
import { invokeLLM } from "./_core/llm";

const mockInvokeLLM = vi.mocked(invokeLLM);

describe("D7 FX Compositor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Anime Type Classification ──────────────────────────────────────────

  describe("classifyAnimeType", () => {
    it("maps shonen animeStyle directly", () => {
      expect(classifyAnimeType("shonen")).toBe("shonen");
      expect(classifyAnimeType("mecha")).toBe("shonen");
    });

    it("maps shoujo animeStyle directly", () => {
      expect(classifyAnimeType("shoujo")).toBe("shoujo");
    });

    it("maps seinen-adjacent styles", () => {
      expect(classifyAnimeType("seinen")).toBe("seinen");
      expect(classifyAnimeType("cyberpunk")).toBe("seinen");
      expect(classifyAnimeType("noir")).toBe("seinen");
      expect(classifyAnimeType("realistic")).toBe("seinen");
    });

    it("maps kodomomuke styles", () => {
      expect(classifyAnimeType("chibi")).toBe("kodomomuke");
      expect(classifyAnimeType("watercolor")).toBe("kodomomuke");
    });

    it("falls back to genre-based classification", () => {
      expect(classifyAnimeType("custom", "josei drama")).toBe("josei");
      expect(classifyAnimeType("custom", "children adventure")).toBe("kodomomuke");
      expect(classifyAnimeType("custom", "psychological horror")).toBe("seinen");
      expect(classifyAnimeType("custom", "magical girl")).toBe("shoujo");
    });

    it("defaults to shonen when unrecognized", () => {
      expect(classifyAnimeType("unknown", "unknown")).toBe("shonen");
    });
  });

  // ─── Ekonte Tag Parsing ─────────────────────────────────────────────────

  describe("parseEkonteTags", () => {
    const shonenProfile = GENRE_PROFILES.shonen;
    const shoujoProfile = GENRE_PROFILES.shoujo;

    it("parses Japanese ekonte tags", () => {
      const result = parseEkonteTags("光角, ガブレ", shonenProfile);
      expect(result).toHaveLength(2);
      expect(result[0].fxType).toBe("hikari_kaku");
      expect(result[0].source).toBe("ekonte");
      expect(result[0].rawTag).toBe("光角");
      expect(result[1].fxType).toBe("gabure");
    });

    it("parses romanized ekonte tags", () => {
      const result = parseEkonteTags("speed-lines, bokeh-pull", shonenProfile);
      expect(result).toHaveLength(2);
      expect(result[0].fxType).toBe("speed_lines");
      expect(result[1].fxType).toBe("bokeh_pull");
    });

    it("handles mixed Japanese and romanized tags", () => {
      const result = parseEkonteTags("波ガラス; motion-blur", shonenProfile);
      expect(result).toHaveLength(2);
      expect(result[0].fxType).toBe("nami_garasu");
      expect(result[1].fxType).toBe("motion_blur");
    });

    it("filters out genre-forbidden effects", () => {
      // gabure is forbidden in shoujo
      const result = parseEkonteTags("ガブレ, キラキラ", shoujoProfile);
      expect(result).toHaveLength(1);
      expect(result[0].fxType).toBe("sparkle_eyes");
    });

    it("respects maxEffectsPerClip", () => {
      // shoujo max is 2
      const result = parseEkonteTags("キラキラ, 桜吹雪, リムライト", shoujoProfile);
      expect(result).toHaveLength(2);
    });

    it("returns empty for null/empty sfx field", () => {
      expect(parseEkonteTags(null, shonenProfile)).toEqual([]);
      expect(parseEkonteTags("", shonenProfile)).toEqual([]);
      expect(parseEkonteTags("  ", shonenProfile)).toEqual([]);
    });

    it("skips unrecognized tags", () => {
      const result = parseEkonteTags("unknown-effect, 光角", shonenProfile);
      expect(result).toHaveLength(1);
      expect(result[0].fxType).toBe("hikari_kaku");
    });

    it("applies genre-specific intensity based on category weight", () => {
      // shonen: motion weight = 2.0, defaultIntensity = 0.85
      const result = parseEkonteTags("speed-lines", shonenProfile);
      expect(result[0].intensity).toBeCloseTo(1.0); // 0.85 * 2.0 = 1.7, clamped to 1.0
    });

    it("handles 、and ／ as delimiters (Japanese punctuation)", () => {
      const result = parseEkonteTags("光角、ガブレ／集中線", shonenProfile);
      expect(result).toHaveLength(3);
    });
  });

  // ─── LLM FX Suggestion ──────────────────────────────────────────────────

  describe("suggestFxFromLlm", () => {
    it("calls LLM and parses structured response", async () => {
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              effects: [
                { fxType: "speed_lines", intensity: 0.8, direction: "center" },
                { fxType: "impact_frame", intensity: 0.9, direction: "center" },
              ],
            }),
          },
          index: 0,
          finish_reason: "stop",
        }],
      } as any);

      const result = await suggestFxFromLlm(
        {
          panelId: 1,
          visualDescription: "Hero punches villain",
          cameraAngle: "close-up",
          emotion: "intense",
        },
        GENRE_PROFILES.shonen,
      );

      expect(result).toHaveLength(2);
      expect(result[0].fxType).toBe("speed_lines");
      expect(result[0].source).toBe("llm");
      expect(result[1].fxType).toBe("impact_frame");
    });

    it("filters out genre-forbidden FX from LLM suggestions", async () => {
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              effects: [
                { fxType: "gabure", intensity: 0.7, direction: "center" },  // forbidden in shoujo
                { fxType: "sparkle_eyes", intensity: 0.6, direction: "center" },
              ],
            }),
          },
          index: 0,
          finish_reason: "stop",
        }],
      } as any);

      const result = await suggestFxFromLlm(
        { panelId: 1, visualDescription: "Character smiles", cameraAngle: "medium" },
        GENRE_PROFILES.shoujo,
      );

      expect(result).toHaveLength(1);
      expect(result[0].fxType).toBe("sparkle_eyes");
    });

    it("returns empty on LLM failure", async () => {
      mockInvokeLLM.mockRejectedValueOnce(new Error("API timeout"));

      const result = await suggestFxFromLlm(
        { panelId: 1, visualDescription: "Scene", cameraAngle: "wide" },
        GENRE_PROFILES.shonen,
      );

      expect(result).toEqual([]);
    });

    it("returns empty when LLM suggests no effects", async () => {
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: { content: JSON.stringify({ effects: [] }) },
          index: 0,
          finish_reason: "stop",
        }],
      } as any);

      const result = await suggestFxFromLlm(
        { panelId: 1, visualDescription: "Quiet scene", cameraAngle: "wide" },
        GENRE_PROFILES.seinen,
      );

      expect(result).toEqual([]);
    });

    it("includes genre signature FX in system prompt", async () => {
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ effects: [] }) }, index: 0, finish_reason: "stop" }],
      } as any);

      await suggestFxFromLlm(
        { panelId: 1, visualDescription: "Test", cameraAngle: "wide" },
        GENRE_PROFILES.shonen,
      );

      const call = mockInvokeLLM.mock.calls[0][0];
      const systemMsg = (call.messages[0] as any).content as string;
      expect(systemMsg).toContain("speed_lines");
      expect(systemMsg).toContain("impact_frame");
      expect(systemMsg).toContain("sakuga_sparks");
    });
  });

  // ─── User Preference Modulation ─────────────────────────────────────────

  describe("applyUserPreferences", () => {
    const baseEffects: FxSpec[] = [
      { fxType: "speed_lines", intensity: 0.8, startFraction: 0, durationFraction: 1, source: "ekonte" },
      { fxType: "gabure", intensity: 0.7, startFraction: 0, durationFraction: 1, source: "ekonte" },
    ];

    it("returns effects unchanged when no preferences", () => {
      const result = applyUserPreferences(baseEffects, null, GENRE_PROFILES.shonen);
      expect(result).toEqual(baseEffects);
    });

    it("applies intensity multiplier", () => {
      const prefs: UserFxPreferences = { intensityMultiplier: 0.5 };
      const result = applyUserPreferences(baseEffects, prefs, GENRE_PROFILES.shonen);
      expect(result[0].intensity).toBeCloseTo(0.4);
      expect(result[1].intensity).toBeCloseTo(0.35);
    });

    it("clamps intensity to 1.0 max", () => {
      const prefs: UserFxPreferences = { intensityMultiplier: 2.0 };
      const result = applyUserPreferences(baseEffects, prefs, GENRE_PROFILES.shonen);
      expect(result[0].intensity).toBe(1.0);
    });

    it("removes disabled FX types", () => {
      const prefs: UserFxPreferences = { disabledFx: ["gabure"] };
      const result = applyUserPreferences(baseEffects, prefs, GENRE_PROFILES.shonen);
      expect(result).toHaveLength(1);
      expect(result[0].fxType).toBe("speed_lines");
    });

    it("adds always-include FX (respecting genre forbids)", () => {
      const prefs: UserFxPreferences = { alwaysIncludeFx: ["bokeh_pull"] };
      const result = applyUserPreferences(baseEffects, prefs, GENRE_PROFILES.shonen);
      expect(result).toHaveLength(3);
      expect(result[2].fxType).toBe("bokeh_pull");
    });

    it("does not add always-include FX if genre-forbidden", () => {
      // sparkle_eyes is forbidden in shonen
      const prefs: UserFxPreferences = { alwaysIncludeFx: ["sparkle_eyes"] };
      const result = applyUserPreferences(baseEffects, prefs, GENRE_PROFILES.shonen);
      expect(result).toHaveLength(2); // Not added
    });

    it("respects maxEffectsOverride", () => {
      const prefs: UserFxPreferences = { maxEffectsOverride: 1 };
      const result = applyUserPreferences(baseEffects, prefs, GENRE_PROFILES.shonen);
      expect(result).toHaveLength(1);
    });
  });

  // ─── FFmpeg Filter Building ─────────────────────────────────────────────

  describe("buildFilterComplex", () => {
    it("builds filter string from effects with FFmpeg templates", () => {
      const effects: FxSpec[] = [
        { fxType: "gabure", intensity: 0.5, startFraction: 0, durationFraction: 1, source: "ekonte" },
      ];
      const result = buildFilterComplex(effects, 4.0);
      expect(result).not.toBeNull();
      expect(result).toContain("crop=");
      expect(result).toContain("50"); // intensity * 100
    });

    it("returns null for overlay-only effects (no FFmpeg template)", () => {
      const effects: FxSpec[] = [
        { fxType: "sakura_petals", intensity: 0.6, startFraction: 0, durationFraction: 1, source: "ekonte" },
      ];
      const result = buildFilterComplex(effects, 4.0);
      expect(result).toBeNull();
    });

    it("chains multiple filters with commas", () => {
      const effects: FxSpec[] = [
        { fxType: "gabure", intensity: 0.5, startFraction: 0, durationFraction: 1, source: "ekonte" },
        { fxType: "dark_aura", intensity: 0.7, startFraction: 0, durationFraction: 1, source: "ekonte" },
      ];
      const result = buildFilterComplex(effects, 4.0);
      expect(result).not.toBeNull();
      expect(result!.split(",").length).toBeGreaterThan(2); // Multiple filter segments
    });

    it("substitutes intensity, start, and duration correctly", () => {
      const effects: FxSpec[] = [
        { fxType: "impact_frame", intensity: 0.8, startFraction: 0.5, durationFraction: 0.1, source: "ekonte" },
      ];
      const result = buildFilterComplex(effects, 4.0);
      expect(result).toContain("2.00"); // startFraction * 4.0 = 2.0
    });
  });

  describe("buildFfmpegCommand", () => {
    it("builds complete ffmpeg command", () => {
      const cmd = buildFfmpegCommand("/tmp/in.mp4", "/tmp/out.mp4", "gabure_filter");
      expect(cmd).toContain("ffmpeg");
      expect(cmd).toContain("-i \"/tmp/in.mp4\"");
      expect(cmd).toContain("-vf \"gabure_filter\"");
      expect(cmd).toContain("-c:a copy");
      expect(cmd).toContain("/tmp/out.mp4");
    });
  });

  // ─── Genre Profile Validation ───────────────────────────────────────────

  describe("Genre Profiles", () => {
    it("all 5 anime types have profiles", () => {
      expect(Object.keys(GENRE_PROFILES)).toHaveLength(5);
      expect(GENRE_PROFILES.shonen).toBeDefined();
      expect(GENRE_PROFILES.shoujo).toBeDefined();
      expect(GENRE_PROFILES.seinen).toBeDefined();
      expect(GENRE_PROFILES.josei).toBeDefined();
      expect(GENRE_PROFILES.kodomomuke).toBeDefined();
    });

    it("shonen emphasizes motion and energy", () => {
      expect(GENRE_PROFILES.shonen.categoryWeights.motion).toBeGreaterThan(1.5);
      expect(GENRE_PROFILES.shonen.categoryWeights.energy).toBeGreaterThan(1.5);
    });

    it("shoujo emphasizes light and emotional", () => {
      expect(GENRE_PROFILES.shoujo.categoryWeights.light).toBeGreaterThan(1.5);
      expect(GENRE_PROFILES.shoujo.categoryWeights.emotional).toBeGreaterThan(1.5);
    });

    it("seinen forbids comedic effects", () => {
      expect(GENRE_PROFILES.seinen.forbiddenFx).toContain("chibi_flash");
      expect(GENRE_PROFILES.seinen.forbiddenFx).toContain("sparkle_eyes");
    });

    it("all profiles have valid maxEffectsPerClip (1-5)", () => {
      for (const profile of Object.values(GENRE_PROFILES)) {
        expect(profile.maxEffectsPerClip).toBeGreaterThanOrEqual(1);
        expect(profile.maxEffectsPerClip).toBeLessThanOrEqual(5);
      }
    });
  });

  // ─── Ekonte Tag Map Validation ──────────────────────────────────────────

  describe("EKONTE_TAG_MAP", () => {
    it("maps all core Japanese FX tags", () => {
      expect(EKONTE_TAG_MAP["光角"]).toBe("hikari_kaku");
      expect(EKONTE_TAG_MAP["波ガラス"]).toBe("nami_garasu");
      expect(EKONTE_TAG_MAP["ガブレ"]).toBe("gabure");
      expect(EKONTE_TAG_MAP["画面動"]).toBe("gamen_dou");
      expect(EKONTE_TAG_MAP["集中線"]).toBe("speed_lines");
    });

    it("maps romanized equivalents", () => {
      expect(EKONTE_TAG_MAP["hikari-kaku"]).toBe("hikari_kaku");
      expect(EKONTE_TAG_MAP["bokeh-pull"]).toBe("bokeh_pull");
      expect(EKONTE_TAG_MAP["camera-shake"]).toBe("gabure");
    });

    it("all mapped FX types exist in FX_CATEGORIES", () => {
      for (const fxType of Object.values(EKONTE_TAG_MAP)) {
        expect(FX_CATEGORIES[fxType]).toBeDefined();
      }
    });
  });

  // ─── Batch Compositor ───────────────────────────────────────────────────

  describe("composeFxBatch", () => {
    it("processes clips with ekonte tags (no LLM calls)", async () => {
      const input: CompositorInput = {
        animeStyle: "shonen",
        clips: [
          {
            panelId: 1, panelNumber: 1, sceneNumber: 1,
            clipUrl: "https://s3.example.com/clip1.mp4",
            clipDurationSeconds: 4.0,
            sfxTag: "光角, ガブレ",
            visualDescription: "Hero charges up",
            cameraAngle: "wide",
          },
          {
            panelId: 2, panelNumber: 2, sceneNumber: 1,
            clipUrl: "https://s3.example.com/clip2.mp4",
            clipDurationSeconds: 3.0,
            sfxTag: "集中線",
            visualDescription: "Hero dashes forward",
            cameraAngle: "tracking",
          },
        ],
      };

      const result = await composeFxBatch(input);

      expect(mockInvokeLLM).not.toHaveBeenCalled(); // No LLM needed
      expect(result.genreProfile).toBe("shonen");
      expect(result.ekonteDrivenCount).toBe(2);
      expect(result.llmSuggestedCount).toBe(0);
      expect(result.plans).toHaveLength(2);
      expect(result.plans[0].effects).toHaveLength(2);
      expect(result.plans[0].effects[0].fxType).toBe("hikari_kaku");
      expect(result.plans[0].hasEffects).toBe(true);
      expect(result.totalCostUsd).toBeCloseTo(COST_PER_FX_RENDER * 2);
    });

    it("falls back to LLM when ekonte tags are absent", async () => {
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: { content: JSON.stringify({ effects: [{ fxType: "bokeh_pull", intensity: 0.6, direction: "center" }] }) },
          index: 0, finish_reason: "stop",
        }],
      } as any);

      const input: CompositorInput = {
        animeStyle: "seinen",
        clips: [{
          panelId: 1, panelNumber: 1, sceneNumber: 1,
          clipUrl: "https://s3.example.com/clip1.mp4",
          clipDurationSeconds: 5.0,
          sfxTag: null, // No ekonte tags
          visualDescription: "Character stares into distance",
          cameraAngle: "close-up",
          emotion: "melancholy",
        }],
      };

      const result = await composeFxBatch(input);

      expect(mockInvokeLLM).toHaveBeenCalledTimes(1);
      expect(result.ekonteDrivenCount).toBe(0);
      expect(result.llmSuggestedCount).toBe(1);
      expect(result.plans[0].effects[0].fxType).toBe("bokeh_pull");
      expect(result.plans[0].effects[0].source).toBe("llm");
      expect(result.totalCostUsd).toBeCloseTo(COST_PER_LLM_SUGGESTION + COST_PER_FX_RENDER);
    });

    it("applies user preferences as secondary modulator", async () => {
      const input: CompositorInput = {
        animeStyle: "shonen",
        userPreferences: {
          intensityMultiplier: 0.5,
          disabledFx: ["gabure"],
        },
        clips: [{
          panelId: 1, panelNumber: 1, sceneNumber: 1,
          clipUrl: "https://s3.example.com/clip1.mp4",
          clipDurationSeconds: 4.0,
          sfxTag: "光角, ガブレ",
          visualDescription: "Action scene",
          cameraAngle: "wide",
        }],
      };

      const result = await composeFxBatch(input);

      // gabure removed by user preference, hikari_kaku remains with reduced intensity
      expect(result.plans[0].effects).toHaveLength(1);
      expect(result.plans[0].effects[0].fxType).toBe("hikari_kaku");
      expect(result.plans[0].effects[0].intensity).toBeLessThan(0.8); // Reduced by 0.5x
    });

    it("handles mixed ekonte + LLM clips in batch", async () => {
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: { content: JSON.stringify({ effects: [{ fxType: "fog_layer", intensity: 0.5, direction: "center" }] }) },
          index: 0, finish_reason: "stop",
        }],
      } as any);

      const input: CompositorInput = {
        animeStyle: "seinen",
        clips: [
          {
            panelId: 1, panelNumber: 1, sceneNumber: 1,
            clipUrl: "https://s3.example.com/clip1.mp4",
            clipDurationSeconds: 4.0,
            sfxTag: "bokeh-pull",
            visualDescription: "Close-up",
            cameraAngle: "close-up",
          },
          {
            panelId: 2, panelNumber: 2, sceneNumber: 1,
            clipUrl: "https://s3.example.com/clip2.mp4",
            clipDurationSeconds: 3.0,
            sfxTag: null, // LLM fallback
            visualDescription: "Foggy street",
            cameraAngle: "wide",
          },
        ],
      };

      const result = await composeFxBatch(input);

      expect(result.ekonteDrivenCount).toBe(1);
      expect(result.llmSuggestedCount).toBe(1);
      expect(result.plans[0].effects[0].source).toBe("ekonte");
      expect(result.plans[1].effects[0].source).toBe("llm");
    });

    it("tracks cost correctly across batch", async () => {
      // 2 clips with ekonte (no LLM cost), 1 clip without (LLM cost)
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: { content: JSON.stringify({ effects: [] }) },
          index: 0, finish_reason: "stop",
        }],
      } as any);

      const input: CompositorInput = {
        animeStyle: "shonen",
        clips: [
          { panelId: 1, panelNumber: 1, sceneNumber: 1, clipUrl: "u1", clipDurationSeconds: 4, sfxTag: "光角", visualDescription: "a", cameraAngle: "w" },
          { panelId: 2, panelNumber: 2, sceneNumber: 1, clipUrl: "u2", clipDurationSeconds: 4, sfxTag: "ガブレ", visualDescription: "b", cameraAngle: "w" },
          { panelId: 3, panelNumber: 3, sceneNumber: 2, clipUrl: "u3", clipDurationSeconds: 4, sfxTag: null, visualDescription: "c", cameraAngle: "w" },
        ],
      };

      const result = await composeFxBatch(input);

      // 2 ekonte clips with effects → 2 × COST_PER_FX_RENDER
      // 1 LLM clip with no effects → COST_PER_LLM_SUGGESTION only
      expect(result.totalCostUsd).toBeCloseTo(COST_PER_FX_RENDER * 2 + COST_PER_LLM_SUGGESTION);
    });
  });

  // ─── FX Taxonomy Completeness ───────────────────────────────────────────

  describe("FX Taxonomy", () => {
    it("all AnimeFxType values have a category", () => {
      const allTypes = Object.keys(FX_CATEGORIES) as AnimeFxType[];
      expect(allTypes.length).toBeGreaterThan(30); // 33+ effect types
    });

    it("all FX types have an FFmpeg template or null (overlay)", () => {
      for (const fxType of Object.keys(FX_CATEGORIES) as AnimeFxType[]) {
        expect(fxType in FFMPEG_FILTERS).toBe(true);
      }
    });

    it("genre signature FX are not in their own forbidden list", () => {
      for (const profile of Object.values(GENRE_PROFILES)) {
        for (const sig of profile.signatureFx) {
          expect(profile.forbiddenFx).not.toContain(sig);
        }
      }
    });
  });
});
