/**
 * Provider Router — Package barrel export
 * Prompt 16: Multi-Provider API Router & Generation Abstraction Layer
 */

// Core types
export * from "./types";

// Registry
export {
  registerAdapter,
  getAdapter,
  listAdapters,
  hasAdapter,
  getProviderInfo,
  listProviders,
  getProvidersByModality,
  getProviderHealth,
  getActiveApiKey,
  encryptApiKey,
  decryptApiKey,
} from "./registry";

// Router
export { selectProviders, type RoutingDecision } from "./router";

// Executor
export { generate } from "./executor";

// Cost Estimator
export { estimateCost, estimateCostMultiple, estimateBatchCost } from "./cost-estimator";

// Credit-Integrated Executor (main public API)
export {
  generateWithCredits,
  checkAffordability,
  mapToAction,
  type CreditGenerateResult,
} from "./credit-executor";

// Circuit Breaker
export {
  isCircuitAllowing,
  reportSuccess,
  reportFailure,
  getCircuitState,
  resetCircuit,
} from "./circuit-breaker";

// Rate Limiter
export {
  checkRateLimit,
  recordRequest,
  getRateLimitStatus,
  cleanupRateLimitWindows,
} from "./rate-limiter";

// Health Monitor
export {
  updateProviderMetrics,
  refreshSpend24h,
  refreshCreatorMix7d,
  runHealthCheck,
  getRecentEvents,
} from "./health-monitor";

// Local Infrastructure (Prompt 19)
export * from "./local-infra";

// Adapters (self-registering on import)
import "./adapters/kling-21";
import "./adapters/kling-variants";
import "./adapters/runway-gen4";
import "./adapters/video-providers";
import "./adapters/voice-providers";
import "./adapters/music-providers";
import "./adapters/image-providers";
import "./adapters/local-providers";
import "./adapters/fal-kling";
import "./adapters/premium-video-models";
