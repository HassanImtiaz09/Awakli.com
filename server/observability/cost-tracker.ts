/**
 * Cost Tracker — Real-time cost tracking and budget alerting for the Awakli platform.
 *
 * Provides:
 * - Per-user cost accumulation (credits + USD)
 * - Per-provider cost tracking (for margin analysis)
 * - Budget threshold alerting (notify owner when thresholds exceeded)
 * - Daily/hourly cost summaries
 * - Anomaly detection (sudden cost spikes)
 *
 * @see Wave 5C Item 4: Observability
 */

import { createLogger } from "./logger";
import { recordMetric } from "./index";

const log = createLogger("cost-tracker");

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface CostEvent {
  userId: number;
  providerId: string;
  operation: string; // e.g., "video_generation", "lora_training", "upscale"
  creditsCharged: number;
  usdCost: number;
  usdRevenue: number; // What we charged the user (credits * rate)
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface BudgetThreshold {
  name: string;
  limitUsd: number;
  windowMs: number; // Time window for the threshold
  action: "log" | "notify" | "block";
}

export interface CostSummary {
  totalCredits: number;
  totalUsdCost: number;
  totalUsdRevenue: number;
  margin: number; // (revenue - cost) / revenue
  eventCount: number;
  byProvider: Record<string, { cost: number; count: number }>;
  byOperation: Record<string, { cost: number; count: number; credits: number }>;
}

// ─── Budget Thresholds ──────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: BudgetThreshold[] = [
  {
    name: "hourly_cost_spike",
    limitUsd: 50,
    windowMs: 60 * 60 * 1000, // 1 hour
    action: "notify",
  },
  {
    name: "daily_cost_limit",
    limitUsd: 500,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    action: "notify",
  },
  {
    name: "single_operation_limit",
    limitUsd: 25,
    windowMs: 0, // Per-event
    action: "log",
  },
  {
    name: "user_daily_limit",
    limitUsd: 100,
    windowMs: 24 * 60 * 60 * 1000,
    action: "block",
  },
];

// ─── Cost Tracker Class ─────────────────────────────────────────────────────────

export class CostTracker {
  private events: CostEvent[] = [];
  private maxEvents = 100_000;
  private thresholds: BudgetThreshold[];
  private alertCallbacks: Array<(alert: CostAlert) => void> = [];

  constructor(thresholds: BudgetThreshold[] = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  /**
   * Record a cost event and check thresholds.
   */
  record(event: CostEvent): CostAlert[] {
    // Evict old events if over capacity
    if (this.events.length >= this.maxEvents) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // Keep last 24h
      this.events = this.events.filter(e => e.timestamp > cutoff);
    }

    this.events.push(event);

    // Record metrics
    recordMetric("cost.usd", event.usdCost, {
      provider: event.providerId,
      operation: event.operation,
    });
    recordMetric("cost.credits", event.creditsCharged, {
      provider: event.providerId,
      operation: event.operation,
    });

    log.info("cost_event", {
      userId: event.userId,
      provider: event.providerId,
      operation: event.operation,
      credits: event.creditsCharged,
      usdCost: event.usdCost,
    });

    // Check thresholds
    const alerts = this.checkThresholds(event);
    alerts.forEach(alert => {
      this.alertCallbacks.forEach(cb => cb(alert));
    });

    return alerts;
  }

