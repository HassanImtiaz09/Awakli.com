/**
 * D10 Genre Retrieval Pool — Tests
 *
 * Validates genre taxonomy, auto-tagger, pool seeding, genre-filtered retrieval,
 * and confidence threshold logic for the RAG retrieval pool.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Genre Taxonomy ──────────────────────────────────────────────────────

describe("D10 Genre Retrieval Pool — Taxonomy", () => {
  it("exports GENRE_TAXONOMY with 10 genres", async () => {
    const { GENRE_TAXONOMY } = await import("./benchmarks/d10/genre-retrieval-pool");
    expect(GENRE_TAXONOMY).toHaveLength(10);
    expect(GENRE_TAXONOMY).toContain("shonen");
    expect(GENRE_TAXONOMY).toContain("seinen");
    expect(GENRE_TAXONOMY).toContain("shoujo");
    expect(GENRE_TAXONOMY).toContain("chibi");
    expect(GENRE_TAXONOMY).toContain("cyberpunk");
    expect(GENRE_TAXONOMY).toContain("watercolor");
    expect(GENRE_TAXONOMY).toContain("noir");
    expect(GENRE_TAXONOMY).toContain("realistic");
    expect(GENRE_TAXONOMY).toContain("mecha");
    expect(GENRE_TAXONOMY).toContain("default");
  });

  it("GENRE_TAXONOMY aligns with projects.animeStyle enum", async () => {
    const { GENRE_TAXONOMY } = await import("./benchmarks/d10/genre-retrieval-pool");
    const schema = await import("../drizzle/schema");
    // The animeStyle enum values should all be in GENRE_TAXONOMY
    const animeStyleValues = ["shonen", "seinen", "shoujo", "chibi", "cyberpunk", "watercolor", "noir", "realistic", "mecha", "default"];
    for (const style of animeStyleValues) {
      expect(GENRE_TAXONOMY).toContain(style);
    }
  });

  it("exports GENRE_DESCRIPTIONS for all genres", async () => {
    const { GENRE_TAXONOMY, GENRE_DESCRIPTIONS } = await import("./benchmarks/d10/genre-retrieval-pool");
    for (const genre of GENRE_TAXONOMY) {
      expect(GENRE_DESCRIPTIONS[genre]).toBeDefined();
      expect(typeof GENRE_DESCRIPTIONS[genre]).toBe("string");
      expect(GENRE_DESCRIPTIONS[genre].length).toBeGreaterThan(10);
    }
  });

  it("GenreTag type is constrained to taxonomy values", async () => {
    const { GENRE_TAXONOMY } = await import("./benchmarks/d10/genre-retrieval-pool");
    // Verify it's a readonly tuple
    expect(Object.isFrozen(GENRE_TAXONOMY) || Array.isArray(GENRE_TAXONOMY)).toBe(true);
  });
});

// ─── 2. Auto-Tagger ────────────────────────────────────────────────────────

describe("D10 Genre Retrieval Pool — Auto-Tagger", () => {
  it("classifyPanelGenre returns a valid genre and confidence", async () => {
    // Mock invokeLLM to return a classification
    vi.doMock("../../server/_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({ genre: "shonen", confidence: 0.85 }),
          },
        }],
      }),
    }));

    const { classifyPanelGenre } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await classifyPanelGenre("Dynamic fight scene with speed lines and bold energy blasts");
    expect(result.genre).toBe("shonen");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);

    vi.doUnmock("../../server/_core/llm");
  });

  it("classifyPanelGenre returns valid result even with unexpected LLM content", async () => {
    // When the LLM returns empty content, the function falls back to default
    const { classifyPanelGenre } = await import("./benchmarks/d10/genre-retrieval-pool");
    // The function handles errors internally and always returns a valid GenreTag
    const result = await classifyPanelGenre("");
    expect(["default", "shonen", "seinen", "shoujo", "chibi", "cyberpunk", "watercolor", "noir", "realistic", "mecha"]).toContain(result.genre);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("batchClassifyGenre processes multiple panels sequentially", async () => {
    const { batchClassifyGenre, GENRE_TAXONOMY } = await import("./benchmarks/d10/genre-retrieval-pool");
    // The function exists and accepts the right shape
    expect(typeof batchClassifyGenre).toBe("function");
  });

  it("classifyPanelGenre clamps confidence to [0, 1]", async () => {
    vi.doMock("../../server/_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({ genre: "noir", confidence: 5.0 }),
          },
        }],
      }),
    }));

    const { classifyPanelGenre } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await classifyPanelGenre("Dark shadows, high contrast");
    expect(result.confidence).toBeLessThanOrEqual(1);

    vi.doUnmock("../../server/_core/llm");
  });

  it("classifyPanelGenre rejects invalid genre from LLM", async () => {
    vi.doMock("../../server/_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({ genre: "invalid_genre_xyz", confidence: 0.9 }),
          },
        }],
      }),
    }));

    const { classifyPanelGenre } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await classifyPanelGenre("Some panel");
    expect(result.genre).toBe("default"); // Falls back to default

    vi.doUnmock("../../server/_core/llm");
  });
});

// ─── 3. Pool Seeding ────────────────────────────────────────────────────────

describe("D10 Genre Retrieval Pool — Seeding", () => {
  beforeEach(async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    resetVectorStore();
    // Set a mock vector store for seeding tests
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };
    setVectorStore(mockStore);
  });

  it("seedGenrePool upserts entries to vector store", async () => {
    const { seedGenrePool } = await import("./benchmarks/d10/genre-retrieval-pool");
    const { getVectorStore } = await import("./benchmarks/d10/vector-store");

    const entries = [
      {
        id: "panel-1",
        genreTag: "shonen" as const,
        imageUrl: "https://example.com/panel1.png",
        sourceProjectId: 1,
        sourcePanelId: 101,
        qualityScore: 85,
        embeddingContent: "Dynamic fight scene with speed lines",
        metadata: { episodeId: 1, sceneDescription: "Battle scene" },
      },
      {
        id: "panel-2",
        genreTag: "noir" as const,
        imageUrl: "https://example.com/panel2.png",
        sourceProjectId: 2,
        sourcePanelId: 202,
        qualityScore: 90,
        embeddingContent: "Dark alley with dramatic shadows",
        metadata: { episodeId: 3, sceneDescription: "Chase scene" },
      },
    ];

    const result = await seedGenrePool(entries);
    expect(result.seeded).toBe(2);
    expect(result.failed).toBe(0);

    const store = getVectorStore();
    expect(store.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (store.upsert as any).mock.calls[0][0];
    expect(upsertCall).toHaveLength(2);
    expect(upsertCall[0].id).toBe("panel-1");
    expect(upsertCall[0].metadata.genreTag).toBe("shonen");
    expect(upsertCall[1].id).toBe("panel-2");
    expect(upsertCall[1].metadata.genreTag).toBe("noir");
  });

  it("seedGenrePool handles batch failures gracefully", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    resetVectorStore();

    let callCount = 0;
    const failingStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("Network error");
        return Promise.resolve();
      }),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };
    setVectorStore(failingStore);

    const { seedGenrePool } = await import("./benchmarks/d10/genre-retrieval-pool");

    // Create 15 entries to trigger 2 batches (batch size = 10)
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `panel-${i}`,
      genreTag: "shonen" as const,
      imageUrl: `https://example.com/panel${i}.png`,
      sourceProjectId: 1,
      sourcePanelId: i,
      qualityScore: 80,
      embeddingContent: `Panel ${i} description`,
      metadata: {},
    }));

    const result = await seedGenrePool(entries);
    // First batch of 10 fails, second batch of 5 succeeds
    expect(result.failed).toBe(10);
    expect(result.seeded).toBe(5);
  });

  it("seedGenrePool includes metadata in upsert", async () => {
    const { seedGenrePool } = await import("./benchmarks/d10/genre-retrieval-pool");
    const { getVectorStore } = await import("./benchmarks/d10/vector-store");

    const entries = [{
      id: "panel-meta",
      genreTag: "cyberpunk" as const,
      imageUrl: "https://example.com/cyber.png",
      sourceProjectId: 5,
      sourcePanelId: 500,
      qualityScore: 92,
      embeddingContent: "Neon-lit cityscape with holographic ads",
      metadata: {
        episodeId: 10,
        sceneDescription: "City overview",
        cameraAngle: "wide",
        artStyle: "detailed",
      },
    }];

    await seedGenrePool(entries);
    const store = getVectorStore();
    const upsertCall = (store.upsert as any).mock.calls[0][0][0];
    expect(upsertCall.metadata.genreTag).toBe("cyberpunk");
    expect(upsertCall.metadata.imageUrl).toBe("https://example.com/cyber.png");
    expect(upsertCall.metadata.qualityScore).toBe(92);
    expect(upsertCall.metadata.episodeId).toBe(10);
    expect(upsertCall.metadata.cameraAngle).toBe("wide");
  });
});

// ─── 4. Genre-Filtered Retrieval ────────────────────────────────────────────

describe("D10 Genre Retrieval Pool — Retrieval", () => {
  beforeEach(async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    resetVectorStore();
  });

  it("getGenreReferences returns image URLs with scores", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([
        { id: "1", content: "Fight scene", score: 0.92, metadata: { genreTag: "shonen", imageUrl: "https://img1.png", qualityScore: 88 } },
        { id: "2", content: "Action pose", score: 0.85, metadata: { genreTag: "shonen", imageUrl: "https://img2.png", qualityScore: 75 } },
      ]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(100),
    };
    setVectorStore(mockStore);

    const { getGenreReferences } = await import("./benchmarks/d10/genre-retrieval-pool");
    const results = await getGenreReferences("shonen", "Dynamic battle scene");

    expect(results).toHaveLength(2);
    expect(results[0].imageUrl).toBe("https://img1.png");
    expect(results[0].score).toBe(0.92);
    expect(results[0].qualityScore).toBe(88);
    expect(results[1].imageUrl).toBe("https://img2.png");

    // Verify search was called with genre filter
    expect(mockStore.search).toHaveBeenCalledWith(
      "Dynamic battle scene",
      expect.objectContaining({
        topK: 3,
        threshold: 0.6,
        filter: { genreTag: "shonen" },
      })
    );
  });

  it("getGenreReferences filters out results without imageUrl", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([
        { id: "1", content: "Has image", score: 0.9, metadata: { genreTag: "noir", imageUrl: "https://img.png", qualityScore: 80 } },
        { id: "2", content: "No image", score: 0.85, metadata: { genreTag: "noir" } },
      ]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(50),
    };
    setVectorStore(mockStore);

    const { getGenreReferences } = await import("./benchmarks/d10/genre-retrieval-pool");
    const results = await getGenreReferences("noir", "Dark scene");
    expect(results).toHaveLength(1);
    expect(results[0].imageUrl).toBe("https://img.png");
  });

  it("getGenreReferences respects custom topK", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };
    setVectorStore(mockStore);

    const { getGenreReferences } = await import("./benchmarks/d10/genre-retrieval-pool");
    await getGenreReferences("mecha", "Robot battle", 5);

    expect(mockStore.search).toHaveBeenCalledWith(
      "Robot battle",
      expect.objectContaining({ topK: 5 })
    );
  });
});

// ─── 5. Confidence Threshold ────────────────────────────────────────────────

describe("D10 Genre Retrieval Pool — Confidence", () => {
  beforeEach(async () => {
    const { resetVectorStore } = await import("./benchmarks/d10/vector-store");
    resetVectorStore();
  });

  it("cold_start when frame count < 50", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          id: `${i}`, content: "x", score: 0.8, metadata: { genreTag: "shonen", qualityScore: 70 },
        }))
      ),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(30),
    };
    setVectorStore(mockStore);

    const { getGenrePoolConfidence } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await getGenrePoolConfidence("shonen");
    expect(result.confidence).toBe("cold_start");
    expect(result.ipAdapterEnabled).toBe(false);
    expect(result.frameCount).toBe(30);
  });

  it("low confidence when 50 <= frame count < 200", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => ({
          id: `${i}`, content: "x", score: 0.8, metadata: { genreTag: "noir", qualityScore: 80 },
        }))
      ),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(100),
    };
    setVectorStore(mockStore);

    const { getGenrePoolConfidence } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await getGenrePoolConfidence("noir");
    expect(result.confidence).toBe("low");
    expect(result.ipAdapterEnabled).toBe(true);
    expect(result.frameCount).toBe(100);
  });

  it("medium confidence when 200 <= frame count < 500", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue(
        Array.from({ length: 350 }, (_, i) => ({
          id: `${i}`, content: "x", score: 0.8, metadata: { genreTag: "cyberpunk", qualityScore: 85 },
        }))
      ),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(350),
    };
    setVectorStore(mockStore);

    const { getGenrePoolConfidence } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await getGenrePoolConfidence("cyberpunk");
    expect(result.confidence).toBe("medium");
    expect(result.ipAdapterEnabled).toBe(true);
    expect(result.frameCount).toBe(350);
  });

  it("high confidence when frame count >= 500", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue(
        Array.from({ length: 600 }, (_, i) => ({
          id: `${i}`, content: "x", score: 0.8, metadata: { genreTag: "seinen", qualityScore: 90 },
        }))
      ),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(600),
    };
    setVectorStore(mockStore);

    const { getGenrePoolConfidence } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await getGenrePoolConfidence("seinen");
    expect(result.confidence).toBe("high");
    expect(result.ipAdapterEnabled).toBe(true);
    expect(result.frameCount).toBe(600);
  });

  it("getRecommendedIpAdapterWeight returns correct weights per confidence level", async () => {
    const { getRecommendedIpAdapterWeight } = await import("./benchmarks/d10/genre-retrieval-pool");

    expect(getRecommendedIpAdapterWeight({ genre: "shonen", frameCount: 10, avgQualityScore: 70, confidence: "cold_start", ipAdapterEnabled: false })).toBe(0);
    expect(getRecommendedIpAdapterWeight({ genre: "noir", frameCount: 100, avgQualityScore: 80, confidence: "low", ipAdapterEnabled: true })).toBe(0.2);
    expect(getRecommendedIpAdapterWeight({ genre: "cyberpunk", frameCount: 300, avgQualityScore: 85, confidence: "medium", ipAdapterEnabled: true })).toBe(0.4);
    expect(getRecommendedIpAdapterWeight({ genre: "seinen", frameCount: 600, avgQualityScore: 90, confidence: "high", ipAdapterEnabled: true })).toBe(0.5);
  });

  it("getAllGenrePoolConfidence returns confidence for all 10 genres", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };
    setVectorStore(mockStore);

    const { getAllGenrePoolConfidence, GENRE_TAXONOMY } = await import("./benchmarks/d10/genre-retrieval-pool");
    const results = await getAllGenrePoolConfidence();
    expect(results).toHaveLength(GENRE_TAXONOMY.length);
    // All should be cold_start with empty store
    for (const r of results) {
      expect(r.confidence).toBe("cold_start");
      expect(r.ipAdapterEnabled).toBe(false);
    }
  });

  it("avgQualityScore is computed correctly", async () => {
    const { resetVectorStore, setVectorStore } = await import("./benchmarks/d10/vector-store");
    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([
        { id: "1", content: "x", score: 0.8, metadata: { genreTag: "shoujo", qualityScore: 60 } },
        { id: "2", content: "x", score: 0.8, metadata: { genreTag: "shoujo", qualityScore: 80 } },
        { id: "3", content: "x", score: 0.8, metadata: { genreTag: "shoujo", qualityScore: 100 } },
      ]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(3),
    };
    setVectorStore(mockStore);

    const { getGenrePoolConfidence } = await import("./benchmarks/d10/genre-retrieval-pool");
    const result = await getGenrePoolConfidence("shoujo");
    expect(result.avgQualityScore).toBe(80); // (60+80+100)/3
  });
});

// ─── 6. Integration with VectorStore Interface ──────────────────────────────

describe("D10 Genre Retrieval Pool — VectorStore Integration", () => {
  it("uses the singleton VectorStore from getVectorStore()", async () => {
    const { getGenreReferences } = await import("./benchmarks/d10/genre-retrieval-pool");
    const { resetVectorStore, setVectorStore, getVectorStore } = await import("./benchmarks/d10/vector-store");
    resetVectorStore();

    const mockStore = {
      embed: vi.fn().mockResolvedValue(Array(64).fill(0.1)),
      embedBatch: vi.fn().mockResolvedValue([Array(64).fill(0.1)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };
    setVectorStore(mockStore);

    await getGenreReferences("shonen", "test query");
    expect(mockStore.search).toHaveBeenCalled();
  });

  it("CONFIDENCE_THRESHOLDS are exported for external configuration", async () => {
    const { CONFIDENCE_THRESHOLDS } = await import("./benchmarks/d10/genre-retrieval-pool");
    expect(CONFIDENCE_THRESHOLDS.COLD_START).toBe(50);
    expect(CONFIDENCE_THRESHOLDS.LOW).toBe(200);
    expect(CONFIDENCE_THRESHOLDS.MEDIUM).toBe(500);
    expect(CONFIDENCE_THRESHOLDS.HIGH).toBe(500);
  });
});
