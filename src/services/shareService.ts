import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { extractDestinationAndCountry } from '@/utils/tripPdfExport';
import type {
  AccommodationItem,
  AttractionItem,
  BudgetBreakdown,
  CurrencyCode,
  FoodItem,
  ItineraryDay,
  SharedTripRecord,
  StructuredTripPlan,
  TravelStyle,
  TripPlanInput,
} from '@/types/trip';

const SHARE_ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export function generateSecureShareId(length = 24): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    throw new Error('Secure random ID generator is unavailable in this browser.');
  }

  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SHARE_ID_ALPHABET[bytes[i] % SHARE_ID_ALPHABET.length];
  }
  return out;
}

export function buildPublicShareUrl(shareId: string): string {
  if (typeof window === 'undefined') {
    return `/?share=${encodeURIComponent(shareId)}`;
  }
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', shareId);
  return url.toString();
}

function mapDocToSharedTripRecord(
  id: string,
  data: Record<string, unknown>,
): SharedTripRecord {
  const currency: CurrencyCode =
    data.currency === 'USD' || data.currency === 'EUR' || data.currency === 'INR'
      ? data.currency
      : 'INR';

  const rawBreakdown =
    data.budgetBreakdown && typeof data.budgetBreakdown === 'object'
      ? (data.budgetBreakdown as Partial<BudgetBreakdown>)
      : {};

  const budgetBreakdown: BudgetBreakdown = {
    accommodation: Number(rawBreakdown.accommodation ?? 0),
    food: Number(rawBreakdown.food ?? 0),
    transportation: Number(rawBreakdown.transportation ?? 0),
    activities: Number(rawBreakdown.activities ?? 0),
    total: Number(rawBreakdown.total ?? data.totalEstimatedBudget ?? 0),
    currency: rawBreakdown.currency ?? currency,
    disclaimer: String(
      rawBreakdown.disclaimer ?? 'Approximate planning estimate only.',
    ),
  };

  return {
    id,
    tripId: String(data.tripId ?? ''),
    ownerId: String(data.ownerId ?? ''),
    isPublic: Boolean(data.isPublic),
    title: String(data.title ?? 'SAFAR Shared Itinerary'),
    destination: String(data.destination ?? ''),
    country: String(data.country ?? ''),
    startingLocation: String(data.startingLocation ?? ''),
    departureDate: String(data.departureDate ?? ''),
    returnDate: String(data.returnDate ?? ''),
    travelers: Number(data.travelers ?? 2),
    durationDays: Number(data.durationDays ?? 3),
    totalEstimatedBudget: Number(
      data.totalEstimatedBudget ?? budgetBreakdown.total ?? 0,
    ),
    currency,
    travelStyle: (data.travelStyle as TravelStyle) ?? 'family',
    interests: Array.isArray(data.interests) ? data.interests.map(String) : [],
    tripSummary: String(data.tripSummary ?? ''),
    budgetBreakdown,
    dailyItinerary: Array.isArray(data.dailyItinerary)
      ? (data.dailyItinerary as ItineraryDay[])
      : [],
    attractions: Array.isArray(data.attractions)
      ? (data.attractions as AttractionItem[])
      : [],
    accommodationSuggestions: Array.isArray(data.accommodationSuggestions)
      ? (data.accommodationSuggestions as AccommodationItem[])
      : [],
    foodRecommendations: Array.isArray(data.foodRecommendations)
      ? (data.foodRecommendations as FoodItem[])
      : [],
    travelTips: Array.isArray(data.travelTips) ? data.travelTips.map(String) : [],
    suggestedFollowUps: [],
    notes: typeof data.notes === 'string' ? data.notes : undefined,
    language: data.language === 'ml' ? 'ml' : 'en',
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
  };
}

