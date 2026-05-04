/**
 * D10 Craft Library — Sakugabooru Scraper
 *
 * Scrapes tagged reference frames and animator attribution from sakugabooru.com.
 * Uses the Sakugabooru API (Moebooru-compatible) for structured data access.
 *
 * Content mapping:
 * - Sub-sensei: "genga" (primary), cross-tagged "anime"
 * - Source type: "reference_image_set"
 *
 * Note: We scrape metadata + tags, not the images themselves.
 * The value is in the tag taxonomy and animator attribution.
 */

import {
  type ScraperConfig,
  type ScrapedPage,
  type ScrapeResult,
  type IngestionProgress,
  batchScrape,
  fetchWithRetry,
  createProgressTracker,
  updateProgress,
} from "./scraper";

const SAKUGABOORU_CONFIG: ScraperConfig = {
  baseUrl: "https://www.sakugabooru.com",
  delayMs: 1500,
  maxRetries: 3,
  maxPages: 500,
  headers: {
    "Accept": "application/json",
  },
};

interface SakugabooruPost {
  id: number;
  tags: string;
  source: string;
  score: number;
  rating: string;
  md5: string;
  file_url: string;
  preview_url: string;
  sample_url: string;
  width: number;
  height: number;
  created_at: { s: number };
  author: string;
}

// Tag categories that map to specific animation techniques
const TECHNIQUE_TAGS = [
  "effects", "fighting", "running", "hair", "liquid",
  "explosions", "smoke", "fire", "debris", "impact_frames",
  "smears", "character_acting", "dancing", "mecha",
  "creatures", "morphing", "fabric", "wind",
  "background_animation", "rotation", "walk_cycle",
];

/**
 * Fetch posts from the Sakugabooru API with pagination.
 */
export async function fetchSakugabooruPosts(
  page: number = 1,
  tags: string = "",
  limit: number = 50,
): Promise<SakugabooruPost[]> {
  const url = `${SAKUGABOORU_CONFIG.baseUrl}/post.json?page=${page}&limit=${limit}${tags ? `&tags=${encodeURIComponent(tags)}` : ""}`;

  const result = await fetchWithRetry(url, SAKUGABOORU_CONFIG);
  if (!result) return [];

  try {
    return JSON.parse(result.html) as SakugabooruPost[];
  } catch {
    return [];
  }
}

/**
 * Convert a Sakugabooru post into a ScrapedPage (metadata-focused).
 * We store the tag taxonomy and attribution, not the image data.
 */
function postToScrapedPage(post: SakugabooruPost): ScrapedPage {
  const tags = post.tags.split(" ").filter(Boolean);

  // Extract animator names (tags that look like names: contain underscores, not in technique list)
  const animatorTags = tags.filter(t =>
    t.includes("_") &&
    !TECHNIQUE_TAGS.includes(t) &&
    !t.startsWith("source:") &&
    !t.match(/^\d+/) &&
    t !== "animated"
  );

  // Extract technique tags
  const techniqueTags = tags.filter(t => TECHNIQUE_TAGS.includes(t));

  // Extract show/source tags
  const showTags = tags.filter(t =>
    !animatorTags.includes(t) &&
    !techniqueTags.includes(t) &&
    t !== "animated" &&
    !t.startsWith("source:")
  );

  // Build descriptive content from tags
  const content = [
    `Animation reference: Sakugabooru #${post.id}`,
    `Score: ${post.score}`,
    animatorTags.length > 0 ? `Animators: ${animatorTags.map(t => t.replace(/_/g, " ")).join(", ")}` : "",
    techniqueTags.length > 0 ? `Techniques: ${techniqueTags.join(", ")}` : "",
    showTags.length > 0 ? `Shows/Tags: ${showTags.map(t => t.replace(/_/g, " ")).join(", ")}` : "",
    post.source ? `Source: ${post.source}` : "",
    `Resolution: ${post.width}x${post.height}`,
  ].filter(Boolean).join("\n");

  return {
    url: `${SAKUGABOORU_CONFIG.baseUrl}/post/show/${post.id}`,
    title: `Sakugabooru #${post.id} — ${animatorTags.length > 0 ? animatorTags[0].replace(/_/g, " ") : "Unknown animator"}`,
    content,
    author: animatorTags.length > 0 ? animatorTags[0].replace(/_/g, " ") : post.author,
    tags,
    metadata: {
      source: "sakugabooru",
      postId: post.id,
      score: post.score,
      animators: animatorTags.map(t => t.replace(/_/g, " ")),
      techniques: techniqueTags,
      shows: showTags.map(t => t.replace(/_/g, " ")),
      resolution: { width: post.width, height: post.height },
      crossTags: ["anime"],
      previewUrl: post.preview_url,
    },
  };
}

/**
 * Run the full Sakugabooru ingestion.
 * Fetches high-score posts across technique categories.
 */
export async function scrapeSakugabooru(
  onProgress?: (progress: IngestionProgress) => void,
  shouldAbort?: () => boolean,
  maxPosts?: number,
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const allPages: ScrapedPage[] = [];
  const allErrors: Array<{ url: string; error: string }> = [];
  const seenIds = new Set<number>();
  const targetMax = maxPosts ?? 500;

  let progress = createProgressTracker("sakugabooru", targetMax);
  progress.status = "running";
  progress.startedAt = Date.now();

  // Fetch top-scored posts across pages
  let page = 1;
  while (allPages.length < targetMax) {
    if (shouldAbort?.()) {
      progress.status = "paused";
      break;
    }

    const posts = await fetchSakugabooruPosts(page, "order:score", 50);
    if (posts.length === 0) break;

    for (const post of posts) {
      if (seenIds.has(post.id)) continue;
      seenIds.add(post.id);

      try {
        const scraped = postToScrapedPage(post);
        allPages.push(scraped);
        progress.successCount++;
      } catch (err: any) {
        allErrors.push({ url: `post/${post.id}`, error: err.message });
        progress.failCount++;
      }

      progress.processedUrls++;
      if (allPages.length >= targetMax) break;
    }

    progress = updateProgress(progress, {});
    onProgress?.(progress);

    page++;
    await new Promise(r => setTimeout(r, SAKUGABOORU_CONFIG.delayMs ?? 1500));
  }

  progress.status = progress.status === "paused" ? "paused" : "completed";
  progress.currentUrl = null;
  onProgress?.(progress);

  return {
    pages: allPages,
    errors: allErrors,
    totalFetched: allPages.length,
    totalFailed: allErrors.length,
    durationMs: Date.now() - startTime,
  };
}
