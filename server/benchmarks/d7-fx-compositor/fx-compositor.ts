/**
 * D7 FX Compositor — Genre-Aware Anime Visual Effects (Stage 14: fx_pass)
 *
 * Design Principles (per user confirmation):
 *   1. PRIMARY FX source: explicit ekonte tags from Stage 5 panels (光角, 波ガラス, ガブレ, etc.)
 *      LLM selection ONLY where ekonte tags are absent or ambiguous.
 *   2. Active FX set driven by Stage 2 anime type (Shōnen/Shōjo/Seinen/Josei/Kodomomuke),
 *      with user preference as secondary modulator.
 *   3. FX taxonomy is anime-specific (NOT Western-cinematic).
 *
 * Architecture:
 *   - FX Taxonomy: Canonical anime effect categories with Japanese naming
 *   - Genre Profiles: Per-anime-type default FX weights and forbidden effects
 *   - Ekonte Parser: Extracts explicit FX tags from panel.sfx field
 *   - LLM Suggester: Fills gaps where ekonte is absent/ambiguous (secondary)
 *   - FFmpeg Renderer: Applies visual effects via filter_complex chains
 *   - Batch Compositor: Processes all clips in an episode with cost tracking
 */
import { invokeLLM } from "../../_core/llm.js";
import { pipelineLog } from "../../observability/logger.js";

// ─── Anime FX Taxonomy ──────────────────────────────────────────────────────

/**
 * Canonical anime visual effect types.
 * Each maps to a specific FFmpeg filter_complex implementation.
 */
export type AnimeFxType =
  // ─── Light Effects (光の効果) ─────────────────────────────────────────
  | "hikari_kaku"       // 光角 — Radial light rays from source (lens flare, divine light)
  | "bokeh_pull"        // ボケ引き — Depth-of-field rack focus (foreground/background blur shift)
  | "lens_flare"       // レンズフレア — Anamorphic flare streak
  | "rim_light"        // リムライト — Character edge glow (backlit silhouette)
  | "glow_pulse"       // 発光パルス — Pulsing energy glow (power-up, magic)
  // ─── Camera Effects (カメラ効果) ──────────────────────────────────────
  | "gabure"           // ガブレ — Camera shake (impact, earthquake)
  | "gamen_dou"        // 画面動 — Full-frame camera movement (pan/zoom in post)
  | "speed_zoom"       // スピードズーム — Rapid dolly zoom (Hitchcock effect)
  | "dutch_tilt"       // ダッチティルト — Tilted frame for unease
  // ─── Motion Effects (動きの効果) ──────────────────────────────────────
  | "speed_lines"      // 集中線 — Radial/parallel speed lines (shuuchuu-sen)
  | "impact_frame"     // インパクトフレーム — Flash frame on hit (white/color flash)
  | "motion_blur"      // モーションブラー — Directional blur for fast movement
  | "afterimage"       // 残像 — Ghost trail behind fast-moving character
  | "smear_frame"      // スミアフレーム — Elongated in-between for extreme speed
  // ─── Atmospheric Effects (大気効果) ───────────────────────────────────
  | "nami_garasu"      // 波ガラス — Heat haze / water distortion overlay
  | "sakura_petals"    // 桜吹雪 — Floating particle overlay (petals, snow, dust)
  | "rain_overlay"     // 雨オーバーレイ — Rain/water droplet overlay
  | "fog_layer"        // 霧レイヤー — Atmospheric fog/mist
  | "dust_motes"       // 塵 — Floating dust particles in light beams
  // ─── Emotional Effects (感情効果) ──────────────────────────────────────
  | "chibi_flash"      // ちびフラッシュ — Comedic super-deformed flash cut
  | "sparkle_eyes"     // キラキラ — Sparkle/star overlay (admiration, beauty)
  | "dark_aura"        // 暗黒オーラ — Dark energy emanation (menace, anger)
  | "sweat_drop"       // 汗 — Comedic sweat drop overlay
  | "anger_vein"       // 怒りマーク — Pulsing anger mark
  // ─── Energy/Power Effects (エネルギー効果) ─────────────────────────────
  | "sakuga_sparks"    // 作画スパーク — Animated spark particles (combat, energy)
  | "energy_aura"      // 気のオーラ — Character energy aura (power-up)
  | "explosion_ring"   // 爆発リング — Expanding shockwave ring
  | "lightning_arc"    // 雷弧 — Electric arc overlay
  // ─── Transition Effects (トランジション効果) ───────────────────────────
  | "whip_pan"         // ウィップパン — Fast horizontal wipe (scene change)
  | "radial_wipe"      // 放射ワイプ — Circular iris wipe
  | "ink_splash"       // 墨スプラッシュ — Ink splatter transition
  | "none";            // No effect

