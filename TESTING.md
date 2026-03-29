# Manual Testing Guide

This document outlines step-by-step instructions to manually test the 6 scenarios utilizing the Firebase Emulator, local environment, and Stripe CLI.

## ⚙️ Initial Setup
1. **Start the Emulators:** Keep `npm run emulator` running in a dedicated terminal (Ensures Auth, Firestore, and Functions backends are running).
2. **Seed the Database:** Open a new terminal and run `npm run seed` to populate *Alpine Aesthetics Clinic* alongside essential test users and dummy subscriptions.
3. **Start the App:** Start the Expo React Native app interface using `npm start`.
4. **Stripe Webhook Forwarding:** In a separate terminal, forward Stripe events natively to your local emulator function: 
   ```bash
   stripe listen --forward-to localhost:5001/clinic-test-local/us-central1/handleStripeWebhook
   ```

---

## 🧪 Scenario 1: Plan Upgrade

1. **Setup:** Open the Firebase Emulator UI (`localhost:4000`), locate `subscriptions/clinic_alpine_001` and `clinics/clinic_alpine_001`, and manually change the overarching plan to `free`. Delete the existing `stripeSubscriptionId` to properly simulate a brand new upgrade from scratch.
2. **Action:** Log in as the owner (`sophie.owner@test.com`). Trigger the upgrade to `pro` via the app UI.
3. **Verify:** An alert will appear in the app confirming the session. **Switch to your terminal** (where your Expo process is running) and copy the URL between the `--- STRIPE CHECKOUT URL ---` markers.
4. **Complete Loop:** Paste the URL into your browser (Chrome/Edge) to complete the test payment.
5. **Webhook:** Watch your Stripe listener terminal. Stripe will transmit an authentic `checkout.session.completed` packet to the webhook. Refresh the Emulator UI and verify that the `clinics` document instantly upgrades fully to `plan: "pro"` alongside setting dynamic capacity back to `seats.max: 5`.

---
## 💡 Internal Testing Tips

- **Dynamic Products:** The backend is configured to automatically create Stripe Products and Prices in your Test Mode if they don't exist.
- **Currency:** All transactions default to `usd` to maintain consistency with existing customer objects in Stripe Test Mode.
- **Console Logs:** If you don't see the URL, ensure your terminal is showing the logs from the `expo start` process.

---

## 🧪 Scenario 2: Downgrade with Seat Conflict

1. **Setup:** Inside the Firestore Emulator dashboard, temporarily edit `clinics/clinic_alpine_001` manually so that `seats.used` becomes `10` and `seats.max` is `15` to intentionally generate a capacity crisis. 
2. **Action:** Safely call the `initiateDowngrade` Cloud Function orchestrating a return to the `'pro'` plan (which strictly enforces a maximum capacity limit of 5 seats).
3. **Verify Error:** The execution will predictably fault and immediately return `{ strategy: "immediate", conflictingSeats: 5 }`, totally aborting any API calls sent remotely to Stripe.
4. **Verify Rules:** Try to manually push a brand new `active: true` staff member document directly into the backend `seats` subcollection while `used` overrides `max`. Observe Firebase natively throwing a permission denied rejection as Firestore Security Rules strictly refuse the generic batch write.

---

## 🧪 Scenario 3: Add-on Purchase with Discount

1. **Action:** Ensure you're authenticated as `sophie.owner@test.com`. Execute the `purchaseAddon` function requesting the `'extra_storage'` add-on but forcefully supply the exclusively locked `WELCOME20` discount code.
2. **Verify Error:** The backend terminal will throw an uncompromising `HttpsError` tracing: *"Discount code does not apply to this add-on"*.
3. **Action:** Fire the function again identically, but omit the invalid discount code entirely (or provide a valid unexpired add-on code).
4. **Verify Success:** Pull up your Stripe Dashboard (Test Mode tab). Under Customers, verify the specific billing subscription correctly bundled the `extra_storage` repeating component to their monthly invoice tally.

---

## 🧪 Scenario 4: Payment Failure & Grace Period

1. **Action:** From your open terminal, use the Stripe CLI to maliciously trigger a simulated invoice decline for the specific Alpine customer. This will create a fresh subscription on that customer record which the backend will find: 
   ```bash
   stripe trigger invoice.payment_failed --override invoice:customer=cus_test_REPLACE_ME
   ```
   Alternatively you can directly use the stripe dashboard to trigger the event. Go to the customer page and click on "Trigger test events" and select "invoice.payment_failed".
2. **Verify Grace Period:** Swap back to your Firestore Emulator GUI. Notice the underlying `subscriptions/clinic_alpine_001` object natively transitioning to display `status: "grace_period"` while auto-generating a robust `gracePeriodEnd` timestamp exactly 7 days into the future. (If multiple subscriptions exist for the customer, the search log will show which one it matched).
3. **Verify Restrictions:** Challenge the database by attempting to register a brand new staff seat. Watch Firestore Security Rules seamlessly drop the request simply because the mandatory check requiring `status == 'active'` natively flags `'grace_period'` as invalid for expansions.
4. **Verify Reversion:** Trigger the cancellation event:
   ```bash
   stripe trigger customer.subscription.deleted --override subscription:customer=cus_test_REPLACE_ME
   ```
   Return to Firestore and assert that `seats.max` automatically crashed to `1`, the `plan` defaulted to `free`, and all subsidiary staff profiles housed under the local `seats` subcollection (except Sophie the owner) were systematically forced deactivated via `active: false`.

---

## 🧪 Scenario 5: Expired Discount Code

1. **Action:** Navigate to the main App interface displaying the `ADDONS15` legacy discount code. Check the native `<DiscountTag />` component state.
2. **Verify UI:** It natively displays visually grayed out while proudly hoisting a pronounced red "Expired" sub-label validating that the structural `isDiscountValid` boolean handles its local lifecycle properly.
3. **Action:** Actively attempt to force through an illicit validation utilizing `createCheckoutSession` or `purchaseAddon` while mapping `ADDONS15`.
4. **Verify Backend:** The system terminates the execution throwing an uncompromising `HttpsError`: *"Discount code has expired"*. If deploying the legitimately active `WELCOME20` promo, review your Stripe Dashboard checking the active coupons page verifying that `WELCOME20` dynamically injected an impenetrable `Strip on Next Invoice (Duration Once)` lifecycle limit.

---

## 🧪 Scenario 6: Role Change & Fast Invalidation

1. **Setup:** Leverage a second completely independent browser tab (or incognito window) successfully logged into the app directly acting as `anna.staff@test.com`.
2. **Action:** Switch contexts back to the master owner (`sophie`) and actively invoke the `removeStaffMember` cloud function directly targeting Anna's specific Firebase `userId`.
3. **Verify Firestore:** Re-examine the Firebase Emulator UI tracking Anna's seat document successfully transitioning into a localized `active: false` lock state. Note the `users` document concurrently losing the `clinicId` anchor map globally.
4. **Verify Emulated Auth:** Jump into the terminal actively tracing your Firebase functions emulator traffic. Observe the crucial admin SDK log seamlessly pinging out the `revokeRefreshTokens` sequence targeting Anna's UID, structurally cementing that her local environment becomes irrevocably denied access globally once her pre-cached ID token legally expires out.
