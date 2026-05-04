/**
 * D0 Character Designer — End-to-End Integration Test
 *
 * Tests the full two-pass generation flow through the tRPC router,
 * exercising the character-designer module's orchestration logic:
 * 1. Pass 1: Generate canonical front view from character bible + style bundle
 * 2. Pass 2: i2i conditioned on front view → three-quarter, side, back
 * 3. CLIP validation with retry on score < 0.85
 * 4. Reference sheet gate approval/rejection
 *
 * Strategy: Mock external dependencies (DB, imageGeneration, LLM, storage, fetch)
 * while letting the character-designer orchestration logic run for real.
 * This validates the two-pass flow, CLIP retry, cost tracking, and gate management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock Setup ─────────────────────────────────────────────────────────────

// Track calls for assertions
const generateImageCalls: Array<{ prompt: string; originalImages?: any[] }> = [];
const invokeLLMCalls: Array<{ messages: any[] }> = [];
let clipScoreSequence: number[] = [];
let clipCallIndex = 0;
let imageGenCallIndex = 0;
let shouldImageGenFail = false;

// In-memory state for mock DB
let mockCharacter: any = null;
const mockViews: Map<string, any> = new Map(); // key: `${characterId}_${viewAngle}`
const mockGates: Map<number, any> = new Map(); // key: characterId
let nextViewId = 1;
let nextGateId = 1;

// Helper to get table name from Drizzle table object
function getTableName(table: any): string {
  return table?.[Symbol.for("drizzle:Name")] || "";
}

// Mock global fetch (used to download generated images before S3 upload)
const mockFetch = vi.fn().mockImplementation(async () => ({
  arrayBuffer: async () => new ArrayBuffer(100),
}));
vi.stubGlobal("fetch", mockFetch);

// Mock storage
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockImplementation(async (key: string) => ({
    url: `https://s3.mock.com/${key}`,
    key,
  })),
}));

// Mock image generation
vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn().mockImplementation(async (opts: any) => {
    generateImageCalls.push(opts);
    imageGenCallIndex++;
    if (shouldImageGenFail) {
      throw new Error("Image generation service unavailable");
    }
    return { url: `https://forge.mock.com/generated-${imageGenCallIndex}.png` };
  }),
}));

// Mock LLM (handles CLIP scoring)
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockImplementation(async (opts: any) => {
    invokeLLMCalls.push(opts);
    // Detect CLIP score calls by checking the system message content
    const systemMsg = opts.messages?.[0]?.content || "";
    if (typeof systemMsg === "string" && systemMsg.includes("consistency evaluator")) {
      // Return score from sequence
      const score = clipScoreSequence[clipCallIndex] ?? 0.90;
      clipCallIndex++;
      return {
        choices: [{
          message: {
            content: JSON.stringify({ score, issues: [] }),
          },
        }],
      };
    }
    // Default for other LLM calls
    return {
      choices: [{ message: { content: "mock response" } }],
    };
  }),
}));

// Mock observability logger
vi.mock("./observability/logger", () => ({
  serverLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock style-bundles (called by buildViewPrompt)
vi.mock("./benchmarks/d0/style-bundles", () => ({
  getPromptConfig: vi.fn().mockImplementation(async (key: string) => {
    if (key === "shonen") {
      return {
        promptTemplate: "dynamic shonen anime style, bold lines, high energy",
        negativePrompt: "static, dull, low contrast",
      };
    }
    return null;
  }),
  getColorPalette: vi.fn().mockResolvedValue(null),
}));

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ _type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ _type: "and", args })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

// Mock DB with proper Drizzle chain support
vi.mock("./db", () => ({
  getDb: vi.fn().mockImplementation(async () => mockDb),
}));

// Build a mock DB that properly handles Drizzle query chains
const mockDb: any = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockImplementation((table: any) => {
    const tableName = getTableName(table);
    return {
      where: (condition: any) => {
        // Return a thenable + chainable object
        const result = getSelectResult(tableName, condition);
        return {
          limit: (n: number) => Promise.resolve(result.slice(0, n)),
          orderBy: () => ({
            limit: (n: number) => Promise.resolve(result.slice(0, n)),
          }),
          then: (resolve: (v: any) => void) => Promise.resolve(result).then(resolve),
        };
      },
      orderBy: () => ({
        then: (resolve: (v: any) => void) => {
          const result = getAllForTable(tableName);
          return Promise.resolve(result).then(resolve);
        },
        limit: (n: number) => Promise.resolve(getAllForTable(tableName).slice(0, n)),
      }),
    };
  }),
  insert: vi.fn().mockImplementation((table: any) => {
    const tableName = getTableName(table);
    return {
      values: (vals: any) => {
        const insertResult = handleInsert(tableName, vals);
        return Promise.resolve([{ insertId: insertResult.id }]);
      },
    };
  }),
  update: vi.fn().mockImplementation((table: any) => {
    const tableName = getTableName(table);
    return {
      set: (vals: any) => ({
        where: (condition: any) => {
          handleUpdate(tableName, vals, condition);
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    };
  }),
};

function getSelectResult(tableName: string, condition: any): any[] {
  if (tableName === "characters") {
    return mockCharacter ? [mockCharacter] : [];
  }
  if (tableName === "character_views") {
    // Check if looking by characterId + viewAngle (upsert check)
    const args = condition?.args || [];
    if (condition?._type === "and") {
      // Looking for specific view by characterId + viewAngle
      const subConditions = args;
      let charId: number | null = null;
      let angle: string | null = null;
      for (const sub of subConditions) {
        if (sub?.args?.[1] && typeof sub.args[1] === "number") charId = sub.args[1];
        if (sub?.args?.[1] && typeof sub.args[1] === "string") angle = sub.args[1];
      }
      if (charId && angle) {
        const key = `${charId}_${angle}`;
        const view = mockViews.get(key);
        return view ? [view] : [];
      }
    }
    if (condition?._type === "eq") {
      // Looking by characterId or by id
      const val = condition.args?.[1];
      if (typeof val === "number") {
        // Could be characterId or view id
        const results: any[] = [];
        for (const [, v] of mockViews) {
          if (v.characterId === val || v.id === val) results.push(v);
        }
        return results;
      }
    }
    return [];
  }
  if (tableName === "reference_sheet_gates") {
    const val = condition?.args?.[1];
    if (typeof val === "number") {
      // Could be characterId or gate id
      const gate = mockGates.get(val);
      return gate ? [gate] : [];
    }
    return [];
  }
  if (tableName === "style_bundles") {
    return [];
  }
  return [];
}

function getAllForTable(tableName: string): any[] {
  if (tableName === "character_views") {
    return Array.from(mockViews.values());
  }
  return [];
}

function handleInsert(tableName: string, vals: any): any {
  if (tableName === "character_views") {
    const id = nextViewId++;
    const view = { id, ...vals };
    const key = `${vals.characterId}_${vals.viewAngle}`;
    mockViews.set(key, view);
    return view;
  }
  if (tableName === "reference_sheet_gates") {
    const id = nextGateId++;
    const gate = { id, ...vals, totalAttempts: 0 };
    mockGates.set(vals.characterId, gate);
    return gate;
  }
  return { id: 1 };
}

function handleUpdate(tableName: string, vals: any, condition: any): void {
  if (tableName === "character_views") {
    // Update view by id or by characterId
    const targetId = condition?.args?.[1];
    if (typeof targetId === "number") {
      // Update by view id
      for (const [key, view] of mockViews) {
        if (view.id === targetId) {
          Object.assign(view, vals);
          break;
        }
      }
      // Also update by characterId (for bulk updates like approve/reject)
      for (const [key, view] of mockViews) {
        if (view.characterId === targetId) {
          Object.assign(view, vals);
        }
      }
    }
  }
  if (tableName === "reference_sheet_gates") {
    const targetId = condition?.args?.[1];
    if (typeof targetId === "number") {
      // Update by gate id
      for (const [, gate] of mockGates) {
        if (gate.id === targetId) {
          Object.assign(gate, vals);
          break;
        }
      }
    }
  }
}

// ─── Import Module Under Test (after mocks) ─────────────────────────────────

import {
  generateCharacterViews,
  getCharacterViews,
  getGateByCharacter,
  getReferenceSheetStatus,
  approveReferenceSheet,
  rejectReferenceSheet,
} from "./benchmarks/d0/character-designer";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function resetMocks() {
  generateImageCalls.length = 0;
  invokeLLMCalls.length = 0;
  clipScoreSequence = [];
  clipCallIndex = 0;
  imageGenCallIndex = 0;
  shouldImageGenFail = false;
  mockViews.clear();
  mockGates.clear();
  nextViewId = 1;
  nextGateId = 1;
  mockCharacter = {
    id: 1,
    projectId: 1,
    userId: 1,
    name: "Sakura",
    role: "protagonist",
    personalityTraits: ["cheerful", "determined"],
    visualTraits: {
      hairColor: "pink",
      eyeColor: "blue",
      bodyType: "athletic",
      clothing: "school uniform",
      distinguishingFeatures: "cherry blossom hair clip",
    },
    referenceImages: [],
    bio: "A high school student who discovers magical powers",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── E2E Integration Tests ──────────────────────────────────────────────────

describe("D0 Character Designer — E2E Two-Pass + CLIP Retry Flow", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should complete full two-pass flow with all CLIP scores above threshold", async () => {
    // All CLIP scores pass on first attempt
    clipScoreSequence = [0.92, 0.88, 0.91]; // three_quarter, side, back

    const result = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    // Verify success
    expect(result.success).toBe(true);
    expect(result.views).toHaveLength(4); // front + 3 remaining

    // Verify Pass 1: front view generated first (no conditioning)
    expect(result.views[0].viewAngle).toBe("front");
    expect(result.views[0].clipScore).toBe(1.0); // Front is reference
    expect(result.views[0].status).toBe("generated");
    expect(result.views[0].imageUrl).toBeTruthy();

    // Verify Pass 2: remaining views conditioned on front
    expect(result.views[1].viewAngle).toBe("three_quarter");
    expect(result.views[1].clipScore).toBe(0.92);
    expect(result.views[1].status).toBe("generated");

    expect(result.views[2].viewAngle).toBe("side");
    expect(result.views[2].clipScore).toBe(0.88);
    expect(result.views[2].status).toBe("generated");

    expect(result.views[3].viewAngle).toBe("back");
    expect(result.views[3].clipScore).toBe(0.91);
    expect(result.views[3].status).toBe("generated");

    // Verify image generation was called 4 times (1 front + 3 conditioned)
    expect(generateImageCalls.length).toBe(4);

    // Verify Pass 2 calls include conditioning image (originalImages)
    expect(generateImageCalls[1].originalImages).toBeDefined();
    expect(generateImageCalls[2].originalImages).toBeDefined();
    expect(generateImageCalls[3].originalImages).toBeDefined();

    // Verify cost tracking: 4 views × $0.10 = $0.40
    expect(result.totalCost).toBeCloseTo(0.40, 2);
  });

  it("should retry when CLIP score is below 0.85 threshold", async () => {
    // three_quarter: fails first (0.72), passes second (0.89)
    // side: passes first (0.87)
    // back: fails first (0.60), fails second (0.70), passes third (0.86)
    clipScoreSequence = [
      0.72, // three_quarter attempt 1 — FAIL
      0.89, // three_quarter attempt 2 — PASS
      0.87, // side attempt 1 — PASS
      0.60, // back attempt 1 — FAIL
      0.70, // back attempt 2 — FAIL
      0.86, // back attempt 3 — PASS
    ];

    const result = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    expect(result.success).toBe(true);

    // Front view: 1 attempt
    expect(result.views[0].viewAngle).toBe("front");
    expect(result.views[0].attemptNumber).toBe(1);

    // Three-quarter: 2 attempts (retry once)
    expect(result.views[1].viewAngle).toBe("three_quarter");
    expect(result.views[1].clipScore).toBe(0.89);
    expect(result.views[1].attemptNumber).toBe(2);

    // Side: 1 attempt (passed first time)
    expect(result.views[2].viewAngle).toBe("side");
    expect(result.views[2].clipScore).toBe(0.87);
    expect(result.views[2].attemptNumber).toBe(1);

    // Back: 3 attempts (max retries)
    expect(result.views[3].viewAngle).toBe("back");
    expect(result.views[3].clipScore).toBe(0.86);
    expect(result.views[3].attemptNumber).toBe(3);

    // Total image generations: 1 (front) + 2 (three_quarter) + 1 (side) + 3 (back) = 7
    expect(generateImageCalls.length).toBe(7);

    // Cost tracks only the final successful attempt per view (4 views × $0.10)
    // Retry cost is not accumulated in the returned totalCost
    expect(result.totalCost).toBeCloseTo(0.40, 2);
  });

  it("should cap retries at MAX_ATTEMPTS (3) and return last result", async () => {
    // All CLIP scores below threshold — never passes
    clipScoreSequence = [
      0.50, 0.55, 0.60, // three_quarter: 3 attempts, all fail
      0.45, 0.50, 0.55, // side: 3 attempts, all fail
      0.40, 0.45, 0.50, // back: 3 attempts, all fail
    ];

    const result = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    // Still succeeds (views generated, just with low scores)
    expect(result.success).toBe(true);

    // Each non-front view should have attemptNumber = 3 (maxed out)
    expect(result.views[1].attemptNumber).toBe(3);
    expect(result.views[2].attemptNumber).toBe(3);
    expect(result.views[3].attemptNumber).toBe(3);

    // Returns the last attempt's score
    expect(result.views[1].clipScore).toBe(0.60);
    expect(result.views[2].clipScore).toBe(0.55);
    expect(result.views[3].clipScore).toBe(0.50);

    // Total: 1 (front) + 3×3 (retries) = 10 generations
    expect(generateImageCalls.length).toBe(10);
    // Cost tracks only the final attempt per view (4 views × $0.10)
    expect(result.totalCost).toBeCloseTo(0.40, 2);
  });

  it("should fail gracefully if front view generation fails (all attempts)", async () => {
    // Make image generation always fail
    shouldImageGenFail = true;

    const result = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    // Front view failure after MAX_ATTEMPTS should prevent Pass 2
    expect(result.success).toBe(false);
    expect(result.views[0].viewAngle).toBe("front");
    expect(result.views[0].status).toBe("failed");

    // Only front view attempts (up to MAX_ATTEMPTS=3), no Pass 2
    expect(result.views.length).toBe(1);
    expect(generateImageCalls.length).toBe(3); // 3 attempts for front
  });

  it("should track cost accurately across retries", async () => {
    // One retry on three_quarter, rest pass
    clipScoreSequence = [
      0.70, // three_quarter attempt 1 — FAIL
      0.90, // three_quarter attempt 2 — PASS
      0.88, // side — PASS
      0.92, // back — PASS
    ];

    const result = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    // 1 (front) + 2 (three_quarter with retry) + 1 (side) + 1 (back) = 5 generations
    expect(generateImageCalls.length).toBe(5);
    // Cost tracks only the final attempt per view (4 views × $0.10)
    expect(result.totalCost).toBeCloseTo(0.40, 2);
  });

  it("should create reference sheet gate with correct status after generation", async () => {
    clipScoreSequence = [0.90, 0.88, 0.91];

    const result = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    expect(result.gateId).toBeGreaterThan(0);
    expect(result.success).toBe(true);

    // Gate should be in "all_views_generated" status (awaiting user approval)
    const gate = mockGates.get(1); // characterId = 1
    expect(gate).toBeDefined();
    expect(gate.status).toBe("all_views_generated");
  });

  it("should approve reference sheet and unblock downstream", async () => {
    clipScoreSequence = [0.90, 0.88, 0.91];

    // Generate views first
    await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    // Approve the sheet
    const success = await approveReferenceSheet(1);
    expect(success).toBe(true);

    // Gate should be approved
    const gate = mockGates.get(1);
    expect(gate.status).toBe("approved");
    expect(gate.approvedAt).toBeInstanceOf(Date);
  });

  it("should reject reference sheet and allow regeneration", async () => {
    clipScoreSequence = [0.90, 0.88, 0.91];

    // Generate views first
    await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    // Reject the sheet
    const success = await rejectReferenceSheet(1, "Character proportions don't match");
    expect(success).toBe(true);

    // Gate should be rejected with reason
    const gate = mockGates.get(1);
    expect(gate.status).toBe("rejected");
    expect(gate.rejectedReason).toBe("Character proportions don't match");
  });

  it("should use style bundle conditioning when provided", async () => {
    clipScoreSequence = [0.92, 0.88, 0.91];

    const result = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
      styleBundleKey: "shonen",
    });

    expect(result.success).toBe(true);

    // Verify that generateImage was called with prompts containing style info
    expect(generateImageCalls.length).toBe(4);
    // The shonen style template should be in the prompts
    expect(generateImageCalls[0].prompt).toContain("shonen");
  });

  it("should handle sequential generations for same character (gate reuse)", async () => {
    clipScoreSequence = [0.90, 0.88, 0.91];

    // First generation
    const result1 = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    expect(result1.success).toBe(true);
    const gateId1 = result1.gateId;

    // Reset image gen tracking for second run
    generateImageCalls.length = 0;
    clipCallIndex = 0;
    clipScoreSequence = [0.93, 0.90, 0.95];

    // Second generation (should reuse gate)
    const result2 = await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
    });

    expect(result2.success).toBe(true);
    // Same gate should be reused
    expect(result2.gateId).toBe(gateId1);
  });

  it("should throw if character not found", async () => {
    mockCharacter = null; // No character in DB

    await expect(
      generateCharacterViews({
        characterId: 999,
        projectId: 1,
        userId: 1,
      })
    ).rejects.toThrow(/not found/i);
  });

  it("should throw if database is not available", async () => {
    // Override getDb to return null
    const { getDb } = await import("./db");
    (getDb as any).mockResolvedValueOnce(null);

    await expect(
      generateCharacterViews({
        characterId: 1,
        projectId: 1,
        userId: 1,
      })
    ).rejects.toThrow(/not available/i);
  });

  it("should store views in DB with correct metadata", async () => {
    clipScoreSequence = [0.92, 0.88, 0.91];

    await generateCharacterViews({
      characterId: 1,
      projectId: 1,
      userId: 1,
      styleBundleKey: "shonen",
    });

    // Check that views were stored
    expect(mockViews.size).toBeGreaterThanOrEqual(4);

    // Check front view metadata
    const frontView = mockViews.get("1_front");
    expect(frontView).toBeDefined();
    expect(frontView.characterId).toBe(1);
    expect(frontView.viewAngle).toBe("front");
    expect(frontView.generationPass).toBe(1);
    expect(frontView.status).toBe("generated");
    expect(frontView.styleBundleKey).toBe("shonen");
  });
});
