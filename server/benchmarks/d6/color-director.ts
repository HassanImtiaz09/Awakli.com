/**
 * Wave 2 Item 3: D6 Color Director
 *
 * Generates per-character and per-scene color palettes for an episode,
 * with mood progression mapping and palette lock enforcement.
 *
 * Input: Approved D0 reference sheets + D1 script + style bundle
 * Output: Color script with character palettes, scene palettes, mood arc
 */
import { getDb } from "../../db";
import { colorScripts, characters, episodes, panels } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { invokeLLM } from "../../_core/llm";
import { serverLog } from "../../observability/logger";
import { getBundleByGenreKey } from "../d0/style-bundles";

// ─── Types ────────────────────────────────────────────────────────────

export interface CharacterPalette {
  characterId: number;
  characterName: string;
  primary: string;     // Main clothing/signature color
  secondary: string;   // Secondary clothing/accent
  accent: string;      // Energy/power color
  skin: string;        // Skin tone
  hair: string;        // Hair color
  eyes: string;        // Eye color
  outline: string;     // Line art color
}

export interface ScenePalette {
  sceneNumber: number;
  background: string;    // Background dominant
  midground: string;     // Midground elements
  foreground: string;    // Foreground elements
  ambient: string;       // Ambient light color
  lighting: string;      // Key light color
  accent: string;        // Scene accent/pop color
  timeOfDay: string;     // dawn, morning, noon, afternoon, dusk, night
  weather: string;       // clear, cloudy, rain, storm, snow, fog
}

export interface MoodPoint {
  sceneNumber: number;
  warmth: number;       // 0 (cool) to 1 (warm)
  saturation: number;   // 0 (desaturated) to 1 (vivid)
  brightness: number;   // 0 (dark) to 1 (bright)
  dominantHue: string;  // hex color
  mood: string;         // calm, tense, joyful, melancholic, action, romantic, mysterious
}

export interface PaletteLock {
  locked: boolean;
  lockedBy: number | null;
  lockedAt: string | null;
  lockedPalettes: string[]; // which palette groups are locked: "characters", "scenes", "mood"
}

const COST_PER_COLOR_SCRIPT = 0.08; // Opus call cost estimate

// ─── Color Script Generation ──────────────────────────────────────────

