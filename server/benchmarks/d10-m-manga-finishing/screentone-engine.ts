/**
 * D10.M Sub-Task 1a: Programmatic Screentone Engine
 *
 * Deterministic per-genre halftone patterns for manga finishing.
 * Patterns: ami-ten (dot), kake-ami (crosshatch), suna-me (sand grain), gradation.
 * Canvas-based rendering for inter-panel consistency.
 * AI screentone available as Pro+ tier upsell only.
 *
 * Blueprint: Stage 5.5 branch — Manga Finishing
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScreentonePattern = 'ami_ten' | 'kake_ami' | 'suna_me' | 'gradation';

export type MoodCategory =
  | 'action'
  | 'tension'
  | 'calm'
  | 'romance'
  | 'comedy'
  | 'horror'
  | 'melancholy'
  | 'mystery'
  | 'neutral';

export type AnimeGenre = 'shonen' | 'shojo' | 'seinen' | 'josei' | 'kodomomuke';

export interface ScreentoneConfig {
  pattern: ScreentonePattern;
  /** Dot/line density: dots per inch equivalent (higher = finer) */
  density: number;
  /** Angle in degrees for pattern rotation */
  angle: number;
  /** Opacity 0-1 for overlay blending */
  opacity: number;
  /** Line width for crosshatch patterns (px at 300dpi equivalent) */
  lineWidth?: number;
  /** Gradient direction for gradation pattern (degrees) */
  gradientAngle?: number;
}

export interface ScreentoneInput {
  /** Panel image buffer (PNG/JPEG) */
  imageBuffer: Buffer;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Mood of the panel (drives pattern selection) */
  mood: MoodCategory;
  /** Genre of the project (drives density/style defaults) */
  genre: AnimeGenre;
  /** Optional manual override for screentone config */
  override?: Partial<ScreentoneConfig>;
  /** Region mask: which areas to apply screentone (null = full panel) */
  regionMask?: Buffer | null;
  /** Whether to use AI screentone (Pro+ tier only) */
  useAiScreentone?: boolean;
}

export interface ScreentoneResult {
  /** Composited image buffer with screentone applied */
  outputBuffer: Buffer;
  /** Pattern that was applied */
  appliedPattern: ScreentonePattern;
  /** Config used for the application */
  appliedConfig: ScreentoneConfig;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Whether AI was used (Pro+ only) */
  usedAi: boolean;
}

// ─── Pattern Lookup Tables ────────────────────────────────────────────────────

/**
 * Genre → default pattern preferences.
 * Each genre has a primary and secondary pattern that defines its visual identity.
 */
export const GENRE_PATTERN_DEFAULTS: Record<AnimeGenre, {
  primary: ScreentonePattern;
  secondary: ScreentonePattern;
  baseDensity: number;
  baseAngle: number;
}> = {
  shonen: {
    primary: 'ami_ten',
    secondary: 'kake_ami',
    baseDensity: 60,
    baseAngle: 45,
  },
  shojo: {
    primary: 'gradation',
    secondary: 'ami_ten',
    baseDensity: 40,
    baseAngle: 0,
  },
  seinen: {
    primary: 'kake_ami',
    secondary: 'suna_me',
    baseDensity: 80,
    baseAngle: 45,
  },
  josei: {
    primary: 'ami_ten',
    secondary: 'gradation',
    baseDensity: 50,
    baseAngle: 30,
  },
  kodomomuke: {
    primary: 'ami_ten',
    secondary: 'ami_ten',
    baseDensity: 35,
    baseAngle: 45,
  },
};

/**
 * Mood → pattern selection override.
 * When mood is strong enough, it overrides the genre default.
 */
export const MOOD_PATTERN_MAP: Record<MoodCategory, {
  pattern: ScreentonePattern | null; // null = use genre default
  densityMultiplier: number;
  opacityMultiplier: number;
}> = {
  action: { pattern: 'kake_ami', densityMultiplier: 1.3, opacityMultiplier: 1.2 },
  tension: { pattern: 'kake_ami', densityMultiplier: 1.5, opacityMultiplier: 1.4 },
  calm: { pattern: 'gradation', densityMultiplier: 0.7, opacityMultiplier: 0.6 },
  romance: { pattern: 'gradation', densityMultiplier: 0.6, opacityMultiplier: 0.5 },
  comedy: { pattern: null, densityMultiplier: 0.8, opacityMultiplier: 0.7 },
  horror: { pattern: 'suna_me', densityMultiplier: 1.4, opacityMultiplier: 1.3 },
  melancholy: { pattern: 'ami_ten', densityMultiplier: 0.9, opacityMultiplier: 0.8 },
  mystery: { pattern: 'suna_me', densityMultiplier: 1.2, opacityMultiplier: 1.0 },
  neutral: { pattern: null, densityMultiplier: 1.0, opacityMultiplier: 1.0 },
};

