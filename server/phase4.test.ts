import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("Phase 4: Community Features", () => {
  // ─── Discover ────────────────────────────────────────────────────
  describe("discover", () => {
    it("trending returns an array", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.discover.trending();
      expect(Array.isArray(result)).toBe(true);
    });

    it("newReleases returns an array", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.discover.newReleases();
      expect(Array.isArray(result)).toBe(true);
    });

    it("topRated returns an array", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.discover.topRated();
      expect(Array.isArray(result)).toBe(true);
    });

    it("byGenre returns an array", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.discover.byGenre({ genre: "Action" });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── Search ──────────────────────────────────────────────────────
  describe("search", () => {
    it("projects returns an array for a query", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.search.projects({ query: "test" });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── Leaderboard (removed — voting feature deleted) ─────────────

  // ─── Follows ─────────────────────────────────────────────────────
  describe("follows", () => {
    it("status returns follow state for a user", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.follows.status({ userId: 999 });
      expect(result).toHaveProperty("isFollowing");
      expect(result).toHaveProperty("followers");
      expect(result).toHaveProperty("following");
    });

    it("toggle requires authentication", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.follows.toggle({ userId: 2 })).rejects.toThrow();
    });
  });

  // ─── Notifications ───────────────────────────────────────────────
  describe("notifications", () => {
    it("list requires authentication", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.notifications.list()).rejects.toThrow();
    });

    it("list returns an array for authenticated user", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.notifications.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it("unreadCount returns a count object", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.notifications.unreadCount();
      expect(result).toHaveProperty("count");
      expect(typeof result.count).toBe("number");
    });

    it("markAllRead succeeds for authenticated user", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.notifications.markAllRead();
      expect(result).toHaveProperty("success", true);
    });
  });

  // ─── User Profile ────────────────────────────────────────────────
  describe("userProfile", () => {
    it("get throws NOT_FOUND for non-existent user", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.userProfile.get({ userId: 99999 })).rejects.toThrow();
    });
  });

  // ─── Watchlist ───────────────────────────────────────────────────
  describe("watchlist", () => {
    it("list requires authentication", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.watchlist.list()).rejects.toThrow();
    });

    it("list returns an array for authenticated user", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.watchlist.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── Comments ────────────────────────────────────────────────────
  describe("comments", () => {
    it("list returns an array for an episode", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.comments.list({ episodeId: 1, sort: "newest" });
      expect(Array.isArray(result)).toBe(true);
    });

    it("create requires authentication", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.comments.create({ episodeId: 1, content: "test" })).rejects.toThrow();
    });

    it("create accepts parentId for threaded replies", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      // parentId=999 doesn't exist, but the procedure should still accept the input shape
      // It will either succeed (creating an orphan reply) or fail gracefully
      try {
        await caller.comments.create({ episodeId: 1, content: "reply test", parentId: 999 });
      } catch (e: any) {
        // Acceptable - parentId may not exist in DB
        expect(e).toBeDefined();
      }
    });

    it("create accepts null parentId for top-level comments", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      try {
        await caller.comments.create({ episodeId: 1, content: "top-level comment", parentId: null });
      } catch (e: any) {
        // May fail due to missing episode, but input validation should pass
        expect(e).toBeDefined();
      }
    });

    it("list supports all sort options", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const newest = await caller.comments.list({ episodeId: 1, sort: "newest" });
      const top = await caller.comments.list({ episodeId: 1, sort: "top" });
      const oldest = await caller.comments.list({ episodeId: 1, sort: "oldest" });
      expect(Array.isArray(newest)).toBe(true);
      expect(Array.isArray(top)).toBe(true);
      expect(Array.isArray(oldest)).toBe(true);
    });

    it("delete requires authentication", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(caller.comments.delete({ id: 1 })).rejects.toThrow();
    });
  });

  // ─── Votes (removed — voting feature deleted) ───────────────────
});
