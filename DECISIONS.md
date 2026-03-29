# Architecture Decisions

## Scenario 2: Downgrade Strategy
**Decision:** Immediate Block

**Rationale:**
When a clinic with 10 active staff on a Premium plan (15 seats) attempts to downgrade to a Pro plan (5 seats), I decided to **block the downgrade immediately** until the clinic owner manually deactivates 5 staff members. 

While queueing the downgrade for the end of the billing period might offer a slightly smoother initial UX, the "immediate block" strategy is far more transparent to the clinic owner. It forces them to make active decisions about which staff members lose access, rather than leaving those staff members in limbo or relying on an automated, potentially randomized revocation at the end of the cycle. 

Additionally, queueing a downgrade natively in Stripe without immediate proration requires creating `SubscriptionSchedules`, which introduces significant complexity and potential drift between Firestore state and Stripe state. The immediate block strategy ensures that Firestore and Stripe are always perfectly synchronized regarding the current capacity and plan.

**Implementation Details:**
- The `initiateDowngrade` Cloud Function checks the current `used` seats against the `targetPlan` max seats.
- If `used > limit`, it returns `{ strategy: 'immediate', conflictingSeats: used - limit }` without alerting Stripe.
- If there's no conflict, it immediately calls `stripe.subscriptions.update` to change the price item to the lower plan, allowing Stripe to naturally prorate the account as a credit.
- Firestore Security Rules use `getAfter` to strictly guarantee that no batch-write can ever exceed `clinics.seats.max` regardless of UI state, and ensures that the subscription is `'active'`.

## Scenario 5: Expired Discount Behavior
**Decision:** Strip on Next Invoice

**Rationale:**
When an existing subscriber has an active discount and the discount expires, I decided to immediately sever the discount on their next billing cycle rather than honoring it indefinitely. To do this effortlessly natively in Stripe, when creating the Stripe coupon dynamically in `checkout.ts`, I explicitly set `duration: "once"` instead of `duration: "forever"`. This natively offloads the expiry functionality to Stripe, ensuring that an applied discount (whether applied to the base plan or an add-on) naturally falls off after the initial purchase / current billing invoice is generated exactly mimicking "strip on next invoice".

## Scenario 6: Session Invalidation on Role Change
**Decision:** Option A (`admin.auth().revokeRefreshTokens(uid)`)

**Rationale & Trade-offs:**
I actively chose **Option A** (`revokeRefreshTokens`) combined with immediately turning `active: false` on their Firestore seat document + unlinking their `clinicId` in `users` collection. 
This guarantees they dynamically drop access upon the short-lived ID token's expiration logic without taxing the Firestore database with intense global read cascades. 

*Trade-offs analysis:*
- **Option B (Firestore rule check):** Extremely fast (zero latency block), but creates a massive cascading read burden on literally every single query they make across the app. This drastically inflates Firestore billing and complicates standard `allow read` policies.
- **Option C (Custom claims disabled flag):** Needs manual re-authentication by the client to pick up the token payload changes, resulting in roughly identical propagation latency to Option A, but with extra boilerplate fetching and decoding tokens. 
- **Option A (Chosen):** Severely punishes the user session completely terminating their authentication refresh cycle seamlessly natively. It trades a potential ~1 hour token life for incredible database cost efficiency and absolute, un-hackable global logout enforcement.
