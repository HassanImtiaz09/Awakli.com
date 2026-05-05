/**
 * D10.M Sub-Task 1c: Page Compositor
 *
 * Arranges panels into manga page layouts with proper gutters, bleed marks,
 * and crop marks. Supports multiple layout templates and reading directions.
 *
 * Blueprint: Stage 5.5 branch — Manga Finishing
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReadingDirection = 'rtl' | 'ltr';

export type TrimSize = 'b5' | 'a5' | 'tankobon' | 'us_trade';

export type LayoutTemplate =
  | 'grid_4'          // 2×2 grid (4 panels)
  | 'grid_6'          // 2×3 or 3×2 asymmetric (6 panels)
  | 'splash'          // single panel full page
  | 'double_spread'   // single panel across 2 pages
  | 'l_shape'         // L-shaped layout (1 large + 2 small)
  | 'vertical_strip'  // 3 horizontal strips
  | 'dynamic';        // auto-select based on panel count

export interface PanelSlot {
  /** Panel ID reference */
  panelId: number;
  /** Position within page (normalized 0-1) */
  x: number;
  y: number;
  /** Size within page (normalized 0-1) */
  width: number;
  height: number;
  /** Panel image buffer (RGBA, already with screentone + bubbles) */
  imageBuffer: Buffer;
  /** Original pixel dimensions */
  pixelWidth: number;
  pixelHeight: number;
}

export interface PageCompositorInput {
  /** Panels to arrange on this page */
  panels: PanelSlot[];
  /** Trim size of the final print */
  trimSize: TrimSize;
  /** Layout template to use */
  layout: LayoutTemplate;
  /** Reading direction */
  readingDirection: ReadingDirection;
  /** Page number (for numbering) */
  pageNumber: number;
  /** Whether to add bleed marks */
  addBleed: boolean;
  /** Whether to add crop marks */
  addCropMarks: boolean;
}

