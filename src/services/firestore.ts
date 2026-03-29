import '@/services/firebase';
import firestore from '@react-native-firebase/firestore';
import type { Clinic } from '@/types/clinic';
import type { User } from '@/types/user';
import type { Subscription } from '@/types/subscription';
import type { Appointment } from '@/types/appointment';
import type { Addon } from '@/types/subscription';
import type { Discount } from '@/types/discount';

import { Platform } from 'react-native';

const USE_EMULATOR = process.env.EXPO_PUBLIC_USE_EMULATOR === 'true';
const DEFAULT_HOST = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? 'localhost';
const EMULATOR_HOST = Platform.OS === 'android' && DEFAULT_HOST === 'localhost' 
  ? '10.0.2.2' 
  : DEFAULT_HOST;

if (USE_EMULATOR) {
  firestore().useEmulator(EMULATOR_HOST, 8080);
  // Disable persistence when using the emulator to avoid cache poisoning from production
  firestore().settings({ 
    persistence: false,
    // Add cacheSizeBytes for completeness if needed in some versions
    cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED 
  });
  console.log(`[Firestore] Connected to emulator at ${EMULATOR_HOST}:8080`);
}

// --- Clinics ---

export function subscribeToClinic(
  clinicId: string,
  onUpdate: (clinic: Clinic) => void,
): () => void {
  return firestore()
    .collection('clinics')
    .doc(clinicId)
    .onSnapshot((snap) => {
      console.log(`[Firestore] Snapshot for clinic: ${clinicId} (exists: ${snap.exists})`);
      if (snap.exists) {
        onUpdate({ id: snap.id, ...snap.data() } as Clinic);
      }
    }, (err) => {
      console.error(`[Firestore] Error subscribing to clinic ${clinicId}:`, err);
    });
}

// --- Users ---

export async function getUser(userId: string): Promise<User | null> {
  try {
    const snap = await firestore().collection('users').doc(userId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() } as User;
  } catch (err) {
    console.error(`[Firestore] Error getting user ${userId}:`, err);
    throw err;
  }
}

export async function getClinicMembers(clinicId: string): Promise<User[]> {
  try {
    const snap = await firestore()
      .collection('users')
      .where('clinicId', '==', clinicId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as User));
  } catch (err) {
    console.error(`[Firestore] Error getting clinic members for ${clinicId}:`, err);
    return [];
  }
}

// --- Subscriptions ---

export function subscribeToSubscription(
  clinicId: string,
  onUpdate: (sub: Subscription) => void,
): () => void {
  return firestore()
    .collection('subscriptions')
    .doc(clinicId)
    .onSnapshot((snap) => {
      console.log(`[Firestore] Snapshot for subscription: ${clinicId} (exists: ${snap.exists})`);
      if (snap.exists) {
        onUpdate({ clinicId, ...snap.data() } as Subscription);
      }
    }, (err) => {
      console.error(`[Firestore] Error subscribing to subscription ${clinicId}:`, err);
    });
}

// --- Appointments ---

export function subscribeToClinicAppointments(
  clinicId: string,
  onUpdate: (appointments: Appointment[]) => void,
): () => void {
  return firestore()
    .collection('appointments')
    .where('clinicId', '==', clinicId)
    .orderBy('datetime', 'asc')
    .onSnapshot((snap) => {
      console.log(`[Firestore] Snapshot for clinic appointments: ${clinicId} (count: ${snap.size})`);
      const appointments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
      onUpdate(appointments);
    }, (err) => {
      console.error(`[Firestore] Error subscribing to clinic appointments ${clinicId}:`, err);
    });
}

export function subscribeToPatientAppointments(
  patientId: string,
  onUpdate: (appointments: Appointment[]) => void,
): () => void {
  return firestore()
    .collection('appointments')
    .where('patientId', '==', patientId)
    .orderBy('datetime', 'asc')
    .onSnapshot((snap) => {
      console.log(`[Firestore] Snapshot for patient appointments: ${patientId} (count: ${snap.size})`);
      const appointments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
      onUpdate(appointments);
    }, (err) => {
      console.error(`[Firestore] Error subscribing to patient appointments ${patientId}:`, err);
    });
}

// --- Add-ons ---

export async function getClinicAddons(clinicId: string): Promise<Addon[]> {
  const snap = await firestore()
    .collection('addons')
    .doc(clinicId)
    .collection('items')
    .where('active', '==', true)
    .get();
  return snap.docs.map((d) => ({ id: d.id, clinicId, ...d.data() } as Addon));
}

// --- Discounts ---

export async function getClinicDiscounts(clinicId: string): Promise<Discount[]> {
  // Fetch discounts referenced by the clinic's activeDiscounts array
  const clinicSnap = await firestore().collection('clinics').doc(clinicId).get();
  const clinic = clinicSnap.data() as Clinic;
  if (!clinic?.activeDiscounts?.length) return [];

  const discountDocs = await Promise.all(
    clinic.activeDiscounts.map((code) =>
      firestore().collection('discounts').where('code', '==', code).limit(1).get(),
    ),
  );

  return discountDocs
    .flatMap((snap) => snap.docs)
    .map((d) => ({ id: d.id, ...d.data() } as Discount));
}
