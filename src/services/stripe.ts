// Stripe service — client-side helpers and typed stubs.
// Actual Stripe operations happen in Cloud Functions (functions/src/stripe/).
// The client calls Firebase Functions, which call Stripe server-side.
// This keeps the Stripe secret key off the device.

import '@/services/firebase';
import functions from '@react-native-firebase/functions';

import { Platform } from 'react-native';

const USE_EMULATOR = process.env.EXPO_PUBLIC_USE_EMULATOR === 'true';
const DEFAULT_HOST = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? 'localhost';
const EMULATOR_HOST = Platform.OS === 'android' && DEFAULT_HOST === 'localhost' 
  ? '10.0.2.2' 
  : DEFAULT_HOST;

if (USE_EMULATOR) {
  functions().useEmulator(EMULATOR_HOST, 5001);
  console.log(`[Functions] Connected to emulator at http://${EMULATOR_HOST}:5001`);
}

export type CreateCheckoutParams = {
  clinicId: string;
  plan: 'pro' | 'premium' | 'vip';
  discountCode?: string;
};

export type CheckoutResult = {
  sessionId: string;
  url: string;
};

// TODO [CHALLENGE]: Implement Stripe Checkout session creation (Scenario 1 & 2).
// This calls the createCheckoutSession Cloud Function, which:
//   1. Creates or retrieves a Stripe Customer for this clinic
//   2. Creates a Checkout Session with the correct price ID
//   3. Applies any valid discount codes (validate expiry server-side — don't trust client)
//   4. Returns the session URL for redirect
//
// The Cloud Function stub is at functions/src/stripe/checkout.ts
export async function createCheckoutSession(
  params: CreateCheckoutParams,
): Promise<CheckoutResult> {
  const result = await functions().httpsCallable('createCheckoutSession')(params);
  return result.data as CheckoutResult;
}

export type AddonPurchaseParams = {
  clinicId: string;
  addonType: 'extra_storage' | 'extra_seats' | 'advanced_analytics';
  discountCode?: string;
};

// TODO [CHALLENGE]: Implement add-on purchase (Scenario 3).
// This calls the purchaseAddon Cloud Function.
// Important: discount application must match the discount's appliesToAddons field.
// A discount with appliesToBase: true, appliesToAddons: [] does NOT apply here.
// Validate this server-side in the Cloud Function.
export async function purchaseAddon(
  params: AddonPurchaseParams,
): Promise<void> {
  await functions().httpsCallable('purchaseAddon')(params);
}

export type DowngradeParams = {
  clinicId: string;
  targetPlan: 'free' | 'pro' | 'premium';
};

export type DowngradeResult = {
  // 'immediate': downgrade processed now (no seat conflict, or user resolved conflict)
  // 'queued': scheduled for end of billing period (seat conflict detected)
  strategy: 'immediate' | 'queued';
  conflictingSeats?: number; // how many seats exceed target plan limit
  effectiveDate?: string; // ISO date if queued
};

// TODO [CHALLENGE]: Implement plan downgrade (Scenario 2).
// This is the hard one. Before calling Stripe, the Cloud Function must:
//   1. Check current active seat count against target plan's seat limit
//   2. If conflict: decide between immediate block or queue-for-end-of-cycle
//   3. Document your chosen strategy in DECISIONS.md
//   4. If queued: set a flag in Firestore, enforce in rules until resolved
//   5. Firestore rules must block new seat additions during the downgrade-pending state
export async function initiateDowngrade(
  params: DowngradeParams,
): Promise<DowngradeResult> {
  const result = await functions().httpsCallable("initiateDowngrade")(params);
  return result.data as DowngradeResult;
}
