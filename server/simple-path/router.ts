/**
 * Simple Path tRPC Router
 * 
 * Exposes the 5-stage pipeline via tRPC procedures for the frontend.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { runSimplePath, type SimplePathConfig } from "./orchestrator";
import { runBeatSegmentation } from "./stages/stage1-beat-segmentation";
import { buildCharacterRefs, FIRST_LIGHT_CHARACTERS } from "./stages/stage2-character-refs";
import { buildFirstLightConfig } from "./fixtures/first-light";
import { FIRST_LIGHT_VOICE_ASSIGNMENTS } from "./stages/stage4-voice-lipsync";
import { getActiveConfig, checkProviderHealth } from "./provider-router";
import { getDb } from "../db";
import { pipelineRuns } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const simplePathRouter = router({
  /**
   * Get provider health status
   */
  providerHealth: protectedProcedure.query(async () => {
    const config = getActiveConfig();
    const [videoHealth, lipSyncHealth] = await Promise.all([
      checkProviderHealth(config.video.primary),
      checkProviderHealth(config.lipSync.primary),
    ]);
    return {
      video: videoHealth,
      lipSync: lipSyncHealth,
      activeConfig: config,
    };
  }),

  /**
   * Preview beat segmentation (Stage 1 only — no cost)
   */
  previewBeats: protectedProcedure
    .input(
      z.object({
        script: z.string().min(10),
        episodeTitle: z.string(),
        characterNames: z.array(z.string()),
        targetDurationSeconds: z.number().optional(),
        genre: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await runBeatSegmentation({
        script: input.script,
        episodeTitle: input.episodeTitle,
        characterNames: input.characterNames,
        targetDurationSeconds: input.targetDurationSeconds,
        genre: input.genre,
      });
      return result;
    }),

  /**
   * Run full Simple Path pipeline
   */
  runPipeline: protectedProcedure
    .input(
      z.object({
        episodeId: z.number(),
        projectId: z.number(),
        script: z.string(),
        episodeTitle: z.string(),
        characters: z.array(
          z.object({
            name: z.string(),
            referenceImageUrl: z.string().url(),
            descriptor: z.string(),
            visualTraits: z.object({
              hair: z.string(),
              eyes: z.string(),
              clothing: z.string(),
              distinguishingFeatures: z.array(z.string()),
            }),
            isDarkCharacter: z.boolean(),
          })
        ),
        voiceAssignments: z.array(
          z.object({
            characterName: z.string(),
            provider: z.enum(["elevenlabs", "cartesia"]),
            voiceId: z.string(),
            settings: z
              .object({
                stability: z.number(),
                similarityBoost: z.number(),
                style: z.number(),
              })
              .optional(),
          })
        ),
        resolution: z.enum(["360p", "480p", "720p", "1080p"]).optional(),
        concurrency: z.number().min(1).max(8).optional(),
        musicUrl: z.string().url().optional(),
        targetDurationSeconds: z.number().optional(),
        genre: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      // Create pipeline run record (using existing schema columns)
      const [run] = await db
        .insert(pipelineRuns)
        .values({
          episodeId: input.episodeId,
          projectId: input.projectId,
          userId: ctx.user.id,
          status: "running",
          progress: 0,
          nodeStatuses: { pipeline: "simple-path-v1", resolution: input.resolution || "720p" },
        })
        .$returningId();

      const pipelineRunId = run.id;

      // Run pipeline asynchronously (don't await — return immediately)
      runSimplePath({
        pipelineRunId,
        episodeId: input.episodeId,
        projectId: input.projectId,
        userId: ctx.user.id,
        script: input.script,
        episodeTitle: input.episodeTitle,
        characters: input.characters,
        voiceAssignments: input.voiceAssignments,
        resolution: input.resolution,
        concurrency: input.concurrency,
        musicUrl: input.musicUrl,
        targetDurationSeconds: input.targetDurationSeconds,
        genre: input.genre,
        onStageProgress: async (stage, progress, message) => {
          try {
            await db
              .update(pipelineRuns)
              .set({
                progress: Math.round((((stage - 1) * 20) + (progress * 0.2))),
                currentNode: "video_gen", // Closest match to current stage
                nodeStatuses: { stage, progress, message, pipeline: "simple-path-v1" },
              })
              .where(eq(pipelineRuns.id, pipelineRunId));
          } catch { /* ignore DB update errors during progress */ }
        },
      })
        .then(async (state) => {
          await db
            .update(pipelineRuns)
            .set({
              status: "completed",
              progress: 100,
              totalCost: Math.round(state.costs.total * 100), // Convert to cents
              nodeStatuses: { finalVideoUrl: state.stage5Output?.finalVideoUrl, costs: state.costs },
              completedAt: new Date(),
            })
            .where(eq(pipelineRuns.id, pipelineRunId));
        })
        .catch(async (err) => {
          await db
            .update(pipelineRuns)
            .set({
              status: "failed",
              errors: [{ node: "simple-path", message: err.message, timestamp: new Date().toISOString() }],
            })
            .where(eq(pipelineRuns.id, pipelineRunId));
        });

      return { pipelineRunId, status: "started" };
    }),

  /**
   * Run First Light smoke test (uses locked fixture)
   */
  runSmokeTest: protectedProcedure
    .input(
      z.object({
        referenceImageUrls: z.object({
          mira: z.string().url(),
          kazuo: z.string().url(),
          renji: z.string().url(),
        }),
        musicUrl: z.string().url().optional(),
        resolution: z.enum(["360p", "480p", "720p", "1080p"]).optional(),
        concurrency: z.number().min(1).max(4).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      // Create pipeline run (episodeId/projectId = 0 for smoke test)
      // Need valid FK references — use 1 as placeholder
      const [run] = await db
        .insert(pipelineRuns)
        .values({
          episodeId: 1,
          projectId: 1,
          userId: ctx.user.id,
          status: "running",
          progress: 0,
          nodeStatuses: { pipeline: "simple-path-v1-smoke-test", fixture: "first-light" },
        })
        .$returningId();

      const pipelineRunId = run.id;

      const config = buildFirstLightConfig(pipelineRunId, 1, 1, ctx.user.id, {
        referenceImageUrls: input.referenceImageUrls,
        musicUrl: input.musicUrl,
        resolution: input.resolution,
        concurrency: input.concurrency,
      });

      // Run async
      runSimplePath({
        ...config,
        onStageProgress: async (stage, progress, message) => {
          try {
            await db
              .update(pipelineRuns)
              .set({
                progress: Math.round((((stage - 1) * 20) + (progress * 0.2))),
                nodeStatuses: { stage, progress, message, pipeline: "simple-path-v1-smoke-test" },
              })
              .where(eq(pipelineRuns.id, pipelineRunId));
          } catch { /* ignore */ }
        },
      })
        .then(async (state) => {
          await db
            .update(pipelineRuns)
            .set({
              status: "completed",
              progress: 100,
              totalCost: Math.round(state.costs.total * 100),
              nodeStatuses: { finalVideoUrl: state.stage5Output?.finalVideoUrl, costs: state.costs },
              completedAt: new Date(),
            })
            .where(eq(pipelineRuns.id, pipelineRunId));
        })
        .catch(async (err) => {
          await db
            .update(pipelineRuns)
            .set({
              status: "failed",
              errors: [{ node: "simple-path", message: err.message, timestamp: new Date().toISOString() }],
            })
            .where(eq(pipelineRuns.id, pipelineRunId));
        });

      return { pipelineRunId, status: "started" };
    }),
});