export async function findExistingShareForTrip(
  uid: string,
  tripId: string,
): Promise<SharedTripRecord | null> {
  const path = 'sharedTrips';
  try {
    const q = query(
      collection(db, path),
      where('ownerId', '==', uid),
      where('tripId', '==', tripId),
    );
    const snap = await getDocs(q);
    const first = snap.docs[0];
    if (!first) return null;
    return mapDocToSharedTripRecord(first.id, first.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function upsertSharedTrip(
  user: User,
  params: {
    tripId: string;
    title: string;
    input: TripPlanInput;
    plan: StructuredTripPlan;
    notes: string;
    includeNotes: boolean;
    existingShareId?: string;
  },
): Promise<SharedTripRecord> {
  const shareId = params.existingShareId || generateSecureShareId(24);
  const path = `sharedTrips/${shareId}`;
  const shareRef = doc(db, 'sharedTrips', shareId);

  const destination = (
    params.plan.destination ||
    params.input.destination ||
    'Planned Destination'
  )
    .trim()
    .slice(0, 200);
  const { country } = extractDestinationAndCountry(destination);

  const accommodation = Math.max(
    0,
    Number(params.plan.budgetBreakdown.accommodation) || 0,
  );
  const food = Math.max(0, Number(params.plan.budgetBreakdown.food) || 0);
  const transportation = Math.max(
    0,
    Number(params.plan.budgetBreakdown.transportation) || 0,
  );
  const activities = Math.max(
    0,
    Number(params.plan.budgetBreakdown.activities) || 0,
  );
  const summed =
    Math.round((accommodation + food + transportation + activities) * 100) / 100;
  const totalEstimatedBudget =
    summed > 0 ? summed : Math.max(0, Number(params.plan.totalEstimatedBudget) || 0);

  const safeTitle = (
    params.title.trim() ||
    `${params.plan.dailyItinerary.length || params.input.durationDays}-Day ${destination} Trip`
  ).slice(0, 200);

  const sanitizedPayload: Record<string, unknown> = {
    isPublic: true,
    title: safeTitle,
    destination,
    country: country.slice(0, 120),
    startingLocation: params.input.startingLocation.trim().slice(0, 200),
    departureDate: params.input.departureDate.trim().slice(0, 20),
    returnDate: params.input.returnDate.trim().slice(0, 20),
    travelers: Math.min(Math.max(Math.round(params.input.travelers || 1), 1), 30),
    durationDays: Math.min(
      Math.max(
        Math.round(params.plan.dailyItinerary.length || params.input.durationDays || 1),
        1,
      ),
      30,
    ),
    totalEstimatedBudget,
    currency: params.plan.currency || params.input.currency,
    travelStyle: params.input.travelStyle,
    interests: params.input.interests
      .map((i) => i.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 15),
    tripSummary: (
      params.plan.tripSummary.trim() || `${destination} travel itinerary`
    ).slice(0, 4000),
    budgetBreakdown: {
      accommodation,
      food,
      transportation,
      activities,
      total: totalEstimatedBudget,
      currency: params.plan.currency || params.input.currency,
      disclaimer: (
        params.plan.budgetBreakdown.disclaimer ||
        'Approximate planning estimate only.'
      ).slice(0, 500),
    },
    dailyItinerary: params.plan.dailyItinerary.slice(0, 30),
    attractions: params.plan.attractions.slice(0, 30),
    accommodationSuggestions: params.plan.accommodationSuggestions.slice(0, 15),
    foodRecommendations: params.plan.foodRecommendations.slice(0, 20),
    travelTips: params.plan.travelTips
      .map((t) => t.trim().slice(0, 350))
      .filter(Boolean)
      .slice(0, 20),
    notes: params.includeNotes ? params.notes.trim().slice(0, 2000) : '',
    language: params.plan.language,
    updatedAt: serverTimestamp(),
  };

  try {
    if (params.existingShareId) {
      await updateDoc(shareRef, sanitizedPayload);
    } else {
      await setDoc(shareRef, {
        id: shareId,
        tripId: params.tripId,
        ownerId: user.uid,
        ...sanitizedPayload,
        createdAt: serverTimestamp(),
      });
    }

    return mapDocToSharedTripRecord(shareId, {
      id: shareId,
      tripId: params.tripId,
      ownerId: user.uid,
      ...sanitizedPayload,
    });
  } catch (error) {
    handleFirestoreError(
      error,
      params.existingShareId ? OperationType.UPDATE : OperationType.CREATE,
      path,
    );
  }
}

export async function setSharedTripVisibility(
  shareId: string,
  isPublic: boolean,
): Promise<void> {
  const path = `sharedTrips/${shareId}`;
  try {
    await updateDoc(doc(db, 'sharedTrips', shareId), {
      isPublic,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSharedTrip(shareId: string): Promise<void> {
  const path = `sharedTrips/${shareId}`;
  try {
    await deleteDoc(doc(db, 'sharedTrips', shareId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function getPublicSharedTrip(
  shareId: string,
): Promise<SharedTripRecord | null> {
  const cleanId = shareId.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) {
    return null;
  }

  try {
    const snap = await getDoc(doc(db, 'sharedTrips', cleanId));
    if (!snap.exists()) {
      return null;
    }
    const data = snap.data();
    if (!data.isPublic) {
      return null;
    }
    return mapDocToSharedTripRecord(snap.id, data);
  } catch {
    // Missing or non-public share docs intentionally trigger permission-denied in Firestore rules
    return null;
  }
}

function formatShareMoney(amount: number, currency: CurrencyCode): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
  return `${symbol}${Math.round(amount || 0).toLocaleString('en-US')}`;
}

export function buildPlainTextItinerarySummary(params: {
  title: string;
  plan: StructuredTripPlan;
  travelers: number;
  shareUrl?: string | null;
}): string {
  const { place, country } = extractDestinationAndCountry(params.plan.destination);
  const locationLine = country ? `${place} (${country})` : place;
  const highlights = params.plan.dailyItinerary
    .slice(0, 5)
    .map((day) => `• Day ${day.day}: ${day.theme}`)
    .join('\n');

  const lines = [
    `${params.title} — SAFAR (سفر)`,
    `Destination: ${locationLine}`,
    `Duration: ${params.plan.dailyItinerary.length} Days · ${params.travelers} Travelers`,
    `Est. Budget: ${formatShareMoney(params.plan.totalEstimatedBudget, params.plan.currency)}`,
    '',
    params.plan.tripSummary,
    ...(highlights ? ['', 'Highlights:', highlights] : []),
    ...(params.shareUrl ? ['', `View full itinerary: ${params.shareUrl}`] : []),
  ];

  return lines.join('\n');
}

export function buildWhatsAppShareUrl(params: {
  title: string;
  plan: StructuredTripPlan;
  travelers: number;
  shareUrl?: string | null;
}): string {
  const text = buildPlainTextItinerarySummary(params);
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildEmailShareUrl(params: {
  title: string;
  plan: StructuredTripPlan;
  travelers: number;
  shareUrl?: string | null;
}): string {
  const subject = `${params.title} (${params.plan.destination}) — SAFAR Itinerary`;
  const body = buildPlainTextItinerarySummary(params);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
