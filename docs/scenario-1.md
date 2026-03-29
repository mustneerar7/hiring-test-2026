# Scenario 1: Plan Upgrade Mid-Cycle

## Goal
Support users upgrading from a Free plan to a Pro plan, or Pro to Premium mid-cycle. Stripe handles the proration, while our Firebase backend must correctly apply these changes to the Firestore database *only* after proper webhook confirmation. The new seat limit must be available immediately after the webhook processes.

## Implementation Details

### 1. Modifying `createCheckoutSession` in `functions/src/stripe/checkout.ts`
The original stub attempted to pass a `subscription` parameter directly into `stripe.checkout.sessions.create` for existing subscriptions, which is invalid. The checkout logic was rewritten:
- **No Active Stripe Subscription (e.g. Free -> Pro)**: Calls `checkout.sessions.create(mode: "subscription")` to collect payment details and create a new subscription.
- **Active Subscription Exists (e.g. Pro -> Premium)**: Bypasses checkout sessions entirely and directly modifies the subscription via `stripe.subscriptions.update(id)` using `proration_behavior: "create_prorations"`. It then returns a localized deep link back to the app (`clinicapp://billing?success=true`) to acknowledge the successful mid-cycle upgrade directly.

### 2. Discount Code Validation
To ensure full compliance with Scenario 1 & Scenario 5 instructions:
- Server-side validation was implemented in `createCheckoutSession` to check `validUntil` expiry date, `usedCount` versus `usageLimit`, and verify that the `appliesToBase` property is truly `true`.
- The `stripeCouponId` is either retrieved or dynamically created via `stripe.coupons.create` directly mapping to the Firestore discount code so that Stripe correctly calculates the initial and subsequent discounts.
- `usedCount` is incremented dynamically in Firestore immediately on success.

### 3. Webhook Handling
No changes were needed for the webhook.
The provided `handleCheckoutCompleted` and `handleSubscriptionUpdated` accurately update `clinics/{clinicId}` setting `"seats.max"` correctly leveraging dot-notation. This flawlessly guarantees the prompt's requirement: "New seat limit available immediately after webhook processes."