export async function generateColorScript(input: {
  projectId: number;
  episodeId: number;
  userId: number;
  styleBundleKey?: string;
}): Promise<{
  colorScriptId: number;
  characterPalettes: CharacterPalette[];
  scenePalettes: ScenePalette[];
  moodProgression: MoodPoint[];
  costUsd: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1. Fetch episode and its scenes/panels
  const [episode] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, input.episodeId))
    .limit(1);

  if (!episode) throw new Error(`Episode ${input.episodeId} not found`);

  // 2. Fetch characters for this project
  const projectCharacters: any[] = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, input.projectId));

  // 3. Fetch panels for scene context
  const episodePanels = await db
    .select()
    .from(panels)
    .where(eq(panels.episodeId, input.episodeId));

  // 4. Get style bundle palette if available
  let bundlePalette: any = null;
  if (input.styleBundleKey) {
    try {
      const bundle = await getBundleByGenreKey(input.styleBundleKey);
      bundlePalette = bundle?.colorPalette;
    } catch {
      // Non-critical, proceed without
    }
  }

  // 5. Build the prompt for D6 Color Director
  const characterDescriptions = projectCharacters.map((c: any) => {
    const traits = c.visualTraits as any;
    return `- ${c.name} (${c.role}): ${traits?.hairColor || "unknown"} hair, ${traits?.eyeColor || "unknown"} eyes, ${traits?.clothing || "standard outfit"}`;
  }).join("\n");

  const sceneDescriptions = extractSceneDescriptions(episode.scriptContent, episodePanels);

  const prompt = buildColorDirectorPrompt({
    episodeTitle: episode.title,
    synopsis: episode.synopsis,
    characterDescriptions,
    sceneDescriptions,
    bundlePalette,
    characterCount: projectCharacters.length,
    sceneCount: sceneDescriptions.length,
  });

  // 6. Create pending record
  const [inserted] = await db.insert(colorScripts).values({
    projectId: input.projectId,
    episodeId: input.episodeId,
    styleBundleKey: input.styleBundleKey || null,
    generationPrompt: prompt,
    status: "generating",
  });

  const colorScriptId = inserted.insertId;

  try {
    // 7. Call LLM for color script generation
    const response = await invokeLLM({
      messages: [
        { role: "system", content: COLOR_DIRECTOR_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "color_script",
          strict: true,
          schema: COLOR_SCRIPT_SCHEMA,
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    const textContent = typeof content === "string" ? content : JSON.stringify(content);
    const parsed = JSON.parse(textContent);

    // 8. Map character palettes with IDs
    const characterPalettes: CharacterPalette[] = (parsed.characterPalettes || []).map((cp: any, idx: number) => ({
      characterId: projectCharacters[idx]?.id ?? 0,
      characterName: cp.characterName || projectCharacters[idx]?.name || `Character ${idx + 1}`,
      primary: cp.primary || "#7C4DFF",
      secondary: cp.secondary || "#E040FB",
      accent: cp.accent || "#00E5FF",
      skin: cp.skin || "#F5D0B0",
      hair: cp.hair || "#1A1A2E",
      eyes: cp.eyes || "#7C4DFF",
      outline: cp.outline || "#1A1A2E",
    }));

    const scenePalettes: ScenePalette[] = (parsed.scenePalettes || []).map((sp: any, idx: number) => ({
      sceneNumber: sp.sceneNumber || idx + 1,
      background: sp.background || "#0D0D1A",
      midground: sp.midground || "#1A1A2E",
      foreground: sp.foreground || "#2A2A3E",
      ambient: sp.ambient || "#1A1A2E",
      lighting: sp.lighting || "#FFE4B5",
      accent: sp.accent || "#00E5FF",
      timeOfDay: sp.timeOfDay || "day",
      weather: sp.weather || "clear",
    }));

    const moodProgression: MoodPoint[] = (parsed.moodProgression || []).map((mp: any, idx: number) => ({
      sceneNumber: mp.sceneNumber || idx + 1,
      warmth: Math.max(0, Math.min(1, mp.warmth ?? 0.5)),
      saturation: Math.max(0, Math.min(1, mp.saturation ?? 0.7)),
      brightness: Math.max(0, Math.min(1, mp.brightness ?? 0.5)),
      dominantHue: mp.dominantHue || "#7C4DFF",
      mood: mp.mood || "neutral",
    }));

    // 9. Update record with results
    await db.update(colorScripts)
      .set({
        characterPalettes: JSON.stringify(characterPalettes),
        scenePalettes: JSON.stringify(scenePalettes),
        moodProgression: JSON.stringify(moodProgression),
        paletteLock: JSON.stringify({ locked: false, lockedBy: null, lockedAt: null, lockedPalettes: [] }),
        generationCostUsd: String(COST_PER_COLOR_SCRIPT),
        status: "generated",
      })
      .where(eq(colorScripts.id, colorScriptId));

    serverLog.info("D6 Color Director: color script generated", {
      colorScriptId,
      episodeId: input.episodeId,
      characterCount: characterPalettes.length,
      sceneCount: scenePalettes.length,
    });

    return {
      colorScriptId,
      characterPalettes,
      scenePalettes,
      moodProgression,
      costUsd: COST_PER_COLOR_SCRIPT,
    };
  } catch (err) {
    // Mark as failed
    await db.update(colorScripts)
      .set({ status: "rejected", rejectedReason: String(err) })
      .where(eq(colorScripts.id, colorScriptId));

    throw err;
  }
}

// ─── Query Helpers ────────────────────────────────────────────────────

export async function getColorScriptByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const results = await db
    .select()
    .from(colorScripts)
    .where(eq(colorScripts.episodeId, episodeId))
    .orderBy(desc(colorScripts.createdAt))
    .limit(1);
  return results[0] ?? null;
}

export async function getColorScriptById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const results = await db
    .select()
    .from(colorScripts)
    .where(eq(colorScripts.id, id))
    .limit(1);
  return results[0] ?? null;
}

export async function getColorScriptsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(colorScripts)
    .where(eq(colorScripts.projectId, projectId))
    .orderBy(desc(colorScripts.createdAt));
}

// ─── Approval Gate ────────────────────────────────────────────────────

export async function approveColorScript(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const script = await getColorScriptById(id);
  if (!script || script.status !== "generated") return false;

  await db.update(colorScripts)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: userId,
    })
    .where(eq(colorScripts.id, id));

  return true;
}

export async function rejectColorScript(id: number, reason: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const script = await getColorScriptById(id);
  if (!script) return false;

  await db.update(colorScripts)
    .set({
      status: "rejected",
      rejectedReason: reason,
    })
    .where(eq(colorScripts.id, id));

  return true;
}

// ─── Palette Lock ─────────────────────────────────────────────────────

export async function lockPalettes(id: number, userId: number, palettesToLock: string[]): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const script = await getColorScriptById(id);
  if (!script || !["approved", "locked"].includes(script.status)) return false;

  const lock: PaletteLock = {
    locked: true,
    lockedBy: userId,
    lockedAt: new Date().toISOString(),
    lockedPalettes: palettesToLock,
  };

  await db.update(colorScripts)
    .set({
      paletteLock: JSON.stringify(lock),
      status: "locked",
    })
    .where(eq(colorScripts.id, id));

  return true;
}

