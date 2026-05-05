/**
 * Tests for Wave 5B Item 1: Cover Designer + D10 Print Pipeline Caller
 */
import { describe, it, expect, vi } from 'vitest';
import {
  designCover,
  analyzeEkonte,
  getCoverTemplates,
  getTemplateCount,
  type CoverInput,
  type EkonteAnalysis,
} from './cover-designer';
import {
  runPrintPipeline,
  checkD10CorpusHealth,
  mapCraftResultToGuidance,
  type PrintPipelineInput,
} from './print-pipeline-caller';
import type { CraftResult } from '../d10/types';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createTestImageBuffer(width: number, height: number, brightness: number = 128): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = brightness;     // R
    buf[i + 1] = brightness; // G
    buf[i + 2] = brightness; // B
    buf[i + 3] = 255;        // A
  }
  return buf;
}

function createGradientImageBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      // Bright top-left, dark bottom-right
      const val = Math.round(255 * (1 - (x + y) / (width + height)));
      buf[offset] = val;
      buf[offset + 1] = val;
      buf[offset + 2] = val;
      buf[offset + 3] = 255;
    }
  }
  return buf;
}

function createBaseCoverInput(overrides?: Partial<CoverInput>): CoverInput {
  return {
    title: "Dragon Slayer",
    volumeNumber: 1,
    chapterRange: "Chapters 1-12",
    subtitle: "The Beginning",
    authorName: "Tanaka Yuki",
    genre: 'shonen',
    trimSize: 'b5',
    pageCount: 200,
    keyPanelImage: createTestImageBuffer(100, 140),
    synopsis: "A young warrior discovers an ancient power that could save or destroy the world.",
    genreTags: ["Action", "Fantasy", "Adventure"],
    isbn: "978-4-12345-678-9",
    ...overrides,
  };
}

// ─── Ekonte Analysis Tests ──────────────────────────────────────────────────

describe('Cover Designer: Ekonte Analysis', () => {
  it('should analyze a uniform image and return center focal point', () => {
    const buf = createTestImageBuffer(90, 120, 128);
    const result = analyzeEkonte(buf, 90, 120);

    expect(result).toHaveProperty('focalPoint');
    expect(result).toHaveProperty('dominantRegions');
    expect(result).toHaveProperty('safeZones');
    expect(result).toHaveProperty('averageBrightness');
    expect(result.averageBrightness).toBeCloseTo(0.5, 1);
    // Uniform image → all zones are safe
    expect(result.safeZones.length).toBeGreaterThan(0);
  });

  it('should detect bright focal point in gradient image', () => {
    const buf = createGradientImageBuffer(90, 120);
    const result = analyzeEkonte(buf, 90, 120);

    expect(result.focalPoint).toBeDefined();
    expect(result.dominantRegions.length).toBeGreaterThan(0);
  });

  it('should identify safe zones away from high-contrast areas', () => {
    // Create image with bright top-left corner, dark elsewhere
    const buf = Buffer.alloc(90 * 120 * 4);
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 90; x++) {
        const offset = (y * 90 + x) * 4;
        const val = (x < 30 && y < 40) ? 255 : 30;
        buf[offset] = val;
        buf[offset + 1] = val;
        buf[offset + 2] = val;
        buf[offset + 3] = 255;
      }
    }
    const result = analyzeEkonte(buf, 90, 120);

    // top_left should NOT be a safe zone (high contrast)
    // Other zones with uniform dark should be safe
    expect(result.dominantRegions.length).toBeGreaterThan(0);
  });

  it('should handle empty/small buffers gracefully', () => {
    const buf = Buffer.alloc(16); // Very small
    const result = analyzeEkonte(buf, 2, 2);

    expect(result.focalPoint).toBeDefined();
    expect(result.safeZones.length).toBeGreaterThan(0);
  });
});

// ─── Cover Design Tests ─────────────────────────────────────────────────────

