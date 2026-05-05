/**
 * Resolution Flow Router (D2.5 Sakuga Kantoku)
 *
 * tRPC procedures for the multi-round auto-regen consistency resolution system.
 */
import { z } from 'zod';
import { router, protectedProcedure } from './_core/trpc';
import {
  createResolutionIssue,
  getResolutionIssueById,
  getIssuesByProjectEpisode,
  getIssuesByStatus,
  getOpenIssuesForUser,
  updateIssueStatus,
  incrementIssueRoundCount,
  assignIssue,
  createResolutionRound,
  getRoundsByIssueId,
  updateRoundVerdict,
  updateRoundResult,
  upsertConsistencyScore,
  getConsistencyScore,
  getProjectConsistencyScores,
  getIssueSummaryByProject,
} from './db-resolution';
import {
  analyzeGengaConsistency,
  buildRegenParams,
  determineNextAction,
  scoreImprovement,
  getBatchApprovalCandidates,
  generateResolutionSummary,
  type CharacterBibleEntry,
  type StyleReference,
  type PanelForAnalysis,
  type RoundResult,
} from './benchmarks/sakuga-kantoku/resolution-engine';

export const resolutionRouter = router({
  // ─── Issue Queries ────────────────────────────────────────────────────────

  /** Get all issues for a project/episode */
  getIssues: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      episodeId: z.number(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      if (input.status) {
        return getIssuesByStatus(input.projectId, input.episodeId, input.status);
      }
      return getIssuesByProjectEpisode(input.projectId, input.episodeId);
    }),

  /** Get a single issue with its rounds */
  getIssueDetail: protectedProcedure
    .input(z.object({ issueId: z.number() }))
    .query(async ({ input }) => {
      const issue = await getResolutionIssueById(input.issueId);
      if (!issue) return null;
      const rounds = await getRoundsByIssueId(input.issueId);
      return { issue, rounds };
    }),

  /** Get issues assigned to the current user */
  getMyIssues: protectedProcedure
    .query(async ({ ctx }) => {
      return getOpenIssuesForUser(ctx.user.id);
    }),

  /** Get project-level consistency scores */
  getConsistencyScores: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return getProjectConsistencyScores(input.projectId);
    }),

  /** Get issue summary for a project */
  getIssueSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return getIssueSummaryByProject(input.projectId);
    }),

  // ─── Analysis & Regen Mutations ───────────────────────────────────────────

  /** Trigger consistency analysis on a genga set */
  analyzeConsistency: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      episodeId: z.number(),
      panels: z.array(z.object({
        panelId: z.number(),
        imageUrl: z.string(),
        width: z.number(),
        height: z.number(),
        characterIds: z.array(z.string()),
        sceneId: z.string().optional(),
      })),
      characterBible: z.array(z.object({
        characterId: z.string(),
        name: z.string(),
        referenceUrls: z.array(z.string()),
        proportions: z.record(z.string(), z.number()),
        colorPalette: z.record(z.string(), z.string()),
        styleNotes: z.string(),
      })),
      styleRefs: z.array(z.object({
        url: z.string(),
        aspect: z.enum(['line_weight', 'shading', 'color_tone', 'composition', 'overall']),
        weight: z.number(),
      })),
    }))
    .mutation(async ({ input }) => {
      // Run analysis
      const report = analyzeGengaConsistency(
        input.panels as PanelForAnalysis[],
        input.characterBible as CharacterBibleEntry[],
        input.styleRefs as StyleReference[],
        input.projectId,
        input.episodeId,
      );

      // Persist issues to DB
      for (const issue of report.issuesFound) {
        await createResolutionIssue({
          projectId: input.projectId,
          episodeId: input.episodeId,
          panelId: issue.panelId,
          issueType: issue.issueType,
          severity: issue.severity,
          description: issue.description,
          confidenceScore: issue.confidenceScore,
          metadata: {
            boundingBox: issue.boundingBox,
            affectedCharacterId: issue.affectedCharacterId,
            deviationMetrics: issue.deviationMetrics,
          },
        });
      }

      // Update consistency score
      await upsertConsistencyScore({
        projectId: input.projectId,
        episodeId: input.episodeId,
        consistencyScore: report.consistencyScore,
        driftPanelCount: report.driftPanelCount,
        totalPanelCount: report.totalPanels,
        issueBreakdown: report.issueBreakdown,
      });

      return {
        issuesFound: report.issuesFound.length,
        consistencyScore: report.consistencyScore,
        driftPanelCount: report.driftPanelCount,
        durationMs: report.durationMs,
        breakdown: report.issueBreakdown,
      };
    }),

  /** Trigger auto-regen for an issue */
  triggerRegen: protectedProcedure
    .input(z.object({
      issueId: z.number(),
      characterBible: z.array(z.object({
        characterId: z.string(),
        name: z.string(),
        referenceUrls: z.array(z.string()),
        proportions: z.record(z.string(), z.number()),
        colorPalette: z.record(z.string(), z.string()),
        styleNotes: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const issue = await getResolutionIssueById(input.issueId);
      if (!issue) throw new Error('Issue not found');

      const rounds = await getRoundsByIssueId(input.issueId);
      const nextAction = determineNextAction(
        {
          panelId: issue.panelId,
          issueType: issue.issueType as any,
          severity: issue.severity as any,
          description: issue.description,
          confidenceScore: issue.confidenceScore ?? 0.5,
        },
        rounds.map(r => ({
          roundNumber: r.roundNumber,
          regenParams: r.regenParams as any,
          resultUrl: r.resultUrl,
          improvementScore: r.improvementScore ?? 0,
          verdict: r.reviewerVerdict as any,
        })),
      );

      if (nextAction.action === 'escalate') {
        await updateIssueStatus(input.issueId, 'escalated');
        return { action: 'escalated', reason: nextAction.reason };
      }

      if (nextAction.action === 'auto_approve') {
        await updateIssueStatus(input.issueId, 'approved', new Date());
        return { action: 'approved', reason: nextAction.reason };
      }

      // Build regen params
      const roundNumber = rounds.length + 1;
      const regenParams = buildRegenParams(
        {
          panelId: issue.panelId,
          issueType: issue.issueType as any,
          severity: issue.severity as any,
          description: issue.description,
          confidenceScore: issue.confidenceScore ?? 0.5,
        },
        (input.characterBible ?? []) as CharacterBibleEntry[],
        rounds.map(r => ({
          roundNumber: r.roundNumber,
          regenParams: r.regenParams as any,
          resultUrl: r.resultUrl,
          improvementScore: r.improvementScore ?? 0,
          verdict: r.reviewerVerdict as any,
        })),
        roundNumber,
      );

      // Create round record
      const roundId = await createResolutionRound({
        issueId: input.issueId,
        roundNumber,
        regenParams: regenParams as any,
      });

      // Update issue status and round count
      await updateIssueStatus(input.issueId, 'in_progress');
      await incrementIssueRoundCount(input.issueId);

      return {
        action: 'regen_triggered',
        roundId,
        roundNumber,
        regenParams,
        reason: nextAction.reason,
      };
    }),

  /** Submit review verdict for a round */
  reviewRound: protectedProcedure
    .input(z.object({
      roundId: z.number(),
      issueId: z.number(),
      verdict: z.enum(['approved', 'rejected', 'partial_improvement']),
      improvementScore: z.number().min(0).max(1),
      reviewerNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await updateRoundVerdict(
        input.roundId,
        input.verdict,
        input.improvementScore,
        ctx.user.id,
        input.reviewerNotes,
      );

      // If approved, resolve the issue
      if (input.verdict === 'approved') {
        await updateIssueStatus(input.issueId, 'resolved', new Date());
      }

      return { success: true };
    }),

  /** Update round result URL (after regen completes) */
  updateRoundResult: protectedProcedure
    .input(z.object({
      roundId: z.number(),
      resultUrl: z.string(),
    }))
    .mutation(async ({ input }) => {
      await updateRoundResult(input.roundId, input.resultUrl);
      return { success: true };
    }),

  /** Assign an issue to a user */
  assignIssue: protectedProcedure
    .input(z.object({
      issueId: z.number(),
      userId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await assignIssue(input.issueId, input.userId);
      return { success: true };
    }),

  /** Mark issue as won't fix */
  dismissIssue: protectedProcedure
    .input(z.object({
      issueId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateIssueStatus(input.issueId, 'wont_fix');
      return { success: true };
    }),

  /** Batch approve low-severity issues */
  batchApprove: protectedProcedure
    .input(z.object({
      issueIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      let approved = 0;
      for (const id of input.issueIds) {
        await updateIssueStatus(id, 'approved', new Date());
        approved++;
      }
      return { approved };
    }),
});
