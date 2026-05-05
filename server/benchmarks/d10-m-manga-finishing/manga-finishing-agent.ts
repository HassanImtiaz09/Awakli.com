/**
 * D10.M Manga Finishing Agent — Main Orchestrator
 *
 * Wires screentone-engine → bubble-renderer → page-compositor → pdf-generator
 * into a single pipeline call. Integrates with D10 Craft Library Sensei for
 * style guidance and produces print-ready manga volumes.
 *
 * Blueprint: Stage 5.5 branch — Manga Finishing
 * Entry point: runMangaFinishing(input)
 */

import {
  applyScreentone,
  batchApplyScreentone,
  resolveScreentoneConfig,
  type AnimeGenre as ScreentoneGenre,
  type MoodCategory,
  type ScreentoneConfig,
  type ScreentoneResult,
} from './screentone-engine';

import {
  renderBubbles,
  batchRenderBubbles,
  type AnimeGenre as BubbleGenre,
  type BubbleRenderResult,
  type DialogueLine,
  type ReadingDirection as BubbleReadingDirection,
} from './bubble-renderer';

import {
  composePage,
  autoCompose,
  TRIM_SPECS,
  type ComposedPage,
  type LayoutTemplate,
  type PanelSlot,
  type ReadingDirection as PageReadingDirection,
  type TrimSize,
} from './page-compositor';

import {
  generatePrintPdf,
  validateForPrint,
  calculateSpineWidth,
  generateCoverFromTitleCard,
  buildLuluPackageId,
  type PdfGeneratorResult,
  type PdfMetadata,
} from './pdf-generator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnimeGenre = 'shonen' | 'shojo' | 'seinen' | 'josei' | 'kodomomuke';
export type ReadingDirection = 'rtl' | 'ltr';

export interface MangaPanel {
  /** Unique panel identifier */
  panelId: number;
  /** Raw panel image buffer (RGBA) */
  imageBuffer: Buffer;
  /** Panel dimensions */
  width: number;
  height: number;
  /** Mood of this panel (for screentone selection) */
  mood: MoodCategory;
  /** Dialogue lines to render on this panel */
  dialogueLines: DialogueLine[];
  /** Layout hint: which template slot this panel prefers */
  layoutHint?: LayoutTemplate;
  /** Position within the episode (sequential order) */
  sequenceIndex: number;
}

export interface MangaFinishingInput {
  /** Project ID */
  projectId: string;
  /** Episode/chapter ID */
  episodeId: string;
  /** All panels for this chapter */
  panels: MangaPanel[];
  /** Project genre */
  genre: AnimeGenre;
  /** Reading direction (RTL for Japanese, LTR for Western) */
  readingDirection: ReadingDirection;
  /** Trim size (B5 default) */
  trimSize?: TrimSize;
  /** Panels per page (default 4) */
  panelsPerPage?: number;
  /** PDF metadata */
  metadata: PdfMetadata;
  /** Title card buffer for cover generation (RGBA) */
  titleCardBuffer?: Buffer;
  titleCardWidth?: number;
  titleCardHeight?: number;
  /** Optional screentone override (applies to all panels) */
  screentoneOverride?: Partial<ScreentoneConfig>;
  /** Whether to generate cover PDF */
  generateCover?: boolean;
  /** Use dedicated cover designer (Pro+) instead of title-card fallback */
  useDedicatedCover?: boolean;
  /** Cover metadata for dedicated designer */
  coverMeta?: {
    synopsis?: string;
    genreTags?: string[];
    isbn?: string;
    authorName?: string;
  };
  /** D10 Craft Library style guidance (from sensei) */
  craftGuidance?: CraftGuidance;
}

export interface CraftGuidance {
  /** Recommended screentone density adjustment (-1 to +1) */
  screentoneAdjustment?: number;
  /** Recommended panel layout preference */
  layoutPreference?: LayoutTemplate;
  /** Typography notes from craft library */
  typographyNotes?: string;
  /** Composition notes */
  compositionNotes?: string;
}

export interface MangaFinishingResult {
  /** Interior PDF buffer */
  interiorPdf: Buffer;
  /** Cover PDF buffer (if generated) */
  coverPdf?: Buffer;
  /** Total page count */
  pageCount: number;
  /** Spine width in mm */
  spineWidthMm: number;
  /** Lulu package ID */
  luluPackageId: string;
  /** Trim size used */
  trimSize: TrimSize;
  /** Per-panel processing results */
  panelResults: PanelProcessingResult[];
  /** Composed pages (for preview) */
  composedPages: ComposedPage[];
  /** Validation result */
  validation: { valid: boolean; errors: string[]; warnings: string[] };
  /** Total processing time in ms */
  totalProcessingTimeMs: number;
  /** Breakdown of processing time by stage */
  timingBreakdown: {
    screentoneMs: number;
    bubblesMs: number;
    compositionMs: number;
    pdfGenerationMs: number;
  };
}

