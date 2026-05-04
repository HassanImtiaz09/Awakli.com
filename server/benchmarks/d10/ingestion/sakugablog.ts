/**
 * D10 Craft Library — Sakugablog Scraper
 *
 * Scrapes articles from blog.sakugabooru.com (~200 articles on animation technique).
 * Targets: production notes, animator profiles, technique breakdowns, industry analysis.
 *
 * Content mapping:
 * - Sub-sensei: "anime" (primary), cross-tagged "genga" for technique posts
 * - Source type: "web_article"
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

const SAKUGABLOG_CONFIG: ScraperConfig = {
  baseUrl: "https://blog.sakugabooru.com",
  delayMs: 2500, // Respectful delay
  maxRetries: 3,
  maxPages: 300, // Safety cap
};

// Tags that indicate genga/key-animation cross-tag relevance
const GENGA_KEYWORDS = [
  "key animation", "genga", "sakuga", "animator", "keyframe",
  "in-between", "timing", "spacing", "smear", "impact frame",
  "effects animation", "character acting", "action scene",
];

/**
 * Discover article URLs from the Sakugablog archive/sitemap.
 * Uses pagination to find all article links.
 */
export async function discoverSakugablogUrls(): Promise<string[]> {
  const allUrls: string[] = [];
  let page = 1;
  const maxPages = 30; // ~10 articles per page, 30 pages = ~300 articles

  while (page <= maxPages) {
    const url = page === 1
      ? SAKUGABLOG_CONFIG.baseUrl
      : `${SAKUGABLOG_CONFIG.baseUrl}/page/${page}`;

    const result = await fetchWithRetry(url, SAKUGABLOG_CONFIG);
    if (!result) break;

    // Extract article links (WordPress pattern: /YYYY/MM/DD/slug/)
    const articleLinks = extractLinks(
      result.html,
      SAKUGABLOG_CONFIG.baseUrl,
      /blog\.sakugabooru\.com\/\d{4}\/\d{2}\/\d{2}\//,
    );

    if (articleLinks.length === 0) break; // No more articles

    allUrls.push(...articleLinks);
    page++;

    // Small delay between pagination requests
    await new Promise(r => setTimeout(r, 1500));
  }

  // Deduplicate
  return Array.from(new Set(allUrls));
}

/**
 * Parse a Sakugablog article page into a ScrapedPage.
 */
export function parseSakugablogArticle(html: string, url: string): ScrapedPage | null {
  // Extract title from <title> or <h1>
  const title = extractMeta(html, /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
    ?? extractMeta(html, /<title>([\s\S]*?)<\/title>/i)
    ?? "Untitled";

  // Extract article content from entry-content div
  const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<div[^>]*class="[^"]*entry-footer)/i);
  const rawContent = contentMatch ? contentMatch[1] : "";
  const content = extractTextFromHtml(rawContent);

  if (!content || content.length < 100) return null; // Skip empty/stub pages

  // Extract author
  const author = extractMeta(html, /class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    ?? extractMeta(html, /<meta[^>]*name="author"[^>]*content="([^"]+)"/i)
    ?? "Sakugablog";

  // Extract publish date
  const publishedAt = extractMeta(html, /<time[^>]*datetime="([^"]+)"/i)
    ?? extractMeta(html, /<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i);

  // Extract tags/categories
  const tagMatches = html.match(/class="[^"]*tag-link[^"]*"[^>]*>([^<]+)/gi) || [];
  const tags = tagMatches.map(t => {
    const m = t.match(/>([^<]+)/);
    return m ? m[1].trim().toLowerCase() : "";
  }).filter(Boolean);

  // Determine cross-tags
  const contentLower = content.toLowerCase();
  const hasGengaContent = GENGA_KEYWORDS.some(kw => contentLower.includes(kw));

  return {
    url,
    title: extractTextFromHtml(title).replace(/\s*[-–|].*$/, ""), // Clean title
    content,
    author,
    publishedAt: publishedAt ?? undefined,
    tags,
    metadata: {
      source: "sakugablog",
      wordCount: content.split(/\s+/).length,
      crossTags: hasGengaContent ? ["genga"] : [],
      hasGengaContent,
    },
  };
}

/**
 * Run the full Sakugablog ingestion.
 */
export async function scrapeSakugablog(
  onProgress?: (progress: IngestionProgress) => void,
  shouldAbort?: () => boolean,
  maxArticles?: number,
): Promise<ScrapeResult> {
  // Phase 1: Discover URLs
  const urls = await discoverSakugablogUrls();
  const targetUrls = maxArticles ? urls.slice(0, maxArticles) : urls;

  // Phase 2: Scrape articles
  return batchScrape(
    targetUrls,
    SAKUGABLOG_CONFIG,
    parseSakugablogArticle,
    onProgress,
    shouldAbort,
  );
}