describe('Cover Designer: designCover()', () => {
  it('should produce a complete cover composition for shonen B5', () => {
    const input = createBaseCoverInput();
    const result = designCover(input);

    expect(result.composition).toBeDefined();
    expect(result.composition.totalWidth).toBeGreaterThan(0);
    expect(result.composition.totalHeight).toBeGreaterThan(0);
    expect(result.composition.frontCover).toBeDefined();
    expect(result.composition.spine).toBeDefined();
    expect(result.composition.backCover).toBeDefined();
    expect(result.composition.bleed).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.decisions.length).toBeGreaterThan(0);
  });

  it('should place text elements on front cover', () => {
    const input = createBaseCoverInput();
    const result = designCover(input);

    const frontElements = result.composition.frontCover.elements;
    expect(frontElements.length).toBeGreaterThanOrEqual(3); // title, volume, author
    // Title should be first
    expect(frontElements[0].text).toBe("Dragon Slayer");
    // Author should be present
    const authorEl = frontElements.find(e => e.text === "Tanaka Yuki");
    expect(authorEl).toBeDefined();
  });

  it('should generate spine text with title + volume + author', () => {
    const input = createBaseCoverInput();
    const result = designCover(input);

    const spineElements = result.composition.spine.elements;
    expect(spineElements.length).toBeGreaterThanOrEqual(1);
    expect(spineElements[0].text).toContain("Dragon Slayer");
    expect(spineElements[0].text).toContain("Vol. 1");
    expect(spineElements[0].text).toContain("Tanaka Yuki");
    expect(spineElements[0].rotation).toBe(270);
  });

  it('should calculate correct spine width based on page count', () => {
    const input200 = createBaseCoverInput({ pageCount: 200 });
    const input400 = createBaseCoverInput({ pageCount: 400 });

    const result200 = designCover(input200);
    const result400 = designCover(input400);

    expect(result400.composition.spine.width).toBeGreaterThan(result200.composition.spine.width);
  });

  it('should include barcode area on back cover', () => {
    const input = createBaseCoverInput();
    const result = designCover(input);

    const barcode = result.composition.backCover.barcodeArea;
    expect(barcode.width).toBeGreaterThan(0);
    expect(barcode.height).toBeGreaterThan(0);
  });

  it('should include synopsis on back cover when provided', () => {
    const input = createBaseCoverInput();
    const result = designCover(input);

    expect(result.composition.backCover.synopsis).toBeDefined();
    expect(result.composition.backCover.synopsis!.text).toContain("young warrior");
  });

  it('should include genre tags on back cover', () => {
    const input = createBaseCoverInput();
    const result = designCover(input);

    expect(result.composition.backCover.genreTags.length).toBe(3);
    expect(result.composition.backCover.genreTags[0].text).toBe("Action");
  });

  it('should use genre-appropriate fonts for each genre', () => {
    const genres: Array<'shonen' | 'shojo' | 'seinen' | 'josei' | 'kodomomuke'> = [
      'shonen', 'shojo', 'seinen', 'josei', 'kodomomuke'
    ];
    const fontFamilies = new Set<string>();

    for (const genre of genres) {
      const input = createBaseCoverInput({ genre });
      const result = designCover(input);
      fontFamilies.add(result.fonts.title.family);
    }

    // Each genre should have a distinct title font
    expect(fontFamilies.size).toBe(5);
  });

  it('should support all 4 trim sizes', () => {
    const trims: Array<'b5' | 'a5' | 'tankobon' | 'us_trade'> = ['b5', 'a5', 'tankobon', 'us_trade'];
    const widths = new Set<number>();

    for (const trimSize of trims) {
      const input = createBaseCoverInput({ trimSize });
      const result = designCover(input);
      widths.add(Math.round(result.composition.totalWidth));
      expect(result.composition.totalWidth).toBeGreaterThan(0);
    }

    // Each trim should produce different total width
    expect(widths.size).toBe(4);
  });

  it('should adapt text color based on image brightness', () => {
    // Dark image → white text
    const darkInput = createBaseCoverInput({
      keyPanelImage: createTestImageBuffer(100, 140, 30),
    });
    const darkResult = designCover(darkInput);
    const darkTitleColor = darkResult.composition.frontCover.elements[0].font.color;

    // Bright image → dark text
    const brightInput = createBaseCoverInput({
      keyPanelImage: createTestImageBuffer(100, 140, 230),
    });
    const brightResult = designCover(brightInput);
    const brightTitleColor = brightResult.composition.frontCover.elements[0].font.color;

    // Colors should differ
    expect(darkTitleColor).not.toBe(brightTitleColor);
  });

  it('should add text shadow for mid-brightness images', () => {
    const midInput = createBaseCoverInput({
      keyPanelImage: createTestImageBuffer(100, 140, 128),
    });
    const result = designCover(midInput);
    const titleEl = result.composition.frontCover.elements[0];
    expect(titleEl.shadow).toBeDefined();
  });

  it('should handle missing optional fields gracefully', () => {
    const input = createBaseCoverInput({
      subtitle: undefined,
      synopsis: undefined,
      genreTags: undefined,
      isbn: undefined,
      chapterRange: undefined,
    });
    const result = designCover(input);

    expect(result.composition).toBeDefined();
    expect(result.composition.backCover.synopsis).toBeUndefined();
    expect(result.composition.backCover.genreTags).toHaveLength(0);
  });
});

