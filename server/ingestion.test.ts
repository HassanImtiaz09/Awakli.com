/**
 * D10 Craft Library — Ingestion System Tests
 *
 * Tests the scraper framework, source-specific scrapers, chunking pipeline,
 * orchestrator, and tRPC router.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";

// ─── Scraper Framework Tests ───────────────────────────────────────────

describe("Scraper Framework", () => {
  it("exports extractTextFromHtml", async () => {
    const { extractTextFromHtml } = await import("./benchmarks/d10/ingestion/scraper");
    expect(typeof extractTextFromHtml).toBe("function");
  });

  it("strips HTML tags correctly", async () => {
    const { extractTextFromHtml } = await import("./benchmarks/d10/ingestion/scraper");
    const result = extractTextFromHtml("<p>Hello <strong>world</strong></p>");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<strong>");
  });

  it("removes script and style blocks", async () => {
    const { extractTextFromHtml } = await import("./benchmarks/d10/ingestion/scraper");
    const html = '<p>Keep this</p><script>alert("remove")</script><style>.hide{}</style><p>And this</p>';
    const result = extractTextFromHtml(html);
    expect(result).toContain("Keep this");
    expect(result).toContain("And this");
    expect(result).not.toContain("alert");
    expect(result).not.toContain(".hide");
  });

  it("decodes HTML entities", async () => {
    const { extractTextFromHtml } = await import("./benchmarks/d10/ingestion/scraper");
    const result = extractTextFromHtml("&amp; &lt; &gt; &quot; &#39;");
    expect(result).toBe('& < > " \'');
  });

  it("exports extractLinks", async () => {
    const { extractLinks } = await import("./benchmarks/d10/ingestion/scraper");
    expect(typeof extractLinks).toBe("function");
  });

  it("extracts and deduplicates links", async () => {
    const { extractLinks } = await import("./benchmarks/d10/ingestion/scraper");
    const html = '<a href="/page1">Link 1</a><a href="/page1">Dup</a><a href="/page2">Link 2</a>';
    const links = extractLinks(html, "https://example.com");
    expect(links).toHaveLength(2);
    expect(links).toContain("https://example.com/page1");
    expect(links).toContain("https://example.com/page2");
  });

  it("filters links by pattern", async () => {
    const { extractLinks } = await import("./benchmarks/d10/ingestion/scraper");
    const html = '<a href="/articles/1">Art</a><a href="/about">About</a><a href="/articles/2">Art2</a>';
    const links = extractLinks(html, "https://example.com", /\/articles\//);
    expect(links).toHaveLength(2);
    expect(links.every(l => l.includes("/articles/"))).toBe(true);
  });

  it("exports createProgressTracker", async () => {
    const { createProgressTracker } = await import("./benchmarks/d10/ingestion/scraper");
    const progress = createProgressTracker("test", 100);
    expect(progress.sourceKey).toBe("test");
    expect(progress.totalUrls).toBe(100);
    expect(progress.status).toBe("idle");
    expect(progress.processedUrls).toBe(0);
  });

  it("exports updateProgress with timing estimates", async () => {
    const { createProgressTracker, updateProgress } = await import("./benchmarks/d10/ingestion/scraper");
    let progress = createProgressTracker("test", 10);
    progress.startedAt = Date.now() - 5000; // 5 seconds ago
    progress.processedUrls = 5;
    progress = updateProgress(progress, {});
    expect(progress.estimatedRemainingMs).toBeDefined();
    expect(progress.estimatedRemainingMs).toBeGreaterThan(0);
  });
});

// ─── Source-Specific Scraper Tests ─────────────────────────────────────

describe("Sakugablog Scraper", () => {
  it("exports parseSakugablogArticle", async () => {
    const { parseSakugablogArticle } = await import("./benchmarks/d10/ingestion/sakugablog");
    expect(typeof parseSakugablogArticle).toBe("function");
  });

  it("parses article HTML correctly", async () => {
    const { parseSakugablogArticle } = await import("./benchmarks/d10/ingestion/sakugablog");
    const html = `
      <h1 class="entry-title">Animation Techniques in Mob Psycho 100</h1>
      <time datetime="2024-01-15T12:00:00Z">Jan 15</time>
      <div class="entry-content">
        <p>This article explores the key animation techniques used in Mob Psycho 100, 
        particularly the sakuga moments that define the show's visual identity. 
        The genga work by Yutaka Nakamura is especially noteworthy for its impact frames 
        and dynamic character acting sequences that push the boundaries of TV animation.</p>
      </div>
      <footer class="entry-footer"></footer>
    `;
    const result = parseSakugablogArticle(html, "https://blog.sakugabooru.com/2024/01/15/mob-psycho/");
    expect(result).not.toBeNull();
    expect(result!.title).toContain("Animation Techniques");
    expect(result!.content).toContain("key animation");
    expect(result!.metadata?.hasGengaContent).toBe(true);
  });

  it("returns null for short/empty content", async () => {
    const { parseSakugablogArticle } = await import("./benchmarks/d10/ingestion/sakugablog");
    const html = `<h1 class="entry-title">Short</h1><div class="entry-content"><p>Too short</p></div><footer class="entry-footer"></footer>`;
    const result = parseSakugablogArticle(html, "https://example.com");
    expect(result).toBeNull();
  });
});

describe("Sakugabooru Scraper", () => {
  it("exports fetchSakugabooruPosts", async () => {
    const { fetchSakugabooruPosts } = await import("./benchmarks/d10/ingestion/sakugabooru");
    expect(typeof fetchSakugabooruPosts).toBe("function");
  });
});

describe("Animation Obsessive Scraper", () => {
  it("exports parseAOArticle", async () => {
    const { parseAOArticle } = await import("./benchmarks/d10/ingestion/animation-obsessive");
    expect(typeof parseAOArticle).toBe("function");
  });

  it("parses Substack article HTML", async () => {
    const { parseAOArticle } = await import("./benchmarks/d10/ingestion/animation-obsessive");
    const html = `
      <meta property="og:title" content="The Art of Timing in Animation" />
      <meta property="og:description" content="A deep dive into timing and spacing" />
      <meta name="author" content="Animation Obsessive" />
      <time datetime="2024-03-01T10:00:00Z">Mar 1</time>
      <div class="body markup">
        <p>Timing is the fundamental principle that separates great animation from merely adequate animation.
        In key animation (genga), the spacing between keyframes determines the weight, speed, and emotion
        of every movement. This essay explores how master animators use timing to create unforgettable sequences
        across decades of animation history, from Disney's golden age to modern Japanese anime production.</p>
      </div>
      <div class="subscription"></div>
    `;
    const result = parseAOArticle(html, "https://animationobsessive.substack.com/p/timing");
    expect(result).not.toBeNull();
    expect(result!.title).toContain("Timing");
    expect(result!.metadata?.hasGengaContent).toBe(true);
  });
});

describe("Pixiv Tutorials Scraper", () => {
  it("exports parsePixivTutorial", async () => {
    const { parsePixivTutorial } = await import("./benchmarks/d10/ingestion/pixiv-tutorials");
    expect(typeof parsePixivTutorial).toBe("function");
  });
});

// ─── Chunking Pipeline Tests ───────────────────────────────────────────

describe("Chunking Pipeline", () => {
  it("exports chunkAndStore and batchChunkAndStore", async () => {
    const { chunkAndStore, batchChunkAndStore } = await import("./benchmarks/d10/ingestion/chunker");
    expect(typeof chunkAndStore).toBe("function");
    expect(typeof batchChunkAndStore).toBe("function");
  });
});

// ─── Orchestrator Tests ────────────────────────────────────────────────

describe("Ingestion Orchestrator", () => {
  it("exports all source configs", async () => {
    const { INGESTION_SOURCES } = await import("./benchmarks/d10/ingestion/orchestrator");
    expect(INGESTION_SOURCES.sakugablog).toBeDefined();
    expect(INGESTION_SOURCES.sakugabooru).toBeDefined();
    expect(INGESTION_SOURCES.animation_obsessive).toBeDefined();
    expect(INGESTION_SOURCES.pixiv_tutorials).toBeDefined();
  });

  it("has correct sub-sensei mappings", async () => {
    const { INGESTION_SOURCES } = await import("./benchmarks/d10/ingestion/orchestrator");
    expect(INGESTION_SOURCES.sakugablog.subSensei).toBe("anime");
    expect(INGESTION_SOURCES.sakugabooru.subSensei).toBe("genga");
    expect(INGESTION_SOURCES.animation_obsessive.subSensei).toBe("anime");
    expect(INGESTION_SOURCES.pixiv_tutorials.subSensei).toBe("manga");
  });

  it("has correct source types", async () => {
    const { INGESTION_SOURCES } = await import("./benchmarks/d10/ingestion/orchestrator");
    expect(INGESTION_SOURCES.sakugablog.sourceType).toBe("web_article");
    expect(INGESTION_SOURCES.sakugabooru.sourceType).toBe("reference_image_set");
    expect(INGESTION_SOURCES.animation_obsessive.sourceType).toBe("web_article");
    expect(INGESTION_SOURCES.pixiv_tutorials.sourceType).toBe("tutorial");
  });

  it("exports getSourceSummary", async () => {
    const { getSourceSummary } = await import("./benchmarks/d10/ingestion/orchestrator");
    const summary = getSourceSummary();
    expect(summary).toHaveLength(4);
    expect(summary[0].key).toBeDefined();
    expect(summary[0].label).toBeDefined();
    expect(summary[0].estimatedArticles).toBeGreaterThan(0);
  });

  it("exports listJobs (initially empty)", async () => {
    const { listJobs } = await import("./benchmarks/d10/ingestion/orchestrator");
    const jobs = listJobs();
    expect(Array.isArray(jobs)).toBe(true);
  });

  it("exports getJobState (returns null for unknown)", async () => {
    const { getJobState } = await import("./benchmarks/d10/ingestion/orchestrator");
    const state = getJobState("nonexistent-job");
    expect(state).toBeNull();
  });

  it("exports pauseJob (returns false for unknown)", async () => {
    const { pauseJob } = await import("./benchmarks/d10/ingestion/orchestrator");
    const result = pauseJob("nonexistent-job");
    expect(result).toBe(false);
  });
});

// ─── Router Tests ──────────────────────────────────────────────────────

describe("Ingestion Router", () => {
  const adminCaller = appRouter.createCaller({
    user: { id: 1, openId: "admin-1", name: "Admin", role: "admin" } as any,
    req: {} as any,
    resHeaders: new Headers(),
  });

  const userCaller = appRouter.createCaller({
    user: { id: 2, openId: "user-2", name: "User", role: "user" } as any,
    req: {} as any,
    resHeaders: new Headers(),
  });

  const anonCaller = appRouter.createCaller({
    user: null as any,
    req: {} as any,
    resHeaders: new Headers(),
  });

  it("admin can get source summary", async () => {
    const summary = await adminCaller.ingestion.getSourceSummary();
    expect(summary).toHaveLength(4);
    expect(summary[0]).toHaveProperty("key");
    expect(summary[0]).toHaveProperty("label");
    expect(summary[0]).toHaveProperty("subSensei");
    expect(summary[0]).toHaveProperty("estimatedArticles");
    expect(summary[0]).toHaveProperty("estimatedCostUsd");
  });

  it("non-admin cannot get source summary", async () => {
    await expect(userCaller.ingestion.getSourceSummary()).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("unauthenticated cannot get source summary", async () => {
    await expect(anonCaller.ingestion.getSourceSummary()).rejects.toThrow();
  });

  it("admin can list jobs", async () => {
    const jobs = await adminCaller.ingestion.listJobs();
    expect(Array.isArray(jobs)).toBe(true);
  });

  it("non-admin cannot list jobs", async () => {
    await expect(userCaller.ingestion.listJobs()).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("non-admin cannot start ingestion", async () => {
    await expect(
      userCaller.ingestion.startIngestion({ sourceKey: "sakugablog" })
    ).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("non-admin cannot pause jobs", async () => {
    await expect(
      userCaller.ingestion.pauseJob({ jobId: "test" })
    ).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("non-admin cannot get job status", async () => {
    await expect(
      userCaller.ingestion.getJobStatus({ jobId: "test" })
    ).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("admin gets NOT_FOUND for unknown job status", async () => {
    await expect(
      adminCaller.ingestion.getJobStatus({ jobId: "nonexistent" })
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  it("admin gets NOT_FOUND when pausing unknown job", async () => {
    await expect(
      adminCaller.ingestion.pauseJob({ jobId: "nonexistent" })
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  it("validates sourceKey enum", async () => {
    await expect(
      adminCaller.ingestion.startIngestion({ sourceKey: "invalid_source" as any })
    ).rejects.toThrow();
  });

  it("validates maxItems range", async () => {
    await expect(
      adminCaller.ingestion.startIngestion({ sourceKey: "sakugablog", maxItems: 0 })
    ).rejects.toThrow();
    await expect(
      adminCaller.ingestion.startIngestion({ sourceKey: "sakugablog", maxItems: 2000 })
    ).rejects.toThrow();
  });
});
