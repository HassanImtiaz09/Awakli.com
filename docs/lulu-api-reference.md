# Lulu Print API — Key Integration Points

## Authentication
- OAuth 2.0 client_credentials flow
- POST `https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token`
- Sandbox: `https://api.sandbox.lulu.com/`
- Production: `https://api.lulu.com/`
- Requires: `LULU_CLIENT_KEY` + `LULU_CLIENT_SECRET`

## Core Flow
1. **Select Product** → `pod_package_id` (e.g., `0850X1100.FC.STD.PB.080CW444.GXX`)
2. **Upload Interior PDF** → validate via `/print-job-file-validation/`
3. **Upload Cover PDF** → validate via `/print-job-cover-file-validation/`
4. **Cost Calculation** → `POST /print-job-cost-calculations/`
5. **Create Print-Job** → `POST /print-jobs/`
6. **Monitor Status** → webhook `PRINT_JOB_STATUS_CHANGED`

## Print-Job Statuses
CREATED → UNPAID → PAYMENT_IN_PROGRESS → PRODUCTION_DELAYED → PRODUCTION_READY → IN_PRODUCTION → SHIPPED → DELIVERED

## Manga-Specific POD Package IDs
- **Manga (B5 trim, full color, perfect bound):** `0700X1000.FC.STD.PB.080CW444.GXX`
- **Manga (A5 trim, B&W, perfect bound):** `0600X0900.BW.STD.PB.060UW444.MXX`
- **Tankōbon (standard manga size):** `0500X0700.FC.STD.PB.080CW444.MXX`

## Webhook
- Topic: `PRINT_JOB_STATUS_CHANGED`
- HMAC verification via `Lulu-HMAC-SHA256` header (SHA-256, key = API secret)
- Retries: 5 attempts, then deactivates

## File Requirements
- Interior: PDF, min 2 pages, same page sizes, fonts embedded
- Cover: PDF, dimensions from `/print-jobs/cover-dimensions/` endpoint
- Files must be publicly accessible URLs

## Revenue Split (via Stripe Connect)
- Lulu charges printing + shipping cost
- Awakli marks up price → customer pays via Stripe
- Awakli keeps markup minus platform fee
- Creator gets their split (80/85/90% per tier)
- Implementation: Stripe Connect destination charges with `transfer_data`
