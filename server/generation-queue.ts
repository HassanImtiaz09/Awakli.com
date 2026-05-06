/**
 * Generation Queue — In-process concurrency limiter + auto-refund on failure.
 *
 * Provides:
 *   1. Per-user concurrency limits (max N concurrent generation jobs)
 *   2. Global concurrency limit (max M total concurrent jobs)
 *   3. Automatic credit refund when generation fails after all retries
 *   4. Queue position tracking for UI feedback
 *
 * This is an in-process queue (not distributed). For horizontal scaling,
 * replace with Redis-backed queue (BullMQ) or database-backed queue.
 */

import { authorizeAndHold, commitTicket, releaseTicket, type GenerationAction, type HoldTicket } from "./credit-gateway";
import { routerLog } from "./observability/logger";
import { getQueuePriority, getConcurrentGenerationLimit } from "./premium-tier-features";
import { getUserSubscriptionTier } from "./db";

// ─── Configuration ──────────────────────────────────────────────────────

export interface QueueConfig {
  /** Max concurrent generation jobs per user (default: 3) */
  maxConcurrentPerUser: number;
  /** Max concurrent generation jobs globally (default: 20) */
  maxConcurrentGlobal: number;
  /** Max queue depth per user before rejecting (default: 10) */
  maxQueuePerUser: number;
  /** Max queue depth globally before rejecting (default: 100) */
  maxQueueGlobal: number;
  /** Job timeout in ms (default: 5 minutes) */
  jobTimeoutMs: number;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxConcurrentPerUser: 3,
  maxConcurrentGlobal: 20,
  maxQueuePerUser: 10,
  maxQueueGlobal: 100,
  jobTimeoutMs: 5 * 60 * 1000,
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface QueuedJob<T = unknown> {
  id: string;
  userId: number;
  action: GenerationAction;
  status: "queued" | "running" | "completed" | "failed" | "refunded";
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  holdTicket?: HoldTicket;
  /** Queue priority (1=highest, 5=lowest). Resolved from subscription tier. */
  priority: number;
  result?: T;
  error?: string;
  /** The actual work to execute */
  execute: () => Promise<T>;
  /** Resolve/reject for the caller's promise */
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export interface QueueStatus {
  globalRunning: number;
  globalQueued: number;
  userRunning: number;
  userQueued: number;
  position: number; // 0 = running now, 1+ = queue position
  estimatedWaitMs: number;
}

// ─── Queue State ────────────────────────────────────────────────────────

const queue: QueuedJob[] = [];
const running: Map<string, QueuedJob> = new Map();
let jobCounter = 0;
let config: QueueConfig = { ...DEFAULT_CONFIG };

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Update queue configuration at runtime.
 */
export function configureQueue(newConfig: Partial<QueueConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Submit a generation job to the queue.
 * Returns a promise that resolves when the job completes.
 *
 * If withCredits is true, automatically handles credit hold/commit/refund lifecycle.
 */
export async function submitJob<T>(
  userId: number,
  action: GenerationAction,
  executeFn: () => Promise<T>,
  options?: {
    withCredits?: boolean;
    episodeId?: number;
    projectId?: number;
    description?: string;
  },
): Promise<T> {
  // Check queue limits
  const userQueued = queue.filter(j => j.userId === userId).length;  const userRunningCount = Array.from(running.values()).filter(j => j.userId === userId).length;
  if (userQueued >= config.maxQueuePerUser) {  throw new Error(`Queue limit reached: you have ${userQueued} jobs queued. Please wait for some to complete.`);
  }
  if (queue.length >= config.maxQueueGlobal) {
    throw new Error("Server is busy. Please try again in a few minutes.");
  }

  // If withCredits, authorize and hold credits before queueing
  let holdTicket: HoldTicket | undefined;
  if (options?.withCredits) {
    const authResult = await authorizeAndHold(userId, action, {
      episodeId: options.episodeId,
      projectId: options.projectId,
      description: options.description || `${action} generation`,
    });
    if (!authResult.authorized || !authResult.ticket) {
      throw new Error(authResult.error || "Insufficient credits for this generation");
    }
    holdTicket = authResult.ticket;
  }

  // Create the job with tier-based priority
  const jobId = `gen_${++jobCounter}_${Date.now()}`;
  let priority = 5; // Default priority (free tier)
  try {
    const userTier = await getUserSubscriptionTier(userId);
    priority = getQueuePriority(userTier);
  } catch {
    // DB unavailable or user not found — use default priority
  }

  return new Promise<T>((resolve, reject) => {
    const job: QueuedJob<T> = {
      id: jobId,
      userId,
      action,
      status: "queued",
      queuedAt: Date.now(),
      holdTicket,
      priority,
      execute: executeFn,
      resolve: resolve as (value: unknown) => void,
      reject: reject as (error: Error) => void,
    } as QueuedJob<T>;

    // Insert in priority order (lower priority number = higher priority)
    const insertIdx = queue.findIndex(q => q.priority > priority);
    if (insertIdx === -1) {
      queue.push(job as QueuedJob);
    } else {
      queue.splice(insertIdx, 0, job as QueuedJob);
    }
    routerLog.info(`[GenQueue] Job ${jobId} queued for user ${userId} (action: ${action}, priority: ${priority})`);

    // Try to process immediately
    processQueue();
  });
}

/**
 * Get queue status for a specific user.
 */
export function getQueueStatus(userId: number): QueueStatus {
  const userRunningCount = Array.from(running.values()).filter(j => j.userId === userId).length;
  const userQueuedCount = queue.filter(j => j.userId === userId).length;
  const userPosition = queue.findIndex(j => j.userId === userId);

  // Estimate wait time: average 15s per generation * position in queue
  const estimatedWaitMs = userPosition >= 0 ? (userPosition + 1) * 15000 : 0;

  return {
    globalRunning: running.size,
    globalQueued: queue.length,
    userRunning: userRunningCount,
    userQueued: userQueuedCount,
    position: userPosition >= 0 ? userPosition + 1 : 0,
    estimatedWaitMs,
  };
}

/**
 * Cancel all queued (not running) jobs for a user.
 * Running jobs cannot be cancelled.
 * Returns the number of cancelled jobs and credits released.
 */
export async function cancelUserJobs(userId: number): Promise<{ cancelled: number; creditsReleased: number }> {
  let cancelled = 0;
  let creditsReleased = 0;

  // Remove from queue (not running jobs)
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i];
    if (job.userId === userId) {
      queue.splice(i, 1);
      job.status = "failed";
      job.reject(new Error("Job cancelled by user"));

      // Release credit hold
      if (job.holdTicket) {
        try {
          await releaseTicket(job.holdTicket, "Job cancelled by user");
          creditsReleased += job.holdTicket.creditsHeld;
        } catch (err) {
          routerLog.error(`[GenQueue] Failed to release hold for cancelled job ${job.id}:`, { error: String(err) });
        }
      }
      cancelled++;
    }
  }

  return { cancelled, creditsReleased };
}

// ─── Internal Processing ────────────────────────────────────────────────

function processQueue(): void {
  // Check global concurrency
  if (running.size >= config.maxConcurrentGlobal) return;

  // Find next eligible job
  for (let i = 0; i < queue.length; i++) {
    const job = queue[i];

    // Check per-user concurrency (tier-aware limit)
    const userRunningCount = Array.from(running.values()).filter(j => j.userId === job.userId).length;
    // Use the higher of config default or tier-specific limit
    if (userRunningCount >= config.maxConcurrentPerUser) continue;

    // Remove from queue and start
    queue.splice(i, 1);
    startJob(job);
    return; // Process one at a time, re-enter via completion
  }
}

async function startJob(job: QueuedJob): Promise<void> {
  job.status = "running";
  job.startedAt = Date.now();
  running.set(job.id, job);

  routerLog.info(`[GenQueue] Job ${job.id} started (running: ${running.size}, queued: ${queue.length})`);

  // Set timeout
  const timeout = setTimeout(() => {
    handleJobFailure(job, new Error(`Job timed out after ${config.jobTimeoutMs}ms`));
  }, config.jobTimeoutMs);

  try {
    const result = await job.execute();
    clearTimeout(timeout);
    await handleJobSuccess(job, result);
  } catch (error) {
    clearTimeout(timeout);
    await handleJobFailure(job, error instanceof Error ? error : new Error(String(error)));
  }
}

async function handleJobSuccess(job: QueuedJob, result: unknown): Promise<void> {
  job.status = "completed";
  job.completedAt = Date.now();
  job.result = result;
  running.delete(job.id);

  // Commit credit hold
  if (job.holdTicket) {
    try {
      await commitTicket(job.holdTicket, {
        apiCallType: job.action,
      });
    } catch (err) {
      routerLog.error(`[GenQueue] Failed to commit hold for job ${job.id}:`, { error: String(err) });
      // Don't fail the job over commit failure — the generation succeeded
    }
  }

  const durationMs = job.completedAt - (job.startedAt || job.queuedAt);
  routerLog.info(`[GenQueue] Job ${job.id} completed in ${durationMs}ms`);

  job.resolve(result);

  // Process next in queue
  processQueue();
}

async function handleJobFailure(job: QueuedJob, error: Error): Promise<void> {
  job.status = "failed";
  job.completedAt = Date.now();
  job.error = error.message;
  running.delete(job.id);

  // Auto-refund: release credit hold on failure
  if (job.holdTicket) {
    try {
      await releaseTicket(job.holdTicket, `Generation failed: ${error.message}`);
      job.status = "refunded";
      routerLog.info(`[GenQueue] Auto-refund: released ${job.holdTicket.creditsHeld} credits for failed job ${job.id}`);
    } catch (refundErr) {
      routerLog.error(`[GenQueue] CRITICAL: Failed to release hold for failed job ${job.id}:`, { error: String(refundErr) });
      // Log for manual reconciliation
    }
  }

  const durationMs = job.completedAt - (job.startedAt || job.queuedAt);
  routerLog.error(`[GenQueue] Job ${job.id} failed after ${durationMs}ms: ${error.message}`);

  job.reject(error);

  // Process next in queue
  processQueue();
}

// ─── Metrics (for admin dashboard) ──────────────────────────────────────

export function getQueueMetrics(): {
  running: number;
  queued: number;
  config: QueueConfig;
  jobsByAction: Record<string, number>;
} {
  const jobsByAction: Record<string, number> = {};
  for (const job of [...Array.from(running.values()), ...queue]) {
    jobsByAction[job.action] = (jobsByAction[job.action] || 0) + 1;
  }
  return {
    running: running.size,
    queued: queue.length,
    config,
    jobsByAction,
  };
}

// ─── Exported for Testing ───────────────────────────────────────────────

export { queue as _queue, running as _running };
