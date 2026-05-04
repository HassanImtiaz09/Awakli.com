/**
 * D10 Craft Library — Animation Obsessive Scraper
 *
 * Scrapes long-form essays from animationobsessive.substack.com.
 * High-quality, in-depth analysis of animation technique and history.
 *
 * Content mapping:
 * - Sub-sensei: "anime" (primary), cross-tagged "genga" for technique posts
 * - Source type: "web_article"
 *
 * Note: Animation Obsessive is a Substack newsletter.
 * We scrape the free/public archive only.
 */

import {
  type ScraperConfig,
  type ScrapedPage,
  type ScrapeResult,
  type IngestionProgress,
  fetchWithRetry,
  extractTextFromHtml,
  extractMeta,
  extractLinks,
  batchScrape,
} from "./scraper";

const AO_CONFIG: ScraperConfig = {
  baseUrl: "https://animationobsessive.substack.com",
  delayMs: 3000, // Extra respectful — Substack
  maxRetries: 3,
  maxPages: 200,
};

// Keywords indicating genga/technique cross-tag relevance
const GENGA_KEYWORDS = [
  "key animation", "genga", "sakuga", "animator", "keyframe",
  "in-between", "timing", "spacing", "effects animation",
  "character animation", "action animation", "drawing",
  "pencil test", "rough animation", "clean-up",
];

/**
 * Discover article URLs from the Animation Obsessive archive.
 */
export async function discoverAOUrls(): Promise<string[]> {
  const allUrls: string[] = [];
  let offset = 0;
  const batchSize = 12;
  const maxBatches = 20;

  for (let batch = 0; batch < maxBatches; batch++) {
    const url = `${AO_CONFIG.baseUrl}/archive?sort=new&offset=${offset}`;
    const result = await fetchWithRetry(url, AO_CONFIG);
    if (!result) break;

    // Extract article links (Substack pattern: /p/slug)
    const articleLinks = extractLinks(
      result.html,
      AO_CONFIG.baseUrl,
      /animationobsessive\.substack\.com\/p\//,
    );

    if (articleLinks.length === 0) break;
    allUrls.push(...articleLinks);
    offset += batchSize;

    await new Promise(r => setTimeout(r, 2000));
  }

  return Array.from(new Set(allUrls));
}

/**
 * Parse an Animation Obsessive article.
 */
export function parseAOArticle(html: string, url: string): ScrapedPage | null {
  // Extract title
  const title = extractMeta(html, /<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
    ?? extractMeta(html, /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
    ?? extractMeta(html, /<title>([\s\S]*?)<\/title>/i)
    ?? "Untitled";

  // Extract subtitle/description
  const subtitle = extractMeta(html, /<h3[^>]*class="[^"]*subtitle[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)
    ?? extractMeta(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);

  // Extract article body
  const bodyMatch = html.match(/<div[^>]*class="[^"]*body[^"]*markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*class="[^"]*subscription|<div[^>]*class="[^"]*post-footer)/i);
  const rawContent = bodyMatch ? bodyMatch[1] : "";
  const content = extractTextFromHtml(rawContent);

  if (!content || content.length < 200) return null; // Skip stubs/paywalled

  // Extract publish date
  const publishedAt = extractMeta(html, /<time[^>]*datetime="([^"]+)"/i)
    ?? extractMeta(html, /<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i);

  // Extract author
  const author = extractMeta(html, /<meta[^>]*name="author"[^>]*content="([^"]+)"/i)
    ?? "Animation Obsessive";

  // Determine cross-tags
  const contentLower = content.toLowerCase();
  const hasGengaContent = GENGA_KEYWORDS.some(kw => contentLower.includes(kw));

  return {
    url,
    title: extractTextFromHtml(title),
    content: subtitle ? `${subtitle}\n\n${content}` : content,
    author,
    publishedAt: publishedAt ?? undefined,
    tags: ["animation", "analysis", "essay"],
    metadata: {
      source: "animation_obsessive",
      wordCount: content.split(/\s+/).length,
      hasSubtitle: !!subtitle,
      crossTags: hasGengaContent ? ["genga"] : [],
      hasGengaContent,
    },
  };
}

/**
 * Run the full Animation Obsessive ingestion.
 */
export async function scrapeAnimationObsessive(
  onProgress?: (progress: IngestionProgress) => void,
  shouldAbort?: () => boolean,
  maxArticles?: number,
): Promise<ScrapeResult> {
  const urls = await discoverAOUrls();
  const targetUrls = maxArticles ? urls.slice(0, maxArticles) : urls;

  return batchScrape(
    targetUrls,
    AO_CONFIG,
    parseAOArticle,
    onProgress,
    shouldAbort,
  );
}
