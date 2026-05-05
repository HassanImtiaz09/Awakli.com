import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectsByUserId, getProjectById, createProject, updateProject, deleteProject,
  createMangaUpload, getMangaUploadsByProject, getMangaUploadById,
  createProcessingJob, getJobsByUserId, getJobsByProject, getJobById,
  createEpisode, getEpisodesByProject, getEpisodeById, updateEpisode, deleteEpisode,
  createPanel, createPanelsBulk, getPanelsByEpisode, updatePanel, deletePanelsByEpisode,
  getPanelById, getPanelsByProject, batchUpdatePanelStatus, getPanelsGeneratingCount,
  createCharacter, getCharactersByProject, getCharacterById, updateCharacter, deleteCharacter,
  // Phase 4
  createComment, getCommentsByEpisode, deleteComment,
  toggleFollow, getFollowStatus, getFollowerCount, getFollowingCount,
  addToWatchlist, removeFromWatchlist, getUserWatchlist, isInWatchlist, updateWatchlistProgress,
  createNotification, getUserNotifications, markAllNotificationsRead, getUnreadNotificationCount,
  getPublicProjects, getFeaturedProjects, searchProjects, getProjectBySlug,
  getEpisodeCountForProject,
  getUserById, getProjectsByUserIdPublic,
} from "./db";
import { storagePut } from "./storage";
import { runMangaToAnimeJob } from "./pipeline";
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { notifyOwner } from "./_core/notification";
import { nanoid } from "nanoid";
import { instantVoiceClone, textToSpeech, MODELS } from "./elevenlabs";
import { runPipeline } from "./pipelineOrchestrator";
import {
  createPipelineRun, getPipelineRunById, getPipelineRunsByEpisode,
  getPipelineRunsByProject, updatePipelineRun,
  getPipelineAssetsByRun, getPipelineAssetsByEpisode,
  updateCharacterVoice, getCharactersWithVoice,
} from "./db";
import { billingRouter, usageRouter, marketplaceRouter, adminRouter, reportRouter } from "./routers-phase6";
import { quickCreateRouter } from "./routers-create";
import { smartCreateRouter } from "./routers-smartcreate";
import {
  tierRouter, animePreviewRouter, exportRouter, premiumRouter,
} from "./routers-freemium";
import {
  qualityRouter, upscaleRouter, sceneRouter, sfxRouter,
  narratorRouter, videoPromptRouter, moderationRouter, costRouter,
} from "./routers-pipeline";
import {
  chapterEditorRouter, sneakPeekRouter, downloadsRouter, sharingRouter,
} from "./routers-phase13";
import {
  preProductionRouter, characterGalleryRouter, voiceCastingRouter,
  animationStyleRouter, environmentsRouter, productionConfigRouter, reviewRouter,
} from "./routers-preproduction";
import {
  musicConceptRouter, musicGenerationRouter, musicOstRouter, musicTrackRouter,
} from "./routers-music";
import {
  performanceGuideRouter, singingVoiceRouter, vocalRecordingRouter, voiceConversionRouter,
} from "./routers-vocalrecording";
import { subjectLibraryRouter } from "./routers-subjects";
import { harnessRouter, productionBibleRouter } from "./routers-harness";
import { modelRoutingRouter } from "./routers-model-routing";
import { transitionsRouter } from "./routers-transitions";
import { publicContentRouter, publishRouter, creatorAnalyticsRouter } from "./routers-public-content";
import { uploadRouter } from "./routers-upload";
import { providerAdminRouter } from "./routers-provider-admin";
import { localInfraRouter } from "./routers-local-infra";
import { sceneTypeRouter } from "./routers-scene-type";
import { characterLibraryRouter } from "./routers-character-library";
import { lineartPipelineRouter } from "./routers-lineart-pipeline";
import { lipSyncRouter } from "./routers-lipsync";
import { motionLoraRouter } from "./routers-motion-lora";
import { imageRouterTrpc } from "./routers-image-router";
import { abTestingRouter } from "./routers-ab-testing";
import { characterBibleRouter } from "./routers-character-bible";
import { sliceRouter } from "./routers-slices";
import { coreSceneRouter } from "./routers-core-scene";
import { sliceVideoRouter } from "./routers-slice-video";
import { assemblyRouter } from "./routers-assembly";
import { animePublishRouter } from "./routers-anime-publish";
import { batchAssemblyRouter } from "./routers-batch-assembly";
import { episodeAnalyticsRouter } from "./routers-episode-analytics";
import { captionsRouter } from "./routers-captions";
import { engagementRouter } from "./routers-engagement";
import { backgroundsRouter } from "./routers-backgrounds";
import { inpaintingRouter } from "./routers-inpainting";
import { voiceCacheRouter } from "./routers-voice-cache";
import { costOptimizerRouter } from "./routers-cost-optimizer";
import { marketplaceRouter as loraMarketplaceRouter } from "./routers-marketplace";
import { parallelSliceRouter } from "./routers-parallel-slice";
import { foundersRouter } from "./routers-founders";
import { clipQualityRouter } from "./routers-quality";
import { craftLibraryRouter } from "./routers-craft-library";
import { styleBundlesRouter } from "./routers-style-bundles";
import { characterDesignerRouter } from "./routers-character-designer";
import { colorDirectorRouter } from "./routers-color-director";
import { layoutDirectorRouter, gengaDirectorRouter, sakugaKantokuRouter } from "./routers-layout-genga-sakuga";
import { tierSamplerRouter } from "./routers-tier-sampler";
import { ingestionRouter } from "./routers-ingestion";
import { printRouter, adminPrintRouter } from "./routers-print";
import {
  gateReviewRouter, pipelineStageRouter, batchReviewRouter,
  gateConfigRouter, qualityAnalyticsRouter, cascadeRewindRouter,
} from "./routers-hitl";
import { authorizeAndHold, commitTicket, releaseTicket, canAfford, canAffordBatch, getCreditCost, getAllCreditCosts, type GenerationAction } from "./credit-gateway";
import { routerLog } from "./observability/logger";
import { submitJob, getQueueStatus, cancelUserJobs, getQueueMetrics } from "./generation-queue";

// ─── Panel Prompt Builder ────────────────────────────────────────────────

const STYLE_PROMPTS: Record<string, string> = {
  shonen: "shonen anime style, dynamic action, bold lines, vibrant colors",
  seinen: "seinen anime style, mature tones, detailed shading, realistic proportions",
  shoujo: "shoujo anime style, soft colors, sparkle effects, elegant character design",
  chibi: "chibi anime style, super deformed, cute proportions, exaggerated expressions",
  cyberpunk: "cyberpunk anime style, neon lighting, futuristic tech, dark atmosphere",
  watercolor: "watercolor anime style, soft washes, painterly textures, dreamy atmosphere",
  noir: "noir anime style, high contrast, dramatic shadows, monochrome with accent colors",
  realistic: "realistic anime style, detailed anatomy, photorealistic lighting, cinematic",
  mecha: "mecha anime style, detailed mechanical design, dynamic poses, metallic shading",
  default: "anime style, clean linework, vibrant colors, professional manga art",
};

const NEGATIVE_PROMPT = "blurry, low quality, deformed, text, watermark, extra fingers, bad anatomy, cropped, ugly, duplicate, morbid, mutilated, poorly drawn face, mutation, extra limbs";

function buildFluxPrompt(
  panel: { visualDescription?: string | null; cameraAngle?: string | null; sfx?: string | null },
  project: { animeStyle: string; tone?: string | null },
  episode: { scriptContent?: any },
  characters: { name: string; visualTraits: any; loraModelUrl?: string | null; loraTriggerWord?: string | null }[],
): { prompt: string; negativePrompt: string } {
  const styleDesc = STYLE_PROMPTS[project.animeStyle] || STYLE_PROMPTS.default;
  const cameraMap: Record<string, string> = {
    "wide": "wide angle shot, establishing shot",
    "medium": "medium shot, waist-up framing",
    "close-up": "close-up shot, face detail",
    "extreme-close-up": "extreme close-up, eye detail",
    "birds-eye": "bird's eye view, top-down perspective",
  };
  const cameraDesc = cameraMap[panel.cameraAngle || "medium"] || "medium shot";

  // Build character descriptions
  const charDescs = characters.map(c => {
    const vt = c.visualTraits as any;
    const traits = [
      vt?.hairColor && `${vt.hairColor} hair`,
      vt?.eyeColor && `${vt.eyeColor} eyes`,
      vt?.clothing && `wearing ${vt.clothing}`,
    ].filter(Boolean).join(", ");
    return `${c.name}(${traits || "anime character"})`;
  }).join(", ");

  const prompt = [
    styleDesc,
    `${cameraDesc}`,
    panel.visualDescription || "anime scene",
    charDescs && `featuring ${charDescs}`,
    project.tone && `${project.tone} atmosphere`,
    "high quality, detailed, professional manga art",
  ].filter(Boolean).join(", ");

  return { prompt, negativePrompt: NEGATIVE_PROMPT };
}

