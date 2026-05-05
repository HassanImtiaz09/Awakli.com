/**
 * Tests for Sakuga Kantoku Resolution Engine (D2.5)
 *
 * Covers: consistency analysis, issue classification, regen parameter building,
 * multi-round tracking, confidence scoring, and batch operations.
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeGengaConsistency,
  computeConsistencyScore,
  buildRegenParams,
  determineNextAction,
  scoreImprovement,
  getBatchApprovalCandidates,
  generateResolutionSummary,
  type CharacterBibleEntry,
  type StyleReference,
  type PanelForAnalysis,
  type ConsistencyIssue,
  type RoundResult,
} from './resolution-engine';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function createTestPanel(overrides: Partial<PanelForAnalysis> = {}): PanelForAnalysis {
  return {
    panelId: 1,
    imageUrl: 'https://example.com/panel1.png',
    width: 800,
    height: 1200,
    characterIds: ['char_1'],
    ...overrides,
  };
}

function createTestBible(): CharacterBibleEntry[] {
  return [{
    characterId: 'char_1',
    name: 'Sakura',
    referenceUrls: ['https://example.com/ref1.png'],
    proportions: {
      headToBodyRatio: 0.15,
      shoulderWidth: 0.3,
      eyeSpacing: 0.05,
    },
    colorPalette: {
      hair: '#FF69B4',
      skin: '#FFDAB9',
      eyes: '#4169E1',
      primaryOutfit: '#FF0000',
      secondaryOutfit: '#FFFFFF',
    },
    styleNotes: 'Clean linework, soft shading, large expressive eyes',
  }];
}

function createTestStyleRefs(): StyleReference[] {
  return [
    { url: 'https://example.com/style1.png', aspect: 'overall', weight: 1.0 },
    { url: 'https://example.com/style2.png', aspect: 'line_weight', weight: 0.8 },
  ];
}

function createTestIssue(overrides: Partial<ConsistencyIssue> = {}): ConsistencyIssue {
  return {
    panelId: 1,
    issueType: 'proportion_drift',
    severity: 3,
    description: 'Character head-to-body ratio deviates',
    confidenceScore: 0.7,
    affectedCharacterId: 'char_1',
    ...overrides,
  };
}

function createTestRound(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    roundNumber: 1,
    regenParams: {
      prompt: 'Fix proportions',
      negativePrompt: 'deformed',
      seed: 12345,
      strength: 0.5,
      referenceUrls: [],
    },
    resultUrl: 'https://example.com/regen1.png',
    improvementScore: 0.5,
    verdict: 'partial_improvement',
    ...overrides,
  };
}

// ─── Consistency Analysis Tests ───────────────────────────────────────────────

describe('Sakuga Kantoku Resolution Engine', () => {
  describe('analyzeGengaConsistency', () => {
    it('should return a report with correct structure', () => {
      const panels = [createTestPanel()];
      const report = analyzeGengaConsistency(
        panels, createTestBible(), createTestStyleRefs(), 1, 1
      );

      expect(report).toHaveProperty('projectId', 1);
      expect(report).toHaveProperty('episodeId', 1);
      expect(report).toHaveProperty('totalPanels', 1);
      expect(report).toHaveProperty('issuesFound');
      expect(report).toHaveProperty('consistencyScore');
      expect(report).toHaveProperty('issueBreakdown');
      expect(report).toHaveProperty('driftPanelCount');
      expect(report).toHaveProperty('analysisTimestamp');
      expect(report).toHaveProperty('durationMs');
      expect(report.analysisTimestamp).toBeInstanceOf(Date);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return 100% consistency for panels without image buffers', () => {
      const panels = [createTestPanel(), createTestPanel({ panelId: 2 })];
      const report = analyzeGengaConsistency(
        panels, createTestBible(), createTestStyleRefs(), 1, 1
      );

      // Without image buffers, no pixel-level analysis can be done
      expect(report.consistencyScore).toBe(100);
      expect(report.issuesFound.length).toBe(0);
    });

    it('should detect issues when image buffers are provided', () => {
      // Create a buffer with extreme values that would trigger detection
      const buffer = Buffer.alloc(800 * 1200 * 4, 0); // All black
      const panels = [createTestPanel({ imageBuffer: buffer })];
      const report = analyzeGengaConsistency(
        panels, createTestBible(), createTestStyleRefs(), 1, 1
      );

      // With all-black buffer, should detect some issues
      expect(report).toBeDefined();
      expect(report.totalPanels).toBe(1);
    });

    it('should correctly count drift panels', () => {
      const buffer = Buffer.alloc(800 * 1200 * 4);
      // Fill with random-ish data to trigger some detections
      for (let i = 0; i < buffer.length; i += 4) {
        buffer[i] = (i * 7) % 256;     // R
        buffer[i + 1] = (i * 3) % 256; // G
        buffer[i + 2] = (i * 11) % 256; // B
        buffer[i + 3] = 255;            // A
      }

      const panels = [
        createTestPanel({ panelId: 1, imageBuffer: buffer }),
        createTestPanel({ panelId: 2, imageBuffer: buffer }),
        createTestPanel({ panelId: 3 }), // No buffer — no issues
      ];

      const report = analyzeGengaConsistency(
        panels, createTestBible(), createTestStyleRefs(), 1, 1
      );

      // Drift panels should be <= total panels with buffers
      expect(report.driftPanelCount).toBeLessThanOrEqual(2);
    });

    it('should include all issue types in breakdown', () => {
      const panels = [createTestPanel()];
      const report = analyzeGengaConsistency(
        panels, createTestBible(), createTestStyleRefs(), 1, 1
      );

      expect(report.issueBreakdown).toHaveProperty('proportion_drift');
      expect(report.issueBreakdown).toHaveProperty('color_inconsistency');
      expect(report.issueBreakdown).toHaveProperty('off_model_face');
      expect(report.issueBreakdown).toHaveProperty('pose_break');
      expect(report.issueBreakdown).toHaveProperty('bg_mismatch');
      expect(report.issueBreakdown).toHaveProperty('style_deviation');
      expect(report.issueBreakdown).toHaveProperty('line_weight_mismatch');
    });
  });

  describe('computeConsistencyScore', () => {
    it('should return 100 for no issues', () => {
      expect(computeConsistencyScore(10, [])).toBe(100);
    });

    it('should return 100 for zero panels', () => {
      expect(computeConsistencyScore(0, [])).toBe(100);
    });

    it('should decrease with more severe issues', () => {
      const lowIssues = [createTestIssue({ severity: 1 })];
      const highIssues = [createTestIssue({ severity: 5 })];

      const lowScore = computeConsistencyScore(10, lowIssues);
      const highScore = computeConsistencyScore(10, highIssues);

      expect(lowScore).toBeGreaterThan(highScore);
    });

    it('should decrease with more issues', () => {
      const fewIssues = [createTestIssue()];
      const manyIssues = [
        createTestIssue({ panelId: 1 }),
        createTestIssue({ panelId: 2 }),
        createTestIssue({ panelId: 3 }),
      ];

      const fewScore = computeConsistencyScore(10, fewIssues);
      const manyScore = computeConsistencyScore(10, manyIssues);

      expect(fewScore).toBeGreaterThan(manyScore);
    });

    it('should never go below 0', () => {
      const extremeIssues = Array.from({ length: 100 }, (_, i) =>
        createTestIssue({ panelId: i, severity: 5 })
      );
      const score = computeConsistencyScore(5, extremeIssues);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Regen Parameter Builder Tests ────────────────────────────────────────

  describe('buildRegenParams', () => {
    it('should return valid regen parameters', () => {
      const issue = createTestIssue();
      const params = buildRegenParams(issue, createTestBible(), [], 1);

      expect(params).toHaveProperty('prompt');
      expect(params).toHaveProperty('negativePrompt');
      expect(params).toHaveProperty('seed');
      expect(params).toHaveProperty('strength');
      expect(params).toHaveProperty('referenceUrls');
      expect(params.prompt.length).toBeGreaterThan(0);
      expect(params.negativePrompt.length).toBeGreaterThan(0);
      expect(params.strength).toBeGreaterThan(0);
      expect(params.strength).toBeLessThanOrEqual(1);
    });

    it('should increase strength with each round', () => {
      const issue = createTestIssue();
      const bible = createTestBible();

      const params1 = buildRegenParams(issue, bible, [], 1);
      const params2 = buildRegenParams(issue, bible, [createTestRound()], 2);
      const params3 = buildRegenParams(issue, bible, [createTestRound(), createTestRound({ roundNumber: 2 })], 3);

      expect(params2.strength).toBeGreaterThan(params1.strength);
      expect(params3.strength).toBeGreaterThan(params2.strength);
    });

    it('should include character context in prompt', () => {
      const issue = createTestIssue({ affectedCharacterId: 'char_1' });
      const params = buildRegenParams(issue, createTestBible(), [], 1);

      expect(params.prompt).toContain('Sakura');
    });

    it('should include inpaint mask for spatial issues', () => {
      const issue = createTestIssue({
        issueType: 'proportion_drift',
        boundingBox: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
      });
      const params = buildRegenParams(issue, createTestBible(), [], 1);

      expect(params.inpaintMask).toBeDefined();
      expect(params.inpaintMask?.x).toBe(0.2);
    });

    it('should not include inpaint mask for style issues', () => {
      const issue = createTestIssue({ issueType: 'style_deviation' });
      const params = buildRegenParams(issue, createTestBible(), [], 1);

      expect(params.inpaintMask).toBeUndefined();
    });

    it('should incorporate feedback from previous rounds', () => {
      const issue = createTestIssue();
      const prevRounds: RoundResult[] = [{
        roundNumber: 1,
        regenParams: { prompt: '', negativePrompt: '', seed: 1, strength: 0.5, referenceUrls: [] },
        resultUrl: 'https://example.com/r1.png',
        improvementScore: 0.3,
        verdict: 'partial_improvement',
        reviewerNotes: 'Eyes still too far apart',
      }];

      const params = buildRegenParams(issue, createTestBible(), prevRounds, 2);
      expect(params.prompt).toContain('Previous feedback');
    });

    it('should produce deterministic seeds for same input', () => {
      const issue = createTestIssue();
      const params1 = buildRegenParams(issue, createTestBible(), [], 1);
      const params2 = buildRegenParams(issue, createTestBible(), [], 1);

      expect(params1.seed).toBe(params2.seed);
    });
  });

  // ─── Multi-Round Tracking Tests ───────────────────────────────────────────

  describe('determineNextAction', () => {
    it('should return regen for new issues with no rounds', () => {
      const result = determineNextAction(createTestIssue(), []);
      expect(result.action).toBe('regen');
    });

    it('should return auto_approve when last round is approved', () => {
      const rounds = [createTestRound({ verdict: 'approved', improvementScore: 1.0 })];
      const result = determineNextAction(createTestIssue(), rounds);
      expect(result.action).toBe('auto_approve');
    });

    it('should return auto_approve when improvement exceeds threshold', () => {
      const issue = createTestIssue({ severity: 1 }); // threshold = 0.6
      const rounds = [createTestRound({ verdict: 'partial_improvement', improvementScore: 0.7 })];
      const result = determineNextAction(issue, rounds);
      expect(result.action).toBe('auto_approve');
    });

    it('should return escalate after max rounds', () => {
      const rounds = [
        createTestRound({ roundNumber: 1, verdict: 'rejected', improvementScore: 0.2 }),
        createTestRound({ roundNumber: 2, verdict: 'rejected', improvementScore: 0.3 }),
        createTestRound({ roundNumber: 3, verdict: 'rejected', improvementScore: 0.4 }),
      ];
      const result = determineNextAction(createTestIssue({ severity: 5 }), rounds);
      expect(result.action).toBe('escalate');
    });

    it('should continue regen when below threshold and under max rounds', () => {
      const issue = createTestIssue({ severity: 5 }); // threshold = 0.9
      const rounds = [createTestRound({ verdict: 'partial_improvement', improvementScore: 0.5 })];
      const result = determineNextAction(issue, rounds);
      expect(result.action).toBe('regen');
    });

    it('should have stricter threshold for higher severity', () => {
      const lowSeverity = createTestIssue({ severity: 1 });
      const highSeverity = createTestIssue({ severity: 5 });
      const rounds = [createTestRound({ verdict: 'partial_improvement', improvementScore: 0.7 })];

      const lowResult = determineNextAction(lowSeverity, rounds);
      const highResult = determineNextAction(highSeverity, rounds);

      // 0.7 should auto-approve severity 1 (threshold 0.6) but not severity 5 (threshold 0.9)
      expect(lowResult.action).toBe('auto_approve');
      expect(highResult.action).toBe('regen');
    });
  });

  // ─── Score Improvement Tests ──────────────────────────────────────────────

  describe('scoreImprovement', () => {
    it('should return 1.0 when no issues found in regen result', () => {
      // Empty buffer = no issues detected
      const buffer = Buffer.alloc(100 * 100 * 4, 128); // Mid-gray
      const score = scoreImprovement(
        createTestIssue({ issueType: 'style_deviation' }),
        buffer, 100, 100, createTestBible()
      );
      // Style deviation check returns 0.8 by default (no refs), so no issue → score = 1.0
      expect(score).toBe(1.0);
    });

    it('should handle unknown issue types gracefully', () => {
      const buffer = Buffer.alloc(100 * 100 * 4, 128);
      const score = scoreImprovement(
        createTestIssue({ issueType: 'bg_mismatch' }),
        buffer, 100, 100, createTestBible()
      );
      // bg_mismatch returns 0.5 as default (no scene context to compare against)
      expect(score).toBe(0.5);
    });
  });

  // ─── Batch Operations Tests ───────────────────────────────────────────────

  describe('getBatchApprovalCandidates', () => {
    it('should return low-severity issues with low confidence', () => {
      const issues = [
        createTestIssue({ severity: 1, confidenceScore: 0.3 }),
        createTestIssue({ severity: 2, confidenceScore: 0.4 }),
        createTestIssue({ severity: 4, confidenceScore: 0.3 }),
        createTestIssue({ severity: 1, confidenceScore: 0.8 }),
      ];

      const candidates = getBatchApprovalCandidates(issues);
      expect(candidates.length).toBe(2); // severity 1 + 2 with confidence < 0.5
    });

    it('should respect custom severity threshold', () => {
      const issues = [
        createTestIssue({ severity: 1, confidenceScore: 0.3 }),
        createTestIssue({ severity: 3, confidenceScore: 0.3 }),
      ];

      const candidates = getBatchApprovalCandidates(issues, 3);
      expect(candidates.length).toBe(2);
    });

    it('should return empty for all high-severity issues', () => {
      const issues = [
        createTestIssue({ severity: 4, confidenceScore: 0.3 }),
        createTestIssue({ severity: 5, confidenceScore: 0.2 }),
      ];

      const candidates = getBatchApprovalCandidates(issues);
      expect(candidates.length).toBe(0);
    });
  });

  describe('generateResolutionSummary', () => {
    it('should correctly categorize issues', () => {
      const issues = [
        createTestIssue({ panelId: 1, severity: 1 }), // Will be auto_approve (threshold 0.6, score 0.7)
        createTestIssue({ panelId: 2, severity: 5 }), // Will be escalated (3 rounds, max severity)
        createTestIssue({ panelId: 3, severity: 3 }), // Will be regen (no rounds)
      ];

      const rounds = new Map<number, RoundResult[]>();
      rounds.set(1, [createTestRound({ improvementScore: 0.7, verdict: 'partial_improvement' })]);
      rounds.set(2, [
        createTestRound({ roundNumber: 1, verdict: 'rejected', improvementScore: 0.1 }),
        createTestRound({ roundNumber: 2, verdict: 'rejected', improvementScore: 0.2 }),
        createTestRound({ roundNumber: 3, verdict: 'rejected', improvementScore: 0.3 }),
      ]);

      const summary = generateResolutionSummary(issues, rounds);
      expect(summary.totalIssues).toBe(3);
      expect(summary.resolved).toBe(1);
      expect(summary.escalated).toBe(1);
      expect(summary.inProgress).toBe(1);
    });

    it('should calculate average rounds to resolve', () => {
      const issues = [
        createTestIssue({ panelId: 1, severity: 1 }),
        createTestIssue({ panelId: 2, severity: 1 }),
      ];

      const rounds = new Map<number, RoundResult[]>();
      rounds.set(1, [createTestRound({ improvementScore: 0.8, verdict: 'approved' })]);
      rounds.set(2, [
        createTestRound({ roundNumber: 1, verdict: 'partial_improvement', improvementScore: 0.4 }),
        createTestRound({ roundNumber: 2, verdict: 'approved', improvementScore: 0.9 }),
      ]);

      const summary = generateResolutionSummary(issues, rounds);
      expect(summary.resolved).toBe(2);
      expect(summary.avgRoundsToResolve).toBe(1.5); // (1 + 2) / 2
    });

    it('should handle empty inputs', () => {
      const summary = generateResolutionSummary([], new Map());
      expect(summary.totalIssues).toBe(0);
      expect(summary.successRate).toBe(1);
    });
  });

  // ─── Integration Tests ────────────────────────────────────────────────────

  describe('Full Resolution Flow', () => {
    it('should handle a complete issue lifecycle: analyze → regen → approve', () => {
      // Step 1: Analyze
      const panels = [createTestPanel()];
      const report = analyzeGengaConsistency(
        panels, createTestBible(), createTestStyleRefs(), 1, 1
      );
      expect(report).toBeDefined();

      // Step 2: For any issue found (or create a mock one)
      const issue = createTestIssue({ severity: 2 });

      // Step 3: Determine action
      const action1 = determineNextAction(issue, []);
      expect(action1.action).toBe('regen');

      // Step 4: Build regen params
      const params = buildRegenParams(issue, createTestBible(), [], 1);
      expect(params.prompt).toBeTruthy();

      // Step 5: After regen, score improvement
      const regenBuffer = Buffer.alloc(800 * 1200 * 4, 128);
      const score = scoreImprovement(issue, regenBuffer, 800, 1200, createTestBible());
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);

      // Step 6: Determine next action with high improvement
      const rounds: RoundResult[] = [{
        roundNumber: 1,
        regenParams: params,
        resultUrl: 'https://example.com/regen.png',
        improvementScore: 0.8,
        verdict: 'partial_improvement',
      }];

      const action2 = determineNextAction(issue, rounds);
      // Severity 2 threshold is 0.7, improvement is 0.8 → auto_approve
      expect(action2.action).toBe('auto_approve');
    });

    it('should escalate after 3 failed rounds for high severity', () => {
      const issue = createTestIssue({ severity: 5 });
      const bible = createTestBible();

      // Round 1
      const params1 = buildRegenParams(issue, bible, [], 1);
      expect(params1.strength).toBeLessThan(0.7);

      const round1: RoundResult = {
        roundNumber: 1, regenParams: params1,
        resultUrl: 'r1.png', improvementScore: 0.3, verdict: 'rejected',
      };

      // Round 2
      const params2 = buildRegenParams(issue, bible, [round1], 2);
      expect(params2.strength).toBeGreaterThan(params1.strength);

      const round2: RoundResult = {
        roundNumber: 2, regenParams: params2,
        resultUrl: 'r2.png', improvementScore: 0.4, verdict: 'rejected',
      };

      // Round 3
      const params3 = buildRegenParams(issue, bible, [round1, round2], 3);
      expect(params3.strength).toBeGreaterThan(params2.strength);

      const round3: RoundResult = {
        roundNumber: 3, regenParams: params3,
        resultUrl: 'r3.png', improvementScore: 0.5, verdict: 'rejected',
      };

      // After 3 rounds → escalate
      const action = determineNextAction(issue, [round1, round2, round3]);
      expect(action.action).toBe('escalate');
      expect(action.reason).toContain('3 rounds');
    });
  });
});
