import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock credit-gateway before importing the queue
vi.mock("./credit-gateway", () => ({
  authorizeAndHold: vi.fn().mockResolvedValue({
    authorized: true,
    ticket: {
      holdId: "hold_test_123",
      userId: 1,
      creditsHeld: 10,
      action: "panel_generation",
      createdAt: Date.now(),
    },
  }),
  commitTicket: vi.fn().mockResolvedValue(undefined),
  releaseTicket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./observability/logger", () => ({
  routerLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  getUserSubscriptionTier: vi.fn().mockResolvedValue("free_trial"),
}));

import {
  submitJob,
  getQueueStatus,
  cancelUserJobs,
  getQueueMetrics,
  configureQueue,
  _queue,
  _running,
} from "./generation-queue";
import { authorizeAndHold, commitTicket, releaseTicket } from "./credit-gateway";

describe("Generation Queue", () => {
  beforeEach(() => {
    // Clear queue state
    _queue.length = 0;
    _running.clear();
    vi.clearAllMocks();
    // Reset config to defaults
    configureQueue({
      maxConcurrentPerUser: 3,
      maxConcurrentGlobal: 20,
      maxQueuePerUser: 10,
      maxQueueGlobal: 100,
      jobTimeoutMs: 5 * 60 * 1000,
    });
  });

  describe("submitJob", () => {
    it("executes a simple job and returns the result", async () => {
      const result = await submitJob(1, "panel_generation", async () => "done");
      expect(result).toBe("done");
    });

    it("executes multiple jobs sequentially for the same user", async () => {
      const order: number[] = [];
      const job1 = submitJob(1, "panel_generation", async () => {
        order.push(1);
        return "job1";
      });
      const job2 = submitJob(1, "panel_generation", async () => {
        order.push(2);
        return "job2";
      });

      const [r1, r2] = await Promise.all([job1, job2]);
      expect(r1).toBe("job1");
      expect(r2).toBe("job2");
      expect(order).toContain(1);
      expect(order).toContain(2);
    });

    it("rejects when user queue limit is reached", async () => {
      configureQueue({ maxQueuePerUser: 2, maxConcurrentPerUser: 1 });

      // Start a slow job that blocks (never resolves)
      const slowJob = submitJob(1, "panel_generation", () => new Promise(() => {}));

      // Wait for the async tier lookup + processQueue to move it to running
      await new Promise(r => setTimeout(r, 50));

      // Queue 2 more (should fill the queue) — must await each to let async tier lookup complete
      const q1 = submitJob(1, "panel_generation", async () => "q1");
      await new Promise(r => setTimeout(r, 10));
      const q2 = submitJob(1, "panel_generation", async () => "q2");
      await new Promise(r => setTimeout(r, 10));

      // Third should be rejected — queue is full
      await expect(
        submitJob(1, "panel_generation", async () => "q3")
      ).rejects.toThrow(/Queue limit reached/);
    });

    it("rejects when global queue limit is reached", async () => {
      configureQueue({ maxQueueGlobal: 1, maxConcurrentGlobal: 0 });

      // Fill the global queue
      // With concurrency 0, the first job stays queued
      const p1 = submitJob(1, "panel_generation", async () => "first");
      // Wait for async tier lookup to complete so job enters queue
      await new Promise(r => setTimeout(r, 50));

      await expect(
        submitJob(2, "panel_generation", async () => "second")
      ).rejects.toThrow(/Server is busy/);
    });

    it("handles job failure gracefully", async () => {
      await expect(
        submitJob(1, "panel_generation", async () => {
          throw new Error("Generation API down");
        })
      ).rejects.toThrow("Generation API down");
    });
  });

  describe("submitJob with credits", () => {
    it("authorizes and holds credits before execution", async () => {
      const result = await submitJob(
        1,
        "panel_generation",
        async () => "generated",
        { withCredits: true, episodeId: 5, projectId: 10 }
      );

      expect(result).toBe("generated");
      expect(authorizeAndHold).toHaveBeenCalledWith(1, "panel_generation", {
        episodeId: 5,
        projectId: 10,
        description: expect.any(String),
      });
      expect(commitTicket).toHaveBeenCalled();
    });

    it("releases credits (auto-refund) on generation failure", async () => {
      await expect(
        submitJob(
          1,
          "panel_generation",
          async () => { throw new Error("API timeout"); },
          { withCredits: true }
        )
      ).rejects.toThrow("API timeout");

      expect(releaseTicket).toHaveBeenCalledWith(
        expect.objectContaining({ holdId: "hold_test_123" }),
        expect.stringContaining("API timeout")
      );
    });

    it("rejects if credit authorization fails", async () => {
      vi.mocked(authorizeAndHold).mockResolvedValueOnce({
        authorized: false,
        error: "Insufficient credits",
      } as any);

      await expect(
        submitJob(
          1,
          "panel_generation",
          async () => "should not run",
          { withCredits: true }
        )
      ).rejects.toThrow("Insufficient credits");
    });
  });

  describe("getQueueStatus", () => {
    it("returns zero counts for a user with no jobs", () => {
      const status = getQueueStatus(99);
      expect(status.globalRunning).toBe(0);
      expect(status.globalQueued).toBe(0);
      expect(status.userRunning).toBe(0);
      expect(status.userQueued).toBe(0);
      expect(status.position).toBe(0);
    });
  });

  describe("cancelUserJobs", () => {
    it("returns zero when no jobs to cancel", async () => {
      const result = await cancelUserJobs(99);
      expect(result.cancelled).toBe(0);
      expect(result.creditsReleased).toBe(0);
    });
  });

  describe("getQueueMetrics", () => {
    it("returns empty metrics when queue is idle", () => {
      const metrics = getQueueMetrics();
      expect(metrics.running).toBe(0);
      expect(metrics.queued).toBe(0);
      expect(metrics.config).toBeDefined();
      expect(metrics.config.maxConcurrentPerUser).toBe(3);
      expect(metrics.jobsByAction).toEqual({});
    });
  });

  describe("configureQueue", () => {
    it("updates queue configuration", () => {
      configureQueue({ maxConcurrentPerUser: 5, maxConcurrentGlobal: 50 });
      const metrics = getQueueMetrics();
      expect(metrics.config.maxConcurrentPerUser).toBe(5);
      expect(metrics.config.maxConcurrentGlobal).toBe(50);
    });

    it("preserves unmodified config values", () => {
      configureQueue({ maxConcurrentPerUser: 7 });
      const metrics = getQueueMetrics();
      expect(metrics.config.maxConcurrentPerUser).toBe(7);
      expect(metrics.config.maxConcurrentGlobal).toBe(20); // default preserved
    });
  });
});