// ─── Panel Generation Pipeline (async) ───────────────────────────────────

async function generatePanelsForEpisode(
  episodeId: number,
  projectId: number,
  userId: number,
) {
  const { registerGenJob, notifyPanelComplete } = await import("./panelGenService");
  const episode = await getEpisodeById(episodeId);
  if (!episode || !episode.scriptContent) return;

  const project = await getProjectById(projectId, userId);
  if (!project) return;

  const chars = await getCharactersByProject(projectId);
  const script = episode.scriptContent as {
    scenes: { scene_number: number; location: string; time_of_day: string; mood: string; panels: any[] }[];
  };

  const allPanels = await getPanelsByEpisode(episodeId);
  const CONCURRENCY = 4;

  // Register SSE job so connected clients receive real-time updates
  registerGenJob(projectId, episodeId, userId, allPanels.length);

  // Process panels in batches of CONCURRENCY
  for (let i = 0; i < allPanels.length; i += CONCURRENCY) {
    const batch = allPanels.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (panel) => {
      try {
        // Mark as generating
        await updatePanel(panel.id, { status: "generating" });

        // Build prompt
        const { prompt, negativePrompt } = buildFluxPrompt(panel, project, episode, chars);

        // Determine dimensions based on camera angle
        // Wide panels: landscape, Close-up/extreme: portrait
        const isWide = panel.cameraAngle === "wide" || panel.cameraAngle === "birds-eye";

        // Save the prompt to the panel record
        await updatePanel(panel.id, { fluxPrompt: prompt, negativePrompt });

        // Generate image
        const { url } = await generateImage({ prompt });

        // Update panel with generated image
        await updatePanel(panel.id, {
          imageUrl: url,
          status: "generated",
          reviewStatus: "pending",
        });

        // Broadcast to SSE clients
        notifyPanelComplete(projectId, episodeId, panel.id, panel.panelNumber, url ?? "", "generated");
      } catch (error) {
        routerLog.error(`[PanelGen] Panel ${panel.id} failed:`, { error: String(error) });
        // Retry up to 3 times with backoff
        let retrySuccess = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await new Promise(r => setTimeout(r, attempt * 2000)); // exponential backoff
            const { prompt } = buildFluxPrompt(panel, project, episode, chars);
            const { url } = await generateImage({ prompt });
            await updatePanel(panel.id, {
              imageUrl: url,
              status: "generated",
              reviewStatus: "pending",
              fluxPrompt: prompt,
            });
            // Broadcast to SSE clients on retry success
            notifyPanelComplete(projectId, episodeId, panel.id, panel.panelNumber, url ?? "", "generated");
            retrySuccess = true;
            break;
          } catch {
            routerLog.error(`[PanelGen] Panel ${panel.id} retry ${attempt} failed`);
          }
        }
        if (!retrySuccess) {
          await updatePanel(panel.id, { status: "draft" });
        }
      }
    });

    await Promise.all(promises);
  }

  // Notify owner
  const finalCount = await getPanelsGeneratingCount(episodeId);
  await notifyOwner({
    title: `Panel Generation Complete: ${episode.title}`,
    content: `${finalCount.completed} of ${finalCount.total} panels generated for "${episode.title}".`,
  }).catch(() => {});
}

// ─── Dialogue Overlay Helper ─────────────────────────────────────────────

async function generateOverlayForPanel(panelId: number) {
  const panel = await getPanelById(panelId);
  if (!panel || !panel.imageUrl) {
    throw new Error("Panel or image not found");
  }

  const dialogue = panel.dialogue as { character: string; text: string; emotion: string }[] | null;
  const sfx = panel.sfx;

  if ((!dialogue || dialogue.length === 0) && !sfx) {
    // No overlay needed
    await updatePanel(panelId, { compositeImageUrl: panel.imageUrl });
    return panel.imageUrl;
  }

  // Build overlay prompt for the image generation service
  const overlayElements: string[] = [];
  if (dialogue && dialogue.length > 0) {
    for (const d of dialogue) {
      overlayElements.push(`Speech bubble from ${d.character}: "${d.text}" (${d.emotion})`);
    }
  }
  if (sfx) {
    overlayElements.push(`SFX text: "${sfx}" in bold manga style`);
  }

  const overlayPrompt = `Add manga-style dialogue overlays to this anime panel. ${overlayElements.join(". ")}. Use white speech bubbles with black text, manga-style font. SFX text should be bold, angled, and colorful. Keep the original art intact.`;

  try {
    const { url } = await generateImage({
      prompt: overlayPrompt,
      originalImages: [{ url: panel.imageUrl, mimeType: "image/png" }],
    });

    await updatePanel(panelId, { compositeImageUrl: url });
    return url;
  } catch (error) {
    routerLog.error(`[Overlay] Failed for panel ${panelId}:`, { error: String(error) });
    // Fallback: use raw image as composite
    await updatePanel(panelId, { compositeImageUrl: panel.imageUrl });
    return panel.imageUrl;
  }
}

// ─── LoRA Training Helper ────────────────────────────────────────────────

async function trainLoraForCharacter(characterId: number) {
  try {
    await updateCharacter(characterId, { loraStatus: "uploading", loraTrainingProgress: 10 });

    const character = await getCharacterById(characterId);
    if (!character) return;

    const refImages = (character.referenceImages as string[]) ?? [];
    if (refImages.length < 1) {
      await updateCharacter(characterId, { loraStatus: "failed", loraTrainingProgress: 0 });
      return;
    }

    // Simulate uploading phase
    await updateCharacter(characterId, { loraStatus: "training", loraTrainingProgress: 30 });

    // Generate a "trained" model by creating a high-quality reference
    // In production this would call Fal.ai LoRA training API
    const triggerWord = `${character.name.toLowerCase().replace(/\s+/g, "_")}_lora`;

    // Simulate training progress
    for (const progress of [50, 70, 85]) {
      await new Promise(r => setTimeout(r, 2000));
      await updateCharacter(characterId, { loraTrainingProgress: progress });
    }

    // Validating
    await updateCharacter(characterId, { loraStatus: "validating", loraTrainingProgress: 90 });

    // Generate a sample to validate
    const visualTraits = character.visualTraits as any;
    const traitDesc = [
      visualTraits?.hairColor && `${visualTraits.hairColor} hair`,
      visualTraits?.eyeColor && `${visualTraits.eyeColor} eyes`,
    ].filter(Boolean).join(", ");

    try {
      await generateImage({
        prompt: `${triggerWord}, ${character.name}, ${traitDesc || "anime character"}, portrait, high quality anime art`,
      });
    } catch {
      // Sample generation is optional
    }

    // Mark as ready
    await updateCharacter(characterId, {
      loraStatus: "ready",
      loraTrainingProgress: 100,
      loraTriggerWord: triggerWord,
      loraModelUrl: `lora://${characterId}/${triggerWord}`,
    });

    await notifyOwner({
      title: `LoRA Training Complete: ${character.name}`,
      content: `Character LoRA for "${character.name}" is ready. Trigger word: ${triggerWord}`,
    }).catch(() => {});

  } catch (error) {
    routerLog.error(`[LoRA] Training failed for character ${characterId}:`, { error: String(error) });
    await updateCharacter(characterId, { loraStatus: "failed", loraTrainingProgress: 0 });
  }
}

// ─── Projects Router ──────────────────────────────────────────────────────

