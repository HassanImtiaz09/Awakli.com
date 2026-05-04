/**
 * D1.25 Layout Director
 *
 * Takes D1 script (scene/panel structure) + D0 character sheets + D6 color script
 * → produces per-panel layout compositions (camera angle, character placement, depth layers)
 * + rough composition sketch generation.
 *
 * Camera vocabulary: wide, medium, close_up, extreme_close_up, birds_eye, worms_eye, dutch_angle, over_shoulder
 */
import { getDb } from "../../db";
import { panelLayouts } from "../../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";
import { invokeLLM } from "../../_core/llm";
import { generateImage } from "../../_core/imageGeneration";
import { storagePut } from "../../storage";
import { serverLog } from "../../observability/logger";

// ─── Camera Vocabulary ──────────────────────────────────────────────────
export const CAMERA_ANGLES = [
  "wide", "medium", "close_up", "extreme_close_up",
  "birds_eye", "worms_eye", "dutch_angle", "over_shoulder",
] as const;
export type CameraAngle = typeof CAMERA_ANGLES[number];

export const CAMERA_MOVEMENTS = [
  "static", "pan_left", "pan_right", "tilt_up", "tilt_down",
  "zoom_in", "zoom_out", "dolly",
] as const;

// ─── Types ──────────────────────────────────────────────────────────────
export interface CharacterPlacement {
  characterId: number;
  characterName: string;
  x: number;       // 0-1 normalized
  y: number;       // 0-1 normalized
  scale: number;   // 0.1-2.0
  facing: "left" | "right" | "center" | "away";
  pose: string;
  zIndex: number;
}

export interface DepthLayers {
  foreground: string[];
  midground: string[];
  background: string[];
}

export interface LayoutComposition {
  cameraAngle: CameraAngle;
  cameraMovement: string;
  depthLayers: DepthLayers;
  characterPlacements: CharacterPlacement[];
  compositionNotes: string;
}

export interface GenerateLayoutsInput {
  projectId: number;
  episodeId: number;
  userId: number;
  scriptScenes: Array<{
    sceneNumber: number;
    location: string;
    timeOfDay: string;
    mood: string;
    description: string;
    panels: Array<{
      panelNumber: number;
      visualDescription: string;
      cameraAngle?: string;
      dialogue: Array<{ character: string; text: string }>;
    }>;
  }>;
  characters: Array<{
    id: number;
    name: string;
    role: string;
    visualTraits: any;
  }>;
  colorScript?: {
    scenePalettes: any[];
    characterPalettes: any[];
  };
}

// ─── Generate Layouts for Episode ───────────────────────────────────────
export async function generateLayouts(input: GenerateLayoutsInput) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  serverLog.info("[D1.25] Starting layout generation", {
    projectId: input.projectId,
    episodeId: input.episodeId,
    sceneCount: input.scriptScenes.length,
  });

  const results: Array<{
    sceneNumber: number;
    panelNumber: number;
    layoutId: number;
    layout: LayoutComposition;
  }> = [];

  let totalCost = 0;

  for (const scene of input.scriptScenes) {
    // Generate layouts for all panels in this scene via single LLM call
    const sceneLayouts = await generateSceneLayouts(scene, input.characters, input.colorScript);
    totalCost += 0.04; // ~$0.04 per scene for Opus call

    for (const panelLayout of sceneLayouts) {
      // Insert layout record
      const [insertResult] = await db.insert(panelLayouts).values({
        projectId: input.projectId,
        episodeId: input.episodeId,
        sceneNumber: scene.sceneNumber,
        panelNumber: panelLayout.panelNumber,
        cameraAngle: panelLayout.layout.cameraAngle,
        cameraMovement: panelLayout.layout.cameraMovement || "static",
        depthLayers: panelLayout.layout.depthLayers,
        characterPlacements: panelLayout.layout.characterPlacements,
        layoutJson: panelLayout.layout,
        generationPrompt: panelLayout.prompt,
        generationCostUsd: String(0.04 / scene.panels.length),
        status: "generated",
      });

      const layoutId = (insertResult as any).insertId;

      results.push({
        sceneNumber: scene.sceneNumber,
        panelNumber: panelLayout.panelNumber,
        layoutId,
        layout: panelLayout.layout,
      });
    }
  }

  serverLog.info("[D1.25] Layout generation complete", {
    episodeId: input.episodeId,
    layoutCount: results.length,
    totalCost,
  });

  return { layouts: results, totalCost };
}