/** FX category grouping for genre profiles */
export type FxCategory =
  | "light"
  | "camera"
  | "motion"
  | "atmospheric"
  | "emotional"
  | "energy"
  | "transition";

export const FX_CATEGORIES: Record<AnimeFxType, FxCategory> = {
  hikari_kaku: "light",
  bokeh_pull: "light",
  lens_flare: "light",
  rim_light: "light",
  glow_pulse: "light",
  gabure: "camera",
  gamen_dou: "camera",
  speed_zoom: "camera",
  dutch_tilt: "camera",
  speed_lines: "motion",
  impact_frame: "motion",
  motion_blur: "motion",
  afterimage: "motion",
  smear_frame: "motion",
  nami_garasu: "atmospheric",
  sakura_petals: "atmospheric",
  rain_overlay: "atmospheric",
  fog_layer: "atmospheric",
  dust_motes: "atmospheric",
  chibi_flash: "emotional",
  sparkle_eyes: "emotional",
  dark_aura: "emotional",
  sweat_drop: "emotional",
  anger_vein: "emotional",
  sakuga_sparks: "energy",
  energy_aura: "energy",
  explosion_ring: "energy",
  lightning_arc: "energy",
  whip_pan: "transition",
  radial_wipe: "transition",
  ink_splash: "transition",
  none: "transition",
};

// ─── Ekonte Tag → FX Type Mapping ───────────────────────────────────────────

/**
 * Maps raw ekonte tags (Japanese or romanized) to canonical AnimeFxType.
 * This is the PRIMARY source — explicit tags always override LLM suggestions.
 */
export const EKONTE_TAG_MAP: Record<string, AnimeFxType> = {
  // Japanese tags (as written in ekonte/storyboard)
  "光角": "hikari_kaku",
  "ヒカリカク": "hikari_kaku",
  "波ガラス": "nami_garasu",
  "ナミガラス": "nami_garasu",
  "ガブレ": "gabure",
  "画面動": "gamen_dou",
  "ガメンドウ": "gamen_dou",
  "集中線": "speed_lines",
  "スピード線": "speed_lines",
  "残像": "afterimage",
  "ボケ引き": "bokeh_pull",
  "ボケ": "bokeh_pull",
  "レンズフレア": "lens_flare",
  "リムライト": "rim_light",
  "桜吹雪": "sakura_petals",
  "雨": "rain_overlay",
  "霧": "fog_layer",
  "塵": "dust_motes",
  "キラキラ": "sparkle_eyes",
  "暗黒オーラ": "dark_aura",
  "ちび": "chibi_flash",
  "汗": "sweat_drop",
  "怒り": "anger_vein",
  "スパーク": "sakuga_sparks",
  "オーラ": "energy_aura",
  "爆発": "explosion_ring",
  "雷": "lightning_arc",
  "ウィップ": "whip_pan",
  "墨": "ink_splash",
  // Romanized tags
  "hikari-kaku": "hikari_kaku",
  "hikari_kaku": "hikari_kaku",
  "nami-garasu": "nami_garasu",
  "nami_garasu": "nami_garasu",
  "gabure": "gabure",
  "camera-shake": "gabure",
  "camera_shake": "gabure",
  "gamen-dou": "gamen_dou",
  "gamen_dou": "gamen_dou",
  "screen-move": "gamen_dou",
  "speed-lines": "speed_lines",
  "speed_lines": "speed_lines",
  "shuuchuu-sen": "speed_lines",
  "impact-frame": "impact_frame",
  "impact_frame": "impact_frame",
  "motion-blur": "motion_blur",
  "motion_blur": "motion_blur",
  "afterimage": "afterimage",
  "smear": "smear_frame",
  "smear-frame": "smear_frame",
  "bokeh-pull": "bokeh_pull",
  "bokeh_pull": "bokeh_pull",
  "lens-flare": "lens_flare",
  "rim-light": "rim_light",
  "glow-pulse": "glow_pulse",
  "glow_pulse": "glow_pulse",
  "speed-zoom": "speed_zoom",
  "dutch-tilt": "dutch_tilt",
  "sakura": "sakura_petals",
  "rain": "rain_overlay",
  "fog": "fog_layer",
  "dust": "dust_motes",
  "sparkle": "sparkle_eyes",
  "dark-aura": "dark_aura",
  "chibi": "chibi_flash",
  "sweat": "sweat_drop",
  "anger": "anger_vein",
  "sparks": "sakuga_sparks",
  "energy-aura": "energy_aura",
  "explosion": "explosion_ring",
  "lightning": "lightning_arc",
  "whip-pan": "whip_pan",
  "ink-splash": "ink_splash",
};

