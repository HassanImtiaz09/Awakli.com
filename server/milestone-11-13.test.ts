/**
 * Tests for Milestones 11, 12, 13
 *
 * M11: Multi-Language Subtitle Support (subtitle-translator.ts)
 * M12: Batch Assembly Navigation (StudioSidebar nav items)
 * M13: Watch Page Engagement (engagement.ts + routers-engagement.ts)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── M11: Subtitle Translator Tests ────────────────────────────────────

describe("Milestone 11: Subtitle Translator", () => {
  describe("SUPPORTED_LANGUAGES", () => {
    it("exports all 8 supported languages", async () => {
      const { SUPPORTED_LANGUAGES } = await import("./subtitle-translator");
      expect(Object.keys(SUPPORTED_LANGUAGES)).toHaveLength(8);
      expect(SUPPORTED_LANGUAGES).toHaveProperty("en");
      expect(SUPPORTED_LANGUAGES).toHaveProperty("ja");
      expect(SUPPORTED_LANGUAGES).toHaveProperty("es");
      expect(SUPPORTED_LANGUAGES).toHaveProperty("fr");
      expect(SUPPORTED_LANGUAGES).toHaveProperty("de");
      expect(SUPPORTED_LANGUAGES).toHaveProperty("pt");
      expect(SUPPORTED_LANGUAGES).toHaveProperty("ko");
      expect(SUPPORTED_LANGUAGES).toHaveProperty("zh");
    });

    it("each language has label and nativeName", async () => {
      const { SUPPORTED_LANGUAGES } = await import("./subtitle-translator");
      for (const [code, info] of Object.entries(SUPPORTED_LANGUAGES)) {
        expect(info.label).toBeTruthy();
        expect(info.nativeName).toBeTruthy();
      }
    });
  });

  describe("isLanguageSupported", () => {
    it("returns true for supported languages", async () => {
      const { isLanguageSupported } = await import("./subtitle-translator");
      expect(isLanguageSupported("en")).toBe(true);
      expect(isLanguageSupported("ja")).toBe(true);
      expect(isLanguageSupported("zh")).toBe(true);
    });

    it("returns false for unsupported languages", async () => {
      const { isLanguageSupported } = await import("./subtitle-translator");
      expect(isLanguageSupported("xx")).toBe(false);
      expect(isLanguageSupported("")).toBe(false);
      expect(isLanguageSupported("elvish")).toBe(false);
    });
  });

  describe("getLanguageLabel", () => {
    it("returns correct label for known languages", async () => {
      const { getLanguageLabel } = await import("./subtitle-translator");
      expect(getLanguageLabel("en")).toBe("English");
      expect(getLanguageLabel("ja")).toBe("Japanese");
      expect(getLanguageLabel("es")).toBe("Spanish");
      expect(getLanguageLabel("fr")).toBe("French");
      expect(getLanguageLabel("de")).toBe("German");
      expect(getLanguageLabel("pt")).toBe("Portuguese");
      expect(getLanguageLabel("ko")).toBe("Korean");
      expect(getLanguageLabel("zh")).toBe("Chinese");
    });

    it("returns the code itself for unknown languages", async () => {
      const { getLanguageLabel } = await import("./subtitle-translator");
      expect(getLanguageLabel("xx")).toBe("xx");
    });
  });

  describe("translateSrt — error cases", () => {
    it("returns error for unsupported language", async () => {
      const { translateSrt } = await import("./subtitle-translator");
      const result = await translateSrt(1, "elvish");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported language");
      expect(result.status).toBe("error");
    });
  });
});

// ─── M11: SRT Parsing (via srt-to-vtt) ────────────────────────────────

describe("Milestone 11: SRT/VTT Conversion Integration", () => {
  it("convertSrtToVtt preserves timing for multi-language use", async () => {
    const { convertSrtToVtt } = await import("./srt-to-vtt");
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:08,200
This is a test
`;
    const result = convertSrtToVtt(srt);
    expect(result.success).toBe(true);
    expect(result.cueCount).toBe(2);
    expect(result.vttContent).toContain("WEBVTT");
    expect(result.vttContent).toContain("00:00:01.000 --> 00:00:04.000");
    expect(result.vttContent).toContain("00:00:05.500 --> 00:00:08.200");
    expect(result.vttContent).toContain("Hello world");
    expect(result.vttContent).toContain("This is a test");
  });

  it("handles BOM in translated SRT content", async () => {
    const { convertSrtToVtt } = await import("./srt-to-vtt");
    const srt = `\uFEFF1
00:00:01,000 --> 00:00:03,000
こんにちは世界
`;
    const result = convertSrtToVtt(srt);
    expect(result.success).toBe(true);
    expect(result.cueCount).toBe(1);
    expect(result.vttContent).toContain("こんにちは世界");
  });

  it("handles multi-line translated subtitles", async () => {
    const { convertSrtToVtt } = await import("./srt-to-vtt");
    const srt = `1
00:00:01,000 --> 00:00:04,000
Bonjour le monde
Comment allez-vous?
`;
    const result = convertSrtToVtt(srt);
    expect(result.success).toBe(true);
    expect(result.vttContent).toContain("Bonjour le monde");
    expect(result.vttContent).toContain("Comment allez-vous?");
  });
});

// ─── M13: Engagement Service Tests ─────────────────────────────────────

describe("Milestone 13: Engagement Service", () => {
  describe("module exports", () => {
    it("exports all required functions", async () => {
      const engagement = await import("./engagement");
      // toggleLike/getLikeStatus/getLikeCount removed (voting feature deleted)
      expect(typeof engagement.addComment).toBe("function");
      expect(typeof engagement.getComments).toBe("function");
      expect(typeof engagement.removeComment).toBe("function");
      expect(typeof engagement.getRelatedEpisodes).toBe("function");
    });
  });
});

// ─── M13: Engagement Router Tests ──────────────────────────────────────

describe("Milestone 13: Engagement Router", () => {
  describe("module exports", () => {
    it("exports engagementRouter", async () => {
      const { engagementRouter } = await import("./routers-engagement");
      expect(engagementRouter).toBeDefined();
    });
  });

  describe("router procedures exist", () => {
    it("has all expected procedures", async () => {
      const { engagementRouter } = await import("./routers-engagement");
      const procedures = Object.keys((engagementRouter as any)._def.procedures || {});
      // toggleLike/getLikeStatus/getLikeCount removed (voting feature deleted)
      expect(procedures).toContain("addComment");
      expect(procedures).toContain("getComments");
      expect(procedures).toContain("deleteComment");
      expect(procedures).toContain("getRelatedEpisodes");
    });
  });
});

// ─── M13: Engagement in appRouter ──────────────────────────────────────

describe("Milestone 13: appRouter integration", () => {
  it("engagement router is registered in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const procedures = Object.keys((appRouter as any)._def.procedures || {});
    const hasEngagement = procedures.some((p) => p.startsWith("engagement."));
    expect(hasEngagement).toBe(true);
  });
});

// ─── M11: Captions Router Extension Tests ──────────────────────────────

describe("Milestone 11: Captions Router Extensions", () => {
  it("captionsRouter has translateSubtitle procedure", async () => {
    const { captionsRouter } = await import("./routers-captions");
    const procedures = Object.keys((captionsRouter as any)._def.procedures || {});
    expect(procedures).toContain("translateSubtitle");
  });

  it("captionsRouter has listLanguages procedure", async () => {
    const { captionsRouter } = await import("./routers-captions");
    const procedures = Object.keys((captionsRouter as any)._def.procedures || {});
    expect(procedures).toContain("listLanguages");
  });

  it("captionsRouter has deleteLanguage procedure", async () => {
    const { captionsRouter } = await import("./routers-captions");
    const procedures = Object.keys((captionsRouter as any)._def.procedures || {});
    expect(procedures).toContain("deleteLanguage");
  });

  it("captions router is registered in appRouter", async () => {
    const { appRouter } = await import("./routers");
    const procedures = Object.keys((appRouter as any)._def.procedures || {});
    const hasCaptions = procedures.some((p) => p.startsWith("captions."));
    expect(hasCaptions).toBe(true);
    const hasTranslate = procedures.some((p) => p === "captions.translateSubtitle");
    expect(hasTranslate).toBe(true);
  });
});

// ─── M12: Navigation Structure Tests ───────────────────────────────────

describe("Milestone 12: Batch Assembly Navigation", () => {
  it("StudioSidebar has batch assembly route", async () => {
    // Read the file content to verify the nav structure
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/components/awakli/StudioSidebar.tsx", "utf-8");
    expect(content).toContain("batch-assembly");
    expect(content).toContain("Batch Assembly");
  });

  it("StudioSidebar has analytics route", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/components/awakli/StudioSidebar.tsx", "utf-8");
    expect(content).toContain("analytics");
    expect(content).toContain("Analytics");
  });

  it("TopNav has batch assembly in creator dropdown", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/components/awakli/TopNav.tsx", "utf-8");
    expect(content).toContain("batch-assembly");
    expect(content).toContain("Batch Assembly");
  });
});

// ─── M11: Episode Subtitles Schema Tests ───────────────────────────────

describe("Milestone 11: Episode Subtitles Schema", () => {
  it("episodeSubtitles table is defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.episodeSubtitles).toBeDefined();
  });

  it("schema has correct column names", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.episodeSubtitles;
    // Check key columns exist by inspecting the table definition
    const columnNames = Object.keys((table as any));
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("episodeId");
    expect(columnNames).toContain("language");
    expect(columnNames).toContain("label");
    expect(columnNames).toContain("srtUrl");
    expect(columnNames).toContain("vttUrl");
    expect(columnNames).toContain("status");
  });
});