// ─── Generate Composition Sketch ────────────────────────────────────────
export async function generateCompositionSketch(
  layoutId: number,
  layout: LayoutComposition,
  sceneDescription: string,
  projectId: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const prompt = buildSketchPrompt(layout, sceneDescription);

  try {
    const result = await generateImage({ prompt });
    if (!result.url) throw new Error("No image URL returned");

    // Upload to S3
    const response = await fetch(result.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const key = `projects/${projectId}/layouts/${layoutId}-sketch-${Date.now()}.png`;
    const { url: s3Url } = await storagePut(key, buffer, "image/png");

    // Update record
    await db.update(panelLayouts)
      .set({
        compositionSketchUrl: s3Url,
        compositionSketchKey: key,
      })
      .where(eq(panelLayouts.id, layoutId));

    return { url: s3Url, key };
  } catch (err: any) {
    serverLog.error("[D1.25] Sketch generation failed", { layoutId, error: err.message });
    throw err;
  }
}

// ─── Scene Layout LLM Call ──────────────────────────────────────────────
async function generateSceneLayouts(
  scene: GenerateLayoutsInput["scriptScenes"][0],
  characters: GenerateLayoutsInput["characters"],
  colorScript?: GenerateLayoutsInput["colorScript"],
) {
  const characterList = characters.map(c => `- ${c.name} (${c.role})`).join("\n");

  const prompt = `You are an anime layout director (D1.25). Generate panel compositions for this scene.

SCENE ${scene.sceneNumber}: ${scene.location} (${scene.timeOfDay}, ${scene.mood})
${scene.description}

CHARACTERS IN PROJECT:
${characterList}

PANELS:
${scene.panels.map(p => `Panel ${p.panelNumber}: ${p.visualDescription}${p.cameraAngle ? ` [camera: ${p.cameraAngle}]` : ""}
  Dialogue: ${p.dialogue.map(d => `${d.character}: "${d.text}"`).join(", ") || "none"}`).join("\n")}

${colorScript ? `COLOR DIRECTION: Scene palette available for reference.` : ""}

For each panel, produce a layout composition with:
1. cameraAngle: one of [wide, medium, close_up, extreme_close_up, birds_eye, worms_eye, dutch_angle, over_shoulder]
2. cameraMovement: one of [static, pan_left, pan_right, tilt_up, tilt_down, zoom_in, zoom_out, dolly]
3. depthLayers: { foreground: [...elements], midground: [...elements], background: [...elements] }
4. characterPlacements: [{ characterName, x (0-1), y (0-1), scale (0.1-2.0), facing (left/right/center/away), pose, zIndex }]
5. compositionNotes: brief director notes on framing intent

Return JSON array of panel layouts.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are an expert anime layout director. Output valid JSON only." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scene_layouts",
        strict: true,
        schema: {
          type: "object",
          properties: {
            panels: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  panelNumber: { type: "integer" },
                  cameraAngle: { type: "string" },
                  cameraMovement: { type: "string" },
                  depthLayers: {
                    type: "object",
                    properties: {
                      foreground: { type: "array", items: { type: "string" } },
                      midground: { type: "array", items: { type: "string" } },
                      background: { type: "array", items: { type: "string" } },
                    },
                    required: ["foreground", "midground", "background"],
                    additionalProperties: false,
                  },
                  characterPlacements: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        characterName: { type: "string" },
                        x: { type: "number" },
                        y: { type: "number" },
                        scale: { type: "number" },
                        facing: { type: "string" },
                        pose: { type: "string" },
                        zIndex: { type: "integer" },
                      },
                      required: ["characterName", "x", "y", "scale", "facing", "pose", "zIndex"],
                      additionalProperties: false,
                    },
                  },
                  compositionNotes: { type: "string" },
                },
                required: ["panelNumber", "cameraAngle", "cameraMovement", "depthLayers", "characterPlacements", "compositionNotes"],
                additionalProperties: false,
              },
            },
          },
          required: ["panels"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

  return parsed.panels.map((p: any) => ({
    panelNumber: p.panelNumber,
    layout: {
      cameraAngle: validateCameraAngle(p.cameraAngle),
      cameraMovement: p.cameraMovement || "static",
      depthLayers: p.depthLayers,
      characterPlacements: p.characterPlacements.map((cp: any) => ({
        characterId: 0, // Will be resolved by caller
        characterName: cp.characterName,
        x: Math.max(0, Math.min(1, cp.x)),
        y: Math.max(0, Math.min(1, cp.y)),
        scale: Math.max(0.1, Math.min(2.0, cp.scale)),
        facing: cp.facing || "center",
        pose: cp.pose,
        zIndex: cp.zIndex || 0,
      })),
      compositionNotes: p.compositionNotes,
    } as LayoutComposition,
    prompt,
  }));
}

function validateCameraAngle(angle: string): CameraAngle {
  const normalized = angle.toLowerCase().replace(/[\s-]/g, "_") as CameraAngle;
  if (CAMERA_ANGLES.includes(normalized)) return normalized;
  return "medium"; // Safe default
}

function buildSketchPrompt(layout: LayoutComposition, sceneDescription: string): string {
  const chars = layout.characterPlacements.map(cp =>
    `${cp.characterName} at position (${(cp.x * 100).toFixed(0)}%, ${(cp.y * 100).toFixed(0)}%) facing ${cp.facing}, ${cp.pose}`
  ).join("; ");

  return `Rough anime layout sketch, pencil composition guide, ${layout.cameraAngle} shot, ${sceneDescription}. Characters: ${chars}. Depth: foreground [${layout.depthLayers.foreground.join(", ")}], midground [${layout.depthLayers.midground.join(", ")}], background [${layout.depthLayers.background.join(", ")}]. Minimal detail, focus on composition and framing. Monochrome sketch style.`;
}

// ─── Query Helpers ──────────────────────────────────────────────────────
export async function getLayoutsByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(panelLayouts)
    .where(eq(panelLayouts.episodeId, episodeId))
    .orderBy(asc(panelLayouts.sceneNumber), asc(panelLayouts.panelNumber));
}

export async function getLayoutsByScene(episodeId: number, sceneNumber: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(panelLayouts)
    .where(and(
      eq(panelLayouts.episodeId, episodeId),
      eq(panelLayouts.sceneNumber, sceneNumber),
    ))
    .orderBy(asc(panelLayouts.panelNumber));
}

export async function getLayoutById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(panelLayouts).where(eq(panelLayouts.id, id)).limit(1);
  return rows[0] || null;
}

export async function approveLayout(id: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  const layout = await getLayoutById(id);
  if (!layout || layout.status !== "generated") return false;
  await db.update(panelLayouts).set({
    status: "approved",
    approvedAt: new Date(),
    approvedBy: userId,
  }).where(eq(panelLayouts.id, id));
  return true;
}

export async function rejectLayout(id: number, reason: string) {
  const db = await getDb();
  if (!db) return false;
  const layout = await getLayoutById(id);
  if (!layout || layout.status !== "generated") return false;
  await db.update(panelLayouts).set({
    status: "rejected",
    rejectedReason: reason,
  }).where(eq(panelLayouts.id, id));
  return true;
}

export async function updateLayoutComposition(id: number, updates: Partial<LayoutComposition>) {
  const db = await getDb();
  if (!db) return false;
  const layout = await getLayoutById(id);
  if (!layout) return false;

  const currentLayout = layout.layoutJson as LayoutComposition;
  const merged = { ...currentLayout, ...updates };

  await db.update(panelLayouts).set({
    layoutJson: merged,
    cameraAngle: merged.cameraAngle || layout.cameraAngle,
    cameraMovement: merged.cameraMovement || layout.cameraMovement,
    depthLayers: merged.depthLayers || layout.depthLayers,
    characterPlacements: merged.characterPlacements || layout.characterPlacements,
  }).where(eq(panelLayouts.id, id));
  return true;
}

export async function approveAllLayoutsForEpisode(episodeId: number, userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const layouts = await getLayoutsByEpisode(episodeId);
  let count = 0;
  for (const layout of layouts) {
    if (layout.status === "generated") {
      await approveLayout(layout.id, userId);
      count++;
    }
  }
  return count;
}
