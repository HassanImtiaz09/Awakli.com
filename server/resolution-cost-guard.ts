/**
 * Resolution Cost Guard (Wave 5C Item 5 — Non-Blocking Fix)
 *
 * Prevents runaway auto-regeneration costs by:
 * 1. MAX_COST_PER_ISSUE env var — hard cap per issue resolution attempt
 * 2. Cumulative cost tracking per issue — halts when budget exceeded
 * 3. Escalation to admin when budget exhausted
 *
 * This guards the QA → regen → QA loop from infinite spending.
 */

import { createLogger } from "./observability/logger";

const log = createLogger("resolution-cost-guard");

// ─── Configuration ──────────────────────────────────────────────────────────────

/**
 * Maximum USD cost allowed per single issue resolution attempt.
 * Configurable via MAX_COST_PER_ISSUE env var.
 * Default: $2.00 (covers ~10 regen attempts at $0.20/attempt)
 */
export function getMaxCostPerIssue(): number {
  const envValue = process.env.MAX_COST_PER_ISSUE;
  if (envValue) {
    const parsed = parseFloat(envValue);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 2.0; // Default $2.00
}

/**
 * Maximum total regeneration attempts per issue before escalation.
 * Default: 5 attempts
 */
export function getMaxRegenAttempts(): number {
  const envValue = process.env.MAX_REGEN_ATTEMPTS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 5;
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface IssueCostEntry {
  attemptNumber: number;
  costUsd: number;
  providerId: string;
  operation: string;
  timestamp: number;
  success: boolean;
}

export interface IssueCostState {
  issueId: string;
  totalCostUsd: number;
  attemptCount: number;
  entries: IssueCostEntry[];
  budgetExhausted: boolean;
  escalatedToAdmin: boolean;
  maxBudgetUsd: number;
}

export type CostGuardDecision =
  | { allowed: true }
  | { allowed: false; reason: string; escalate: boolean };

// ─── Cost Guard Class ───────────────────────────────────────────────────────────

export class ResolutionCostGuard {
  private issues: Map<string, IssueCostState> = new Map();

  /**
   * Check if another regeneration attempt is allowed for this issue.
   */
  canAttempt(issueId: string): CostGuardDecision {
    const state = this.getOrCreate(issueId);
    const maxCost = getMaxCostPerIssue();
    const maxAttempts = getMaxRegenAttempts();

    if (state.budgetExhausted) {
      return {
        allowed: false,
        reason: `Budget exhausted for issue ${issueId}: $${state.totalCostUsd.toFixed(2)} / $${maxCost.toFixed(2)}`,
        escalate: !state.escalatedToAdmin,
      };
    }

    if (state.attemptCount >= maxAttempts) {
      return {
        allowed: false,
        reason: `Max attempts (${maxAttempts}) reached for issue ${issueId}`,
        escalate: !state.escalatedToAdmin,
      };
    }

    if (state.totalCostUsd >= maxCost) {
      state.budgetExhausted = true;
      return {
        allowed: false,
        reason: `Cost limit exceeded: $${state.totalCostUsd.toFixed(2)} >= $${maxCost.toFixed(2)}`,
        escalate: true,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a regeneration attempt cost.
   */
  recordAttempt(
    issueId: string,
    costUsd: number,
    providerId: string,
    operation: string,
    success: boolean,
  ): IssueCostState {
    const state = this.getOrCreate(issueId);

    state.attemptCount++;
    state.totalCostUsd += costUsd;
    state.entries.push({
      attemptNumber: state.attemptCount,
      costUsd,
      providerId,
      operation,
      timestamp: Date.now(),
      success,
    });

    // Check if budget now exhausted
    if (state.totalCostUsd >= state.maxBudgetUsd) {
      state.budgetExhausted = true;
      log.warn("budget_exhausted", {
        issueId,
        totalCost: state.totalCostUsd,
        maxBudget: state.maxBudgetUsd,
        attempts: state.attemptCount,
      });
    }

    return state;
  }

  /**
   * Mark issue as escalated to admin.
   */
  markEscalated(issueId: string): void {
    const state = this.getOrCreate(issueId);
    state.escalatedToAdmin = true;
    log.info("issue_escalated", { issueId, totalCost: state.totalCostUsd });
  }

  /**
   * Get the current cost state for an issue.
   */
  getState(issueId: string): IssueCostState | undefined {
    return this.issues.get(issueId);
  }

  /**
   * Reset an issue (e.g., after admin intervention increases budget).
   */
  resetIssue(issueId: string, newBudgetUsd?: number): void {
    const maxCost = newBudgetUsd ?? getMaxCostPerIssue();
    this.issues.set(issueId, {
      issueId,
      totalCostUsd: 0,
      attemptCount: 0,
      entries: [],
      budgetExhausted: false,
      escalatedToAdmin: false,
      maxBudgetUsd: maxCost,
    });
  }

  /**
   * Get all issues that have been escalated.
   */
  getEscalatedIssues(): IssueCostState[] {
    return Array.from(this.issues.values()).filter(s => s.escalatedToAdmin);
  }

  /**
   * Get remaining budget for an issue.
   */
  getRemainingBudget(issueId: string): number {
    const state = this.getOrCreate(issueId);
    return Math.max(0, state.maxBudgetUsd - state.totalCostUsd);
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private getOrCreate(issueId: string): IssueCostState {
    let state = this.issues.get(issueId);
    if (!state) {
      state = {
        issueId,
        totalCostUsd: 0,
        attemptCount: 0,
        entries: [],
        budgetExhausted: false,
        escalatedToAdmin: false,
        maxBudgetUsd: getMaxCostPerIssue(),
      };
      this.issues.set(issueId, state);
    }
    return state;
  }
}

// ─── Stripe Connect Environment Guard ───────────────────────────────────────────

/**
 * Assert that the Stripe environment matches expectations before executing transfers.
 * Prevents accidental live transfers when in test mode and vice versa.
 *
 * Wave 5C Item 5: assertEnvironmentMatch() guard before stripe.transfers.create()
 */
export function assertEnvironmentMatch(stripeSecretKey: string): void {
  const isTestKey = stripeSecretKey.startsWith("sk_test_");
  const isLiveKey = stripeSecretKey.startsWith("sk_live_");
  const nodeEnv = process.env.NODE_ENV;

  if (!isTestKey && !isLiveKey) {
    throw new Error(
      `Invalid Stripe key format. Expected sk_test_* or sk_live_*, got: ${stripeSecretKey.substring(0, 10)}...`
    );
  }

  // In production, only allow live keys
  if (nodeEnv === "production" && isTestKey) {
    log.warn("stripe_env_mismatch", {
      nodeEnv,
      keyType: "test",
      message: "Test key used in production — transfers will fail on real accounts",
    });
    // Don't throw — allow test mode in production for sandbox testing
    // But log a warning for visibility
  }

  // In development/test, warn if using live keys
  if (nodeEnv !== "production" && isLiveKey) {
    throw new Error(
      `SAFETY: Live Stripe key detected in ${nodeEnv} environment. ` +
      `This could result in real money transfers. Use sk_test_* keys for development.`
    );
  }
}

/**
 * Validate that a Connect account ID matches the expected environment.
 */
export function assertConnectAccountValid(accountId: string): void {
  if (!accountId.startsWith("acct_")) {
    throw new Error(`Invalid Stripe Connect account ID format: ${accountId}`);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────────

export const resolutionCostGuard = new ResolutionCostGuard();
