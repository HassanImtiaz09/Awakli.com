/**
 * D10.M Sub-Task 1b: Dialogue Bubble Renderer
 *
 * Renders typeset dialogue bubbles onto manga panels.
 * Bubble types: speech (oval), thought (cloud), narration (box), SFX (angular).
 * Font selection by genre (Shōnen=bold, Shōjo=rounded, Seinen=clean).
 *
 * Blueprint: Stage 5.5 branch — Manga Finishing
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type BubbleType = 'speech' | 'thought' | 'narration' | 'sfx' | 'whisper';

export type ReadingDirection = 'rtl' | 'ltr';

export type AnimeGenre = 'shonen' | 'shojo' | 'seinen' | 'josei' | 'kodomomuke';

export interface DialogueLine {
  /** Speaker character name (null for narration/SFX) */
  speaker: string | null;
  /** The dialogue text content */
  text: string;
  /** Type of bubble to render */
  type: BubbleType;
  /** Position hint: where in the panel to place (0-1 normalized x,y) */
  positionHint?: { x: number; y: number };
  /** Emphasis level (affects font size and bubble styling) */
  emphasis?: 'normal' | 'loud' | 'whisper';
}

export interface BubbleStyle {
  /** Background color (hex) */
  backgroundColor: string;
  /** Border color (hex) */
  borderColor: string;
  /** Border width in px */
  borderWidth: number;
  /** Font family name */
  fontFamily: string;
  /** Base font size in px */
  fontSize: number;
  /** Font weight */
  fontWeight: 'normal' | 'bold' | 'black';
  /** Text color */
  textColor: string;
  /** Padding inside bubble (px) */
  padding: number;
  /** Corner radius for box-type bubbles */
  borderRadius: number;
  /** Tail direction (points toward speaker) */
  tailDirection: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'none';
}

export interface BubbleLayout {
  /** Bounding box of the bubble (px, absolute within panel) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The resolved style for this bubble */
  style: BubbleStyle;
  /** The dialogue line this bubble renders */
  dialogue: DialogueLine;
  /** Z-index for layering (higher = on top) */
  zIndex: number;
}

export interface BubbleRenderInput {
  /** Panel width in px */
  panelWidth: number;
  /** Panel height in px */
  panelHeight: number;
  /** All dialogue lines for this panel */
  dialogueLines: DialogueLine[];
  /** Genre (affects font/style selection) */
  genre: AnimeGenre;
  /** Reading direction (affects bubble placement order) */
  readingDirection: ReadingDirection;
  /** Panel image buffer (RGBA) for compositing */
  panelImageBuffer: Buffer;
}

export interface BubbleRenderResult {
  /** Composited image buffer with bubbles rendered */
  outputBuffer: Buffer;
  /** Layout information for each bubble */
  layouts: BubbleLayout[];
  /** Processing time in ms */
  processingTimeMs: number;
  /** Number of bubbles rendered */
  bubbleCount: number;
}

// ─── Font & Style Configuration ───────────────────────────────────────────────

/**
 * Genre → font configuration mapping.
 * Defines the typographic personality of each genre.
 */
