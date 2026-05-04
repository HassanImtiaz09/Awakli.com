/**
 * Pipeline Orchestrator — runs the 4-node anime production pipeline:
 *   video_gen → voice_gen → music_gen → assembly
 *
 * Kling V3 Omni handles video generation WITH native audio + lip sync in a single pass,
 * eliminating the need for a separate lip_sync node. When panels have dialogue,
 * the video_gen node uses the Omni endpoint with `sound: "on"` and dialogue-enriched
 * prompts so characters' mouth movements are natively synced to speech.
 */

import { generateImage } from "./_core/imageGeneration";
import { notifyOwner } from "./_core/notification";
import { storagePut } from "./storage";
import { textToSpeech, listVoices, VOICE_PRESETS, MODELS } from "./elevenlabs";
import { imageToVideo, omniVideo, queryTask } from "./kling";
import { generateOmniVideo, generateImageToVideo, type VideoGenerationResult } from "./video-provider";
import { classifyScene, calculateCost, calculateV3OmniCost, MODEL_MAP, type PanelScriptData, type SceneClassification } from "./scene-classifier";
import { createModelRoutingStat, updatePipelineAssetRouting } from "./db";
import { buildLipSyncPrompt } from "./kling-subjects";
import { generateSceneBGM } from "./minimax-music";
import { uploadFromUrl as cfUploadFromUrl } from "./cloudflare-stream";
import { resolveMotionLora, sceneQualifiesForMotionLora, getMotionLoraWeight, type MotionLoraResolution } from "./motion-lora-training";
import { assembleVideo, type TransitionSpec, type TransitionType } from "./video-assembly";
import { foleyGenNode } from "./foleyGenerator";
import { ambientGenNode } from "./ambientDetector";
import { lipSyncNode } from "./lipSyncNode";
import { getOrCompileProductionBible, lockProductionBible, type ProductionBibleData } from "./production-bible";
import { runHarnessLayer, updateAssetHarnessScore, type HarnessContext, type HarnessRunSummary } from "./harness-runner";
import { scriptChecks, visualChecks, videoChecks, audioChecks, integrationChecks } from "./harness-checks";
import {
  getPipelineRunById,
  updatePipelineRun,
  createPipelineAsset,
  getPipelineAssetsByRun,
  getPanelsByEpisode,
  getEpisodeById,
  getCharactersByProject,
  getReadyElementMapForProject,
  getReadyElementsByProject,
  updateEpisode,
} from "./db";
import { nanoid } from "nanoid";
import {
  initializeHitlForRun,
  processPreFlightStages,
  completeNodeWithGate,
  resumePipelineAfterApproval,
  resumePipelineAfterRegeneration,
  pausePipelineForGate,
  getUserTierForRun,
  type OrchestratorNode,
  type NodeCompletionParams,
} from "./hitl";
import type { GenerateResult, ScoreContext } from "./hitl";
import { pipelineLog } from "./observability/logger";
import { runD5_5QualityGate, deriveStyleLock, buildCharacterBiblesMap, type D5_5PipelineContext, type ClipAssetInfo, type PanelInfo as D5_5PanelInfo } from "./benchmarks/d5-5/pipeline-integration";

type NodeName = "video_gen" | "voice_gen" | "lip_sync" | "music_gen" | "foley_gen" | "ambient_gen" | "assembly";

/**
 * Legacy NodeName → v1.9 OrchestratorNode adapter.
 * Maps the legacy 7-node orchestrator to the v1.9 8-node structure.
 * This adapter will be removed when the orchestrator is fully rewritten in Wave 3.
 */
const LEGACY_NODE_TO_V19: Record<NodeName, OrchestratorNode> = {
  video_gen: "video_gen",
  voice_gen: "audio_timing",
  lip_sync: "audio_timing",
  music_gen: "audio_timing",
  foley_gen: "fx_composite",
  ambient_gen: "fx_composite",
  assembly: "mastering",
};
type NodeStatus = "pending" | "running" | "complete" | "failed" | "skipped";

interface NodeStatuses {
  video_gen: NodeStatus;
  voice_gen: NodeStatus;
  lip_sync: NodeStatus;
  music_gen: NodeStatus;
  foley_gen: NodeStatus;
  ambient_gen: NodeStatus;
  assembly: NodeStatus;
}

const NODE_ORDER: NodeName[] = ["video_gen", "voice_gen", "lip_sync", "music_gen", "foley_gen", "ambient_gen", "assembly"];

const NODE_COSTS: Record<NodeName, number> = {
  video_gen: 200,   // cents — higher because V3 Omni includes audio/lip sync
  voice_gen: 80,
  lip_sync: 50,     // ~$0.15/panel × ~5 dialogue panels average
  music_gen: 40,
  foley_gen: 60,    // ~$0.05/clip × ~12 clips average
  ambient_gen: 30,  // ~$0.05/clip × ~6 scenes average
  assembly: 20,
};