// ─── Pattern Generators ───────────────────────────────────────────────────────

/**
 * Generate ami-ten (dot screen) pattern data.
 * Classic manga halftone: evenly spaced dots at a given angle.
 */
export function generateAmiTen(
  width: number,
  height: number,
  config: ScreentoneConfig
): Uint8Array {
  const { density, angle, opacity } = config;
  const spacing = Math.max(2, Math.round(300 / density)); // px between dot centers
  const radius = Math.max(1, Math.round(spacing * 0.3)); // dot radius
  const alphaValue = Math.round(opacity * 255);

  // Create alpha channel buffer (single channel)
  const buffer = new Uint8Array(width * height);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rotate coordinates
      const rx = x * cos + y * sin;
      const ry = -x * sin + y * cos;

      // Check if within dot radius of nearest grid point
      const gx = Math.round(rx / spacing) * spacing;
      const gy = Math.round(ry / spacing) * spacing;
      const dx = rx - gx;
      const dy = ry - gy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        buffer[y * width + x] = alphaValue;
      }
    }
  }

  return buffer;
}

/**
 * Generate kake-ami (crosshatch) pattern data.
 * Intersecting lines at specified angle — used for shadows and tension.
 */
export function generateKakeAmi(
  width: number,
  height: number,
  config: ScreentoneConfig
): Uint8Array {
  const { density, angle, opacity, lineWidth = 1 } = config;
  const spacing = Math.max(3, Math.round(300 / density));
  const alphaValue = Math.round(opacity * 255);
  const halfLine = lineWidth / 2;

  const buffer = new Uint8Array(width * height);
  const rad1 = (angle * Math.PI) / 180;
  const rad2 = ((angle + 90) * Math.PI) / 180;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // First set of lines
      const proj1 = Math.abs(x * Math.cos(rad1) + y * Math.sin(rad1));
      const mod1 = proj1 % spacing;
      const dist1 = Math.min(mod1, spacing - mod1);

      // Second set of lines (perpendicular)
      const proj2 = Math.abs(x * Math.cos(rad2) + y * Math.sin(rad2));
      const mod2 = proj2 % spacing;
      const dist2 = Math.min(mod2, spacing - mod2);

      if (dist1 <= halfLine || dist2 <= halfLine) {
        buffer[y * width + x] = alphaValue;
      }
    }
  }

  return buffer;
}

/**
 * Generate suna-me (sand grain / stipple) pattern data.
 * Pseudo-random noise with density control — used for texture and horror.
 */
export function generateSunaMe(
  width: number,
  height: number,
  config: ScreentoneConfig
): Uint8Array {
  const { density, opacity } = config;
  const alphaValue = Math.round(opacity * 255);
  // Probability of a pixel being filled (0-1 based on density)
  const fillProbability = Math.min(1, density / 200);

  const buffer = new Uint8Array(width * height);

  // Use deterministic pseudo-random for consistency
  let seed = 12345 + width * 7 + height * 13;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (nextRandom() < fillProbability) {
        buffer[y * width + x] = alphaValue;
      }
    }
  }

  return buffer;
}

/**
 * Generate gradation pattern data.
 * Smooth gradient in specified direction — used for atmosphere and romance.
 */
export function generateGradation(
  width: number,
  height: number,
  config: ScreentoneConfig
): Uint8Array {
  const { opacity, gradientAngle = 90 } = config;
  const maxAlpha = Math.round(opacity * 255);

  const buffer = new Uint8Array(width * height);
  const rad = (gradientAngle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Compute gradient range
  const maxProj = Math.abs(width * cos) + Math.abs(height * sin);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const proj = x * cos + y * sin;
      const normalized = (proj + maxProj / 2) / maxProj; // 0..1
      const clamped = Math.max(0, Math.min(1, normalized));
      buffer[y * width + x] = Math.round(clamped * maxAlpha);
    }
  }

  return buffer;
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

/**
 * Resolve the screentone configuration from mood + genre + optional override.
 */