  /**
   * Register a callback for cost alerts.
   */
  onAlert(callback: (alert: CostAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Get cost summary for a time window.
   */
  getSummary(windowMs: number = 24 * 60 * 60 * 1000): CostSummary {
    const cutoff = Date.now() - windowMs;
    const windowEvents = this.events.filter(e => e.timestamp > cutoff);

    const byProvider: Record<string, { cost: number; count: number }> = {};
    const byOperation: Record<string, { cost: number; count: number; credits: number }> = {};

    let totalCredits = 0;
    let totalUsdCost = 0;
    let totalUsdRevenue = 0;

    for (const event of windowEvents) {
      totalCredits += event.creditsCharged;
      totalUsdCost += event.usdCost;
      totalUsdRevenue += event.usdRevenue;

      if (!byProvider[event.providerId]) {
        byProvider[event.providerId] = { cost: 0, count: 0 };
      }
      byProvider[event.providerId].cost += event.usdCost;
      byProvider[event.providerId].count++;

      if (!byOperation[event.operation]) {
        byOperation[event.operation] = { cost: 0, count: 0, credits: 0 };
      }
      byOperation[event.operation].cost += event.usdCost;
      byOperation[event.operation].count++;
      byOperation[event.operation].credits += event.creditsCharged;
    }

    const margin = totalUsdRevenue > 0
      ? (totalUsdRevenue - totalUsdCost) / totalUsdRevenue
      : 0;

    return {
      totalCredits,
      totalUsdCost,
      totalUsdRevenue,
      margin,
      eventCount: windowEvents.length,
      byProvider,
      byOperation,
    };
  }

  /**
   * Get per-user cost summary.
   */
  getUserSummary(userId: number, windowMs: number = 24 * 60 * 60 * 1000): CostSummary {
    const cutoff = Date.now() - windowMs;
    const userEvents = this.events.filter(
      e => e.userId === userId && e.timestamp > cutoff
    );

    const byProvider: Record<string, { cost: number; count: number }> = {};
    const byOperation: Record<string, { cost: number; count: number; credits: number }> = {};

    let totalCredits = 0;
    let totalUsdCost = 0;
    let totalUsdRevenue = 0;

    for (const event of userEvents) {
      totalCredits += event.creditsCharged;
      totalUsdCost += event.usdCost;
      totalUsdRevenue += event.usdRevenue;

      if (!byProvider[event.providerId]) {
        byProvider[event.providerId] = { cost: 0, count: 0 };
      }
      byProvider[event.providerId].cost += event.usdCost;
      byProvider[event.providerId].count++;

      if (!byOperation[event.operation]) {
        byOperation[event.operation] = { cost: 0, count: 0, credits: 0 };
      }
      byOperation[event.operation].cost += event.usdCost;
      byOperation[event.operation].count++;
      byOperation[event.operation].credits += event.creditsCharged;
    }

    const margin = totalUsdRevenue > 0
      ? (totalUsdRevenue - totalUsdCost) / totalUsdRevenue
      : 0;

    return {
      totalCredits,
      totalUsdCost,
      totalUsdRevenue,
      margin,
      eventCount: userEvents.length,
      byProvider,
      byOperation,
    };
  }

  /**
   * Detect anomalies (cost spikes compared to rolling average).
   */
  detectAnomalies(): CostAnomaly[] {
    const anomalies: CostAnomaly[] = [];
    const now = Date.now();

    // Compare last hour to previous 24h average
    const lastHour = this.events.filter(e => e.timestamp > now - 3600_000);
    const prev24h = this.events.filter(
      e => e.timestamp > now - 24 * 3600_000 && e.timestamp <= now - 3600_000
    );

    const lastHourCost = lastHour.reduce((s, e) => s + e.usdCost, 0);
    const avgHourlyCost = prev24h.length > 0
      ? prev24h.reduce((s, e) => s + e.usdCost, 0) / 23 // 23 previous hours
      : 0;

    if (avgHourlyCost > 0 && lastHourCost > avgHourlyCost * 3) {
      anomalies.push({
        type: "cost_spike",
        severity: lastHourCost > avgHourlyCost * 5 ? "critical" : "warning",
        message: `Hourly cost $${lastHourCost.toFixed(2)} is ${(lastHourCost / avgHourlyCost).toFixed(1)}x the 24h average ($${avgHourlyCost.toFixed(2)}/hr)`,
        currentValue: lastHourCost,
        expectedValue: avgHourlyCost,
        timestamp: now,
      });
    }

    // Check for single-provider dominance
    const providerCosts: Record<string, number> = {};
    for (const event of lastHour) {
      providerCosts[event.providerId] = (providerCosts[event.providerId] || 0) + event.usdCost;
    }
    const totalHourCost = lastHourCost;
    for (const [provider, cost] of Object.entries(providerCosts)) {
      if (totalHourCost > 10 && cost / totalHourCost > 0.9) {
        anomalies.push({
          type: "provider_concentration",
          severity: "warning",
          message: `Provider ${provider} accounts for ${((cost / totalHourCost) * 100).toFixed(0)}% of hourly cost`,
          currentValue: cost,
          expectedValue: totalHourCost * 0.5,
          timestamp: now,
        });
      }
    }

    return anomalies;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private checkThresholds(event: CostEvent): CostAlert[] {
    const alerts: CostAlert[] = [];
    const now = Date.now();

    for (const threshold of this.thresholds) {
      if (threshold.windowMs === 0) {
        // Per-event threshold
        if (event.usdCost > threshold.limitUsd) {
          alerts.push({
            threshold: threshold.name,
            action: threshold.action,
            message: `Single operation cost $${event.usdCost.toFixed(2)} exceeds limit $${threshold.limitUsd}`,
            currentCost: event.usdCost,
            limitUsd: threshold.limitUsd,
            timestamp: now,
          });
        }
        continue;
      }

      // Window-based threshold
      const windowStart = now - threshold.windowMs;

      if (threshold.name === "user_daily_limit") {
        // Per-user threshold
        const userCost = this.events
          .filter(e => e.userId === event.userId && e.timestamp > windowStart)
          .reduce((s, e) => s + e.usdCost, 0);

        if (userCost > threshold.limitUsd) {
          alerts.push({
            threshold: threshold.name,
            action: threshold.action,
            message: `User ${event.userId} cost $${userCost.toFixed(2)} exceeds daily limit $${threshold.limitUsd}`,
            currentCost: userCost,
            limitUsd: threshold.limitUsd,
            timestamp: now,
          });
        }
      } else {
        // Global threshold
        const windowCost = this.events
          .filter(e => e.timestamp > windowStart)
          .reduce((s, e) => s + e.usdCost, 0);

        if (windowCost > threshold.limitUsd) {
          alerts.push({
            threshold: threshold.name,
            action: threshold.action,
            message: `Total cost $${windowCost.toFixed(2)} exceeds ${threshold.name} limit $${threshold.limitUsd}`,
            currentCost: windowCost,
            limitUsd: threshold.limitUsd,
            timestamp: now,
          });
        }
      }
    }

    return alerts;
  }
}

// ─── Alert Types ────────────────────────────────────────────────────────────────

export interface CostAlert {
  threshold: string;
  action: "log" | "notify" | "block";
  message: string;
  currentCost: number;
  limitUsd: number;
  timestamp: number;
}

export interface CostAnomaly {
  type: "cost_spike" | "provider_concentration" | "margin_erosion";
  severity: "warning" | "critical";
  message: string;
  currentValue: number;
  expectedValue: number;
  timestamp: number;
}

// ─── Error Alerting ─────────────────────────────────────────────────────────────

export interface ErrorAlert {
  errorType: string;
  message: string;
  count: number;
  windowMs: number;
  firstOccurrence: number;
  lastOccurrence: number;
  context?: Record<string, unknown>;
}

/**
 * Error rate tracker — detects when error rates exceed thresholds.
 */
export class ErrorRateTracker {
  private errors: Array<{ type: string; timestamp: number; message: string }> = [];
  private maxErrors = 10_000;
  private thresholdPerMinute: number;
  private alertCallbacks: Array<(alert: ErrorAlert) => void> = [];

  constructor(thresholdPerMinute: number = 10) {
    this.thresholdPerMinute = thresholdPerMinute;
  }

  /**
   * Record an error occurrence.
   */
  record(errorType: string, message: string): ErrorAlert | null {
    const now = Date.now();

    if (this.errors.length >= this.maxErrors) {
      const cutoff = now - 60 * 60 * 1000; // Keep last hour
      this.errors = this.errors.filter(e => e.timestamp > cutoff);
    }

    this.errors.push({ type: errorType, timestamp: now, message });

    recordMetric("error.count", 1, { type: errorType });

    // Check if threshold exceeded
    const oneMinuteAgo = now - 60_000;
    const recentErrors = this.errors.filter(
      e => e.type === errorType && e.timestamp > oneMinuteAgo
    );

    if (recentErrors.length >= this.thresholdPerMinute) {
      const alert: ErrorAlert = {
        errorType,
        message: `Error rate for "${errorType}" exceeded threshold: ${recentErrors.length}/${this.thresholdPerMinute} per minute`,
        count: recentErrors.length,
        windowMs: 60_000,
        firstOccurrence: recentErrors[0].timestamp,
        lastOccurrence: now,
      };

      log.error("error_rate_exceeded", {
        errorType,
        count: recentErrors.length,
        threshold: this.thresholdPerMinute,
      });

      this.alertCallbacks.forEach(cb => cb(alert));
      return alert;
    }

    return null;
  }

  /**
   * Register a callback for error alerts.
   */
  onAlert(callback: (alert: ErrorAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Get error summary for the last N minutes.
   */
  getSummary(windowMinutes: number = 60): Record<string, { count: number; lastMessage: string }> {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const windowErrors = this.errors.filter(e => e.timestamp > cutoff);

    const summary: Record<string, { count: number; lastMessage: string }> = {};
    for (const error of windowErrors) {
      if (!summary[error.type]) {
        summary[error.type] = { count: 0, lastMessage: error.message };
      }
      summary[error.type].count++;
      summary[error.type].lastMessage = error.message;
    }

    return summary;
  }
}

// ─── Singleton Instances ────────────────────────────────────────────────────────

export const costTracker = new CostTracker();
export const errorTracker = new ErrorRateTracker();
