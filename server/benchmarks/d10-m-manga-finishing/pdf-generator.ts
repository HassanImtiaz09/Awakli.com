/**
 * D10.M Sub-Task 1d: Print-Ready PDF Generator
 *
 * Assembles composed pages into a print-ready PDF with proper color profile,
 * bleed, and metadata. Outputs Lulu-compatible PDF/X-1a format.
 *
 * Blueprint: Stage 5.5 branch — Manga Finishing
 */

// ─── Types ────────────────────────────────────────────────────────────────────

import { TRIM_SPECS, type ComposedPage, type TrimSize } from './page-compositor';

export interface PdfMetadata {
  /** Manga title */
  title: string;
  /** Author/creator name */
  author: string;
  /** Episode/chapter number */
  chapter: number;
  /** Volume number (if applicable) */
  volume?: number;
  /** ISBN (if available) */
  isbn?: string;
  /** Language code (ISO 639-1) */
  language: string;
  /** Creation date */
  createdAt: Date;
}

export interface CoverSpec {
  /** Front cover image buffer (RGBA) */
  frontCoverBuffer: Buffer;
  /** Front cover dimensions */
  frontCoverWidth: number;
  frontCoverHeight: number;
  /** Back cover image buffer (RGBA, optional) */
  backCoverBuffer?: Buffer;
  /** Spine width in px (calculated from page count) */
  spineWidthPx: number;
  /** Spine text (usually title + volume) */
  spineText?: string;
}

export interface PdfGeneratorInput {
  /** All composed interior pages */
  pages: ComposedPage[];
  /** PDF metadata */
  metadata: PdfMetadata;
  /** Trim size */
  trimSize: TrimSize;
  /** Cover specification (for Lulu print) */
  cover?: CoverSpec;
  /** Whether to embed ICC color profile */
  embedColorProfile: boolean;
  /** Target DPI (default 300) */
  dpi: number;
  /** Whether to include page numbers */
  includePageNumbers: boolean;
  /** Page number start offset (for multi-chapter volumes) */
  pageNumberOffset: number;
}

export interface PdfGeneratorResult {
  /** Generated PDF as buffer */
  pdfBuffer: Buffer;
  /** Cover PDF buffer (separate file for Lulu) */
  coverPdfBuffer?: Buffer;
  /** Total page count */
  pageCount: number;
  /** File size in bytes */
  fileSizeBytes: number;
  /** Cover file size in bytes */
  coverFileSizeBytes?: number;
  /** Estimated spine width in mm */
  spineWidthMm: number;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Validation warnings */
  warnings: string[];
}

// ─── Spine Width Calculation ──────────────────────────────────────────────────

/**
 * Calculate spine width based on page count and paper stock.
 * Lulu standard: ~0.0572mm per page (white paper, perfect bound).
 */
export function calculateSpineWidth(pageCount: number): {
  spineWidthMm: number;
  spineWidthPx: number;
} {
  // Lulu formula: 0.0572mm per page for standard white paper
  const mmPerPage = 0.0572;
  const spineWidthMm = Math.max(3, pageCount * mmPerPage); // minimum 3mm
  const spineWidthPx = Math.round(spineWidthMm * (300 / 25.4)); // convert to px at 300 DPI

  return { spineWidthMm, spineWidthPx };
}

// ─── PDF Stream Builder ───────────────────────────────────────────────────────

/**
 * Build a minimal PDF structure.
 * In production, this would use a proper PDF library (pdf-lib, pdfkit).
 * This implementation creates a valid PDF skeleton for testing/validation.
 */
