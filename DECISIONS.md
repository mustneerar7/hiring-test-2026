# Architecture & Implementation Decisions (AI-Optimized)

> [!NOTE]  
> This document summarizes the technical decisions made for the clinic billing system. It is structured to provide clear "Decision/Rationale" pairs for both developers and AI agents.

---

## Global Infrastructure

### G-01: Dynamic Price & Product Resolution
- **Decision:** Automated product/price creation on-the-fly in `checkout.ts`.
- **Rationale:** Minimizes manual Stripe Dashboard configuration. The system searches for existing products via `metadata['key']`. If not found, it creates them (e.g., plans or add-ons). This ensures the codebase is portable and works immediately on new Stripe accounts without pre-configured products.
- **Implementation:** `getOrCreatePriceId(planOrAddon: string)` in `functions/src/stripe/checkout.ts`.

### G-02: Webhook Synchronization Strategy
- **Decision:** Webhook-only updates for subscription state.
- **Rationale:** Prevents race conditions and ensures Stripe remains the "Source of Truth". Firestore `subscriptions` and `clinics` documents are updated *only* upon receiving verified `customer.subscription.updated` or `checkout.session.completed` events. This ensures UI-level consistency and handles edge cases where payment methods might fail asynchronously.
- **Implementation:** `handleStripeWebhook` in `functions/src/stripe/webhook.ts`.

### G-03: Webhook Search & Recovery
- **Decision:** Multi-identifier fallback search.
- **Rationale:** Robustly links Stripe events to Firestore clinic documents by searching for `stripeSubscriptionId` first, then falling back to `stripeCustomerId`. This handles scenarios where specific Stripe events might lack metadata but contain customer references.
- **Implementation:** `findSubscriptionDoc` in `functions/src/stripe/webhook.ts`.

---

## Scenario Decisions

### Scenario 1: Pro-rata Mid-cycle Upgrade
- **Decision:** Immediate Upgrade with Stripe Proration.
- **Rationale:** When a user upgrades (e.g., Free → Pro), the system calls `stripe.subscriptions.update` with `proration_behavior: "always_invoice"`. This immediately unlocks new seats for the clinic while Stripe handles the proration logic, charging the difference on the next invoice or creating a pending credit.
- **Implementation:** `createCheckoutSession` (direct upgrade path) in `checkout.ts`.

### Scenario 2: Downgrade Strategy (Seat Conflict)
- **Decision:** Immediate Block (Enforced by Cloud Function + Security Rules).
- **Rationale:** Blocking downgrades if `usedSeats > targetSeats` prevents the system from having to "guess" which staff members to deactivate. The owner must manually resolve the conflict.
- **Implementation:** 
  - **Logic:** `initiateDowngrade` checks `activeSeats > targetConfig.seats` before calling Stripe.
  - **Hard Enforcement:** `firestore.rules` uses `getAfter` on the `clinics` document to ensure `seats.used <= seats.max` on any write to the `seats` collection.

### Scenario 3: Granular Add-on Discounts
- **Decision:** `appliesToAddons` Metadata Validation.
- **Rationale:** Prevents unauthorized application of base-plan discounts to expensive add-ons. The `purchaseAddon` function validates the discount's compatibility with the specific `addonType`.
- **Implementation:** `purchaseAddon` in `checkout.ts` checks `discountData.appliesToAddons` (can be "all" or an array of specific IDs).

### Scenario 4: Payment Failure & Grace Period
- **Decision:** 7-Day "Read-Only" Grace Period + Automatic "Revert to Free" on Cancellation.
- **Rationale:** Balances user experience with revenue protection.
  - **Grace Period (7 days):** `invoice.payment_failed` sets `status: "grace_period"`. Rules allow reading/modifying existing appointments but block creating NEW staff seats (checks `status == 'active'`).
  - **Revert:** On sub-deletion, the system deactivates all staff members *except* the owner and sets `seats.max` to 1.
- **Implementation:** `handlePaymentFailed` and `handleSubscriptionDeleted` in `webhook.ts`.

### Scenario 5: Expired Discount Behavior
- **Decision:** Strip on Next Invoice (`duration: "once"`).
- **Rationale:** Honors the discount for the initial billing cycle but natively offloads the expiry to Stripe. By setting `duration: "once"` on the Stripe Coupon, the discount naturally falls off in the next billing cycle without requiring a scheduled cron job or listener.
- **Implementation:** Coupon creation logic in `checkout.ts`.

### Scenario 6: Role Change & Session Invalidation
- **Decision:** Option A (`admin.auth().revokeRefreshTokens(uid)`).
- **Rationale:** Revokes the user's ability to get new ID tokens immediately. While existing tokens might last for ~1 hour, the user is globally blocked from refreshing access. This avoids the high Firestore read costs associated with checking the `active` flag on every single security rule evaluation (Option B).
- **Implementation:** `removeStaffMember` calls `admin.auth().revokeRefreshTokens(userId)`.

---

## Security Schema

### Clinic Access
- **Decision:** `belongsToClinic(clinicId)` helper in Firestore.
- **Rationale:** Every document (appointments, seats, invoices) must be scoped to a `clinicId`. The user's own document in `/users/{uid}` serves as the anchor for the `clinicId` claim, which is verified on every request.

### Seat Limit Enforcement
- **Crucial Rule:**
```javascript
// firestore.rules
getAfter(/databases/$(database)/documents/clinics/$(clinicId)).data.seats.used <= 
getAfter(/databases/$(database)/documents/clinics/$(clinicId)).data.seats.max
```
- **Rationale:** Uses atomic transaction snapshots to ensure that no matter how many parallel writes occur, the resulting state of the clinic can never exceed its purchased capacity.
