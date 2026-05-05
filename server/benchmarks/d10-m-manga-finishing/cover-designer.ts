/**
 * D10.M Cover Designer — Dedicated Print Cover Composition Engine
 *
 * Replaces the auto-from-title-card MVP with a proper print cover pipeline:
 * - Title typography: genre-appropriate font selection + sizing + placement
 * - Chapter info: volume number, chapter range, subtitle
 * - Author attribution: creator name with configurable placement
 * - Ekonte-aware composition: analyze key panels for focal point, avoid text overlap
 * - Spine text generation (title + volume + author)
 * - Back cover: synopsis text + barcode area + genre tags
 *
 * Supports all 4 trim sizes (B5, A5, tankōbon, US trade).
 */

import { TRIM_SPECS, type TrimSize } from "./page-compositor";
import { calculateSpineWidth } from "./pdf-generator";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AnimeGenre = 'shonen' | 'shojo' | 'seinen' | 'josei' | 'kodomomuke';

export type CoverOrientation = 'portrait' | 'landscape';

export type TextPlacement = 'top_left' | 'top_center' | 'top_right' |
  'center_left' | 'center' | 'center_right' |
  'bottom_left' | 'bottom_center' | 'bottom_right';

export interface FontSpec {
  family: string;
  weight: number;
  sizePt: number;
  color: string;
  /** Optional: letter-spacing in em units */
  letterSpacing?: number;
  /** Optional: text-transform */
  transform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
}

export interface CoverTextElement {
  text: string;
  font: FontSpec;
  placement: TextPlacement;
  /** Offset from placement anchor in mm */
  offsetX: number;
  offsetY: number;
  /** Max width in mm (text wraps beyond this) */
  maxWidth: number;
  /** Rotation in degrees (0 = horizontal) */
  rotation?: number;
  /** Optional drop shadow for readability over images */
  shadow?: { offsetX: number; offsetY: number; blur: number; color: string };
}

export interface EkonteAnalysis {
  /** Focal point of the key panel (0-1 normalized coordinates) */
  focalPoint: { x: number; y: number };
  /** Dominant color regions that text should avoid or contrast with */
  dominantRegions: Array<{ x: number; y: number; width: number; height: number; avgColor: string }>;
  /** Suggested text placement zones (areas with low visual complexity) */
  safeZones: TextPlacement[];
  /** Overall brightness (0-1, used for text color decisions) */
  averageBrightness: number;
}

export interface CoverInput {
  /** Title of the manga/volume */
  title: string;
  /** Volume number */
  volumeNumber: number;
  /** Chapter range (e.g., "Chapters 1-12") */
  chapterRange?: string;
  /** Subtitle (optional) */
  subtitle?: string;
  /** Author/creator name */
  authorName: string;
  /** Genre for font/style selection */
  genre: AnimeGenre;
  /** Trim size */
  trimSize: TrimSize;
  /** Page count (for spine width calculation) */
  pageCount: number;
  /** Key panel image buffer for front cover background */
  keyPanelImage: Buffer;
  /** Synopsis text for back cover */
  synopsis?: string;
  /** Genre tags for back cover */
  genreTags?: string[];
  /** ISBN/barcode number (optional) */
  isbn?: string;
  /** Custom font overrides (optional) */
  fontOverrides?: Partial<CoverFontSet>;
  /** Cover orientation (default: portrait) */
  orientation?: CoverOrientation;
}

export interface CoverFontSet {
  title: FontSpec;
  subtitle: FontSpec;
  author: FontSpec;
  volumeInfo: FontSpec;
  spine: FontSpec;
  synopsis: FontSpec;
  genreTags: FontSpec;
}

export interface SpineSpec {
  /** Width in mm */
  width: number;
  /** Text elements on spine */
  elements: CoverTextElement[];
}

export interface BackCoverSpec {
  /** Synopsis text block */
  synopsis?: CoverTextElement;
  /** Genre tag badges */
  genreTags: CoverTextElement[];
  /** Barcode area (reserved space in mm) */
  barcodeArea: { x: number; y: number; width: number; height: number };
  /** Background color */
  backgroundColor: string;
}

