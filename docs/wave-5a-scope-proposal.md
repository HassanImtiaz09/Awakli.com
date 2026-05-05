# Wave 5A Scope Proposal — Manga Finishing + Lulu Print

**Date:** 2026-05-05  
**Prerequisite:** Wave 4 checkpoint `58c837bb` (all items verified)  
**Rationale:** Ships the closed-loop print product. Lulu without Manga Finishing prints crude unfinished ekonte (worse demo than no print). Bundling ensures audit blocker B2 closes with actual printable quality output.

---

## Overview

Wave 5A delivers two tightly coupled capabilities that together form the **third product leg** (alongside anime video and manga-to-anime conversion):

1. **D10.M Manga Finishing Agent** — Transforms raw ekonte panels into print-ready manga pages with screentone application, dialogue bubble rendering, page composition, and PDF generation.

2. **Lulu Print Integration** — Connects the finished PDF to Lulu's print-on-demand network with Stripe-powered checkout, webhook-driven order tracking, and revenue split via Stripe Connect destination charges.

---

## Item 1: D10.M Manga Finishing Agent (Stage 5.5 Branch)

The Manga Finishing agent operates as a branch stage (already defined in `server/hitl/stage-config.ts` at line 81) triggered when a user selects "publish as manga" after ekonte approval.

### Sub-Tasks

| # | Task | Description | Effort |
|---|------|-------------|--------|
| 1a | Screentone Application | Programmatic halftone engine with deterministic per-genre patterns (ami-ten, kake-ami, suna-me, gradation). Mood→pattern mapping via lookup table. Canvas-based rendering for inter-panel consistency. AI screentone as Pro+ upsell option. | 2 days |
| 1b | Dialogue Bubble Renderer | Takes existing `panel.dialogue` JSON and renders typeset bubbles. Bubble types: speech (oval), thought (cloud), narration (box), SFX (angular). Font selection by genre (Shōnen=bold, Shōjo=rounded, Seinen=clean). Outputs composite PNG per panel. | 2 days |
| 1c | Page Compositor | Arranges panels into manga page layouts. Layout templates: 4-panel grid, 6-panel asymmetric, splash page, double-spread. Respects reading direction (RTL for Japanese, LTR for English). Adds gutters, bleed marks, crop marks. | 2 days |
| 1d | PDF Generator | Assembles composed pages into print-ready PDF. Handles: trim size (B5/A5/tankōbon), bleed (3mm), color profile (CMYK for print, RGB for digital), page numbering, chapter breaks. Outputs interior PDF + cover PDF (from title card). | 2 days |
| 1e | D10.M Pipeline Integration | Wire into orchestrator as branch stage 5.5. Trigger condition: user selects "publish as manga". Input: approved ekonte panels. Output: print-ready PDF stored in S3. HITL gate: blocking (user must approve final PDF before Lulu submission). | 1 day |
| 1f | Integration Tests | Test each sub-module + end-to-end flow. Mock image generation, verify PDF structure, validate Lulu file requirements (min 2 pages, same sizes, fonts embedded). | 1 day |

**Total Item 1: 10 days**

---

## Item 2: Lulu Print Integration

### Sub-Tasks

| # | Task | Description | Effort |
|---|------|-------------|--------|
| 2a | Lulu API Client | OAuth 2.0 client_credentials token management, file validation endpoints, cost calculation, print-job creation, status polling. Sandbox + production support. | 2 days |
| 2b | Print Order Schema | `print_orders` table: userId, projectId, episodeId, luluPrintJobId, stripePaymentIntentId, status, podPackageId, shippingAddress, trackingUrl, costBreakdown (JSON). Migration 0058. | 1 day |
| 2c | Stripe Checkout for Print + Manual Payout Workflow | Create checkout session with print cost (Lulu manufacturing + shipping + Awakli markup + creator split). Uses existing Stripe integration. DB-tracked revenue + admin view of owed balances + manual Stripe transfer instructions doc. | 2 days |
| 2d | Lulu Webhook Handler | `/api/lulu/webhook` endpoint. HMAC-SHA256 verification. Updates `print_orders` status on `PRINT_JOB_STATUS_CHANGED`. Notifies user via existing notification system on SHIPPED/DELIVERED/REJECTED. | 1 day |
| 2e | Print Order UI | "Order Print" button on approved manga episodes. Shows: cost estimate, trim size selector, shipping address form, checkout flow. Order history page with status tracking. | 2 days |
| 2f | Integration Tests | Mock Lulu API responses, verify order lifecycle (create → paid → production → shipped), webhook HMAC validation, Stripe checkout session creation. | 1 day |

