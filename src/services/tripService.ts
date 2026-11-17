import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { AIClientError, parseApiJsonSafely } from '@/services/aiService';
import type {
  AccommodationItem,
  AttractionItem,
  BudgetBreakdown,
  CurrencyCode,
  FoodItem,
  ItineraryDay,
  StructuredTripPlan,
  TravelStyle,
  TripLanguage,
  TripPlanInput,
  TripRecord,
  TripStatus,
} from '@/types/trip';

const PLAN_CLIENT_TIMEOUT_MS = 130_000;

export function formatFirestoreTripError(
  error: unknown,
  action: 'save' | 'update' | 'delete' | 'load',
): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  let underlying = rawMessage;

  try {
    const parsed = JSON.parse(rawMessage) as { error?: string; operationType?: string };
    if (parsed && typeof parsed.error === 'string') {
      underlying = parsed.error;
    }
  } catch {
    // Non-JSON error message
  }

  const normalized = underlying.toLowerCase();
  const actionVerb =
    action === 'save'
      ? 'save your trip'
      : action === 'update'
        ? 'update your trip'
        : action === 'delete'
          ? 'delete your trip'
          : 'load your saved trips';

  if (
    normalized.includes('permission-denied') ||
    normalized.includes('missing or insufficient permissions')
  ) {
    return action === 'update'
      ? 'Unable to update this trip due to Firestore permissions (archived trips or unverified accounts cannot be modified).'
      : `Unable to ${actionVerb} due to Firestore permissions. Ensure you are signed in with a verified Google account.`;
  }

  if (
    normalized.includes('unavailable') ||
    normalized.includes('offline') ||
    normalized.includes('network')
  ) {
    return `Could not reach Cloud Firestore to ${actionVerb}. Please check your connection and try again.`;
  }

  if (normalized.includes('resource-exhausted') || normalized.includes('quota')) {
    return `Firestore storage or rate quota was reached while trying to ${actionVerb}. Please retry shortly.`;
  }

  if (normalized.includes('unauthenticated')) {
    return `Your sign-in session expired before Firestore could ${actionVerb}. Please sign in again.`;
  }

  return `Unable to ${actionVerb} in Cloud Firestore. Please try again.`;
}