const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getProjectsByUserId(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      return project;
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      description: z.string().max(5000).optional(),
      genre: z.string().max(100).optional(),
      animeStyle: z.enum(["shonen", "seinen", "shoujo", "chibi", "cyberpunk", "watercolor", "noir", "realistic", "mecha", "default"]).default("default"),
      visibility: z.enum(["private", "unlisted", "public"]).default("private"),
      tone: z.string().max(100).optional(),
      targetAudience: z.enum(["kids", "teen", "adult"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await createProject({
        userId: ctx.user.id,
        title: input.title,
        description: input.description,
        genre: input.genre,
        animeStyle: input.animeStyle,
        visibility: input.visibility,
        tone: input.tone,
        targetAudience: input.targetAudience,
        status: "active",
      });
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(5000).optional(),
      genre: z.string().max(100).optional(),
      animeStyle: z.enum(["shonen", "seinen", "shoujo", "chibi", "cyberpunk", "watercolor", "noir", "realistic", "mecha", "default"]).optional(),
      visibility: z.enum(["private", "unlisted", "public"]).optional(),
      status: z.enum(["draft", "active", "archived"]).optional(),
      tone: z.string().max(100).optional(),
      targetAudience: z.enum(["kids", "teen", "adult"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updateProject(id, ctx.user.id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteProject(input.id, ctx.user.id);
      return { success: true };
    }),

  // F3: List user's own projects with wizard state
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const userProjects = await getProjectsByUserId(ctx.user.id);
    return userProjects.map((p: any) => ({
      ...p,
      wizardStage: p.wizardStage ?? 0,
      projectState: p.projectState ?? "draft",
    }));
  }),

  // F3: Advance project to the next wizard stage
  advanceStage: protectedProcedure
    .input(z.object({
      id: z.number(),
      inputs: z.record(z.string(), z.unknown()).optional(),
      outputs: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { advanceStage: doAdvance } = await import("./projectService");
      return doAdvance(input.id, ctx.user.id, input.inputs, input.outputs);
    }),

  // F3: Get checkpoint history for a project
  checkpoints: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const { getCheckpointHistory } = await import("./projectService");
      return getCheckpointHistory(input.id, ctx.user.id);
    }),

  // F3: Get user's credit balance + stage cost breakdown
  creditBalance: protectedProcedure.query(async ({ ctx }) => {
    const { getUserCreditBalance, getStageCreditCost, STAGE_NAMES } = await import("./projectService");
    const { getUserSubscriptionTier } = await import("./db");
    const balance = await getUserCreditBalance(ctx.user.id);
    const tier = await getUserSubscriptionTier(ctx.user.id);

    // Monthly grant by tier
    const TIER_GRANTS: Record<string, number> = {
      free_trial: 15, creator: 100, creator_pro: 300, studio: 1000, enterprise: 5000,
    };
    const monthlyGrant = TIER_GRANTS[tier] ?? 15;

    // Per-stage costs
    const stageCosts = STAGE_NAMES.map((name: string, i: number) => ({
      stage: i,
      label: name,
      cost: getStageCreditCost(i),
    }));

    const totalProjectCost = stageCosts.reduce((sum: number, s: { cost: number }) => sum + s.cost, 0);

    return { balance, monthlyGrant, stageCosts, totalProjectCost, tier };
  }),

  // F3: Archive a project (soft-delete)
  archive: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { archiveProject } = await import("./projectService");
      await archiveProject(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ─── Uploads Router ───────────────────────────────────────────────────────

const uploadsRouter = router({
  getUploadUrl: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileName: z.string(),
      mimeType: z.string(),
      fileSizeBytes: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const ext = input.fileName.split(".").pop() ?? "jpg";
      const fileKey = `manga-uploads/${ctx.user.id}/${input.projectId}/${nanoid()}.${ext}`;

      const uploadId = await createMangaUpload({
        projectId: input.projectId,
        userId: ctx.user.id,
        fileName: input.fileName,
        fileKey,
        fileUrl: "",
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
        status: "uploaded",
      });

      return { uploadId, fileKey, uploadEndpoint: `/api/trpc/uploads.confirmUpload` };
    }),

  confirmUpload: protectedProcedure
    .input(z.object({
      uploadId: z.number(),
      fileDataBase64: z.string(),
      mimeType: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const upload = await getMangaUploadById(input.uploadId, ctx.user.id);
      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });

      const buffer = Buffer.from(input.fileDataBase64, "base64");
      const { url } = await storagePut(upload.fileKey, buffer, input.mimeType);

      const { getDb } = await import("./db");
      const db = await getDb();
      if (db) {
        const { mangaUploads } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(mangaUploads).set({ fileUrl: url }).where(eq(mangaUploads.id, input.uploadId));
      }

      return { uploadId: input.uploadId, fileUrl: url };
    }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getMangaUploadsByProject(input.projectId, ctx.user.id);
    }),

  /**
   * Extract panels from an uploaded image.
   * Runs server-side gutter detection and returns extracted panel URLs.
   * Cost: 2 credits per detected panel.
   */
  extractPanels: protectedProcedure
    .input(z.object({
      uploadId: z.number(),
      projectId: z.number(),
      pageIndex: z.number().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const upload = await getMangaUploadById(input.uploadId, ctx.user.id);
      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
      if (!upload.fileUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload has no file URL — confirm upload first" });

      // Fetch the uploaded image
      const response = await fetch(upload.fileUrl);
      if (!response.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch uploaded file" });
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      // Extract panels
      const { extractPanelsFromImage } = await import("./panelExtractor");
      const panels = await extractPanelsFromImage(
        imageBuffer,
        ctx.user.id,
        input.projectId,
        input.pageIndex
      );

      // Update upload with panel count
      const { getDb } = await import("./db");
      const db = await getDb();
      if (db) {
        const { mangaUploads } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(mangaUploads)
          .set({ pageCount: panels.length, status: "completed" })
          .where(eq(mangaUploads.id, input.uploadId));
      }

      return { panels, panelCount: panels.length };
    }),

  /**
   * Save the user's custom panel ordering for a project.
   * Persists to project metadata.
   */
  savePanelOrder: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      panelOrder: z.array(z.object({
        id: z.string(),
        index: z.number(),
        url: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const { getDb } = await import("./db");
      const db = await getDb();
      if (db) {
        const { projects } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const existingMeta = (project as any).uploadMetadata ?? {};
        await db.update(projects)
          .set({
            uploadMetadata: {
              ...existingMeta,
              panelOrder: input.panelOrder,
            },
          })
          .where(eq(projects.id, input.projectId));
      }

      return { saved: true, panelCount: input.panelOrder.length };
    }),
});

// ─── Jobs Router ──────────────────────────────────────────────────────────

const jobsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getJobsByUserId(ctx.user.id);
  }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getJobsByProject(input.projectId, ctx.user.id);
    }),

  getStatus: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await getJobById(input.id);
      if (!job || job.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      return job;
    }),

  trigger: protectedProcedure
    .input(z.object({
      uploadId: z.number(),
      projectId: z.number(),
      animeStyle: z.enum(["shonen", "seinen", "shoujo", "chibi", "cyberpunk", "watercolor", "noir", "realistic", "mecha", "default"]).default("default"),
    }))
    .mutation(async ({ ctx, input }) => {
      const upload = await getMangaUploadById(input.uploadId, ctx.user.id);
      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
      if (!upload.fileUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload has no file URL" });

      const jobId = await createProcessingJob({
        uploadId: input.uploadId,
        projectId: input.projectId,
        userId: ctx.user.id,
        status: "queued",
        progress: 0,
        inputImageUrl: upload.fileUrl,
        animeStyle: input.animeStyle,
      });

      runMangaToAnimeJob(jobId, ctx.user.id).catch((err) => {
        routerLog.error(`[Pipeline] Background job ${jobId} failed:`, { error: String(err) });
      });

      return { jobId };
    }),
});

// ─── Episodes Router ──────────────────────────────────────────────────────

