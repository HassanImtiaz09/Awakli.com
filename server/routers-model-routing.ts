/**
 * Model Routing Router — tRPC endpoints for the Smart Kling Model Router.
 *
 * Provides:
 *   - classifyPanel: classify a single panel (preview, no side effects)
 *   - batchClassifyPreview: classify all panels in an episode with optional overrides
 *   - getRoutingStats: get model routing stats for an episode or pipeline run
 *   - getRoutingBreakdown: get per-panel routing details for a pipeline run
 *   - overrideModel: force a specific model for a panel (user override)
 *   - getCostComparison: compare actual cost vs V3-Omni-only cost
 *   - getModelInfo: get available model tiers and pricing
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  classifyScene,
  classifyPanelsBatch,
  calculateCost,
  calculateV3OmniCost,
  MODEL_MAP,
  type PanelScriptData,
  type SceneClassification,
} from "./scene-classifier";
import {
  getModelRoutingStatsByEpisode,
  getModelRoutingStatsByRun,
  getRoutingDataByRun,
  updatePipelineAssetRouting,
  getPanelsByEpisode,
  getUserSubscriptionTier,
} from "./db";
import { isModelTierAllowed, getMaxProviderTier } from "./premium-tier-features";

export const modelRoutingRouter = router({
  /**
   * Batch classify all panels in an episode — preview only, no database side effects.
   * Returns per-panel classification, cost estimates, and aggregate summary.
   * Supports user overrides: pass { panelId: forceTier } to override specific panels.
   */
  batchClassifyPreview: protectedProcedure
    .input(z.object({
      episodeId: z.number(),
      durationSec: z.number().min(1).max(30).default(5),
      mode: z.enum(["std", "pro"]).default("pro"),
      overrides: z.record(z.string(), z.number().min(1).max(4)).optional(),
    }))
    .mutation(async ({ input }) => {
      const { episodeId, durationSec, mode, overrides } = input;

      // Fetch all panels for the episode
      const episodePanels = await getPanelsByEpisode(episodeId);
      if (!episodePanels || episodePanels.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No panels found for this episode. Generate panels first.",
        });
      }

      // Convert DB panels to PanelScriptData
      const panelDataList: PanelScriptData[] = episodePanels.map(p => ({
        panelId: p.id,
        visualDescription: p.visualDescription || "",
        cameraAngle: p.cameraAngle || undefined,
        dialogue: p.dialogue as PanelScriptData["dialogue"],
        sceneType: p.transition === "fade" || p.transition === "dissolve" ? "transition" : undefined,
        characterCount: undefined,
      }));

      // Classify all panels
      const classifications = await classifyPanelsBatch(panelDataList);

      // Apply user overrides
      const overrideMap = overrides || {};
      const finalClassifications: Array<SceneClassification & { overridden: boolean }> = classifications.map((c, i) => {
        const panelId = panelDataList[i].panelId;
        const forceTier = overrideMap[String(panelId)];
        if (forceTier && forceTier >= 1 && forceTier <= 4) {
          const m = MODEL_MAP[forceTier as 1 | 2 | 3 | 4];
          return {
            ...c,
            tier: forceTier as 1 | 2 | 3 | 4,
            model: m.model,
            modelName: m.modelName,
            reasoning: `User override → Tier ${forceTier} (original: Tier ${c.tier} — ${c.reasoning})`,
            overridden: true,
          };
        }
        return { ...c, overridden: false };
      });

      // Build per-panel results
      const perPanel = finalClassifications.map((c, i) => {
        const panel = episodePanels[i];
        const cost = calculateCost(c.tier, durationSec, mode);
        const v3Cost = calculateV3OmniCost(durationSec, mode);
        return {
          panelId: panel.id,
          sceneNumber: panel.sceneNumber,
          panelNumber: panel.panelNumber,
          visualDescription: (panel.visualDescription || "").slice(0, 120),
          cameraAngle: panel.cameraAngle,
          hasDialogue: c.hasDialogue,
          tier: c.tier,
          model: c.model,
          modelName: c.modelName,
          reasoning: c.reasoning,
          faceVisible: c.faceVisible,
          lipSyncNeeded: c.lipSyncNeeded,
          lipSyncBeneficial: c.lipSyncBeneficial,
          deterministic: c.deterministic,
          overridden: c.overridden,
          estimatedCost: cost,
          v3OmniCost: v3Cost,
          savings: v3Cost - cost,
        };
      });

      // Aggregate summary
      const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      let totalCost = 0;
      let totalV3Cost = 0;
      let classificationCost = 0;
      let deterministicCount = 0;
      let overriddenCount = 0;

      for (const p of perPanel) {
        tierCounts[p.tier as 1 | 2 | 3 | 4]++;
        totalCost += p.estimatedCost;
        totalV3Cost += p.v3OmniCost;
      }
      for (const c of finalClassifications) {
        classificationCost += c.classificationCostUsd;
        if (c.deterministic) deterministicCount++;
        if (c.overridden) overriddenCount++;
      }

      const savings = totalV3Cost - totalCost;
      const savingsPercent = totalV3Cost > 0 ? (savings / totalV3Cost) * 100 : 0;

      return {
        episodeId,
        totalPanels: perPanel.length,
        tierCounts,
        totalCost: Math.round(totalCost * 1000) / 1000,
        totalV3OmniCost: Math.round(totalV3Cost * 1000) / 1000,
        savings: Math.round(savings * 1000) / 1000,
        savingsPercent: Math.round(savingsPercent * 10) / 10,
        classificationCost: Math.round(classificationCost * 1000) / 1000,
        deterministicCount,
        overriddenCount,
        durationSec,
        mode,
        perPanel,
      };
    }),

  /**
   * Classify a single panel — preview only, no database side effects.
   * Useful for the UI to show what model would be selected.
   */
  classifyPanel: protectedProcedure
    .input(z.object({
      panelId: z.number(),
      visualDescription: z.string(),
      cameraAngle: z.string().optional(),
      dialogue: z.array(z.object({
        character: z.string().optional(),
        text: z.string(),
        emotion: z.string().optional(),
      })).optional(),
      mood: z.string().optional(),
      sceneType: z.string().optional(),
      animationStyle: z.string().optional(),
      characterCount: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const panelData: PanelScriptData = {
        panelId: input.panelId,
        visualDescription: input.visualDescription,
        cameraAngle: input.cameraAngle,
        dialogue: input.dialogue,
        mood: input.mood,
        sceneType: input.sceneType,
        animationStyle: input.animationStyle,
        characterCount: input.characterCount,
      };

      const classification = await classifyScene(panelData);

      return {
        tier: classification.tier,
        model: classification.model,
        modelName: classification.modelName,
        reasoning: classification.reasoning,
        hasDialogue: classification.hasDialogue,
        faceVisible: classification.faceVisible,
        lipSyncNeeded: classification.lipSyncNeeded,
        lipSyncBeneficial: classification.lipSyncBeneficial,
        deterministic: classification.deterministic,
        classificationCostUsd: classification.classificationCostUsd,
        estimatedCostPro5s: calculateCost(classification.tier, 5, "pro"),
        v3OmniCostPro5s: calculateV3OmniCost(5, "pro"),
      };
    }),

  /**
   * Get model routing stats for an episode (all pipeline runs).
   */
  getStatsByEpisode: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => {
      const stats = await getModelRoutingStatsByEpisode(input.episodeId);
      return stats.map(s => ({
        id: s.id,
        episodeId: s.episodeId,
        pipelineRunId: s.pipelineRunId,
        totalPanels: s.totalPanels,
        tierCounts: {
          1: s.tier1Count,
          2: s.tier2Count,
          3: s.tier3Count,
          4: s.tier4Count,
        },
        actualCost: s.actualCost,
        v3OmniCost: s.v3OmniCost,
        savings: s.savings,
        savingsPercent: s.savingsPercent,
        createdAt: s.createdAt,
      }));
    }),

  /**
   * Get model routing stats for a specific pipeline run.
   */
  getStatsByRun: protectedProcedure
    .input(z.object({ pipelineRunId: z.number() }))
    .query(async ({ input }) => {
      const stat = await getModelRoutingStatsByRun(input.pipelineRunId);
      if (!stat) return null;
      return {
        id: stat.id,
        episodeId: stat.episodeId,
        pipelineRunId: stat.pipelineRunId,
        totalPanels: stat.totalPanels,
        tierCounts: {
          1: stat.tier1Count,
          2: stat.tier2Count,
          3: stat.tier3Count,
          4: stat.tier4Count,
        },
        actualCost: stat.actualCost,
        v3OmniCost: stat.v3OmniCost,
        savings: stat.savings,
        savingsPercent: stat.savingsPercent,
        createdAt: stat.createdAt,
      };
    }),

  /**
   * Get per-panel routing breakdown for a pipeline run.
   * Shows which model was used for each panel and why.
   */
  getRoutingBreakdown: protectedProcedure
    .input(z.object({ pipelineRunId: z.number() }))
    .query(async ({ input }) => {
      const assets = await getRoutingDataByRun(input.pipelineRunId);
      return assets.map(a => ({
        id: a.id,
        panelId: a.panelId,
        assetType: a.assetType,
        klingModelUsed: a.klingModelUsed,
        complexityTier: a.complexityTier,
        lipSyncMethod: a.lipSyncMethod,
        classificationReasoning: a.classificationReasoning,
        costActual: a.costActual,
        costIfV3Omni: a.costIfV3Omni,
        userOverride: a.userOverride,
        url: a.url,
      }));
    }),

  /**
   * Override the model for a specific pipeline asset.
   * Used by Studio-tier users to force V3 Omni on any panel.
   */
  overrideModel: protectedProcedure
    .input(z.object({
      assetId: z.number(),
      forceTier: z.number().min(1).max(4),
    }))
    .mutation(async ({ ctx, input }) => {
      const m = MODEL_MAP[input.forceTier];
      if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid tier" });

      // ─── TIER GATE: Premium model access ───
      // Map internal routing tier (1-4) to model tier names for access check
      const TIER_TO_MODEL_TIER: Record<number, string> = { 1: "ultra", 2: "premium", 3: "standard", 4: "budget" };
      const requestedModelTier = TIER_TO_MODEL_TIER[input.forceTier] || "standard";
      const userTier = await getUserSubscriptionTier(ctx.user.id);
      if (!isModelTierAllowed(userTier, requestedModelTier)) {
        const maxTier = getMaxProviderTier(userTier);
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan does not allow Tier ${input.forceTier} models (requires ${requestedModelTier} access). Max provider tier: ${maxTier}. Upgrade to unlock.`,
        });
      }

      await updatePipelineAssetRouting(input.assetId, {
        klingModelUsed: m.model,
        complexityTier: input.forceTier,
        userOverride: 1,
        classificationReasoning: `User override → Tier ${input.forceTier} (${m.model})`,
      });

      return { success: true, model: m.model, tier: input.forceTier };
    }),

  /**
   * Get cost comparison data for a pipeline run.
   * Returns actual cost, V3-Omni-only cost, savings, and per-tier breakdown.
   */
  getCostComparison: protectedProcedure
    .input(z.object({ pipelineRunId: z.number() }))
    .query(async ({ input }) => {
      const stat = await getModelRoutingStatsByRun(input.pipelineRunId);
      const assets = await getRoutingDataByRun(input.pipelineRunId);

      const perTier = [1, 2, 3, 4].map(tier => {
        const tierAssets = assets.filter(a => a.complexityTier === tier);
        return {
          tier,
          model: MODEL_MAP[tier].model,
          count: tierAssets.length,
          actualCost: tierAssets.reduce((sum, a) => sum + (a.costActual || 0), 0),
          v3OmniCost: tierAssets.reduce((sum, a) => sum + (a.costIfV3Omni || 0), 0),
        };
      });

      return {
        summary: stat ? {
          totalPanels: stat.totalPanels,
          actualCost: stat.actualCost,
          v3OmniCost: stat.v3OmniCost,
          savings: stat.savings,
          savingsPercent: stat.savingsPercent,
        } : null,
        perTier,
        perPanel: assets.map(a => ({
          panelId: a.panelId,
          tier: a.complexityTier,
          model: a.klingModelUsed,
          actualCost: a.costActual,
          v3OmniCost: a.costIfV3Omni,
          lipSyncMethod: a.lipSyncMethod,
          userOverride: !!a.userOverride,
        })),
      };
    }),

  /**
   * Get available model tiers and pricing info.
   */
  getModelInfo: protectedProcedure
    .query(async () => {
      return Object.entries(MODEL_MAP).map(([tier, info]) => ({
        tier: Number(tier),
        model: info.model,
        modelName: info.modelName,
        costPerSecStd: info.costPerSecStd,
        costPerSecPro: info.costPerSecPro,
        costPer5sStd: info.costPerSecStd * 5,
        costPer5sPro: info.costPerSecPro * 5,
        description: tier === "1" ? "V3 Omni — Native lip sync, highest quality"
          : tier === "2" ? "V2.6 — High quality, complex scenes"
          : tier === "3" ? "V2.1 — Medium quality, simple motion"
          : "V1.6 — Basic, transitions & stills",
      }));
    }),
});
