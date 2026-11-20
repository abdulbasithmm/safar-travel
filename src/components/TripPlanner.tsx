import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import DestinationDetailModal from '@/components/DestinationDetailModal';
import type { DestinationDetailTarget } from '@/components/DestinationDetailModal';
import type { DayMapTrigger } from '@/components/ItineraryMap';
import ItineraryResultsView from '@/components/ItineraryResultsView';
import ProfileSettingsPanel, {
  DEFAULT_PLANNER_PREFERENCES,
} from '@/components/ProfileSettingsPanel';
import type { PlannerPreferences } from '@/components/ProfileSettingsPanel';
import ShareTripModal from '@/components/ShareTripModal';
import { AIClientError, sendAiChatMessage } from '@/services/aiService';
import type { ChatTurn } from '@/services/aiService';
import { searchDestinationPhotos } from '@/services/photoService';
import { findExistingShareForTrip } from '@/services/shareService';
import {
  deleteUserTrip,
  formatFirestoreTripError,
  generateFullTripPlan,
  saveTrip,
  subscribeToUserTrips,
  updateUserTrip,
} from '@/services/tripService';
import {
  exportTripToPdf,
  extractDestinationAndCountry,
} from '@/utils/tripPdfExport';
import type { DestinationPhoto } from '@/types/photo';
import type {
  BudgetBreakdown,
  CurrencyCode,
  PreferredLanguage,
  SharedTripRecord,
  StructuredTripPlan,
  TravelStyle,
  TripPlanInput,
  TripRecord,
  TripStatus,
} from '@/types/trip';

export interface HeroTriggerPayload {
  id: number;
  prompt: string;
  mode: 'plan' | 'trips';
  destination?: string;
}

interface TripPlannerProps {
  heroTrigger: HeroTriggerPayload | null;
}

type PlannerTab = 'plan' | 'itinerary' | 'trips' | 'profile';

interface PlannerErrorState {
  category: 'auth' | 'ai' | 'save' | 'validation' | 'export';
  message: string;
  retryAction?: 'generate' | 'save';
}

function getPreferencesStorageKey(uid?: string | null): string {
  return `safar_planner_prefs_${uid || 'guest'}`;
}

function loadStoredPreferences(uid?: string | null): PlannerPreferences {
  if (typeof window === 'undefined') return DEFAULT_PLANNER_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(getPreferencesStorageKey(uid));
    if (!raw) return DEFAULT_PLANNER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<PlannerPreferences>;
    return {
      startingLocation:
        typeof parsed.startingLocation === 'string' && parsed.startingLocation.trim()
          ? parsed.startingLocation.trim().slice(0, 200)
          : DEFAULT_PLANNER_PREFERENCES.startingLocation,
      currency:
        parsed.currency === 'USD' || parsed.currency === 'EUR' || parsed.currency === 'INR'
          ? parsed.currency
          : DEFAULT_PLANNER_PREFERENCES.currency,
      language:
        parsed.language === 'en' || parsed.language === 'ml' || parsed.language === 'auto'
          ? parsed.language
          : DEFAULT_PLANNER_PREFERENCES.language,
      travelStyle:
        parsed.travelStyle === 'family' ||
        parsed.travelStyle === 'solo' ||
        parsed.travelStyle === 'couple' ||
        parsed.travelStyle === 'adventure' ||
        parsed.travelStyle === 'budget' ||
        parsed.travelStyle === 'luxury'
          ? parsed.travelStyle
          : DEFAULT_PLANNER_PREFERENCES.travelStyle,
      travelers:
        typeof parsed.travelers === 'number' && parsed.travelers >= 1 && parsed.travelers <= 30
          ? Math.round(parsed.travelers)
          : DEFAULT_PLANNER_PREFERENCES.travelers,
    };
  } catch {
    return DEFAULT_PLANNER_PREFERENCES;
  }
}

const TRAVEL_STYLES: Array<{ id: TravelStyle; label: string }> = [
  { id: 'family', label: 'Family' },
  { id: 'solo', label: 'Solo' },
  { id: 'couple', label: 'Couple' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'budget', label: 'Budget' },
  { id: 'luxury', label: 'Luxury' },
];

const INTEREST_OPTIONS = [
  'Food & Cafes',
  'Scenic Hikes',
  'Nature & Backwaters',
  'Culture & Heritage',
  'Wildlife',
  'Hidden Gems',
  'Photography',
  'Relaxation',
  'Local Markets',
];

const CURRENCIES: Array<{ code: CurrencyCode; symbol: string; label: string }> = [
  { code: 'INR', symbol: '₹', label: 'INR (₹)' },
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
];

const GENERATION_LOADING_MESSAGES = [
  'SAFAR is planning your journey...',
  'Creating your personalized travel experience...',
  'Your SAFAR itinerary is almost ready.',
] as const;

function formatMoney(amount: number, currency: CurrencyCode): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
  const rounded = Math.round(amount || 0);
  return `${symbol}${rounded.toLocaleString('en-US')}`;
}

function computeDaysBetween(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null;
  }
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (diff < 1 || diff > 30) return null;
  return diff;
}

