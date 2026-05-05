# Wave 5C Architecture Documentation

## Overview

Wave 5C delivers production-hardening infrastructure across five areas: Per-Character LoRA Training, Image Upscaling for Print DPI, Security Audit, Observability, and Stripe Reconciliation.

---

## 1. Per-Character LoRA Training (Admin Gate Pattern)

### Flow

```
User requests trainLora
  → Estimate cost (GPU profile × steps × margin)
  → Insert job with status: pending_admin_approval
  → Admin reviews in dashboard (adminListPendingCharacterLora)
  → Admin approves → status: queued → provider.submitTraining()
  → Provider callback → status: completed (or failed)
  
  OR
  
  → Admin rejects → status: rejected (with reason)
```

### Key Files

| File | Purpose |
|------|---------|
| `server/routers-character-library.ts` | trainLora, batchTrain, adminApprove/Reject procedures |
| `server/benchmarks/sakufuu/lora-training.ts` | TrainingProvider interface, runTrainingPipeline |
| `server/character-lora-admin-gate.test.ts` | 28 tests for admin gate logic |

### Cost Estimation

```typescript
estimateTrainingJob(steps, gpuProfile) → {
  baseMinutes, costPerMinute, baseCostUsd,
  withMargin: { marginMultiplier, costUsd, costCents }
}
```

GPU Profiles: `a100_40gb` ($0.80/min), `a100_80gb` ($1.20/min), `h100` ($2.00/min)

---

## 2. Image Upscaling for Print DPI

### Architecture

```
Panel source image
  → analyzePanelDpi(panelId, width, height, printSize, panelFraction)
  → effectiveDpi, meetsPrintDpi, recommendedUpscaleFactor
  
If flagged:
  → autoFlagPanelsForUpscale() → action: upscale_2x | upscale_4x | regenerate
  → Admin triggers upscale via adminTriggerUpscale procedure
  → UpscaleProvider.upscale(imageUrl, scaleFactor, model)
  → Quality scoring (estimateUpscaleQuality)
```

### Key Files

| File | Purpose |
|------|---------|
| `server/upscale-pipeline.ts` | UpscaleProvider interface, RealESRGANProvider, DPI analysis |
| `server/routers-print.ts` | adminDpiCoverage, adminTriggerUpscale procedures |
| `server/upscale-pipeline.test.ts` | 47 tests |

### DPI Thresholds