// ─── Genre Profiles ─────────────────────────────────────────────────────────

/**
 * Anime type classification (from project.animeStyle + project.genre).
 * Maps to the 5 major demographic categories.
 */
export type AnimeType = "shonen" | "shoujo" | "seinen" | "josei" | "kodomomuke";

/** Maps project animeStyle enum to AnimeType */
export function classifyAnimeType(animeStyle: string, genre?: string | null): AnimeType {
  const style = animeStyle.toLowerCase();
  // Direct mapping from project.animeStyle
  if (style === "shonen" || style === "mecha") return "shonen";
  if (style === "shoujo") return "shoujo";
  if (style === "seinen" || style === "cyberpunk" || style === "noir" || style === "realistic") return "seinen";
  if (style === "chibi" || style === "watercolor") return "kodomomuke";
  // Genre-based fallback
  const g = (genre || "").toLowerCase();
  if (g.includes("josei") || g.includes("romance") && g.includes("adult")) return "josei";
  if (g.includes("kodomo") || g.includes("children")) return "kodomomuke";
  if (g.includes("shonen") || g.includes("action") || g.includes("battle")) return "shonen";
  if (g.includes("shoujo") || g.includes("magical girl")) return "shoujo";
  if (g.includes("seinen") || g.includes("psychological") || g.includes("horror")) return "seinen";
  return "shonen"; // Default
}

/**
 * Genre profile defines which FX categories are emphasized, de-emphasized, or forbidden.
 * Weight multiplier: 1.0 = normal, >1 = emphasized, <1 = de-emphasized, 0 = forbidden.
 */
export interface GenreProfile {
  animeType: AnimeType;
  displayName: string;
  /** Category weight multipliers (affects LLM suggestion probability) */
  categoryWeights: Record<FxCategory, number>;
  /** Specific FX types forbidden for this genre (never applied) */
  forbiddenFx: AnimeFxType[];
  /** Signature FX types for this genre (boosted in LLM suggestions) */
  signatureFx: AnimeFxType[];
  /** Max simultaneous effects per clip */
  maxEffectsPerClip: number;
  /** Default intensity multiplier (0.0 - 1.0) */
  defaultIntensity: number;
}