export default function TripPlanner({ heroTrigger }: TripPlannerProps) {
  const {
    user,
    authReady,
    authLoading,
    authError,
    signInWithGoogle,
    logout,
    getIdToken,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<PlannerTab>('plan');

  // Form state
  const [destination, setDestination] = useState('Munnar, Kerala');
  const [startingLocation, setStartingLocation] = useState('Kochi');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [travelers, setTravelers] = useState(2);
  const [durationDays, setDurationDays] = useState(3);
  const [budgetAmount, setBudgetAmount] = useState(25000);
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [travelStyle, setTravelStyle] = useState<TravelStyle>('family');
  const [interests, setInterests] = useState<string[]>([
    'Food & Cafes',
    'Nature & Backwaters',
    'Scenic Hikes',
  ]);
  const [language, setLanguage] = useState<PreferredLanguage>('auto');
  const [promptNotes, setPromptNotes] = useState('');

  // Active generated or loaded trip state
  const [activePlan, setActivePlan] = useState<StructuredTripPlan | null>(null);
  const [activeInput, setActiveInput] = useState<TripPlanInput | null>(null);
  const [activeResponseId, setActiveResponseId] = useState<string>('');
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [tripTitle, setTripTitle] = useState('');
  const [tripNotes, setTripNotes] = useState('');
  const [tripStatus, setTripStatus] = useState<TripStatus>('planned');

  // Saved trips state
  const [savedTrips, setSavedTrips] = useState<TripRecord[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [tripStatusFilter, setTripStatusFilter] = useState<'all' | TripStatus>('all');
  const [tripSearchFilter, setTripSearchFilter] = useState('');

  // Traveler planner defaults (persisted locally per user)
  const [preferences, setPreferences] = useState<PlannerPreferences>(() =>
    loadStoredPreferences(null),
  );

  // Follow-up AI chat state
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatResponseId, setChatResponseId] = useState<string | undefined>(undefined);
  const [followUpText, setFollowUpText] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // Operation status & errors
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [savedShare, setSavedShare] = useState<SharedTripRecord | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<PlannerErrorState | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Interactive itinerary map state
  const [selectedMapDay, setSelectedMapDay] = useState<number | 'all'>('all');
  const [selectedMapStopId, setSelectedMapStopId] = useState<string | null>(null);
  const [highlightedSlotId, setHighlightedSlotId] = useState<string | null>(null);
  const [mapDayTrigger, setMapDayTrigger] = useState<DayMapTrigger | null>(null);

  // Connected destination & attraction photography state
  const [destPhotos, setDestPhotos] = useState<DestinationPhoto[]>([]);
  const [destPhotosLoading, setDestPhotosLoading] = useState(false);
  const [attractionPhotos, setAttractionPhotos] = useState<
    Record<string, DestinationPhoto | null>
  >({});
  const [photoModalTarget, setPhotoModalTarget] =
    useState<DestinationDetailTarget | null>(null);

  const focusDayOnMap = (dayNumber: number) => {
    setSelectedMapDay(dayNumber);
    setSelectedMapStopId(null);
    setHighlightedSlotId(null);
    setMapDayTrigger({ day: dayNumber, nonce: Date.now() });
    document
      .getElementById('itinerary-map')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Load stored planner defaults when signed-in user changes (without overwriting active edited trip)
  useEffect(() => {
    if (!authReady) return;
    const loaded = loadStoredPreferences(user?.uid);
    setPreferences(loaded);
    if (!editingTripId) {
      setStartingLocation(loaded.startingLocation);
      setCurrency(loaded.currency);
      setLanguage(loaded.language);
      setTravelStyle(loaded.travelStyle);
      setTravelers(loaded.travelers);
    }
  }, [authReady, user?.uid, editingTripId]);

  const handleSavePreferences = (next: PlannerPreferences) => {
    setPreferences(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          getPreferencesStorageKey(user?.uid),
          JSON.stringify(next),
        );
      } catch {
        // Ignore storage quota issues
      }
    }
    if (!editingTripId) {
      setStartingLocation(next.startingLocation);
      setCurrency(next.currency);
      setLanguage(next.language);
      setTravelStyle(next.travelStyle);
      setTravelers(next.travelers);
    }
  };

  // Sync Firestore trips for signed-in user
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setSavedTrips([]);
      setTripsLoading(false);
      return;
    }

    setTripsLoading(true);
    const unsubscribe = subscribeToUserTrips(
      user.uid,
      (trips) => {
        setSavedTrips(trips);
        setTripsLoading(false);
      },
      (err) => {
        setTripsLoading(false);
        setErrorState({
          category: 'save',
          message: formatFirestoreTripError(err, 'load'),
        });
      },
    );

    return unsubscribe;
  }, [authReady, user]);

  // Load existing share link record when editing a saved trip
  useEffect(() => {
    if (!user || !editingTripId) {
      setSavedShare(null);
      return;
    }

    let cancelled = false;
    findExistingShareForTrip(user.uid, editingTripId)
      .then((share) => {
        if (!cancelled) {
          setSavedShare(share);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedShare(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, editingTripId]);

  // Auto-calculate duration when both dates are set
  useEffect(() => {
    if (departureDate && returnDate) {
      const days = computeDaysBetween(departureDate, returnDate);
      if (days) {
        setDurationDays(days);
      }
    }
  }, [departureDate, returnDate]);

  // Cycle SAFAR staged loading messages while itinerary generates
  useEffect(() => {
    if (!isGenerating) {
      setLoadingStageIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingStageIndex((prev) =>
        prev < GENERATION_LOADING_MESSAGES.length - 1 ? prev + 1 : prev,
      );
    }, 3500);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  // Handle triggers from Hero nav / prompt card / Destination Gallery
  useEffect(() => {
    if (!heroTrigger) return;
    if (heroTrigger.mode === 'trips') {
      setActiveTab('trips');
      return;
    }
    if (heroTrigger.destination) {
      setDestination(heroTrigger.destination);
      setActiveTab('plan');
    }
    if (heroTrigger.prompt) {
      setPromptNotes(heroTrigger.prompt);
      setActiveTab('plan');
    }
  }, [heroTrigger]);

  // Fetch real destination & attraction photography when active itinerary changes
  useEffect(() => {
    if (!activePlan?.destination) {
      setDestPhotos([]);
      setAttractionPhotos({});
      return;
    }

    const controller = new AbortController();
    const destQuery =
      activeInput?.destination?.trim() || activePlan.destination.trim();

    setDestPhotosLoading(true);
    setDestPhotos([]);
    setAttractionPhotos({});

    searchDestinationPhotos(
      { query: destQuery, limit: 8 },
      controller.signal,
    )
      .then((res) => {
        if (!controller.signal.aborted) {
          setDestPhotos(res.photos);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDestPhotos([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDestPhotosLoading(false);
        }
      });

    const topAttractions = activePlan.attractions.slice(0, 6);
    Promise.all(
      topAttractions.map(async (attr) => {
        try {
          const res = await searchDestinationPhotos(
            {
              query: attr.name,
              context: destQuery,
              category: 'landmarks',
              limit: 2,
            },
            controller.signal,
          );
          return [attr.name, res.photos[0] ?? null] as const;
        } catch {
          return [attr.name, null] as const;
        }
      }),
    ).then((entries) => {
      if (controller.signal.aborted) return;
      const mapped: Record<string, DestinationPhoto | null> = {};
      for (const [name, photo] of entries) {
        mapped[name] = photo;
      }
      setAttractionPhotos(mapped);
    });

    return () => controller.abort();
  }, [activePlan, activeInput]);

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((item) => item !== interest)
        : prev.length < 15
          ? [...prev, interest]
          : prev,
    );
  };

  const buildCurrentInput = (): TripPlanInput => ({
    destination: destination.trim() || 'Munnar, Kerala',
    startingLocation: startingLocation.trim(),
    departureDate,
    returnDate,
    travelers: Math.min(Math.max(Number(travelers) || 1, 1), 30),
    durationDays: Math.min(Math.max(Number(durationDays) || 1, 1), 30),
    budgetAmount: Math.max(0, Number(budgetAmount) || 0),
    currency,
    travelStyle,
    interests,
    prompt: promptNotes.trim(),
    language,
  });

  const handleGenerateItinerary = async (event?: FormEvent) => {
    if (event) event.preventDefault();
    if (isGenerating) return;

    setErrorState(null);
    setStatusMsg(null);

    if (!destination.trim() && !promptNotes.trim()) {
      setErrorState({
        category: 'validation',
        message: 'Please enter a destination or travel request.',
      });
      return;
    }

    if (departureDate && returnDate && returnDate < departureDate) {
      setErrorState({
        category: 'validation',
        message: 'Return date cannot be earlier than departure date.',
      });
      return;
    }

    setIsGenerating(true);

    try {
      const activeUser = user ?? (await signInWithGoogle());
      if (!activeUser) {
        setErrorState({
          category: 'auth',
          message:
            authError ||
            'Google sign-in was cancelled or blocked. Please allow the sign-in popup to generate your itinerary.',
          retryAction: 'generate',
        });
        return;
      }

      const input = buildCurrentInput();
      let token = (await getIdToken()) ?? (await activeUser.getIdToken());
      if (!token) {
        token = await activeUser.getIdToken(true);
      }
      if (!token) {
        setErrorState({
          category: 'auth',
          message:
            'Unable to verify your Google sign-in token. Please sign in again and retry.',
          retryAction: 'generate',
        });
        return;
      }

      let result: Awaited<ReturnType<typeof generateFullTripPlan>>;

      try {
        result = await generateFullTripPlan(input, token);
      } catch (firstErr) {
        if (
          firstErr instanceof AIClientError &&
          (firstErr.status === 401 || firstErr.code.startsWith('AUTH_'))
        ) {
          token = await activeUser.getIdToken(true);
          result = await generateFullTripPlan(input, token);
        } else {
          throw firstErr;
        }
      }

      setActivePlan(result.plan);
      setActiveInput(input);
      setActiveResponseId(result.responseId);
      setEditingTripId(null);
      setSavedShare(null);
      setTripTitle(`${input.durationDays}-Day ${result.plan.destination}`);
      setTripNotes('');
      setTripStatus('planned');
      setChatHistory([]);
      setChatResponseId(undefined);
      setSelectedMapDay('all');
      setSelectedMapStopId(null);
      setHighlightedSlotId(null);
      setMapDayTrigger(null);
      setActiveTab('itinerary');
      setStatusMsg('Itinerary generated using OpenAI. Review and save to your trips.');
    } catch (err) {
      const isAuthFailure =
        err instanceof AIClientError &&
        (err.status === 401 || err.code.startsWith('AUTH_'));
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to generate itinerary right now. Please try again.';

      console.error('[SAFAR Planner] Itinerary generation failed:', {
        category: isAuthFailure ? 'auth' : 'ai',
        code: err instanceof AIClientError ? err.code : 'UNKNOWN',
        status: err instanceof AIClientError ? err.status : 0,
        message,
      });

      setErrorState({
        category: isAuthFailure ? 'auth' : 'ai',
        message,
        retryAction: 'generate',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBudgetFieldChange = (
    field: keyof Pick<
      BudgetBreakdown,
      'accommodation' | 'food' | 'transportation' | 'activities'
    >,
    rawVal: string,
  ) => {
    if (!activePlan) return;
    const numeric = Math.max(0, Number(rawVal) || 0);
    const updatedBreakdown: BudgetBreakdown = {
      ...activePlan.budgetBreakdown,
      [field]: numeric,
    };
    const total =
      Math.round(
        (updatedBreakdown.accommodation +
          updatedBreakdown.food +
          updatedBreakdown.transportation +
          updatedBreakdown.activities) *
          100,
      ) / 100;
    updatedBreakdown.total = total;

    setActivePlan({
      ...activePlan,
      totalEstimatedBudget: total,
      budgetBreakdown: updatedBreakdown,
    });
  };

  const handleSaveOrUpdateTrip = async () => {
    if (!activePlan || isSaving) return;
    setErrorState(null);
    setStatusMsg(null);
    setIsSaving(true);

    try {
      const activeUser = user ?? (await signInWithGoogle());
      if (!activeUser) {
        setErrorState({
          category: 'auth',
          message:
            authError ||
            'Google sign-in is required to save this itinerary to your trips.',
          retryAction: 'save',
        });
        return;
      }

      if (editingTripId) {
        await updateUserTrip(editingTripId, {
          title: tripTitle,
          notes: tripNotes,
          status: tripStatus,
          destination: activePlan.destination,
          startingLocation: activeInput?.startingLocation ?? startingLocation,
          departureDate: activeInput?.departureDate ?? departureDate,
          returnDate: activeInput?.returnDate ?? returnDate,
          travelers: activeInput?.travelers ?? travelers,
          durationDays: activeInput?.durationDays ?? durationDays,
          budgetAmount: activeInput?.budgetAmount ?? budgetAmount,
          totalEstimatedBudget: activePlan.totalEstimatedBudget,
          currency: activePlan.currency,
          travelStyle: activeInput?.travelStyle ?? travelStyle,
          interests: activeInput?.interests ?? interests,
          tripSummary: activePlan.tripSummary,
          budgetBreakdown: activePlan.budgetBreakdown,
          dailyItinerary: activePlan.dailyItinerary,
          attractions: activePlan.attractions,
          accommodationSuggestions: activePlan.accommodationSuggestions,
          foodRecommendations: activePlan.foodRecommendations,
          travelTips: activePlan.travelTips,
          suggestedFollowUps: activePlan.suggestedFollowUps,
          language: activePlan.language,
          responseId: activeResponseId || undefined,
        });
        setStatusMsg(`Updated "${tripTitle || activePlan.destination}" in Firestore.`);
      } else {
        const input = activeInput ?? buildCurrentInput();
        const newId = await saveTrip(activeUser, input, activePlan, {
          title: tripTitle || `${input.durationDays}-Day ${activePlan.destination}`,
          notes: tripNotes,
          status: tripStatus,
          responseId: activeResponseId,
        });
        setEditingTripId(newId);
        setStatusMsg(`Saved "${tripTitle || activePlan.destination}" to My Trips.`);
      }
    } catch (err) {
      setErrorState({
        category: 'save',
        message: formatFirestoreTripError(
          err,
          editingTripId ? 'update' : 'save',
        ),
        retryAction: 'save',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const activeCountry = useMemo(() => {
    if (!activePlan?.destination) return '';
    return extractDestinationAndCountry(activePlan.destination).country;
  }, [activePlan?.destination]);

  const ensureTripSavedForShare = async (): Promise<string | null> => {
    if (!activePlan) return null;
    if (editingTripId) return editingTripId;

    const activeUser = user ?? (await signInWithGoogle());
    if (!activeUser) return null;

    const input = activeInput ?? buildCurrentInput();
    const newId = await saveTrip(activeUser, input, activePlan, {
      title: tripTitle || `${input.durationDays}-Day ${activePlan.destination}`,
      notes: tripNotes,
      status: tripStatus,
      responseId: activeResponseId,
    });
    setEditingTripId(newId);
    return newId;
  };

  const handleDownloadPdf = async () => {
    if (!activePlan || isExportingPdf) return;
    setErrorState(null);
    setStatusMsg(null);
    setIsExportingPdf(true);

    try {
      const result = await exportTripToPdf({
        plan: activePlan,
        title: tripTitle,
        country: activeCountry,
        startingLocation: activeInput?.startingLocation ?? startingLocation,
        departureDate: activeInput?.departureDate ?? departureDate,
        returnDate: activeInput?.returnDate ?? returnDate,
        travelers: activeInput?.travelers ?? travelers,
        travelStyle: activeInput?.travelStyle ?? travelStyle,
        budgetAmount: activeInput?.budgetAmount ?? budgetAmount,
        notes: tripNotes,
        photos: destPhotos,
      });
      setStatusMsg(
        `Downloaded ${result.fileName} (${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'}).`,
      );
    } catch (err) {
      setErrorState({
        category: 'export',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to generate PDF right now. You can use Print Trip as an alternative.',
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handlePrintTrip = () => {
    window.print();
  };

  const handleLoadTrip = (trip: TripRecord, openInForm = false) => {
    setErrorState(null);
    setStatusMsg(null);

    setDestination(trip.destination);
    setStartingLocation(trip.startingLocation);
    setDepartureDate(trip.departureDate);
    setReturnDate(trip.returnDate);
    setTravelers(trip.travelers);
    setDurationDays(trip.durationDays);
    setBudgetAmount(trip.budgetAmount);
    setCurrency(trip.currency);
    setTravelStyle(trip.travelStyle);
    setInterests(trip.interests);
    setPromptNotes(trip.prompt);
    setLanguage(trip.language);

    const loadedPlan: StructuredTripPlan = {
      destination: trip.destination,
      tripSummary: trip.tripSummary,
      totalEstimatedBudget: trip.totalEstimatedBudget,
      currency: trip.currency,
      budgetBreakdown: trip.budgetBreakdown,
      dailyItinerary: trip.dailyItinerary,
      attractions: trip.attractions,
      accommodationSuggestions: trip.accommodationSuggestions,
      foodRecommendations: trip.foodRecommendations,
      travelTips: trip.travelTips,
      suggestedFollowUps: trip.suggestedFollowUps,
      language: trip.language,
    };

    setActivePlan(loadedPlan);
    setActiveInput({
      destination: trip.destination,
      startingLocation: trip.startingLocation,
      departureDate: trip.departureDate,
      returnDate: trip.returnDate,
      travelers: trip.travelers,
      durationDays: trip.durationDays,
      budgetAmount: trip.budgetAmount,
      currency: trip.currency,
      travelStyle: trip.travelStyle,
      interests: trip.interests,
      prompt: trip.prompt,
      language: trip.language,
    });
    setActiveResponseId(trip.responseId || '');
    setEditingTripId(trip.id);
    setTripTitle(trip.title);
    setTripNotes(trip.notes);
    setTripStatus(trip.status);
    setChatHistory([]);
    setChatResponseId(undefined);
    setSelectedMapDay('all');
    setSelectedMapStopId(null);
    setHighlightedSlotId(null);
    setMapDayTrigger(null);
    setActiveTab(openInForm ? 'plan' : 'itinerary');
  };

  const handleDeleteTrip = async (tripId: string) => {
    if (isDeletingId) return;
    setErrorState(null);
    setStatusMsg(null);
    setIsDeletingId(tripId);

    try {
      await deleteUserTrip(tripId);
      if (editingTripId === tripId) {
        setEditingTripId(null);
        setSavedShare(null);
        setActivePlan(null);
        setActiveTab('trips');
      }
      setConfirmDeleteId(null);
      setStatusMsg('Trip deleted.');
    } catch (err) {
      setErrorState({
        category: 'save',
        message: formatFirestoreTripError(err, 'delete'),
      });
    } finally {
      setIsDeletingId(null);
    }
  };

  const tripContextSummary = useMemo(() => {
    if (!activePlan) return '';
    return [
      `Destination: ${activePlan.destination}`,
      `Days: ${activePlan.dailyItinerary.length}`,
      `Total Estimated Budget: ${formatMoney(activePlan.totalEstimatedBudget, activePlan.currency)}`,
      `Summary: ${activePlan.tripSummary}`,
    ].join('\n');
  }, [activePlan]);

  const handleFollowUp = async (questionText: string) => {
    const message = questionText.trim();
    if (!message || followUpLoading) return;

    setErrorState(null);
    setFollowUpLoading(true);

    try {
      const activeUser = user ?? (await signInWithGoogle());
      if (!activeUser) {
        setErrorState({
          category: 'auth',
          message:
            authError ||
            'Google sign-in is required to ask follow-up questions.',
        });
        return;
      }

      let token = (await getIdToken()) ?? (await activeUser.getIdToken());
      let res: Awaited<ReturnType<typeof sendAiChatMessage>>;

      try {
        res = await sendAiChatMessage({
          message,
          idToken: token,
          history: chatHistory,
          previousResponseId: chatResponseId,
          language,
          tripContext: tripContextSummary,
        });
      } catch (firstErr) {
        if (
          firstErr instanceof AIClientError &&
          (firstErr.status === 401 || firstErr.code.startsWith('AUTH_'))
        ) {
          token = await activeUser.getIdToken(true);
          res = await sendAiChatMessage({
            message,
            idToken: token,
            history: chatHistory,
            previousResponseId: chatResponseId,
            language,
            tripContext: tripContextSummary,
          });
        } else {
          throw firstErr;
        }
      }

      setChatHistory((prev) => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: res.reply },
      ]);
      setChatResponseId(res.responseId || undefined);
      setFollowUpText('');
      if (activePlan && res.suggestedFollowUps.length > 0) {
        setActivePlan({
          ...activePlan,
          suggestedFollowUps: res.suggestedFollowUps,
        });
      }
    } catch (err) {
      const isAuthFailure =
        err instanceof AIClientError &&
        (err.status === 401 || err.code.startsWith('AUTH_'));
      setErrorState({
        category: isAuthFailure ? 'auth' : 'ai',
        message:
          err instanceof Error ? err.message : 'Follow-up request failed.',
      });
    } finally {
      setFollowUpLoading(false);
    }
  };

  const filteredSavedTrips = useMemo(() => {
    const q = tripSearchFilter.trim().toLowerCase();
    return savedTrips.filter((trip) => {
      if (tripStatusFilter !== 'all' && trip.status !== tripStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        trip.title.toLowerCase().includes(q) ||
        trip.destination.toLowerCase().includes(q) ||
        trip.tripSummary.toLowerCase().includes(q)
      );
    });
  }, [savedTrips, tripStatusFilter, tripSearchFilter]);

  return (
    <section
      id="planner"
      className="w-full bg-white text-safar-navy border-t border-safar-border"
    >
      <div className="max-w-[1200px] mx-auto px-6 py-16 md:py-20 safar-print-container">
        {/* Section Header + Segmented Navigation */}
        <div
          data-print-hide="true"
          className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between pb-8 border-b border-safar-border"
        >
          <div>
            <p className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange mb-2">
              SAFAR Trip Studio · سفر
            </p>
            <h2 className="font-sans text-[clamp(28px,3.6vw,42px)] font-semibold tracking-[-0.03em] text-safar-navy leading-tight">
              Plan, budget &amp; save your journey
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Trip planner views"
            className="inline-flex flex-wrap sm:flex-nowrap items-center gap-1 max-w-full rounded-[22px] sm:rounded-full bg-safar-sky border border-safar-border p-1.5 self-start lg:self-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'plan'}
              onClick={() => setActiveTab('plan')}
              className={`cursor-pointer rounded-full px-3.5 sm:px-4 py-2 font-sans text-[11px] sm:text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'plan'
                  ? 'bg-safar-navy text-white shadow-xs'
                  : 'bg-transparent text-safar-navy hover:bg-white/70'
              }`}
            >
              Plan Trip
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'itinerary'}
              disabled={!activePlan}
              onClick={() => activePlan && setActiveTab('itinerary')}
              className={`cursor-pointer rounded-full px-3.5 sm:px-4 py-2 font-sans text-[11px] sm:text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                activeTab === 'itinerary'
                  ? 'bg-safar-navy text-white shadow-xs'
                  : 'bg-transparent text-safar-navy hover:bg-white/70'
              }`}
            >
              Itinerary &amp; Budget
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'trips'}
              onClick={() => setActiveTab('trips')}
              className={`cursor-pointer rounded-full px-3.5 sm:px-4 py-2 font-sans text-[11px] sm:text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'trips'
                  ? 'bg-safar-navy text-white shadow-xs'
                  : 'bg-transparent text-safar-navy hover:bg-white/70'
              }`}
            >
              My Trips ({savedTrips.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'profile'}
              onClick={() => setActiveTab('profile')}
              className={`cursor-pointer inline-flex items-center gap-1.5 rounded-full px-3.5 sm:px-4 py-2 font-sans text-[11px] sm:text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'profile'
                  ? 'bg-safar-navy text-white shadow-xs'
                  : 'bg-transparent text-safar-navy hover:bg-white/70'
              }`}
            >
              <Settings className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
              Profile &amp; Settings
            </button>
          </div>
        </div>

        {/* Error & Status Alerts */}
        {errorState && (
          <div
            role="alert"
            data-print-hide="true"
            className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/85 px-5 py-4 text-sm text-red-800"
          >
            <span>
              <strong className="font-semibold">
                {errorState.category === 'save'
                  ? 'Trip saving error: '
                  : errorState.category === 'auth'
                    ? 'Sign-in error: '
                    : errorState.category === 'validation'
                      ? 'Check trip details: '
                      : errorState.category === 'export'
                        ? 'PDF export error: '
                        : 'AI itinerary error: '}
              </strong>
              {errorState.message}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              {errorState.retryAction && (
                <button
                  type="button"
                  disabled={
                    errorState.retryAction === 'generate'
                      ? isGenerating
                      : isSaving
                  }
                  onClick={() =>
                    errorState.retryAction === 'generate'
                      ? void handleGenerateItinerary()
                      : void handleSaveOrUpdateTrip()
                  }
                  className="inline-flex items-center gap-1.5 rounded-full bg-red-800 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.04em] text-white hover:bg-red-900 disabled:opacity-60"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrorState(null)}
                className="text-xs font-medium uppercase tracking-[0.04em] underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {statusMsg && (
          <div
            role="status"
            data-print-hide="true"
            className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-safar-border bg-safar-skySoft px-5 py-3.5 text-sm font-medium text-safar-navy"
          >
            <span>{statusMsg}</span>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate hover:text-safar-navy"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: PLAN TRIP FORM */}
        {activeTab === 'plan' && (
          <form
            onSubmit={handleGenerateItinerary}
            className="mt-8 rounded-[28px] border border-safar-border bg-safar-skySoft/75 p-5 sm:p-7 md:p-8 space-y-6 shadow-[0_10px_32px_rgba(15,37,68,0.04)]"
          >
            {/* Route & Dates */}
            <div className="rounded-2xl border border-safar-border bg-white p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-safar-orange">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                Destination &amp; Travel Dates
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Destination
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={200}
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="e.g., Munnar, Kerala"
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Starting Location
                  </span>
                  <input
                    type="text"
                    maxLength={200}
                    value={startingLocation}
                    onChange={(e) => setStartingLocation(e.target.value)}
                    placeholder="e.g., Kochi"
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Departure Date
                  </span>
                  <input
                    type="date"
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Return Date
                  </span>
                  <input
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white tabular-nums"
                  />
                </label>
              </div>
            </div>

            {/* Group, Budget & Language */}
            <div className="rounded-2xl border border-safar-border bg-white p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-safar-orange">
                <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                Travelers, Budget &amp; Language
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Travelers
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={travelers}
                    onChange={(e) => setTravelers(Number(e.target.value))}
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Duration (Days)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={durationDays}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Target Budget
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="100"
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(Number(e.target.value))}
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white tabular-nums"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Currency
                  </span>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
                  >
                    {CURRENCIES.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                    Language
                  </span>
                  <select
                    value={language}
                    onChange={(e) =>
                      setLanguage(e.target.value as PreferredLanguage)
                    }
                    className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
                  >
                    <option value="auto">Auto (English / Malayalam)</option>
                    <option value="en">English</option>
                    <option value="ml">Malayalam (മലയാളം)</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Travel Style & Interests */}
            <div className="rounded-2xl border border-safar-border bg-white p-5 sm:p-6 space-y-6">
              <div className="space-y-3">
                <span className="block text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                  Travel Style
                </span>
                <div className="flex flex-wrap gap-2.5">
                  {TRAVEL_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setTravelStyle(style.id)}
                      className={`cursor-pointer rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap ${
                        travelStyle === style.id
                          ? 'bg-safar-navy text-white shadow-xs'
                          : 'border border-safar-border bg-white text-safar-navy hover:bg-safar-skySoft'
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-safar-border/70">
                <span className="block text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                  Interests
                </span>
                <div className="flex flex-wrap gap-2.5">
                  {INTEREST_OPTIONS.map((interest) => {
                    const selected = interests.includes(interest);
                    return (
                      <button
                        key={interest}
                        type="button"
                        onClick={() => toggleInterest(interest)}
                        className={`cursor-pointer rounded-full px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                          selected
                            ? 'border border-safar-orange bg-safar-orangeSoft text-safar-orangeHover'
                            : 'border border-safar-border bg-white text-safar-slate hover:text-safar-navy hover:bg-safar-skySoft'
                        }`}
                      >
                        {interest}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Additional notes / Malayalam or English prompt */}
            <div className="rounded-2xl border border-safar-border bg-white p-5 sm:p-6 space-y-5">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                  Preferences or Custom Request (English or Malayalam / മലയാളം)
                </span>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={promptNotes}
                  onChange={(e) => setPromptNotes(e.target.value)}
                  placeholder="Tell Safar anything specific — e.g., vegetarian cafes, kid-friendly pacing, avoiding weekend crowds, or write in മലയാളം..."
                  className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white resize-y"
                />
              </label>

              {isGenerating && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-safar-border bg-safar-skySoft px-5 py-4"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-safar-navy">
                      {GENERATION_LOADING_MESSAGES[loadingStageIndex]}
                    </p>
                    <p className="text-xs text-safar-slate">
                      {loadingStageIndex === 0
                        ? 'Preparing routes, visiting hours, and local recommendations.'
                        : loadingStageIndex === 1
                          ? 'Balancing travel times and realistic budget estimates.'
                          : 'Finalizing your Safar schedule and map stops.'}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-safar-orange shrink-0">
                    SAFAR · سفر
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-safar-border/70">
                <div className="flex flex-wrap items-center gap-2.5 text-xs text-safar-slate">
                  <span>
                    {user
                      ? `Signed in as ${user.displayName || user.email}`
                      : 'Sign in with Google when generating to save and manage your trips.'}
                  </span>
                  {user && (
                    <button
                      type="button"
                      disabled={authLoading}
                      onClick={() => void logout()}
                      className="md:hidden cursor-pointer font-semibold text-safar-navy underline hover:text-safar-orange disabled:opacity-50"
                    >
                      Sign out
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isGenerating || authLoading}
                  className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-safar-navy px-7 py-3.5 font-sans text-sm font-semibold uppercase tracking-[0.04em] text-white shadow-[0_10px_24px_rgba(15,37,68,0.2)] transition-all hover:bg-safar-navyHover active:scale-95 disabled:opacity-60 whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4 text-safar-orange" aria-hidden="true" />
                  {isGenerating ? 'SAFAR is planning...' : 'Generate Itinerary'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* TAB 2: ITINERARY & BUDGET */}
        {activeTab === 'itinerary' && activePlan && (
          <ItineraryResultsView
            activePlan={activePlan}
            activeInput={activeInput}
            activeCountry={activeCountry}
            tripTitle={tripTitle}
            onTripTitleChange={setTripTitle}
            tripStatus={tripStatus}
            onTripStatusChange={setTripStatus}
            tripNotes={tripNotes}
            onTripNotesChange={setTripNotes}
            travelers={travelers}
            travelStyle={travelStyle}
            budgetAmount={budgetAmount}
            editingTripId={editingTripId}
            isSaving={isSaving}
            isExportingPdf={isExportingPdf}
            destPhotos={destPhotos}
            destPhotosLoading={destPhotosLoading}
            attractionPhotos={attractionPhotos}
            selectedMapDay={selectedMapDay}
            onSelectMapDay={setSelectedMapDay}
            selectedMapStopId={selectedMapStopId}
            onSelectMapStopId={setSelectedMapStopId}
            highlightedSlotId={highlightedSlotId}
            onHighlightSlotId={setHighlightedSlotId}
            mapDayTrigger={mapDayTrigger}
            onSetMapDayTrigger={setMapDayTrigger}
            onFocusDayOnMap={focusDayOnMap}
            onBudgetFieldChange={handleBudgetFieldChange}
            onSaveOrUpdateTrip={handleSaveOrUpdateTrip}
            onDownloadPdf={handleDownloadPdf}
            onOpenShareModal={() => setIsShareModalOpen(true)}
            onPrintTrip={handlePrintTrip}
            onEditTrip={() => {
              setActiveTab('plan');
              document
                .getElementById('planner')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            onPlanAnotherTrip={() => {
              setEditingTripId(null);
              setSavedShare(null);
              setActiveTab('plan');
              document
                .getElementById('planner')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            onOpenPhotoModal={(target) => setPhotoModalTarget(target)}
            chatHistory={chatHistory}
            followUpText={followUpText}
            onFollowUpTextChange={setFollowUpText}
            followUpLoading={followUpLoading}
            onFollowUp={handleFollowUp}
            formatMoney={formatMoney}
          />
        )}

        {/* TAB 3: SAVED TRIPS (FIRESTORE) */}
        {activeTab === 'trips' && (
          <div className="mt-8 space-y-6">
            {!authReady || tripsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Array.from({ length: 2 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-56 rounded-[24px] border border-safar-border bg-safar-skySoft/60 animate-pulse"
                  />
                ))}
              </div>
            ) : !user ? (
              <div className="rounded-[28px] border border-safar-border bg-gradient-to-br from-safar-skySoft via-white to-white p-10 text-center space-y-4 shadow-[0_8px_28px_rgba(15,37,68,0.04)]">
                <p className="text-lg font-semibold text-safar-navy">
                  Sign in to view and manage your saved trips
                </p>
                <p className="text-sm text-safar-slate max-w-md mx-auto leading-relaxed">
                  Your itineraries, budget adjustments, notes, and share links are securely stored in your private Safar account.
                </p>
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => void signInWithGoogle()}
                  className="cursor-pointer rounded-full bg-safar-navy px-6 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-safar-navyHover disabled:opacity-50 transition-colors"
                >
                  {authLoading ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </div>
            ) : savedTrips.length === 0 ? (
              <div className="rounded-[28px] border border-safar-border bg-gradient-to-br from-safar-skySoft via-white to-white p-10 text-center space-y-4 shadow-[0_8px_28px_rgba(15,37,68,0.04)]">
                <p className="text-lg font-semibold text-safar-navy">
                  No saved trips yet
                </p>
                <p className="text-sm text-safar-slate">
                  Generate an itinerary in the Plan Trip tab and click Save Trip to store it here.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('plan')}
                  className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-safar-navy px-6 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-safar-navyHover transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                  Plan Your First Trip
                </button>
              </div>
            ) : (
              <>
                {/* My Trips Filter & Quick Create Bar */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-safar-border bg-safar-skySoft/65 p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['all', 'planned', 'draft', 'archived'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setTripStatusFilter(status)}
                        className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap ${
                          tripStatusFilter === status
                            ? 'bg-safar-navy text-white'
                            : 'border border-safar-border bg-white text-safar-navy hover:bg-safar-sky'
                        }`}
                      >
                        {status === 'all' ? 'All' : status}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <input
                      type="search"
                      value={tripSearchFilter}
                      onChange={(e) => setTripSearchFilter(e.target.value)}
                      placeholder="Filter saved trips..."
                      aria-label="Filter saved trips"
                      className="rounded-full border border-safar-border bg-white px-4 py-2 text-xs text-safar-navy placeholder:text-safar-slate/70 outline-none focus:border-safar-navy"
                    />
                    <button
                      type="button"
                      onClick={() => setActiveTab('plan')}
                      className="cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-full bg-safar-orange px-4 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-safar-orangeHover transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      New Trip
                    </button>
                  </div>
                </div>

                {filteredSavedTrips.length === 0 ? (
                  <div className="rounded-[24px] border border-safar-border bg-white p-8 text-center space-y-2">
                    <p className="text-sm font-semibold text-safar-navy">
                      No trips match this filter
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setTripStatusFilter('all');
                        setTripSearchFilter('');
                      }}
                      className="cursor-pointer text-xs font-semibold text-safar-orange hover:underline"
                    >
                      Show all saved trips
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {filteredSavedTrips.map((trip) => (
                      <div
                        key={trip.id}
                        className="rounded-[24px] border border-safar-border bg-white overflow-hidden flex flex-col justify-between shadow-[0_6px_22px_rgba(15,37,68,0.04)] transition-all duration-200 hover:shadow-[0_14px_32px_rgba(15,37,68,0.08)]"
                      >
                        <div className="p-6 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.04em]">
                            <span className="inline-flex items-center gap-1 text-safar-orange font-semibold">
                              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                              {trip.destination}
                            </span>
                            <span className="text-safar-slate font-medium tabular-nums">
                              {trip.durationDays}d · {trip.travelers} travelers ·{' '}
                              {trip.status}
                            </span>
                          </div>

                          <h3 className="text-xl font-semibold text-safar-navy">
                            {trip.title}
                          </h3>

                          <p className="text-sm text-safar-slate line-clamp-3 leading-relaxed">
                            {trip.tripSummary}
                          </p>

                          <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-safar-navy tabular-nums">
                              Est. Budget:{' '}
                              {formatMoney(trip.totalEstimatedBudget, trip.currency)}
                            </p>
                            {trip.departureDate && (
                              <span className="text-xs text-safar-slate tabular-nums">
                                {trip.departureDate}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="px-6 py-4 bg-safar-skySoft/50 border-t border-safar-border flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleLoadTrip(trip, false)}
                              className="cursor-pointer rounded-full bg-safar-navy px-4 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-safar-navyHover transition-colors whitespace-nowrap"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLoadTrip(trip, true)}
                              className="cursor-pointer inline-flex items-center gap-1 rounded-full border border-safar-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy hover:bg-safar-sky transition-colors whitespace-nowrap"
                            >
                              <Pencil className="w-3 h-3 text-safar-orange" />
                              Edit
                            </button>
                          </div>

                          {confirmDeleteId === trip.id ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={isDeletingId === trip.id}
                                onClick={() => void handleDeleteTrip(trip.id)}
                                className="cursor-pointer rounded-full bg-red-700 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-red-800 disabled:opacity-50"
                              >
                                {isDeletingId === trip.id ? 'Deleting...' : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="cursor-pointer text-xs font-medium text-safar-slate hover:text-safar-navy"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(trip.id)}
                              aria-label={`Delete ${trip.title}`}
                              className="cursor-pointer inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate hover:text-red-700 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 4: PROFILE & SETTINGS */}
        {activeTab === 'profile' && (
          <ProfileSettingsPanel
            user={user}
            authReady={authReady}
            authLoading={authLoading}
            savedTrips={savedTrips}
            preferences={preferences}
            onSavePreferences={handleSavePreferences}
            onSignIn={signInWithGoogle}
            onSignOut={logout}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}
      </div>

      <DestinationDetailModal
        target={photoModalTarget}
        onClose={() => setPhotoModalTarget(null)}
      />

      {activePlan && (
        <ShareTripModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          title={tripTitle}
          input={activeInput ?? buildCurrentInput()}
          plan={activePlan}
          notes={tripNotes}
          editingTripId={editingTripId}
          savedShare={savedShare}
          onShareChange={setSavedShare}
          onEnsureTripSaved={ensureTripSavedForShare}
        />
      )}
    </section>
  );
}
