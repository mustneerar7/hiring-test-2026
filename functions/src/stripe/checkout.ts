import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";

let stripeInstance: Stripe;
const getStripe = () => {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new HttpsError("internal", "STRIPE_SECRET_KEY is not set in environment variables");
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia",
    });
  }
  return stripeInstance;
};

// Dynamic Price Resolution (removes the need for manual Dashboard configuration)
async function getOrCreatePriceId(planOrAddon: string): Promise<string> {
  const stripe = getStripe();
  // Search for an existing product with this metadata key
  const products = await stripe.products.search({ query: `metadata['key']:'${planOrAddon}'` });
  
  if (products.data.length > 0) {
    const prices = await stripe.prices.list({ product: products.data[0].id, active: true });
    if (prices.data.length > 0) return prices.data[0].id;
  }

  // If not found, create a generic test product and monthly price dynamically
  const product = await stripe.products.create({
    name: planOrAddon.replace('_', ' ').toUpperCase(),
    metadata: { key: planOrAddon }
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: planOrAddon.includes('add') ? 1500 : 5000, 
    currency: 'usd',
    recurring: { interval: 'month' }
  });

  return price.id;
}

export const createCheckoutSession = onCall(async (request: CallableRequest) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { clinicId, plan, discountCode } = data as {
    clinicId: string;
    plan: "pro" | "premium" | "vip";
    discountCode?: string;
  };

  const db = admin.firestore();

  // Verify caller is the clinic owner
  const userDoc = await db.collection("users").doc(auth.uid).get();
  const user = userDoc.data();
  if (!user || user.role !== "owner" || user.clinicId !== clinicId) {
    throw new HttpsError("permission-denied", "Only clinic owners can manage billing");
  }

  // Get or create Stripe customer
  const subDoc = await db.collection("subscriptions").doc(clinicId).get();
  const subData = subDoc.data();
  let customerId: string;

  if (subData?.stripeCustomerId) {
    customerId = subData.stripeCustomerId;
  } else {
    const clinicDoc = await db.collection("clinics").doc(clinicId).get();
    const clinic = clinicDoc.data();
    const customer = await getStripe().customers.create({
      email: user.email,
      name: clinic?.name,
      metadata: { clinicId },
    });
    customerId = customer.id;
  }

  // Validate discount code if provided
  let stripeCouponId: string | undefined;
  if (discountCode) {
    const discountsSnap = await db.collection("discounts").where("code", "==", discountCode).limit(1).get();
    if (discountsSnap.empty) {
      throw new HttpsError("invalid-argument", "Invalid discount code");
    }
    const discountDoc = discountsSnap.docs[0];
    const discountData = discountDoc.data();
    
    const validUntil = discountData.validUntil?.toDate();
    const now = new Date();
    if (validUntil && validUntil < now) {
      throw new HttpsError("invalid-argument", "Discount code has expired");
    }
    if (discountData.usageLimit && discountData.usedCount >= discountData.usageLimit) {
      throw new HttpsError("invalid-argument", "Discount code usage limit reached");
    }
    if (!discountData.appliesToBase) {
      throw new HttpsError("invalid-argument", "Discount code does not apply to base plans");
    }

    try {
      await getStripe().coupons.retrieve(discountCode);
      stripeCouponId = discountCode;
    } catch {
      const coupon = await getStripe().coupons.create({
        id: discountCode,
        percent_off: discountData.percentOff,
        duration: "once",
      });
      stripeCouponId = coupon.id;
    }

    // Increment usage
    await discountDoc.ref.update({ usedCount: admin.firestore.FieldValue.increment(1) });
  }

  // Update existing subscription or create new checkout session
  if (subData?.stripeSubscriptionId && subData.plan !== "free") {
    const subscription = await getStripe().subscriptions.retrieve(subData.stripeSubscriptionId);
    const itemId = subscription.items.data[0].id;
    await getStripe().subscriptions.update(subData.stripeSubscriptionId, {
      items: [{ id: itemId, price: await getOrCreatePriceId(plan) }],
      proration_behavior: "create_prorations",
      metadata: { clinicId, plan },
      ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
    });
    
    return { sessionId: "direct_upgrade", url: "clinicapp://billing?success=true" };
  } else {
    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: await getOrCreatePriceId(plan), quantity: 1 }],
      metadata: { clinicId, plan },
      ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
      success_url: "clinicapp://billing?success=true",
      cancel_url: "clinicapp://billing?canceled=true",
    });

    return { sessionId: session.id, url: session.url };
  }
});