export const GENRE_FONT_CONFIG: Record<AnimeGenre, {
  speech: { fontFamily: string; fontWeight: 'normal' | 'bold' | 'black'; fontSize: number };
  thought: { fontFamily: string; fontWeight: 'normal' | 'bold' | 'black'; fontSize: number };
  narration: { fontFamily: string; fontWeight: 'normal' | 'bold' | 'black'; fontSize: number };
  sfx: { fontFamily: string; fontWeight: 'normal' | 'bold' | 'black'; fontSize: number };
  whisper: { fontFamily: string; fontWeight: 'normal' | 'bold' | 'black'; fontSize: number };
}> = {
  shonen: {
    speech: { fontFamily: 'Noto Sans JP', fontWeight: 'bold', fontSize: 14 },
    thought: { fontFamily: 'Noto Sans JP', fontWeight: 'normal', fontSize: 12 },
    narration: { fontFamily: 'Noto Serif JP', fontWeight: 'normal', fontSize: 11 },
    sfx: { fontFamily: 'Impact', fontWeight: 'black', fontSize: 24 },
    whisper: { fontFamily: 'Noto Sans JP', fontWeight: 'normal', fontSize: 10 },
  },
  shojo: {
    speech: { fontFamily: 'Kosugi Maru', fontWeight: 'normal', fontSize: 13 },
    thought: { fontFamily: 'Kosugi Maru', fontWeight: 'normal', fontSize: 12 },
    narration: { fontFamily: 'Noto Serif JP', fontWeight: 'normal', fontSize: 11 },
    sfx: { fontFamily: 'Kosugi Maru', fontWeight: 'bold', fontSize: 20 },
    whisper: { fontFamily: 'Kosugi Maru', fontWeight: 'normal', fontSize: 10 },
  },
  seinen: {
    speech: { fontFamily: 'Noto Sans JP', fontWeight: 'normal', fontSize: 12 },
    thought: { fontFamily: 'Noto Sans JP', fontWeight: 'normal', fontSize: 11 },
    narration: { fontFamily: 'Noto Serif JP', fontWeight: 'normal', fontSize: 11 },
    sfx: { fontFamily: 'Noto Sans JP', fontWeight: 'bold', fontSize: 18 },
    whisper: { fontFamily: 'Noto Sans JP', fontWeight: 'normal', fontSize: 9 },
  },
  josei: {
    speech: { fontFamily: 'Noto Sans JP', fontWeight: 'normal', fontSize: 12 },
    thought: { fontFamily: 'Noto Serif JP', fontWeight: 'normal', fontSize: 11 },
    narration: { fontFamily: 'Noto Serif JP', fontWeight: 'normal', fontSize: 11 },
    sfx: { fontFamily: 'Noto Sans JP', fontWeight: 'bold', fontSize: 16 },
    whisper: { fontFamily: 'Noto Sans JP', fontWeight: 'normal', fontSize: 9 },
  },
  kodomomuke: {
    speech: { fontFamily: 'Kosugi Maru', fontWeight: 'bold', fontSize: 16 },
    thought: { fontFamily: 'Kosugi Maru', fontWeight: 'normal', fontSize: 14 },
    narration: { fontFamily: 'Kosugi Maru', fontWeight: 'normal', fontSize: 13 },
    sfx: { fontFamily: 'Kosugi Maru', fontWeight: 'black', fontSize: 28 },
    whisper: { fontFamily: 'Kosugi Maru', fontWeight: 'normal', fontSize: 12 },
  },
};

/**
 * Bubble type → visual style defaults.
 */
export const BUBBLE_TYPE_STYLES: Record<BubbleType, {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  padding: number;
  hasTail: boolean;
}> = {
  speech: {
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
    borderWidth: 2,
    borderRadius: 999, // fully rounded (oval)
    padding: 12,
    hasTail: true,
  },
  thought: {
    backgroundColor: '#FFFFFF',
    borderColor: '#666666',
    borderWidth: 1,
    borderRadius: 999, // cloud-like (rendered with scallops)
    padding: 14,
    hasTail: true,
  },
  narration: {
    backgroundColor: '#F5F5F5',
    borderColor: '#333333',
    borderWidth: 1,
    borderRadius: 4, // sharp box
    padding: 10,
    hasTail: false,
  },
  sfx: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    padding: 4,
    hasTail: false,
  },
  whisper: {
    backgroundColor: '#FFFFFF',
    borderColor: '#AAAAAA',
    borderWidth: 1,
    borderRadius: 999,
    padding: 10,
    hasTail: true,
  },
};

// ─── Layout Engine ────────────────────────────────────────────────────────────

/**
 * Estimate text dimensions for a given string at a font size.
 * Simplified: assumes average character width ratio.
 */
export function estimateTextDimensions(
  text: string,
  fontSize: number,
  maxWidth: number
): { width: number; height: number; lines: number } {
  // Average char width ≈ 0.6 × fontSize for Latin, 1.0 × fontSize for CJK
  const hasCJK = /[\u3000-\u9FFF\uF900-\uFAFF]/.test(text);
  const charWidth = hasCJK ? fontSize * 1.0 : fontSize * 0.6;
  const lineHeight = fontSize * 1.4;

  const textWidth = text.length * charWidth;
  const lines = Math.max(1, Math.ceil(textWidth / maxWidth));
  const actualWidth = Math.min(textWidth, maxWidth);
  const height = lines * lineHeight;

  return { width: actualWidth, height, lines };
}

/**
 * Compute bubble placement positions for all dialogue lines.
 * Respects reading direction and avoids overlap.
 */