export const GENRE_PROFILES: Record<AnimeType, GenreProfile> = {
  shonen: {
    animeType: "shonen",
    displayName: "Shōnen (少年)",
    categoryWeights: {
      light: 1.2,
      camera: 1.5,
      motion: 2.0,    // Heavy emphasis on motion/action effects
      atmospheric: 0.8,
      emotional: 0.6,
      energy: 2.0,    // Power-ups, impacts, energy blasts
      transition: 1.0,
    },
    forbiddenFx: ["sparkle_eyes", "sweat_drop"],  // Too comedic for battle scenes
    signatureFx: ["speed_lines", "impact_frame", "sakuga_sparks", "gabure", "energy_aura", "afterimage"],
    maxEffectsPerClip: 3,
    defaultIntensity: 0.85,
  },
  shoujo: {
    animeType: "shoujo",
    displayName: "Shōjo (少女)",
    categoryWeights: {
      light: 2.0,     // Soft lighting, sparkles, rim light
      camera: 0.7,
      motion: 0.5,    // Less action-oriented
      atmospheric: 1.8, // Petals, soft focus, dreamy
      emotional: 2.0,  // Sparkle eyes, blush effects
      energy: 0.3,
      transition: 1.2,
    },
    forbiddenFx: ["gabure", "impact_frame", "explosion_ring", "smear_frame"],
    signatureFx: ["sparkle_eyes", "sakura_petals", "bokeh_pull", "rim_light", "glow_pulse"],
    maxEffectsPerClip: 2,
    defaultIntensity: 0.6,
  },
  seinen: {
    animeType: "seinen",
    displayName: "Seinen (青年)",
    categoryWeights: {
      light: 1.0,
      camera: 1.5,    // Cinematic camera work
      motion: 1.2,
      atmospheric: 1.5, // Mood-heavy atmospherics
      emotional: 0.3,  // Minimal comedic effects
      energy: 0.8,
      transition: 0.8,
    },
    forbiddenFx: ["chibi_flash", "sparkle_eyes", "sweat_drop", "anger_vein"],
    signatureFx: ["bokeh_pull", "dutch_tilt", "fog_layer", "nami_garasu", "rim_light"],
    maxEffectsPerClip: 2,
    defaultIntensity: 0.7,
  },
  josei: {
    animeType: "josei",
    displayName: "Josei (女性)",
    categoryWeights: {
      light: 1.5,
      camera: 1.0,
      motion: 0.4,
      atmospheric: 1.5,
      emotional: 1.0,
      energy: 0.2,
      transition: 1.0,
    },
    forbiddenFx: ["impact_frame", "speed_lines", "gabure", "explosion_ring", "smear_frame", "sakuga_sparks"],
    signatureFx: ["bokeh_pull", "rim_light", "sakura_petals", "rain_overlay", "dust_motes"],
    maxEffectsPerClip: 2,
    defaultIntensity: 0.55,
  },
  kodomomuke: {
    animeType: "kodomomuke",
    displayName: "Kodomomuke (子供向け)",
    categoryWeights: {
      light: 1.5,
      camera: 0.5,    // Minimal disorienting camera
      motion: 0.8,
      atmospheric: 1.0,
      emotional: 2.0,  // Exaggerated emotional cues
      energy: 1.2,
      transition: 1.5,
    },
    forbiddenFx: ["dark_aura", "dutch_tilt", "nami_garasu", "fog_layer"],
    signatureFx: ["chibi_flash", "sparkle_eyes", "glow_pulse", "sakura_petals", "radial_wipe"],
    maxEffectsPerClip: 2,
    defaultIntensity: 0.75,
  },
};

// ─── FX Specification ───────────────────────────────────────────────────────

export interface FxSpec {
  /** The canonical anime FX type */
  fxType: AnimeFxType;
  /** Intensity 0.0 - 1.0 (affects filter parameters) */
  intensity: number;
  /** Start time within clip (fraction 0.0 - 1.0) */
  startFraction: number;
  /** Duration as fraction of clip length (0.0 - 1.0) */
  durationFraction: number;
  /** Source: explicit ekonte tag or LLM suggestion */
  source: "ekonte" | "llm";
  /** Original tag text (for ekonte source) */
  rawTag?: string;
  /** Direction/position hint (e.g., "from_left", "center", "top_right") */
  direction?: string;
}

export interface ClipFxPlan {
  panelId: number;
  panelNumber: number;
  sceneNumber: number;
  clipUrl: string;
  effects: FxSpec[];
  /** Whether this clip was processed (has at least one non-none effect) */
  hasEffects: boolean;
  /** Estimated render cost in USD */
  renderCostUsd: number;
}