export const purchaseAddon = onCall(async (request: CallableRequest) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { clinicId, addonType, discountCode } = data as {
    clinicId: string;
    addonType: "extra_storage" | "extra_seats" | "advanced_analytics";
    discountCode?: string;
  };

  const db = admin.firestore();

  // Verify caller is the clinic owner
  const userDoc = await db.collection("users").doc(auth.uid).get();
  const user = userDoc.data();
  if (!user || user.role !== "owner" || user.clinicId !== clinicId) {
    throw new HttpsError("permission-denied", "Only clinic owners can manage billing");
  }

  const subDoc = await db.collection("subscriptions").doc(clinicId).get();
  const subData = subDoc.data();
  if (!subData?.stripeSubscriptionId || subData.status !== "active") {
    throw new HttpsError("failed-precondition", "Active subscription required to purchase addons");
  }

  // Validate discount code if provided
  let stripeCouponId: string | undefined;
  if (discountCode) {
    const discountsSnap = await db.collection("discounts").where("code", "==", discountCode).limit(1).get();
    if (discountsSnap.empty) {
      throw new HttpsError("invalid-argument", "Invalid discount code");
    }
    const discountDoc = discountsSnap.docs[0];
    const discountData = discountDoc.data();
    
    const validUntil = discountData.validUntil?.toDate();
    const now = new Date();
    if (validUntil && validUntil < now) {
      throw new HttpsError("invalid-argument", "Discount code has expired");
    }
    if (discountData.usageLimit && discountData.usedCount >= discountData.usageLimit) {
      throw new HttpsError("invalid-argument", "Discount code usage limit reached");
    }

    // Verify it applies to addons!
    const appliesToAddons = discountData.appliesToAddons;
    let applies = false;
    if (appliesToAddons === "all") {
      applies = true;
    } else if (Array.isArray(appliesToAddons) && appliesToAddons.includes(addonType)) {
      applies = true;
    }

    if (!applies) {
      throw new HttpsError("invalid-argument", "Discount code does not apply to this add-on");
    }

    try {
      await getStripe().coupons.retrieve(discountCode);
      stripeCouponId = discountCode;
    } catch {
      const coupon = await getStripe().coupons.create({
        id: discountCode,
        percent_off: discountData.percentOff,
        duration: "once",
      });
      stripeCouponId = coupon.id;
    }

    // Increment usage
    await discountDoc.ref.update({ usedCount: admin.firestore.FieldValue.increment(1) });
  }

  const subscription = await getStripe().subscriptions.retrieve(subData.stripeSubscriptionId);
  const targetPriceId = await getOrCreatePriceId(addonType);
  const existingItem = subscription.items.data.find(item => item.price.id === targetPriceId);

  const itemPayload: any = existingItem 
    ? { id: existingItem.id, quantity: (existingItem.quantity || 1) + 1 }
    : { price: targetPriceId, quantity: 1 };

  if (stripeCouponId) {
    // Add discount array directly to the new/updated subscription item
    itemPayload.discounts = [{ coupon: stripeCouponId }];
  }

  await getStripe().subscriptions.update(subData.stripeSubscriptionId, {
    items: [itemPayload],
    proration_behavior: "always_invoice",
    metadata: { clinicId },
  });

  return { success: true };
});

export const initiateDowngrade = onCall(async (request: CallableRequest) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { clinicId, targetPlan } = data as {
    clinicId: string;
    targetPlan: "free" | "pro" | "premium";
  };

  const db = admin.firestore();

  // Verify caller is the clinic owner
  const userDoc = await db.collection("users").doc(auth.uid).get();
  const user = userDoc.data();
  if (!user || user.role !== "owner" || user.clinicId !== clinicId) {
    throw new HttpsError("permission-denied", "Only clinic owners can manage billing");
  }

  const clinicDoc = await db.collection("clinics").doc(clinicId).get();
  const clinic = clinicDoc.data();
  if (!clinic) throw new HttpsError("not-found", "Clinic not found");

  const { PLAN_CONFIG_SERVER } = await import("./planConfig");
  const targetConfig = (PLAN_CONFIG_SERVER as any)[targetPlan];
  const activeSeats = clinic.seats?.used || 0;

  // Assuming no addons in simple scenario, or just checking base config
  if (activeSeats > targetConfig.seats) {
    return {
      strategy: "immediate",
      conflictingSeats: activeSeats - targetConfig.seats,
    };
  }

  // Attempt to update Stripe subscription
  const subDoc = await db.collection("subscriptions").doc(clinicId).get();
  const subData = subDoc.data();

  if (subData?.stripeSubscriptionId) {
    if (targetPlan === "free") {
      await getStripe().subscriptions.cancel(subData.stripeSubscriptionId);
    } else {
      const subscription = await getStripe().subscriptions.retrieve(subData.stripeSubscriptionId);
      const itemId = subscription.items.data[0].id;
      await getStripe().subscriptions.update(subData.stripeSubscriptionId, {
        items: [{ id: itemId, price: await getOrCreatePriceId(targetPlan) }],
        proration_behavior: "always_invoice",
        metadata: { clinicId, plan: targetPlan },
      });
    }
  }

  return { strategy: "immediate" };
});

export const removeStaffMember = onCall(async (request: CallableRequest) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { clinicId, userId } = data as { clinicId: string; userId: string };

  const db = admin.firestore();

  // Verify caller is the clinic owner
  const userDoc = await db.collection("users").doc(auth.uid).get();
  const user = userDoc.data();
  if (!user || user.role !== "owner" || user.clinicId !== clinicId) {
    throw new HttpsError("permission-denied", "Only clinic owners can remove staff");
  }

  // Deactivate the seat inside Firestore
  await db.collection("seats").doc(clinicId).collection("members").doc(userId).update({
    active: false,
  });

  // OPTION A: Revoke refresh tokens server-side forcing automatic logout when short-lived ID token expires.
  await admin.auth().revokeRefreshTokens(userId);

  // Disassociate the user from the clinic globally
  await db.collection("users").doc(userId).update({
    clinicId: null,
  });

  return { success: true };
});

export const revokeUserSession = onCall(async (request: CallableRequest) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

  const { userId } = data as { userId: string };

  const db = admin.firestore();

  // Verify caller is a clinic owner of the user they are deleting
  const targetUserDoc = await db.collection("users").doc(userId).get();
  const targetUser = targetUserDoc.data();
  
  if (targetUser?.clinicId) {
    const callerDoc = await db.collection("users").doc(auth.uid).get();
    if (callerDoc.data()?.clinicId !== targetUser.clinicId || callerDoc.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "Unauthorized to revoke this session");
    }
  }

  await admin.auth().revokeRefreshTokens(userId);
  return { success: true };
});