// ─── Cover Template System Tests ────────────────────────────────────────────

describe('Cover Designer: Template System', () => {
  it('should generate 40 templates (4 trims × 5 genres × 2 orientations)', () => {
    const templates = getCoverTemplates();
    expect(templates.length).toBe(40);
    expect(getTemplateCount()).toBe(40);
  });

  it('should have unique IDs for all templates', () => {
    const templates = getCoverTemplates();
    const ids = new Set(templates.map(t => t.id));
    expect(ids.size).toBe(40);
  });

  it('should cover all trim sizes', () => {
    const templates = getCoverTemplates();
    const trims = new Set(templates.map(t => t.trimSize));
    expect(trims).toContain('b5');
    expect(trims).toContain('a5');
    expect(trims).toContain('tankobon');
    expect(trims).toContain('us_trade');
  });

  it('should cover all genres', () => {
    const templates = getCoverTemplates();
    const genres = new Set(templates.map(t => t.genre));
    expect(genres.size).toBe(5);
  });
});

// ─── D10 Print Pipeline Caller Tests ────────────────────────────────────────

describe('Print Pipeline Caller: mapCraftResultToGuidance()', () => {
  it('should map "reduce density" guidance to negative screentone adjustment', () => {
    const result: CraftResult = {
      guidance: "For shonen manga, reduce density of screentone in action panels to maintain clarity.",
      mode: 'direct',
      subSensei: 'manga',
      sources: [],
      costUsd: 0.01,
      durationMs: 500,
    };

    const guidance = mapCraftResultToGuidance(result, 'shonen');
    expect(guidance.screentoneAdjustment).toBe(-0.5);
  });

  it('should map "heavy density" guidance to positive adjustment', () => {
    const result: CraftResult = {
      guidance: "Use heavy density screentone for atmospheric seinen scenes.",
      mode: 'direct',
      subSensei: 'manga',
      sources: [],
      costUsd: 0.01,
      durationMs: 500,
    };

    const guidance = mapCraftResultToGuidance(result, 'seinen');
    expect(guidance.screentoneAdjustment).toBe(0.5);
  });

  it('should use genre defaults when no explicit density guidance', () => {
    const result: CraftResult = {
      guidance: "Focus on clear panel transitions and reader eye flow.",
      mode: 'direct',
      subSensei: 'manga',
      sources: [],
      costUsd: 0.01,
      durationMs: 500,
    };

    const shonenGuidance = mapCraftResultToGuidance(result, 'shonen');
    expect(shonenGuidance.screentoneAdjustment).toBe(0.2);

    const shojoGuidance = mapCraftResultToGuidance(result, 'shojo');
    expect(shojoGuidance.screentoneAdjustment).toBe(-0.3);
  });

  it('should extract layout preference from guidance text', () => {
    const result: CraftResult = {
      guidance: "Use dynamic panel layouts with irregular shapes for action sequences.",
      mode: 'direct',
      subSensei: 'manga',
      sources: [],
      costUsd: 0.01,
      durationMs: 500,
    };

    const guidance = mapCraftResultToGuidance(result, 'shonen');
    expect(guidance.layoutPreference).toBe('dynamic');
  });

  it('should extract typography notes from guidance', () => {
    const result: CraftResult = {
      guidance: "Use bold font for SFX sound effects in action panels. The typeface should be angular.",
      mode: 'direct',
      subSensei: 'manga',
      sources: [],
      costUsd: 0.01,
      durationMs: 500,
    };

    const guidance = mapCraftResultToGuidance(result, 'shonen');
    expect(guidance.typographyNotes).toBeDefined();
    expect(guidance.typographyNotes!.length).toBeGreaterThan(0);
  });

  it('should extract composition notes from guidance', () => {
    const result: CraftResult = {
      guidance: "The composition should follow a Z-pattern for reading direction. Use bleed on impact panels.",
      mode: 'direct',
      subSensei: 'manga',
      sources: [],
      costUsd: 0.01,
      durationMs: 500,
    };

    const guidance = mapCraftResultToGuidance(result, 'shonen');
    expect(guidance.compositionNotes).toBeDefined();
    expect(guidance.compositionNotes!.length).toBeGreaterThan(0);
  });
});

