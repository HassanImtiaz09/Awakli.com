/**
 * D9 Wiring Closure Tests
 *
 * Verifies that D9 Sakufuu functions are properly wired into the pipeline orchestrator.
 * These tests confirm the import exists and the functions are callable from the orchestrator context.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('D9 Wiring Closure', () => {
  const orchestratorPath = resolve(__dirname, '../../pipelineOrchestrator.ts');
  const orchestratorSource = readFileSync(orchestratorPath, 'utf-8');

  describe('Import verification', () => {
    it('should import injectSakufuuBias from sakufuu-pipeline', () => {
      expect(orchestratorSource).toContain('import { injectSakufuuBias, recordSakufuuMemory }');
      expect(orchestratorSource).toContain('./benchmarks/d9-sakufuu/sakufuu-pipeline');
    });

    it('should import SakufuuBias type from sakufuu-tracker', () => {
      expect(orchestratorSource).toContain('import type { SakufuuBias }');
      expect(orchestratorSource).toContain('./benchmarks/d9-sakufuu/sakufuu-tracker');
    });
  });

  describe('Pre-generation injection (Stage 2)', () => {
    it('should call injectSakufuuBias before video_gen node', () => {
      const biasInjectionIdx = orchestratorSource.indexOf('injectSakufuuBias({');
      const videoGenIdx = orchestratorSource.indexOf('await videoGenAgent(runId');
      expect(biasInjectionIdx).toBeGreaterThan(-1);
      expect(videoGenIdx).toBeGreaterThan(-1);
      expect(biasInjectionIdx).toBeLessThan(videoGenIdx);
    });

    it('should pass pipelineRunId, episodeId, and projectId to injectSakufuuBias', () => {
      expect(orchestratorSource).toContain('pipelineRunId: runId');
      expect(orchestratorSource).toContain('episodeId: run.episodeId');
      expect(orchestratorSource).toContain('projectId: run.projectId');
    });

    it('should store the bias result for later use', () => {
      expect(orchestratorSource).toContain('let sakufuuBias: SakufuuBias | null = null');
      expect(orchestratorSource).toContain('sakufuuBias = sakufuuResult.bias');
    });

    it('should handle D9 injection failure gracefully (try/catch)', () => {
      // Find the try block around injectSakufuuBias
      const biasSection = orchestratorSource.substring(
        orchestratorSource.indexOf('D9 Sakufuu: Pre-Generation Bias Injection'),
        orchestratorSource.indexOf('Node 1: Video Generation')
      );
      expect(biasSection).toContain('try {');
      expect(biasSection).toContain('catch (d9Err)');
      expect(biasSection).toContain('continuing without bias');
    });

    it('should log bias details when active', () => {
      expect(orchestratorSource).toContain('D9 Sakufuu bias injected');
      expect(orchestratorSource).toContain('signatureFx=');
      expect(orchestratorSource).toContain('confidence=');
    });

    it('should log no-op for episode 1', () => {
      expect(orchestratorSource).toContain('Episode 1 or no prior data');
    });
  });

  describe('Post-assembly recording (Stage 16+)', () => {
    it('should call recordSakufuuMemory after assembly completes', () => {
      const assemblyCompleteIdx = orchestratorSource.indexOf('await updateNodeProgress(runId, "assembly", "complete", nodeStatuses, 100');
      const recordMemoryIdx = orchestratorSource.indexOf('recordSakufuuMemory({');
      expect(assemblyCompleteIdx).toBeGreaterThan(-1);
      expect(recordMemoryIdx).toBeGreaterThan(-1);
      expect(recordMemoryIdx).toBeGreaterThan(assemblyCompleteIdx);
    });

    it('should pass fxResults from sakufuuBias signatureFx', () => {
      expect(orchestratorSource).toContain('fxResults: sakufuuBias?.active ? sakufuuBias.signatureFx.map');
    });

    it('should handle post-assembly recording failure gracefully', () => {
      const postSection = orchestratorSource.substring(
        orchestratorSource.indexOf('D9 Sakufuu: Post-Assembly Memory Recording'),
        orchestratorSource.indexOf('Mark as completed, move to QA review')
      );
      expect(postSection).toContain('try {');
      expect(postSection).toContain('catch (d9PostErr)');
      expect(postSection).toContain('post-assembly recording failed');
    });

    it('should log memory recording results', () => {
      expect(orchestratorSource).toContain('D9 Sakufuu memory recorded');
      expect(orchestratorSource).toContain('profileUpdated=');
    });
  });

  describe('Bias data flow to downstream stages', () => {
    it('should have sakufuuBias accessible in scope for D7 FX compositor', () => {
      // sakufuuBias is declared before the assemblyAgent *call* (not the function definition)
      const biasDeclarationIdx = orchestratorSource.indexOf('let sakufuuBias: SakufuuBias | null = null');
      const assemblyCallIdx = orchestratorSource.indexOf('totalCost = await assemblyAgent(');
      expect(biasDeclarationIdx).toBeGreaterThan(-1);
      expect(assemblyCallIdx).toBeGreaterThan(-1);
      expect(biasDeclarationIdx).toBeLessThan(assemblyCallIdx);
    });

    it('should expose signatureFx for D7 consumption', () => {
      // The bias object contains signatureFx which D7 can read
      expect(orchestratorSource).toContain('sakufuuBias.signatureFx');
    });
  });

  describe('Functional verification of D9 modules', () => {
    it('should be able to import injectSakufuuBias', async () => {
      const { injectSakufuuBias } = await import('./sakufuu-pipeline');
      expect(typeof injectSakufuuBias).toBe('function');
    });

    it('should be able to import recordSakufuuMemory', async () => {
      const { recordSakufuuMemory } = await import('./sakufuu-pipeline');
      expect(typeof recordSakufuuMemory).toBe('function');
    });

    it('injectSakufuuBias should return bias structure', async () => {
      const { injectSakufuuBias } = await import('./sakufuu-pipeline');
      const result = await injectSakufuuBias({
        pipelineRunId: 999,
        episodeId: 1,
        projectId: 1,
      });
      expect(result).toHaveProperty('bias');
      expect(result).toHaveProperty('episodeNumber');
      expect(result).toHaveProperty('priorEpisodeCount');
      expect(result.bias).toHaveProperty('active');
      expect(result.bias).toHaveProperty('signatureFx');
      expect(result.bias).toHaveProperty('suggestedPalette');
      expect(result.bias).toHaveProperty('voiceTargets');
      expect(result.bias).toHaveProperty('suggestedPacing');
      expect(result.bias).toHaveProperty('confidence');
    });

    it('recordSakufuuMemory should return recording confirmation', async () => {
      const { recordSakufuuMemory } = await import('./sakufuu-pipeline');
      const result = await recordSakufuuMemory({
        pipelineRunId: 999,
        episodeId: 1,
        projectId: 1,
      });
      expect(result).toHaveProperty('memoryRecorded');
      expect(result).toHaveProperty('profileUpdated');
      expect(result).toHaveProperty('episodeNumber');
      expect(result).toHaveProperty('confidence');
    });
  });
});