export interface PanelProcessingResult {
  panelId: number;
  screentoneApplied: ScreentoneResult;
  bubblesRendered: BubbleRenderResult;
}

// ─── Craft Library Integration ────────────────────────────────────────────────

/**
 * Apply craft guidance adjustments to screentone config.
 */
function applyCraftGuidance(
  baseConfig: ScreentoneConfig,
  guidance?: CraftGuidance
): ScreentoneConfig {
  if (!guidance || guidance.screentoneAdjustment === undefined) return baseConfig;

  const adjusted = { ...baseConfig };
  // Adjust density by guidance factor (-1 = halve, +1 = double)
  const factor = 1 + guidance.screentoneAdjustment * 0.5;
  adjusted.density = Math.round(adjusted.density * Math.max(0.3, Math.min(2.0, factor)));
  adjusted.opacity = Math.max(0.1, Math.min(0.9, adjusted.opacity * Math.max(0.5, Math.min(1.5, factor))));

  return adjusted;
}

/**
 * Select layout template based on craft guidance and panel count.
 */
function selectLayout(
  panelCount: number,
  guidance?: CraftGuidance
): LayoutTemplate {
  if (guidance?.layoutPreference) return guidance.layoutPreference;

  // Default layout selection based on panel count
  if (panelCount === 1) return 'splash';
  if (panelCount <= 3) return 'vertical_strip';
  if (panelCount <= 4) return 'grid_4';
  if (panelCount <= 6) return 'grid_6';
  return 'dynamic';
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * Run the complete manga finishing pipeline.
 *
 * Flow:
 * 1. Apply screentone to each panel (mood + genre → pattern)
 * 2. Render dialogue bubbles onto screentoned panels
 * 3. Compose panels into pages (layout + trim + bleed)
 * 4. Generate print-ready PDF (interior + cover)
 * 5. Return results with Lulu package ID
 */
export async function runMangaFinishing(
  input: MangaFinishingInput
): Promise<MangaFinishingResult> {
  const totalStart = Date.now();
  const trimSize = input.trimSize ?? 'b5';
  const panelsPerPage = input.panelsPerPage ?? 4;

  // ─── Stage 1: Screentone Application ──────────────────────────────────────
  const screentoneStart = Date.now();
  const panelResults: PanelProcessingResult[] = [];
  const processedPanels: Array<{
    panelId: number;
    buffer: Buffer;
    width: number;
    height: number;
    dialogueLines: DialogueLine[];
    sequenceIndex: number;
  }> = [];

  for (const panel of input.panels) {
    // Resolve screentone config with craft guidance
    let config = resolveScreentoneConfig(
      panel.mood,
      input.genre as ScreentoneGenre,
      input.screentoneOverride
    );
    config = applyCraftGuidance(config, input.craftGuidance);

    const screentoneResult = await applyScreentone({
      imageBuffer: panel.imageBuffer,
      width: panel.width,
      height: panel.height,
      mood: panel.mood,
      genre: input.genre as ScreentoneGenre,
      override: input.screentoneOverride,
    });

    processedPanels.push({
      panelId: panel.panelId,
      buffer: screentoneResult.outputBuffer,
      width: panel.width,
      height: panel.height,
      dialogueLines: panel.dialogueLines,
      sequenceIndex: panel.sequenceIndex,
    });

    // Placeholder for bubble result (filled in next stage)
    panelResults.push({
      panelId: panel.panelId,
      screentoneApplied: screentoneResult,
      bubblesRendered: null as unknown as BubbleRenderResult,
    });
  }
  const screentoneMs = Date.now() - screentoneStart;

  // ─── Stage 2: Bubble Rendering ────────────────────────────────────────────
  const bubblesStart = Date.now();
  const panelsWithBubbles: Array<{
    panelId: number;
    buffer: Buffer;
    width: number;
    height: number;
    sequenceIndex: number;
  }> = [];

  for (let i = 0; i < processedPanels.length; i++) {
    const panel = processedPanels[i];

    const bubbleResult = await renderBubbles({
      panelWidth: panel.width,
      panelHeight: panel.height,
      dialogueLines: panel.dialogueLines,
      genre: input.genre as BubbleGenre,
      readingDirection: input.readingDirection as BubbleReadingDirection,
      panelImageBuffer: panel.buffer,
    });

    panelsWithBubbles.push({
      panelId: panel.panelId,
      buffer: bubbleResult.outputBuffer,
      width: panel.width,
      height: panel.height,
      sequenceIndex: panel.sequenceIndex,
    });

    // Update panel result with bubble info
    panelResults[i].bubblesRendered = bubbleResult;
  }
  const bubblesMs = Date.now() - bubblesStart;

  // ─── Stage 3: Page Composition ────────────────────────────────────────────
  const compositionStart = Date.now();

  // Sort panels by sequence index
  const sortedPanels = [...panelsWithBubbles].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  // Convert to PanelSlot format
  const panelSlots: PanelSlot[] = sortedPanels.map(p => ({
    panelId: p.panelId,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    imageBuffer: p.buffer,
    pixelWidth: p.width,
    pixelHeight: p.height,
  }));

  // Auto-compose into pages
  const composedPages = await autoCompose(panelSlots, {
    trimSize,
    readingDirection: input.readingDirection as PageReadingDirection,
    panelsPerPage,
    addBleed: true,
    addCropMarks: true,
  });
  const compositionMs = Date.now() - compositionStart;

  // ─── Stage 4: PDF Generation ──────────────────────────────────────────────
  const pdfStart = Date.now();

  // Generate cover — dedicated designer (Pro+) or title-card fallback
  let cover = undefined;
  if (input.generateCover && input.titleCardBuffer && input.titleCardWidth && input.titleCardHeight) {
    if (input.useDedicatedCover) {
      // Pro+ path: use dedicated cover designer with ekonte analysis
      const { designCover } = await import('./cover-designer');
      const coverResult = designCover({
        title: input.metadata.title,
        volumeNumber: input.metadata.volume || 1,
        chapterRange: input.metadata.chapter ? `Chapter ${input.metadata.chapter}` : undefined,
        authorName: input.coverMeta?.authorName || input.metadata.author || 'Unknown',
        genre: input.genre,
        trimSize,
        pageCount: composedPages.length,
        keyPanelImage: input.titleCardBuffer,
        synopsis: input.coverMeta?.synopsis,
        genreTags: input.coverMeta?.genreTags,
        isbn: input.coverMeta?.isbn,
      });
      // Use the composition to generate cover spec
      // The dedicated designer provides layout data; PDF generator renders it
      cover = generateCoverFromTitleCard(
        input.titleCardBuffer,
        input.titleCardWidth,
        input.titleCardHeight,
        composedPages.length,
        trimSize,
        input.metadata
      );
      // Attach design metadata for downstream rendering
      (cover as any).__dedicatedDesign = coverResult.composition;
      (cover as any).__designDecisions = coverResult.decisions;
    } else {
      // Free tier: title-card fallback (MVP)
      cover = generateCoverFromTitleCard(
        input.titleCardBuffer,
        input.titleCardWidth,
        input.titleCardHeight,
        composedPages.length,
        trimSize,
        input.metadata
      );
    }
  }

  const pdfResult = await generatePrintPdf({
    pages: composedPages,
    metadata: input.metadata,
    trimSize,
    cover,
    embedColorProfile: true,
    dpi: 300,
    includePageNumbers: true,
    pageNumberOffset: 0,
  });
  const pdfGenerationMs = Date.now() - pdfStart;

  // ─── Build Result ─────────────────────────────────────────────────────────
  const luluPackageId = buildLuluPackageId(trimSize);
  const { spineWidthMm } = calculateSpineWidth(composedPages.length);
  const validation = validateForPrint(composedPages, trimSize, input.metadata);

  return {
    interiorPdf: pdfResult.pdfBuffer,
    coverPdf: pdfResult.coverPdfBuffer,
    pageCount: pdfResult.pageCount,
    spineWidthMm,
    luluPackageId,
    trimSize,
    panelResults,
    composedPages,
    validation,
    totalProcessingTimeMs: Date.now() - totalStart,
    timingBreakdown: {
      screentoneMs,
      bubblesMs,
      compositionMs,
      pdfGenerationMs,
    },
  };
}

// ─── Utility Exports ──────────────────────────────────────────────────────────

export {
  applyScreentone,
  batchApplyScreentone,
  resolveScreentoneConfig,
  renderBubbles,
  batchRenderBubbles,
  composePage,
  autoCompose,
  generatePrintPdf,
  validateForPrint,
  calculateSpineWidth,
  generateCoverFromTitleCard,
  buildLuluPackageId,
  TRIM_SPECS,
};

export type {
  ScreentoneConfig,
  ScreentoneResult,
  BubbleRenderResult,
  DialogueLine,
  ComposedPage,
  PdfGeneratorResult,
  PdfMetadata,
  TrimSize,
  LayoutTemplate,
};
