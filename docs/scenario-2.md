# Scenario 2: Downgrade with Seat Conflict

## Goal
Handle a subscription downgrade where the clinic's current seat usage exceeds the target plan's limit (e.g., Premium with 10 used seats downgrading to Pro with a 5-seat limit). Document the decision of whether to queue the downgrade to the end of the billing period or block it immediately until resolved. Implement robust Firestore rules to strictly guarantee seat limits.

## Implementation Details

### 1. Decision Documented
Decided to use an **Immediate Block** strategy for conflict downgrades. This strategy ensures data consistency across the Stripe backend and our Firestore database, forcing users to actively select which staff members lose access rather than relying on automated evictions. Documented inside `DECISIONS.md`.

### 2. Upgrading `initiateDowngrade` in `checkout.ts` 
The function performs synchronous checks:
- It gets the clinic's current properties (`activeSeats`).
- Compares it to the `targetConfig.seats` based on the requested target plan.
- If there's a conflict (`activeSeats > targetConfig.seats`), it safely returns the immediate mismatch payload `{ strategy: 'immediate', conflictingSeats: overflow }` rendering the conflict in the UI without modifying Stripe.
- If no conflict exists, it smoothly issues the backend update API call: `subscriptions.update` configuring `proration_behavior` optionally as `always_invoice` directly triggering the webhook updates. 
(Also updated the client-side stub in `src/services/stripe.ts` to call the HTTPS Cloud Function appropriately).

### 3. Firestore Rules (`firestore.rules`)
Firestore Security Rules were tightly coupled to check `getAfter(...)` across the `clinics` document whenever a seat member undergoes a `create` or a positive `update` (active: true). This elegantly ensures that batch writes adding concurrent users are statically analyzed and definitively blocked by the database layer if the final resultant payload exceeds `clincs.seats.max` inside the transaction. Deletions and deactivations naturally bypass this lock to resolve existing conflicts.