export interface FxCompositorResult {
  plans: ClipFxPlan[];
  totalEffectsApplied: number;
  totalCostUsd: number;
  genreProfile: AnimeType;
  ekonteDrivenCount: number;
  llmSuggestedCount: number;
}

// ─── FFmpeg Filter Templates ────────────────────────────────────────────────

/**
 * Maps each FX type to an FFmpeg filter_complex template.
 * Templates use {{intensity}} (0-100), {{start}} (seconds), {{duration}} (seconds).
 */
export const FFMPEG_FILTERS: Record<AnimeFxType, string | null> = {
  // Light effects
  hikari_kaku: "curves=lighter,vignette=PI/4:mode=backward:a={{intensity}}/100",
  bokeh_pull: "split[a][b];[a]boxblur={{intensity}}:1[bg];[b]crop=iw/2:ih/2:iw/4:ih/4,scale=iw*2:ih*2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2",
  lens_flare: "lenscorrection=k1={{intensity}}/500:k2={{intensity}}/1000,curves=lighter",
  rim_light: "edgedetect=low=0.1:high=0.3,negate,colorbalance=rs=0.{{intensity}}:gs=0.{{intensity}}:bs=0.{{intensity}}",
  glow_pulse: "gblur=sigma={{intensity}}/10,curves=lighter",
  // Camera effects
  gabure: "crop=iw-{{intensity}}:ih-{{intensity}}:random(1)*{{intensity}}:random(1)*{{intensity}},scale=iw:ih",
  gamen_dou: "zoompan=z='1+{{intensity}}/500':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=hd720",
  speed_zoom: "zoompan=z='if(between(on,0,{{duration}}*25),1+on*{{intensity}}/2500,1+{{intensity}}/100)':d=1:s=hd720",
  dutch_tilt: "rotate={{intensity}}/1000*PI/180:fillcolor=black@0",
  // Motion effects
  speed_lines: "drawbox=x=0:y=0:w=iw:h=ih:color=white@0.{{intensity}}:t=1",
  impact_frame: "fade=t=in:st={{start}}:d=0.08:color=white,fade=t=out:st={{start}}+0.08:d=0.08",
  motion_blur: "tblend=all_mode=average,framestep=1",
  afterimage: "tblend=all_mode=screen:all_opacity={{intensity}}/100",
  smear_frame: "tblend=all_mode=lighten:all_opacity={{intensity}}/100",
  // Atmospheric effects
  nami_garasu: "noise=alls={{intensity}}:allf=t,gblur=sigma=1",
  sakura_petals: null, // Requires overlay asset (handled separately)
  rain_overlay: null,  // Requires overlay asset
  fog_layer: "colorbalance=bs=0.1:gs=0.05,gblur=sigma={{intensity}}/20",
  dust_motes: null,    // Requires overlay asset
  // Emotional effects
  chibi_flash: "fade=t=in:st={{start}}:d=0.04:color=white,fade=t=out:st={{start}}+0.04:d=0.04",
  sparkle_eyes: null,  // Requires overlay asset
  dark_aura: "curves=darker,vignette=PI/2:a={{intensity}}/50",
  sweat_drop: null,    // Requires overlay asset
  anger_vein: null,    // Requires overlay asset
  // Energy effects
  sakuga_sparks: null, // Requires overlay asset
  energy_aura: "gblur=sigma={{intensity}}/15,colorbalance=rs=0.2:bs=0.3,curves=lighter",
  explosion_ring: "vignette=PI/4:mode=backward:a={{intensity}}/80,curves=lighter",
  lightning_arc: "noise=alls={{intensity}}:allf=t,eq=contrast=1.{{intensity}}",
  // Transition effects
  whip_pan: "tblend=all_mode=average:all_opacity=0.8",
  radial_wipe: null,   // Handled by transition system
  ink_splash: null,    // Requires overlay asset
  none: null,
};

