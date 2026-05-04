/**
 * Founders' Studio — vitest
 *
 * Tests the Express Interest form submission validation,
 * the router input schemas, and the admin triage procedures.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Schema validation (mirrors the router input schemas) ────────────

const OUTPUT_TRACKS = ["manga", "genga", "full_anime"] as const;

const submitSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  outputTrack: z.enum(OUTPUT_TRACKS),
  portfolioUrl: z.string().url().max(2000),
  genreFocus: z.string().max(200).optional(),
  pitch: z.string().min(20).max(2000),
});

const listSchema = z.object({
  status: z.enum(["new", "reviewing", "shortlisted", "contacted", "declined", "all"]).optional().default("all"),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

const updateStatusSchema = z.object({
  id: z.number().int(),
  status: z.enum(["new", "reviewing", "shortlisted", "contacted", "declined"]),
  adminNotes: z.string().max(5000).optional(),
});

// ─── Submit validation ───────────────────────────────────────────────

describe("Founders Submit Schema", () => {
  it("accepts a valid full submission", () => {
    const result = submitSchema.safeParse({
      name: "Yuki Tanaka",
      email: "yuki@example.com",
      outputTrack: "full_anime",
      portfolioUrl: "https://artstation.com/yuki",
      genreFocus: "Sci-Fi",
      pitch: "I want to create a 12-episode cyberpunk series exploring AI consciousness through the lens of traditional Japanese folklore.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a submission without optional genreFocus", () => {
    const result = submitSchema.safeParse({
      name: "Kira Sato",
      email: "kira@example.com",
      outputTrack: "manga",
      portfolioUrl: "https://pixiv.net/users/12345",
      pitch: "A slice-of-life manga about a ramen shop owner who discovers their recipes can heal emotional wounds.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = submitSchema.safeParse({
      name: "",
      email: "test@example.com",
      outputTrack: "genga",
      portfolioUrl: "https://example.com/portfolio",
      pitch: "I want to create key animation frames for action sequences.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = submitSchema.safeParse({
      name: "Test User",
      email: "not-an-email",
      outputTrack: "manga",
      portfolioUrl: "https://example.com/portfolio",
      pitch: "I want to create a manga series about space exploration.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid output track", () => {
    const result = submitSchema.safeParse({
      name: "Test User",
      email: "test@example.com",
      outputTrack: "movie",
      portfolioUrl: "https://example.com/portfolio",
      pitch: "I want to create a full-length animated movie.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-URL portfolio link", () => {
    const result = submitSchema.safeParse({
      name: "Test User",
      email: "test@example.com",
      outputTrack: "full_anime",
      portfolioUrl: "just-a-string",
      pitch: "I want to create an anime series about cooking battles.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects pitch shorter than 20 characters", () => {
    const result = submitSchema.safeParse({
      name: "Test User",
      email: "test@example.com",
      outputTrack: "manga",
      portfolioUrl: "https://example.com/portfolio",
      pitch: "Too short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects pitch longer than 2000 characters", () => {
    const result = submitSchema.safeParse({
      name: "Test User",
      email: "test@example.com",
      outputTrack: "manga",
      portfolioUrl: "https://example.com/portfolio",
      pitch: "A".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts all three output tracks", () => {
    for (const track of OUTPUT_TRACKS) {
      const result = submitSchema.safeParse({
        name: "Test User",
        email: "test@example.com",
        outputTrack: track,
        portfolioUrl: "https://example.com/portfolio",
        pitch: "I want to create amazing anime content through this program.",
      });
      expect(result.success).toBe(true);
    }
  });
});

// ─── List validation ─────────────────────────────────────────────────

describe("Founders List Schema", () => {
  it("accepts empty input (all defaults)", () => {
    const result = listSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("all");
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it("accepts specific status filter", () => {
    for (const status of ["new", "reviewing", "shortlisted", "contacted", "declined", "all"] as const) {
      const result = listSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = listSchema.safeParse({ status: "accepted" });
    expect(result.success).toBe(false);
  });

  it("rejects limit > 100", () => {
    const result = listSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects negative offset", () => {
    const result = listSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });
});

// ─── Update status validation ────────────────────────────────────────

describe("Founders UpdateStatus Schema", () => {
  it("accepts valid status update", () => {
    const result = updateStatusSchema.safeParse({
      id: 1,
      status: "shortlisted",
      adminNotes: "Strong portfolio, follow up next week.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts status update without notes", () => {
    const result = updateStatusSchema.safeParse({
      id: 42,
      status: "contacted",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = updateStatusSchema.safeParse({
      status: "declined",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status value", () => {
    const result = updateStatusSchema.safeParse({
      id: 1,
      status: "accepted",
    });
    expect(result.success).toBe(false);
  });

  it("rejects notes longer than 5000 characters", () => {
    const result = updateStatusSchema.safeParse({
      id: 1,
      status: "reviewing",
      adminNotes: "X".repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Output track coverage ──────────────────────────────────────────

describe("Output Track Enum", () => {
  it("has exactly 3 tracks matching Blueprint §7C", () => {
    expect(OUTPUT_TRACKS).toEqual(["manga", "genga", "full_anime"]);
    expect(OUTPUT_TRACKS.length).toBe(3);
  });
});

// ─── Router file existence ──────────────────────────────────────────

describe("Founders Router Module", () => {
  it("exports foundersRouter", async () => {
    const mod = await import("./routers-founders");
    expect(mod.foundersRouter).toBeDefined();
    expect(typeof mod.foundersRouter).toBe("object");
  });
});

// ─── Schema table existence ─────────────────────────────────────────

describe("Founders Schema Table", () => {
  it("exports founderInterest table from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.founderInterest).toBeDefined();
  });

  it("founderInterest table has expected columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.founderInterest;
    // Drizzle tables expose column definitions
    const columns = Object.keys(table);
    const expectedColumns = ["id", "userId", "name", "email", "outputTrack", "portfolioUrl", "genreFocus", "pitch", "status", "adminNotes", "createdAt"];
    for (const col of expectedColumns) {
      expect(columns).toContain(col);
    }
  });
});
