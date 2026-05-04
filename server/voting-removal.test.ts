/**
 * voting-removal.test.ts — Verifies that the community voting system has been
 * fully removed from the codebase (Wave 1 cleanup).
 *
 * NOTE: The governance review voting system (craft engineers voting on quality
 * gates in governance-workflow.ts) is intentionally preserved and NOT covered
 * by these tests.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Deleted Files ─────────────────────────────────────────────────────────
describe("Voting system files are deleted", () => {
  const deletedFiles = [
    "server/routers-voting.ts",
    "server/db-voting.ts",
    "server/voting.test.ts",
    "migrate-voting.mjs",
    "client/src/components/awakli/VoteProgressBar.tsx",
    "client/src/pages/Leaderboard.tsx",
  ];

  for (const file of deletedFiles) {
    it(`${file} does not exist`, () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, file))).toBe(false);
    });
  }
});

// ─── Schema Cleanup ────────────────────────────────────────────────────────
describe("Schema has no voting tables or columns", () => {
  const schemaPath = path.join(PROJECT_ROOT, "drizzle/schema.ts");
  let schemaSrc: string;

  it("schema.ts exists", () => {
    schemaSrc = fs.readFileSync(schemaPath, "utf-8");
    expect(schemaSrc).toBeDefined();
  });

  it("no votes table export", () => {
    schemaSrc = fs.readFileSync(schemaPath, "utf-8");
    expect(schemaSrc).not.toMatch(/export\s+const\s+votes\s*=/);
  });

  it("no animePromotions table export", () => {
    schemaSrc = fs.readFileSync(schemaPath, "utf-8");
    expect(schemaSrc).not.toMatch(/export\s+const\s+animePromotions\s*=/);
  });

  it("no voteScore column on projects", () => {
    schemaSrc = fs.readFileSync(schemaPath, "utf-8");
    expect(schemaSrc).not.toMatch(/voteScore/);
  });

  it("no totalVotes column on projects", () => {
    schemaSrc = fs.readFileSync(schemaPath, "utf-8");
    expect(schemaSrc).not.toMatch(/totalVotes/);
  });
});

// ─── Router Cleanup ────────────────────────────────────────────────────────
describe("Routers have no community voting procedures", () => {
  const routerPath = path.join(PROJECT_ROOT, "server/routers.ts");
  let routerSrc: string;

  it("routers.ts has no votingRouter registration", () => {
    routerSrc = fs.readFileSync(routerPath, "utf-8");
    // Check for voting router registrations in appRouter
    expect(routerSrc).not.toMatch(/voting:\s*votingRouter/);
    expect(routerSrc).not.toMatch(/enhancedVoting:\s*enhancedVotingRouter/);
    expect(routerSrc).not.toMatch(/voteProgress:\s*voteProgressRouter/);
    expect(routerSrc).not.toMatch(/discoverVoting:\s*discoverVotingRouter/);
    expect(routerSrc).not.toMatch(/roadToAnime:\s*roadToAnimeRouter/);
    expect(routerSrc).not.toMatch(/creatorVoting:\s*creatorVotingRouter/);
    expect(routerSrc).not.toMatch(/adminVoting:\s*adminVotingRouter/);
  });

  it("routers.ts has no leaderboard router", () => {
    routerSrc = fs.readFileSync(routerPath, "utf-8");
    expect(routerSrc).not.toMatch(/leaderboard:\s*leaderboardRouter/);
  });

  it("routers.ts does not import from routers-voting", () => {
    routerSrc = fs.readFileSync(routerPath, "utf-8");
    expect(routerSrc).not.toMatch(/from\s+["']\.\/routers-voting["']/);
  });
});

// ─── Frontend Cleanup ──────────────────────────────────────────────────────
describe("Frontend has no community voting UI", () => {
  it("App.tsx has no /leaderboard route", () => {
    const appSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, "client/src/App.tsx"),
      "utf-8"
    );
    expect(appSrc).not.toMatch(/\/leaderboard/);
  });

  it("TopNav has no Vote nav link", () => {
    const navSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, "client/src/components/awakli/TopNav.tsx"),
      "utf-8"
    );
    // Should not have a nav item labeled "Vote" pointing to leaderboard
    expect(navSrc).not.toMatch(/["']\/leaderboard["']/);
    expect(navSrc).not.toMatch(/label:\s*["']Vote["']/);
  });

  it("SEOHead default description has no vote language", () => {
    const seoSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, "client/src/components/awakli/SEOHead.tsx"),
      "utf-8"
    );
    expect(seoSrc).not.toMatch(/voted/i);
  });
});