// ─── Ekonte Parser ──────────────────────────────────────────────────────────

/**
 * Parse explicit FX tags from the panel's sfx field.
 * The sfx field may contain comma-separated tags like "光角, ガブレ" or "speed-lines, bokeh-pull".
 * Returns resolved FxSpec[] for all recognized tags.
 */
export function parseEkonteTags(
  sfxField: string | null | undefined,
  genreProfile: GenreProfile,
): FxSpec[] {
  if (!sfxField || sfxField.trim() === "") return [];

  const tags = sfxField.split(/[,;、／/]+/).map((t) => t.trim()).filter(Boolean);
  const specs: FxSpec[] = [];

  for (const rawTag of tags) {
    // Normalize: lowercase for romanized, keep original for Japanese
    const normalized = rawTag.toLowerCase().replace(/\s+/g, "-");
    const fxType = EKONTE_TAG_MAP[rawTag] || EKONTE_TAG_MAP[normalized];

    if (!fxType || fxType === "none") continue;

    // Check genre forbids
    if (genreProfile.forbiddenFx.includes(fxType)) {
      pipelineLog.debug(`[D7] Ekonte tag "${rawTag}" → ${fxType} forbidden for ${genreProfile.animeType}, skipping`);
      continue;
    }

    const category = FX_CATEGORIES[fxType];
    const weight = genreProfile.categoryWeights[category];

    specs.push({
      fxType,
      intensity: Math.min(1.0, genreProfile.defaultIntensity * weight),
      startFraction: 0.0,
      durationFraction: 1.0,
      source: "ekonte",
      rawTag,
    });
  }

  // Respect max effects per clip
  return specs.slice(0, genreProfile.maxEffectsPerClip);
}

// ─── LLM FX Suggester (Secondary) ──────────────────────────────────────────

export interface LlmSuggestionInput {
  panelId: number;
  visualDescription: string;
  cameraAngle: string;
  emotion?: string;
  dialogue?: string;
  sceneContext?: string;
}

/**
 * LLM-based FX suggestion — ONLY used when ekonte tags are absent or ambiguous.
 * The LLM is constrained to suggest from the genre's signature FX set.
 */
export async function suggestFxFromLlm(
  input: LlmSuggestionInput,
  genreProfile: GenreProfile,
): Promise<FxSpec[]> {
  const allowedFx = Object.keys(FX_CATEGORIES).filter(
    (fx) => !genreProfile.forbiddenFx.includes(fx as AnimeFxType)
  );
  const signatureList = genreProfile.signatureFx.join(", ");
  const allowedList = allowedFx.join(", ");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an anime FX director (特殊効果監督) for ${genreProfile.displayName} anime.
Your job: suggest 0-${genreProfile.maxEffectsPerClip} visual effects for a single anime clip.

RULES:
- Only suggest effects that enhance the scene emotionally/visually
- Prefer SIGNATURE effects for this genre: ${signatureList}
- NEVER suggest effects not in the allowed list
- Return "none" if no effects are needed (many clips need no FX)
- Consider the camera angle and emotion when choosing effects

ALLOWED FX: ${allowedList}

Respond with JSON: { "effects": [{ "fxType": "...", "intensity": 0.0-1.0, "direction": "center|from_left|from_right|top|bottom" }] }
If no effects needed: { "effects": [] }`,
        },
        {
          role: "user",
          content: `Panel ${input.panelId}:
Visual: "${input.visualDescription}"
Camera: ${input.cameraAngle}
Emotion: ${input.emotion || "neutral"}
Dialogue: "${input.dialogue || "none"}"
Scene context: ${input.sceneContext || "standard scene"}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fx_suggestion",
          strict: true,
          schema: {
            type: "object",
            properties: {
              effects: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    fxType: { type: "string" },
                    intensity: { type: "number" },
                    direction: { type: "string" },
                  },
                  required: ["fxType", "intensity", "direction"],
                  additionalProperties: false,
                },
              },
            },
            required: ["effects"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return [];

    const parsed = JSON.parse(content);
    const specs: FxSpec[] = [];

    for (const eff of parsed.effects || []) {
      const fxType = eff.fxType as AnimeFxType;
      if (!FX_CATEGORIES[fxType]) continue;
      if (genreProfile.forbiddenFx.includes(fxType)) continue;

      specs.push({
        fxType,
        intensity: Math.max(0, Math.min(1.0, eff.intensity || genreProfile.defaultIntensity)),
        startFraction: 0.0,
        durationFraction: 1.0,
        source: "llm",
        direction: eff.direction || "center",
      });
    }

    return specs.slice(0, genreProfile.maxEffectsPerClip);
  } catch (err) {
    pipelineLog.warn(`[D7] LLM FX suggestion failed for panel ${input.panelId}:`, { error: String(err) });
    return [];
  }
}

