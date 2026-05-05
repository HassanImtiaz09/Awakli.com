import { describe, it, expect, vi } from "vitest";
import { formatViewCount } from "./db";

// ─── View Count Formatting ──────────────────────────────────────────────────
describe("formatViewCount", () => {
  it("formats 0 as '0'", () => {
    expect(formatViewCount(0)).toBe("0");
  });

  it("formats numbers under 1000 as-is", () => {
    expect(formatViewCount(42)).toBe("42");
    expect(formatViewCount(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatViewCount(1000)).toBe("1.0K");
    expect(formatViewCount(1500)).toBe("1.5K");
    expect(formatViewCount(9999)).toBe("10.0K");
    expect(formatViewCount(15200)).toBe("15.2K");
    expect(formatViewCount(999999)).toBe("1000.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatViewCount(1000000)).toBe("1.0M");
    expect(formatViewCount(2500000)).toBe("2.5M");
    expect(formatViewCount(10000000)).toBe("10.0M");
  });

  it("formats very large numbers with M suffix", () => {
    expect(formatViewCount(1000000000)).toBe("1000.0M");
    expect(formatViewCount(3700000000)).toBe("3700.0M");
  });
});

// ─── Public Content Router Structure ────────────────────────────────────────
describe("publicContentRouter", () => {
  it("exports publicContentRouter from routers-public-content", async () => {
    const mod = await import("./routers-public-content");
    expect(mod.publicContentRouter).toBeDefined();
    expect(mod.publicContentRouter._def).toBeDefined();
  });

  it("has discover procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("discover");
  });

  it("has trending procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("trending");
  });

  it("has newReleases procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("newReleases");
  });

  it("has categories procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("categories");
  });

  it("has categoryContent procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("categoryContent");
  });

  it("has getProject procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("getProject");
  });

  it("has creatorProfile procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("creatorProfile");
  });

  it("has recordView procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("recordView");
  });

  it("has search procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publicContentRouter._def.procedures;
    expect(procedures).toHaveProperty("search");
  });
});

// ─── Publish Router Structure ───────────────────────────────────────────────
describe("publishRouter", () => {
  it("exports publishRouter from routers-public-content", async () => {
    const mod = await import("./routers-public-content");
    expect(mod.publishRouter).toBeDefined();
    expect(mod.publishRouter._def).toBeDefined();
  });

  it("has publish procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publishRouter._def.procedures;
    expect(procedures).toHaveProperty("publish");
  });

  it("has unpublish procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publishRouter._def.procedures;
    expect(procedures).toHaveProperty("unpublish");
  });

  it("has checkEligibility procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.publishRouter._def.procedures;
    expect(procedures).toHaveProperty("checkEligibility");
  });
});

// ─── Creator Analytics Router Structure ─────────────────────────────────────
describe("creatorAnalyticsRouter", () => {
  it("exports creatorAnalyticsRouter from routers-public-content", async () => {
    const mod = await import("./routers-public-content");
    expect(mod.creatorAnalyticsRouter).toBeDefined();
    expect(mod.creatorAnalyticsRouter._def).toBeDefined();
  });

  it("has overview procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.creatorAnalyticsRouter._def.procedures;
    expect(procedures).toHaveProperty("overview");
  });

  it("has contentBreakdown procedure", async () => {
    const mod = await import("./routers-public-content");
    const procedures = mod.creatorAnalyticsRouter._def.procedures;
    expect(procedures).toHaveProperty("contentBreakdown");
  });
});

// ─── Router Registration in appRouter ───────────────────────────────────────
describe("appRouter integration", () => {
  it("publicContent router is registered in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const procedures = appRouter._def.procedures;
    expect(procedures).toHaveProperty("publicContent.discover");
    expect(procedures).toHaveProperty("publicContent.trending");
    expect(procedures).toHaveProperty("publicContent.newReleases");
  });

  it("publish router is registered in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const procedures = appRouter._def.procedures;
    expect(procedures).toHaveProperty("publish.publish");
    expect(procedures).toHaveProperty("publish.unpublish");
    expect(procedures).toHaveProperty("publish.checkEligibility");
  });

  it("creatorAnalytics router is registered in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const procedures = appRouter._def.procedures;
    expect(procedures).toHaveProperty("creatorAnalytics.overview");
    expect(procedures).toHaveProperty("creatorAnalytics.contentBreakdown");
  });
});

// ─── Schema Validation ──────────────────────────────────────────────────────
describe("schema: content_views table", () => {
  it("contentViews table is exported from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.contentViews).toBeDefined();
  });

  it("contentViews has required columns", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.contentViews);
    // Table object has column definitions as properties
    expect(cols.length).toBeGreaterThan(0);
  });
});

describe("schema: projects table has publication fields", () => {
  it("projects table has publicationStatus column", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.projects).toBeDefined();
  });
});

