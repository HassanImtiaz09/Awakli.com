# Manual Payout Workflow — Wave 5A Interim

## Overview

Until Stripe Connect onboarding ships (Wave 5B, ~4-6 weeks), creator royalties are tracked in the database and paid out manually by an admin via Stripe Dashboard transfers.

## How It Works

1. **Customer purchases a print** → Stripe checkout completes → `print_orders.creator_royalty_cents` is calculated
2. **Payout record created** → `creator_payouts` row with status `pending` and the calculated royalty amount
3. **Admin reviews** → Admin Dashboard → Print Payouts tab shows all pending payouts grouped by creator
4. **Admin approves** → Bulk-select payouts → "Approve Selected" → status moves to `approved`
5. **Admin pays** → Go to Stripe Dashboard → Transfers → Create manual transfer to creator's bank → Enter transfer ID back in admin panel → status moves to `paid`

## Admin Panel Location

`/admin/print-payouts` — accessible to admin-role users only.

### Views Available

| View | Description |
|------|-------------|
| **Summary** | Per-creator aggregated balances (pending + paid totals) |
| **Pending** | Individual payout records awaiting approval |
| **Approved** | Records approved but not yet transferred |
| **History** | All paid records with Stripe transfer IDs |

## Step-by-Step: Processing a Payout

### 1. Review Pending Payouts

Navigate to Admin → Print Payouts. The "Pending" tab shows:
- Creator name and email
- Amount owed (from individual print order royalties)
- Related print order ID
- Date created

### 2. Approve Payouts

Select one or more pending payouts for the same creator. Click "Approve Selected." This:
- Changes status from `pending` → `approved`
- Records the admin who approved
- Timestamps the approval

### 3. Execute Stripe Transfer

1. Open [Stripe Dashboard → Transfers](https://dashboard.stripe.com/test/transfers)
2. Click "Create Transfer"
3. Enter the total amount for the creator (sum of approved payouts)
4. Enter the creator's bank account or Stripe account (coordinate with creator via email)
5. Add description: `Awakli Print Royalty - [Creator Name] - [Date]`
6. Complete the transfer
7. Copy the transfer ID (starts with `tr_`)

### 4. Record Payment in Admin Panel

Back in the admin panel:
1. Select the approved payouts that were just transferred
2. Click "Mark as Paid"
3. Paste the Stripe transfer ID
4. Optionally add admin notes
5. Confirm

This moves status from `approved` → `paid` and records the transfer ID for audit.

## Revenue Split

| Component | Percentage | Description |
|-----------|-----------|-------------|
| Lulu printing cost | ~65% | Paid directly to Lulu via their API |
| Platform margin | 20% of revenue | Awakli's cut |
| Creator royalty | 15% of revenue | Paid to project creator |

"Revenue" = customer price minus Lulu printing cost.

## Minimum Payout Threshold

- Minimum payout: **$10.00 USD**
- Payouts below threshold accumulate until they reach $10
- Admin should batch payouts monthly or when threshold is met

## Creator Communication

When processing payouts, send creators a notification:
- Use the built-in `notifyOwner` for the platform owner
- For other creators: email notification (manual for now, automated in Wave 5B)

## Transition to Stripe Connect (Wave 5B)

When Stripe Connect ships:
1. Creators onboard via Stripe Connect Express
2. `transfer_data` on checkout sessions auto-splits payments
3. Manual workflow becomes fallback for creators who haven't onboarded
4. All historical `creator_payouts` records remain for audit

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| Creator disputes amount | Check `print_orders.creator_royalty_cents` calculation against product config |
| Transfer fails | Verify creator's bank details, retry, or contact Stripe support |
| Payout stuck in "approved" | Admin forgot to complete Stripe transfer — check Dashboard |
| Duplicate payout | Check `stripe_transfer_id` — each transfer should be unique per batch |