export function resolveScreentoneConfig(
  mood: MoodCategory,
  genre: AnimeGenre,
  override?: Partial<ScreentoneConfig>
): ScreentoneConfig {
  const genreDefaults = GENRE_PATTERN_DEFAULTS[genre];
  const moodOverride = MOOD_PATTERN_MAP[mood];

  // Pattern: mood override > genre primary
  const pattern = moodOverride.pattern ?? genreDefaults.primary;

  // Density: genre base × mood multiplier
  const density = Math.round(genreDefaults.baseDensity * moodOverride.densityMultiplier);

  // Opacity: base 0.4 × mood multiplier (clamped 0.1-0.9)
  const rawOpacity = 0.4 * moodOverride.opacityMultiplier;
  const opacity = Math.max(0.1, Math.min(0.9, rawOpacity));

  // Angle: genre base (mood doesn't change angle)
  const angle = genreDefaults.baseAngle;

  const config: ScreentoneConfig = {
    pattern,
    density,
    angle,
    opacity,
    lineWidth: pattern === 'kake_ami' ? 1 : undefined,
    gradientAngle: pattern === 'gradation' ? 90 : undefined,
  };

  // Apply manual overrides
  if (override) {
    if (override.pattern !== undefined) config.pattern = override.pattern;
    if (override.density !== undefined) config.density = override.density;
    if (override.angle !== undefined) config.angle = override.angle;
    if (override.opacity !== undefined) config.opacity = override.opacity;
    if (override.lineWidth !== undefined) config.lineWidth = override.lineWidth;
    if (override.gradientAngle !== undefined) config.gradientAngle = override.gradientAngle;
  }

  return config;
}

/**
 * Generate the pattern buffer for the given config.
 */
export function generatePatternBuffer(
  width: number,
  height: number,
  config: ScreentoneConfig
): Uint8Array {
  switch (config.pattern) {
    case 'ami_ten':
      return generateAmiTen(width, height, config);
    case 'kake_ami':
      return generateKakeAmi(width, height, config);
    case 'suna_me':
      return generateSunaMe(width, height, config);
    case 'gradation':
      return generateGradation(width, height, config);
    default:
      return generateAmiTen(width, height, config);
  }
}

/**
 * Composite screentone pattern onto the source image buffer.
 * Uses alpha blending: result = source × (1 - pattern_alpha) + black × pattern_alpha
 *
 * Input: RGBA image buffer (4 bytes per pixel)
 * Pattern: single-channel alpha mask
 * Output: RGBA image buffer with screentone applied
 */
export function compositeScreentone(
  imageRgba: Buffer,
  patternAlpha: Uint8Array,
  width: number,
  height: number,
  regionMask?: Buffer | null
): Buffer {
  const output = Buffer.from(imageRgba); // clone
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    // Skip if outside region mask
    if (regionMask && regionMask[i] === 0) continue;

    const alpha = patternAlpha[i];
    if (alpha === 0) continue;

    const offset = i * 4;
    const blendFactor = alpha / 255;
    const inverseFactor = 1 - blendFactor;

    // Blend toward black (screentone is dark overlay)
    output[offset] = Math.round(output[offset] * inverseFactor);     // R
    output[offset + 1] = Math.round(output[offset + 1] * inverseFactor); // G
    output[offset + 2] = Math.round(output[offset + 2] * inverseFactor); // B
    // Alpha channel unchanged
  }

  return output;
}

/**
 * Main entry point: Apply screentone to a panel image.
 *
 * For the programmatic path (default), this:
 * 1. Resolves config from mood + genre
 * 2. Generates pattern buffer
 * 3. Composites pattern onto image
 *
 * For the AI path (Pro+ only), this delegates to generateImage() with
 * a screentone-specific prompt. (Not implemented in Wave 5A — placeholder.)
 */
export async function applyScreentone(input: ScreentoneInput): Promise<ScreentoneResult> {
  const startTime = Date.now();

  // Pro+ AI screentone path (placeholder for future wave)
  if (input.useAiScreentone) {
    // TODO: Wave 5B+ — AI screentone via generateImage() with style-transfer prompt
    // For now, fall through to programmatic path
  }

  // Resolve configuration
  const config = resolveScreentoneConfig(input.mood, input.genre, input.override);

  // Generate pattern
  const patternBuffer = generatePatternBuffer(input.width, input.height, config);

  // Composite onto image (assumes RGBA input)
  const outputBuffer = compositeScreentone(
    input.imageBuffer,
    patternBuffer,
    input.width,
    input.height,
    input.regionMask
  );

  return {
    outputBuffer,
    appliedPattern: config.pattern,
    appliedConfig: config,
    processingTimeMs: Date.now() - startTime,
    usedAi: false,
  };
}

/**
 * Batch apply screentone to multiple panels.
 * Used by the D10.M pipeline to process all panels in an episode.
 */
export async function batchApplyScreentone(
  panels: Array<{
    panelId: number;
    imageBuffer: Buffer;
    width: number;
    height: number;
    mood: MoodCategory;
  }>,
  genre: AnimeGenre,
  options?: { override?: Partial<ScreentoneConfig> }
): Promise<Array<{ panelId: number; result: ScreentoneResult }>> {
  const results: Array<{ panelId: number; result: ScreentoneResult }> = [];

  for (const panel of panels) {
    const result = await applyScreentone({
      imageBuffer: panel.imageBuffer,
      width: panel.width,
      height: panel.height,
      mood: panel.mood,
      genre,
      override: options?.override,
    });

    results.push({ panelId: panel.panelId, result });
  }

  return results;
}
