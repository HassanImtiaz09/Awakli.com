/**
 * Tests for Image Upscaling Pipeline (Wave 5C Item 2)
 *
 * Covers:
 * 1. UpscaleProvider interface contract
 * 2. DPI detection module (analyzePanelDpi, batchAnalyzeDpi)
 * 3. Auto-flag logic (autoFlagPanelsForUpscale)
 * 4. Quality scoring (estimateUpscaleQuality)
 * 5. Print pipeline integration (runUpscalePipeline)
 * 6. Admin DPI dashboard helpers (buildDpiCoverageDashboard)
 * 7. Constants and configuration
 */

import { describe, it, expect, vi } from "vitest";
import {
  PRINT_DPI_THRESHOLD,
  WEB_DPI_THRESHOLD,
  MAX_UPSCALE_FACTOR,
  UPSCALE_MODELS,
  DEFAULT_UPSCALE_MODEL,
  MANGA_PRINT_SIZES,
  QUALITY_THRESHOLDS,
  analyzePanelDpi,
  batchAnalyzeDpi,
  autoFlagPanelsForUpscale,
  estimateUpscaleQuality,
  buildDpiCoverageDashboard,
  runUpscalePipeline,
  RealESRGANProvider,
  type UpscaleProvider,
  type DpiAnalysis,
  type DpiSummary,
  type QualityScore,
  type ProjectDpiStatus,
  type UpscaleRequest,
  type UpscaleResult,
  type UpscaleJobStatus,
  type AutoFlagResult,
} from "./upscale-pipeline";

// ─── Constants & Configuration ──────────────────────────────────────────────────

describe("Upscale Pipeline - Constants", () => {
  it("PRINT_DPI_THRESHOLD should be 300", () => {
    expect(PRINT_DPI_THRESHOLD).toBe(300);
  });

  it("WEB_DPI_THRESHOLD should be 72", () => {
    expect(WEB_DPI_THRESHOLD).toBe(72);
  });

  it("MAX_UPSCALE_FACTOR should be 4", () => {
    expect(MAX_UPSCALE_FACTOR).toBe(4);
  });

  it("DEFAULT_UPSCALE_MODEL should be real-esrgan-anime", () => {
    expect(DEFAULT_UPSCALE_MODEL).toBe("real-esrgan-anime");
  });

  it("UPSCALE_MODELS should have both x4 and anime variants", () => {
    expect(UPSCALE_MODELS["real-esrgan-x4"]).toBeDefined();
    expect(UPSCALE_MODELS["real-esrgan-anime"]).toBeDefined();
    expect(UPSCALE_MODELS["real-esrgan-x4"].maxFactor).toBe(4);
    expect(UPSCALE_MODELS["real-esrgan-anime"].maxFactor).toBe(4);
  });

  it("UPSCALE_MODELS should have Replicate model references", () => {
    Object.values(UPSCALE_MODELS).forEach(model => {
      expect(model.replicateModel).toContain(":");
      expect(model.costPerImageCents).toBeGreaterThan(0);
    });
  });

  it("MANGA_PRINT_SIZES should include B5 and US_COMIC", () => {
    expect(MANGA_PRINT_SIZES.B5).toBeDefined();
    expect(MANGA_PRINT_SIZES.A5).toBeDefined();
    expect(MANGA_PRINT_SIZES.US_COMIC).toBeDefined();
    expect(MANGA_PRINT_SIZES.DIGEST).toBeDefined();
  });

  it("B5 dimensions should be correct for tankōbon format", () => {
    const b5 = MANGA_PRINT_SIZES.B5;
    expect(b5.widthInches).toBeCloseTo(6.93, 1);
    expect(b5.heightInches).toBeCloseTo(9.84, 1);
  });
});

// ─── DPI Detection Module ───────────────────────────────────────────────────────