export async function unlockPalettes(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const script = await getColorScriptById(id);
  if (!script || script.status !== "locked") return false;

  const lock: PaletteLock = {
    locked: false,
    lockedBy: null,
    lockedAt: null,
    lockedPalettes: [],
  };

  await db.update(colorScripts)
    .set({
      paletteLock: JSON.stringify(lock),
      status: "approved",
    })
    .where(eq(colorScripts.id, id));

  return true;
}

// ─── Palette Update (individual palette editing) ──────────────────────

export async function updateCharacterPalette(
  colorScriptId: number,
  characterId: number,
  updates: Partial<CharacterPalette>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const script = await getColorScriptById(colorScriptId);
  if (!script) return false;

  // Check lock
  const lock = script.paletteLock as PaletteLock | null;
  if (lock?.locked && lock.lockedPalettes.includes("characters")) {
    throw new Error("Character palettes are locked. Unlock before editing.");
  }

  const palettes: CharacterPalette[] = (script.characterPalettes as CharacterPalette[]) || [];
  const idx = palettes.findIndex(p => p.characterId === characterId);
  if (idx === -1) return false;

  palettes[idx] = { ...palettes[idx], ...updates };

  await db.update(colorScripts)
    .set({ characterPalettes: JSON.stringify(palettes) })
    .where(eq(colorScripts.id, colorScriptId));

  return true;
}

export async function updateScenePalette(
  colorScriptId: number,
  sceneNumber: number,
  updates: Partial<ScenePalette>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const script = await getColorScriptById(colorScriptId);
  if (!script) return false;

  const lock = script.paletteLock as PaletteLock | null;
  if (lock?.locked && lock.lockedPalettes.includes("scenes")) {
    throw new Error("Scene palettes are locked. Unlock before editing.");
  }

  const palettes: ScenePalette[] = (script.scenePalettes as ScenePalette[]) || [];
  const idx = palettes.findIndex(p => p.sceneNumber === sceneNumber);
  if (idx === -1) return false;

  palettes[idx] = { ...palettes[idx], ...updates };

  await db.update(colorScripts)
    .set({ scenePalettes: JSON.stringify(palettes) })
    .where(eq(colorScripts.id, colorScriptId));

  return true;
}

// ─── Integration Helpers (for downstream agents) ──────────────────────

/**
 * Get the locked/approved color palette for a character in an episode.
 * Used by D2 Prompt Engineer and D1.5 Genga Director.
 */
export async function getCharacterColorPalette(
  episodeId: number,
  characterId: number,
): Promise<CharacterPalette | null> {
  const script = await getColorScriptByEpisode(episodeId);
  if (!script || !["approved", "locked"].includes(script.status)) return null;

  const palettes = script.characterPalettes as CharacterPalette[] | null;
  return palettes?.find(p => p.characterId === characterId) ?? null;
}

/**
 * Get the scene palette for a specific scene in an episode.
 * Used by D2 Prompt Engineer for color-conditioned prompts.
 */
export async function getSceneColorPalette(
  episodeId: number,
  sceneNumber: number,
): Promise<ScenePalette | null> {
  const script = await getColorScriptByEpisode(episodeId);
  if (!script || !["approved", "locked"].includes(script.status)) return null;

  const palettes = script.scenePalettes as ScenePalette[] | null;
  return palettes?.find(p => p.sceneNumber === sceneNumber) ?? null;
}

/**
 * Get the mood point for a specific scene.
 * Used by D6 for downstream mood-aware processing.
 */
export async function getSceneMoodPoint(
  episodeId: number,
  sceneNumber: number,
): Promise<MoodPoint | null> {
  const script = await getColorScriptByEpisode(episodeId);
  if (!script || !["approved", "locked"].includes(script.status)) return null;

  const progression = script.moodProgression as MoodPoint[] | null;
  return progression?.find(p => p.sceneNumber === sceneNumber) ?? null;
}

/**
 * Check if palettes are locked for a given episode.
 */
export async function arePalettesLocked(episodeId: number): Promise<boolean> {
  const script = await getColorScriptByEpisode(episodeId);
  if (!script) return false;
  const lock = script.paletteLock as PaletteLock | null;
  return lock?.locked ?? false;
}

// ─── Prompt Building ──────────────────────────────────────────────────