export interface CoverComposition {
  /** Full cover dimensions (front + spine + back) in mm */
  totalWidth: number;
  totalHeight: number;
  /** Front cover area */
  frontCover: {
    x: number;
    y: number;
    width: number;
    height: number;
    elements: CoverTextElement[];
    backgroundImage: Buffer;
  };
  /** Spine area */
  spine: SpineSpec & { x: number; y: number; height: number };
  /** Back cover area */
  backCover: BackCoverSpec & { x: number; y: number; width: number; height: number };
  /** Bleed area in mm (added to all edges) */
  bleed: number;
  /** Ekonte analysis results */
  ekonteAnalysis: EkonteAnalysis;
}

export interface CoverDesignResult {
  /** The composed cover specification */
  composition: CoverComposition;
  /** Font set used */
  fonts: CoverFontSet;
  /** Design decisions made (for audit/debugging) */
  decisions: string[];
  /** Processing duration in ms */
  durationMs: number;
}

// ─── Genre Font Configurations ──────────────────────────────────────────────

const GENRE_FONT_SETS: Record<AnimeGenre, CoverFontSet> = {
  shonen: {
    title: { family: "Bebas Neue", weight: 700, sizePt: 48, color: "#FFFFFF", letterSpacing: 0.05, transform: "uppercase" },
    subtitle: { family: "Noto Sans JP", weight: 400, sizePt: 14, color: "#E0E0E0" },
    author: { family: "Noto Sans JP", weight: 500, sizePt: 12, color: "#FFFFFF" },
    volumeInfo: { family: "Bebas Neue", weight: 400, sizePt: 18, color: "#FFD700", transform: "uppercase" },
    spine: { family: "Bebas Neue", weight: 700, sizePt: 10, color: "#FFFFFF", transform: "uppercase" },
    synopsis: { family: "Noto Sans JP", weight: 400, sizePt: 10, color: "#333333" },
    genreTags: { family: "Noto Sans JP", weight: 600, sizePt: 8, color: "#FF4444", transform: "uppercase" },
  },
  shojo: {
    title: { family: "Playfair Display", weight: 700, sizePt: 42, color: "#FFFFFF", letterSpacing: 0.02 },
    subtitle: { family: "Noto Serif JP", weight: 400, sizePt: 13, color: "#F0E0F0" },
    author: { family: "Noto Serif JP", weight: 400, sizePt: 11, color: "#FFFFFF" },
    volumeInfo: { family: "Playfair Display", weight: 400, sizePt: 16, color: "#FFB6C1" },
    spine: { family: "Playfair Display", weight: 700, sizePt: 9, color: "#FFFFFF" },
    synopsis: { family: "Noto Serif JP", weight: 400, sizePt: 10, color: "#4A3040" },
    genreTags: { family: "Noto Serif JP", weight: 500, sizePt: 8, color: "#C77DBA" },
  },
  seinen: {
    title: { family: "Oswald", weight: 700, sizePt: 44, color: "#FFFFFF", letterSpacing: 0.03, transform: "uppercase" },
    subtitle: { family: "Noto Sans JP", weight: 300, sizePt: 13, color: "#CCCCCC" },
    author: { family: "Noto Sans JP", weight: 400, sizePt: 11, color: "#AAAAAA" },
    volumeInfo: { family: "Oswald", weight: 400, sizePt: 16, color: "#888888" },
    spine: { family: "Oswald", weight: 700, sizePt: 9, color: "#FFFFFF", transform: "uppercase" },
    synopsis: { family: "Noto Sans JP", weight: 400, sizePt: 10, color: "#222222" },
    genreTags: { family: "Noto Sans JP", weight: 500, sizePt: 8, color: "#666666", transform: "uppercase" },
  },
  josei: {
    title: { family: "Cormorant Garamond", weight: 600, sizePt: 40, color: "#FFFFFF", letterSpacing: 0.04 },
    subtitle: { family: "Noto Serif JP", weight: 400, sizePt: 12, color: "#E8D8E8" },
    author: { family: "Noto Serif JP", weight: 400, sizePt: 11, color: "#FFFFFF" },
    volumeInfo: { family: "Cormorant Garamond", weight: 400, sizePt: 15, color: "#D4A574" },
    spine: { family: "Cormorant Garamond", weight: 600, sizePt: 9, color: "#FFFFFF" },
    synopsis: { family: "Noto Serif JP", weight: 400, sizePt: 10, color: "#3A2A2A" },
    genreTags: { family: "Noto Serif JP", weight: 500, sizePt: 8, color: "#8B6B5B" },
  },
  kodomomuke: {
    title: { family: "Fredoka One", weight: 700, sizePt: 52, color: "#FFFFFF", letterSpacing: 0.02 },
    subtitle: { family: "Noto Sans JP", weight: 500, sizePt: 14, color: "#FFFFCC" },
    author: { family: "Noto Sans JP", weight: 500, sizePt: 12, color: "#FFFFFF" },
    volumeInfo: { family: "Fredoka One", weight: 400, sizePt: 20, color: "#FFE066" },
    spine: { family: "Fredoka One", weight: 700, sizePt: 10, color: "#FFFFFF" },
    synopsis: { family: "Noto Sans JP", weight: 400, sizePt: 11, color: "#333333" },
    genreTags: { family: "Noto Sans JP", weight: 600, sizePt: 9, color: "#FF6B35" },
  },
};

