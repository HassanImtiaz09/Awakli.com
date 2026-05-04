/**
 * D10 Craft Library — Pixiv Tutorials Scraper
 *
 * Scrapes technique tutorials from Pixiv's tutorial/how-to section.
 * Targets: drawing tutorials, animation technique guides, coloring tutorials.
 *
 * Content mapping:
 * - Sub-sensei: "manga" (primary for drawing), cross-tagged "genga" for animation tutorials
 * - Source type: "tutorial"
 *
 * Note: Uses Pixiv's public encyclopedia/tutorial pages, not user artwork.
 * Respects Pixiv's rate limits and terms of service.
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

const PIXIV_CONFIG: ScraperConfig = {
  baseUrl: "https://www.pixiv.net",
  delayMs: 3000, // Very respectful — Pixiv is strict
  maxRetries: 2,
  maxPages: 200,
  headers: {
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
  },
};

// Animation-related keywords for genga cross-tagging
const ANIMATION_KEYWORDS = [
  "animation", "アニメーション", "動画", "原画", "genga",
  "keyframe", "in-between", "timing", "walk cycle",
  "run cycle", "effects", "エフェクト", "動き",
];

// Drawing technique keywords for manga sub-sensei
const DRAWING_KEYWORDS = [
  "drawing", "描き方", "tutorial", "講座", "technique",
  "coloring", "着色", "shading", "線画", "ペン入れ",
  "anatomy", "perspective", "composition", "構図",
];

/**
 * Discover tutorial URLs from Pixiv's tutorial/how-to sections.
 * Uses the public Pixiv encyclopedia and tutorial tag pages.
 */
export async function discoverPixivTutorialUrls(): Promise<string[]> {
  const allUrls: string[] = [];

  // Pixiv tutorial discovery via their public tutorial tag pages
  const seedUrls = [
    "https://www.pixiv.net/en/tags/%E8%AC%9B%E5%BA%A7/artworks", // 講座 (tutorial)
    "https://www.pixiv.net/en/tags/%E6%8F%8F%E3%81%8D%E6%96%B9/artworks", // 描き方 (how to draw)
    "https://www.pixiv.net/en/tags/tutorial/artworks",
    "https://www.pixiv.net/en/tags/%E3%82%A2%E3%83%8B%E3%83%A1%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3%E8%AC%9B%E5%BA%A7/artworks", // アニメーション講座
  ];

  for (const seedUrl of seedUrls) {
    const result = await fetchWithRetry(seedUrl, PIXIV_CONFIG);
    if (!result) continue;

    // Extract artwork/tutorial links
    const links = extractLinks(
      result.html,
      PIXIV_CONFIG.baseUrl,
      /pixiv\.net\/en\/artworks\/\d+/,
    );

    allUrls.push(...links);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Also try the Pixiv encyclopedia for technique articles
  const encyclopediaSeeds = [
    "https://dic.pixiv.net/a/%E6%8F%8F%E3%81%8D%E6%96%B9", // 描き方
    "https://dic.pixiv.net/a/%E3%82%A2%E3%83%8B%E3%83%A1%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3", // アニメーション
  ];

  for (const seedUrl of encyclopediaSeeds) {
    const result = await fetchWithRetry(seedUrl, { ...PIXIV_CONFIG, baseUrl: "https://dic.pixiv.net" });
    if (!result) continue;

    const links = extractLinks(
      result.html,
      "https://dic.pixiv.net",
      /dic\.pixiv\.net\/a\//,
    );

    allUrls.push(...links);
    await new Promise(r => setTimeout(r, 2000));
  }

  return Array.from(new Set(allUrls));
}

/**
 * Parse a Pixiv tutorial/encyclopedia page.
 */
export function parsePixivTutorial(html: string, url: string): ScrapedPage | null {
  const isEncyclopedia = url.includes("dic.pixiv.net");

  // Extract title
  const title = isEncyclopedia
    ? extractMeta(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
    : extractMeta(html, /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
      ?? extractMeta(html, /<title>([\s\S]*?)<\/title>/i);

  if (!title) return null;

  // Extract content
  let content: string;
  if (isEncyclopedia) {
    // Encyclopedia article body
    const bodyMatch = html.match(/<div[^>]*id="article-body"[^>]*>([\s\S]*?)<\/div>/i);
    content = bodyMatch ? extractTextFromHtml(bodyMatch[1]) : extractTextFromHtml(html);
  } else {
    // Artwork description (tutorial text in description)
    const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
    content = descMatch ? descMatch[1] : "";

    // Also try to get figcaption/description from the page
    const captionMatch = html.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (captionMatch) {
      content = extractTextFromHtml(captionMatch[1]) + "\n\n" + content;
    }
  }

  if (!content || content.length < 50) return null;

  // Extract tags
  const tagMatches = html.match(/class="[^"]*tag[^"]*"[^>]*>([^<]+)/gi) || [];
  const tags = tagMatches.map(t => {
    const m = t.match(/>([^<]+)/);
    return m ? m[1].trim() : "";
  }).filter(Boolean);

  // Determine sub-sensei and cross-tags
  const contentLower = (content + " " + tags.join(" ")).toLowerCase();
  const hasAnimationContent = ANIMATION_KEYWORDS.some(kw => contentLower.includes(kw.toLowerCase()));
  const hasDrawingContent = DRAWING_KEYWORDS.some(kw => contentLower.includes(kw.toLowerCase()));

  // Primary sub-sensei: manga for drawing, genga for animation
  const primarySubSensei = hasAnimationContent ? "genga" : "manga";
  const crossTags: string[] = [];
  if (hasAnimationContent && hasDrawingContent) crossTags.push("manga");
  if (hasDrawingContent && hasAnimationContent) crossTags.push("genga");

  // Extract author
  const author = extractMeta(html, /<meta[^>]*property="og:author"[^>]*content="([^"]+)"/i)
    ?? extractMeta(html, /class="[^"]*user-name[^"]*"[^>]*>([^<]+)/i)
    ?? "Pixiv User";

  return {
    url,
    title: extractTextFromHtml(title),
    content,
    author,
    tags,
    metadata: {
      source: "pixiv_tutorials",
      isEncyclopedia,
      wordCount: content.split(/\s+/).length,
      primarySubSensei,
      crossTags,
      hasAnimationContent,
      hasDrawingContent,
      language: contentLower.match(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/) ? "ja" : "en",
    },
  };
}

/**
 * Run the full Pixiv tutorials ingestion.
 */
export async function scrapePixivTutorials(
  onProgress?: (progress: IngestionProgress) => void,
  shouldAbort?: () => boolean,
  maxArticles?: number,
): Promise<ScrapeResult> {
  const urls = await discoverPixivTutorialUrls();
  const targetUrls = maxArticles ? urls.slice(0, maxArticles) : urls;

  return batchScrape(
    targetUrls,
    PIXIV_CONFIG,
    parsePixivTutorial,
    onProgress,
    shouldAbort,
  );
}
