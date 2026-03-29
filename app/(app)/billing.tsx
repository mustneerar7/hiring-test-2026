import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking,
} from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { useClinic } from '@/hooks/useClinic';
import { useSubscription } from '@/hooks/useSubscription';
import { getClinicAddons, getClinicDiscounts } from '@/services/firestore';
import { createCheckoutSession, purchaseAddon } from '@/services/stripe';
import { PlanBadge } from '@/components/PlanBadge';
import { SeatUsageBar } from '@/components/SeatUsageBar';
import { DiscountTag } from '@/components/DiscountTag';
import { ADDON_CONFIG } from '@/types/subscription';
import type { Addon, Plan } from '@/types/subscription';
import type { Discount } from '@/types/discount';

export default function BillingScreen() {
  const { isOwner } = useAuth();
  const { clinic } = useClinic();
  const { plan, status, config, seatsUsed, seatsMax } = useSubscription();
  const [addons, setAddons] = useState<Addon[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clinic) return;
    getClinicAddons(clinic.id).then(setAddons);
    getClinicDiscounts(clinic.id).then(setDiscounts);
  }, [clinic?.id]);

  if (!isOwner) {
    return (
      <View style={styles.restricted}>
        <Text style={styles.restrictedText}>Billing is only visible to clinic owners.</Text>
      </View>
    );
  }

  async function handleUpgrade() {
    if (loading || !clinic) return;
    
    // For Scenario 1, we simulate upgrading to Pro.
    // In a real app, this would show a "Plan Selection" modal first.
    setLoading(true);
    try {
      const { url } = await createCheckoutSession({
        clinicId: clinic.id,
        plan: 'pro',
      });
      if (url) {
        Linking.openURL(url);
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      Alert.alert('Error', err.message || 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchaseAddon(addonType: any) {
    if (loading || !clinic) return;
    
    setLoading(true);
    try {
      await purchaseAddon({
        clinicId: clinic.id,
        addonType,
      });
      Alert.alert('Success', 'Add-on purchased successfully');
      // Refresh addons
      const fresh = await getClinicAddons(clinic.id);
      setAddons(fresh);
    } catch (err: any) {
      console.error('Addon purchase error:', err);
      Alert.alert('Error', err.message || 'Failed to purchase add-on');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Current plan */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current plan</Text>
        <View style={styles.planRow}>
          <PlanBadge plan={plan} />
          <Text style={styles.planPrice}>
            {config.price === 0 ? 'Free' : `CHF ${config.price}/mo`}
          </Text>
        </View>
        <Text style={styles.planStatus}>
          Status: <Text style={status === 'active' ? styles.active : styles.inactive}>{status}</Text>
        </Text>
        {status === 'grace_period' && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>
              Payment failed. You have a grace period to resolve this.
              New staff cannot be added until billing is resolved.
            </Text>
            {/* TODO [CHALLENGE]: Show gracePeriodEnd date from subscription */}
            {/* TODO [CHALLENGE]: After grace period ends, plan reverts to Free (Scenario 4) */}
          </View>
        )}
      </View>

      {/* Seat usage */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Seats</Text>
        <SeatUsageBar used={seatsUsed} max={seatsMax} />
      </View>

      {/* Active add-ons */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active add-ons</Text>
        {addons.length === 0 ? (
          <Text style={styles.empty}>No active add-ons.</Text>
        ) : (
          addons.map((addon) => (
            <View key={addon.id} style={styles.addonRow}>
              <View>
                <Text style={styles.addonName}>{ADDON_CONFIG[addon.type].label}</Text>
                <Text style={styles.addonDesc}>{ADDON_CONFIG[addon.type].description}</Text>
              </View>
              <Text style={styles.addonPrice}>CHF {addon.price}/mo</Text>
            </View>
          ))
        )}

        {/* Available add-ons to purchase */}
        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Available add-ons</Text>
        {Object.entries(ADDON_CONFIG).map(([type, meta]) => {
          const alreadyActive = addons.some((a) => a.type === type);
          if (alreadyActive) return null;
          if (plan === 'free') return null; // Add-ons require a paid plan
          return (
            <TouchableOpacity
              key={type}
              style={styles.addonCard}
              onPress={() => handlePurchaseAddon(type)}
            >
              <View>
                <Text style={styles.addonName}>{meta.label}</Text>
                <Text style={styles.addonDesc}>{meta.description}</Text>
              </View>
              <View style={styles.addonCardRight}>
                <Text style={styles.addonPrice}>CHF {meta.price}/mo</Text>
                <Text style={styles.addButton}>Add</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        {plan === 'free' && (
          <Text style={styles.empty}>Upgrade to a paid plan to add add-ons.</Text>
        )}
      </View>

      {/* Active discounts */}
      {discounts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active discounts</Text>
          {discounts.map((d) => (
            <DiscountTag key={d.id} discount={d} />
          ))}
          {/* TODO [CHALLENGE]: Scenario 5 — show expired discount state clearly */}
        </View>
      )}

      {/* Upgrade CTA */}
      {plan !== 'vip' && (
        <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
          <Text style={styles.upgradeText}>Upgrade plan</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, gap: 4, paddingBottom: 40 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planPrice: { fontSize: 20, fontWeight: '700', color: '#111827' },
  planStatus: { fontSize: 14, color: '#6b7280' },
  active: { color: '#059669', fontWeight: '600' },
  inactive: { color: '#ef4444', fontWeight: '600' },
  warningBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 6,
    padding: 12,
  },
  warningText: { fontSize: 13, color: '#92400e' },
  addonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  addonCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    marginBottom: 8,
  },
  addonCardRight: { alignItems: 'flex-end', gap: 4 },
  addonName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  addonDesc: { fontSize: 12, color: '#6b7280', maxWidth: 200 },
  addonPrice: { fontSize: 14, fontWeight: '700', color: '#111827' },
  addButton: { fontSize: 13, color: '#3b82f6', fontWeight: '600' },
  empty: { fontSize: 14, color: '#9ca3af' },
  upgradeButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  upgradeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  restricted: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  restrictedText: { fontSize: 16, color: '#6b7280', textAlign: 'center' },
});