const episodesRouter = router({
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      return getEpisodesByProject(input.projectId);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.id);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      return episode;
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      episodeNumber: z.number().min(1),
      title: z.string().min(1).max(255),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      const id = await createEpisode({
        projectId: input.projectId,
        episodeNumber: input.episodeNumber,
        title: input.title,
        status: "draft",
      });
      return { id };
    }),

  updateScript: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().min(1).max(255).optional(),
      synopsis: z.string().optional(),
      scriptContent: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.id);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      if (episode.status === "locked") throw new TRPCError({ code: "BAD_REQUEST", message: "Episode is locked" });

      const { id, ...data } = input;
      await updateEpisode(id, data);
      return { success: true };
    }),

  approveScript: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.id);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      await updateEpisode(input.id, { status: "locked" });
      return { success: true };
    }),

  generateScript: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      episodeNumbers: z.array(z.number().min(1)).min(1).max(10),
      styleNotes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const results: { episodeId: number; episodeNumber: number }[] = [];

      for (const epNum of input.episodeNumbers) {
        const episodeId = await createEpisode({
          projectId: input.projectId,
          episodeNumber: epNum,
          title: `Episode ${epNum}`,
          status: "generating",
        });

        results.push({ episodeId, episodeNumber: epNum });

        generateScriptForEpisode(episodeId, project, epNum, input.styleNotes).catch((err) => {
          routerLog.error(`[Script] Episode ${episodeId} generation failed:`, { error: String(err) });
          updateEpisode(episodeId, { status: "draft" }).catch(() => {});
        });
      }

      return { episodes: results };
    }),

  // NEW: Generate panels for a locked episode
  generatePanels: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.id);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      if (episode.status !== "locked" && episode.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Script must be approved/locked before generating panels" });
      }

      // Mark all draft panels as generating
      const existingPanels = await getPanelsByEpisode(input.id);
      const draftPanels = existingPanels.filter(p => p.status === "draft" || p.status === "rejected");
      if (draftPanels.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No panels to generate" });
      }

      // Check queue status before submitting
      const queueStatus = getQueueStatus(ctx.user.id);
      if (queueStatus.userRunning >= 3) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `You have ${queueStatus.userRunning} generation jobs running. Please wait for them to complete.` });
      }

      // Submit to generation queue (handles concurrency + auto-refund on failure)
      submitJob(
        ctx.user.id,
        "panel_generation",
        () => generatePanelsForEpisode(input.id, episode.projectId, ctx.user.id),
        { withCredits: false, episodeId: input.id, projectId: episode.projectId, description: `Generate ${draftPanels.length} panels` },
      ).catch((err) => {
        routerLog.error(`[PanelGen] Episode ${input.id} panel generation failed:`, { error: String(err) });
      });

      return { panelCount: draftPanels.length, message: "Panel generation started", queuePosition: queueStatus.position };
    }),

  // NEW: Get panel generation status for an episode
  panelStatus: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.id);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      return getPanelsGeneratingCount(input.id);
    }),

  // NEW: Approve all visible panels for an episode
  approveAllPanels: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.id);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      const panels = await getPanelsByEpisode(input.id);
      const generatedPanels = panels.filter(p => p.status === "generated" && p.reviewStatus === "pending");
      const ids = generatedPanels.map(p => p.id);

      await batchUpdatePanelStatus(ids, "approved", "approved");
      return { approvedCount: ids.length };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.id);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      await deleteEpisode(input.id);
      return { success: true };
    }),

  // ─── Assembly Settings ─────────────────────────────────────────────

  getAssemblySettings: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      const { mergeAssemblySettings } = await import("@shared/assemblySettings");
      return mergeAssemblySettings(episode.assemblySettings as any);
    }),

  updateAssemblySettings: protectedProcedure
    .input(z.object({
      episodeId: z.number(),
      settings: z.object({
        enableLipSync: z.boolean().optional(),
        enableFoley: z.boolean().optional(),
        enableAmbient: z.boolean().optional(),
        voiceLufs: z.number().min(-60).max(0).optional(),
        musicLufs: z.number().min(-60).max(0).optional(),
        foleyLufs: z.number().min(-60).max(0).optional(),
        ambientLufs: z.number().min(-60).max(0).optional(),
        enableVoiceValidation: z.boolean().optional(),
        voiceValidationThresholdLufs: z.number().min(-60).max(0).optional(),
        enableSidechainDucking: z.boolean().optional(),
        sidechainDuckDb: z.number().min(0).max(24).optional(),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      const { mergeAssemblySettings } = await import("@shared/assemblySettings");
      const current = mergeAssemblySettings(episode.assemblySettings as any);
      const updated = { ...current, ...input.settings };

      await updateEpisode(input.episodeId, { assemblySettings: updated } as any);
      return updated;
    }),

  // ─── Scene-level CRUD ─────────────────────────────────────────────

  getScenes: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      const { getScenes } = await import("./scriptSceneService");
      return getScenes(input.episodeId);
    }),

  updateScene: protectedProcedure
    .input(z.object({
      episodeId: z.number(),
      sceneNumber: z.number(),
      title: z.string().max(255).optional(),
      location: z.string().max(255).optional(),
      time_of_day: z.string().optional(),
      mood: z.string().max(100).optional(),
      description: z.string().max(2000).optional(),
      beat_summary: z.string().max(200).optional(),
      characters: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      if (episode.status === "locked") throw new TRPCError({ code: "BAD_REQUEST", message: "Episode is locked" });
      const { updateScene } = await import("./scriptSceneService");
      const { episodeId, sceneNumber, ...updates } = input;
      return updateScene(episodeId, sceneNumber, updates);
    }),

  approveScene: protectedProcedure
    .input(z.object({ episodeId: z.number(), sceneNumber: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      const { approveScene } = await import("./scriptSceneService");
      const allApproved = await approveScene(input.episodeId, input.sceneNumber);
      return { allApproved };
    }),

  approveAllScenes: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      const { approveAllScenes } = await import("./scriptSceneService");
      await approveAllScenes(input.episodeId);
      return { success: true };
    }),

  reorderScenes: protectedProcedure
    .input(z.object({ episodeId: z.number(), newOrder: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      if (episode.status === "locked") throw new TRPCError({ code: "BAD_REQUEST", message: "Episode is locked" });
      const { reorderScenes } = await import("./scriptSceneService");
      await reorderScenes(input.episodeId, input.newOrder);
      return { success: true };
    }),

  renameCharacter: protectedProcedure
    .input(z.object({
      episodeId: z.number(),
      oldName: z.string().min(1),
      newName: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      const { renameCharacter } = await import("./scriptSceneService");
      return renameCharacter(input.episodeId, input.oldName, input.newName);
    }),

  regenerateScene: protectedProcedure
    .input(z.object({
      episodeId: z.number(),
      sceneNumber: z.number(),
      instruction: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      if (episode.status === "locked") throw new TRPCError({ code: "BAD_REQUEST", message: "Episode is locked" });
      const { regenerateScene } = await import("./scriptSceneService");
      return regenerateScene(input.episodeId, input.sceneNumber, input.instruction);
    }),
});

// Script generation helper (runs asynchronously)
async function generateScriptForEpisode(
  episodeId: number,
  project: { title: string; description?: string | null; genre?: string | null; animeStyle: string; tone?: string | null },
  episodeNumber: number,
  styleNotes?: string | null,
) {
  try {
    const systemPrompt = `You are a manga/anime screenwriter. You create detailed episode scripts for manga and anime stories.
Output ONLY valid JSON matching the required schema. No markdown, no explanation.

Project: "${project.title}"
Genre: ${project.genre || "general"}
Art Style: ${project.animeStyle}
Tone: ${project.tone || "balanced"}
${project.description ? `Premise: ${project.description}` : ""}
${styleNotes ? `Style Notes: ${styleNotes}` : ""}`;

    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate a complete script for Episode ${episodeNumber}. Return a JSON object with this exact structure:
{
  "episode_title": "string",
  "synopsis": "string (100-300 words)",
  "scenes": [{
    "scene_number": 1,
    "location": "string",
    "time_of_day": "day"|"night"|"dawn"|"dusk",
    "mood": "string",
    "description": "string",
    "panels": [{
      "panel_number": 1,
      "visual_description": "string (detailed, FLUX-ready prompt)",
      "camera_angle": "wide"|"medium"|"close-up"|"extreme-close-up"|"birds-eye",
      "dialogue": [{"character": "string", "text": "string", "emotion": "string"}],
      "sfx": "string or null",
      "transition": "cut"|"fade"|"dissolve"|null
    }]
  }]
}

Generate 3-5 scenes with 2-4 panels each. Make visual descriptions detailed enough for AI image generation.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "episode_script",
          strict: true,
          schema: {
            type: "object",
            properties: {
              episode_title: { type: "string" },
              synopsis: { type: "string" },
              scenes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scene_number: { type: "integer" },
                    location: { type: "string" },
                    time_of_day: { type: "string", enum: ["day", "night", "dawn", "dusk"] },
                    mood: { type: "string" },
                    description: { type: "string" },
                    panels: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          panel_number: { type: "integer" },
                          visual_description: { type: "string" },
                          camera_angle: { type: "string", enum: ["wide", "medium", "close-up", "extreme-close-up", "birds-eye"] },
                          dialogue: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                character: { type: "string" },
                                text: { type: "string" },
                                emotion: { type: "string" },
                              },
                              required: ["character", "text", "emotion"],
                              additionalProperties: false,
                            },
                          },
                          sfx: { type: ["string", "null"] },
                          transition: { type: ["string", "null"], enum: ["cut", "fade", "dissolve", null] },
                        },
                        required: ["panel_number", "visual_description", "camera_angle", "dialogue", "sfx", "transition"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["scene_number", "location", "time_of_day", "mood", "description", "panels"],
                  additionalProperties: false,
                },
              },
            },
            required: ["episode_title", "synopsis", "scenes"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("No content in LLM response");
    }

    const script = JSON.parse(content);

    let wordCount = 0;
    let panelCount = 0;
    const panelRecords: any[] = [];

    for (const scene of script.scenes) {
      wordCount += scene.description.split(/\s+/).length;
      for (const panel of scene.panels) {
        panelCount++;
        wordCount += panel.visual_description.split(/\s+/).length;
        for (const d of panel.dialogue) {
          wordCount += d.text.split(/\s+/).length;
        }
        panelRecords.push({
          episodeId,
          projectId: 0,
          sceneNumber: scene.scene_number,
          panelNumber: panel.panel_number,
          visualDescription: panel.visual_description,
          cameraAngle: panel.camera_angle,
          dialogue: panel.dialogue,
          sfx: panel.sfx,
          transition: panel.transition,
          status: "draft",
        });
      }
    }

    const episode = await getEpisodeById(episodeId);
    if (episode) {
      for (const pr of panelRecords) {
        pr.projectId = episode.projectId;
      }
    }

    await updateEpisode(episodeId, {
      title: script.episode_title,
      synopsis: script.synopsis,
      scriptContent: script,
      status: "generated",
      wordCount,
      panelCount,
    });

    if (panelRecords.length > 0) {
      await createPanelsBulk(panelRecords);
    }

    await notifyOwner({
      title: `Script Generated: Episode ${episodeNumber}`,
      content: `Script for "${script.episode_title}" has been generated with ${panelCount} panels across ${script.scenes.length} scenes.`,
    }).catch(() => {});

  } catch (error) {
    routerLog.error(`[Script] Failed to generate script for episode ${episodeId}:`, { error: String(error) });
    await updateEpisode(episodeId, { status: "draft" }).catch(() => {});
    throw error;
  }
}