// ─── FFmpeg Command Builder ─────────────────────────────────────────────────

/**
 * Build the FFmpeg filter_complex string for a set of FX specs.
 * Returns null if no applicable filters (overlay-only effects).
 */
export function buildFilterComplex(
  effects: FxSpec[],
  clipDurationSeconds: number,
): string | null {
  const filters: string[] = [];

  for (const spec of effects) {
    const template = FFMPEG_FILTERS[spec.fxType];
    if (!template) continue; // Overlay-only effects skipped

    const intensityInt = Math.round(spec.intensity * 100);
    const startSec = (spec.startFraction * clipDurationSeconds).toFixed(2);
    const durationSec = (spec.durationFraction * clipDurationSeconds).toFixed(2);

    const resolved = template
      .replace(/\{\{intensity\}\}/g, String(intensityInt))
      .replace(/\{\{start\}\}/g, startSec)
      .replace(/\{\{duration\}\}/g, durationSec);

    filters.push(resolved);
  }

  if (filters.length === 0) return null;
  return filters.join(",");
}

/**
 * Build the full FFmpeg command for applying FX to a clip.
 */
export function buildFfmpegCommand(
  inputPath: string,
  outputPath: string,
  filterComplex: string,
): string {
  return `ffmpeg -hide_banner -y -i "${inputPath}" -vf "${filterComplex}" -c:a copy "${outputPath}"`;
}

// ─── User Preference Modulator ──────────────────────────────────────────────

export interface UserFxPreferences {
  /** Global intensity multiplier (0.0 - 2.0, default 1.0) */
  intensityMultiplier?: number;
  /** Specific FX types to disable */
  disabledFx?: AnimeFxType[];
  /** Specific FX types to always include (if not genre-forbidden) */
  alwaysIncludeFx?: AnimeFxType[];
  /** Override max effects per clip */
  maxEffectsOverride?: number;
}

/**
 * Apply user preferences as a secondary modulator on top of genre profile.
 * Genre profile is PRIMARY, user preferences are SECONDARY.
 */
export function applyUserPreferences(
  effects: FxSpec[],
  preferences: UserFxPreferences | null | undefined,
  genreProfile: GenreProfile,
): FxSpec[] {
  if (!preferences) return effects;

  let result = effects.filter(
    (e) => !(preferences.disabledFx || []).includes(e.fxType)
  );

  // Apply intensity multiplier
  if (preferences.intensityMultiplier != null) {
    result = result.map((e) => ({
      ...e,
      intensity: Math.max(0, Math.min(1.0, e.intensity * preferences.intensityMultiplier!)),
    }));
  }

  // Add always-include FX (if not genre-forbidden and not already present)
  for (const fx of preferences.alwaysIncludeFx || []) {
    if (genreProfile.forbiddenFx.includes(fx)) continue;
    if (result.some((e) => e.fxType === fx)) continue;
    result.push({
      fxType: fx,
      intensity: genreProfile.defaultIntensity * (preferences.intensityMultiplier || 1.0),
      startFraction: 0.0,
      durationFraction: 1.0,
      source: "ekonte", // Treat user preference as explicit
    });
  }

  // Respect max effects
  const maxFx = preferences.maxEffectsOverride || genreProfile.maxEffectsPerClip;
  return result.slice(0, maxFx);
}