export function computeBubbleLayouts(
  dialogueLines: DialogueLine[],
  panelWidth: number,
  panelHeight: number,
  genre: AnimeGenre,
  readingDirection: ReadingDirection
): BubbleLayout[] {
  const layouts: BubbleLayout[] = [];
  const occupiedRegions: Array<{ x: number; y: number; w: number; h: number }> = [];

  // Sort by position hint (top to bottom, reading-direction order)
  const sorted = [...dialogueLines].sort((a, b) => {
    const ay = a.positionHint?.y ?? 0.3;
    const by = b.positionHint?.y ?? 0.3;
    if (Math.abs(ay - by) > 0.1) return ay - by;
    const ax = a.positionHint?.x ?? 0.5;
    const bx = b.positionHint?.x ?? 0.5;
    return readingDirection === 'rtl' ? bx - ax : ax - bx;
  });

  for (let i = 0; i < sorted.length; i++) {
    const dialogue = sorted[i];
    const typeStyle = BUBBLE_TYPE_STYLES[dialogue.type];
    const fontConfig = GENRE_FONT_CONFIG[genre][dialogue.type];

    // Compute font size with emphasis modifier
    let fontSize = fontConfig.fontSize;
    if (dialogue.emphasis === 'loud') fontSize = Math.round(fontSize * 1.4);
    if (dialogue.emphasis === 'whisper') fontSize = Math.round(fontSize * 0.8);

    // Max bubble width: 40% of panel for speech/thought, 30% for narration, 60% for SFX
    const maxWidthRatio = dialogue.type === 'sfx' ? 0.6 : dialogue.type === 'narration' ? 0.3 : 0.4;
    const maxBubbleWidth = Math.round(panelWidth * maxWidthRatio);

    // Estimate text size
    const textDims = estimateTextDimensions(dialogue.text, fontSize, maxBubbleWidth - typeStyle.padding * 2);
    const bubbleWidth = textDims.width + typeStyle.padding * 2;
    const bubbleHeight = textDims.height + typeStyle.padding * 2;

    // Position: use hint or auto-place
    let x: number;
    let y: number;

    if (dialogue.positionHint) {
      x = Math.round(dialogue.positionHint.x * panelWidth - bubbleWidth / 2);
      y = Math.round(dialogue.positionHint.y * panelHeight - bubbleHeight / 2);
    } else {
      // Auto-place: top portion of panel, spread horizontally
      const slotX = readingDirection === 'rtl'
        ? panelWidth - (i + 1) * (panelWidth / (sorted.length + 1)) - bubbleWidth / 2
        : (i + 1) * (panelWidth / (sorted.length + 1)) - bubbleWidth / 2;
      x = Math.round(slotX);
      y = Math.round(panelHeight * 0.1 + i * (bubbleHeight + 8));
    }

    // Clamp to panel bounds
    x = Math.max(4, Math.min(panelWidth - bubbleWidth - 4, x));
    y = Math.max(4, Math.min(panelHeight - bubbleHeight - 4, y));

    // Nudge to avoid overlap
    for (const occupied of occupiedRegions) {
      if (
        x < occupied.x + occupied.w &&
        x + bubbleWidth > occupied.x &&
        y < occupied.y + occupied.h &&
        y + bubbleHeight > occupied.y
      ) {
        y = occupied.y + occupied.h + 6; // push below
        y = Math.min(panelHeight - bubbleHeight - 4, y);
      }
    }

    // Determine tail direction
    let tailDirection: BubbleStyle['tailDirection'] = 'none';
    if (typeStyle.hasTail) {
      const centerX = x + bubbleWidth / 2;
      const centerY = y + bubbleHeight / 2;
      const isLeft = centerX < panelWidth / 2;
      const isTop = centerY < panelHeight / 2;
      tailDirection = isTop
        ? (isLeft ? 'bottom-left' : 'bottom-right')
        : (isLeft ? 'top-left' : 'top-right');
    }

    const style: BubbleStyle = {
      backgroundColor: typeStyle.backgroundColor,
      borderColor: typeStyle.borderColor,
      borderWidth: typeStyle.borderWidth,
      fontFamily: fontConfig.fontFamily,
      fontSize,
      fontWeight: fontConfig.fontWeight,
      textColor: dialogue.type === 'sfx' ? '#000000' : '#1A1A1A',
      padding: typeStyle.padding,
      borderRadius: typeStyle.borderRadius,
      tailDirection,
    };

    const layout: BubbleLayout = {
      x,
      y,
      width: bubbleWidth,
      height: bubbleHeight,
      style,
      dialogue,
      zIndex: dialogue.type === 'sfx' ? 10 : 5 + i,
    };

    layouts.push(layout);
    occupiedRegions.push({ x, y, w: bubbleWidth, h: bubbleHeight });
  }

  return layouts;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render a single bubble onto an RGBA buffer.
 * This is a simplified rasterizer — in production, would use canvas/sharp.
 */
export function renderBubbleToBuffer(
  layout: BubbleLayout,
  targetBuffer: Buffer,
  panelWidth: number,
  _panelHeight: number
): void {
  const { x, y, width, height, style } = layout;

  // Parse colors
  const bgColor = parseHexColor(style.backgroundColor);
  const borderColor = parseHexColor(style.borderColor);

  if (!bgColor || bgColor.a === 0) return; // transparent (SFX) — text only

  // Fill bubble background
  for (let py = y; py < y + height && py < _panelHeight; py++) {
    for (let px = x; px < x + width && px < panelWidth; px++) {
      if (px < 0 || py < 0) continue;

      // Check if inside rounded rect
      if (isInsideRoundedRect(px - x, py - y, width, height, Math.min(style.borderRadius, height / 2))) {
        const offset = (py * panelWidth + px) * 4;

        // Check if on border
        const isBorder = !isInsideRoundedRect(
          px - x - style.borderWidth,
          py - y - style.borderWidth,
          width - style.borderWidth * 2,
          height - style.borderWidth * 2,
          Math.max(0, Math.min(style.borderRadius, height / 2) - style.borderWidth)
        );

        const color = isBorder ? borderColor : bgColor;
        if (!color) continue;
        // Alpha blend
        const alpha = color.a / 255;
        targetBuffer[offset] = Math.round(targetBuffer[offset] * (1 - alpha) + color.r * alpha);
        targetBuffer[offset + 1] = Math.round(targetBuffer[offset + 1] * (1 - alpha) + color.g * alpha);
        targetBuffer[offset + 2] = Math.round(targetBuffer[offset + 2] * (1 - alpha) + color.b * alpha);
        targetBuffer[offset + 3] = 255;
      }
    }
  }
}

/**
 * Check if a point is inside a rounded rectangle.
 */
function isInsideRoundedRect(
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number
): boolean {
  if (px < 0 || py < 0 || px >= width || py >= height) return false;

  const r = Math.min(radius, width / 2, height / 2);

  // Check corners
  if (px < r && py < r) {
    return (px - r) ** 2 + (py - r) ** 2 <= r ** 2;
  }
  if (px >= width - r && py < r) {
    return (px - (width - r)) ** 2 + (py - r) ** 2 <= r ** 2;
  }
  if (px < r && py >= height - r) {
    return (px - r) ** 2 + (py - (height - r)) ** 2 <= r ** 2;
  }
  if (px >= width - r && py >= height - r) {
    return (px - (width - r)) ** 2 + (py - (height - r)) ** 2 <= r ** 2;
  }

  return true;
}

/**
 * Parse hex color string to RGBA components.
 */
function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } | null {
  if (hex === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const match = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!match) return null;
  return {
    r: parseInt(match[1].substring(0, 2), 16),
    g: parseInt(match[1].substring(2, 4), 16),
    b: parseInt(match[1].substring(4, 6), 16),
    a: 255,
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Render all dialogue bubbles onto a panel image.
 */
export async function renderBubbles(input: BubbleRenderInput): Promise<BubbleRenderResult> {
  const startTime = Date.now();

  if (input.dialogueLines.length === 0) {
    return {
      outputBuffer: input.panelImageBuffer,
      layouts: [],
      processingTimeMs: 0,
      bubbleCount: 0,
    };
  }

  // Compute layouts
  const layouts = computeBubbleLayouts(
    input.dialogueLines,
    input.panelWidth,
    input.panelHeight,
    input.genre,
    input.readingDirection
  );

  // Sort by z-index for rendering order
  const sortedLayouts = [...layouts].sort((a, b) => a.zIndex - b.zIndex);

  // Render each bubble onto the panel buffer
  const outputBuffer = Buffer.from(input.panelImageBuffer);
  for (const layout of sortedLayouts) {
    renderBubbleToBuffer(layout, outputBuffer, input.panelWidth, input.panelHeight);
  }

  return {
    outputBuffer,
    layouts,
    processingTimeMs: Date.now() - startTime,
    bubbleCount: layouts.length,
  };
}

/**
 * Batch render bubbles for multiple panels.
 */
export async function batchRenderBubbles(
  panels: Array<{
    panelId: number;
    panelWidth: number;
    panelHeight: number;
    dialogueLines: DialogueLine[];
    panelImageBuffer: Buffer;
  }>,
  genre: AnimeGenre,
  readingDirection: ReadingDirection
): Promise<Array<{ panelId: number; result: BubbleRenderResult }>> {
  const results: Array<{ panelId: number; result: BubbleRenderResult }> = [];

  for (const panel of panels) {
    const result = await renderBubbles({
      panelWidth: panel.panelWidth,
      panelHeight: panel.panelHeight,
      dialogueLines: panel.dialogueLines,
      genre,
      readingDirection,
      panelImageBuffer: panel.panelImageBuffer,
    });

    results.push({ panelId: panel.panelId, result });
  }

  return results;
}