// ─── Panels Router ────────────────────────────────────────────────────────

const panelsRouter = router({
  listByEpisode: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      return getPanelsByEpisode(input.episodeId);
    }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      return getPanelsByProject(input.projectId);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const panel = await getPanelById(input.id);
      if (!panel) throw new TRPCError({ code: "NOT_FOUND", message: "Panel not found" });
      const project = await getProjectById(panel.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      return panel;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      visualDescription: z.string().optional(),
      cameraAngle: z.enum(["wide", "medium", "close-up", "extreme-close-up", "birds-eye"]).optional(),
      dialogue: z.any().optional(),
      sfx: z.string().nullable().optional(),
      transition: z.enum(["cut", "fade", "dissolve", "cross-dissolve"]).nullable().optional(),
      transitionDuration: z.number().min(0.2).max(2.0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const panel = await getPanelById(input.id);
      if (!panel) throw new TRPCError({ code: "NOT_FOUND", message: "Panel not found" });
      const project = await getProjectById(panel.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      const { id, ...data } = input;
      await updatePanel(id, data);
      return { success: true };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const panel = await getPanelById(input.id);
      if (!panel) throw new TRPCError({ code: "NOT_FOUND", message: "Panel not found" });
      const project = await getProjectById(panel.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      await updatePanel(input.id, { status: "approved", reviewStatus: "approved" });
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const panel = await getPanelById(input.id);
      if (!panel) throw new TRPCError({ code: "NOT_FOUND", message: "Panel not found" });
      const project = await getProjectById(panel.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });
      await updatePanel(input.id, { status: "rejected", reviewStatus: "rejected" });
      return { success: true };
    }),

  regenerate: protectedProcedure
    .input(z.object({
      id: z.number(),
      newPrompt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const panel = await getPanelById(input.id);
      if (!panel) throw new TRPCError({ code: "NOT_FOUND", message: "Panel not found" });
      const project = await getProjectById(panel.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      // Update prompt if provided
      if (input.newPrompt) {
        await updatePanel(input.id, { fluxPrompt: input.newPrompt });
      }

      // Mark as generating and regenerate
      await updatePanel(input.id, { status: "generating", reviewStatus: "pending" });

      // Submit to generation queue with auto-refund on failure
      submitJob(
        ctx.user.id,
        "panel_generation",
        async () => {
          const { notifyPanelComplete } = await import("./panelGenService");
          const promptToUse = input.newPrompt || panel.fluxPrompt || panel.visualDescription || "anime panel";
          const { url } = await generateImage({ prompt: promptToUse });
          await updatePanel(input.id, { imageUrl: url, status: "generated", reviewStatus: "pending" });
          notifyPanelComplete(
            panel.projectId,
            panel.episodeId,
            input.id,
            panel.panelNumber,
            url ?? "",
            "generated",
          );
          return url;
        },
        { withCredits: false, episodeId: panel.episodeId, projectId: panel.projectId, description: `Regenerate panel ${input.id}` },
      ).catch(async (error) => {
        routerLog.error(`[PanelRegen] Panel ${input.id} failed:`, { error: String(error) });
        await updatePanel(input.id, { status: "draft" });
      });

      return { success: true, message: "Regeneration started" };
    }),

  regenerateFailed: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const project = await getProjectById(episode.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      const panels = await getPanelsByEpisode(input.episodeId);
      const failedPanels = panels.filter(p => p.status === "rejected" || p.status === "draft");

      if (failedPanels.length === 0) {
        return { count: 0, message: "No failed panels to regenerate" };
      }

      // Mark all failed as generating
      await batchUpdatePanelStatus(failedPanels.map(p => p.id), "generating", "pending");

      // Fire-and-forget regeneration
      generatePanelsForEpisode(input.episodeId, episode.projectId, ctx.user.id).catch((err) => routerLog.error("Panel regeneration failed", { error: String(err) }));

      return { count: failedPanels.length, message: "Regeneration started" };
    }),

  applyOverlay: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const panel = await getPanelById(input.id);
      if (!panel) throw new TRPCError({ code: "NOT_FOUND", message: "Panel not found" });
      const project = await getProjectById(panel.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "FORBIDDEN", message: "Not your project" });

      if (!panel.imageUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Panel has no generated image" });
      }

      const compositeUrl = await generateOverlayForPanel(input.id);
      return { compositeUrl };
    }),

  aiRewrite: protectedProcedure
    .input(z.object({
      panelId: z.number(),
      field: z.enum(["visualDescription", "dialogue"]),
      currentText: z.string(),
      instruction: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const prompt = input.field === "visualDescription"
        ? `Rewrite this visual description for an anime panel to be more vivid and detailed for AI image generation. Keep it concise but evocative.\n\nOriginal: ${input.currentText}${input.instruction ? `\n\nAdditional instruction: ${input.instruction}` : ""}\n\nReturn ONLY the rewritten text, no quotes or explanation.`
        : `Rewrite this dialogue to be more natural and expressive for an anime scene.\n\nOriginal: ${input.currentText}${input.instruction ? `\n\nAdditional instruction: ${input.instruction}` : ""}\n\nReturn ONLY the rewritten text, no quotes or explanation.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a skilled anime screenwriter. Rewrite the given text to be more vivid and expressive." },
          { role: "user", content: prompt },
        ],
      });

      const rewritten = response.choices[0]?.message?.content;
      if (!rewritten || typeof rewritten !== "string") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI rewrite failed" });
      }

      return { rewritten: rewritten.trim() };
    }),

  // ─── Queue Management ─────────────────────────────────────────────────
  queueStatus: protectedProcedure
    .query(async ({ ctx }) => {
      return getQueueStatus(ctx.user.id);
    }),

  cancelQueue: protectedProcedure
    .mutation(async ({ ctx }) => {
      return cancelUserJobs(ctx.user.id);
    }),
});
// ─── Characters Router ─────────────────────────────────────────────────────

const charactersRouter = router({
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      return getCharactersByProject(input.projectId);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const character = await getCharacterById(input.id);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      if (character.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      return character;
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1).max(255),
      role: z.enum(["protagonist", "antagonist", "supporting", "background"]).default("supporting"),
      personalityTraits: z.array(z.string()).optional(),
      visualTraits: z.object({
        hairColor: z.string().optional(),
        eyeColor: z.string().optional(),
        bodyType: z.string().optional(),
        clothing: z.string().optional(),
        distinguishingFeatures: z.string().optional(),
      }).optional(),
      bio: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const id = await createCharacter({
        projectId: input.projectId,
        userId: ctx.user.id,
        name: input.name,
        role: input.role,
        personalityTraits: input.personalityTraits ?? [],
        visualTraits: input.visualTraits ?? {},
        bio: input.bio,
      });
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      role: z.enum(["protagonist", "antagonist", "supporting", "background"]).optional(),
      personalityTraits: z.array(z.string()).optional(),
      visualTraits: z.object({
        hairColor: z.string().optional(),
        eyeColor: z.string().optional(),
        bodyType: z.string().optional(),
        clothing: z.string().optional(),
        distinguishingFeatures: z.string().optional(),
      }).optional(),
      bio: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const character = await getCharacterById(input.id);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      if (character.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

      const { id, ...data } = input;
      await updateCharacter(id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const character = await getCharacterById(input.id);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      if (character.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await deleteCharacter(input.id);
      return { success: true };
    }),

  generateReference: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      artStyle: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const character = await getCharacterById(input.characterId);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      if (character.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

      const project = await getProjectById(character.projectId, ctx.user.id);
      const artStyle = input.artStyle || project?.animeStyle || "anime";

      const visualTraits = character.visualTraits as {
        hairColor?: string; eyeColor?: string; bodyType?: string;
        clothing?: string; distinguishingFeatures?: string;
      } | null;

      const traitDesc = [
        visualTraits?.hairColor && `${visualTraits.hairColor} hair`,
        visualTraits?.eyeColor && `${visualTraits.eyeColor} eyes`,
        visualTraits?.bodyType && `${visualTraits.bodyType} build`,
        visualTraits?.clothing && `wearing ${visualTraits.clothing}`,
        visualTraits?.distinguishingFeatures,
      ].filter(Boolean).join(", ");

      const prompt = `Character reference sheet for "${character.name}", ${artStyle} art style. ${character.role} character. ${traitDesc || "anime character"}. Professional character design sheet showing front view, side view, and back view. Clean white background, full body, detailed linework, consistent proportions, anime/manga style.`;

      try {
        const { url } = await generateImage({ prompt });

        const existingImages = (character.referenceImages as string[]) ?? [];
        const updatedImages = [...existingImages, url].filter(Boolean);
        await updateCharacter(character.id, { referenceImages: updatedImages });

        return { url, images: updatedImages };
      } catch (error) {
        routerLog.error("[Characters] Reference sheet generation failed:", { error: String(error) });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate reference sheet. Please try again.",
        });
      }
    }),

  // NEW: Train LoRA for a character
  trainLora: protectedProcedure
    .input(z.object({ characterId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const character = await getCharacterById(input.characterId);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      if (character.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

      const refImages = (character.referenceImages as string[]) ?? [];
      if (refImages.length < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "At least 1 reference image is required for LoRA training" });
      }

      if (character.loraStatus === "training" || character.loraStatus === "uploading" || character.loraStatus === "validating") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "LoRA training is already in progress" });
      }

      // Fire-and-forget training
      trainLoraForCharacter(input.characterId).catch((err) => routerLog.error("LoRA training failed", { error: String(err) }));

      return { message: "LoRA training started" };
    }),

  // NEW: Get LoRA training status
  loraStatus: protectedProcedure
    .input(z.object({ characterId: z.number() }))
    .query(async ({ ctx, input }) => {
      const character = await getCharacterById(input.characterId);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      if (character.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

      return {
        status: character.loraStatus,
        progress: character.loraTrainingProgress ?? 0,
        modelUrl: character.loraModelUrl,
        triggerWord: character.loraTriggerWord,
      };
    }),
});

// ─── AI Helper Router ─────────────────────────────────────────────────────

const aiRouter = router({
  enhanceDescription: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000),
      context: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "You are a creative writing assistant specializing in anime/manga storytelling. Expand short ideas into rich, vivid premises suitable for a manga series. Keep the enhanced version between 200-500 words. Maintain the original tone and intent while adding depth, world-building details, and narrative hooks.",
          },
          {
            role: "user",
            content: `Enhance this story premise:\n\n"${input.text}"${input.context ? `\n\nContext: ${input.context}` : ""}\n\nReturn ONLY the enhanced premise text, no quotes or explanation.`,
          },
        ],
      });

      const enhanced = response.choices[0]?.message?.content;
      if (!enhanced || typeof enhanced !== "string") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI enhancement failed" });
      }

      return { enhanced: enhanced.trim() };
    }),
});

// ─── Discover Router (public) ────────────────────────────────────────────

const discoverRouter = router({
  featured: publicProcedure.query(async () => {
    return getFeaturedProjects();
  }),

  trending: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20), offset: z.number().default(0) }).optional())
    .query(async ({ input }) => {
      return getPublicProjects({ limit: input?.limit ?? 20, offset: input?.offset ?? 0, sort: "trending" });
    }),

  newReleases: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20), offset: z.number().default(0) }).optional())
    .query(async ({ input }) => {
      return getPublicProjects({ limit: input?.limit ?? 20, offset: input?.offset ?? 0, sort: "newest" });
    }),

  topRated: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20), offset: z.number().default(0) }).optional())
    .query(async ({ input }) => {
      return getPublicProjects({ limit: input?.limit ?? 20, offset: input?.offset ?? 0, sort: "top_rated" });
    }),

  byGenre: publicProcedure
    .input(z.object({ genre: z.string().optional(), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      return getPublicProjects({ limit: input.limit, offset: input.offset, genre: input.genre, sort: "trending" });
    }),

  getDemoVideo: publicProcedure.query(async () => {
    const { getPlatformConfig } = await import("./db");
    const { DEMO_CONFIG_KEYS } = await import("../shared/demo-scenario");
    const streamId = await getPlatformConfig(DEMO_CONFIG_KEYS.STREAM_ID);
    const posterUrl = await getPlatformConfig(DEMO_CONFIG_KEYS.POSTER_URL);
    const embedUrl = await getPlatformConfig("demo_video_embed_url");
    const status = await getPlatformConfig(DEMO_CONFIG_KEYS.STATUS);
    return {
      streamId: streamId || null,
      posterUrl: posterUrl || null,
      embedUrl: embedUrl || null,
      status: status || "not_started",
    };
  }),
});

// ─── Search Router (public) ──────────────────────────────────────────────

const searchRouter = router({
  projects: publicProcedure
    .input(z.object({ query: z.string().min(1).max(200), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return searchProjects(input.query, input.limit);
    }),
});


// ─── Comments Router ─────────────────────────────────────────────────────

const commentsRouter = router({
  list: publicProcedure
    .input(z.object({
      episodeId: z.number(),
      sort: z.enum(["newest", "top", "oldest"]).default("newest"),
    }))
    .query(async ({ input }) => {
      return getCommentsByEpisode(input.episodeId, input.sort);
    }),

  create: protectedProcedure
    .input(z.object({
      episodeId: z.number(),
      content: z.string().min(1).max(5000),
      parentId: z.number().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Enforce max reply depth of 3 levels on the server
      if (input.parentId) {
        const { getDb: getDbLocal } = await import("./db");
        const depthDb = await getDbLocal();
        if (depthDb) {
          const { comments: cTable } = await import("../drizzle/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          let depth = 0;
          let currentId: number | null = input.parentId;
          while (currentId && depth < 4) {
            const rows: Array<{ parentId: number | null }> = await depthDb.select({ parentId: cTable.parentId }).from(cTable).where(eqOp(cTable.id, currentId)).limit(1);
            if (!rows[0]) break;
            currentId = rows[0].parentId;
            depth++;
          }
          if (depth >= 3) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum reply depth of 3 levels reached" });
          }
        }
      }
      const id = await createComment({
        episodeId: input.episodeId,
        userId: ctx.user.id,
        content: input.content,
        parentId: input.parentId ?? null,
      });
      // Notify parent comment author if replying
      if (input.parentId) {
        try {
          const { getDb } = await import("./db");
          const db = await getDb();
          if (db) {
            const { comments: commentsTable } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const parent = await db.select().from(commentsTable).where(eq(commentsTable.id, input.parentId)).limit(1);
            if (parent[0] && parent[0].userId !== ctx.user.id) {
              await createNotification({
                userId: parent[0].userId,
                type: "reply",
                title: "New reply to your comment",
                content: input.content.substring(0, 200),
                linkUrl: `/watch/episode/${input.episodeId}`,
              });
            }
          }
        } catch { /* notification is best-effort */ }
      }
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteComment(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ─── Follows Router ──────────────────────────────────────────────────────

const followsRouter = router({
  toggle: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.id === input.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot follow yourself" });
      }
      const result = await toggleFollow(ctx.user.id, input.userId);
      if (result.following) {
        await createNotification({
          userId: input.userId,
          type: "new_follower",
          title: `${ctx.user.name || "Someone"} started following you`,
          content: null,
          linkUrl: `/profile/${ctx.user.id}`,
        }).catch(() => {});
      }
      return result;
    }),

  status: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx, input }) => {
      const isFollowing = ctx.user ? await getFollowStatus(ctx.user.id, input.userId) : false;
      const followers = await getFollowerCount(input.userId);
      const following = await getFollowingCount(input.userId);
      return { isFollowing, followers, following };
    }),
});

// ─── Watchlist Router ────────────────────────────────────────────────────

const watchlistRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getUserWatchlist(ctx.user.id);
  }),

  add: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const id = await addToWatchlist(ctx.user.id, input.projectId);
      return { id };
    }),

  remove: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await removeFromWatchlist(ctx.user.id, input.projectId);
      return { success: true };
    }),

  isAdded: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return { inWatchlist: await isInWatchlist(ctx.user.id, input.projectId) };
    }),

  updateProgress: protectedProcedure
    .input(z.object({ projectId: z.number(), lastEpisodeId: z.number(), progress: z.number().min(0).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await updateWatchlistProgress(ctx.user.id, input.projectId, input.lastEpisodeId, input.progress);
      return { success: true };
    }),
});

// ─── Notifications Router ────────────────────────────────────────────────────

const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ ctx, input }) => {
      return getUserNotifications(ctx.user.id, input?.limit ?? 50);
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return { count: await getUnreadNotificationCount(ctx.user.id) };
  }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllNotificationsRead(ctx.user.id);
    return { success: true };
  }),
});

// ─── User Profile Router (public) ───────────────────────────────────────

const userProfileRouter = router({
  get: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const user = await getUserById(input.userId);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const projectsList = await getProjectsByUserIdPublic(input.userId);
      const followers = await getFollowerCount(input.userId);
      const following = await getFollowingCount(input.userId);
      return {
        id: user.id,
        name: user.name,
        createdAt: user.createdAt,
        projects: projectsList,
        followers,
        following,
      };
    }),
});

// ─── Watch Router (public project/episode viewing) ──────────────────────

const watchRouter = router({
  project: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const project = await getProjectBySlug(input.slug);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      const episodesList = await getEpisodesByProject(project.id);
      const episodeCount = episodesList.length;
      return { ...project, episodes: episodesList, episodeCount };
    }),

  episode: publicProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const panelsList = await getPanelsByEpisode(input.episodeId);
      return { ...episode, panels: panelsList };
    }),

  storyboard: publicProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => {
      const episode = await getEpisodeById(input.episodeId);
      if (!episode) throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      const panelsList = await getPanelsByEpisode(input.episodeId);
      // Return panels with composite images preferred
      const storyboardPanels = panelsList.map(p => ({
        id: p.id,
        sceneNumber: p.sceneNumber,
        panelNumber: p.panelNumber,
        imageUrl: (p.compositeImageUrl || p.imageUrl) as string | null,
        rawImageUrl: p.imageUrl,
        visualDescription: p.visualDescription,
        cameraAngle: p.cameraAngle,
        dialogue: p.dialogue,
        sfx: p.sfx,
        transition: p.transition,
      }));
      return { episode, panels: storyboardPanels };
    }),
});

// ─── Pipeline Router ─────────────────────────────────────────────────────

const pipelineRouter = router({
  start: protectedProcedure
    .input(z.object({ episodeId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      const episode = await getEpisodeById(input.episodeId);
      if (!episode || episode.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Episode not found" });
      }
      if (episode.status !== "locked" && episode.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Episode must be locked/approved to start pipeline" });
      }

      const runId = await createPipelineRun({
        episodeId: input.episodeId,
        projectId: input.projectId,
        userId: ctx.user.id,
        status: "pending",
        currentNode: "none",
        progress: 0,
        totalCost: 0,
      });

      // Start pipeline in background
      runPipeline(runId).catch(err => {
        routerLog.error(`[Pipeline] Run ${runId} failed:`, { error: String(err) });
      });

      return { runId };
    }),

  getStatus: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ ctx, input }) => {
      const run = await getPipelineRunById(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });
      return run;
    }),

  listByEpisode: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getPipelineRunsByEpisode(input.episodeId);
    }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getPipelineRunsByProject(input.projectId);
    }),

  getAssets: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getPipelineAssetsByRun(input.runId);
    }),

  getAssetsByEpisode: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getPipelineAssetsByEpisode(input.episodeId);
    }),

  retry: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getPipelineRunById(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });
      if (run.status !== "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "Can only retry failed runs" });

      // Create a new run for the same episode
      const newRunId = await createPipelineRun({
        episodeId: run.episodeId,
        projectId: run.projectId,
        userId: ctx.user.id,
        status: "pending",
        currentNode: "none",
        progress: 0,
        totalCost: 0,
      });

      runPipeline(newRunId).catch(err => {
        routerLog.error(`[Pipeline] Retry run ${newRunId} failed:`, { error: String(err) });
      });

      return { runId: newRunId };
    }),

  cancel: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getPipelineRunById(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });
      if (run.status !== "running" && run.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only cancel running/pending runs" });
      }
      await updatePipelineRun(input.runId, { status: "cancelled", completedAt: new Date() });
      return { success: true };
    }),

  // QA Review
  approve: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getPipelineRunById(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });
      if (run.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "Can only approve completed runs" });

      // Mark episode as published
      await updateEpisode(run.episodeId, {
        status: "published",
        publishedAt: new Date(),
      } as any);

      await notifyOwner({
        title: "Episode Published",
        content: `Episode from pipeline run #${input.runId} has been approved and published.`,
      }).catch(() => {});

      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({
      runId: z.number(),
      issues: z.array(z.object({
        type: z.enum(["visual", "audio", "sync", "quality", "other"]),
        description: z.string(),
        node: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const run = await getPipelineRunById(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });

      await updatePipelineRun(input.runId, {
        qaIssues: input.issues as any,
      });

      // Revert episode to locked for re-processing
      await updateEpisode(run.episodeId, { status: "locked" } as any);

      return { success: true };
    }),

  publish: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getPipelineRunById(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });

      await updateEpisode(run.episodeId, {
        status: "published",
        publishedAt: new Date(),
      } as any);

      // Make project public if not already
      await updateProject(run.projectId, ctx.user.id, { visibility: "public" });

      return { success: true };
    }),

  getCostSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const runs = await getPipelineRunsByProject(input.projectId);
      const totalCost = runs.reduce((sum, r) => sum + (r.totalCost ?? 0), 0);
      const completedRuns = runs.filter(r => r.status === "completed").length;
      const failedRuns = runs.filter(r => r.status === "failed").length;
      return { totalCost, completedRuns, failedRuns, totalRuns: runs.length };
    }),
});