describe("Upscale Pipeline - DPI Detection", () => {
  it("analyzePanelDpi should detect panels below print threshold", () => {
    // 512x768 panel at B5 half-page → DPI = 512 / 6.93 ≈ 73.9
    const analysis = analyzePanelDpi(1, 512, 768, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis.panelId).toBe(1);
    expect(analysis.sourceWidth).toBe(512);
    expect(analysis.sourceHeight).toBe(768);
    expect(analysis.effectiveDpi).toBeLessThan(PRINT_DPI_THRESHOLD);
    expect(analysis.meetsPrintDpi).toBe(false);
    expect(analysis.requiredUpscaleFactor).toBeGreaterThan(1);
  });

  it("analyzePanelDpi should detect panels meeting print threshold", () => {
    // 2048x3072 panel at B5 half-page → DPI = 2048 / 6.93 ≈ 295.5
    const analysis = analyzePanelDpi(2, 2048, 3072, MANGA_PRINT_SIZES.B5, 0.5);
    // This might still be slightly below 300, let's check
    // Actually 2048/6.93 = 295.5 which is below 300
    // Need 2080+ pixels for B5 width at 300 DPI
    const analysis2 = analyzePanelDpi(3, 2100, 3150, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis2.effectiveDpi).toBeGreaterThanOrEqual(PRINT_DPI_THRESHOLD);
    expect(analysis2.meetsPrintDpi).toBe(true);
    expect(analysis2.recommendedUpscaleFactor).toBe(1);
  });

  it("analyzePanelDpi should recommend 4x for moderate DPI deficit (ceil rounds up)", () => {
    // 1024x1536 panel → DPI = 1024 / 6.93 ≈ 147.8 (needs ceil(300/147.8)=3 → rounds to 4)
    const analysis = analyzePanelDpi(4, 1024, 1536, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis.effectiveDpi).toBeGreaterThan(100);
    expect(analysis.effectiveDpi).toBeLessThan(200);
    expect(analysis.recommendedUpscaleFactor).toBe(4);
  });

  it("analyzePanelDpi should recommend 2x when factor is exactly 2", () => {
    // Need DPI where ceil(300/dpi) = 2 → dpi between 150 and 300
    // 1050x1575 → DPI = 1050/6.93 ≈ 151.5, ceil(300/151.5) = 2
    const analysis = analyzePanelDpi(4, 1050, 1575, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis.effectiveDpi).toBeGreaterThan(150);
    expect(analysis.recommendedUpscaleFactor).toBe(2);
  });

  it("analyzePanelDpi should recommend 4x for severe DPI deficit", () => {
    // 512x768 panel → DPI = 512 / 6.93 ≈ 73.9 (needs 4x+ to reach 300)
    const analysis = analyzePanelDpi(5, 512, 768, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis.effectiveDpi).toBeLessThan(100);
    expect(analysis.recommendedUpscaleFactor).toBe(4);
  });

  it("analyzePanelDpi should use minimum of horizontal and vertical DPI", () => {
    // Wide panel: 1024x256 → horizontal DPI = 1024/6.93 ≈ 147.8, vertical DPI = 256/4.92 ≈ 52
    const analysis = analyzePanelDpi(6, 1024, 256, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis.effectiveDpi).toBeLessThan(60); // Should use the lower vertical DPI
  });

  it("batchAnalyzeDpi should separate compliant and non-compliant panels", () => {
    const panels = [
      { panelId: 1, width: 512, height: 768 },   // Below threshold
      { panelId: 2, width: 2100, height: 3150 },  // Above threshold
      { panelId: 3, width: 1024, height: 1536 },  // Below threshold
    ];

    const result = batchAnalyzeDpi(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(result.analyses.length).toBe(3);
    expect(result.needsUpscale.length).toBeGreaterThanOrEqual(2);
    expect(result.compliant.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalPanels).toBe(3);
    expect(result.summary.complianceRate).toBeGreaterThan(0);
    expect(result.summary.complianceRate).toBeLessThan(1);
  });

  it("batchAnalyzeDpi should sort needsUpscale by lowest DPI first", () => {
    const panels = [
      { panelId: 1, width: 1024, height: 1536 },  // ~148 DPI
      { panelId: 2, width: 512, height: 768 },     // ~74 DPI
      { panelId: 3, width: 768, height: 1152 },    // ~111 DPI
    ];

    const result = batchAnalyzeDpi(panels, MANGA_PRINT_SIZES.B5, 0.5);
    const dpis = result.needsUpscale.map(a => a.effectiveDpi);
    for (let i = 1; i < dpis.length; i++) {
      expect(dpis[i]).toBeGreaterThanOrEqual(dpis[i - 1]);
    }
  });

  it("batchAnalyzeDpi summary should include cost estimate", () => {
    const panels = [
      { panelId: 1, width: 512, height: 768 },
      { panelId: 2, width: 512, height: 768 },
    ];

    const result = batchAnalyzeDpi(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(result.summary.estimatedUpscaleCostCents).toBe(
      result.needsUpscale.length * UPSCALE_MODELS[DEFAULT_UPSCALE_MODEL].costPerImageCents
    );
  });

  it("batchAnalyzeDpi should handle empty panel list", () => {
    const result = batchAnalyzeDpi([], MANGA_PRINT_SIZES.B5);
    expect(result.analyses.length).toBe(0);
    expect(result.needsUpscale.length).toBe(0);
    expect(result.compliant.length).toBe(0);
    expect(result.summary.totalPanels).toBe(0);
    expect(result.summary.complianceRate).toBe(1);
  });
});

// ─── Auto-Flag Logic ────────────────────────────────────────────────────────────

describe("Upscale Pipeline - Auto-Flag Logic", () => {
  it("should not flag panels meeting DPI threshold", () => {
    const panels = [{ panelId: 1, width: 2100, height: 3150 }];
    const flags = autoFlagPanelsForUpscale(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(flags[0].flagged).toBe(false);
    expect(flags[0].recommendedAction).toBe("none");
  });

  it("should flag panels below threshold with upscale recommendation", () => {
    // 1024x1536 → DPI ≈ 147.8, ceil(300/147.8)=3 → recommended 4x
    const panels = [{ panelId: 1, width: 1024, height: 1536 }];
    const flags = autoFlagPanelsForUpscale(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(flags[0].flagged).toBe(true);
    expect(flags[0].recommendedAction).toBe("upscale_4x");
  });

  it("should recommend regeneration for extremely low DPI panels", () => {
    // Very small panel: 128x192 → DPI ≈ 18.5 (below 75 minimum viable)
    const panels = [{ panelId: 1, width: 128, height: 192 }];
    const flags = autoFlagPanelsForUpscale(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(flags[0].flagged).toBe(true);
    expect(flags[0].recommendedAction).toBe("regenerate");
    expect(flags[0].reason).toContain("too low");
  });

  it("should recommend regeneration for 512x768 panels (DPI < 75 min viable)", () => {
    // 512x768 → DPI ≈ 73.88 which is below MIN_VIABLE_DPI (75)
    const panels = [{ panelId: 1, width: 512, height: 768 }];
    const flags = autoFlagPanelsForUpscale(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(flags[0].flagged).toBe(true);
    expect(flags[0].recommendedAction).toBe("regenerate");
  });

  it("should recommend upscale_4x for panels above min viable but needing 4x", () => {
    // 600x900 → DPI = 600/6.93 ≈ 86.6 (above 75 min viable, needs 4x)
    const panels = [{ panelId: 1, width: 600, height: 900 }];
    const flags = autoFlagPanelsForUpscale(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(flags[0].flagged).toBe(true);
    expect(flags[0].recommendedAction).toBe("upscale_4x");
  });

  it("should include DPI value in flag reason", () => {
    // Use 1050x1575 which gives DPI ~151.5 (above 75 min viable, needs upscale)
    const panels = [{ panelId: 1, width: 1050, height: 1575 }];
    const flags = autoFlagPanelsForUpscale(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(flags[0].reason).toContain("DPI");
    expect(flags[0].reason).toContain("300");
  });

  it("should handle batch of mixed panels correctly", () => {
    const panels = [
      { panelId: 1, width: 2100, height: 3150 },  // Compliant (DPI > 300)
      { panelId: 2, width: 1050, height: 1575 },  // Needs 2x (DPI ~151.5, ceil(300/151.5)=2)
      { panelId: 3, width: 600, height: 900 },    // Needs 4x (DPI ~86.6, ceil(300/86.6)=4)
      { panelId: 4, width: 128, height: 192 },    // Regenerate (DPI ~18.5 < 75)
    ];

    const flags = autoFlagPanelsForUpscale(panels, MANGA_PRINT_SIZES.B5, 0.5);
    expect(flags[0].recommendedAction).toBe("none");
    expect(flags[1].recommendedAction).toBe("upscale_2x");
    expect(flags[2].recommendedAction).toBe("upscale_4x");
    expect(flags[3].recommendedAction).toBe("regenerate");
  });
});

// ─── Quality Scoring ────────────────────────────────────────────────────────────

describe("Upscale Pipeline - Quality Scoring", () => {
  it("should rate higher quality for higher source DPI", () => {
    const lowDpi = estimateUpscaleQuality(75, 4);
    const highDpi = estimateUpscaleQuality(200, 4);
    expect(highDpi.ssim).toBeGreaterThan(lowDpi.ssim);
  });

  it("should rate higher quality for 2x vs 4x upscaling", () => {
    const x2 = estimateUpscaleQuality(150, 2);
    const x4 = estimateUpscaleQuality(150, 4);
    expect(x2.ssim).toBeGreaterThan(x4.ssim);
  });

  it("should give anime model a slight bonus", () => {
    const generic = estimateUpscaleQuality(150, 4, "real-esrgan-x4");
    const anime = estimateUpscaleQuality(150, 4, "real-esrgan-anime");
    expect(anime.ssim).toBeGreaterThan(generic.ssim);
  });

  it("should assign correct quality ratings", () => {
    // High source DPI + 2x = excellent/good
    const excellent = estimateUpscaleQuality(280, 2, "real-esrgan-anime");
    expect(["excellent", "good"]).toContain(excellent.rating);

    // Low source DPI + 4x = acceptable/poor
    const poor = estimateUpscaleQuality(75, 4, "real-esrgan-x4");
    expect(["acceptable", "poor"]).toContain(poor.rating);
  });

  it("SSIM should be between 0 and 1", () => {
    const testCases = [
      { dpi: 50, scale: 4 as const },
      { dpi: 150, scale: 2 as const },
      { dpi: 280, scale: 2 as const },
    ];

    testCases.forEach(({ dpi, scale }) => {
      const score = estimateUpscaleQuality(dpi, scale);
      expect(score.ssim).toBeGreaterThanOrEqual(0);
      expect(score.ssim).toBeLessThanOrEqual(1);
    });
  });

  it("PSNR should be positive and correlated with SSIM", () => {
    const low = estimateUpscaleQuality(75, 4);
    const high = estimateUpscaleQuality(280, 2);
    expect(low.psnr).toBeGreaterThan(0);
    expect(high.psnr).toBeGreaterThan(low.psnr);
  });

  it("meetsThreshold should use QUALITY_THRESHOLDS.acceptable", () => {
    expect(QUALITY_THRESHOLDS.acceptable).toBe(0.75);
    const score = estimateUpscaleQuality(200, 2);
    expect(score.meetsThreshold).toBe(score.ssim >= QUALITY_THRESHOLDS.acceptable);
  });
});

// ─── Admin DPI Dashboard ────────────────────────────────────────────────────────

describe("Upscale Pipeline - Admin DPI Dashboard", () => {
  it("buildDpiCoverageDashboard should compute global summary", () => {
    const statuses: ProjectDpiStatus[] = [
      {
        projectId: 1,
        projectName: "Project A",
        totalPanels: 20,
        compliantPanels: 15,
        needsUpscalePanels: 5,
        complianceRate: 0.75,
        averageDpi: 250,
        lowestDpi: 74,
        estimatedUpscaleCostCents: 10,
      },
      {
        projectId: 2,
        projectName: "Project B",
        totalPanels: 10,
        compliantPanels: 10,
        needsUpscalePanels: 0,
        complianceRate: 1.0,
        averageDpi: 350,
        lowestDpi: 310,
        estimatedUpscaleCostCents: 0,
      },
    ];

    const dashboard = buildDpiCoverageDashboard(statuses);
    expect(dashboard.globalSummary.totalProjects).toBe(2);
    expect(dashboard.globalSummary.totalPanels).toBe(30);
    expect(dashboard.globalSummary.globalComplianceRate).toBeCloseTo(25 / 30, 4);
    expect(dashboard.globalSummary.totalEstimatedCostCents).toBe(10);
    expect(dashboard.globalSummary.projectsFullyCompliant).toBe(1);
    expect(dashboard.globalSummary.projectsNeedingUpscale).toBe(1);
  });

  it("should sort projects by compliance rate (lowest first)", () => {
    const statuses: ProjectDpiStatus[] = [
      { projectId: 1, projectName: "High", totalPanels: 10, compliantPanels: 9, needsUpscalePanels: 1, complianceRate: 0.9, averageDpi: 280, lowestDpi: 150, estimatedUpscaleCostCents: 2 },
      { projectId: 2, projectName: "Low", totalPanels: 10, compliantPanels: 3, needsUpscalePanels: 7, complianceRate: 0.3, averageDpi: 150, lowestDpi: 74, estimatedUpscaleCostCents: 14 },
      { projectId: 3, projectName: "Mid", totalPanels: 10, compliantPanels: 6, needsUpscalePanels: 4, complianceRate: 0.6, averageDpi: 200, lowestDpi: 100, estimatedUpscaleCostCents: 8 },
    ];

    const dashboard = buildDpiCoverageDashboard(statuses);
    expect(dashboard.projects[0].projectName).toBe("Low");
    expect(dashboard.projects[1].projectName).toBe("Mid");
    expect(dashboard.projects[2].projectName).toBe("High");
  });

  it("should handle empty project list", () => {
    const dashboard = buildDpiCoverageDashboard([]);
    expect(dashboard.globalSummary.totalProjects).toBe(0);
    expect(dashboard.globalSummary.totalPanels).toBe(0);
    expect(dashboard.globalSummary.globalComplianceRate).toBe(1);
  });
});

// ─── UpscaleProvider Interface Contract ─────────────────────────────────────────

describe("Upscale Pipeline - Provider Interface", () => {
  it("RealESRGANProvider should implement UpscaleProvider interface", () => {
    const provider = new RealESRGANProvider("test-token");
    expect(provider.name).toBe("real-esrgan");
    expect(typeof provider.submitUpscale).toBe("function");
    expect(typeof provider.getJobStatus).toBe("function");
    expect(typeof provider.cancelJob).toBe("function");
    expect(typeof provider.getOutputUrl).toBe("function");
  });

  it("Mock provider should satisfy UpscaleProvider interface", () => {
    const mockProvider: UpscaleProvider = {
      name: "mock",
      submitUpscale: async (req) => ({ jobId: "mock-1", estimatedCostCents: 2 }),
      getJobStatus: async (id) => ({ status: "completed", outputUrl: "https://example.com/upscaled.png", progress: 100 }),
      cancelJob: async (id) => {},
      getOutputUrl: async (id) => "https://example.com/upscaled.png",
    };

    expect(mockProvider.name).toBe("mock");
  });
});

// ─── Print Pipeline Integration ─────────────────────────────────────────────────

describe("Upscale Pipeline - Print Pipeline Integration", () => {
  it("runUpscalePipeline should skip compliant panels", async () => {
    const mockProvider: UpscaleProvider = {
      name: "mock",
      submitUpscale: vi.fn().mockResolvedValue({ jobId: "j1", estimatedCostCents: 2 }),
      getJobStatus: vi.fn().mockResolvedValue({ status: "completed", outputUrl: "https://out.png", progress: 100 }),
      cancelJob: vi.fn(),
      getOutputUrl: vi.fn().mockResolvedValue("https://out.png"),
    };

    const result = await runUpscalePipeline({
      panels: [
        { panelId: 1, imageUrl: "https://img.png", width: 2100, height: 3150 }, // Compliant
      ],
      printSize: MANGA_PRINT_SIZES.B5,
      panelFraction: 0.5,
    }, mockProvider);

    expect(result.results[0].action).toBe("skipped");
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.upscaled).toBe(0);
    expect(mockProvider.submitUpscale).not.toHaveBeenCalled();
  });

  it("runUpscalePipeline should upscale non-compliant panels", async () => {
    const mockProvider: UpscaleProvider = {
      name: "mock",
      submitUpscale: vi.fn().mockResolvedValue({ jobId: "j1", estimatedCostCents: 2 }),
      getJobStatus: vi.fn().mockResolvedValue({ status: "completed", outputUrl: "https://upscaled.png", progress: 100 }),
      cancelJob: vi.fn(),
      getOutputUrl: vi.fn().mockResolvedValue("https://upscaled.png"),
    };

    const result = await runUpscalePipeline({
      panels: [
        { panelId: 1, imageUrl: "https://img.png", width: 1024, height: 1536 }, // Needs 2x
      ],
      printSize: MANGA_PRINT_SIZES.B5,
      panelFraction: 0.5,
    }, mockProvider);

    expect(result.results[0].action).toBe("upscaled");
    expect(result.results[0].upscaledUrl).toBe("https://upscaled.png");
    expect(result.summary.upscaled).toBe(1);
    expect(mockProvider.submitUpscale).toHaveBeenCalledTimes(1);
  });

  it("runUpscalePipeline should flag for regeneration if quality too low", async () => {
    const mockProvider: UpscaleProvider = {
      name: "mock",
      submitUpscale: vi.fn(),
      getJobStatus: vi.fn(),
      cancelJob: vi.fn(),
      getOutputUrl: vi.fn(),
    };

    const result = await runUpscalePipeline({
      panels: [
        { panelId: 1, imageUrl: "https://img.png", width: 128, height: 192 }, // Way too small
      ],
      printSize: MANGA_PRINT_SIZES.B5,
      panelFraction: 0.5,
      skipPoorQuality: true,
    }, mockProvider);

    expect(result.results[0].action).toBe("flagged_regenerate");
    expect(result.summary.flaggedForRegeneration).toBe(1);
    expect(mockProvider.submitUpscale).not.toHaveBeenCalled();
  });

  it("runUpscalePipeline should handle provider failures gracefully", async () => {
    const mockProvider: UpscaleProvider = {
      name: "mock",
      submitUpscale: vi.fn().mockResolvedValue({ jobId: "j1", estimatedCostCents: 2 }),
      getJobStatus: vi.fn().mockResolvedValue({ status: "failed", error: "GPU OOM" }),
      cancelJob: vi.fn(),
      getOutputUrl: vi.fn(),
    };

    const result = await runUpscalePipeline({
      panels: [
        { panelId: 1, imageUrl: "https://img.png", width: 1024, height: 1536 },
      ],
      printSize: MANGA_PRINT_SIZES.B5,
      panelFraction: 0.5,
    }, mockProvider);

    expect(result.results[0].action).toBe("flagged_regenerate");
  });

  it("runUpscalePipeline summary should track costs correctly", async () => {
    const mockProvider: UpscaleProvider = {
      name: "mock",
      submitUpscale: vi.fn().mockResolvedValue({ jobId: "j1", estimatedCostCents: 2 }),
      getJobStatus: vi.fn().mockResolvedValue({ status: "completed", outputUrl: "https://out.png", progress: 100 }),
      cancelJob: vi.fn(),
      getOutputUrl: vi.fn(),
    };

    const result = await runUpscalePipeline({
      panels: [
        { panelId: 1, imageUrl: "https://a.png", width: 1024, height: 1536 },
        { panelId: 2, imageUrl: "https://b.png", width: 1024, height: 1536 },
        { panelId: 3, imageUrl: "https://c.png", width: 2100, height: 3150 }, // Compliant
      ],
      printSize: MANGA_PRINT_SIZES.B5,
      panelFraction: 0.5,
    }, mockProvider);

    expect(result.summary.totalPanels).toBe(3);
    expect(result.summary.upscaled).toBe(2);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.totalCostCents).toBe(4); // 2 panels * 2 cents
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────────

describe("Upscale Pipeline - Edge Cases", () => {
  it("analyzePanelDpi should handle 1x1 pixel panel", () => {
    const analysis = analyzePanelDpi(1, 1, 1, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis.effectiveDpi).toBeLessThan(1);
    expect(analysis.meetsPrintDpi).toBe(false);
    expect(analysis.recommendedUpscaleFactor).toBe(4);
  });

  it("analyzePanelDpi should handle very large panels", () => {
    // 8192x12288 → DPI = 8192 / 6.93 ≈ 1182
    const analysis = analyzePanelDpi(1, 8192, 12288, MANGA_PRINT_SIZES.B5, 0.5);
    expect(analysis.meetsPrintDpi).toBe(true);
    expect(analysis.recommendedUpscaleFactor).toBe(1);
  });

  it("analyzePanelDpi should work with different print sizes", () => {
    const b5 = analyzePanelDpi(1, 512, 768, MANGA_PRINT_SIZES.B5, 0.5);
    const a5 = analyzePanelDpi(1, 512, 768, MANGA_PRINT_SIZES.A5, 0.5);
    // A5 is smaller → same pixel count gives higher DPI
    expect(a5.effectiveDpi).toBeGreaterThan(b5.effectiveDpi);
  });

  it("analyzePanelDpi should work with different panel fractions", () => {
    // For 512x768 at B5: horizontal DPI = 512/6.93 = 73.88 (width-limited)
    // Changing fraction only affects vertical target, so if width is limiting, DPI stays same
    // Use a tall narrow panel where vertical is limiting instead
    const half = analyzePanelDpi(1, 2100, 400, MANGA_PRINT_SIZES.B5, 0.5);
    const quarter = analyzePanelDpi(1, 2100, 400, MANGA_PRINT_SIZES.B5, 0.25);
    // For tall panels: vertical DPI = 400/(9.84*0.5)=81.3 vs 400/(9.84*0.25)=162.6
    // quarter has smaller target height → higher vertical DPI
    expect(quarter.effectiveDpi).toBeGreaterThan(half.effectiveDpi);
  });

  it("estimateUpscaleQuality should handle edge DPI values", () => {
    const veryLow = estimateUpscaleQuality(10, 4);
    const atThreshold = estimateUpscaleQuality(300, 2);
    expect(veryLow.ssim).toBeGreaterThanOrEqual(0);
    expect(atThreshold.ssim).toBeLessThanOrEqual(1);
  });
});
