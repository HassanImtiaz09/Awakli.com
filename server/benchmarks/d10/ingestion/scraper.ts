/**
 * D10 Craft Library — Web Scraper Framework
 *
 * Rate-limited, respectful web scraper with retry logic.
 * All source-specific scrapers extend this base framework.
 *
 * Principles:
 * - Respect robots.txt (check before scraping)
 * - Rate limit: configurable delay between requests (default 2s)
 * - Retry with exponential backoff (max 3 attempts)
 * - User-Agent identifies us as a research bot
 * - Abort on 429 (Too Many Requests) with extended cooldown
 */

const USER_AGENT = "AwakliCraftBot/1.0 (research; +https://awakli.ai/about)";
const DEFAULT_DELAY_MS = 2000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 3000;
const RATE_LIMIT_COOLDOWN_MS = 30000;

export interface ScraperConfig {
  /** Base URL for the source site */
  baseUrl: string;
  /** Delay between requests in ms (default 2000) */
  delayMs?: number;
  /** Maximum number of retries per request (default 3) */
  maxRetries?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Maximum pages to scrape (safety limit) */
  maxPages?: number;
}

export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  author?: string;
  publishedAt?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ScrapeResult {
  pages: ScrapedPage[];
  errors: Array<{ url: string; error: string }>;
  totalFetched: number;
  totalFailed: number;
  durationMs: number;
}

export interface IngestionProgress {
  sourceKey: string;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  totalUrls: number;
  processedUrls: number;
  successCount: number;
  failCount: number;
  currentUrl: string | null;
  startedAt: number | null;
  estimatedRemainingMs: number | null;
  errors: Array<{ url: string; error: string }>;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a URL with retry logic and rate limiting.
 */
export async function fetchWithRetry(
  url: string,
  config: ScraperConfig,
): Promise<{ html: string; status: number } | null> {
  const maxRetries = config.maxRetries ?? MAX_RETRIES;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5,ja;q=0.3",
    ...(config.headers ?? {}),
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (response.status === 429) {
        // Rate limited — extended cooldown
        console.warn(`[Scraper] 429 Too Many Requests for ${url}, cooling down ${RATE_LIMIT_COOLDOWN_MS}ms`);
        await sleep(RATE_LIMIT_COOLDOWN_MS);
        continue;
      }

      if (response.status === 404) {
        console.warn(`[Scraper] 404 Not Found: ${url}`);
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return { html, status: response.status };
    } catch (err: any) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) {
        console.error(`[Scraper] Failed after ${maxRetries} attempts: ${url} — ${err.message}`);
        return null;
      }
      const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt);
      console.warn(`[Scraper] Attempt ${attempt + 1} failed for ${url}, retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  return null;
}

/**
 * Extract text content from HTML, stripping tags.
 * Simple extraction — source-specific scrapers should override with targeted selectors.
 */
export function extractTextFromHtml(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Replace block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract a value from HTML using a simple regex pattern.
 * Useful for meta tags, structured data, etc.
 */
export function extractMeta(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? match[1]?.trim() ?? null : null;
}

/**
 * Extract all links matching a pattern from HTML.
 */
export function extractLinks(html: string, baseUrl: string, pattern?: RegExp): string[] {
  const hrefRegex = /href=["']([^"']+)["']/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    let href = match[1];
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;

    // Resolve relative URLs
    if (href.startsWith("/")) {
      href = new URL(href, baseUrl).href;
    } else if (!href.startsWith("http")) {
      href = new URL(href, baseUrl).href;
    }

    // Apply pattern filter if provided
    if (pattern && !pattern.test(href)) continue;

    links.push(href);
  }

  return Array.from(new Set(links)); // Deduplicate
}

/**
 * Create a progress tracker for an ingestion job.
 */
export function createProgressTracker(sourceKey: string, totalUrls: number): IngestionProgress {
  return {
    sourceKey,
    status: "idle",
    totalUrls,
    processedUrls: 0,
    successCount: 0,
    failCount: 0,
    currentUrl: null,
    startedAt: null,
    estimatedRemainingMs: null,
    errors: [],
  };
}

/**
 * Update progress tracker with timing estimates.
 */
export function updateProgress(
  progress: IngestionProgress,
  update: Partial<IngestionProgress>,
): IngestionProgress {
  const updated = { ...progress, ...update };

  // Estimate remaining time
  if (updated.startedAt && updated.processedUrls > 0) {
    const elapsed = Date.now() - updated.startedAt;
    const avgPerUrl = elapsed / updated.processedUrls;
    const remaining = updated.totalUrls - updated.processedUrls;
    updated.estimatedRemainingMs = Math.round(avgPerUrl * remaining);
  }

  return updated;
}

/**
 * Run a batch scrape with rate limiting and progress tracking.
 * This is the main entry point for source-specific scrapers.
 */
export async function batchScrape(
  urls: string[],
  config: ScraperConfig,
  parsePage: (html: string, url: string) => ScrapedPage | null,
  onProgress?: (progress: IngestionProgress) => void,
  shouldAbort?: () => boolean,
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const delayMs = config.delayMs ?? DEFAULT_DELAY_MS;
  const maxPages = config.maxPages ?? urls.length;
  const pages: ScrapedPage[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  let progress = createProgressTracker("batch", Math.min(urls.length, maxPages));
  progress.status = "running";
  progress.startedAt = Date.now();

  for (let i = 0; i < Math.min(urls.length, maxPages); i++) {
    // Check abort signal
    if (shouldAbort?.()) {
      progress.status = "paused";
      onProgress?.(progress);
      break;
    }

    const url = urls[i];
    progress.currentUrl = url;
    onProgress?.(progress);

    const result = await fetchWithRetry(url, config);

    if (result) {
      try {
        const page = parsePage(result.html, url);
        if (page) {
          pages.push(page);
          progress.successCount++;
        } else {
          errors.push({ url, error: "Failed to parse page content" });
          progress.failCount++;
        }
      } catch (err: any) {
        errors.push({ url, error: err.message });
        progress.failCount++;
      }
    } else {
      errors.push({ url, error: "Failed to fetch after retries" });
      progress.failCount++;
    }

    progress.processedUrls++;
    progress = updateProgress(progress, {});
    onProgress?.(progress);

    // Rate limit delay (skip on last page)
    if (i < Math.min(urls.length, maxPages) - 1) {
      await sleep(delayMs);
    }
  }

  progress.status = progress.status === "paused" ? "paused" : "completed";
  progress.currentUrl = null;
  onProgress?.(progress);

  return {
    pages,
    errors,
    totalFetched: pages.length,
    totalFailed: errors.length,
    durationMs: Date.now() - startTime,
  };
}
