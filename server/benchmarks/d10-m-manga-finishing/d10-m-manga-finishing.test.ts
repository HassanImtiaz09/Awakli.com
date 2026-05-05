/**
 * D10.M Manga Finishing Agent — Integration Tests
 *
 * Tests all 4 sub-modules + orchestrator:
 * - screentone-engine.ts (pattern generation, config resolution, compositing)
 * - bubble-renderer.ts (layout, rendering, batch)
 * - page-compositor.ts (trim specs, layouts, composition)
 * - pdf-generator.ts (validation, spine calc, PDF generation, Lulu package ID)
 * - manga-finishing-agent.ts (full pipeline orchestration)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ─── Screentone Engine Tests ──────────────────────────────────────────────────

import {
  generateAmiTen,
  generateKakeAmi,
  generateSunaMe,
  generateGradation,
  resolveScreentoneConfig,
  generatePatternBuffer,
  compositeScreentone,
  applyScreentone,
  batchApplyScreentone,
  GENRE_PATTERN_DEFAULTS,
  MOOD_PATTERN_MAP,
} from './screentone-engine';

describe('D10.M Screentone Engine', () => {
  const testWidth = 100;
  const testHeight = 100;

  describe('Pattern Generators', () => {
    it('generateAmiTen produces correct buffer size', () => {
      const config = { pattern: 'ami_ten' as const, density: 60, angle: 45, opacity: 0.5 };
      const buffer = generateAmiTen(testWidth, testHeight, config);
      expect(buffer.length).toBe(testWidth * testHeight);
    });

    it('generateAmiTen has non-zero pixels (dots present)', () => {
      const config = { pattern: 'ami_ten' as const, density: 60, angle: 45, opacity: 0.5 };
      const buffer = generateAmiTen(testWidth, testHeight, config);
      const nonZero = Array.from(buffer).filter(v => v > 0).length;
      expect(nonZero).toBeGreaterThan(0);
      expect(nonZero).toBeLessThan(testWidth * testHeight); // not all filled
    });

    it('generateKakeAmi produces crosshatch pattern', () => {
      const config = { pattern: 'kake_ami' as const, density: 60, angle: 45, opacity: 0.6, lineWidth: 1 };
      const buffer = generateKakeAmi(testWidth, testHeight, config);
      expect(buffer.length).toBe(testWidth * testHeight);
      const nonZero = Array.from(buffer).filter(v => v > 0).length;
      expect(nonZero).toBeGreaterThan(0);
    });

    it('generateSunaMe produces stochastic noise', () => {
      const config = { pattern: 'suna_me' as const, density: 100, angle: 0, opacity: 0.5 };
      const buffer = generateSunaMe(testWidth, testHeight, config);
      expect(buffer.length).toBe(testWidth * testHeight);
      const nonZero = Array.from(buffer).filter(v => v > 0).length;
      // With density 100/200 = 50% fill probability
      expect(nonZero).toBeGreaterThan(testWidth * testHeight * 0.3);
      expect(nonZero).toBeLessThan(testWidth * testHeight * 0.7);
    });

    it('generateSunaMe is deterministic (same seed)', () => {
      const config = { pattern: 'suna_me' as const, density: 80, angle: 0, opacity: 0.4 };
      const buffer1 = generateSunaMe(testWidth, testHeight, config);
      const buffer2 = generateSunaMe(testWidth, testHeight, config);
      expect(Buffer.from(buffer1).equals(Buffer.from(buffer2))).toBe(true);
    });

    it('generateGradation produces smooth gradient', () => {
      const config = { pattern: 'gradation' as const, density: 50, angle: 90, opacity: 0.8, gradientAngle: 90 };
      const buffer = generateGradation(testWidth, testHeight, config);
      expect(buffer.length).toBe(testWidth * testHeight);
      // First row should be lighter than last row (gradient angle 90 = top to bottom)
      const firstRowAvg = Array.from(buffer.slice(0, testWidth)).reduce((a, b) => a + b, 0) / testWidth;
      const lastRowAvg = Array.from(buffer.slice((testHeight - 1) * testWidth)).reduce((a, b) => a + b, 0) / testWidth;
      expect(lastRowAvg).toBeGreaterThan(firstRowAvg);
    });
  });

  describe('Config Resolution', () => {
    it('resolves shonen + action to kake_ami with high density', () => {
      const config = resolveScreentoneConfig('action', 'shonen');
      expect(config.pattern).toBe('kake_ami');
      expect(config.density).toBeGreaterThan(GENRE_PATTERN_DEFAULTS.shonen.baseDensity);
    });

    it('resolves shojo + romance to gradation with low density', () => {
      const config = resolveScreentoneConfig('romance', 'shojo');
      expect(config.pattern).toBe('gradation');
      expect(config.density).toBeLessThan(GENRE_PATTERN_DEFAULTS.shojo.baseDensity);
    });

    it('resolves neutral mood to genre default pattern', () => {
      const config = resolveScreentoneConfig('neutral', 'seinen');
      expect(config.pattern).toBe(GENRE_PATTERN_DEFAULTS.seinen.primary);
    });

    it('applies manual override over resolved config', () => {
      const config = resolveScreentoneConfig('action', 'shonen', { pattern: 'gradation', density: 99 });
      expect(config.pattern).toBe('gradation');
      expect(config.density).toBe(99);
    });

    it('clamps opacity between 0.1 and 0.9', () => {
      // Romance + shojo gives very low opacity multiplier
      const config = resolveScreentoneConfig('romance', 'shojo');
      expect(config.opacity).toBeGreaterThanOrEqual(0.1);
      expect(config.opacity).toBeLessThanOrEqual(0.9);
    });
  });

  describe('Compositing', () => {
    it('compositeScreentone darkens pixels where pattern is non-zero', () => {
      // Create a white RGBA image
      const imageRgba = Buffer.alloc(testWidth * testHeight * 4, 255);
      // Create a pattern with some filled pixels
      const pattern = new Uint8Array(testWidth * testHeight);
      pattern[0] = 128; // 50% alpha at first pixel

      const result = compositeScreentone(imageRgba, pattern, testWidth, testHeight);
      // First pixel should be darkened (255 * 0.5 = ~128)
      expect(result[0]).toBeLessThan(255);
      expect(result[0]).toBeCloseTo(128, -1); // approximately
    });

    it('compositeScreentone respects region mask', () => {
      const imageRgba = Buffer.alloc(testWidth * testHeight * 4, 255);
      const pattern = new Uint8Array(testWidth * testHeight).fill(128);
      const mask = Buffer.alloc(testWidth * testHeight, 0); // all masked out

      const result = compositeScreentone(imageRgba, pattern, testWidth, testHeight, mask);
      // Should be unchanged since mask is all zeros
      expect(result[0]).toBe(255);
    });
  });

  describe('applyScreentone', () => {
    it('processes a panel and returns result', async () => {
      const imageBuffer = Buffer.alloc(50 * 50 * 4, 200); // gray RGBA
      const result = await applyScreentone({
        imageBuffer,
        width: 50,
        height: 50,
        mood: 'action',
        genre: 'shonen',
      });

      expect(result.outputBuffer.length).toBe(50 * 50 * 4);
      expect(result.appliedPattern).toBe('kake_ami');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.usedAi).toBe(false);
    });
  });

  describe('batchApplyScreentone', () => {
    it('processes multiple panels', async () => {
      const panels = [
        { panelId: 1, imageBuffer: Buffer.alloc(30 * 30 * 4, 200), width: 30, height: 30, mood: 'action' as const },
        { panelId: 2, imageBuffer: Buffer.alloc(30 * 30 * 4, 200), width: 30, height: 30, mood: 'calm' as const },
      ];

      const results = await batchApplyScreentone(panels, 'seinen');
      expect(results).toHaveLength(2);
      expect(results[0].panelId).toBe(1);
      expect(results[1].panelId).toBe(2);
      expect(results[0].result.appliedPattern).toBe('kake_ami'); // action → kake_ami
      expect(results[1].result.appliedPattern).toBe('gradation'); // calm → gradation
    });
  });
});

// ─── Bubble Renderer Tests ────────────────────────────────────────────────────

import {
  estimateTextDimensions,
  computeBubbleLayouts,
  renderBubbleToBuffer,
  renderBubbles,
  batchRenderBubbles,
  GENRE_FONT_CONFIG,
  BUBBLE_TYPE_STYLES,
} from './bubble-renderer';

describe('D10.M Bubble Renderer', () => {
  describe('Text Dimension Estimation', () => {
    it('estimates dimensions for Latin text', () => {
      const dims = estimateTextDimensions('Hello world', 14, 200);
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
      expect(dims.lines).toBeGreaterThanOrEqual(1);
    });

    it('estimates wider dimensions for CJK text', () => {
      const latin = estimateTextDimensions('Hello', 14, 200);
      const cjk = estimateTextDimensions('こんにちは', 14, 200);
      // CJK chars are wider (1.0x vs 0.6x fontSize)
      expect(cjk.width).toBeGreaterThan(latin.width);
    });

    it('wraps text when exceeding maxWidth', () => {
      const dims = estimateTextDimensions('This is a very long sentence that should wrap', 14, 50);
      expect(dims.lines).toBeGreaterThan(1);
    });
  });

  describe('Bubble Layout Computation', () => {
    const dialogueLines = [
      { speaker: 'Hero', text: 'Let\'s go!', type: 'speech' as const },
      { speaker: null, text: 'Meanwhile...', type: 'narration' as const },
    ];

    it('computes layouts for all dialogue lines', () => {
      const layouts = computeBubbleLayouts(dialogueLines, 800, 600, 'shonen', 'rtl');
      expect(layouts).toHaveLength(2);
    });

    it('assigns correct styles per bubble type', () => {
      const layouts = computeBubbleLayouts(dialogueLines, 800, 600, 'shonen', 'rtl');
      const speechLayout = layouts.find(l => l.dialogue.type === 'speech');
      const narrationLayout = layouts.find(l => l.dialogue.type === 'narration');

      expect(speechLayout?.style.borderRadius).toBe(999); // oval
      expect(narrationLayout?.style.borderRadius).toBe(4); // box
    });

    it('keeps bubbles within panel bounds', () => {
      const layouts = computeBubbleLayouts(dialogueLines, 400, 300, 'shonen', 'ltr');
      for (const layout of layouts) {
        expect(layout.x).toBeGreaterThanOrEqual(0);
        expect(layout.y).toBeGreaterThanOrEqual(0);
        expect(layout.x + layout.width).toBeLessThanOrEqual(400);
        expect(layout.y + layout.height).toBeLessThanOrEqual(300);
      }
    });

    it('avoids bubble overlap', () => {
      const manyLines = [
        { speaker: 'A', text: 'Line 1', type: 'speech' as const },
        { speaker: 'B', text: 'Line 2', type: 'speech' as const },
        { speaker: 'C', text: 'Line 3', type: 'speech' as const },
      ];
      const layouts = computeBubbleLayouts(manyLines, 400, 600, 'shonen', 'ltr');

      // Check no two bubbles fully overlap
      for (let i = 0; i < layouts.length; i++) {
        for (let j = i + 1; j < layouts.length; j++) {
          const a = layouts[i];
          const b = layouts[j];
          const overlaps =
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
          // Allow partial overlap but not complete containment
          if (overlaps) {
            const overlapArea = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
              Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
            const smallerArea = Math.min(a.width * a.height, b.width * b.height);
            // Overlap should be less than 80% of smaller bubble
            expect(overlapArea / smallerArea).toBeLessThan(0.8);
          }
        }
      }
    });

    it('mirrors layout for RTL reading direction', () => {
      // Multiple bubbles without position hints — auto-placement differs by direction
      const lines = [
        { speaker: 'A', text: 'First', type: 'speech' as const },
        { speaker: 'B', text: 'Second', type: 'speech' as const },
      ];
      const ltrLayouts = computeBubbleLayouts(lines, 800, 600, 'shonen', 'ltr');
      const rtlLayouts = computeBubbleLayouts(lines, 800, 600, 'shonen', 'rtl');
      // RTL auto-placement should differ from LTR for multi-bubble panels
      const ltrXs = ltrLayouts.map(l => l.x).sort();
      const rtlXs = rtlLayouts.map(l => l.x).sort();
      // At least one x position should differ
      const anyDifferent = ltrXs.some((x, i) => x !== rtlXs[i]);
      expect(anyDifferent).toBe(true);
    });
  });

  describe('renderBubbles', () => {
    it('returns unchanged buffer when no dialogue', async () => {
      const panelBuffer = Buffer.alloc(100 * 100 * 4, 128);
      const result = await renderBubbles({
        panelWidth: 100,
        panelHeight: 100,
        dialogueLines: [],
        genre: 'shonen',
        readingDirection: 'rtl',
        panelImageBuffer: panelBuffer,
      });

      expect(result.bubbleCount).toBe(0);
      expect(result.outputBuffer).toBe(panelBuffer); // same reference
    });

    it('renders bubbles and modifies buffer', async () => {
      const panelBuffer = Buffer.alloc(200 * 200 * 4, 100); // dark gray
      const result = await renderBubbles({
        panelWidth: 200,
        panelHeight: 200,
        dialogueLines: [
          { speaker: 'Hero', text: 'Hello!', type: 'speech' },
        ],
        genre: 'shonen',
        readingDirection: 'rtl',
        panelImageBuffer: panelBuffer,
      });

      expect(result.bubbleCount).toBe(1);
      expect(result.layouts).toHaveLength(1);
      // Output should differ from input (bubble rendered)
      expect(result.outputBuffer.equals(panelBuffer)).toBe(false);
    });
  });

  describe('Genre Font Config', () => {
    it('has configs for all 5 genres', () => {
      const genres = ['shonen', 'shojo', 'seinen', 'josei', 'kodomomuke'] as const;
      for (const genre of genres) {
        expect(GENRE_FONT_CONFIG[genre]).toBeDefined();
        expect(GENRE_FONT_CONFIG[genre].speech.fontFamily).toBeTruthy();
      }
    });

    it('shonen has bold speech font', () => {
      expect(GENRE_FONT_CONFIG.shonen.speech.fontWeight).toBe('bold');
    });

    it('kodomomuke has larger base font sizes', () => {
      expect(GENRE_FONT_CONFIG.kodomomuke.speech.fontSize).toBeGreaterThan(
        GENRE_FONT_CONFIG.seinen.speech.fontSize
      );
    });
  });
});

// ─── Page Compositor Tests ────────────────────────────────────────────────────

import {
  TRIM_SPECS,
  getLayoutSlots,
  composePage,
  autoCompose,
  placePanel,
  drawCropMarks,
} from './page-compositor';

describe('D10.M Page Compositor', () => {
  describe('Trim Specifications', () => {
    it('defines all 4 trim sizes', () => {
      expect(TRIM_SPECS.b5).toBeDefined();
      expect(TRIM_SPECS.a5).toBeDefined();
      expect(TRIM_SPECS.tankobon).toBeDefined();
      expect(TRIM_SPECS.us_trade).toBeDefined();
    });

    it('B5 is the largest Japanese format', () => {
      expect(TRIM_SPECS.b5.widthPx).toBeGreaterThan(TRIM_SPECS.a5.widthPx);
      expect(TRIM_SPECS.b5.widthPx).toBeGreaterThan(TRIM_SPECS.tankobon.widthPx);
    });

    it('all specs have 300 DPI bleed of ~3mm (35px)', () => {
      for (const spec of Object.values(TRIM_SPECS)) {
        expect(spec.bleedPx).toBe(35);
      }
    });

    it('all specs have Lulu package prefix', () => {
      for (const spec of Object.values(TRIM_SPECS)) {
        expect(spec.luluPackagePrefix).toMatch(/^\d{4}X\d{4}$/);
      }
    });
  });

  describe('Layout Slots', () => {
    it('splash returns 1 full-page slot', () => {
      const slots = getLayoutSlots('splash', 1, 'ltr');
      expect(slots).toHaveLength(1);
      expect(slots[0].width).toBe(1);
      expect(slots[0].height).toBe(1);
    });

    it('grid_4 returns 4 equal slots', () => {
      const slots = getLayoutSlots('grid_4', 4, 'ltr');
      expect(slots).toHaveLength(4);
      for (const slot of slots) {
        expect(slot.width).toBeCloseTo(0.48, 1);
        expect(slot.height).toBeCloseTo(0.48, 1);
      }
    });

    it('grid_6 returns 6 slots', () => {
      const slots = getLayoutSlots('grid_6', 6, 'ltr');
      expect(slots).toHaveLength(6);
    });

    it('RTL mirrors x positions', () => {
      const ltrSlots = getLayoutSlots('grid_4', 4, 'ltr');
      const rtlSlots = getLayoutSlots('grid_4', 4, 'rtl');
      // First LTR slot should map to last RTL slot position
      expect(ltrSlots[0].x).not.toBe(rtlSlots[0].x);
    });

    it('dynamic selects appropriate layout by panel count', () => {
      const slots1 = getLayoutSlots('dynamic', 1, 'ltr');
      const slots3 = getLayoutSlots('dynamic', 3, 'ltr');
      const slots5 = getLayoutSlots('dynamic', 5, 'ltr');
      expect(slots1).toHaveLength(1); // splash
      expect(slots3).toHaveLength(3); // vertical_strip
      expect(slots5).toHaveLength(6); // grid_6
    });
  });

  describe('Page Composition', () => {
    const makePanelSlot = (id: number): PanelSlot => ({
      panelId: id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      imageBuffer: Buffer.alloc(50 * 50 * 4, 128),
      pixelWidth: 50,
      pixelHeight: 50,
    });

    it('composes a single splash page', async () => {
      const result = await composePage({
        panels: [makePanelSlot(1)],
        trimSize: 'b5',
        layout: 'splash',
        readingDirection: 'rtl',
        pageNumber: 1,
        addBleed: true,
        addCropMarks: true,
      });

      expect(result.pageNumber).toBe(1);
      expect(result.trimSize).toBe('b5');
      expect(result.widthPx).toBe(TRIM_SPECS.b5.widthPx + TRIM_SPECS.b5.bleedPx * 2);
      expect(result.heightPx).toBe(TRIM_SPECS.b5.heightPx + TRIM_SPECS.b5.bleedPx * 2);
      expect(result.panelPositions).toHaveLength(1);
    });

    it('composes a 4-panel grid page', async () => {
      const panels = [1, 2, 3, 4].map(makePanelSlot);
      const result = await composePage({
        panels,
        trimSize: 'a5',
        layout: 'grid_4',
        readingDirection: 'ltr',
        pageNumber: 2,
        addBleed: true,
        addCropMarks: false,
      });

      expect(result.panelPositions).toHaveLength(4);
      expect(result.trimSize).toBe('a5');
    });

    it('page without bleed has smaller dimensions', async () => {
      const withBleed = await composePage({
        panels: [makePanelSlot(1)],
        trimSize: 'b5',
        layout: 'splash',
        readingDirection: 'rtl',
        pageNumber: 1,
        addBleed: true,
        addCropMarks: false,
      });

      const withoutBleed = await composePage({
        panels: [makePanelSlot(1)],
        trimSize: 'b5',
        layout: 'splash',
        readingDirection: 'rtl',
        pageNumber: 1,
        addBleed: false,
        addCropMarks: false,
      });

      expect(withBleed.widthPx).toBeGreaterThan(withoutBleed.widthPx);
    });
  });

  describe('Auto Compose', () => {
    it('paginates panels into multiple pages', async () => {
      const panels = Array.from({ length: 12 }, (_, i) => ({
        panelId: i + 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        imageBuffer: Buffer.alloc(30 * 30 * 4, 150),
        pixelWidth: 30,
        pixelHeight: 30,
      }));

      const pages = await autoCompose(panels, {
        trimSize: 'tankobon',
        readingDirection: 'rtl',
        panelsPerPage: 4,
      });

      expect(pages).toHaveLength(3); // 12 panels / 4 per page
      expect(pages[0].pageNumber).toBe(1);
      expect(pages[2].pageNumber).toBe(3);
    });
  });
});

// ─── PDF Generator Tests ──────────────────────────────────────────────────────

import {
  calculateSpineWidth,
  buildPdfSkeleton,
  validateForPrint,
  generateCoverFromTitleCard,
  buildLuluPackageId,
  generatePrintPdf,
} from './pdf-generator';

describe('D10.M PDF Generator', () => {
  const testMetadata = {
    title: 'Test Manga',
    author: 'Test Author',
    chapter: 1,
    language: 'ja',
    createdAt: new Date('2026-01-01'),
  };

  describe('Spine Width Calculation', () => {
    it('calculates minimum 3mm for low page counts', () => {
      const result = calculateSpineWidth(10);
      expect(result.spineWidthMm).toBe(3); // minimum
    });

    it('scales linearly with page count', () => {
      const r100 = calculateSpineWidth(100);
      const r200 = calculateSpineWidth(200);
      expect(r200.spineWidthMm).toBeCloseTo(r100.spineWidthMm * 2, 0);
    });

    it('returns pixel equivalent at 300 DPI', () => {
      const result = calculateSpineWidth(100);
      const expectedPx = Math.round(result.spineWidthMm * (300 / 25.4));
      expect(result.spineWidthPx).toBe(expectedPx);
    });
  });

  describe('PDF Skeleton', () => {
    it('builds valid PDF header', () => {
      const skeleton = buildPdfSkeleton(10, 500, 700, testMetadata);
      expect(skeleton.header).toContain('%PDF-1.6');
      expect(skeleton.header).toContain('/Type /Catalog');
    });

    it('includes correct page count in Pages object', () => {
      const skeleton = buildPdfSkeleton(5, 500, 700, testMetadata);
      expect(skeleton.header).toContain('/Count 5');
    });

    it('trailer references root and info objects', () => {
      const skeleton = buildPdfSkeleton(10, 500, 700, testMetadata);
      expect(skeleton.trailer).toContain('/Root 1 0 R');
      expect(skeleton.trailer).toContain('%%EOF');
    });
  });

  describe('Print Validation', () => {
    const makePages = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        pageBuffer: Buffer.alloc(100),
        widthPx: 2149,
        heightPx: 3023,
        trimSize: 'b5' as const,
        pageNumber: i + 1,
        panelPositions: [],
        processingTimeMs: 10,
      }));

    it('passes validation for valid input', () => {
      const result = validateForPrint(makePages(30), 'b5', testMetadata);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('warns for page count below 24', () => {
      const result = validateForPrint(makePages(10), 'b5', testMetadata);
      expect(result.valid).toBe(true); // warning, not error
      expect(result.warnings.some(w => w.includes('below Lulu minimum'))).toBe(true);
    });

    it('errors for page count above 800', () => {
      const result = validateForPrint(makePages(801), 'b5', testMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds Lulu maximum'))).toBe(true);
    });

    it('warns for odd page count', () => {
      const result = validateForPrint(makePages(31), 'b5', testMetadata);
      expect(result.warnings.some(w => w.includes('Odd page count'))).toBe(true);
    });

    it('errors for missing title', () => {
      const result = validateForPrint(makePages(30), 'b5', { ...testMetadata, title: '' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Title is required'))).toBe(true);
    });

    it('errors for inconsistent page dimensions', () => {
      const pages = makePages(4);
      pages[2] = { ...pages[2], widthPx: 999 };
      const result = validateForPrint(pages, 'b5', testMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('inconsistent dimensions'))).toBe(true);
    });
  });

  describe('Cover Generation', () => {
    it('generates cover spec from title card', () => {
      const cover = generateCoverFromTitleCard(
        Buffer.alloc(100 * 100 * 4, 200),
        100,
        100,
        50,
        'b5',
        testMetadata
      );

      expect(cover.frontCoverWidth).toBe(100);
      expect(cover.frontCoverHeight).toBe(100);
      expect(cover.spineWidthPx).toBeGreaterThan(0);
      expect(cover.spineText).toContain('Test Manga');
    });

    it('includes volume number in spine text when provided', () => {
      const cover = generateCoverFromTitleCard(
        Buffer.alloc(100),
        100,
        100,
        50,
        'b5',
        { ...testMetadata, volume: 3 }
      );
      expect(cover.spineText).toContain('Vol.3');
    });
  });

  describe('Lulu Package ID', () => {
    it('builds correct package ID for B5 color perfect-bound', () => {
      const id = buildLuluPackageId('b5');
      expect(id).toBe('0693X0984FCPERFECT060UW444');
    });

    it('builds BW saddle-stitch variant', () => {
      const id = buildLuluPackageId('a5', { colorInterior: false, perfectBound: false, paperWeight: '070' });
      expect(id).toBe('0583X0827BWSADDLE070UW444');
    });

    it('uses correct prefix for each trim size', () => {
      expect(buildLuluPackageId('b5')).toContain('0693X0984');
      expect(buildLuluPackageId('a5')).toContain('0583X0827');
      expect(buildLuluPackageId('tankobon')).toContain('0504X0717');
      expect(buildLuluPackageId('us_trade')).toContain('0600X0900');
    });
  });

  describe('PDF Generation', () => {
    it('generates interior PDF from composed pages', async () => {
      const pages = Array.from({ length: 30 }, (_, i) => ({
        pageBuffer: Buffer.alloc(2149 * 3023 * 4, 200),
        widthPx: 2149,
        heightPx: 3023,
        trimSize: 'b5' as const,
        pageNumber: i + 1,
        panelPositions: [],
        processingTimeMs: 5,
      }));

      const result = await generatePrintPdf({
        pages,
        metadata: testMetadata,
        trimSize: 'b5',
        embedColorProfile: true,
        dpi: 300,
        includePageNumbers: true,
        pageNumberOffset: 0,
      });

      expect(result.pdfBuffer.length).toBeGreaterThan(0);
      expect(result.pageCount).toBe(30);
      expect(result.spineWidthMm).toBeGreaterThan(0);
      expect(result.pdfBuffer.toString().startsWith('%PDF-1.6')).toBe(true);
    });

    it('appends blank page for odd page count', async () => {
      const pages = Array.from({ length: 31 }, (_, i) => ({
        pageBuffer: Buffer.alloc(100),
        widthPx: 2149,
        heightPx: 3023,
        trimSize: 'b5' as const,
        pageNumber: i + 1,
        panelPositions: [],
        processingTimeMs: 5,
      }));

      const result = await generatePrintPdf({
        pages,
        metadata: testMetadata,
        trimSize: 'b5',
        embedColorProfile: true,
        dpi: 300,
        includePageNumbers: false,
        pageNumberOffset: 0,
      });

      expect(result.pageCount).toBe(32); // 31 + 1 blank
    });
  });
});

// ─── Orchestrator Tests ───────────────────────────────────────────────────────

import { runMangaFinishing, type MangaFinishingInput } from './manga-finishing-agent';

describe('D10.M Manga Finishing Agent (Orchestrator)', () => {
  const makeTestInput = (panelCount: number): MangaFinishingInput => ({
    projectId: 'proj-test-001',
    episodeId: 'ep-test-001',
    panels: Array.from({ length: panelCount }, (_, i) => ({
      panelId: i + 1,
      imageBuffer: Buffer.alloc(80 * 80 * 4, 180),
      width: 80,
      height: 80,
      mood: (['action', 'calm', 'tension', 'neutral'] as const)[i % 4],
      dialogueLines: i % 2 === 0
        ? [{ speaker: 'Hero', text: `Line ${i + 1}`, type: 'speech' as const }]
        : [],
      sequenceIndex: i,
    })),
    genre: 'shonen',
    readingDirection: 'rtl',
    trimSize: 'b5',
    panelsPerPage: 4,
    metadata: {
      title: 'Test Manga',
      author: 'Test Author',
      chapter: 1,
      language: 'ja',
      createdAt: new Date('2026-01-01'),
    },
  });

  it('runs full pipeline for 8 panels', async () => {
    const input = makeTestInput(8);
    const result = await runMangaFinishing(input);

    expect(result.interiorPdf.length).toBeGreaterThan(0);
    expect(result.pageCount).toBeGreaterThanOrEqual(2); // 8 panels / 4 per page = 2
    expect(result.trimSize).toBe('b5');
    expect(result.luluPackageId).toContain('0693X0984');
    expect(result.panelResults).toHaveLength(8);
    expect(result.totalProcessingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('applies screentone to all panels', async () => {
    const input = makeTestInput(4);
    const result = await runMangaFinishing(input);

    for (const pr of result.panelResults) {
      expect(pr.screentoneApplied).toBeDefined();
      expect(pr.screentoneApplied.usedAi).toBe(false);
    }
  });

  it('renders bubbles only on panels with dialogue', async () => {
    const input = makeTestInput(4);
    const result = await runMangaFinishing(input);

    // Panels 0, 2 have dialogue; panels 1, 3 don't
    expect(result.panelResults[0].bubblesRendered.bubbleCount).toBe(1);
    expect(result.panelResults[1].bubblesRendered.bubbleCount).toBe(0);
    expect(result.panelResults[2].bubblesRendered.bubbleCount).toBe(1);
    expect(result.panelResults[3].bubblesRendered.bubbleCount).toBe(0);
  });

  it('uses B5 as default trim size', async () => {
    const input = makeTestInput(4);
    delete (input as any).trimSize;
    const result = await runMangaFinishing(input);
    expect(result.trimSize).toBe('b5');
  });

  it('respects custom trim size', async () => {
    const input = makeTestInput(4);
    input.trimSize = 'tankobon';
    const result = await runMangaFinishing(input);
    expect(result.trimSize).toBe('tankobon');
    expect(result.luluPackageId).toContain('0504X0717');
  });

  it('generates cover when title card provided', async () => {
    const input = makeTestInput(30); // enough pages for valid PDF
    input.generateCover = true;
    input.titleCardBuffer = Buffer.alloc(200 * 200 * 4, 100);
    input.titleCardWidth = 200;
    input.titleCardHeight = 200;

    const result = await runMangaFinishing(input);
    expect(result.coverPdf).toBeDefined();
    expect(result.coverPdf!.length).toBeGreaterThan(0);
  });

  it('provides timing breakdown', async () => {
    const input = makeTestInput(4);
    const result = await runMangaFinishing(input);

    expect(result.timingBreakdown.screentoneMs).toBeGreaterThanOrEqual(0);
    expect(result.timingBreakdown.bubblesMs).toBeGreaterThanOrEqual(0);
    expect(result.timingBreakdown.compositionMs).toBeGreaterThanOrEqual(0);
    expect(result.timingBreakdown.pdfGenerationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns validation result', async () => {
    const input = makeTestInput(4);
    const result = await runMangaFinishing(input);

    expect(result.validation).toBeDefined();
    expect(result.validation.valid).toBe(true);
    // 1 page (4 panels / 4 per page) — below 24 minimum, so warning expected
    expect(result.validation.warnings.length).toBeGreaterThan(0);
  });

  it('applies craft guidance to screentone density', async () => {
    const input = makeTestInput(4);
    input.craftGuidance = {
      screentoneAdjustment: 0.5, // increase density
    };
    const result = await runMangaFinishing(input);

    // All panels should have screentone applied (no error)
    expect(result.panelResults).toHaveLength(4);
    for (const pr of result.panelResults) {
      expect(pr.screentoneApplied.outputBuffer.length).toBeGreaterThan(0);
    }
  });
});
