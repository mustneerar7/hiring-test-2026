# Scenario 5: Expired Discount Code

## Goal
Implement robust logic to decline expired discount codes during the purchase checkout securely server-side. Document a decision regarding how expired discounts apply to existing subscribed users, ensuring the UI natively leverages these calculations.

## Implementation Details

### 1. New Subscribers (Validations)
As introduced and secured during Scenario 1 and 3, any caller hitting `createCheckoutSession` or `purchaseAddon` submits their potential `discountCode`. The function queries the `discounts` collection to fetch the real rules locally:
```typescript
    const validUntil = discountData.validUntil?.toDate();
    const now = new Date();
    if (validUntil && validUntil < now) {
      throw new HttpsError("invalid-argument", "Discount code has expired");
    }
```
This correctly throws and terminates any unauthorized discount usage.

### 2. UI Transparency (DiscountTag Component)
The front-end client utilizes the existing `DiscountTag` referencing the globally exported `isDiscountValid(discount)` hook. The current rendering elegantly grays out the component and lists a clear `<Text style={styles.expiredLabel}>Expired {expiryStr}</Text>` string exactly fulfilling "The UI must make the expiry state visible".

### 3. Impact on Existing Subscribers
As thoroughly documented inside `DECISIONS.md`, I chose a "**Strip on Next Invoice**" methodology. When pushing the dynamic coupon to Stripe (`stripe.coupons.create`), I forcefully configured its core `duration: "once"` (swapped out the old `"forever"` stub). 
Because of this built-in capability native to the Stripe platform, the discount gracefully cascades down to the very first immediate invoice/proration phase, but naturally severs itself upon renewal. Meaning, the codebase effortlessly honors the discount immediately without any messy crons.