// ─── Genre Background Colors (back cover) ───────────────────────────────────

const GENRE_BACK_COLORS: Record<AnimeGenre, string> = {
  shonen: "#1A1A2E",
  shojo: "#FFF0F5",
  seinen: "#1C1C1C",
  josei: "#FDF5F0",
  kodomomuke: "#FFFDE7",
};

// ─── Ekonte Analysis ────────────────────────────────────────────────────────

/**
 * Analyze a key panel image to determine focal point and safe text zones.
 *
 * Uses a simplified luminance-based analysis:
 * - Divides image into 3x3 grid
 * - Computes average brightness per cell
 * - Identifies focal point as highest-contrast region
 * - Marks low-complexity regions as safe for text
 */
export function analyzeEkonte(imageBuffer: Buffer, width: number, height: number): EkonteAnalysis {
  // Simplified analysis based on buffer content distribution
  // In production, this would use actual image processing (sharp/canvas)
  const cellWidth = Math.floor(width / 3);
  const cellHeight = Math.floor(height / 3);
  const bytesPerPixel = 4; // RGBA
  const stride = width * bytesPerPixel;

  const cellBrightness: number[][] = [];
  let totalBrightness = 0;
  let maxContrast = 0;
  let focalX = 0.5;
  let focalY = 0.5;

  for (let row = 0; row < 3; row++) {
    cellBrightness[row] = [];
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      let count = 0;
      const startX = col * cellWidth;
      const startY = row * cellHeight;
      const endX = Math.min(startX + cellWidth, width);
      const endY = Math.min(startY + cellHeight, height);

      // Sample every 4th pixel for performance
      for (let y = startY; y < endY; y += 4) {
        for (let x = startX; x < endX; x += 4) {
          const offset = y * stride + x * bytesPerPixel;
          if (offset + 2 < imageBuffer.length) {
            // Luminance formula: 0.299R + 0.587G + 0.114B
            const lum = 0.299 * imageBuffer[offset] +
                        0.587 * imageBuffer[offset + 1] +
                        0.114 * imageBuffer[offset + 2];
            sum += lum;
            count++;
          }
        }
      }

      const avgBrightness = count > 0 ? sum / count / 255 : 0.5;
      cellBrightness[row][col] = avgBrightness;
      totalBrightness += avgBrightness;
    }
  }

  const averageBrightness = totalBrightness / 9;

  // Find focal point (highest contrast from average)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const contrast = Math.abs(cellBrightness[row][col] - averageBrightness);
      if (contrast > maxContrast) {
        maxContrast = contrast;
        focalX = (col + 0.5) / 3;
        focalY = (row + 0.5) / 3;
      }
    }
  }

  // Determine safe zones (cells with low visual complexity = close to average)
  const safeZones: TextPlacement[] = [];
  const placements: TextPlacement[][] = [
    ['top_left', 'top_center', 'top_right'],
    ['center_left', 'center', 'center_right'],
    ['bottom_left', 'bottom_center', 'bottom_right'],
  ];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const deviation = Math.abs(cellBrightness[row][col] - averageBrightness);
      // Low deviation = uniform area = safe for text
      if (deviation < 0.15) {
        safeZones.push(placements[row][col]);
      }
    }
  }

  // If no safe zones found, default to top and bottom edges
  if (safeZones.length === 0) {
    safeZones.push('top_center', 'bottom_center');
  }

  // Build dominant regions (cells significantly brighter or darker than average)
  const dominantRegions: EkonteAnalysis['dominantRegions'] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (Math.abs(cellBrightness[row][col] - averageBrightness) > 0.2) {
        const brightness = cellBrightness[row][col];
        const gray = Math.round(brightness * 255);
        dominantRegions.push({
          x: col / 3,
          y: row / 3,
          width: 1 / 3,
          height: 1 / 3,
          avgColor: `rgb(${gray},${gray},${gray})`,
        });
      }
    }
  }

  return {
    focalPoint: { x: focalX, y: focalY },
    dominantRegions,
    safeZones,
    averageBrightness,
  };
}

