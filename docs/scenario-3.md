# Scenario 3: Add-on Purchase with Discount Interaction

## Goal
Implement logic for a clinic purchasing an add-on (e.g., Extra Storage). Ensure that discount codes are correctly verified against their permitted target (base plan vs add-on type) using robust server-side enforcement. Expiry and usage limits must be checked.

## Implementation Details

### 1. Reusable Discount Verification (`src/types/discount.ts`)
The `calculateDiscountedPrice` function was implemented to check if `isDiscountValid(discount)` and then branch logic depending on whether the `itemType` is a `'base'` plan or a specific add-on. If the type passes the structural rules (either `appliesToAddons` is `'all'` or contains the addon), it returns the mathematically calculated discounted price.

### 2. Secure Addon Checkout (`functions/src/stripe/checkout.ts`)
The `purchaseAddon` HTTPS Cloud Function was heavily scaffolded to prevent unauthorized exploitation:
- **Server Lookup:** Never trusting the client, the function queries the Firestore `discounts` collection to fetch the real rules for the provided `discountCode`.
- **Validation:** Checks if `validUntil` has expired or `usedCount` exceeds `usageLimit`.
- **Type Guarding (Scenario 3 Focus):** Specifically validates the `appliesToAddons` logic to ensure that a code like `WELCOME20` (which is `appliesToBase: true, appliesToAddons: []`) is rejected with a clear "Discount code does not apply to this add-on" error.
- **Stripe Integration:** Once validated, it syncs the coupon with Stripe (creating it statically if not found via `stripe.coupons.create`) and updates the Stripe Subscription Items list to explicitly attach the `stripeCouponId` to the newly purchased add-on item.
- **Atomic Increment:** Resolves the usage synchronously by incrementing `usedCount` dynamically in Firestore utilizing `admin.firestore.FieldValue.increment(1)`.