| Metric | Value |
|--------|-------|
| Print DPI target | 300 |
| Minimum viable DPI | 75 |
| Below 75 DPI | Regenerate (upscaling won't help) |
| 75–150 DPI | Upscale 4x |
| 150–300 DPI | Upscale 2x |
| ≥300 DPI | Compliant |

### Print Sizes Supported

- **B5** (6.93" × 9.84") — Standard manga tankōbon
- **A5** (5.83" × 8.27") — Compact manga
- **US Letter** (8.5" × 11") — Western comics

---

## 3. Security Audit

### Rate Limiting (Token Bucket)

| Route Category | Max Tokens | Refill Rate | Window |
|---------------|-----------|-------------|--------|
| Auth endpoints | 20 | 0.067/sec | 5 min |
| Generation | 30 | 0.0083/sec | 1 hour |
| Character Bible | 10 | 0.0028/sec | 1 hour |
| Default | 300 | 5/sec | 1 min |

### RBAC Model

```
publicProcedure   → No auth required (read-only, analytics, quick-create)
protectedProcedure → Requires valid session (user operations)
adminProcedure    → Requires role === "admin" (admin operations)
creatorProcedure  → Requires tier >= "creator" (tier-gated)
studioProcedure   → Requires tier >= "studio" (tier-gated)
```

### Key Files

| File | Purpose |
|------|---------|
| `server/_core/rate-limit.ts` | Token bucket rate limiter |
| `server/security-audit.test.ts` | 25 security validation tests |

---

## 4. Observability

### Structured Logging

All logs are JSON lines with consistent fields:
```json
{
  "timestamp": "2026-05-05T05:00:00.000Z",
  "level": "info",
  "msg": "request",
  "module": "http",
  "method": "GET",
  "path": "/api/trpc/auth.me",
  "status": 200,
  "durationMs": 12
}
```

### Cost Tracker

Real-time cost tracking with budget alerting:

| Threshold | Limit | Window | Action |
|-----------|-------|--------|--------|
| Hourly cost spike | $50 | 1 hour | Notify owner |
| Daily cost limit | $500 | 24 hours | Notify owner |
| Single operation | $25 | Per-event | Log |
| User daily limit | $100 | 24 hours | Block |

### Error Rate Alerting

- Tracks errors by type with 1-minute sliding window
- Alerts when error rate exceeds configurable threshold (default: 10/min)
- Anomaly detection: cost spikes (3x+ hourly average), provider concentration (>90%)

### Key Files

| File | Purpose |
|------|---------|
| `server/observability/logger.ts` | Logger class, pre-configured loggers |
| `server/observability/index.ts` | Request timing, health endpoint, metrics |
| `server/observability/cost-tracker.ts` | CostTracker, ErrorRateTracker, anomaly detection |
| `server/observability/cost-tracker.test.ts` | 22 tests |

---

## 5. Stripe Reconciliation

### Webhook Idempotency

```
Event received
  → Verify signature (stripe.webhooks.constructEvent)
  → Handle test events (evt_test_* → return {verified: true})
  → Check idempotency (isEventProcessed via stripeEventsLog table)
  → Process event
  → Log event (logEvent with ER_DUP_ENTRY safety)
  → Respond 200
```

### Handled Events

| Event | Action |
|-------|--------|
| checkout.session.completed | Create/activate subscription |
| customer.subscription.updated | Sync tier changes |
| customer.subscription.deleted | Cancel + downgrade to free |
| invoice.payment_succeeded | Grant monthly credits |
| invoice.payment_failed | Set status: past_due |
| payment_intent.succeeded | Fulfill credit pack |
| payment_intent.payment_failed | Mark pack: failed |
| charge.dispute.created | Freeze account + revoke credits |
| charge.refunded | Proportional credit reversal |

### Balance Reconciliation

```typescript
reconcileBalance(userId) → {
  isConsistent: boolean,      // materialized == ledger
  materializedBalance: number,
  ledgerBalance: number,
  discrepancy: number,
  staleHolds: number          // Holds > 1 hour without commit/release
}
```

### Key Files

| File | Purpose |
|------|---------|
| `server/stripe/webhook.ts` | Main webhook handler |
| `server/credit-ledger.ts` | reconcileBalance, releaseStaleHolds |
| `server/stripe-reconciliation.test.ts` | 31 tests |

---

## 6. Pipeline Smoke Test (B3)

### Validation Coverage

- All 17 stages defined and sequentially numbered
- Stage transitions follow valid state machine rules
- Credit estimates non-zero for billable stages
- Critical stages (script, video_generation) non-skippable
- Error recovery paths exist (retry via regenerating → executing)
- Pipeline covers pre-production, production, and post-production phases

### Key Files

| File | Purpose |
|------|---------|
| `server/audit-b3-smoke.test.ts` | 30 structural validation tests |
| `server/hitl/stage-config.ts` | Stage definitions, credit estimates |
| `server/hitl/pipeline-state-machine.ts` | State machine implementation |

---

## Test Summary

| Module | Tests | Status |
|--------|-------|--------|
| Character LoRA Admin Gate | 28 | ✅ Passing |
| Upscale Pipeline | 47 | ✅ Passing |
| Security Audit | 25 | ✅ Passing |
| Cost Tracker & Error Alerting | 22 | ✅ Passing |
| Stripe Reconciliation | 31 | ✅ Passing |
| B3 Smoke Test | 30 | ✅ Passing |
| **Total Wave 5C** | **183** | **✅ All Passing** |