// ─── Text Placement Logic ───────────────────────────────────────────────────

/**
 * Determine optimal title placement based on ekonte analysis.
 * Avoids the focal point and prefers safe zones.
 */
function determineTitlePlacement(
  analysis: EkonteAnalysis,
  _genre: AnimeGenre
): TextPlacement {
  // Priority: opposite of focal point, within safe zones
  const focalRow = analysis.focalPoint.y < 0.33 ? 'top' :
                   analysis.focalPoint.y > 0.66 ? 'bottom' : 'center';
  const focalCol = analysis.focalPoint.x < 0.33 ? 'left' :
                   analysis.focalPoint.x > 0.66 ? 'right' : 'center';

  // Place title opposite to focal point vertically
  const preferredRow = focalRow === 'top' ? 'bottom' :
                       focalRow === 'bottom' ? 'top' : 'top';

  // Prefer center column for title
  const preferred = `${preferredRow}_center` as TextPlacement;

  // Check if preferred is in safe zones
  if (analysis.safeZones.includes(preferred)) {
    return preferred;
  }

  // Fallback: find any safe zone in preferred row
  const rowSafe = analysis.safeZones.find(z => z.startsWith(preferredRow));
  if (rowSafe) return rowSafe;

  // Last resort: top_center (most common manga cover title position)
  return 'top_center';
}

/**
 * Determine text color based on background brightness at placement location.
 */
function determineTextColor(analysis: EkonteAnalysis, placement: TextPlacement, defaultColor: string): string {
  const row = placement.startsWith('top') ? 0 : placement.startsWith('bottom') ? 2 : 1;
  const col = placement.endsWith('left') ? 0 : placement.endsWith('right') ? 2 : 1;

  // Check if there's a dominant region at this placement
  const region = analysis.dominantRegions.find(r =>
    Math.floor(r.x * 3) === col && Math.floor(r.y * 3) === row
  );

  if (region) {
    // Parse the gray value and choose contrasting color
    const match = region.avgColor.match(/\d+/);
    const gray = match ? parseInt(match[0]) : 128;
    return gray > 128 ? "#000000" : "#FFFFFF";
  }

  // Use brightness at placement to decide
  const localBrightness = analysis.averageBrightness;
  if (localBrightness > 0.6) return "#000000";
  if (localBrightness < 0.4) return "#FFFFFF";
  return defaultColor;
}

// ─── Placement Coordinate Mapping ───────────────────────────────────────────

function placementToCoordinates(
  placement: TextPlacement,
  areaWidth: number,
  areaHeight: number,
  elementWidth: number,
  _elementHeight: number
): { x: number; y: number } {
  let x = 0;
  let y = 0;

  // Horizontal
  if (placement.endsWith('left')) x = 10;
  else if (placement.endsWith('right')) x = areaWidth - elementWidth - 10;
  else x = (areaWidth - elementWidth) / 2; // center

  // Vertical
  if (placement.startsWith('top')) y = 15;
  else if (placement.startsWith('bottom')) y = areaHeight - 30;
  else y = areaHeight / 2;

  return { x, y };
}

// ─── Main Cover Design Function ─────────────────────────────────────────────

/**
 * Design a complete print cover (front + spine + back).
 *
 * Flow:
 * 1. Analyze key panel image (ekonte analysis)
 * 2. Select genre-appropriate fonts
 * 3. Calculate dimensions (trim + bleed + spine)
 * 4. Place title (avoiding focal point)
 * 5. Place volume info, author, and subtitle
 * 6. Generate spine text
 * 7. Compose back cover (synopsis + tags + barcode area)
 */