export interface ComposedPage {
  /** Final page image buffer (RGBA) */
  pageBuffer: Buffer;
  /** Page dimensions in px (at 300 DPI) */
  widthPx: number;
  heightPx: number;
  /** Trim size used */
  trimSize: TrimSize;
  /** Page number */
  pageNumber: number;
  /** Panel positions in final page coordinates */
  panelPositions: Array<{
    panelId: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  /** Processing time in ms */
  processingTimeMs: number;
}

// ─── Trim Size Specifications ─────────────────────────────────────────────────

/**
 * Trim sizes at 300 DPI (pixels).
 * Includes bleed area (3mm = ~35px at 300dpi).
 */
export const TRIM_SPECS: Record<TrimSize, {
  /** Trim width in mm */
  widthMm: number;
  /** Trim height in mm */
  heightMm: number;
  /** Width in px at 300 DPI */
  widthPx: number;
  /** Height in px at 300 DPI */
  heightPx: number;
  /** Bleed in px (3mm at 300 DPI) */
  bleedPx: number;
  /** Safe margin in px (5mm at 300 DPI) */
  safeMarginPx: number;
  /** Gutter width between panels in px */
  gutterPx: number;
  /** Display name */
  displayName: string;
  /** Lulu pod package ID prefix */
  luluPackagePrefix: string;
}> = {
  b5: {
    widthMm: 176,
    heightMm: 250,
    widthPx: 2079,
    heightPx: 2953,
    bleedPx: 35,
    safeMarginPx: 59,
    gutterPx: 12,
    displayName: 'B5 (176×250mm)',
    luluPackagePrefix: '0693X0984',
  },
  a5: {
    widthMm: 148,
    heightMm: 210,
    widthPx: 1748,
    heightPx: 2480,
    bleedPx: 35,
    safeMarginPx: 59,
    gutterPx: 10,
    displayName: 'A5 (148×210mm)',
    luluPackagePrefix: '0583X0827',
  },
  tankobon: {
    widthMm: 128,
    heightMm: 182,
    widthPx: 1512,
    heightPx: 2150,
    bleedPx: 35,
    safeMarginPx: 59,
    gutterPx: 8,
    displayName: 'Tankōbon (128×182mm)',
    luluPackagePrefix: '0504X0717',
  },
  us_trade: {
    widthMm: 152,
    heightMm: 229,
    widthPx: 1795,
    heightPx: 2705,
    bleedPx: 35,
    safeMarginPx: 59,
    gutterPx: 10,
    displayName: 'US Trade (6×9")',
    luluPackagePrefix: '0600X0900',
  },
};

// ─── Layout Templates ─────────────────────────────────────────────────────────

/**
 * Layout template definitions.
 * Each template defines panel slot positions as normalized (0-1) coordinates
 * within the printable area (inside margins).
 */
export interface LayoutSlotDef {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getLayoutSlots(
  template: LayoutTemplate,
  panelCount: number,
  readingDirection: ReadingDirection
): LayoutSlotDef[] {
  let slots: LayoutSlotDef[];

  switch (template) {
    case 'splash':
      slots = [{ x: 0, y: 0, width: 1, height: 1 }];
      break;

    case 'double_spread':
      slots = [{ x: 0, y: 0, width: 1, height: 1 }];
      break;

    case 'grid_4':
      slots = [
        { x: 0, y: 0, width: 0.48, height: 0.48 },
        { x: 0.52, y: 0, width: 0.48, height: 0.48 },
        { x: 0, y: 0.52, width: 0.48, height: 0.48 },
        { x: 0.52, y: 0.52, width: 0.48, height: 0.48 },
      ];
      break;

    case 'grid_6':
      slots = [
        { x: 0, y: 0, width: 0.48, height: 0.31 },
        { x: 0.52, y: 0, width: 0.48, height: 0.31 },
        { x: 0, y: 0.34, width: 0.48, height: 0.31 },
        { x: 0.52, y: 0.34, width: 0.48, height: 0.31 },
        { x: 0, y: 0.68, width: 0.48, height: 0.31 },
        { x: 0.52, y: 0.68, width: 0.48, height: 0.31 },
      ];
      break;

    case 'l_shape':
      slots = [
        { x: 0, y: 0, width: 0.6, height: 0.65 },     // large panel
        { x: 0.63, y: 0, width: 0.37, height: 0.31 },  // small top-right
        { x: 0.63, y: 0.34, width: 0.37, height: 0.31 }, // small mid-right
        { x: 0, y: 0.68, width: 1, height: 0.31 },     // wide bottom
      ];
      break;

    case 'vertical_strip':
      slots = [
        { x: 0, y: 0, width: 1, height: 0.31 },
        { x: 0, y: 0.34, width: 1, height: 0.31 },
        { x: 0, y: 0.68, width: 1, height: 0.31 },
      ];
      break;

    case 'dynamic':
    default:
      slots = selectDynamicLayout(panelCount);
      break;
  }

  // Mirror for RTL reading direction
  if (readingDirection === 'rtl') {
    slots = slots.map(s => ({
      ...s,
      x: 1 - s.x - s.width,
    }));
  }

  return slots;
}

/**
 * Auto-select layout based on panel count.
 */
function selectDynamicLayout(panelCount: number): LayoutSlotDef[] {
  if (panelCount <= 1) return getLayoutSlots('splash', 1, 'ltr');
  if (panelCount <= 3) return getLayoutSlots('vertical_strip', 3, 'ltr');
  if (panelCount <= 4) return getLayoutSlots('grid_4', 4, 'ltr');
  return getLayoutSlots('grid_6', 6, 'ltr');
}

// ─── Compositing Engine ───────────────────────────────────────────────────────

/**
 * Scale and place a panel image into a slot within the page buffer.
 */
export function placePanel(
  pageBuffer: Buffer,
  pageWidth: number,
  _pageHeight: number,
  panel: PanelSlot,
  slotX: number,
  slotY: number,
  slotWidth: number,
  slotHeight: number
): void {
  // Simple nearest-neighbor scaling for placement
  const scaleX = panel.pixelWidth / slotWidth;
  const scaleY = panel.pixelHeight / slotHeight;

  for (let dy = 0; dy < slotHeight; dy++) {
    for (let dx = 0; dx < slotWidth; dx++) {
      const srcX = Math.min(panel.pixelWidth - 1, Math.floor(dx * scaleX));
      const srcY = Math.min(panel.pixelHeight - 1, Math.floor(dy * scaleY));
      const srcOffset = (srcY * panel.pixelWidth + srcX) * 4;

      const destX = slotX + dx;
      const destY = slotY + dy;
      const destOffset = (destY * pageWidth + destX) * 4;

      // Copy RGBA
      pageBuffer[destOffset] = panel.imageBuffer[srcOffset];
      pageBuffer[destOffset + 1] = panel.imageBuffer[srcOffset + 1];
      pageBuffer[destOffset + 2] = panel.imageBuffer[srcOffset + 2];
      pageBuffer[destOffset + 3] = panel.imageBuffer[srcOffset + 3];
    }
  }
}

/**
 * Draw crop marks at the corners of the trim area.
 */
export function drawCropMarks(
  pageBuffer: Buffer,
  pageWidth: number,
  pageHeight: number,
  bleedPx: number
): void {
  const markLength = 20;
  const markColor = { r: 0, g: 0, b: 0, a: 255 };

  // Helper to draw a line
  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const px = Math.round(x1 + (x2 - x1) * t);
      const py = Math.round(y1 + (y2 - y1) * t);
      if (px >= 0 && px < pageWidth && py >= 0 && py < pageHeight) {
        const offset = (py * pageWidth + px) * 4;
        pageBuffer[offset] = markColor.r;
        pageBuffer[offset + 1] = markColor.g;
        pageBuffer[offset + 2] = markColor.b;
        pageBuffer[offset + 3] = markColor.a;
      }
    }
  };