const NODE_DURATIONS: Record<NodeName, number> = {
  video_gen: 12000,  // longer — Omni generates video + audio together
  voice_gen: 5000,
  lip_sync: 15000,   // face detection + lip sync per dialogue panel (sequential)
  music_gen: 3000,
  foley_gen: 8000,   // LLM cue extraction + MiniMax generation per clip
  ambient_gen: 6000, // LLM scene detection + MiniMax generation per scene
  assembly: 2000,
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateNodeProgress(
  runId: number,
  node: NodeName,
  status: NodeStatus,
  nodeStatuses: NodeStatuses,
  progress: number,
  cost: number,
  nodeCosts: Record<string, number>
) {
  nodeStatuses[node] = status;
  if (status === "complete") {
    nodeCosts[node] = NODE_COSTS[node];
  }
  const remaining = NODE_ORDER.filter(n => nodeStatuses[n] === "pending" || nodeStatuses[n] === "running")
    .reduce((sum, n) => sum + NODE_DURATIONS[n], 0);

  await updatePipelineRun(runId, {
    currentNode: node as any,
    nodeStatuses: nodeStatuses as any,
    progress,
    estimatedTimeRemaining: Math.round(remaining / 1000),
    totalCost: cost,
    nodeCosts: nodeCosts as any,
  });
}

// ─── Harness Gates ──────────────────────────────────────────────────────

/**
 * Run a harness gate between pipeline stages.
 * Returns the summary. If shouldBlock is true, the pipeline should halt.
 */
async function runHarnessGate(
  layerName: string,
  checks: Array<{ config: any; fn: any }>,
  context: HarnessContext,
  bible: ProductionBibleData,
  runId: number,
): Promise<HarnessRunSummary> {
  pipelineLog.info(`[Harness] Running ${layerName} gate (${checks.length} checks)...`);
  const summary = await runHarnessLayer(checks, context, bible);
  pipelineLog.info(`[Harness] ${layerName}: ${summary.passed}/${summary.totalChecks} passed, score=${summary.overallScore}, cost=$${summary.totalCost}`);

  if (summary.shouldBlock) {
    pipelineLog.warn(`[Harness] ${layerName}: BLOCKED — pipeline will halt`);
    await notifyOwner({
      title: `Pipeline Blocked: ${layerName}`,
      content: `Pipeline run #${runId} blocked by ${layerName} harness. ${summary.blocked} check(s) returned BLOCK. Flagged items: ${summary.flaggedItems.map(f => f.checkName).join(", ")}`,
    });
  }

  if (summary.flaggedItems.length > 0) {
    pipelineLog.info(`[Harness] ${layerName}: ${summary.flaggedItems.length} flagged item(s): ${summary.flaggedItems.map(f => `${f.checkName}(${f.score})`).join(", ")}`);
  }

  return summary;
}

// ─── Agent Nodes ────────────────────────────────────────────────────────

/**
 * Video Generation Agent — Smart Kling Model Router
 *
 * Routes each panel to the most cost-effective Kling model:
 *   Tier 1: V3 Omni  — lip sync critical (close-up dialogue)
 *   Tier 2: V2.6     — high complexity (action, complex movement)
 *   Tier 3: V2.1     — medium complexity (establishing shots, minimal movement)
 *   Tier 4: V1.6     — simple (transitions, title cards)
 *
 * Deterministic rules handle ~40-50% of panels instantly (zero cost).
 * Remaining panels are classified by LLM (~$0.005 each).
 *
 * When Subject Library elements are available for Tier 1 panels:
 *   - Uses element_list with <<<element_N>>> voice tags for true lip-synced animation
 *
 * Lip Sync Preservation Strategies:
 *   Strategy 1 (default): Anime convention — no lip sync on non-V3 clips (zero cost)
 *   Strategy 2 (optional): Post-sync via Sync.so for lip_sync_beneficial panels
 *   Strategy 3: User override — Force V3 Omni per panel (Studio tier)
 */
async function videoGenAgent(runId: number, episodeId: number, projectId: number, nodeStatuses: NodeStatuses, nodeCosts: Record<string, number>) {
  const panels = await getPanelsByEpisode(episodeId);
  const approvedPanels = panels.filter(p => p.imageUrl);
  let totalCost = Object.values(nodeCosts).reduce((a, b) => a + b, 0);

  // Process ALL panels for full episode production (13 panels × 10s = ~130s base + voice/transitions)
  const panelsToProcess = approvedPanels;

  // ─── Subject Library: look up ready character elements ───────────────
  const elementMap = await getReadyElementMapForProject(projectId);
  const readyElements = await getReadyElementsByProject(projectId);
  const hasSubjectLibrary = elementMap.size > 0;

  const elementList: Array<{ element_id: number }> = [];
  const elementOrder: string[] = [];
  if (hasSubjectLibrary) {
    for (const [charName, elementId] of Array.from(elementMap.entries())) {
      elementList.push({ element_id: elementId });
      elementOrder.push(charName);
    }
    pipelineLog.info(`[Pipeline] Subject Library active: ${elementList.length} character elements loaded (${elementOrder.join(", ")})`);
  } else {
    pipelineLog.info(`[Pipeline] No Subject Library elements found — using fallback Omni mode`);
  }

  // ─── Step 1: Classify all panels via Smart Model Router ───────────────
  pipelineLog.info(`[Pipeline] Smart Model Router: classifying ${panelsToProcess.length} panels...`);

  // Get the production bible's animation style for Sakuga override
  let projectAnimationStyle = "default";
  try {
    const bible = await getOrCompileProductionBible(projectId);
    projectAnimationStyle = bible.animationStyle || "default";
  } catch { /* use default */ }

  const classifications: Map<number, SceneClassification> = new Map();
  const motionLoraDecisions: Map<number, MotionLoraResolution> = new Map();
  let classificationCost = 0;
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

  // ─── Motion LoRA: Check if character has trained motion LoRA ───────────
  let motionLoraAvailable = false;
  let motionLoraPath: string | undefined;
  let motionLoraCorrupt = false;
  let hasAppearanceLora = false;
  let hasStyleLora = false;
  // H-8: Wire to actual tier check — motion LoRA requires creator_pro or higher
  let userTierAllowsMotionLora = false;
  try {
    const dbMod = await import("./db");
    const db = await dbMod.getDb();
    if (db) {
      const { projects } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [project] = await db.select({ userId: projects.userId }).from(projects).where(eq(projects.id, projectId)).limit(1);
      if (project?.userId) {
        const userTier = await dbMod.getUserSubscriptionTier(project.userId);
        const TIER_LEVEL: Record<string, number> = { free_trial: 0, creator: 1, creator_pro: 2, studio: 3, enterprise: 4 };
        userTierAllowsMotionLora = (TIER_LEVEL[userTier] ?? 0) >= (TIER_LEVEL["creator_pro"] ?? 2);
      }
    }
  } catch {
    userTierAllowsMotionLora = false;
  }

  try {
    const characters = await getCharactersByProject(projectId);
    for (const char of characters) {
      // Check for motion LoRA in the character's LoRA model URL or settings
      const charAny = char as any;
      if (charAny.motionLoraUrl) {
        motionLoraAvailable = true;
        motionLoraPath = charAny.motionLoraUrl;
        motionLoraCorrupt = charAny.motionLoraCorrupt === true;
      }
      if (char.loraModelUrl || char.loraStatus === "ready") {
        hasAppearanceLora = true;
      }
      if (charAny.styleLoraPath) {
        hasStyleLora = true;
      }
    }
    if (motionLoraAvailable) {
      pipelineLog.info(`[Pipeline] Motion LoRA available: ${motionLoraPath}`);
    } else {
      pipelineLog.info(`[Pipeline] No motion LoRA found for project ${projectId}`);
    }
  } catch (err) {
    pipelineLog.warn(`[Pipeline] Motion LoRA lookup failed:`, { detail: String(err) });
  }

  for (const panel of panelsToProcess) {
    const dialogue = panel.dialogue as any;
    const dialogueArray: Array<{ character?: string; text: string; emotion?: string }> = [];
    if (Array.isArray(dialogue)) {
      for (const d of dialogue) {
        if (typeof d === "string") dialogueArray.push({ text: d });
        else if (d && typeof d === "object") dialogueArray.push({ character: d.character || d.speaker, text: d.text || d.line || d.dialogue || "", emotion: d.emotion });
      }
    } else if (typeof dialogue === "string" && dialogue.trim()) {
      dialogueArray.push({ text: dialogue });
    }

    const panelData: PanelScriptData = {
      panelId: panel.id,
      visualDescription: String(panel.visualDescription || ""),
      cameraAngle: panel.cameraAngle || undefined,
      dialogue: dialogueArray.length > 0 ? dialogueArray : undefined,
      mood: undefined,
      sceneType: panel.transition === "fade" || panel.transition === "dissolve" ? "transition" : undefined,
      animationStyle: projectAnimationStyle,
      characterCount: dialogueArray.length > 0 ? new Set(dialogueArray.map(d => d.character).filter(Boolean)).size || 1 : undefined,
    };

    const classification = await classifyScene(panelData);
    classifications.set(panel.id, classification);
    classificationCost += classification.classificationCostUsd;
    tierCounts[classification.tier]++;

    // ─── Motion LoRA resolution per panel ───
    const sceneType = (classification as any).sceneType || "establishing-environment";
    const motionDecision = resolveMotionLora({
      hasMotionLora: motionLoraAvailable,
      motionLoraPath,
      motionLoraCorrupt,
      hasAppearanceLora,
      hasStyleLora,
      sceneType,
      userTierAllowsMotionLora,
    });
    motionLoraDecisions.set(panel.id, motionDecision);

    const motionLabel = motionDecision.fallback === "applied"
      ? `motion-LoRA@${motionDecision.motionLoraWeight}`
      : `motion-LoRA:${motionDecision.fallback}`;
    pipelineLog.info(`[Router] Panel ${panel.id}: Tier ${classification.tier} → ${classification.model} (${classification.deterministic ? "deterministic" : "LLM"}) [${motionLabel}] — ${classification.reasoning}`);
  }

  pipelineLog.info(`[Router] Classification complete: T1=${tierCounts[1]} T2=${tierCounts[2]} T3=${tierCounts[3]} T4=${tierCounts[4]}, cost=$${classificationCost.toFixed(3)}`);

  // ─── Step 2: Submit video generation tasks in batches (Kling limit: 5 parallel) ────
  interface TaskInfo {
    panelId: number;
    taskId: string;
    panelNumber: number | null;
    taskType: "image2video" | "omni-video";
    hasDialogue: boolean;
    hasNativeLipSync: boolean;
    classification: SceneClassification;
  }
  const taskIds: TaskInfo[] = [];
  let totalActualCostUsd = 0;
  let totalV3OmniCostUsd = 0;
  const KLING_BATCH_SIZE = 5;
  const allPanelBatches: typeof panelsToProcess[] = [];
  for (let i = 0; i < panelsToProcess.length; i += KLING_BATCH_SIZE) {
    allPanelBatches.push(panelsToProcess.slice(i, i + KLING_BATCH_SIZE));
  }

  for (let batchIdx = 0; batchIdx < allPanelBatches.length; batchIdx++) {
    const batch = allPanelBatches[batchIdx];
    pipelineLog.info(`[Pipeline] Submitting batch ${batchIdx + 1}/${allPanelBatches.length} (${batch.length} panels)...`);
    const batchTaskIds: TaskInfo[] = [];

  for (const panel of batch) {
    if (!panel.imageUrl) continue;

    const classification = classifications.get(panel.id);
    if (!classification) continue;

    const dialogue = panel.dialogue as any;
    const hasDialogue = classification.hasDialogue;

    // Extract dialogue lines for prompt building
    const dialogueLines: Array<{ characterName: string; dialogue: string; emotion?: string }> = [];
    if (hasDialogue && Array.isArray(dialogue)) {
      for (const d of dialogue) {
        if (typeof d === "string") dialogueLines.push({ characterName: "narrator", dialogue: d });
        else if (d && typeof d === "object") dialogueLines.push({ characterName: d.character || d.speaker || "narrator", dialogue: d.text || d.line || d.dialogue || "", emotion: d.emotion });
      }
    } else if (hasDialogue && typeof dialogue === "string") {
      dialogueLines.push({ characterName: "narrator", dialogue });
    }
    const dialogueText = dialogueLines.map(d => d.dialogue).filter(Boolean).join(". ");

    try {
      if (classification.tier === 1 && hasDialogue && dialogueText) {
        // ─── TIER 1: V3 Omni with native lip sync ───
        const panelCharNames = dialogueLines.map(d => d.characterName);
        const hasMatchingElements = hasSubjectLibrary && panelCharNames.some(name => elementMap.has(name));

        let omniPrompt: string;
        let omniElementList: Array<{ element_id: number }> | undefined;

        if (hasMatchingElements) {
          omniPrompt = buildLipSyncPrompt(
            `Cinematic anime scene, ${String(panel.visualDescription || "dramatic scene")}. Anime style, high quality animation, fluid movement, expressive character performance.`,
            dialogueLines,
            elementOrder
          );
          omniElementList = elementList;
          pipelineLog.info(`[Pipeline] Panel ${panel.id}: Tier 1 + Subject Library lip sync (${panelCharNames.filter(n => elementMap.has(n)).join(", ")})`);
        } else {
          omniPrompt = `Cinematic anime scene, ${String(panel.visualDescription || "dramatic scene")}. The character says: "${dialogueText.slice(0, 500)}". Anime style, high quality animation, fluid movement, expressive character performance.`;
          omniElementList = undefined;
        }

        // ─── fal.ai primary, Kling direct fallback (via video-provider) ───
        try {
          const vidResult = await generateOmniVideo({
            prompt: omniPrompt,
            imageUrl: panel.imageUrl,
            elementList: omniElementList,
            sound: "on",
            duration: "10",
            mode: "pro",
            aspectRatio: "16:9",
          });

          // fal.ai returns synchronously — store result immediately
          const videoRes = await fetch(vidResult.videoUrl);
          const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
          const videoKey = `pipeline/${runId}/omni-lipsync-panel${panel.id}-${nanoid(6)}.mp4`;
          const { url: storedUrl } = await storagePut(videoKey, videoBuffer, "video/mp4");

          const durationSec = vidResult.durationSeconds;
          const actualCost = calculateCost(classification.tier, durationSec, "pro");
          const v3OmniCost = calculateV3OmniCost(durationSec, "pro");
          totalActualCostUsd += actualCost;
          totalV3OmniCostUsd += v3OmniCost;

          const motionDecision = motionLoraDecisions.get(panel.id);
          await createPipelineAsset({
            pipelineRunId: runId,
            episodeId,
            panelId: panel.id,
            assetType: "synced_clip",
            url: storedUrl,
            metadata: {
              duration: durationSec,
              format: "mp4",
              panelNumber: panel.panelNumber,
              provider: vidResult.provider,
              model: vidResult.model,
              requestId: vidResult.requestId,
              hasNativeAudio: true,
              hasLipSync: true,
              hasNativeLipSync: !!hasMatchingElements,
              usedSubjectLibrary: !!hasMatchingElements,
              complexityTier: classification.tier,
              lipSyncBeneficial: classification.lipSyncBeneficial,
              motionLoraApplied: motionDecision?.fallback === "applied",
              motionLoraWeight: motionDecision?.motionLoraWeight,
              motionLoraFallback: motionDecision?.fallback,
              motionLoraSceneType: motionDecision?.sceneType,
            } as any,
            nodeSource: "video_gen",
            klingModelUsed: vidResult.model,
            complexityTier: classification.tier,
            lipSyncMethod: hasMatchingElements ? "native" : "native",
            classificationReasoning: classification.reasoning,
            costActual: actualCost,
            costIfV3Omni: v3OmniCost,
            userOverride: 0,
          });

          pipelineLog.info(`[Pipeline] Tier 1 Omni complete via ${vidResult.provider}: panel ${panel.id} (${hasMatchingElements ? "native lip sync" : "fallback"})`);
        } catch (omniErr) {
          pipelineLog.error(`[Pipeline] Omni video failed for panel ${panel.id}:`, { error: String(omniErr) });
        }
      } else {
        // ─── TIER 2/3/4: Use appropriate model via image2video ───
        const modelName = classification.modelName;
        const prompt = `Cinematic anime scene, smooth camera motion, ${String(panel.visualDescription || "dramatic scene")}, anime style, high quality animation, fluid movement`;

        // ─── fal.ai primary, Kling direct fallback (via video-provider) ───
        try {
          const vidResult = await generateImageToVideo({
            imageUrl: panel.imageUrl,
            prompt,
            negativePrompt: "static, still image, blurry, low quality, distorted",
            duration: "10",
            mode: "pro",
            modelName,
          });

          // Store result immediately
          const videoRes = await fetch(vidResult.videoUrl);
          const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
          const suffix = `t${classification.tier}-clip`;
          const videoKey = `pipeline/${runId}/${suffix}-panel${panel.id}-${nanoid(6)}.mp4`;
          const { url: storedUrl } = await storagePut(videoKey, videoBuffer, "video/mp4");

          const durationSec = vidResult.durationSeconds;
          const actualCost = calculateCost(classification.tier, durationSec, "pro");
          const v3OmniCost = calculateV3OmniCost(durationSec, "pro");
          totalActualCostUsd += actualCost;
          totalV3OmniCostUsd += v3OmniCost;

          const lipSyncMethod = classification.lipSyncBeneficial ? "post_sync" : "none";
          const motionDecision = motionLoraDecisions.get(panel.id);
          await createPipelineAsset({
            pipelineRunId: runId,
            episodeId,
            panelId: panel.id,
            assetType: "video_clip",
            url: storedUrl,
            metadata: {
              duration: durationSec,
              format: "mp4",
              panelNumber: panel.panelNumber,
              provider: vidResult.provider,
              model: vidResult.model,
              requestId: vidResult.requestId,
              hasNativeAudio: false,
              hasLipSync: false,
              hasNativeLipSync: false,
              usedSubjectLibrary: false,
              complexityTier: classification.tier,
              lipSyncBeneficial: classification.lipSyncBeneficial,
              motionLoraApplied: motionDecision?.fallback === "applied",
              motionLoraWeight: motionDecision?.motionLoraWeight,
              motionLoraFallback: motionDecision?.fallback,
              motionLoraSceneType: motionDecision?.sceneType,
            } as any,
            nodeSource: "video_gen",
            klingModelUsed: vidResult.model,
            complexityTier: classification.tier,
            lipSyncMethod,
            classificationReasoning: classification.reasoning,
            costActual: actualCost,
            costIfV3Omni: v3OmniCost,
            userOverride: 0,
          });

          pipelineLog.info(`[Pipeline] Tier ${classification.tier} ${classification.model} complete via ${vidResult.provider}: panel ${panel.id}`);
        } catch (i2vErr) {
          pipelineLog.error(`[Pipeline] Image2Video failed for panel ${panel.id}:`, { error: String(i2vErr) });
        }
      }
    } catch (err) {
      pipelineLog.error(`[Pipeline] Kling submission failed for panel ${panel.id}:`, { error: String(err) });
    }
  } // end panel loop within batch

    taskIds.push(...batchTaskIds);

    // ─── Poll this batch until all tasks complete before submitting next batch ──
    const batchCompletedTasks = new Set<string>();
    const batchMaxPollTime = 12 * 60 * 1000; // 12 min per batch
    const batchPollStart = Date.now();
    let batchPollInterval = 8000;

    while (batchCompletedTasks.size < batchTaskIds.length && (Date.now() - batchPollStart) < batchMaxPollTime) {
      for (const task of batchTaskIds) {
        if (batchCompletedTasks.has(task.taskId)) continue;
        try {
          const status = await queryTask(task.taskId, task.taskType);
          if (status.data?.task_status === "succeed") {
            batchCompletedTasks.add(task.taskId);
            const video = status.data.task_result?.videos?.[0];
            if (video?.url) {
              const videoRes = await fetch(video.url);
              const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
              const suffix = task.classification.tier === 1 ? "omni-lipsync" : `t${task.classification.tier}-clip`;
              const videoKey = `pipeline/${runId}/${suffix}-panel${task.panelId}-${nanoid(6)}.mp4`;
              const { url: storedUrl } = await storagePut(videoKey, videoBuffer, "video/mp4");

              const durationSec = Number(video.duration) || 10;
              const actualCost = calculateCost(task.classification.tier, durationSec, "pro");
              const v3OmniCost = calculateV3OmniCost(durationSec, "pro");
              totalActualCostUsd += actualCost;
              totalV3OmniCostUsd += v3OmniCost;

              const assetType = task.classification.tier === 1 ? "synced_clip" : "video_clip";
              const lipSyncMethod = task.classification.tier === 1
                ? (task.hasNativeLipSync ? "native" : "native")
                : task.classification.lipSyncBeneficial ? "post_sync" : "none";

              // ─── Motion LoRA metadata for this panel ───
              const motionDecision = motionLoraDecisions.get(task.panelId);

              await createPipelineAsset({
                pipelineRunId: runId,
                episodeId,
                panelId: task.panelId,
                assetType,
                url: storedUrl,
                metadata: {
                  duration: durationSec,
                  format: "mp4",
                  panelNumber: task.panelNumber,
                  klingTaskId: task.taskId,
                  klingModel: task.classification.model,
                  hasNativeAudio: task.classification.tier === 1,
                  hasLipSync: task.classification.tier === 1,
                  hasNativeLipSync: task.hasNativeLipSync,
                  usedSubjectLibrary: task.hasNativeLipSync,
                  complexityTier: task.classification.tier,
                  lipSyncBeneficial: task.classification.lipSyncBeneficial,
                  motionLoraApplied: motionDecision?.fallback === "applied",
                  motionLoraWeight: motionDecision?.motionLoraWeight,
                  motionLoraFallback: motionDecision?.fallback,
                  motionLoraSceneType: motionDecision?.sceneType,
                } as any,
                nodeSource: "video_gen",
                klingModelUsed: task.classification.model,
                complexityTier: task.classification.tier,
                lipSyncMethod,
                classificationReasoning: task.classification.reasoning,
                costActual: actualCost,
                costIfV3Omni: v3OmniCost,
                userOverride: 0,
              });

              const lipSyncLabel = task.hasNativeLipSync ? "Native lip-synced" : task.classification.tier === 1 ? "Omni audio" : `Tier ${task.classification.tier}`;
              pipelineLog.info(`[Pipeline] ${lipSyncLabel} video stored for panel ${task.panelId}: ${storedUrl.slice(0, 60)}... ($${actualCost.toFixed(3)})`);
            }
          } else if (status.data?.task_status === "failed") {
            batchCompletedTasks.add(task.taskId);
            pipelineLog.error(`[Pipeline] Kling task failed for panel ${task.panelId}: ${status.data.task_status_msg}`);
          }
        } catch (err) {
          pipelineLog.error(`[Pipeline] Poll error for task ${task.taskId}:`, { error: String(err) });
        }
      }

      const totalCompleted = taskIds.filter(t => batchCompletedTasks.has(t.taskId) || t.taskId !== t.taskId).length;
      const overallProgress = Math.round(((batchIdx * KLING_BATCH_SIZE + batchCompletedTasks.size) / panelsToProcess.length) * 25);
      totalCost += Math.round(NODE_COSTS.video_gen / Math.max(panelsToProcess.length, 1));
      await updateNodeProgress(runId, "video_gen", "running", nodeStatuses, overallProgress, totalCost, nodeCosts);

      if (batchCompletedTasks.size < batchTaskIds.length) {
        await sleep(batchPollInterval);
        batchPollInterval = Math.min(batchPollInterval * 1.2, 20000);
      }
    }

    pipelineLog.info(`[Pipeline] Batch ${batchIdx + 1} complete: ${batchCompletedTasks.size}/${batchTaskIds.length} tasks`);
    // Small delay between batches to avoid rate limits
    if (batchIdx < allPanelBatches.length - 1) {
      await sleep(3000);
    }
  } // end batch loop

  // ─── Step 4: Save model routing stats ─────────────────────────────────
  const savings = totalV3OmniCostUsd - totalActualCostUsd;
  const savingsPercent = totalV3OmniCostUsd > 0 ? (savings / totalV3OmniCostUsd) * 100 : 0;

  try {
    await createModelRoutingStat({
      episodeId,
      pipelineRunId: runId,
      totalPanels: panelsToProcess.length,
      tier1Count: tierCounts[1],
      tier2Count: tierCounts[2],
      tier3Count: tierCounts[3],
      tier4Count: tierCounts[4],
      actualCost: totalActualCostUsd,
      v3OmniCost: totalV3OmniCostUsd,
      savings,
      savingsPercent,
    });
    pipelineLog.info(`[Router] Stats saved: actual=$${totalActualCostUsd.toFixed(2)}, v3=$${totalV3OmniCostUsd.toFixed(2)}, saved=$${savings.toFixed(2)} (${savingsPercent.toFixed(0)}%)`);
  } catch (err) {
    pipelineLog.error(`[Router] Failed to save routing stats:`, { error: String(err) });
  }

  return totalCost;
}

async function voiceGenAgent(runId: number, episodeId: number, projectId: number, nodeStatuses: NodeStatuses, nodeCosts: Record<string, number>) {
  const panels = await getPanelsByEpisode(episodeId);
  const characters = await getCharactersByProject(projectId);
  let totalCost = Object.values(nodeCosts).reduce((a, b) => a + b, 0);

  // Generate standalone voice clips for panels with dialogue
  // (These supplement the native Omni audio — useful for narration, voiceover, or higher-quality TTS)
  const panelsWithDialogue = panels.filter(p => {
    const dialogue = p.dialogue as any;
    return dialogue && (Array.isArray(dialogue) ? dialogue.length > 0 : Object.keys(dialogue).length > 0);
  });

  // Generate voice for ALL dialogue panels (no limit for full episode)
  for (let i = 0; i < panelsWithDialogue.length; i++) {
    const panel = panelsWithDialogue[i];
    const dialogue = panel.dialogue as any;
    const dialogueText = Array.isArray(dialogue)
      ? dialogue.map((d: any) => d.text || d.line || d).join(". ")
      : typeof dialogue === "string" ? dialogue : JSON.stringify(dialogue);

    const voiceKey = `pipeline/${runId}/voice-${panel.id}-${nanoid(6)}.mp3`;

    try {
      let voiceId: string;
      try {
        const voices = await listVoices();
        voiceId = voices[0]?.voice_id || "CwhRBWXzGAHq8TQ4Fs17";
      } catch {
        voiceId = "CwhRBWXzGAHq8TQ4Fs17"; // Roger - Laid-Back, Casual
      }

      const audioBuffer = await textToSpeech({
        voiceId,
        text: dialogueText.slice(0, 5000),
        modelId: MODELS.MULTILINGUAL_V2,
        voiceSettings: VOICE_PRESETS.heroic,
      });

      const { url } = await storagePut(voiceKey, audioBuffer, "audio/mpeg");
      const wordCount = dialogueText.split(/\s+/).length;
      const durationEstimate = Math.max(1, Math.round((wordCount / 150) * 60));

      await createPipelineAsset({
        pipelineRunId: runId,
        episodeId,
        panelId: panel.id,
        assetType: "voice_clip",
        url,
        metadata: { duration: durationEstimate, characterId: null, text: dialogueText.slice(0, 200) } as any,
        nodeSource: "voice_gen",
      });
      pipelineLog.info(`[Pipeline] Voice generated for panel ${panel.id}: ${durationEstimate}s`);
    } catch (err) {
      pipelineLog.error(`[Pipeline] Voice gen failed for panel ${panel.id}:`, { error: String(err) });
    }

    totalCost += Math.round(NODE_COSTS.voice_gen / panelsWithDialogue.length);
    const progress = 25 + Math.round(((i + 1) / panelsWithDialogue.length) * 25);
    await updateNodeProgress(runId, "voice_gen", "running", nodeStatuses, progress, totalCost, nodeCosts);
    await sleep(800);
  }

  return totalCost;
}

async function musicGenAgent(runId: number, episodeId: number, nodeStatuses: NodeStatuses, nodeCosts: Record<string, number>) {
  let totalCost = Object.values(nodeCosts).reduce((a, b) => a + b, 0);
  totalCost += NODE_COSTS.music_gen;

  const episode = await getEpisodeById(episodeId);
  const genre = "cinematic anime";
  const mood = "dramatic, emotional";
  const title = episode?.title || "Untitled Episode";

  const musicKey = `pipeline/${runId}/bgm-${nanoid(6)}.mp3`;

  // Retry logic for transient network errors (e.g., socket closed)
  const MAX_RETRIES = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      pipelineLog.info(`[Pipeline] Music gen attempt ${attempt}/${MAX_RETRIES}`);
      const result = await generateSceneBGM({
        sceneDescription: `anime episode background score for "${title}", orchestral, cinematic`,
        mood,
      });

      const audioRes = await fetch(result.audioUrl);
      if (!audioRes.ok) throw new Error(`Failed to download music: ${audioRes.status}`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
      const { url } = await storagePut(musicKey, audioBuffer, "audio/mpeg");

      await createPipelineAsset({
        pipelineRunId: runId,
        episodeId,
        assetType: "music_segment",
        url,
        metadata: {
          duration: Math.round(result.durationMs / 1000),
          genre,
          mood,
          sizeBytes: result.sizeBytes,
          sampleRate: result.sampleRate,
        } as any,
        nodeSource: "music_gen",
      });
      pipelineLog.info(`[Pipeline] Music generated: ${Math.round(result.durationMs / 1000)}s, ${result.sizeBytes} bytes`);
      lastError = null;
      break; // Success — exit retry loop
    } catch (err: any) {
      lastError = err;
      pipelineLog.error(`[Pipeline] Music gen attempt ${attempt} failed:`, { error: String(err.message || err) });
      if (attempt < MAX_RETRIES) {
        const backoff = attempt * 3000; // 3s, 6s
        pipelineLog.info(`[Pipeline] Retrying music gen in ${backoff / 1000}s...`);
        await sleep(backoff);
      }
    }
  }

  // If all retries failed, use silent fallback
  if (lastError) {
    pipelineLog.error("[Pipeline] Music gen failed after all retries, using silent fallback");
    const silentBuffer = Buffer.alloc(1024, 0);
    try {
      const { url } = await storagePut(musicKey, silentBuffer, "audio/mpeg");
      await createPipelineAsset({
        pipelineRunId: runId,
        episodeId,
        assetType: "music_segment",
        url,
        metadata: { duration: 0, genre, mood, fallback: true } as any,
        nodeSource: "music_gen",
      });
    } catch (fallbackErr) {
      pipelineLog.error("[Pipeline] Music fallback also failed:", { error: String(fallbackErr) });
    }
  }

  await updateNodeProgress(runId, "music_gen", "running", nodeStatuses, 75, totalCost, nodeCosts);
  return totalCost;
}