export function designCover(input: CoverInput): CoverDesignResult {
  const startMs = Date.now();
  const decisions: string[] = [];

  // ─── Step 1: Get trim dimensions ────────────────────────────────────────
  const trim = TRIM_SPECS[input.trimSize];
  const bleed = 3; // 3mm bleed on all sides (Lulu standard)

  // ─── Step 2: Calculate spine width ──────────────────────────────────────
  const { spineWidthMm: spineWidth } = calculateSpineWidth(input.pageCount);
  decisions.push(`Spine width: ${spineWidth.toFixed(1)}mm for ${input.pageCount} pages`);

  // ─── Step 3: Select fonts ───────────────────────────────────────────────
  const baseFonts = GENRE_FONT_SETS[input.genre];
  const fonts: CoverFontSet = {
    ...baseFonts,
    ...input.fontOverrides,
  };
  decisions.push(`Font set: ${input.genre} genre (title: ${fonts.title.family})`);

  // ─── Step 4: Analyze key panel ──────────────────────────────────────────
  // Estimate image dimensions from buffer size (assume RGBA)
  const estimatedPixels = input.keyPanelImage.length / 4;
  const aspectRatio = trim.widthMm / trim.heightMm;
  const estimatedWidth = Math.round(Math.sqrt(estimatedPixels * aspectRatio));
  const estimatedHeight = Math.round(estimatedWidth / aspectRatio);

  const ekonteAnalysis = analyzeEkonte(input.keyPanelImage, estimatedWidth, estimatedHeight);
  decisions.push(`Ekonte focal point: (${ekonteAnalysis.focalPoint.x.toFixed(2)}, ${ekonteAnalysis.focalPoint.y.toFixed(2)})`);
  decisions.push(`Safe zones: ${ekonteAnalysis.safeZones.join(', ')}`);
  decisions.push(`Average brightness: ${ekonteAnalysis.averageBrightness.toFixed(2)}`);

  // ─── Step 5: Determine title placement ──────────────────────────────────
  const titlePlacement = determineTitlePlacement(ekonteAnalysis, input.genre);
  const titleColor = determineTextColor(ekonteAnalysis, titlePlacement, fonts.title.color);
  decisions.push(`Title placement: ${titlePlacement} (color: ${titleColor})`);

  // ─── Step 6: Build front cover elements ─────────────────────────────────
  const frontElements: CoverTextElement[] = [];

  // Title
  const titleCoords = placementToCoordinates(
    titlePlacement, trim.widthMm, trim.heightMm, trim.widthMm * 0.8, 20
  );
  frontElements.push({
    text: input.title,
    font: { ...fonts.title, color: titleColor },
    placement: titlePlacement,
    offsetX: titleCoords.x,
    offsetY: titleCoords.y,
    maxWidth: trim.widthMm * 0.8,
    shadow: ekonteAnalysis.averageBrightness > 0.3 && ekonteAnalysis.averageBrightness < 0.7
      ? { offsetX: 1, offsetY: 1, blur: 3, color: "rgba(0,0,0,0.7)" }
      : undefined,
  });

  // Volume info
  const volumeText = input.chapterRange
    ? `Vol. ${input.volumeNumber} — ${input.chapterRange}`
    : `Vol. ${input.volumeNumber}`;
  const volumePlacement: TextPlacement = titlePlacement.startsWith('top') ? 'top_center' : 'bottom_center';
  const volumeOffsetY = titlePlacement.startsWith('top') ? titleCoords.y + 25 : titleCoords.y - 15;
  frontElements.push({
    text: volumeText,
    font: { ...fonts.volumeInfo, color: determineTextColor(ekonteAnalysis, volumePlacement, fonts.volumeInfo.color) },
    placement: volumePlacement,
    offsetX: titleCoords.x,
    offsetY: volumeOffsetY,
    maxWidth: trim.widthMm * 0.6,
  });

  // Subtitle (if provided)
  if (input.subtitle) {
    frontElements.push({
      text: input.subtitle,
      font: { ...fonts.subtitle, color: determineTextColor(ekonteAnalysis, volumePlacement, fonts.subtitle.color) },
      placement: volumePlacement,
      offsetX: titleCoords.x,
      offsetY: volumeOffsetY + 12,
      maxWidth: trim.widthMm * 0.7,
    });
  }

  // Author name (bottom, opposite side from title)
  const authorPlacement: TextPlacement = titlePlacement.startsWith('top') ? 'bottom_right' : 'top_right';
  const authorCoords = placementToCoordinates(
    authorPlacement, trim.widthMm, trim.heightMm, trim.widthMm * 0.4, 10
  );
  frontElements.push({
    text: input.authorName,
    font: { ...fonts.author, color: determineTextColor(ekonteAnalysis, authorPlacement, fonts.author.color) },
    placement: authorPlacement,
    offsetX: authorCoords.x,
    offsetY: authorCoords.y,
    maxWidth: trim.widthMm * 0.4,
    shadow: { offsetX: 0.5, offsetY: 0.5, blur: 2, color: "rgba(0,0,0,0.5)" },
  });

  decisions.push(`Front cover: ${frontElements.length} text elements placed`);

  // ─── Step 7: Build spine ────────────────────────────────────────────────
  const spineElements: CoverTextElement[] = [];

  // Spine text (rotated 90° — title + vol + author)
  const spineText = `${input.title}  |  Vol. ${input.volumeNumber}  |  ${input.authorName}`;
  spineElements.push({
    text: spineText,
    font: fonts.spine,
    placement: 'center',
    offsetX: 0,
    offsetY: 0,
    maxWidth: trim.heightMm - 20, // Spine text runs along height
    rotation: 270, // Standard manga spine rotation
  });

  // ─── Step 8: Build back cover ───────────────────────────────────────────
  const backColor = GENRE_BACK_COLORS[input.genre];
  const backElements: CoverTextElement[] = [];

  // Synopsis
  let synopsisElement: CoverTextElement | undefined;
  if (input.synopsis) {
    synopsisElement = {
      text: input.synopsis,
      font: fonts.synopsis,
      placement: 'top_center',
      offsetX: 15,
      offsetY: 20,
      maxWidth: trim.widthMm - 30,
    };
  }

  // Genre tags
  const genreTagElements: CoverTextElement[] = [];
  if (input.genreTags && input.genreTags.length > 0) {
    input.genreTags.forEach((tag, i) => {
      genreTagElements.push({
        text: tag,
        font: fonts.genreTags,
        placement: 'bottom_left',
        offsetX: 15 + i * 35,
        offsetY: trim.heightMm - 45,
        maxWidth: 30,
      });
    });
  }

  // Barcode area (standard position: bottom-right of back cover)
  const barcodeArea = {
    x: trim.widthMm - 55,
    y: trim.heightMm - 40,
    width: 45,
    height: 30,
  };

  decisions.push(`Back cover: ${backColor} background, barcode at (${barcodeArea.x}, ${barcodeArea.y})`);

  // ─── Step 9: Compose final layout ──────────────────────────────────────
  const totalWidth = trim.widthMm + spineWidth + trim.widthMm + (bleed * 2);
  const totalHeight = trim.heightMm + (bleed * 2);

  const composition: CoverComposition = {
    totalWidth,
    totalHeight,
    frontCover: {
      x: bleed + trim.widthMm + spineWidth,
      y: bleed,
      width: trim.widthMm,
      height: trim.heightMm,
      elements: frontElements,
      backgroundImage: input.keyPanelImage,
    },
    spine: {
      x: bleed + trim.widthMm,
      y: bleed,
      width: spineWidth,
      height: trim.heightMm,
      elements: spineElements,
    },
    backCover: {
      x: bleed,
      y: bleed,
      width: trim.widthMm,
      height: trim.heightMm,
      synopsis: synopsisElement,
      genreTags: genreTagElements,
      barcodeArea,
      backgroundColor: backColor,
    },
    bleed,
    ekonteAnalysis,
  };

  return {
    composition,
    fonts,
    decisions,
    durationMs: Date.now() - startMs,
  };
}

