/**
 * Resolution Cost Guard Tests (Wave 5C Item 5 — Non-Blocking Fixes)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ResolutionCostGuard,
  getMaxCostPerIssue,
  getMaxRegenAttempts,
  assertEnvironmentMatch,
  assertConnectAccountValid,
} from "./resolution-cost-guard";

// ─── MAX_COST_PER_ISSUE Configuration ───────────────────────────────────────────

describe("Resolution Cost Guard - Configuration", () => {
  beforeEach(() => {
    delete process.env.MAX_COST_PER_ISSUE;
    delete process.env.MAX_REGEN_ATTEMPTS;
  });

  it("should return default $2.00 when env not set", () => {
    expect(getMaxCostPerIssue()).toBe(2.0);
  });

  it("should read MAX_COST_PER_ISSUE from env", () => {
    process.env.MAX_COST_PER_ISSUE = "5.00";
    expect(getMaxCostPerIssue()).toBe(5.0);
  });

  it("should fallback to default for invalid env value", () => {
    process.env.MAX_COST_PER_ISSUE = "not_a_number";
    expect(getMaxCostPerIssue()).toBe(2.0);
  });

  it("should fallback to default for negative value", () => {
    process.env.MAX_COST_PER_ISSUE = "-1.0";
    expect(getMaxCostPerIssue()).toBe(2.0);
  });

  it("should return default 5 max regen attempts", () => {
    expect(getMaxRegenAttempts()).toBe(5);
  });

  it("should read MAX_REGEN_ATTEMPTS from env", () => {
    process.env.MAX_REGEN_ATTEMPTS = "10";
    expect(getMaxRegenAttempts()).toBe(10);
  });
});

// ─── Cost Guard Logic ───────────────────────────────────────────────────────────

describe("Resolution Cost Guard - Guard Logic", () => {
  let guard: ResolutionCostGuard;

  beforeEach(() => {
    guard = new ResolutionCostGuard();
    delete process.env.MAX_COST_PER_ISSUE;
    delete process.env.MAX_REGEN_ATTEMPTS;
  });

  it("should allow first attempt on new issue", () => {
    const decision = guard.canAttempt("issue-1");
    expect(decision.allowed).toBe(true);
  });

  it("should allow attempts within budget", () => {
    guard.recordAttempt("issue-1", 0.20, "replicate", "regen_panel", false);
    guard.recordAttempt("issue-1", 0.20, "replicate", "regen_panel", false);
    const decision = guard.canAttempt("issue-1");
    expect(decision.allowed).toBe(true);
  });

  it("should block when cost exceeds budget", () => {
    // Default budget is $2.00
    for (let i = 0; i < 10; i++) {
      guard.recordAttempt("issue-1", 0.25, "replicate", "regen_panel", false);
    }
    // Total: $2.50 > $2.00
    const decision = guard.canAttempt("issue-1");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain("Budget exhausted");
      expect(decision.escalate).toBe(true);
    }
  });

  it("should block when max attempts reached", () => {
    // Default max attempts is 5
    for (let i = 0; i < 5; i++) {
      guard.recordAttempt("issue-1", 0.10, "replicate", "regen_panel", false);
    }
    const decision = guard.canAttempt("issue-1");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain("Max attempts");
    }
  });

  it("should track cost per issue independently", () => {
    guard.recordAttempt("issue-1", 1.50, "replicate", "regen_panel", false);
    guard.recordAttempt("issue-2", 0.20, "replicate", "regen_panel", false);

    const state1 = guard.getState("issue-1")!;
    const state2 = guard.getState("issue-2")!;

    expect(state1.totalCostUsd).toBe(1.50);
    expect(state2.totalCostUsd).toBe(0.20);
  });

  it("should report remaining budget", () => {
    guard.recordAttempt("issue-1", 0.50, "replicate", "regen_panel", false);
    expect(guard.getRemainingBudget("issue-1")).toBe(1.50); // $2.00 - $0.50
  });

  it("should mark issue as escalated", () => {
    guard.markEscalated("issue-1");
    const state = guard.getState("issue-1")!;
    expect(state.escalatedToAdmin).toBe(true);
  });

  it("should not re-escalate already escalated issues", () => {
    guard.markEscalated("issue-1");
    // Exhaust budget
    for (let i = 0; i < 10; i++) {
      guard.recordAttempt("issue-1", 0.25, "replicate", "regen_panel", false);
    }
    const decision = guard.canAttempt("issue-1");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.escalate).toBe(false); // Already escalated
    }
  });

  it("should reset issue budget", () => {
    guard.recordAttempt("issue-1", 1.80, "replicate", "regen_panel", false);
    guard.resetIssue("issue-1", 5.0);
    const state = guard.getState("issue-1")!;
    expect(state.totalCostUsd).toBe(0);
    expect(state.attemptCount).toBe(0);
    expect(state.maxBudgetUsd).toBe(5.0);
    expect(state.budgetExhausted).toBe(false);
  });

  it("should list escalated issues", () => {
    guard.markEscalated("issue-1");
    guard.markEscalated("issue-3");
    const escalated = guard.getEscalatedIssues();
    expect(escalated.length).toBe(2);
    expect(escalated.map(e => e.issueId)).toContain("issue-1");
    expect(escalated.map(e => e.issueId)).toContain("issue-3");
  });

  it("should record attempt details", () => {
    guard.recordAttempt("issue-1", 0.20, "replicate", "regen_panel", true);
    const state = guard.getState("issue-1")!;
    expect(state.entries.length).toBe(1);
    expect(state.entries[0].costUsd).toBe(0.20);
    expect(state.entries[0].providerId).toBe("replicate");
    expect(state.entries[0].operation).toBe("regen_panel");
    expect(state.entries[0].success).toBe(true);
    expect(state.entries[0].attemptNumber).toBe(1);
  });
});

// ─── Stripe Connect Environment Guard ───────────────────────────────────────────

describe("Resolution Cost Guard - Stripe Connect Guard", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("should accept test key in non-production", () => {
    process.env.NODE_ENV = "development";
    expect(() => assertEnvironmentMatch("sk_test_abc123")).not.toThrow();
  });

  it("should accept test key in test environment", () => {
    process.env.NODE_ENV = "test";
    expect(() => assertEnvironmentMatch("sk_test_abc123")).not.toThrow();
  });

  it("should throw for live key in development", () => {
    process.env.NODE_ENV = "development";
    expect(() => assertEnvironmentMatch("sk_live_abc123")).toThrow("SAFETY");
    expect(() => assertEnvironmentMatch("sk_live_abc123")).toThrow("Live Stripe key");
  });

  it("should throw for live key in test environment", () => {
    process.env.NODE_ENV = "test";
    expect(() => assertEnvironmentMatch("sk_live_abc123")).toThrow("SAFETY");
  });

  it("should allow test key in production (sandbox testing)", () => {
    process.env.NODE_ENV = "production";
    // Should NOT throw — just warn
    expect(() => assertEnvironmentMatch("sk_test_abc123")).not.toThrow();
  });

  it("should allow live key in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertEnvironmentMatch("sk_live_abc123")).not.toThrow();
  });

  it("should throw for invalid key format", () => {
    expect(() => assertEnvironmentMatch("invalid_key")).toThrow("Invalid Stripe key format");
  });

  it("should validate Connect account ID format", () => {
    expect(() => assertConnectAccountValid("acct_123abc")).not.toThrow();
  });

  it("should reject invalid Connect account ID", () => {
    expect(() => assertConnectAccountValid("invalid_123")).toThrow("Invalid Stripe Connect account ID");
  });
});