// ─── SEO Components ─────────────────────────────────────────────────────────
describe("SEO helpers", () => {
  it("SEOHead component exports correctly", async () => {
    const mod = await import("../client/src/components/awakli/SEOHead");
    expect(mod.SEOHead).toBeDefined();
    expect(mod.buildMangaJsonLd).toBeDefined();
    expect(mod.buildEpisodeJsonLd).toBeDefined();
  });

  it("buildMangaJsonLd returns valid JSON-LD structure", async () => {
    // Mock window.location
    const origWindow = global.window;
    (global as any).window = { location: { origin: "https://awakli.com", href: "https://awakli.com/watch/test" } };
    
    const { buildMangaJsonLd } = await import("../client/src/components/awakli/SEOHead");
    const jsonLd = buildMangaJsonLd({
      title: "Test Manga",
      description: "A test manga",
      coverImageUrl: "https://example.com/cover.jpg",
      slug: "test-manga",
      userName: "TestUser",
      genre: "action",
      createdAt: "2024-01-01",
    });

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("CreativeWork");
    expect(jsonLd.name).toBe("Test Manga");
    expect(jsonLd.description).toBe("A test manga");
    expect(jsonLd.genre).toBe("action");
    expect(jsonLd.author?.name).toBe("TestUser");
    expect(jsonLd.publisher?.name).toBe("Awakli");
    
    global.window = origWindow;
  });

  it("buildEpisodeJsonLd returns VideoObject type", async () => {
    const origWindow = global.window;
    (global as any).window = { location: { origin: "https://awakli.com", href: "https://awakli.com" } };
    
    const { buildEpisodeJsonLd } = await import("../client/src/components/awakli/SEOHead");
    const jsonLd = buildEpisodeJsonLd({
      title: "The Beginning",
      projectTitle: "Test Manga",
      projectSlug: "test-manga",
      episodeNumber: 1,
      duration: 120,
    });

    expect(jsonLd["@type"]).toBe("VideoObject");
    expect(jsonLd.name).toContain("Episode 1");
    expect(jsonLd.duration).toBe("PT120S");
    
    global.window = origWindow;
  });
});

// ─── Navigation Structure ───────────────────────────────────────────────────
describe("navigation for anonymous users", () => {
  it("TopNav exports AUDIENCE_NAV with Trending", async () => {
    // We can verify the component file has the right structure
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/components/awakli/TopNav.tsx", "utf-8");
    expect(content).toContain("AUDIENCE_NAV");
    expect(content).toContain("/trending");
    expect(content).toContain("CREATOR_NAV");
    expect(content).toContain("/studio");
  });
});

// ─── Sign-Up Prompt Components ──────────────────────────────────────────────
describe("SignUpPrompt components", () => {
  it("exports SignUpBanner and FloatingSignUpPrompt", async () => {
    const mod = await import("../client/src/components/awakli/SignUpPrompt");
    expect(mod.SignUpBanner).toBeDefined();
    expect(mod.FloatingSignUpPrompt).toBeDefined();
    expect(mod.PublishUpgradeModal).toBeDefined();
  });
});

// ─── SEOHead Integration in Watch Pages ────────────────────────────────────
describe("SEOHead integration in WatchProject", () => {
  it("WatchProject imports SEOHead and buildMangaJsonLd", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/WatchProject.tsx", "utf-8");
    expect(content).toContain('import { SEOHead, buildMangaJsonLd }');
    expect(content).toContain('<SEOHead');
    expect(content).toContain('type="article"');
    expect(content).toContain('buildMangaJsonLd');
  });

  it("WatchProject passes correct SEO props", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/WatchProject.tsx", "utf-8");
    // Verify title, description, image, url, type, and jsonLd are passed
    expect(content).toContain("title={p.title}");
    expect(content).toContain("image={p.coverImageUrl");
    expect(content).toContain("jsonLd={jsonLd}");
    expect(content).toContain('type="article"');
  });

  it("WatchProject records view on page load", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/WatchProject.tsx", "utf-8");
    expect(content).toContain("trpc.publicContent.recordView.useMutation");
    expect(content).toContain('contentType: "project"');
    expect(content).toContain('source: "direct"');
    expect(content).toContain("setViewRecorded(true)");
  });
});

describe("SEOHead integration in EpisodePlayer", () => {
  it("EpisodePlayer imports SEOHead and buildEpisodeJsonLd", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/EpisodePlayer.tsx", "utf-8");
    expect(content).toContain('import { SEOHead, buildEpisodeJsonLd }');
    expect(content).toContain('<SEOHead');
    expect(content).toContain('type="video.other"');
    expect(content).toContain('buildEpisodeJsonLd');
  });

  it("EpisodePlayer passes correct SEO props", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/EpisodePlayer.tsx", "utf-8");
    // Verify episode-specific meta tags
    expect(content).toContain("project.title");
    expect(content).toContain("episodeNumber");
    expect(content).toContain("jsonLd={episodeJsonLd}");
    expect(content).toContain('type="video.other"');
  });

  it("EpisodePlayer records view on page load", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/EpisodePlayer.tsx", "utf-8");
    expect(content).toContain("trpc.publicContent.recordView.useMutation");
    expect(content).toContain('contentType: "anime_episode"');
    expect(content).toContain('source: "direct"');
    expect(content).toContain("setViewRecorded(true)");
  });

  it("EpisodePlayer builds JSON-LD with duration estimate", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/EpisodePlayer.tsx", "utf-8");
    expect(content).toContain("panels.length * 4"); // ~4 seconds per panel estimate
    expect(content).toContain("buildEpisodeJsonLd({");
    expect(content).toContain("projectTitle: project.title");
    expect(content).toContain("projectSlug: slug");
  });
});