// ─── Batch Compositor ───────────────────────────────────────────────────────

export interface CompositorInput {
  /** Project anime style (from project.animeStyle) */
  animeStyle: string;
  /** Project genre (from project.genre) */
  genre?: string | null;
  /** User FX preferences (secondary modulator) */
  userPreferences?: UserFxPreferences | null;
  /** Clips to process */
  clips: Array<{
    panelId: number;
    panelNumber: number;
    sceneNumber: number;
    clipUrl: string;
    clipDurationSeconds: number;
    /** Ekonte SFX tag from panel.sfx field (PRIMARY source) */
    sfxTag: string | null;
    /** Visual description for LLM fallback */
    visualDescription: string;
    /** Camera angle */
    cameraAngle: string;
    /** Emotion context */
    emotion?: string;
    /** Dialogue text */
    dialogue?: string;
  }>;
}

/** Cost per clip that receives FX processing (FFmpeg render) */
export const COST_PER_FX_RENDER = 0.03;
/** Cost per LLM suggestion call */
export const COST_PER_LLM_SUGGESTION = 0.01;

/**
 * Main entry point: process all clips for an episode, applying genre-aware FX.
 *
 * Flow:
 *   1. Classify anime type → get genre profile
 *   2. For each clip:
 *      a. Parse ekonte tags (PRIMARY source)
 *      b. If no ekonte tags → call LLM suggester (SECONDARY)
 *      c. Apply user preferences (modulator)
 *      d. Build FFmpeg filter chain
 *   3. Return FX plans for all clips
 */
export async function composeFxBatch(input: CompositorInput): Promise<FxCompositorResult> {
  const animeType = classifyAnimeType(input.animeStyle, input.genre);
  const genreProfile = GENRE_PROFILES[animeType];

  pipelineLog.info(`[D7] FX Compositor starting: ${input.clips.length} clips, genre=${animeType}`);

  const plans: ClipFxPlan[] = [];
  let totalCost = 0;
  let ekonteDrivenCount = 0;
  let llmSuggestedCount = 0;
  let totalEffects = 0;

  for (const clip of input.clips) {
    // Step 1: Parse ekonte tags (PRIMARY)
    let effects = parseEkonteTags(clip.sfxTag, genreProfile);

    if (effects.length > 0) {
      ekonteDrivenCount++;
    } else {
      // Step 2: LLM suggestion (SECONDARY — only when ekonte absent)
      effects = await suggestFxFromLlm(
        {
          panelId: clip.panelId,
          visualDescription: clip.visualDescription,
          cameraAngle: clip.cameraAngle,
          emotion: clip.emotion,
          dialogue: clip.dialogue,
        },
        genreProfile,
      );
      if (effects.length > 0) {
        llmSuggestedCount++;
      }
      totalCost += COST_PER_LLM_SUGGESTION;
    }

    // Step 3: Apply user preferences (secondary modulator)
    effects = applyUserPreferences(effects, input.userPreferences, genreProfile);

    // Step 4: Build plan
    const hasEffects = effects.length > 0 && effects[0].fxType !== "none";
    if (hasEffects) {
      totalCost += COST_PER_FX_RENDER;
      totalEffects += effects.length;
    }

    plans.push({
      panelId: clip.panelId,
      panelNumber: clip.panelNumber,
      sceneNumber: clip.sceneNumber,
      clipUrl: clip.clipUrl,
      effects,
      hasEffects,
      renderCostUsd: hasEffects ? COST_PER_FX_RENDER : 0,
    });
  }

  pipelineLog.info(`[D7] FX Compositor complete: ${totalEffects} effects across ${plans.filter(p => p.hasEffects).length}/${plans.length} clips, ekonte=${ekonteDrivenCount}, llm=${llmSuggestedCount}, cost=$${totalCost.toFixed(2)}`);

  return {
    plans,
    totalEffectsApplied: totalEffects,
    totalCostUsd: totalCost,
    genreProfile: animeType,
    ekonteDrivenCount,
    llmSuggestedCount,
  };
}