async function assemblyAgent(runId: number, episodeId: number, nodeStatuses: NodeStatuses, nodeCosts: Record<string, number>) {
  let totalCost = Object.values(nodeCosts).reduce((a, b) => a + b, 0);
  totalCost += NODE_COSTS.assembly;

  const finalKey = `pipeline/${runId}/final-${nanoid(6)}.mp4`;

  try {
    // Gather all pipeline assets from previous nodes
    const allAssets = await getPipelineAssetsByRun(runId);

    // Collect video clips (sorted by panel number)
    // When both a video_clip and synced_clip exist for the same panel,
    // prefer the lip-synced version (synced_clip) over the original.
    const rawVideoAssets = allAssets
      .filter(a => a.assetType === "video_clip" || a.assetType === "synced_clip")
      .map(a => {
        const meta = (a.metadata || {}) as any;
        return {
          url: a.url,
          panelId: a.panelId || 0,
          panelNumber: meta.panelNumber ?? a.panelId ?? 0,
          duration: meta.duration || 5,
          hasNativeAudio: meta.hasNativeAudio || false,
          assetType: a.assetType as string,
        };
      });

    // Deduplicate: for each panelId, prefer synced_clip over video_clip
    const panelClipMap = new Map<number, typeof rawVideoAssets[0]>();
    for (const clip of rawVideoAssets) {
      const existing = panelClipMap.get(clip.panelId);
      if (!existing) {
        panelClipMap.set(clip.panelId, clip);
      } else if (clip.assetType === "synced_clip" && existing.assetType === "video_clip") {
        // Lip-synced version takes priority
        panelClipMap.set(clip.panelId, clip);
        pipelineLog.info(`[Assembly] Panel ${clip.panelNumber}: using lip-synced clip over original`);
      }
    }
    const videoClips = Array.from(panelClipMap.values());

    // Collect voice clips
    const voiceClips = allAssets
      .filter(a => a.assetType === "voice_clip")
      .map(a => {
        const meta = (a.metadata || {}) as any;
        return {
          url: a.url,
          panelId: a.panelId || 0,
          duration: meta.duration || 3,
          text: meta.text || "",
        };
      });

    // Collect music track
    const musicAsset = allAssets.find(a => a.assetType === "music_segment");
    const musicTrack = musicAsset ? {
      url: musicAsset.url,
      duration: ((musicAsset.metadata as any)?.duration) || 0,
      isFallback: ((musicAsset.metadata as any)?.fallback) || false,
    } : null;

    if (videoClips.length === 0) {
      pipelineLog.error("[Pipeline] No video clips found for assembly");
      throw new Error("No video clips available for assembly");
    }

    // ── Read panel transition data from DB ──
    const episodePanels = await getPanelsByEpisode(episodeId);
    const panelTransitionMap = new Map<number, { type: TransitionType; duration: number }>();
    for (const p of episodePanels) {
      panelTransitionMap.set(p.id, {
        type: (p.transition as TransitionType) || "cut",
        duration: p.transitionDuration ?? 0.5,
      });
    }

    // Build transitions array matching videoClips order (by panelId)
    const transitions: TransitionSpec[] = videoClips.map(vc => {
      const t = panelTransitionMap.get(vc.panelId);
      return t ? { type: t.type, duration: t.duration } : { type: "cut" as TransitionType, duration: 0.5 };
    });

    const nonCutCount = transitions.filter(t => t.type !== "cut").length;
    pipelineLog.info(`[Pipeline] Assembly: ${videoClips.length} video clips, ${voiceClips.length} voice clips, music: ${musicTrack ? (musicTrack.isFallback ? 'fallback' : 'yes') : 'none'}, transitions: ${nonCutCount} non-cut`);

    await updateNodeProgress(runId, "assembly", "running", nodeStatuses, 82, totalCost, nodeCosts);

    // Run the real ffmpeg assembly
    const episode = await getEpisodeById(episodeId);

    // Read per-episode assembly settings (lip sync, foley, ambient, loudness)
    const { mergeAssemblySettings } = await import("@shared/assemblySettings");
    const assemblySettings = mergeAssemblySettings(episode?.assemblySettings as any);
    pipelineLog.info(`[Pipeline] Assembly settings: lipSync=${assemblySettings.enableLipSync}, foley=${assemblySettings.enableFoley}, ambient=${assemblySettings.enableAmbient}`);

    // Collect foley assets from pipeline run (if foley is enabled)
    let foleyClips: any[] = [];
    if (assemblySettings.enableFoley) {
      const allAssets = await getPipelineAssetsByRun(runId);
      foleyClips = allAssets
        .filter((a: any) => a.assetType === "foley" || a.assetType === "sfx")
        .map((a: any) => ({
          url: a.url,
          panelId: (a.metadata as any)?.panelId || 0,
          duration: (a.metadata as any)?.duration || 1.0,
          category: (a.metadata as any)?.category || "sfx",
          targetLufs: assemblySettings.foleyLufs,
        }));
      pipelineLog.info(`[Pipeline] Found ${foleyClips.length} foley clips for assembly`);
    }

    // Collect ambient assets from pipeline run (if ambient is enabled)
    let ambientClips: any[] = [];
    if (assemblySettings.enableAmbient) {
      const allAssets = await getPipelineAssetsByRun(runId);
      ambientClips = allAssets
        .filter((a: any) => a.assetType === "ambient")
        .map((a: any) => ({
          url: a.url,
          startTimeSeconds: (a.metadata as any)?.startTimeSeconds || 0,
          duration: (a.metadata as any)?.duration || 30,
          loop: (a.metadata as any)?.loop !== false,
          fadeInSeconds: (a.metadata as any)?.fadeInSeconds || 1.0,
          fadeOutSeconds: (a.metadata as any)?.fadeOutSeconds || 1.5,
          targetLufs: assemblySettings.ambientLufs,
          label: (a.metadata as any)?.label || "ambient",
        }));
      pipelineLog.info(`[Pipeline] Found ${ambientClips.length} ambient clips for assembly`);
    }

    const result = await assembleVideo({
      videoClips,
      voiceClips,
      musicTrack,
      episodeTitle: episode?.title || "Untitled Episode",
      transitions,
      enableLipSync: assemblySettings.enableLipSync,
      enableFoley: assemblySettings.enableFoley,
      enableAmbient: assemblySettings.enableAmbient,
      foleyClips: foleyClips.length > 0 ? foleyClips : undefined,
      ambientClips: ambientClips.length > 0 ? ambientClips : undefined,
      voiceValidationThresholdLufs: assemblySettings.voiceValidationThresholdLufs,
      skipVoiceValidation: !assemblySettings.enableVoiceValidation,
    });

    await updateNodeProgress(runId, "assembly", "running", nodeStatuses, 90, totalCost, nodeCosts);

    // Upload assembled video to S3
    const { url } = await storagePut(finalKey, result.videoBuffer, "video/mp4");
    await createPipelineAsset({
      pipelineRunId: runId,
      episodeId,
      assetType: "final_video",
      url,
      metadata: {
        duration: result.totalDuration,
        format: result.format,
        resolution: result.resolution,
        sizeBytes: result.videoBuffer.length,
        clipCount: videoClips.length,
        voiceClipCount: voiceClips.length,
        hasMusic: musicTrack ? !musicTrack.isFallback : false,
      } as any,
      nodeSource: "assembly",
    });

    await updateEpisode(episodeId, { videoUrl: url } as any);
    pipelineLog.info(`[Pipeline] Final video assembled: ${result.totalDuration.toFixed(1)}s, ${(result.videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    // Upload to Cloudflare Stream for CDN delivery (non-blocking)
    try {
      const streamResult = await cfUploadFromUrl(url, { name: `episode-${episodeId}-final` });
      pipelineLog.info(`[Pipeline] Video uploaded to Cloudflare Stream: uid=${streamResult.uid}`);
      await createPipelineAsset({
        pipelineRunId: runId,
        episodeId,
        assetType: "stream_video",
        url: streamResult.preview || `https://cloudflarestream.com/${streamResult.uid}/watch`,
        metadata: { streamUid: streamResult.uid, status: streamResult.status.state } as any,
        nodeSource: "assembly",
      });
    } catch (streamErr) {
      pipelineLog.warn("[Pipeline] Cloudflare Stream upload failed (non-critical):", { detail: String(streamErr) });
    }
  } catch (err) {
    pipelineLog.error("[Pipeline] Assembly failed:", { error: String(err) });
  }

  // Create thumbnail
  try {
    const thumbResult = await generateImage({
      prompt: "Anime episode thumbnail, cinematic, dramatic lighting, high quality key visual",
    });
    if (thumbResult?.url) {
      await createPipelineAsset({
        pipelineRunId: runId,
        episodeId,
        assetType: "thumbnail",
        url: thumbResult.url,
        metadata: { format: "png", resolution: "1280x720" } as any,
        nodeSource: "assembly",
      });
      await updateEpisode(episodeId, { thumbnailUrl: thumbResult.url } as any);
    }
  } catch (err) {
    pipelineLog.error("[Pipeline] Thumbnail gen failed:", { error: String(err) });
  }

  await updateNodeProgress(runId, "assembly", "running", nodeStatuses, 95, totalCost, nodeCosts);
  return totalCost;
}