function extractSceneDescriptions(scriptContent: any, episodePanels: any[]): { sceneNumber: number; description: string }[] {
  const scenes: { sceneNumber: number; description: string }[] = [];

  if (scriptContent && typeof scriptContent === "object") {
    const scriptScenes = (scriptContent as any).scenes || [];
    for (const scene of scriptScenes) {
      scenes.push({
        sceneNumber: scene.sceneNumber || scenes.length + 1,
        description: `${scene.setting || ""} - ${scene.mood || ""} - ${scene.description || ""}`.trim(),
      });
    }
  }

  // Fallback: group panels by scene
  if (scenes.length === 0 && episodePanels.length > 0) {
    const sceneMap = new Map<number, string[]>();
    for (const panel of episodePanels) {
      const sn = panel.sceneNumber || 1;
      if (!sceneMap.has(sn)) sceneMap.set(sn, []);
      sceneMap.get(sn)!.push(panel.visualDescription || "");
    }
    for (const [sceneNumber, descs] of Array.from(sceneMap.entries())) {
      scenes.push({ sceneNumber, description: descs.join("; ") });
    }
  }

  return scenes.length > 0 ? scenes : [{ sceneNumber: 1, description: "Opening scene" }];
}

function buildColorDirectorPrompt(input: {
  episodeTitle: string;
  synopsis: string | null;
  characterDescriptions: string;
  sceneDescriptions: { sceneNumber: number; description: string }[];
  bundlePalette: any;
  characterCount: number;
  sceneCount: number;
}): string {
  let prompt = `## Episode: ${input.episodeTitle}\n`;
  if (input.synopsis) prompt += `Synopsis: ${input.synopsis}\n\n`;

  prompt += `## Characters (${input.characterCount}):\n${input.characterDescriptions}\n\n`;

  prompt += `## Scenes (${input.sceneCount}):\n`;
  for (const scene of input.sceneDescriptions) {
    prompt += `Scene ${scene.sceneNumber}: ${scene.description}\n`;
  }

  if (input.bundlePalette) {
    prompt += `\n## Style Bundle Palette (use as base):\n${JSON.stringify(input.bundlePalette, null, 2)}\n`;
  }

  prompt += `\nGenerate a complete color script with:\n`;
  prompt += `1. Character palettes for each of the ${input.characterCount} characters\n`;
  prompt += `2. Scene palettes for each of the ${input.sceneCount} scenes\n`;
  prompt += `3. Mood progression across all scenes\n`;
  prompt += `\nAll colors must be hex format (#RRGGBB). Ensure visual coherence across the episode.`;

  return prompt;
}

// ─── System Prompt ────────────────────────────────────────────────────

const COLOR_DIRECTOR_SYSTEM_PROMPT = `You are D6 Color Director, an expert anime color designer.

Your job is to create a comprehensive color script for an anime episode. You understand:
- Color theory and how it applies to anime production
- How color temperature shifts convey mood and time progression
- Character color coding and visual identity
- Scene lighting and atmospheric color
- The relationship between color palette and genre conventions

Rules:
- All colors MUST be valid hex format (#RRGGBB)
- Character palettes should be distinctive and recognizable
- Scene palettes should reflect time of day, weather, and mood
- Mood progression should create a coherent emotional arc
- Warmth/saturation/brightness values are 0.0 to 1.0
- Ensure sufficient contrast between foreground and background colors
- Protagonist colors should be more saturated than background character colors`;

const COLOR_SCRIPT_SCHEMA = {
  type: "object" as const,
  properties: {
    characterPalettes: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          characterName: { type: "string" as const },
          primary: { type: "string" as const },
          secondary: { type: "string" as const },
          accent: { type: "string" as const },
          skin: { type: "string" as const },
          hair: { type: "string" as const },
          eyes: { type: "string" as const },
          outline: { type: "string" as const },
        },
        required: ["characterName", "primary", "secondary", "accent", "skin", "hair", "eyes", "outline"] as const,
        additionalProperties: false,
      },
    },
    scenePalettes: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          sceneNumber: { type: "integer" as const },
          background: { type: "string" as const },
          midground: { type: "string" as const },
          foreground: { type: "string" as const },
          ambient: { type: "string" as const },
          lighting: { type: "string" as const },
          accent: { type: "string" as const },
          timeOfDay: { type: "string" as const },
          weather: { type: "string" as const },
        },
        required: ["sceneNumber", "background", "midground", "foreground", "ambient", "lighting", "accent", "timeOfDay", "weather"] as const,
        additionalProperties: false,
      },
    },
    moodProgression: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          sceneNumber: { type: "integer" as const },
          warmth: { type: "number" as const },
          saturation: { type: "number" as const },
          brightness: { type: "number" as const },
          dominantHue: { type: "string" as const },
          mood: { type: "string" as const },
        },
        required: ["sceneNumber", "warmth", "saturation", "brightness", "dominantHue", "mood"] as const,
        additionalProperties: false,
      },
    },
  },
  required: ["characterPalettes", "scenePalettes", "moodProgression"] as const,
  additionalProperties: false,
};