  // Top-left corner
  drawLine(bleedPx, 0, bleedPx, markLength);
  drawLine(0, bleedPx, markLength, bleedPx);

  // Top-right corner
  drawLine(pageWidth - bleedPx, 0, pageWidth - bleedPx, markLength);
  drawLine(pageWidth - markLength, bleedPx, pageWidth, bleedPx);

  // Bottom-left corner
  drawLine(bleedPx, pageHeight - markLength, bleedPx, pageHeight);
  drawLine(0, pageHeight - bleedPx, markLength, pageHeight - bleedPx);

  // Bottom-right corner
  drawLine(pageWidth - bleedPx, pageHeight - markLength, pageWidth - bleedPx, pageHeight);
  drawLine(pageWidth - markLength, pageHeight - bleedPx, pageWidth, pageHeight - bleedPx);
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Compose panels into a single manga page.
 */
export async function composePage(input: PageCompositorInput): Promise<ComposedPage> {
  const startTime = Date.now();
  const spec = TRIM_SPECS[input.trimSize];

  // Total page size includes bleed if requested
  const totalWidth = input.addBleed ? spec.widthPx + spec.bleedPx * 2 : spec.widthPx;
  const totalHeight = input.addBleed ? spec.heightPx + spec.bleedPx * 2 : spec.heightPx;

  // Create white page buffer (RGBA)
  const pageBuffer = Buffer.alloc(totalWidth * totalHeight * 4, 255);

  // Printable area (inside margins)
  const marginOffset = input.addBleed ? spec.bleedPx + spec.safeMarginPx : spec.safeMarginPx;
  const printableWidth = totalWidth - marginOffset * 2;
  const printableHeight = totalHeight - marginOffset * 2;

  // Get layout slots
  const slots = getLayoutSlots(input.layout, input.panels.length, input.readingDirection);

  // Place panels into slots
  const panelPositions: ComposedPage['panelPositions'] = [];

  for (let i = 0; i < Math.min(input.panels.length, slots.length); i++) {
    const panel = input.panels[i];
    const slot = slots[i];

    // Convert normalized slot to pixel coordinates
    const slotX = Math.round(marginOffset + slot.x * printableWidth);
    const slotY = Math.round(marginOffset + slot.y * printableHeight);
    const slotWidth = Math.round(slot.width * printableWidth);
    const slotHeight = Math.round(slot.height * printableHeight);

    // Place panel (scaled to fit slot)
    placePanel(pageBuffer, totalWidth, totalHeight, panel, slotX, slotY, slotWidth, slotHeight);

    panelPositions.push({
      panelId: panel.panelId,
      x: slotX,
      y: slotY,
      width: slotWidth,
      height: slotHeight,
    });
  }

  // Add crop marks if requested
  if (input.addCropMarks && input.addBleed) {
    drawCropMarks(pageBuffer, totalWidth, totalHeight, spec.bleedPx);
  }

  return {
    pageBuffer,
    widthPx: totalWidth,
    heightPx: totalHeight,
    trimSize: input.trimSize,
    pageNumber: input.pageNumber,
    panelPositions,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Auto-paginate a list of panels into composed pages.
 * Selects layout templates dynamically based on panel count per page.
 */
export async function autoCompose(
  panels: PanelSlot[],
  options: {
    trimSize: TrimSize;
    readingDirection: ReadingDirection;
    panelsPerPage?: number;
    addBleed?: boolean;
    addCropMarks?: boolean;
  }
): Promise<ComposedPage[]> {
  const panelsPerPage = options.panelsPerPage ?? 4;
  const pages: ComposedPage[] = [];

  for (let i = 0; i < panels.length; i += panelsPerPage) {
    const pagePanels = panels.slice(i, i + panelsPerPage);
    const pageNumber = Math.floor(i / panelsPerPage) + 1;

    // Select layout based on panel count
    let layout: LayoutTemplate;
    if (pagePanels.length === 1) layout = 'splash';
    else if (pagePanels.length <= 3) layout = 'vertical_strip';
    else if (pagePanels.length <= 4) layout = 'grid_4';
    else layout = 'grid_6';

    const page = await composePage({
      panels: pagePanels,
      trimSize: options.trimSize,
      layout,
      readingDirection: options.readingDirection,
      pageNumber,
      addBleed: options.addBleed ?? true,
      addCropMarks: options.addCropMarks ?? true,
    });

    pages.push(page);
  }

  return pages;
}