// ─── Cover Template Presets ─────────────────────────────────────────────────

export interface CoverTemplate {
  id: string;
  name: string;
  genre: AnimeGenre;
  trimSize: TrimSize;
  orientation: CoverOrientation;
  /** Default title placement override */
  titlePlacement?: TextPlacement;
  /** Font overrides for this template */
  fontOverrides?: Partial<CoverFontSet>;
  /** Back cover color override */
  backColor?: string;
}

/**
 * Generate all available cover templates (4 trims × 5 genres × 2 orientations).
 */
export function getCoverTemplates(): CoverTemplate[] {
  const templates: CoverTemplate[] = [];
  const trims: TrimSize[] = ['b5', 'a5', 'tankobon', 'us_trade'];
  const genres: AnimeGenre[] = ['shonen', 'shojo', 'seinen', 'josei', 'kodomomuke'];
  const orientations: CoverOrientation[] = ['portrait', 'landscape'];

  for (const trimSize of trims) {
    for (const genre of genres) {
      for (const orientation of orientations) {
        templates.push({
          id: `${trimSize}_${genre}_${orientation}`,
          name: `${genre.charAt(0).toUpperCase() + genre.slice(1)} ${trimSize.toUpperCase()} (${orientation})`,
          genre,
          trimSize,
          orientation,
        });
      }
    }
  }

  return templates;
}

/**
 * Get the number of available templates.
 */
export function getTemplateCount(): number {
  return 4 * 5 * 2; // 40 templates
}
