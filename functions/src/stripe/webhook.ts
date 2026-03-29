import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import Stripe from "stripe";

let stripeInstance: Stripe;
const getStripe = () => {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia",
    });
  }
  return stripeInstance;
};

const GRACE_PERIOD_DAYS = 7;

const detectPlanFromSubscription = (
  sub: Stripe.Subscription,
): "pro" | "premium" | "vip" | "free" => {
  if (sub.metadata?.plan) return sub.metadata.plan as any;
  const priceId = sub.items.data[0]?.price.id;
  if (priceId?.toLowerCase().includes("premium")) return "premium";
  if (priceId?.toLowerCase().includes("vip")) return "vip";
  if (priceId?.toLowerCase().includes("pro")) return "pro";
  return "pro";
};

export const handleStripeWebhook = onRequest(
  {
    invoker: "public",
  },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(
        req.rawBody,
        sig!,
        webhookSecret,
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      res.status(400).send("Webhook Error");
      return;
    }

    const db = admin.firestore();
    console.log(`[Webhook] Processing: ${event.type} [${event.id}]`);

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          await handleCheckoutCompleted(db, session);
          break;
        }
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          await handleSubscriptionUpdated(db, sub);
          break;
        }
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          await handlePaymentSucceeded(db, invoice);
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          await handlePaymentFailed(db, invoice);
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(db, sub);
          break;
        }
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
      res.json({ received: true });
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal error");
    }
  },
);

async function findSubscriptionDoc(
  db: admin.firestore.Firestore,
  subscriptionId?: string,
  customerId?: string | any,
) {
  console.log(`[Webhook Search] Searching for sub: ${subscriptionId}, customer: ${customerId}`);
  
  if (subscriptionId) {
    const snap = await db
      .collection("subscriptions")
      .where("stripeSubscriptionId", "==", subscriptionId)
      .limit(1)
      .get();
    if (!snap.empty) {
      console.log(`[Webhook Search] Found via subscriptionId: ${snap.docs[0].id}`);
      return snap.docs[0];
    }
  }

  if (customerId) {
    const id = typeof customerId === "string" ? customerId : customerId?.id;
    if (id) {
      console.log(`[Webhook Search] Falling back to customer ID ${id}`);
      const snap = await db
        .collection("subscriptions")
        .where("stripeCustomerId", "==", id)
        .limit(1)
        .get();
      if (!snap.empty) {
        console.log(`[Webhook Search] Found via customerId: ${snap.docs[0].id}`);
        return snap.docs[0];
      }
    }
  }

  console.warn(`[Webhook Search] NO MATCH FOUND in Firestore for any provided identifiers.`);
  return null;
}

async function handleCheckoutCompleted(
  db: admin.firestore.Firestore,
  session: Stripe.Checkout.Session,
) {
  const clinicId = session.metadata?.clinicId;
  const plan = (session.metadata?.plan || "pro") as any;
  if (!clinicId) throw new Error("Missing clinicId in session metadata");

  const { PLAN_CONFIG_SERVER } = await import("./planConfig");
  const planConfig = (PLAN_CONFIG_SERVER as any)[plan];

  const subscriptionId = session.subscription as string;
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);

  await db.runTransaction(async (tx) => {
    tx.set(
      db.collection("subscriptions").doc(clinicId),
      {
        clinicId,
        plan,
        planLabel: planConfig.label, // Added label
        status: "active",
        stripeCustomerId: session.customer,
        stripeSubscriptionId: subscriptionId,
        currentPeriodEnd: Timestamp.fromMillis(
          Math.floor((subscription.current_period_end || 0) * 1000),
        ),
        gracePeriodEnd: null,
      },
      { merge: true },
    );

    tx.update(db.collection("clinics").doc(clinicId), {
      plan,
      planLabel: planConfig.label, // Added label
      "seats.max": planConfig.seats,
    });
  });
}

async function handleSubscriptionUpdated(
  db: admin.firestore.Firestore,
  stripeSubscription: Stripe.Subscription,
) {
  const subDoc = await findSubscriptionDoc(
    db,
    stripeSubscription.id,
    stripeSubscription.customer,
  );
  if (!subDoc) return;

  const { PLAN_CONFIG_SERVER } = await import("./planConfig");
  const plan = detectPlanFromSubscription(stripeSubscription);
  const planConfig = (PLAN_CONFIG_SERVER as any)[plan];

  const updates: any = {
    plan,
    planLabel: planConfig?.label || "Pro", // Added label
    status: stripeSubscription.status,
    stripeSubscriptionId: stripeSubscription.id,
    gracePeriodEnd: null,
  };

  if (stripeSubscription.current_period_end) {
    updates.currentPeriodEnd = Timestamp.fromMillis(
      Math.floor(stripeSubscription.current_period_end * 1000),
    );
  }

  await db.runTransaction(async (tx) => {
    tx.update(subDoc.ref, updates);
    tx.update(db.collection("clinics").doc(subDoc.id), {
      plan,
      planLabel: planConfig?.label || "Pro", // Added label
      "seats.max": planConfig?.seats || 5,
    });
  });

  console.log(
    `[Webhook] Sync complete: ${subDoc.id} is now ${plan} (${planConfig?.label})`,
  );
}

async function handlePaymentFailed(
  db: admin.firestore.Firestore,
  invoice: Stripe.Invoice,
) {
  const subDoc = await findSubscriptionDoc(
    db,
    invoice.subscription as string,
    invoice.customer,
  );
  if (!subDoc) return;
  const graceEnd = Timestamp.fromMillis(
    Math.floor(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
  );
  await subDoc.ref.update({ status: "grace_period", gracePeriodEnd: graceEnd });
}

async function handleSubscriptionDeleted(
  db: admin.firestore.Firestore,
  stripeSubscription: Stripe.Subscription,
) {
  const subDoc = await findSubscriptionDoc(
    db,
    stripeSubscription.id,
    stripeSubscription.customer,
  );
  if (!subDoc) return;
  const clinicId = subDoc.id;

  // Find all active seats
  const seatsSnap = await db.collection(`seats/${clinicId}/members`).where("active", "==", true).get();
  
  // Prefer keeping the owner active
  const ownerDoc = seatsSnap.docs.find(d => d.data().role === "owner");
  const keepDoc = ownerDoc || seatsSnap.docs[0];

  const batch = db.batch();
  let deactivatedCount = 0;
  seatsSnap.docs.forEach(doc => {
    if (keepDoc && doc.id !== keepDoc.id) {
      batch.update(doc.ref, { active: false });
      deactivatedCount++;
    }
  });

  await db.runTransaction(async (tx) => {
    // Revert subscription status
    tx.update(subDoc.ref, {
      plan: "free",
      planLabel: "Free",
      status: "canceled",
      stripeSubscriptionId: null,
      gracePeriodEnd: null,
    });
    // Revert clinic capabilities
    tx.update(db.collection("clinics").doc(clinicId), {
      plan: "free",
      planLabel: "Free",
      "seats.max": 1,
      "seats.used": seatsSnap.size - deactivatedCount // Ensures accurate used count
    });
  });

  if (deactivatedCount > 0) {
    await batch.commit();
  }
}

async function handlePaymentSucceeded(
  db: admin.firestore.Firestore,
  invoice: Stripe.Invoice,
) {
  const subDoc = await findSubscriptionDoc(
    db,
    invoice.subscription as string,
    invoice.customer,
  );
  if (!subDoc) return;
  await subDoc.ref.update({ status: "active", gracePeriodEnd: null });
}