// ─── Main Orchestrator ──────────────────────────────────────────────────

export async function runPipeline(runId: number) {
  const run = await getPipelineRunById(runId);
  if (!run) throw new Error("Pipeline run not found");

  const nodeStatuses: NodeStatuses = {
    video_gen: "pending",
    voice_gen: "pending",
    lip_sync: "pending",
    music_gen: "pending",
    foley_gen: "pending",
    ambient_gen: "pending",
    assembly: "pending",
  };
  const nodeCosts: Record<string, number> = {};
  let totalCost = 0;
  let harnessCost = 0;

  await updatePipelineRun(runId, {
    status: "running",
    startedAt: new Date(),
    nodeStatuses: nodeStatuses as any,
    currentNode: "video_gen",
  });

  // Update episode status
  await updateEpisode(run.episodeId, { status: "pipeline" } as any);

  // Compile Production Bible for harness checks
  let bible: ProductionBibleData;
  try {
    bible = await getOrCompileProductionBible(run.projectId);
    pipelineLog.info(`[Pipeline] Production Bible compiled for project ${run.projectId}`);
  } catch (err) {
    pipelineLog.warn(`[Pipeline] Production Bible compilation failed, using defaults:`, { detail: String(err) });
    bible = {
      version: 1,
      projectId: run.projectId,
      projectTitle: "Unknown",
      genre: ["unknown"],
      artStyle: "default",
      compiledAt: new Date().toISOString(),
      characters: [],
      characterNameMap: {},
      animationStyle: "default",
      styleMixing: null,
      colorGrading: "neutral",
      atmosphericEffects: null,
      aspectRatio: "16:9",
      voiceAssignments: {},
      audioConfig: null,
      musicConfig: null,
      openingStyle: "standard",
      endingStyle: "standard",
      pacing: "normal",
      subtitleConfig: null,
      episodes: [],
      qualityThresholds: {
        minImageScore: 6.0,
        minCharacterMatch: 7.0,
        minVideoScore: 5.5,
        minAudioScore: 6.0,
        maxRetries: 3,
        blockOnNsfw: true,
      },
    };
  }

  const baseContext: HarnessContext = {
    episodeId: run.episodeId,
    pipelineRunId: runId,
  };

  // ── HITL Gate Architecture: Initialize 12-stage tracking ──
  let hitlEnabled = false;
  let userTier = "free_trial";
  try {
    userTier = await getUserTierForRun(runId);
    await initializeHitlForRun(runId, run.userId, userTier);
    const preFlightResult = await processPreFlightStages(runId, run.userId, userTier);
    if (preFlightResult.blocked) {
      pipelineLog.info(`[Pipeline] HITL pre-flight blocked at stage ${preFlightResult.blockingStage}`);
      await pausePipelineForGate(runId, preFlightResult.blockingGateId!, preFlightResult.blockingStage!);
      return; // Pipeline paused — will resume via submitDecision
    }
    hitlEnabled = true;
    pipelineLog.info(`[Pipeline] HITL initialized: 12 stages, tier=${userTier}, pre-flight passed`);
  } catch (hitlErr) {
    pipelineLog.warn(`[Pipeline] HITL initialization failed, running without gates:`, { detail: String(hitlErr) });
    hitlEnabled = false;
  }

  try {
    // ── Layer 1: Script Validation (pre-flight) ──
    // Populate targetData with episode panels so harness checks can validate
    const episodePanelsForHarness = await getPanelsByEpisode(run.episodeId);
    const scriptData = {
      panels: episodePanelsForHarness.map(p => ({
        panelId: p.id,
        sceneNumber: p.sceneNumber,
        panelNumber: p.panelNumber,
        visualDescription: p.visualDescription,
        cameraAngle: p.cameraAngle,
        dialogue: p.dialogue,
        sfx: p.sfx,
        transition: p.transition,
        imageUrl: p.imageUrl,
      })),
    };
    pipelineLog.info(`[Pipeline] Running Layer 1: Script Validation (${scriptData.panels.length} panels)...`);
    const scriptSummary = await runHarnessGate(
      "Layer 1: Script Validation",
      scriptChecks,
      { ...baseContext, targetType: "episode", targetData: scriptData },
      bible,
      runId,
    );
    harnessCost += scriptSummary.totalCost;
    if (scriptSummary.shouldBlock) {
      throw new Error(`Pipeline blocked by Script Validation harness: ${scriptSummary.flaggedItems.map(f => f.checkName).join(", ")}`);
    }

    // Node 1: Video Generation (with native lip sync via Kling V3 Omni for dialogue panels)
    await updateNodeProgress(runId, "video_gen", "running", nodeStatuses, 5, totalCost, nodeCosts);
    totalCost = await videoGenAgent(runId, run.episodeId, run.projectId, nodeStatuses, nodeCosts);
    nodeStatuses.video_gen = "complete";
    nodeCosts.video_gen = NODE_COSTS.video_gen;
    await updateNodeProgress(runId, "video_gen", "complete", nodeStatuses, 22, totalCost, nodeCosts);

    // ── HITL Gate: Video Generation (v1.9 Stage 10: douga) ──
    if (hitlEnabled) {
      const videoGateResult = await completeNodeWithGate({
        pipelineRunId: runId,
        node: LEGACY_NODE_TO_V19.video_gen,
        userId: run.userId,
        tierName: userTier,
        generationResult: { requestType: "video", outputUrl: "", outputFileSize: 50_000_000 },
        scoreContext: { stageNumber: 10 },
        creditsActual: NODE_COSTS.video_gen,
      });
      if (videoGateResult.blocked) {
        pipelineLog.info(`[Pipeline] HITL gate blocked after video_gen (stage ${videoGateResult.primaryStage})`);
        await pausePipelineForGate(runId, videoGateResult.gateResult.gateId, videoGateResult.primaryStage);
        return; // Pipeline paused — will resume via submitDecision
      }
    }

    // ── Layer 2+3: Visual + Video Quality (after video_gen) ──
    pipelineLog.info(`[Pipeline] Running Layer 2: Visual Consistency + Layer 3: Video Quality...`);
    const visualSummary = await runHarnessGate(
      "Layer 2: Visual Consistency",
      visualChecks,
      { ...baseContext, targetType: "panel" },
      bible,
      runId,
    );
    harnessCost += visualSummary.totalCost;
    if (visualSummary.shouldBlock) {
      throw new Error(`Pipeline blocked by Visual Consistency harness: ${visualSummary.flaggedItems.map(f => f.checkName).join(", ")}`);
    }

    const videoSummary = await runHarnessGate(
      "Layer 3: Video Quality",
      videoChecks,
      { ...baseContext, targetType: "clip" },
      bible,
      runId,
    );
    harnessCost += videoSummary.totalCost;
    if (videoSummary.shouldBlock) {
      throw new Error(`Pipeline blocked by Video Quality harness: ${videoSummary.flaggedItems.map(f => f.checkName).join(", ")}`);
    }
    await updateNodeProgress(runId, "video_gen", "complete", nodeStatuses, 25, totalCost, nodeCosts);

    // ── D5.5: Per-Clip Quality Gate (Stage 11: post_video_review) ──
    pipelineLog.info(`[Pipeline] Running D5.5 per-clip quality gate...`);
    try {
      const allAssetsForD5_5 = await getPipelineAssetsByRun(runId);
      const clipAssetsForReview: ClipAssetInfo[] = allAssetsForD5_5
        .filter(a => a.assetType === "video_clip" || a.assetType === "synced_clip")
        .map(a => {
          const meta = (a.metadata || {}) as any;
          return {
            assetId: a.id,
            panelId: a.panelId || 0,
            panelNumber: meta.panelNumber ?? a.panelId ?? 0,
            url: a.url,
            duration: meta.duration || 5,
            assetType: a.assetType as "video_clip" | "synced_clip",
            metadata: meta,
          };
        });

      // Deduplicate: prefer synced_clip over video_clip per panel
      const panelClipDedup = new Map<number, ClipAssetInfo>();
      for (const clip of clipAssetsForReview) {
        const existing = panelClipDedup.get(clip.panelId);
        if (!existing || (clip.assetType === "synced_clip" && existing.assetType === "video_clip")) {
          panelClipDedup.set(clip.panelId, clip);
        }
      }
      const dedupedClips = Array.from(panelClipDedup.values());

      const episodePanels = await getPanelsByEpisode(run.episodeId);
      const d5_5Panels: D5_5PanelInfo[] = episodePanels.map(p => {
        const dlg = p.dialogue as any;
        let dialogueArr: Array<{ character?: string; text: string; emotion?: string }> | null = null;
        if (Array.isArray(dlg)) {
          dialogueArr = dlg.map((d: any) => ({
            character: d?.character || d?.speaker,
            text: d?.text || d?.line || d?.dialogue || (typeof d === "string" ? d : ""),
            emotion: d?.emotion,
          }));
        } else if (typeof dlg === "string" && dlg) {
          dialogueArr = [{ text: dlg }];
        }
        return {
          id: p.id,
          panelNumber: p.panelNumber ?? 0,
          sceneNumber: p.sceneNumber ?? 1,
          visualDescription: p.visualDescription ? String(p.visualDescription) : null,
          cameraAngle: p.cameraAngle || null,
          dialogue: dialogueArr,
          sfx: p.sfx ? String(p.sfx) : null,
        };
      });

      // Build character bibles from project characters
      const projectChars = await getCharactersByProject(run.projectId);
      const charBibles = buildCharacterBiblesMap(
        projectChars.map(c => ({
          name: c.name,
          visualTraits: (c as any).visualTraits || {},
          referenceImages: (c as any).referenceImageUrls || [],
        }))
      );

      // Derive style lock from project anime style
      const projectForStyle = await (async () => {
        const dbMod = await import("./db");
        const db = await dbMod.getDb();
        if (!db) return null;
        const { projects } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [proj] = await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1);
        return proj || null;
      })();
      const styleLock = deriveStyleLock(
        projectForStyle?.animeStyle || "default",
        bible ? { artStyle: (bible as any).artDirection?.style || bible.artStyle, genre: (bible as any).metadata?.genres || bible.genre } : undefined
      );

      const d5_5Context: D5_5PipelineContext = {
        pipelineRunId: runId,
        episodeId: run.episodeId,
        projectId: run.projectId,
        userId: run.userId,
        clipAssets: dedupedClips,
        panels: d5_5Panels,
        characterBibles: charBibles,
        styleLock,
        regenerateClip: async (panelId: number, attempt: number) => {
          pipelineLog.info(`[D5.5 Regen] Regenerating clip for panel ${panelId} (attempt ${attempt})`);
          const panel = episodePanels.find(p => p.id === panelId);
          if (!panel || !panel.imageUrl) {
            throw new Error(`Cannot regenerate: panel ${panelId} not found or has no image`);
          }
          const vidResult = await generateImageToVideo({
            imageUrl: panel.imageUrl,
            prompt: `Cinematic anime scene, ${String(panel.visualDescription || "dramatic scene")}. Anime style, high quality animation, fluid movement.`,
            duration: "10",
            mode: "pro",
          });
          const regenKey = `pipeline/${runId}/regen/${panelId}_attempt${attempt}_${nanoid(6)}.mp4`;
          const { url: storedUrl } = await storagePut(regenKey, Buffer.from(await (await fetch(vidResult.videoUrl)).arrayBuffer()), "video/mp4");
          return {
            clipUrl: storedUrl,
            keyframeUrls: [storedUrl],
            costUsd: 0.20,
          };
        },
        userTier,
      };

      const d5_5Result = await runD5_5QualityGate(d5_5Context);
      totalCost += d5_5Result.totalCostUsd;

      // HITL Gate: D5.5 Quality Gate (v1.9 Stage 11: post_video_review)
      if (hitlEnabled) {
        const d5_5GateResult = await completeNodeWithGate({
          pipelineRunId: runId,
          node: "continuity_check" as OrchestratorNode,
          userId: run.userId,
          tierName: userTier,
          generationResult: {
            requestType: "video",
            outputUrl: "",
            outputFileSize: 0,
          },
          scoreContext: { stageNumber: 11 },
          creditsActual: d5_5Result.totalCostUsd,
        });
        if (d5_5GateResult.blocked) {
          pipelineLog.info(`[Pipeline] HITL gate blocked after D5.5 quality gate (stage ${d5_5GateResult.primaryStage})`);
          await pausePipelineForGate(runId, d5_5GateResult.gateResult.gateId, d5_5GateResult.primaryStage);
          return;
        }
      }

      if (!d5_5Result.canProceed) {
        pipelineLog.warn(`[Pipeline] D5.5 quality gate BLOCKED: ${d5_5Result.escalated} escalated, pass rate below threshold`);
        throw new Error(`Pipeline blocked by D5.5 quality gate: ${d5_5Result.escalated} clips escalated, avg score ${d5_5Result.avgQualityScore}`);
      }

      pipelineLog.info(`[Pipeline] D5.5 quality gate passed: ${d5_5Result.passedFirstAttempt + d5_5Result.passedAfterRetry}/${d5_5Result.totalClips} clips, avg=${d5_5Result.avgQualityScore}, cost=$${d5_5Result.totalCostUsd.toFixed(3)}`);
    } catch (d5_5Err: any) {
      if (d5_5Err.message?.includes("Pipeline blocked") || d5_5Err.message?.includes("HITL gate blocked")) {
        throw d5_5Err;
      }
      pipelineLog.warn(`[Pipeline] D5.5 quality gate failed (non-blocking), continuing: ${d5_5Err.message}`);
    }

    // Node 2: Voice Generation (supplementary high-quality TTS via ElevenLabs)
    await updateNodeProgress(runId, "voice_gen", "running", nodeStatuses, 30, totalCost, nodeCosts);
    totalCost = await voiceGenAgent(runId, run.episodeId, run.projectId, nodeStatuses, nodeCosts);
    nodeStatuses.voice_gen = "complete";
    nodeCosts.voice_gen = NODE_COSTS.voice_gen;
    await updateNodeProgress(runId, "voice_gen", "complete", nodeStatuses, 47, totalCost, nodeCosts);

    // ── HITL Gate: Voice Generation (v1.9 Stage 13: ato_fuki) ──
    if (hitlEnabled) {
      const voiceGateResult = await completeNodeWithGate({
        pipelineRunId: runId,
        node: LEGACY_NODE_TO_V19.voice_gen,
        userId: run.userId,
        tierName: userTier,
        generationResult: { requestType: "voice", outputUrl: "", outputFileSize: 2_000_000 },
        scoreContext: { stageNumber: 13 },
        creditsActual: NODE_COSTS.voice_gen,
      });
      if (voiceGateResult.blocked) {
        pipelineLog.info(`[Pipeline] HITL gate blocked after voice_gen (stage ${voiceGateResult.primaryStage})`);
        await pausePipelineForGate(runId, voiceGateResult.gateResult.gateId, voiceGateResult.primaryStage);
        return; // Pipeline paused
      }
    }

    // ── Layer 4: Audio Quality (after voice_gen) ──
    pipelineLog.info(`[Pipeline] Running Layer 4: Audio Quality...`);
    const audioSummary = await runHarnessGate(
      "Layer 4: Audio Quality",
      audioChecks,
      { ...baseContext, targetType: "clip" },
      bible,
      runId,
    );
    harnessCost += audioSummary.totalCost;
    if (audioSummary.shouldBlock) {
      throw new Error(`Pipeline blocked by Audio Quality harness: ${audioSummary.flaggedItems.map(f => f.checkName).join(", ")}`);
    }
    await updateNodeProgress(runId, "voice_gen", "complete", nodeStatuses, 47, totalCost, nodeCosts);

    // Node 3: Automated Lip Sync (Kling face detection + advanced lip sync)
    // Runs after voice_gen (needs voice clips) and video_gen (needs video clips)
    // Gated by enableLipSync in assembly settings (default: false)
    {
      const episodeForLipSync = await getEpisodeById(run.episodeId);
      const { mergeAssemblySettings: mergeLipSyncSettings } = await import("@shared/assemblySettings");
      const lipSyncSettings = mergeLipSyncSettings(episodeForLipSync?.assemblySettings as any);

      if (lipSyncSettings.enableLipSync) {
        await updateNodeProgress(runId, "lip_sync", "running", nodeStatuses, 48, totalCost, nodeCosts);
        try {
          const lipSyncResult = await lipSyncNode(runId, run.episodeId, {
            voiceVolume: 2,
            originalAudioVolume: 0,
            skipNativeLipSync: true,
          });
          nodeStatuses.lip_sync = "complete";
          nodeCosts.lip_sync = lipSyncResult.totalCostCents;
          totalCost += lipSyncResult.totalCostCents;
          pipelineLog.info(`[Pipeline] Lip sync: ${lipSyncResult.summary}`);
          await updateNodeProgress(runId, "lip_sync", "complete", nodeStatuses, 52, totalCost, nodeCosts);
        } catch (lipSyncErr: any) {
          pipelineLog.error(`[Pipeline] Lip sync node failed (non-blocking):`, { error: String(lipSyncErr.message) });
          nodeStatuses.lip_sync = "failed";
          await updateNodeProgress(runId, "lip_sync", "failed", nodeStatuses, 52, totalCost, nodeCosts);
          // Non-blocking: assembly will use original video clips without lip sync
        }
      } else {
        nodeStatuses.lip_sync = "skipped";
        pipelineLog.info(`[Pipeline] Lip sync skipped (disabled in assembly settings)`);
        await updateNodeProgress(runId, "lip_sync", "skipped", nodeStatuses, 52, totalCost, nodeCosts);
      }
    }

    // Node 4: Music Generation (MiniMax Music 2.6)
    await updateNodeProgress(runId, "music_gen", "running", nodeStatuses, 55, totalCost, nodeCosts);
    totalCost = await musicGenAgent(runId, run.episodeId, nodeStatuses, nodeCosts);
    nodeStatuses.music_gen = "complete";
    nodeCosts.music_gen = NODE_COSTS.music_gen;
    await updateNodeProgress(runId, "music_gen", "complete", nodeStatuses, 75, totalCost, nodeCosts);

    // ── HITL Gate: Music Generation (v1.9 Stage 12: x_sheet) ──
    if (hitlEnabled) {
      const musicGateResult = await completeNodeWithGate({
        pipelineRunId: runId,
        node: LEGACY_NODE_TO_V19.music_gen,
        userId: run.userId,
        tierName: userTier,
        generationResult: { requestType: "music", outputUrl: "", outputFileSize: 5_000_000 },
        scoreContext: { stageNumber: 12 },
        creditsActual: NODE_COSTS.music_gen,
      });
      if (musicGateResult.blocked) {
        pipelineLog.info(`[Pipeline] HITL gate blocked after music_gen (stage ${musicGateResult.primaryStage})`);
        await pausePipelineForGate(runId, musicGateResult.gateResult.gateId, musicGateResult.primaryStage);
        return; // Pipeline paused
      }
    }

    // Node 4: Foley Generation (AI sound effects per panel)
    // Read assembly settings to check if foley is enabled
    const episodeForSettings = await getEpisodeById(run.episodeId);
    const { mergeAssemblySettings: mergeSettings } = await import("@shared/assemblySettings");
    const pipelineSettings = mergeSettings(episodeForSettings?.assemblySettings as any);

    if (pipelineSettings.enableFoley) {
      await updateNodeProgress(runId, "foley_gen", "running", nodeStatuses, 76, totalCost, nodeCosts);
      try {
        const foleyResult = await foleyGenNode(runId, run.episodeId, {
          targetLufs: pipelineSettings.foleyLufs,
          minConfidence: 0.3,
        });
        totalCost += foleyResult.totalCostCents;
        nodeStatuses.foley_gen = "complete";
        nodeCosts.foley_gen = foleyResult.totalCostCents;
        pipelineLog.info(`[Pipeline] Foley generation complete: ${foleyResult.clipsGenerated} clips, ${foleyResult.clipsFailed} failed, cost $${(foleyResult.totalCostCents / 100).toFixed(2)}`);
      } catch (foleyErr: any) {
        pipelineLog.error(`[Pipeline] Foley generation failed (non-blocking):`, { error: String(foleyErr.message) });
        nodeStatuses.foley_gen = "failed";
      }
      await updateNodeProgress(runId, "foley_gen", nodeStatuses.foley_gen, nodeStatuses, 79, totalCost, nodeCosts);
    } else {
      nodeStatuses.foley_gen = "skipped";
      pipelineLog.info(`[Pipeline] Foley generation skipped (disabled in assembly settings)`);
    }

    // Node 5: Ambient Detection & Generation (scene-matched ambient loops)
    if (pipelineSettings.enableAmbient) {
      await updateNodeProgress(runId, "ambient_gen", "running", nodeStatuses, 79, totalCost, nodeCosts);
      try {
        const ambientResult = await ambientGenNode(runId, run.episodeId, {
          targetLufs: pipelineSettings.ambientLufs,
          enableSecondaryLayers: true,
          minConfidence: 0.2,
        });
        totalCost += ambientResult.totalCostCents;
        nodeStatuses.ambient_gen = "complete";
        nodeCosts.ambient_gen = ambientResult.totalCostCents;
        pipelineLog.info(`[Pipeline] Ambient generation complete: ${ambientResult.clipsGenerated} clips for ${ambientResult.scenesDetected} scenes, cost $${(ambientResult.totalCostCents / 100).toFixed(2)}`);
      } catch (ambientErr: any) {
        pipelineLog.error(`[Pipeline] Ambient generation failed (non-blocking):`, { error: String(ambientErr.message) });
        nodeStatuses.ambient_gen = "failed";
      }
      await updateNodeProgress(runId, "ambient_gen", nodeStatuses.ambient_gen, nodeStatuses, 80, totalCost, nodeCosts);
    } else {
      nodeStatuses.ambient_gen = "skipped";
      pipelineLog.info(`[Pipeline] Ambient generation skipped (disabled in assembly settings)`);
    }

    // ── HITL Gate: Foley + Ambient (v1.9 Stage 14: fx_pass) ──
    if (hitlEnabled && (nodeStatuses.foley_gen === "complete" || nodeStatuses.ambient_gen === "complete")) {
      const sfxGateResult = await completeNodeWithGate({
        pipelineRunId: runId,
        node: LEGACY_NODE_TO_V19.foley_gen,
        userId: run.userId,
        tierName: userTier,
        generationResult: { requestType: "music", outputUrl: "", outputFileSize: 3_000_000 },
        scoreContext: { stageNumber: 14 },
        creditsActual: (nodeCosts.foley_gen || 0) + (nodeCosts.ambient_gen || 0),
      });
      if (sfxGateResult.blocked) {
        pipelineLog.info(`[Pipeline] HITL gate blocked after foley/ambient_gen (stage ${sfxGateResult.primaryStage})`);
        await pausePipelineForGate(runId, sfxGateResult.gateResult.gateId, sfxGateResult.primaryStage);
        return; // Pipeline paused
      }
    }

    // Node 6: Assembly (final video + Cloudflare Stream + thumbnail)
    await updateNodeProgress(runId, "assembly", "running", nodeStatuses, 80, totalCost, nodeCosts);
    totalCost = await assemblyAgent(runId, run.episodeId, nodeStatuses, nodeCosts);
    nodeStatuses.assembly = "complete";
    nodeCosts.assembly = NODE_COSTS.assembly;
    await updateNodeProgress(runId, "assembly", "complete", nodeStatuses, 95, totalCost, nodeCosts);

    // ── HITL Gate: Assembly / Mastering (v1.9 Stage 16: mastering_harness) ──
    if (hitlEnabled) {
      const assemblyGateResult = await completeNodeWithGate({
        pipelineRunId: runId,
        node: LEGACY_NODE_TO_V19.assembly,
        userId: run.userId,
        tierName: userTier,
        generationResult: { requestType: "video", outputUrl: "", outputFileSize: 100_000_000 },
        scoreContext: { stageNumber: 16 },
        creditsActual: NODE_COSTS.assembly,
      });
      if (assemblyGateResult.blocked) {
        pipelineLog.info(`[Pipeline] HITL gate blocked after assembly (stage ${assemblyGateResult.primaryStage})`);
        await pausePipelineForGate(runId, assemblyGateResult.gateResult.gateId, assemblyGateResult.primaryStage);
        return; // Pipeline paused — final review before publish
      }
    }

    // ── Layer 5: Integration Validation (after assembly) ──
    pipelineLog.info(`[Pipeline] Running Layer 5: Integration Validation...`);
    const integrationSummary = await runHarnessGate(
      "Layer 5: Integration Validation",
      integrationChecks,
      { ...baseContext, targetType: "episode" },
      bible,
      runId,
    );
    harnessCost += integrationSummary.totalCost;
    // Layer 5 blocks don't stop the pipeline (video is already assembled)
    // but they flag the episode for human review
    if (integrationSummary.shouldBlock) {
      pipelineLog.warn(`[Pipeline] Layer 5 BLOCK — episode flagged for human review`);
    }

    // Compute overall harness score across all layers
    const allSummaries = [scriptSummary, visualSummary, videoSummary, audioSummary, integrationSummary];
    const overallHarnessScore = allSummaries.reduce((sum, s) => sum + s.overallScore, 0) / allSummaries.length;
    const totalFlagged = allSummaries.reduce((sum, s) => sum + s.flaggedItems.length, 0);
    const totalPassed = allSummaries.reduce((sum, s) => sum + s.passed, 0);
    const totalChecks = allSummaries.reduce((sum, s) => sum + s.totalChecks, 0);

    pipelineLog.info(`[Pipeline] Harness complete: ${totalPassed}/${totalChecks} passed, score=${overallHarnessScore.toFixed(1)}, cost=$${harnessCost.toFixed(3)}, flagged=${totalFlagged}`);

    await updateNodeProgress(runId, "assembly", "complete", nodeStatuses, 100, totalCost, nodeCosts);

    // Mark as completed, move to QA review
    await updatePipelineRun(runId, {
      status: "completed",
      currentNode: "qa_review",
      progress: 100,
      completedAt: new Date(),
      totalCost,
    });

    await updateEpisode(run.episodeId, { status: "review" } as any);

    await notifyOwner({
      title: "Pipeline Complete",
      content: `Episode pipeline run #${runId} completed. Harness: ${totalPassed}/${totalChecks} passed (score: ${overallHarnessScore.toFixed(1)}/10). Cost: $${(totalCost / 100).toFixed(2)} + $${harnessCost.toFixed(3)} harness. ${totalFlagged > 0 ? `${totalFlagged} item(s) flagged for review.` : "No issues found."}`,
    });

  } catch (error: any) {
    const currentNode = NODE_ORDER.find(n => nodeStatuses[n] === "running") || "video_gen";
    nodeStatuses[currentNode] = "failed";

    const errors = [{ node: currentNode, message: error.message || "Unknown error", timestamp: new Date().toISOString() }];

    await updatePipelineRun(runId, {
      status: "failed",
      errors: errors as any,
      nodeStatuses: nodeStatuses as any,
      completedAt: new Date(),
      totalCost,
    });

    await updateEpisode(run.episodeId, { status: "locked" } as any);

    await notifyOwner({
      title: "Pipeline Failed",
      content: `Episode pipeline run #${runId} failed at node "${currentNode}": ${error.message}`,
    });
  }
}

