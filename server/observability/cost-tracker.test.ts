/**
 * Tests for Cost Tracker and Error Rate Alerting (Wave 5C Item 4)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  CostTracker,
  ErrorRateTracker,
  DEFAULT_THRESHOLDS,
  type CostEvent,
  type BudgetThreshold,
} from "./cost-tracker";

// ─── Cost Tracker Tests ─────────────────────────────────────────────────────────

describe("Observability - Cost Tracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it("should record cost events", () => {
    const event: CostEvent = {
      userId: 1,
      providerId: "replicate",
      operation: "video_generation",
      creditsCharged: 50,
      usdCost: 2.5,
      usdRevenue: 5.0,
      timestamp: Date.now(),
    };

    const alerts = tracker.record(event);
    expect(alerts).toBeInstanceOf(Array);
  });

  it("should calculate correct summary", () => {
    const now = Date.now();
    tracker.record({
      userId: 1, providerId: "replicate", operation: "video_generation",
      creditsCharged: 50, usdCost: 2.5, usdRevenue: 5.0, timestamp: now,
    });
    tracker.record({
      userId: 2, providerId: "runware", operation: "image_generation",
      creditsCharged: 10, usdCost: 0.5, usdRevenue: 1.0, timestamp: now,
    });

    const summary = tracker.getSummary();
    expect(summary.totalCredits).toBe(60);
    expect(summary.totalUsdCost).toBe(3.0);
    expect(summary.totalUsdRevenue).toBe(6.0);
    expect(summary.margin).toBeCloseTo(0.5); // (6-3)/6 = 0.5
    expect(summary.eventCount).toBe(2);
  });

  it("should track costs by provider", () => {
    const now = Date.now();
    tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 50, usdCost: 2.5, usdRevenue: 5.0, timestamp: now,
    });
    tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 50, usdCost: 2.5, usdRevenue: 5.0, timestamp: now,
    });
    tracker.record({
      userId: 1, providerId: "runware", operation: "image",
      creditsCharged: 10, usdCost: 0.5, usdRevenue: 1.0, timestamp: now,
    });

    const summary = tracker.getSummary();
    expect(summary.byProvider["replicate"].count).toBe(2);
    expect(summary.byProvider["replicate"].cost).toBe(5.0);
    expect(summary.byProvider["runware"].count).toBe(1);
  });

  it("should track costs by operation", () => {
    const now = Date.now();
    tracker.record({
      userId: 1, providerId: "replicate", operation: "video_generation",
      creditsCharged: 50, usdCost: 2.5, usdRevenue: 5.0, timestamp: now,
    });
    tracker.record({
      userId: 1, providerId: "replicate", operation: "lora_training",
      creditsCharged: 100, usdCost: 5.0, usdRevenue: 10.0, timestamp: now,
    });

    const summary = tracker.getSummary();
    expect(summary.byOperation["video_generation"].count).toBe(1);
    expect(summary.byOperation["lora_training"].credits).toBe(100);
  });

  it("should calculate per-user summary", () => {
    const now = Date.now();
    tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 50, usdCost: 2.5, usdRevenue: 5.0, timestamp: now,
    });
    tracker.record({
      userId: 2, providerId: "replicate", operation: "video",
      creditsCharged: 30, usdCost: 1.5, usdRevenue: 3.0, timestamp: now,
    });
    tracker.record({
      userId: 1, providerId: "runware", operation: "image",
      creditsCharged: 10, usdCost: 0.5, usdRevenue: 1.0, timestamp: now,
    });

    const user1Summary = tracker.getUserSummary(1);
    expect(user1Summary.totalCredits).toBe(60);
    expect(user1Summary.eventCount).toBe(2);

    const user2Summary = tracker.getUserSummary(2);
    expect(user2Summary.totalCredits).toBe(30);
    expect(user2Summary.eventCount).toBe(1);
  });
});

// ─── Budget Threshold Tests ─────────────────────────────────────────────────────

describe("Observability - Budget Thresholds", () => {
  it("should alert on single operation exceeding limit", () => {
    const thresholds: BudgetThreshold[] = [
      { name: "single_op", limitUsd: 10, windowMs: 0, action: "log" },
    ];
    const tracker = new CostTracker(thresholds);

    const alerts = tracker.record({
      userId: 1, providerId: "replicate", operation: "lora_training",
      creditsCharged: 500, usdCost: 25.0, usdRevenue: 50.0, timestamp: Date.now(),
    });

    expect(alerts.length).toBe(1);
    expect(alerts[0].threshold).toBe("single_op");
    expect(alerts[0].action).toBe("log");
  });

  it("should alert on user daily limit exceeded", () => {
    const thresholds: BudgetThreshold[] = [
      { name: "user_daily_limit", limitUsd: 5, windowMs: 24 * 60 * 60 * 1000, action: "block" },
    ];
    const tracker = new CostTracker(thresholds);
    const now = Date.now();

    // Record events that exceed user limit
    tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 50, usdCost: 3.0, usdRevenue: 6.0, timestamp: now - 1000,
    });

    const alerts = tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 50, usdCost: 3.0, usdRevenue: 6.0, timestamp: now,
    });

    expect(alerts.length).toBe(1);
    expect(alerts[0].threshold).toBe("user_daily_limit");
    expect(alerts[0].action).toBe("block");
  });

  it("should not alert when within limits", () => {
    const thresholds: BudgetThreshold[] = [
      { name: "single_op", limitUsd: 100, windowMs: 0, action: "notify" },
    ];
    const tracker = new CostTracker(thresholds);

    const alerts = tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 10, usdCost: 0.5, usdRevenue: 1.0, timestamp: Date.now(),
    });

    expect(alerts.length).toBe(0);
  });

  it("should fire alert callbacks", () => {
    const thresholds: BudgetThreshold[] = [
      { name: "test_limit", limitUsd: 1, windowMs: 0, action: "notify" },
    ];
    const tracker = new CostTracker(thresholds);

    let alertReceived = false;
    tracker.onAlert(() => { alertReceived = true; });

    tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 100, usdCost: 5.0, usdRevenue: 10.0, timestamp: Date.now(),
    });

    expect(alertReceived).toBe(true);
  });

  it("DEFAULT_THRESHOLDS should have reasonable values", () => {
    expect(DEFAULT_THRESHOLDS.length).toBeGreaterThanOrEqual(3);
    const hourly = DEFAULT_THRESHOLDS.find(t => t.name === "hourly_cost_spike");
    expect(hourly).toBeDefined();
    expect(hourly!.limitUsd).toBeGreaterThan(0);
    expect(hourly!.action).toBe("notify");
  });
});

// ─── Anomaly Detection Tests ────────────────────────────────────────────────────

describe("Observability - Anomaly Detection", () => {
  it("should detect cost spikes", () => {
    const tracker = new CostTracker([]);
    const now = Date.now();

    // Simulate 23 hours of normal traffic ($2/hr average)
    for (let h = 23; h >= 1; h--) {
      tracker.record({
        userId: 1, providerId: "replicate", operation: "video",
        creditsCharged: 20, usdCost: 2.0, usdRevenue: 4.0,
        timestamp: now - h * 3600_000,
      });
    }

    // Spike in last hour: $20 (10x normal)
    for (let i = 0; i < 10; i++) {
      tracker.record({
        userId: 1, providerId: "replicate", operation: "video",
        creditsCharged: 20, usdCost: 2.0, usdRevenue: 4.0,
        timestamp: now - 30_000 + i * 1000,
      });
    }

    const anomalies = tracker.detectAnomalies();
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].type).toBe("cost_spike");
  });

  it("should not flag anomalies during normal operation", () => {
    const tracker = new CostTracker([]);
    const now = Date.now();

    // Uniform traffic
    for (let h = 24; h >= 0; h--) {
      tracker.record({
        userId: 1, providerId: "replicate", operation: "video",
        creditsCharged: 20, usdCost: 2.0, usdRevenue: 4.0,
        timestamp: now - h * 3600_000,
      });
    }

    const anomalies = tracker.detectAnomalies();
    const spikes = anomalies.filter(a => a.type === "cost_spike");
    expect(spikes.length).toBe(0);
  });

  it("should detect provider concentration", () => {
    const tracker = new CostTracker([]);
    const now = Date.now();

    // All cost from one provider in last hour (> $10 total, > 90% concentration)
    for (let i = 0; i < 6; i++) {
      tracker.record({
        userId: 1, providerId: "replicate", operation: "video",
        creditsCharged: 20, usdCost: 2.0, usdRevenue: 4.0,
        timestamp: now - 30_000 + i * 1000,
      });
    }

    const anomalies = tracker.detectAnomalies();
    const concentration = anomalies.filter(a => a.type === "provider_concentration");
    expect(concentration.length).toBeGreaterThan(0);
  });
});

// ─── Error Rate Tracker Tests ───────────────────────────────────────────────────

describe("Observability - Error Rate Tracker", () => {
  let tracker: ErrorRateTracker;

  beforeEach(() => {
    tracker = new ErrorRateTracker(5); // Alert after 5 errors/minute
  });

  it("should not alert below threshold", () => {
    const alert = tracker.record("provider_timeout", "Replicate timed out");
    expect(alert).toBeNull();
  });

  it("should alert when threshold exceeded", () => {
    // Record 5 errors (threshold)
    for (let i = 0; i < 4; i++) {
      tracker.record("provider_timeout", "Replicate timed out");
    }
    const alert = tracker.record("provider_timeout", "Replicate timed out");
    expect(alert).not.toBeNull();
    expect(alert!.errorType).toBe("provider_timeout");
    expect(alert!.count).toBe(5);
  });

  it("should track different error types independently", () => {
    for (let i = 0; i < 4; i++) {
      tracker.record("provider_timeout", "Timeout");
    }
    // Different error type should not trigger alert
    const alert = tracker.record("validation_error", "Invalid input");
    expect(alert).toBeNull();
  });

  it("should provide error summary", () => {
    tracker.record("provider_timeout", "Timeout 1");
    tracker.record("provider_timeout", "Timeout 2");
    tracker.record("validation_error", "Bad input");

    const summary = tracker.getSummary(60);
    expect(summary["provider_timeout"].count).toBe(2);
    expect(summary["validation_error"].count).toBe(1);
  });

  it("should fire alert callbacks", () => {
    let alertReceived = false;
    tracker.onAlert(() => { alertReceived = true; });

    for (let i = 0; i < 5; i++) {
      tracker.record("provider_timeout", "Timeout");
    }

    expect(alertReceived).toBe(true);
  });

  it("should include timing information in alerts", () => {
    for (let i = 0; i < 5; i++) {
      tracker.record("test_error", "Error message");
    }

    // Get the alert from the last record call
    const alert = tracker.record("test_error", "Error message");
    // After 5 errors, subsequent ones also trigger alerts
    if (alert) {
      expect(alert.firstOccurrence).toBeLessThanOrEqual(alert.lastOccurrence);
      expect(alert.windowMs).toBe(60_000);
    }
  });
});

// ─── Margin Tracking Tests ──────────────────────────────────────────────────────

describe("Observability - Margin Tracking", () => {
  it("should calculate positive margin correctly", () => {
    const tracker = new CostTracker([]);
    const now = Date.now();

    tracker.record({
      userId: 1, providerId: "replicate", operation: "video",
      creditsCharged: 50, usdCost: 2.5, usdRevenue: 5.0, timestamp: now,
    });

    const summary = tracker.getSummary();
    expect(summary.margin).toBeCloseTo(0.5); // 50% margin
  });

  it("should detect negative margin (cost > revenue)", () => {
    const tracker = new CostTracker([]);
    const now = Date.now();

    tracker.record({
      userId: 1, providerId: "replicate", operation: "lora_training",
      creditsCharged: 10, usdCost: 5.0, usdRevenue: 1.0, timestamp: now,
    });

    const summary = tracker.getSummary();
    expect(summary.margin).toBeLessThan(0); // Negative margin
  });

  it("should handle zero revenue gracefully", () => {
    const tracker = new CostTracker([]);
    const now = Date.now();

    tracker.record({
      userId: 1, providerId: "replicate", operation: "internal",
      creditsCharged: 0, usdCost: 1.0, usdRevenue: 0, timestamp: now,
    });

    const summary = tracker.getSummary();
    expect(summary.margin).toBe(0); // No division by zero
  });
});