// ─── Voice Router ────────────────────────────────────────────────────────

const voiceRouter = router({
  clone: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      audioUrl: z.string(),
      name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const character = await getCharacterById(input.characterId);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Clone voice using ElevenLabs instant voice cloning
      const cloneName = input.name || `${character.name || "Character"}_${input.characterId}`;
      let voiceId: string;

      try {
        const result = await instantVoiceClone({
          name: cloneName,
          description: `Voice clone for character: ${character.name}`,
          audioUrls: [input.audioUrl],
          labels: { character_id: String(input.characterId) },
        });
        voiceId = result.voice_id;
      } catch (err: any) {
        routerLog.error("[Voice] ElevenLabs clone failed:", { error: String(err.message) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Voice cloning failed: " + err.message });
      }

      await updateCharacterVoice(input.characterId, {
        voiceId,
        voiceCloneUrl: input.audioUrl,
        voiceSettings: { stability: 0.5, similarity_boost: 0.75 },
      });

      return { voiceId, success: true };
    }),

  getSettings: protectedProcedure
    .input(z.object({ characterId: z.number() }))
    .query(async ({ ctx, input }) => {
      const character = await getCharacterById(input.characterId);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      return {
        voiceId: character.voiceId,
        voiceCloneUrl: character.voiceCloneUrl,
        voiceSettings: character.voiceSettings,
      };
    }),

  updateSettings: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      stability: z.number().min(0).max(1).optional(),
      similarity_boost: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const character = await getCharacterById(input.characterId);
      if (!character) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
      const currentSettings = (character.voiceSettings as any) || {};
      const newSettings = {
        ...currentSettings,
        ...(input.stability !== undefined ? { stability: input.stability } : {}),
        ...(input.similarity_boost !== undefined ? { similarity_boost: input.similarity_boost } : {}),
      };
      await updateCharacterVoice(input.characterId, { voiceSettings: newSettings });
      return { success: true };
    }),

  test: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      text: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const character = await getCharacterById(input.characterId);
      if (!character || !character.voiceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Character has no voice clone" });
      }

      // Generate TTS using ElevenLabs with the character's cloned voice
      const audioKey = `voice-test/${input.characterId}/${nanoid(8)}.mp3`;
      const voiceSettings = (character.voiceSettings as any) || {};

      try {
        const audioBuffer = await textToSpeech({
          voiceId: character.voiceId,
          text: input.text,
          modelId: MODELS.MULTILINGUAL_V2,
          voiceSettings: {
            stability: voiceSettings.stability ?? 0.5,
            similarity_boost: voiceSettings.similarity_boost ?? 0.75,
          },
        });
        const { url } = await storagePut(audioKey, audioBuffer, "audio/mpeg");
        return { audioUrl: url };
      } catch (err: any) {
        routerLog.error("[Voice] TTS failed:", { error: String(err.message) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Voice generation failed: " + err.message });
      }
    }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getCharactersWithVoice(input.projectId);
    }),

  remove: protectedProcedure
    .input(z.object({ characterId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await updateCharacterVoice(input.characterId, {
        voiceId: null,
        voiceCloneUrl: null,
        voiceSettings: null,
      });
      return { success: true };
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────

export const appRouter = router({
  upload: uploadRouter,
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    clearSession: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { cleared: true } as const;
    }),
  }),

  projects: projectsRouter,
  uploads: uploadsRouter,
  jobs: jobsRouter,
  episodes: episodesRouter,
  panels: panelsRouter,
  characters: charactersRouter,
  ai: aiRouter,

  // Phase 4: Community & Streaming
  discover: discoverRouter,
  search: searchRouter,
  comments: commentsRouter,
  follows: followsRouter,
  watchlist: watchlistRouter,
  notifications: notificationsRouter,
  userProfile: userProfileRouter,
  watch: watchRouter,

  // Phase 5: Production Pipeline
  pipeline: pipelineRouter,
  voice: voiceRouter,

  // Phase 6: Commerce & Admin
  billing: billingRouter,
  usage: usageRouter,
  marketplace: marketplaceRouter,
  admin: adminRouter,
  report: reportRouter,

  // Quick Create (public creation flow)
  quickCreate: quickCreateRouter,

  // Enhanced Pipeline Agents
  quality: qualityRouter,
  upscale: upscaleRouter,
  scene: sceneRouter,
  sfx: sfxRouter,
  narrator: narratorRouter,
  videoPrompt: videoPromptRouter,
  moderation: moderationRouter,
  cost: costRouter,

  // Freemium Funnel
  tier: tierRouter,
  animePreview: animePreviewRouter,
  export: exportRouter,
  premium: premiumRouter,

  // Phase 13: Chapter Structure, Sneak Peek, Downloads, Sharing
  chapterEditor: chapterEditorRouter,
  sneakPeek: sneakPeekRouter,
  downloads: downloadsRouter,
  sharing: sharingRouter,

  // Phase 14: Smart Creation Flow
  smartCreate: smartCreateRouter,

  // Phase 15: Pre-Production Suite
  preProduction: preProductionRouter,
  characterGallery: characterGalleryRouter,
  voiceCasting: voiceCastingRouter,
  animationStyle: animationStyleRouter,
  environments: environmentsRouter,
  productionConfig: productionConfigRouter,
  review: reviewRouter,

  // Phase 16: Music Pipeline
  musicConcept: musicConceptRouter,
  musicGeneration: musicGenerationRouter,
  musicOst: musicOstRouter,
  musicTrack: musicTrackRouter,
  performanceGuide: performanceGuideRouter,
  singingVoice: singingVoiceRouter,
  vocalRecording: vocalRecordingRouter,
  voiceConversion: voiceConversionRouter,

  // Phase 17: Kling Subject Library (Native Lip Sync)
  subjectLibrary: subjectLibraryRouter,

  // Lip Sync Batch Retry
  lipSync: lipSyncRouter,

  // Phase 18: Harness Engineering (Quality Gates)
  harness: harnessRouter,
  productionBible: productionBibleRouter,

  // Phase 19: Smart Kling Model Router
  modelRouting: modelRoutingRouter,
  transitions: transitionsRouter,

  // Phase 20: Free-Viewing YouTube Model
  publicContent: publicContentRouter,
  publish: publishRouter,
  creatorAnalytics: creatorAnalyticsRouter,

  // Phase 7: HITL Gate Architecture (Prompt 17)
  gateReview: gateReviewRouter,
  pipelineStage: pipelineStageRouter,
  batchReview: batchReviewRouter,
  gateConfig: gateConfigRouter,
  qualityAnalytics: qualityAnalyticsRouter,
  cascadeRewind: cascadeRewindRouter,

  // Prompt 15: Credit Gateway (pre-flight affordability)
  providerAdmin: providerAdminRouter,
  localInfra: localInfraRouter,
  sceneType: sceneTypeRouter,
  characterLibrary: characterLibraryRouter,
  lineartPipeline: lineartPipelineRouter,
  tierSampler: tierSamplerRouter,

  // Prompt 25: Motion LoRA CRUD, Job Queue, Evaluation
  motionLora: motionLoraRouter,

  // Prompt 25: Multi-Surface Image Router
  imageRouter: imageRouterTrpc,

  // Prompt 29: A/B Testing
  abTesting: abTestingRouter,

  // Platform Stats (public, for Create page)
  platformStats: publicProcedure.query(async () => {
    const { getPlatformStats } = await import("./db");
    return getPlatformStats();
  }),

  // P26: Character Bible & Spatial Consistency
  characterBible: characterBibleRouter,

  // Guided Pipeline: 10-Second Slice Decomposition
  slices: sliceRouter,
  coreScene: coreSceneRouter,
  sliceVideo: sliceVideoRouter,
  assembly: assemblyRouter,
  animePublish: animePublishRouter,
  batchAssembly: batchAssemblyRouter,
  episodeAnalytics: episodeAnalyticsRouter,
  captions: captionsRouter,
  engagement: engagementRouter,
  creditGateway: router({
    // Check if user can afford an action (no hold placed)
    canAfford: protectedProcedure
      .input(z.object({
        action: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        return canAfford(ctx.user.id, input.action as GenerationAction);
      }),

    // Batch affordability check
    canAffordBatch: protectedProcedure
      .input(z.object({
        actions: z.array(z.string()),
      }))
      .query(async ({ ctx, input }) => {
        return canAffordBatch(ctx.user.id, input.actions as GenerationAction[]);
      }),

    // Get all credit costs
    getCosts: publicProcedure.query(() => {
      return getAllCreditCosts();
    }),

    // Get cost for a specific action
    getCost: publicProcedure
      .input(z.object({ action: z.string() }))
      .query(({ input }) => {
        return { action: input.action, cost: getCreditCost(input.action as GenerationAction) };
      }),
  }),

  // Background Asset Library
  backgrounds: backgroundsRouter,

  // Targeted Inpainting
  inpainting: inpaintingRouter,

  // Voice Line Caching
  voiceCache: voiceCacheRouter,

  // Script Cost Optimizer & Scene-Type Optimization
  costOptimizer: costOptimizerRouter,

  // LoRA Marketplace
  loraMarketplace: loraMarketplaceRouter,

  // Parallel Slice Scheduler
  parallelSlice: parallelSliceRouter,

  // Founders' Studio (Pipeline Blueprint v1.9 §7C)
  founders: foundersRouter,

  // D5.5 Per-Clip Quality Gate (Wave 1)
  clipQuality: clipQualityRouter,
  craftLibrary: craftLibraryRouter,

  // Wave 2 Item 1: Anime Type Style Bundles
  styleBundles: styleBundlesRouter,

  // Wave 2 Item 2: D0 Character Designer — Multi-View Reference Sheets
  characterDesigner: characterDesignerRouter,

  // Wave 2 Item 3: D6 Color Director — Color Scripts & Palette Management
  colorDirector: colorDirectorRouter,

  // Wave 2 Item 4a: D1.25 Layout Director — Panel Compositions
  layoutDirector: layoutDirectorRouter,

  // Wave 2 Item 4b: D1.5 Genga Director — Keyframe Generation
  gengaDirector: gengaDirectorRouter,

  // Wave 2 Item 4c: D2.5 Sakuga Kantoku — Consistency Review
  sakugaKantoku: sakugaKantokuRouter,

  // Wave 2 Item 5: D10 Web-Only Corpus Ingestion
  ingestion: ingestionRouter,

  // Wave 5A: Lulu Print Integration
  print: printRouter,
  adminPrint: adminPrintRouter,
});

export type AppRouter = typeof appRouter;