**Total Item 2: 9 days**

---

## Item 3: End-to-End Smoke Test

| # | Task | Description | Effort |
|---|------|-------------|--------|
| 3a | E2E Flow Test | Full pipeline: ekonte panels → manga finishing → PDF generation → Lulu file validation → cost calculation → checkout → print-job creation. Uses Lulu sandbox. | 1 day |

**Total Item 3: 1 day**

---

## Summary

| Item | Description | Effort |
|------|-------------|--------|
| 1 | D10.M Manga Finishing Agent | 10 days |
| 2 | Lulu Print Integration | 9 days |
| 3 | E2E Smoke Test | 1 day |
| **Total** | | **20 days** |

---

## Dependencies & Secrets Required

| Secret | Purpose |
|--------|---------|
| `LULU_CLIENT_KEY` | Lulu API authentication (client_credentials) |
| `LULU_CLIENT_SECRET` | Lulu API authentication |
| `LULU_SANDBOX_CLIENT_KEY` | Lulu sandbox for testing |
| `LULU_SANDBOX_CLIENT_SECRET` | Lulu sandbox for testing |

Stripe Connect onboarding for creators (connected accounts) is deferred to Wave 5B. Wave 5A uses a placeholder split where Awakli collects full payment and tracks owed creator revenue in the database.

---

## Architectural Decisions

1. **PDF generation server-side only** — Uses `pdf-lib` or `@react-pdf/renderer` on the server. No client-side PDF generation (too slow, too large).

2. **Screentone via programmatic halftone** — Deterministic per-genre patterns (ami-ten, kake-ami, suna-me, gradation) using canvas-based rendering. AI screentone available as Pro+ tier upsell only.

3. **Reading direction configurable** — RTL (Japanese) and LTR (Western) supported from day one. Stored per-project.

4. **Revenue split semi-deferred** — Wave 5A tracks revenue owed to creators + ships manual payout workflow (admin view of balances, manual Stripe transfer instructions). Wave 5B adds automated Stripe Connect payouts within 4-6 weeks.

5. **Lulu sandbox first** — All development against Lulu sandbox. Production keys added when user claims their Lulu account.

---

## Confirmations Received

1. **Pod Package ID**: Default B5 perfect-bound, expose trim size selector (B5/A5/tankōbon/US trade paperback) from day one.

2. **Screentone approach**: Programmatic halftone (canvas/PIL-based with deterministic per-genre patterns: ami-ten, kake-ami, suna-me, gradation). AI screentone kept as Pro+ tier upsell only. Rationale: cost (~500 gen calls/volume = $20-30+), inter-panel consistency, and authenticity (manga screentone is historically programmatic — a printing artifact).

3. **Revenue tracking**: DB tracking + documented manual payout workflow (admin view of owed balances, manual Stripe transfer instructions) so Founders' Studio creators can be paid during the gap. Wave 5B commits to closing automated payouts within 4-6 weeks.

4. **Lulu credentials**: User creating sandbox account this week. Will provide credentials before Item 2a starts. Building against real sandbox, not mocks.

5. **Cover generation**: Auto-from-title-card as MVP for 5A. Dedicated cover design step (title typography + chapter info + author attribution + ekonte-aware composition) explicitly committed to Wave 5B.