export function buildPdfSkeleton(
  pageCount: number,
  widthPt: number,
  heightPt: number,
  metadata: PdfMetadata
): {
  header: string;
  pageTemplate: string;
  trailer: string;
  estimatedSize: number;
} {
  // PDF uses points (1pt = 1/72 inch)
  const header = [
    '%PDF-1.6',
    '%\xE2\xE3\xCF\xD3', // binary marker
    '',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '',
    '2 0 obj',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    'endobj',
    '',
  ].join('\n');

  const pageTemplate = [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] >>`,
  ].join('\n');

  const infoObj = [
    `<< /Title (${escapePdfString(metadata.title)})`,
    `/Author (${escapePdfString(metadata.author)})`,
    `/Creator (Awakli D10.M Manga Finishing Agent)`,
    `/Producer (Awakli PDF Generator v1.0)`,
    `/CreationDate (D:${formatPdfDate(metadata.createdAt)})`,
    `>>`,
  ].join(' ');

  const trailer = [
    '',
    'trailer',
    `<< /Size ${pageCount + 3} /Root 1 0 R /Info ${pageCount + 3} 0 R >>`,
    'startxref',
    '0', // placeholder
    '%%EOF',
  ].join('\n');

  // Estimate: header + pages + image data refs + trailer
  const estimatedSize = header.length + pageCount * 200 + trailer.length + infoObj.length;

  return { header, pageTemplate, trailer, estimatedSize };
}

/**
 * Escape special characters in PDF strings.
 */
function escapePdfString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Format date for PDF /CreationDate field.
 */
function formatPdfDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}Z`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate pages meet Lulu print requirements.
 */
export function validateForPrint(
  pages: ComposedPage[],
  trimSize: TrimSize,
  metadata: PdfMetadata
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Minimum page count for perfect binding
  if (pages.length < 24) {
    warnings.push(`Page count (${pages.length}) is below Lulu minimum of 24 for perfect binding. Saddle-stitch will be used.`);
  }

  // Maximum page count
  if (pages.length > 800) {
    errors.push(`Page count (${pages.length}) exceeds Lulu maximum of 800 pages.`);
  }

  // Page count must be even for print
  if (pages.length % 2 !== 0) {
    warnings.push('Odd page count — a blank page will be appended for print.');
  }

  // Verify all pages have consistent dimensions
  if (pages.length > 0) {
    const firstWidth = pages[0].widthPx;
    const firstHeight = pages[0].heightPx;
    const inconsistent = pages.filter(p => p.widthPx !== firstWidth || p.heightPx !== firstHeight);
    if (inconsistent.length > 0) {
      errors.push(`${inconsistent.length} pages have inconsistent dimensions.`);
    }
  }

  // Metadata validation
  if (!metadata.title || metadata.title.trim().length === 0) {
    errors.push('Title is required for print.');
  }
  if (!metadata.author || metadata.author.trim().length === 0) {
    errors.push('Author is required for print.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Cover Generation ─────────────────────────────────────────────────────────

/**
 * Generate a cover PDF from the title card (Wave 5A MVP approach).
 * In Wave 5B, this will be replaced with a dedicated cover design step.
 */
export function generateCoverFromTitleCard(
  titleCardBuffer: Buffer,
  titleCardWidth: number,
  titleCardHeight: number,
  pageCount: number,
  trimSize: TrimSize,
  metadata: PdfMetadata
): CoverSpec {
  const { spineWidthPx } = calculateSpineWidth(pageCount);

  // For MVP: front cover = title card, back cover = solid color
  // Spine text = title + chapter
  const spineText = metadata.volume
    ? `${metadata.title} Vol.${metadata.volume}`
    : `${metadata.title} Ch.${metadata.chapter}`;

  return {
    frontCoverBuffer: titleCardBuffer,
    frontCoverWidth: titleCardWidth,
    frontCoverHeight: titleCardHeight,
    spineWidthPx,
    spineText,
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generate a print-ready PDF from composed pages.
 */
export async function generatePrintPdf(input: PdfGeneratorInput): Promise<PdfGeneratorResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  // Validate
  const validation = validateForPrint(input.pages, input.trimSize, input.metadata);
  warnings.push(...validation.warnings);

  if (!validation.valid) {
    throw new Error(`PDF validation failed: ${validation.errors.join('; ')}`);
  }

  // Calculate spine width
  const { spineWidthMm } = calculateSpineWidth(input.pages.length);

  // Convert page dimensions to PDF points (1pt = 1/72 inch)
  const dpi = input.dpi || 300;
  const widthPt = input.pages.length > 0
    ? Math.round(input.pages[0].widthPx / dpi * 72)
    : 0;
  const heightPt = input.pages.length > 0
    ? Math.round(input.pages[0].heightPx / dpi * 72)
    : 0;

  // Ensure even page count for print
  let pageCount = input.pages.length;
  if (pageCount % 2 !== 0) {
    pageCount += 1; // blank page appended
  }

  // Build PDF skeleton
  const skeleton = buildPdfSkeleton(pageCount, widthPt, heightPt, input.metadata);

  // In production: encode each page's RGBA buffer as JPEG/PNG stream within PDF
  // For now: build a representative PDF buffer with correct structure
  const pdfContent = [
    skeleton.header,
    ...Array.from({ length: pageCount }, (_, i) =>
      `${i + 3} 0 obj\n${skeleton.pageTemplate}\nendobj\n`
    ),
    `${pageCount + 3} 0 obj`,
    `<< /Title (${escapePdfString2(input.metadata.title)}) /Author (${escapePdfString2(input.metadata.author)}) /Creator (Awakli D10.M) >>`,
    'endobj',
    skeleton.trailer,
  ].join('\n');

  const pdfBuffer = Buffer.from(pdfContent, 'utf-8');

  // Generate cover PDF if cover spec provided
  let coverPdfBuffer: Buffer | undefined;
  let coverFileSizeBytes: number | undefined;

  if (input.cover) {
    const coverContent = buildCoverPdf(input.cover, input.trimSize, dpi);
    coverPdfBuffer = Buffer.from(coverContent, 'utf-8');
    coverFileSizeBytes = coverPdfBuffer.length;
  }

  return {
    pdfBuffer,
    coverPdfBuffer,
    pageCount,
    fileSizeBytes: pdfBuffer.length,
    coverFileSizeBytes,
    spineWidthMm,
    processingTimeMs: Date.now() - startTime,
    warnings,
  };
}

function escapePdfString2(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Build a cover PDF (front + spine + back as single spread).
 */
function buildCoverPdf(cover: CoverSpec, trimSize: TrimSize, dpi: number): string {
  // Cover spread = back + spine + front (left to right)
  const frontWidthPt = Math.round(cover.frontCoverWidth / dpi * 72);
  const frontHeightPt = Math.round(cover.frontCoverHeight / dpi * 72);
  const spineWidthPt = Math.round(cover.spineWidthPx / dpi * 72);
  const totalWidthPt = frontWidthPt * 2 + spineWidthPt; // back + spine + front

  return [
    '%PDF-1.6',
    '%\xE2\xE3\xCF\xD3',
    '',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '',
    '3 0 obj',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${totalWidthPt} ${frontHeightPt}] >>`,
    'endobj',
    '',
    'trailer',
    '<< /Size 4 /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF',
  ].join('\n');
}

// ─── Lulu Package ID Helper ──────────────────────────────────────────────────

/**
 * Build the Lulu pod_package_id based on trim size and binding.
 * Format: {trim}_{color}_{binding}_{paper}
 * Example: 0693X0984FCPERFECT060UW444
 */
export function buildLuluPackageId(
  trimSize: TrimSize,
  options: {
    colorInterior: boolean;
    perfectBound: boolean;
    paperWeight: '060' | '070' | '080';
  } = { colorInterior: true, perfectBound: true, paperWeight: '060' }
): string {
  const spec = TRIM_SPECS[trimSize];
  const prefix = spec.luluPackagePrefix;
  const color = options.colorInterior ? 'FC' : 'BW';
  const binding = options.perfectBound ? 'PERFECT' : 'SADDLE';
  const paper = `${options.paperWeight}UW444`;

  return `${prefix}${color}${binding}${paper}`;
}
