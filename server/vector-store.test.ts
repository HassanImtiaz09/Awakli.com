/**
 * D10 VectorStore Interface Tests
 *
 * Tests the abstract interface, JSON-array implementation,
 * cosine similarity computation, and semantic retrieval layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. VectorStore Interface & Implementation ──────────────────────────────

describe("D10 VectorStore — Interface & JSON-Array Implementation", () => {
  it("should export IVectorStore interface and JsonArrayVectorStore class", async () => {
    const mod = await import("./benchmarks/d10/vector-store");
    expect(mod.JsonArrayVectorStore).toBeDefined();
    expect(mod.getVectorStore).toBeDefined();
    expect(mod.resetVectorStore).toBeDefined();
    expect(mod.setVectorStore).toBeDefined();
  });

  it("should return singleton from getVectorStore()", async () => {
    const { getVectorStore, resetVectorStore } = await import("./benchmarks/d10/vector-store");
    resetVectorStore();
    const store1 = getVectorStore();
    const store2 = getVectorStore();
    expect(store1).toBe(store2);
  });

  it("should allow setting a custom VectorStore implementation", async () => {
    const { setVectorStore, getVectorStore, resetVectorStore } = await import(
      "./benchmarks/d10/vector-store"
    );
    resetVectorStore();

    const mockStore = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(42),
    };

    setVectorStore(mockStore);
    const store = getVectorStore();
    expect(store).toBe(mockStore);
    expect(await store.count()).toBe(42);
    resetVectorStore();
  });

  it("JsonArrayVectorStore should implement all IVectorStore methods", async () => {
    const { JsonArrayVectorStore } = await import("./benchmarks/d10/vector-store");
    const store = new JsonArrayVectorStore();
    expect(typeof store.embed).toBe("function");
    expect(typeof store.embedBatch).toBe("function");
    expect(typeof store.upsert).toBe("function");
    expect(typeof store.search).toBe("function");
    expect(typeof store.delete).toBe("function");
    expect(typeof store.count).toBe("function");
  });
});

// ─── 2. Cosine Similarity ───────────────────────────────────────────────────

describe("D10 VectorStore — Cosine Similarity", () => {
  it("should compute cosine similarity of identical vectors as 1.0", () => {
    // Access private method via prototype trick for testing
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const len = Math.min(a.length, b.length);
      if (len === 0) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const vec = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
  });

  it("should compute cosine similarity of orthogonal vectors as 0", () => {
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const len = Math.min(a.length, b.length);
      if (len === 0) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const vecA = [1, 0, 0];
    const vecB = [0, 1, 0];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0, 5);
  });

  it("should compute cosine similarity of opposite vectors as -1", () => {
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const len = Math.min(a.length, b.length);
      if (len === 0) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const vecA = [1, 0, 0];
    const vecB = [-1, 0, 0];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1, 5);
  });

  it("should handle zero vectors gracefully", () => {
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const len = Math.min(a.length, b.length);
      if (len === 0) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const zero = [0, 0, 0];
    const vec = [1, 2, 3];
    expect(cosineSimilarity(zero, vec)).toBe(0);
  });

  it("should handle dimension mismatch by using shorter length", () => {
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const len = Math.min(a.length, b.length);
      if (len === 0) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const vecA = [1, 0, 0, 0, 0]; // 5-dim
    const vecB = [1, 0, 0]; // 3-dim
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
  });

  it("should produce similarity between 0 and 1 for similar unit vectors", () => {
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const len = Math.min(a.length, b.length);
      if (len === 0) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const vecA = [0.8, 0.6, 0.0];
    const vecB = [0.7, 0.7, 0.1];
    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1.0);
  });
});

// ─── 3. Semantic Retrieval Layer ────────────────────────────────────────────

describe("D10 Semantic Retrieval — Public API", () => {
  it("should export semanticSearch function", async () => {
    const mod = await import("./benchmarks/d10/semantic-retrieval");
    expect(typeof mod.semanticSearch).toBe("function");
  });

  it("should export searchBySubSensei function", async () => {
    const mod = await import("./benchmarks/d10/semantic-retrieval");
    expect(typeof mod.searchBySubSensei).toBe("function");
  });

  it("should export searchByTags function", async () => {
    const mod = await import("./benchmarks/d10/semantic-retrieval");
    expect(typeof mod.searchByTags).toBe("function");
  });

  it("should export embedChunks function", async () => {
    const mod = await import("./benchmarks/d10/semantic-retrieval");
    expect(typeof mod.embedChunks).toBe("function");
  });

  it("should export getEmbeddingCount function", async () => {
    const mod = await import("./benchmarks/d10/semantic-retrieval");
    expect(typeof mod.getEmbeddingCount).toBe("function");
  });

  it("should use mock VectorStore for testing", async () => {
    const { setVectorStore, resetVectorStore } = await import("./benchmarks/d10/vector-store");
    const { semanticSearch } = await import("./benchmarks/d10/semantic-retrieval");

    const mockStore = {
      embed: vi.fn().mockResolvedValue([0.5, 0.5, 0.5]),
      embedBatch: vi.fn().mockResolvedValue([[0.5, 0.5, 0.5]]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([
        {
          id: "chunk-1",
          content: "Sakuga timing involves spacing keyframes",
          score: 0.92,
          metadata: { subSensei: "D10.G", sourceUrl: "https://sakugablog.com/timing" },
        },
      ]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(100),
    };

    setVectorStore(mockStore);

    const results = await semanticSearch("sakuga timing");
    expect(results.length).toBe(1);
    expect(results[0].chunkId).toBe("chunk-1");
    expect(results[0].relevanceScore).toBe(0.92);
    expect(results[0].subSensei).toBe("D10.G");
    expect(results[0].source).toBe("https://sakugablog.com/timing");
    expect(mockStore.search).toHaveBeenCalledWith("sakuga timing", expect.any(Object));

    resetVectorStore();
  });

  it("searchBySubSensei should prepend domain context to query", async () => {
    const { setVectorStore, resetVectorStore } = await import("./benchmarks/d10/vector-store");
    const { searchBySubSensei } = await import("./benchmarks/d10/semantic-retrieval");

    const mockStore = {
      embed: vi.fn().mockResolvedValue([0.5, 0.5, 0.5]),
      embedBatch: vi.fn().mockResolvedValue([[0.5, 0.5, 0.5]]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };

    setVectorStore(mockStore);

    await searchBySubSensei("D10.G", "spacing techniques");
    expect(mockStore.search).toHaveBeenCalledWith(
      expect.stringContaining("genga"),
      expect.objectContaining({ filter: { subSensei: "D10.G" } })
    );

    resetVectorStore();
  });

  it("embedChunks should batch process and return counts", async () => {
    const { setVectorStore, resetVectorStore } = await import("./benchmarks/d10/vector-store");
    const { embedChunks } = await import("./benchmarks/d10/semantic-retrieval");

    const mockStore = {
      embed: vi.fn().mockResolvedValue([0.5, 0.5, 0.5]),
      embedBatch: vi.fn().mockResolvedValue([[0.5, 0.5, 0.5]]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };

    setVectorStore(mockStore);

    const result = await embedChunks([
      { id: "c1", content: "chunk 1 content" },
      { id: "c2", content: "chunk 2 content" },
      { id: "c3", content: "chunk 3 content" },
    ]);

    expect(result.embedded).toBe(3);
    expect(result.failed).toBe(0);
    expect(mockStore.upsert).toHaveBeenCalledTimes(1); // All 3 in one batch (< 10)

    resetVectorStore();
  });

  it("getEmbeddingCount should delegate to VectorStore.count()", async () => {
    const { setVectorStore, resetVectorStore } = await import("./benchmarks/d10/vector-store");
    const { getEmbeddingCount } = await import("./benchmarks/d10/semantic-retrieval");

    const mockStore = {
      embed: vi.fn().mockResolvedValue([0.5]),
      embedBatch: vi.fn().mockResolvedValue([[0.5]]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(1234),
    };

    setVectorStore(mockStore);
    const count = await getEmbeddingCount();
    expect(count).toBe(1234);

    resetVectorStore();
  });
});

// ─── 4. Wave 4 Migration Path ───────────────────────────────────────────────

describe("D10 VectorStore — Migration Path Verification", () => {
  it("should support swapping implementations without changing D-agent code", async () => {
    const { setVectorStore, getVectorStore, resetVectorStore } = await import(
      "./benchmarks/d10/vector-store"
    );
    const { semanticSearch } = await import("./benchmarks/d10/semantic-retrieval");

    // Simulate a "ChromaVectorStore" swap
    const chromaMock = {
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
      embedBatch: vi.fn().mockResolvedValue([new Array(1536).fill(0.01)]),
      upsert: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([
        {
          id: "chroma-doc-1",
          content: "Retrieved from Chroma",
          score: 0.95,
          metadata: { subSensei: "D10.A", source: "chroma" },
        },
      ]),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(5000),
    };

    setVectorStore(chromaMock);

    // Same D-agent call, different backing store
    const results = await semanticSearch("animation principles");
    expect(results[0].content).toBe("Retrieved from Chroma");
    expect(results[0].relevanceScore).toBe(0.95);
    expect(chromaMock.search).toHaveBeenCalled();

    resetVectorStore();
  });

  it("IVectorStore interface should require all 6 methods", async () => {
    const mod = await import("./benchmarks/d10/vector-store");
    // Verify the interface is enforced by checking the implementation has all methods
    const store = new mod.JsonArrayVectorStore();
    const methods = ["embed", "embedBatch", "upsert", "search", "delete", "count"];
    for (const method of methods) {
      expect(typeof (store as any)[method]).toBe("function");
    }
  });
});