// ─── Resume Pipeline After HITL Gate Decision ────────────────────────────

/**
 * Resume a paused pipeline after a HITL gate decision (approve or regenerate).
 * Picks up from the node that was paused and continues the remaining nodes.
 *
 * Called from the submitDecision tRPC procedure after a creator approves or
 * regenerates a gate. The pipeline resumes from the next node after the
 * approved/regenerated one.
 */
export async function resumePipeline(runId: number, fromNode: NodeName, action: "continue" | "regenerate") {
  const run = await getPipelineRunById(runId);
  if (!run) throw new Error("Pipeline run not found");

  // Restore node statuses from the saved state
  const savedStatuses = run.nodeStatuses as any as NodeStatuses | null;
  const nodeStatuses: NodeStatuses = savedStatuses || {
    video_gen: "pending",
    voice_gen: "pending",
    lip_sync: "pending",
    music_gen: "pending",
    foley_gen: "pending",
    ambient_gen: "pending",
    assembly: "pending",
  };
  const nodeCosts: Record<string, number> = (run.nodeCosts as any) || {};
  let totalCost = run.totalCost || 0;
  let harnessCost = 0;

  // Determine the user's tier for HITL gates
  let userTier = "free_trial";
  try {
    userTier = await getUserTierForRun(runId);
  } catch { /* use default */ }

  // Mark pipeline as running again
  await updatePipelineRun(runId, {
    status: "running",
    currentNode: action === "regenerate" ? fromNode as any : undefined,
  });

  // Compile Production Bible for harness checks
  let bible: ProductionBibleData;
  try {
    bible = await getOrCompileProductionBible(run.projectId);
  } catch {
    bible = {
      version: 1,
      projectId: run.projectId,
      projectTitle: "Unknown",
      genre: ["unknown"],
      artStyle: "default",
      compiledAt: new Date().toISOString(),
      characters: [],
      characterNameMap: {},
      animationStyle: "default",
      styleMixing: null,
      colorGrading: "neutral",
      atmosphericEffects: null,
      aspectRatio: "16:9",
      voiceAssignments: {},
      audioConfig: null,
      musicConfig: null,
      openingStyle: "standard",
      endingStyle: "standard",
      pacing: "normal",
      subtitleConfig: null,
      episodes: [],
      qualityThresholds: {
        minImageScore: 6.0,
        minCharacterMatch: 7.0,
        minVideoScore: 5.5,
        minAudioScore: 6.0,
        maxRetries: 3,
        blockOnNsfw: true,
      },
    };
  }

  const baseContext: HarnessContext = {
    episodeId: run.episodeId,
    pipelineRunId: runId,
  };

  // Determine which nodes to run based on action and fromNode
  const fromIndex = NODE_ORDER.indexOf(fromNode);
  const startIndex = action === "regenerate" ? fromIndex : fromIndex + 1;

  pipelineLog.info(`[Pipeline] Resuming run #${runId} from ${action === "regenerate" ? fromNode + " (regen)" : NODE_ORDER[startIndex] || "completion"}, tier=${userTier}`);

  try {
    for (let i = startIndex; i < NODE_ORDER.length; i++) {
      const node = NODE_ORDER[i];

      // Execute the node
      await updateNodeProgress(runId, node, "running", nodeStatuses, 5 + (i * 25), totalCost, nodeCosts);

      switch (node) {
        case "video_gen":
          totalCost = await videoGenAgent(runId, run.episodeId, run.projectId, nodeStatuses, nodeCosts);
          break;
        case "voice_gen":
          totalCost = await voiceGenAgent(runId, run.episodeId, run.projectId, nodeStatuses, nodeCosts);
          break;
        case "lip_sync": {
          const epForLs = await getEpisodeById(run.episodeId);
          const { mergeAssemblySettings: mergeLs } = await import("@shared/assemblySettings");
          const lsSettings = mergeLs(epForLs?.assemblySettings as any);
          if (lsSettings.enableLipSync) {
            await updateNodeProgress(runId, "lip_sync", "running", nodeStatuses, 48, totalCost, nodeCosts);
            const lsResult = await lipSyncNode(runId, run.episodeId, {
              voiceVolume: 2,
              originalAudioVolume: 0,
              skipNativeLipSync: true,
            });
            totalCost += lsResult.totalCostCents;
            pipelineLog.info(`[Pipeline] Lip sync: ${lsResult.summary}`);
          } else {
            nodeStatuses.lip_sync = "skipped";
            pipelineLog.info(`[Pipeline] Lip sync skipped (disabled in assembly settings)`);
          }
          break;
        }
        case "music_gen":
          totalCost = await musicGenAgent(runId, run.episodeId, nodeStatuses, nodeCosts);
          break;
        case "assembly":
          totalCost = await assemblyAgent(runId, run.episodeId, nodeStatuses, nodeCosts);
          break;
      }

      nodeStatuses[node] = "complete";
      nodeCosts[node] = NODE_COSTS[node];
      await updateNodeProgress(runId, node, "complete", nodeStatuses, 20 + (i * 25), totalCost, nodeCosts);

      // Run harness gates after each node
      if (node === "video_gen") {
        const visualSummary = await runHarnessGate("Layer 2: Visual Consistency", visualChecks, { ...baseContext, targetType: "panel" }, bible, runId);
        harnessCost += visualSummary.totalCost;
        if (visualSummary.shouldBlock) throw new Error(`Pipeline blocked by Visual Consistency harness`);

        const videoSummary = await runHarnessGate("Layer 3: Video Quality", videoChecks, { ...baseContext, targetType: "clip" }, bible, runId);
        harnessCost += videoSummary.totalCost;
        if (videoSummary.shouldBlock) throw new Error(`Pipeline blocked by Video Quality harness`);
      } else if (node === "voice_gen") {
        const audioSummary = await runHarnessGate("Layer 4: Audio Quality", audioChecks, { ...baseContext, targetType: "clip" }, bible, runId);
        harnessCost += audioSummary.totalCost;
        if (audioSummary.shouldBlock) throw new Error(`Pipeline blocked by Audio Quality harness`);
      }

      // HITL gate check after each node (legacy adapter → v1.9 OrchestratorNode)
      const v19Node = LEGACY_NODE_TO_V19[node];
      const v19StageMap: Record<NodeName, number> = { video_gen: 10, voice_gen: 13, lip_sync: 13, music_gen: 12, foley_gen: 14, ambient_gen: 14, assembly: 16 };
      const gateResult = await completeNodeWithGate({
        pipelineRunId: runId,
        node: v19Node,
        userId: run.userId,
        tierName: userTier,
        generationResult: {
          requestType: node === "voice_gen" ? "voice" : node === "music_gen" ? "music" : "video",
          outputUrl: "",
          outputFileSize: node === "assembly" ? 100_000_000 : node === "video_gen" ? 50_000_000 : 5_000_000,
        },
        scoreContext: { stageNumber: v19StageMap[node] },
        creditsActual: NODE_COSTS[node],
      });

      if (gateResult.blocked) {
        pipelineLog.info(`[Pipeline] HITL gate blocked after ${node} (stage ${gateResult.primaryStage})`);
        await pausePipelineForGate(runId, gateResult.gateResult.gateId, gateResult.primaryStage);
        return; // Pipeline paused again — will resume via next submitDecision
      }
    }

    // All nodes complete — run Layer 5 integration validation
    const integrationSummary = await runHarnessGate("Layer 5: Integration Validation", integrationChecks, { ...baseContext, targetType: "episode" }, bible, runId);
    harnessCost += integrationSummary.totalCost;
    if (integrationSummary.shouldBlock) {
      pipelineLog.warn(`[Pipeline] Layer 5 BLOCK — episode flagged for human review`);
    }

    await updateNodeProgress(runId, "assembly", "complete", nodeStatuses, 100, totalCost, nodeCosts);

    // Mark as completed
    await updatePipelineRun(runId, {
      status: "completed",
      currentNode: "qa_review",
      progress: 100,
      completedAt: new Date(),
      totalCost,
    });

    await updateEpisode(run.episodeId, { status: "review" } as any);

    await notifyOwner({
      title: "Pipeline Complete (Resumed)",
      content: `Episode pipeline run #${runId} completed after HITL resume. Cost: $${(totalCost / 100).toFixed(2)} + $${harnessCost.toFixed(3)} harness.`,
    });

  } catch (error: any) {
    const currentNode = NODE_ORDER.find(n => nodeStatuses[n] === "running") || fromNode;
    nodeStatuses[currentNode] = "failed";

    await updatePipelineRun(runId, {
      status: "failed",
      errors: [{ node: currentNode, message: error.message || "Unknown error", timestamp: new Date().toISOString() }] as any,
      nodeStatuses: nodeStatuses as any,
      completedAt: new Date(),
      totalCost,
    });

    await updateEpisode(run.episodeId, { status: "locked" } as any);

    await notifyOwner({
      title: "Pipeline Failed (Resumed)",
      content: `Episode pipeline run #${runId} failed at node "${currentNode}" after HITL resume: ${error.message}`,
    });
  }
}
