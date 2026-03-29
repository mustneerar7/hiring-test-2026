import { Timestamp } from '@react-native-firebase/firestore';
import type { AddonType } from './subscription';

export type Discount = {
  id: string;
  code: string;
  percentOff: number; // 0-100
  appliesToBase: boolean; // applies to base plan price
  appliesToAddons: AddonType[] | 'all'; // which add-on types this discount applies to
  validUntil: Timestamp;
  usageLimit: number;
  usedCount: number;
};

// Whether a discount is currently valid for new applications
export function isDiscountValid(discount: Discount): boolean {
  const now = new Date();
  const expiry = discount.validUntil.toDate();
  return expiry > now && discount.usedCount < discount.usageLimit;
}

// TODO [CHALLENGE]: Implement discount application logic.
// Given a discount and a line item type, return the discount amount.
// Rules:
//   - If appliesToBase is false, discount does NOT apply to base plan
//   - If appliesToAddons is 'all', discount applies to all add-ons
//   - If appliesToAddons is an array, only applies to listed addon types
//   - An expired discount (validUntil < now) must be rejected — even if usedCount < usageLimit
//   - Existing subscribers with an active Stripe subscription item using the discount:
//     decide whether to honor until renewal or strip immediately. Document your decision.
export function calculateDiscountedPrice(
  basePrice: number,
  itemType: "base" | AddonType,
  discount: Discount,
): number {
  if (!isDiscountValid(discount)) return basePrice;

  let applies = false;
  if (itemType === "base") {
    applies = discount.appliesToBase;
  } else {
    applies = 
      discount.appliesToAddons === "all" || 
      (Array.isArray(discount.appliesToAddons) && discount.appliesToAddons.includes(itemType));
  }

  if (applies) {
    const discountAmount = (basePrice * discount.percentOff) / 100;
    return Math.max(0, basePrice - discountAmount);
  }

  return basePrice;
}