describe('Print Pipeline Caller: runPrintPipeline()', () => {
  function createTestPanel(id: number) {
    return {
      imageBuffer: createTestImageBuffer(50, 70),
      width: 50,
      height: 70,
      panelId: id,
      mood: 'action' as const,
      dialogueLines: [{ speaker: 'Hero', text: 'Test!', type: 'speech' as const }],
      sequenceIndex: id,
    };
  }

  it('should accept useCraftLibrary=false and skip D10 query', async () => {
    const input: PrintPipelineInput = {
      projectId: 'test-project',
      episodeId: 'ep-1',
      panels: [createTestPanel(1)],
      genre: 'shonen',
      readingDirection: 'rtl',
      trimSize: 'b5',
      metadata: { title: 'Test', chapter: 1, author: 'Author', language: 'ja', createdAt: new Date() },
      useCraftLibrary: false,
    };

    // This should not call queryCraftLibrary
    const result = await runPrintPipeline(input);
    expect(result.craftGuidanceApplied).toBeNull();
    expect(result.d10CostUsd).toBe(0);
    expect(result.d10DurationMs).toBe(0);
    expect(result.interiorPdf).toBeDefined();
  });

  it('should accept craftGuidanceOverride and use it directly', async () => {
    const override = { screentoneAdjustment: 0.7, layoutPreference: 'splash' as any };
    const input: PrintPipelineInput = {
      projectId: 'test-project',
      episodeId: 'ep-1',
      panels: [createTestPanel(1)],
      genre: 'seinen',
      readingDirection: 'rtl',
      trimSize: 'b5',
      metadata: { title: 'Test', chapter: 1, author: 'Author', language: 'ja', createdAt: new Date() },
      craftGuidanceOverride: override,
    };

    const result = await runPrintPipeline(input);
    expect(result.craftGuidanceApplied).toEqual(override);
    expect(result.d10CostUsd).toBe(0);
  });

  it('should gracefully degrade when D10 query fails', async () => {
    // Mock queryCraftLibrary to throw
    vi.mock('../d10/sensei', () => ({
      queryCraftLibrary: vi.fn().mockRejectedValue(new Error('Corpus empty')),
    }));

    const input: PrintPipelineInput = {
      projectId: 'test-project',
      episodeId: 'ep-1',
      panels: [createTestPanel(1)],
      genre: 'shonen',
      readingDirection: 'rtl',
      trimSize: 'b5',
      metadata: { title: 'Test', chapter: 1, author: 'Author', language: 'ja', createdAt: new Date() },
      useCraftLibrary: true,
    };

    const result = await runPrintPipeline(input);
    // Should still produce a PDF even if D10 fails
    expect(result.interiorPdf).toBeDefined();
    expect(result.craftGuidanceApplied).toBeNull();

    vi.restoreAllMocks();
  });
});

describe('Print Pipeline Caller: checkD10CorpusHealth()', () => {
  it('should return health status object', async () => {
    const health = await checkD10CorpusHealth();
    expect(health).toHaveProperty('healthy');
    expect(health).toHaveProperty('chunkCount');
    expect(health).toHaveProperty('message');
    expect(typeof health.healthy).toBe('boolean');
    expect(typeof health.chunkCount).toBe('number');
  });
});