export async function ensureUserProfile(user: User): Promise<void> {
  if (!user.email) return;

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  const profileFields: {
    email: string;
    displayName?: string;
    photoURL?: string;
  } = {
    email: user.email.slice(0, 320),
  };

  if (user.displayName) {
    profileFields.displayName = user.displayName.slice(0, 120);
  }
  if (user.photoURL) {
    profileFields.photoURL = user.photoURL.slice(0, 1024);
  }

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        ...profileFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        ...profileFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function generateFullTripPlan(
  input: TripPlanInput,
  idToken: string,
): Promise<{
  plan: StructuredTripPlan;
  responseId: string;
  model: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAN_CLIENT_TIMEOUT_MS);

  try {
    const response = await fetch('/api/trips/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      signal: controller.signal,
      body: JSON.stringify(input),
    });

    const { data, isHtmlProxy } = await parseApiJsonSafely<{
      plan?: StructuredTripPlan;
      responseId?: string;
      model?: string;
      error?: string;
      code?: string;
      retryAfterSeconds?: number;
    }>(response);

    if (isHtmlProxy) {
      throw new AIClientError(
        503,
        'PROXY_UNAVAILABLE',
        'The itinerary service returned an unexpected gateway response while warming up. Please retry in a moment.',
      );
    }

    const payload = data ?? {};

    if (!response.ok || !payload.plan) {
      throw new AIClientError(
        response.status,
        payload.code || 'TRIP_PLAN_FAILED',
        payload.error ||
          'Unable to generate itinerary right now. Please try again.',
        payload.retryAfterSeconds,
      );
    }

    return {
      plan: payload.plan,
      responseId: payload.responseId || '',
      model: payload.model || '',
    };
  } catch (error) {
    if (error instanceof AIClientError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AIClientError(
        408,
        'CLIENT_TIMEOUT',
        'Itinerary generation timed out while waiting for the AI planner. Please retry.',
      );
    }
    throw new AIClientError(
      0,
      'NETWORK_ERROR',
      error instanceof Error
        ? error.message
        : 'Network error while generating your itinerary.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeTripPayload(
  input: TripPlanInput,
  plan: StructuredTripPlan,
  title: string,
  notes: string,
  status: TripStatus,
  responseId?: string,
) {
  const safeInterests = input.interests
    .map((item) => item.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 15);

  const safeDaily = plan.dailyItinerary.slice(0, 30);
  const safeAttractions = plan.attractions.slice(0, 30);
  const safeAccommodations = plan.accommodationSuggestions.slice(0, 15);
  const safeFood = plan.foodRecommendations.slice(0, 20);
  const safeTips = plan.travelTips
    .map((t) => t.trim().slice(0, 350))
    .filter(Boolean)
    .slice(0, 20);
  const safeFollowUps = plan.suggestedFollowUps
    .map((f) => f.trim().slice(0, 180))
    .filter(Boolean)
    .slice(0, 10);

  const accommodation = Math.max(0, Number(plan.budgetBreakdown.accommodation) || 0);
  const food = Math.max(0, Number(plan.budgetBreakdown.food) || 0);
  const transportation = Math.max(0, Number(plan.budgetBreakdown.transportation) || 0);
  const activities = Math.max(0, Number(plan.budgetBreakdown.activities) || 0);
  const total = Math.round((accommodation + food + transportation + activities) * 100) / 100;

  return {
    title: (title.trim() || `${safeDaily.length || input.durationDays}-Day ${plan.destination} Trip`).slice(0, 200),
    prompt: (input.prompt.trim() || `Plan a ${input.durationDays}-day ${input.travelStyle} trip to ${plan.destination}`).slice(0, 2000),
    destination: (plan.destination || input.destination || 'Planned Destination').trim().slice(0, 200),
    startingLocation: input.startingLocation.trim().slice(0, 200),
    departureDate: input.departureDate.trim().slice(0, 20),
    returnDate: input.returnDate.trim().slice(0, 20),
    travelers: Math.min(Math.max(Math.round(input.travelers || 1), 1), 30),
    durationDays: Math.min(Math.max(Math.round(input.durationDays || safeDaily.length || 1), 1), 30),
    budgetAmount: Math.max(0, Number(input.budgetAmount) || 0),
    totalEstimatedBudget: total > 0 ? total : Math.max(0, Number(plan.totalEstimatedBudget) || 0),
    currency: plan.currency || input.currency,
    travelStyle: input.travelStyle,
    interests: safeInterests,
    tripSummary: (plan.tripSummary.trim() || `${plan.destination || input.destination} travel itinerary`).slice(0, 4000),
    budgetBreakdown: {
      accommodation,
      food,
      transportation,
      activities,
      total: total > 0 ? total : Math.max(0, Number(plan.totalEstimatedBudget) || 0),
      currency: plan.currency || input.currency,
      disclaimer: (plan.budgetBreakdown.disclaimer || 'Approximate planning estimate only.').slice(0, 500),
    },
    dailyItinerary: safeDaily,
    attractions: safeAttractions,
    accommodationSuggestions: safeAccommodations,
    foodRecommendations: safeFood,
    travelTips: safeTips,
    suggestedFollowUps: safeFollowUps,
    notes: notes.trim().slice(0, 2000),
    language: plan.language,
    status,
    aiProvider: 'openai' as const,
    ...(responseId ? { responseId: responseId.slice(0, 128) } : {}),
  };
}

export async function saveTrip(
  user: User,
  input: TripPlanInput,
  plan: StructuredTripPlan,
  options?: {
    title?: string;
    notes?: string;
    status?: TripStatus;
    responseId?: string;
  },
): Promise<string> {
  const tripsCollection = collection(db, 'trips');
  const tripRef = doc(tripsCollection);
  const tripId = tripRef.id;
  const path = `trips/${tripId}`;

  const defaultTitle = `${input.durationDays}-Day ${plan.destination}`;
  const cleanPayload = sanitizeTripPayload(
    input,
    plan,
    options?.title || defaultTitle,
    options?.notes || '',
    options?.status || 'planned',
    options?.responseId,
  );

  try {
    await setDoc(tripRef, {
      id: tripId,
      ownerId: user.uid,
      ...cleanPayload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return tripId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateUserTrip(
  tripId: string,
  updates: {
    title?: string;
    notes?: string;
    status?: TripStatus;
    destination?: string;
    startingLocation?: string;
    departureDate?: string;
    returnDate?: string;
    travelers?: number;
    durationDays?: number;
    budgetAmount?: number;
    totalEstimatedBudget?: number;
    currency?: CurrencyCode;
    travelStyle?: TravelStyle;
    interests?: string[];
    tripSummary?: string;
    budgetBreakdown?: BudgetBreakdown;
    dailyItinerary?: ItineraryDay[];
    attractions?: AttractionItem[];
    accommodationSuggestions?: AccommodationItem[];
    foodRecommendations?: FoodItem[];
    travelTips?: string[];
    suggestedFollowUps?: string[];
    language?: TripLanguage;
    responseId?: string;
    prompt?: string;
  },
): Promise<void> {
  const path = `trips/${tripId}`;
  const tripRef = doc(db, 'trips', tripId);

  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof updates.title === 'string') {
    payload.title = updates.title.trim().slice(0, 200) || 'Untitled Trip';
  }
  if (typeof updates.notes === 'string') {
    payload.notes = updates.notes.trim().slice(0, 2000);
  }
  if (updates.status) {
    payload.status = updates.status;
  }
  if (typeof updates.destination === 'string' && updates.destination.trim()) {
    payload.destination = updates.destination.trim().slice(0, 200);
  }
  if (typeof updates.startingLocation === 'string') {
    payload.startingLocation = updates.startingLocation.trim().slice(0, 200);
  }
  if (typeof updates.departureDate === 'string') {
    payload.departureDate = updates.departureDate.trim().slice(0, 20);
  }
  if (typeof updates.returnDate === 'string') {
    payload.returnDate = updates.returnDate.trim().slice(0, 20);
  }
  if (typeof updates.travelers === 'number') {
    payload.travelers = Math.min(Math.max(Math.round(updates.travelers), 1), 30);
  }
  if (typeof updates.durationDays === 'number') {
    payload.durationDays = Math.min(
      Math.max(Math.round(updates.durationDays), 1),
      30,
    );
  }
  if (typeof updates.budgetAmount === 'number') {
    payload.budgetAmount = Math.max(0, updates.budgetAmount);
  }
  if (typeof updates.totalEstimatedBudget === 'number') {
    payload.totalEstimatedBudget = Math.max(0, updates.totalEstimatedBudget);
  }
  if (updates.currency) {
    payload.currency = updates.currency;
  }
  if (updates.travelStyle) {
    payload.travelStyle = updates.travelStyle;
  }
  if (Array.isArray(updates.interests)) {
    payload.interests = updates.interests.slice(0, 15);
  }
  if (typeof updates.tripSummary === 'string' && updates.tripSummary.trim()) {
    payload.tripSummary = updates.tripSummary.trim().slice(0, 4000);
  }
  if (updates.budgetBreakdown) {
    payload.budgetBreakdown = updates.budgetBreakdown;
  }
  if (Array.isArray(updates.dailyItinerary)) {
    payload.dailyItinerary = updates.dailyItinerary.slice(0, 30);
  }
  if (Array.isArray(updates.attractions)) {
    payload.attractions = updates.attractions.slice(0, 30);
  }
  if (Array.isArray(updates.accommodationSuggestions)) {
    payload.accommodationSuggestions = updates.accommodationSuggestions.slice(0, 15);
  }
  if (Array.isArray(updates.foodRecommendations)) {
    payload.foodRecommendations = updates.foodRecommendations.slice(0, 20);
  }
  if (Array.isArray(updates.travelTips)) {
    payload.travelTips = updates.travelTips.slice(0, 20);
  }
  if (Array.isArray(updates.suggestedFollowUps)) {
    payload.suggestedFollowUps = updates.suggestedFollowUps.slice(0, 10);
  }
  if (updates.language) {
    payload.language = updates.language;
  }
  if (typeof updates.responseId === 'string' && updates.responseId) {
    payload.responseId = updates.responseId.slice(0, 128);
  }
  if (typeof updates.prompt === 'string' && updates.prompt.trim()) {
    payload.prompt = updates.prompt.trim().slice(0, 2000);
  }

  try {
    await updateDoc(tripRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteUserTrip(tripId: string): Promise<void> {
  const path = `trips/${tripId}`;
  try {
    await deleteDoc(doc(db, 'trips', tripId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserTrips(
  uid: string,
  onTrips: (trips: TripRecord[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const path = 'trips';
  const tripsQuery = query(
    collection(db, 'trips'),
    where('ownerId', '==', uid),
  );

  return onSnapshot(
    tripsQuery,
    (snapshot) => {
      const records: TripRecord[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const createdAt =
          data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null;
        const updatedAt =
          data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null;

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
            rawBreakdown.disclaimer ??
              'Approximate planning estimate only.',
          ),
        };

        return {
          id: docSnap.id,
          ownerId: String(data.ownerId ?? ''),
          title: String(data.title ?? 'Untitled Trip'),
          prompt: String(data.prompt ?? ''),
          destination: String(data.destination ?? ''),
          startingLocation: String(data.startingLocation ?? ''),
          departureDate: String(data.departureDate ?? ''),
          returnDate: String(data.returnDate ?? ''),
          travelers: Number(data.travelers ?? 2),
          durationDays: Number(data.durationDays ?? 3),
          budgetAmount: Number(data.budgetAmount ?? 0),
          totalEstimatedBudget: Number(data.totalEstimatedBudget ?? budgetBreakdown.total ?? 0),
          currency,
          travelStyle: (data.travelStyle as TravelStyle) ?? 'family',
          interests: Array.isArray(data.interests) ? data.interests.map(String) : [],
          tripSummary: String(data.tripSummary ?? data.summary ?? ''),
          budgetBreakdown,
          dailyItinerary: Array.isArray(data.dailyItinerary) ? (data.dailyItinerary as ItineraryDay[]) : [],
          attractions: Array.isArray(data.attractions) ? (data.attractions as AttractionItem[]) : [],
          accommodationSuggestions: Array.isArray(data.accommodationSuggestions)
            ? (data.accommodationSuggestions as AccommodationItem[])
            : [],
          foodRecommendations: Array.isArray(data.foodRecommendations)
            ? (data.foodRecommendations as FoodItem[])
            : [],
          travelTips: Array.isArray(data.travelTips) ? data.travelTips.map(String) : [],
          suggestedFollowUps: Array.isArray(data.suggestedFollowUps)
            ? data.suggestedFollowUps.map(String)
            : [],
          notes: String(data.notes ?? ''),
          language: data.language === 'ml' ? 'ml' : 'en',
          status: (data.status as TripStatus) ?? 'planned',
          aiProvider: 'openai',
          responseId: typeof data.responseId === 'string' ? data.responseId : undefined,
          createdAt,
          updatedAt,
        };
      });

      records.sort((a, b) => {
        const timeA = a.createdAt ? a.createdAt.getTime() : 0;
        const timeB = b.createdAt ? b.createdAt.getTime() : 0;
        return timeB - timeA;
      });

      onTrips(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    },
  );
}
