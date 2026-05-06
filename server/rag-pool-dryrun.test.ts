/**
 * Wave 6A Verification Gap 1: RAG Pool Dry-Run Validation
 *
 * Confirms:
 * 1. The RAG retrieval pool is currently EMPTY (cold-start dormant)
 * 2. seedGenrePool executes end-to-end without errors against test data (mocked vector store)
 * 3. After seeding, getGenrePoolConfidence correctly reports frame counts
 * 4. getGenreReferences returns results from seeded data
 * 5. Cold-start fallback correctly returns 0 IP-Adapter weight when pool is empty
 *
 * NOTE: Tests that call seedGenrePool use a mock vector store to avoid LLM API calls
 * for embedding generation (which timeout at 5s per call × N entries).
 * The "pool is EMPTY" tests hit the real DB to confirm production state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GENRE_TAXONOMY,
  GENRE_DESCRIPTIONS,
  type GenrePoolEntry,
  type GenreTag,
  type GenrePoolConfidence,
  seedGenrePool,
  getGenrePoolConfidence,
  getGenreReferences,
  getAllGenrePoolConfidence,
  getRecommendedIpAdapterWeight,
} from "./benchmarks/d10/genre-retrieval-pool";
import {
  resetVectorStore,
  setVectorStore,
  type IVectorStore,
  type UpsertInput,
  type SearchResult,
  type SearchOptions,
} from "./benchmarks/d10/vector-store";

// ─── In-Memory Mock Vector Store ──────────────────────────────────────────────

class MockVectorStore implements IVectorStore {
  private documents: Map<string, { content: string; embedding: number[]; metadata: Record<string, unknown> }> = new Map();

  async embed(text: string): Promise<number[]> {
    // Deterministic pseudo-embedding based on text hash
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashToVector(t));
  }

  async upsert(documents: UpsertInput[]): Promise<void> {
    for (const doc of documents) {
      const embedding = this.hashToVector(doc.content);
      this.documents.set(doc.id, {
        content: doc.content,
        embedding,
        metadata: doc.metadata || {},
      });
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.topK ?? 5;
    const threshold = options?.threshold ?? 0.7;
    const queryEmb = this.hashToVector(query);

    const results: SearchResult[] = [];
    for (const [id, doc] of this.documents.entries()) {
      // Apply metadata filter
      if (options?.filter) {
        const matches = Object.entries(options.filter).every(
          ([key, value]) => doc.metadata[key] === value
        );
        if (!matches) continue;
      }

      const score = this.cosineSimilarity(queryEmb, doc.embedding);
      // threshold <= 0 means "no threshold" — return all matching filter entries
      if (threshold <= 0 || score >= threshold) {
        results.push({ id, content: doc.content, score, metadata: doc.metadata });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.documents.delete(id);
    }
  }

  async count(): Promise<number> {
    return this.documents.size;
  }

  clear(): void {
    this.documents.clear();
  }

  private hashToVector(text: string): number[] {
    // Simple deterministic hash → 64-dim vector
    const vec: number[] = [];
    for (let i = 0; i < 64; i++) {
      let hash = 0;
      const seed = text + String(i);
      for (let j = 0; j < seed.length; j++) {
        hash = ((hash << 5) - hash + seed.charCodeAt(j)) | 0;
      }
      vec.push(((hash % 1000) / 1000)); // normalize to [-1, 1]
    }
    // Normalize to unit vector
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function generateTestEntries(genre: GenreTag, count: number): GenrePoolEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `test-${genre}-${i}`,
    genreTag: genre,
    imageUrl: `https://test-storage.example.com/${genre}/panel-${i}.png`,
    sourceProjectId: 1000 + i,
    sourcePanelId: 2000 + i,
    qualityScore: 60 + (i % 30),
    embeddingContent: `${GENRE_DESCRIPTIONS[genre]} scene panel ${i}`,
    metadata: {
      episodeId: 100 + i,
      sceneDescription: `Test scene ${i} for ${genre} genre validation`,
      cameraAngle: i % 2 === 0 ? "medium_shot" : "close_up",
      artStyle: genre,
    },
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RAG Pool Dry-Run — Pool Status (Real DB)", () => {
  beforeEach(() => {
    resetVectorStore();
  });

  it("pool is EMPTY at cold start — confirms RAG-augmented path is dormant", async () => {
    // This hits the real DB — confirms no pre-seeded content exists
    const confidence = await getGenrePoolConfidence("shonen");
    expect(confidence.frameCount).toBe(0);
    expect(confidence.confidence).toBe("cold_start");
    expect(confidence.ipAdapterEnabled).toBe(false);
  }, 10000);

  it("IP-Adapter weight is 0 when pool is in cold_start", async () => {
    const confidence = await getGenrePoolConfidence("cyberpunk");
    const weight = getRecommendedIpAdapterWeight(confidence);
    expect(weight).toBe(0);
  }, 10000);

  it("getGenreReferences returns empty array when pool is empty", async () => {
    const refs = await getGenreReferences("shonen", "A hero charges forward", 3);
    expect(refs).toHaveLength(0);
  }, 10000);
});

describe("RAG Pool Dry-Run — seedGenrePool E2E (Mock Vector Store)", () => {
  let mockStore: MockVectorStore;

  beforeEach(() => {
    mockStore = new MockVectorStore();
    setVectorStore(mockStore);
  });

  it("seedGenrePool executes without errors on test data", async () => {
    const entries = generateTestEntries("shonen", 5);
    const result = await seedGenrePool(entries);
    expect(result.seeded).toBe(5);
    expect(result.failed).toBe(0);
  });

  it("seedGenrePool handles multiple genres in one batch", async () => {
    const entries = [
      ...generateTestEntries("shonen", 3),
      ...generateTestEntries("cyberpunk", 3),
      ...generateTestEntries("noir", 2),
    ];
    const result = await seedGenrePool(entries);
    expect(result.seeded).toBe(8);
    expect(result.failed).toBe(0);
  });

  it("after seeding, getGenrePoolConfidence reports correct frame count", async () => {
    const entries = generateTestEntries("mecha", 10);
    await seedGenrePool(entries);

    const confidence = await getGenrePoolConfidence("mecha");
    expect(confidence.frameCount).toBe(10);
    expect(confidence.genre).toBe("mecha");
  });

  it("after seeding, getGenreReferences returns results for matching genre", async () => {
    const entries = generateTestEntries("cyberpunk", 5);
    await seedGenrePool(entries);

    // Use the same genre description as embedding content for high similarity
    const refs = await getGenreReferences("cyberpunk", GENRE_DESCRIPTIONS.cyberpunk, 3);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.length).toBeLessThanOrEqual(3);
    // Each result should have imageUrl and qualityScore
    for (const ref of refs) {
      expect(ref.imageUrl).toContain("cyberpunk");
      expect(ref.qualityScore).toBeGreaterThanOrEqual(60);
    }
  });

  it("seedGenrePool handles empty input gracefully", async () => {
    const result = await seedGenrePool([]);
    expect(result.seeded).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("seedGenrePool handles large batch (>10 entries, triggers batching)", async () => {
    const entries = generateTestEntries("seinen", 25);
    const result = await seedGenrePool(entries);
    expect(result.seeded).toBe(25);
    expect(result.failed).toBe(0);
  });

  it("cold-start fallback: pool below threshold still reports cold_start", async () => {
    // Seed only 10 entries — below COLD_START threshold of 50
    const entries = generateTestEntries("shoujo", 10);
    await seedGenrePool(entries);

    const confidence = await getGenrePoolConfidence("shoujo");
    expect(confidence.frameCount).toBe(10);
    expect(confidence.confidence).toBe("cold_start");
    expect(confidence.ipAdapterEnabled).toBe(false);

    const weight = getRecommendedIpAdapterWeight(confidence);
    expect(weight).toBe(0);
  });

  it("pool transitions to low confidence at 50+ entries", async () => {
    const entries = generateTestEntries("shonen", 55);
    await seedGenrePool(entries);

    const confidence = await getGenrePoolConfidence("shonen");
    expect(confidence.frameCount).toBe(55);
    expect(confidence.confidence).toBe("low");
    expect(confidence.ipAdapterEnabled).toBe(true);

    const weight = getRecommendedIpAdapterWeight(confidence);
    expect(weight).toBe(0.2);
  });

  it("pool transitions to medium confidence at 200+ entries", async () => {
    const entries = generateTestEntries("cyberpunk", 210);
    await seedGenrePool(entries);

    const confidence = await getGenrePoolConfidence("cyberpunk");
    expect(confidence.frameCount).toBe(210);
    expect(confidence.confidence).toBe("medium");
    expect(confidence.ipAdapterEnabled).toBe(true);

    const weight = getRecommendedIpAdapterWeight(confidence);
    expect(weight).toBe(0.4);
  });

  it("getAllGenrePoolConfidence returns all 10 genres", async () => {
    const allConfidence = await getAllGenrePoolConfidence();
    expect(allConfidence).toHaveLength(10);
    const genres = allConfidence.map((c) => c.genre);
    for (const g of GENRE_TAXONOMY) {
      expect(genres).toContain(g);
    }
  });

  it("genre-filtered retrieval does not return cross-genre results", async () => {
    await seedGenrePool(generateTestEntries("shonen", 10));
    await seedGenrePool(generateTestEntries("noir", 10));

    const refs = await getGenreReferences("shonen", GENRE_DESCRIPTIONS.shonen, 5);
    for (const ref of refs) {
      expect(ref.metadata.genreTag).toBe("shonen");
    }
  });
});

describe("RAG Pool Dry-Run — Genre Taxonomy Completeness", () => {
  it("GENRE_TAXONOMY has 10 genres", () => {
    expect(GENRE_TAXONOMY).toHaveLength(10);
  });

  it("all genres are valid strings", () => {
    for (const genre of GENRE_TAXONOMY) {
      expect(typeof genre).toBe("string");
      expect(genre.length).toBeGreaterThan(0);
    }
  });

  it("includes expected core genres", () => {
    expect(GENRE_TAXONOMY).toContain("shonen");
    expect(GENRE_TAXONOMY).toContain("seinen");
    expect(GENRE_TAXONOMY).toContain("shoujo");
    expect(GENRE_TAXONOMY).toContain("cyberpunk");
    expect(GENRE_TAXONOMY).toContain("mecha");
    expect(GENRE_TAXONOMY).toContain("default");
  });

  it("each genre has a description", () => {
    for (const genre of GENRE_TAXONOMY) {
      expect(GENRE_DESCRIPTIONS[genre]).toBeDefined();
      expect(GENRE_DESCRIPTIONS[genre].length).toBeGreaterThan(10);
    }
  });

  it("getRecommendedIpAdapterWeight returns correct values for all confidence levels", () => {
    const cases: [GenrePoolConfidence["confidence"], number][] = [
      ["cold_start", 0],
      ["low", 0.2],
      ["medium", 0.4],
      ["high", 0.5],
    ];
    for (const [confidence, expected] of cases) {
      const result = getRecommendedIpAdapterWeight({
        genre: "shonen",
        frameCount: 0,
        avgQualityScore: 70,
        confidence,
        ipAdapterEnabled: confidence !== "cold_start",
      });
      expect(result).toBe(expected);
    }
  });
});
