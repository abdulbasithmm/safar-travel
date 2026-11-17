import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Calendar,
  Camera,
  Clock,
  Compass,
  MapPin,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Users,
  Utensils,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import DestinationDetailModal from '@/components/DestinationDetailModal';
import type { DestinationDetailTarget } from '@/components/DestinationDetailModal';
import ItineraryMap, { buildScheduleStopId } from '@/components/ItineraryMap';
import type { DayMapTrigger } from '@/components/ItineraryMap';
import ResponsivePhoto from '@/components/ResponsivePhoto';
import { AIClientError, sendAiChatMessage } from '@/services/aiService';
import type { ChatTurn } from '@/services/aiService';
import { searchDestinationPhotos } from '@/services/photoService';
import {
  deleteUserTrip,
  formatFirestoreTripError,
  generateFullTripPlan,
  saveTrip,
  subscribeToUserTrips,
  updateUserTrip,
} from '@/services/tripService';
import type { DestinationPhoto } from '@/types/photo';
import type {
  BudgetBreakdown,
  CurrencyCode,
  PreferredLanguage,
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

type PlannerTab = 'plan' | 'itinerary' | 'trips';

interface PlannerErrorState {
  category: 'auth' | 'ai' | 'save' | 'validation';
  message: string;
  retryAction?: 'generate' | 'save';
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

  // Follow-up AI chat state
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatResponseId, setChatResponseId] = useState<string | undefined>(undefined);
  const [followUpText, setFollowUpText] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // Operation status & errors
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
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

  return (
    <section
      id="planner"
      className="w-full bg-white text-wandor-text border-t border-black/10"
    >
      <div className="max-w-[1200px] mx-auto px-6 py-16 md:py-20">
        {/* Section Header + Segmented Navigation */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between pb-8 border-b border-black/10">
          <div>
            <p className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-wandor-prompt mb-2">
              SAFAR Trip Studio · سفر
            </p>
            <h2 className="font-sans text-[clamp(28px,3.6vw,42px)] font-medium tracking-[-0.03em] text-wandor-text leading-tight">
              Plan, budget &amp; save your journey
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Trip planner views"
            className="inline-flex flex-wrap sm:flex-nowrap items-center gap-1 max-w-full rounded-[20px] sm:rounded-full bg-black/[0.04] p-1 self-start md:self-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'plan'}
              onClick={() => setActiveTab('plan')}
              className={`cursor-pointer rounded-full px-3 sm:px-4 py-2 font-sans text-[11px] sm:text-xs font-medium uppercase tracking-[0.04em] transition-colors whitespace-nowrap ${
                activeTab === 'plan'
                  ? 'bg-wandor-dark text-[#fafafa]'
                  : 'bg-transparent text-wandor-text hover:opacity-65'
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
              className={`cursor-pointer rounded-full px-3 sm:px-4 py-2 font-sans text-[11px] sm:text-xs font-medium uppercase tracking-[0.04em] transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                activeTab === 'itinerary'
                  ? 'bg-wandor-dark text-[#fafafa]'
                  : 'bg-transparent text-wandor-text hover:opacity-65'
              }`}
            >
              Itinerary &amp; Budget
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'trips'}
              onClick={() => setActiveTab('trips')}
              className={`cursor-pointer rounded-full px-3 sm:px-4 py-2 font-sans text-[11px] sm:text-xs font-medium uppercase tracking-[0.04em] transition-colors whitespace-nowrap ${
                activeTab === 'trips'
                  ? 'bg-wandor-dark text-[#fafafa]'
                  : 'bg-transparent text-wandor-text hover:opacity-65'
              }`}
            >
              My Trips ({savedTrips.length})
            </button>
          </div>
        </div>

        {/* Error & Status Alerts */}
        {errorState && (
          <div
            role="alert"
            className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 text-sm text-red-800"
          >
            <span>
              <strong className="font-semibold">
                {errorState.category === 'save'
                  ? 'Trip saving error: '
                  : errorState.category === 'auth'
                    ? 'Sign-in error: '
                    : errorState.category === 'validation'
                      ? 'Check trip details: '
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
            className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-black/10 bg-black/[0.03] px-5 py-3.5 text-sm text-wandor-text"
          >
            <span>{statusMsg}</span>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              className="text-xs font-medium uppercase tracking-[0.04em] text-wandor-muted hover:text-wandor-text"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: PLAN TRIP FORM */}
        {activeTab === 'plan' && (
          <form onSubmit={handleGenerateItinerary} className="mt-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Destination
                </span>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g., Munnar, Kerala"
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Starting Location
                </span>
                <input
                  type="text"
                  maxLength={200}
                  value={startingLocation}
                  onChange={(e) => setStartingLocation(e.target.value)}
                  placeholder="e.g., Kochi"
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Departure Date
                </span>
                <input
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black tabular-nums"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Return Date
                </span>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black tabular-nums"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Travelers
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={travelers}
                  onChange={(e) => setTravelers(Number(e.target.value))}
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black tabular-nums"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Duration (Days)
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Number(e.target.value))}
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black tabular-nums"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Target Budget
                </span>
                <input
                  type="number"
                  min={0}
                  step="100"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(Number(e.target.value))}
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black tabular-nums"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Currency
                </span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black"
                >
                  {CURRENCIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                  Language
                </span>
                <select
                  value={language}
                  onChange={(e) =>
                    setLanguage(e.target.value as PreferredLanguage)
                  }
                  className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black"
                >
                  <option value="auto">Auto (English / Malayalam)</option>
                  <option value="en">English</option>
                  <option value="ml">Malayalam (മലയാളം)</option>
                </select>
              </label>
            </div>

            {/* Travel Style */}
            <div className="space-y-3">
              <span className="block text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                Travel Style
              </span>
              <div className="flex flex-wrap gap-2.5">
                {TRAVEL_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setTravelStyle(style.id)}
                    className={`cursor-pointer rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] transition-colors ${
                      travelStyle === style.id
                        ? 'bg-wandor-dark text-[#fafafa]'
                        : 'border border-black/15 bg-white text-wandor-text hover:bg-black/5'
                    }`}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Interests */}
            <div className="space-y-3">
              <span className="block text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
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
                      className={`cursor-pointer rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                        selected
                          ? 'border border-wandor-prompt bg-wandor-prompt/10 text-wandor-prompt'
                          : 'border border-black/15 bg-white text-wandor-muted hover:text-wandor-text'
                      }`}
                    >
                      {interest}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Additional notes / Malayalam or English prompt */}
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                Preferences or Custom Request (English or Malayalam / മലയാളം)
              </span>
              <textarea
                rows={3}
                maxLength={2000}
                value={promptNotes}
                onChange={(e) => setPromptNotes(e.target.value)}
                placeholder="Tell Safar anything specific — e.g., vegetarian cafes, kid-friendly pacing, avoiding weekend crowds, or write in മലയാളം..."
                className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm text-wandor-text outline-none focus:border-black resize-y"
              />
            </label>

            {isGenerating && (
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-black/10 bg-black/[0.03] px-5 py-4"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-wandor-text">
                    {GENERATION_LOADING_MESSAGES[loadingStageIndex]}
                  </p>
                  <p className="text-xs text-wandor-muted">
                    {loadingStageIndex === 0
                      ? 'Preparing routes, visiting hours, and local recommendations.'
                      : loadingStageIndex === 1
                        ? 'Balancing travel times and realistic budget estimates.'
                        : 'Finalizing your Safar schedule and map stops.'}
                  </p>
                </div>
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-wandor-prompt shrink-0">
                  SAFAR · سفر
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-wandor-muted">
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
                    className="md:hidden cursor-pointer font-medium text-wandor-text underline hover:opacity-70 disabled:opacity-50"
                  >
                    Sign out
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={isGenerating || authLoading}
                className="cursor-pointer rounded-full bg-wandor-dark px-7 py-3.5 font-sans text-sm font-medium uppercase tracking-[0.04em] text-[#fafafa] transition-all hover:bg-[#333] active:scale-95 disabled:opacity-60"
              >
                {isGenerating ? 'SAFAR is planning...' : 'Generate Itinerary'}
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: ITINERARY & BUDGET */}
        {activeTab === 'itinerary' && activePlan && (
          <div className="mt-8 space-y-10">
            {/* Trip Overview & Persistence Controls */}
            <div className="rounded-[28px] border border-black/10 p-6 md:p-8 space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.04em] text-wandor-muted">
                    <span className="inline-flex items-center gap-1 text-wandor-prompt">
                      <MapPin className="w-3.5 h-3.5" />
                      {activePlan.destination}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      {activePlan.dailyItinerary.length} Days
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Users className="w-3.5 h-3.5" />
                      {activeInput?.travelers ?? travelers} Travelers
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{activeInput?.travelStyle ?? travelStyle}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activePlan.language === 'ml' ? 'മലയാളം' : 'English'}</span>
                  </div>

                  <input
                    type="text"
                    value={tripTitle}
                    onChange={(e) => setTripTitle(e.target.value)}
                    maxLength={200}
                    aria-label="Trip title"
                    className="w-full font-sans text-2xl md:text-3xl font-medium tracking-[-0.02em] text-wandor-text bg-transparent border-b border-transparent focus:border-black/20 outline-none pb-1"
                  />

                  <p className="text-base text-wandor-muted leading-relaxed">
                    {activePlan.tripSummary}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <select
                    aria-label="Trip status"
                    value={tripStatus}
                    onChange={(e) => setTripStatus(e.target.value as TripStatus)}
                    className="rounded-full border border-black/15 bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text outline-none"
                  >
                    <option value="draft">Draft</option>
                    <option value="planned">Planned</option>
                    <option value="archived">Archived</option>
                  </select>

                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSaveOrUpdateTrip}
                    className="cursor-pointer rounded-full bg-wandor-dark px-5 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] transition-all hover:bg-[#333] disabled:opacity-60"
                  >
                    {isSaving
                      ? 'Saving...'
                      : editingTripId
                        ? 'Save Changes'
                        : 'Save Trip'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('plan')}
                    className="cursor-pointer rounded-full border border-black/15 bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5"
                  >
                    Edit Inputs
                  </button>
                </div>
              </div>

              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted mb-2">
                  Personal Notes
                </span>
                <input
                  type="text"
                  maxLength={2000}
                  value={tripNotes}
                  onChange={(e) => setTripNotes(e.target.value)}
                  placeholder="Add booking reminders, packing notes, or custom edits..."
                  className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-4 py-2.5 text-sm text-wandor-text outline-none focus:border-black/30"
                />
              </label>

              {/* Connected Destination Photo Gallery Strip */}
              {(destPhotosLoading || destPhotos.length > 0) && (
                <div className="pt-4 border-t border-black/10 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                      <Camera className="w-3.5 h-3.5 text-wandor-prompt" />
                      Destination Photography · {activePlan.destination}
                    </span>
                    {destPhotos.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPhotoModalTarget({
                            name: activePlan.destination,
                            query:
                              activeInput?.destination?.trim() ||
                              activePlan.destination,
                            initialPhotos: destPhotos,
                          })
                        }
                        className="cursor-pointer text-xs font-medium text-wandor-prompt hover:underline"
                      >
                        View Gallery ({destPhotos.length})
                      </button>
                    )}
                  </div>

                  {destPhotosLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Array.from({ length: 4 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="aspect-[4/3] rounded-xl animate-pulse bg-black/[0.06]"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {destPhotos.slice(0, 4).map((photo, idx) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() =>
                            setPhotoModalTarget({
                              name: activePlan.destination,
                              query:
                                activeInput?.destination?.trim() ||
                                activePlan.destination,
                              initialPhotos: destPhotos,
                              initialIndex: idx,
                            })
                          }
                          className="cursor-pointer group rounded-xl overflow-hidden border border-black/10 text-left"
                        >
                          <ResponsivePhoto
                            photo={photo}
                            fallbackLabel={photo.title}
                            aspectClassName="aspect-[4/3]"
                            sizes="(max-width: 768px) 45vw, 240px"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Budget Planner */}
            <div className="rounded-[28px] border border-black/10 p-6 md:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <Wallet className="w-5 h-5 text-wandor-prompt" />
                  <h3 className="text-xl font-medium tracking-[-0.02em] text-wandor-text">
                    Budget Planner ({activePlan.currency})
                  </h3>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs uppercase tracking-[0.04em] text-wandor-muted">
                    Total Estimated Cost
                  </p>
                  <p className="text-2xl font-semibold text-wandor-text tabular-nums">
                    {formatMoney(activePlan.totalEstimatedBudget, activePlan.currency)}
                  </p>
                  {budgetAmount > 0 && (
                    <p className="text-xs text-wandor-muted tabular-nums">
                      Target budget: {formatMoney(budgetAmount, activePlan.currency)}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {(
                  [
                    ['accommodation', 'Accommodation'],
                    ['food', 'Food & Dining'],
                    ['transportation', 'Transportation'],
                    ['activities', 'Activities'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="rounded-2xl border border-black/10 p-4 flex flex-col gap-2"
                  >
                    <span className="text-xs font-medium uppercase tracking-[0.04em] text-wandor-muted">
                      {label}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={activePlan.budgetBreakdown[key]}
                      onChange={(e) => handleBudgetFieldChange(key, e.target.value)}
                      className="font-sans text-lg font-medium text-wandor-text bg-transparent outline-none tabular-nums"
                    />
                  </label>
                ))}
              </div>

              <p className="text-xs text-wandor-muted">
                {activePlan.budgetBreakdown.disclaimer}
              </p>
            </div>

            {/* Interactive Itinerary Map */}
            <ItineraryMap
              plan={activePlan}
              selectedDay={selectedMapDay}
              onSelectDay={setSelectedMapDay}
              selectedStopId={selectedMapStopId}
              onSelectStop={setSelectedMapStopId}
              dayTrigger={mapDayTrigger}
              onJumpToScheduleSlot={(_day, stopId) => {
                setHighlightedSlotId(stopId);
                document
                  .getElementById(stopId)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />

            {/* Day-by-Day Itinerary */}
            <div className="space-y-5">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-5 h-5 text-wandor-prompt" />
                <h3 className="text-xl font-medium tracking-[-0.02em] text-wandor-text">
                  Day-by-Day Schedule
                </h3>
              </div>

              <div className="space-y-4">
                {activePlan.dailyItinerary.map((day) => {
                  const isDayFocused = selectedMapDay === day.day;
                  return (
                    <div
                      key={day.day}
                      className={`rounded-[24px] border p-6 space-y-4 transition-colors ${
                        isDayFocused
                          ? 'border-wandor-prompt/50 ring-1 ring-wandor-prompt/20'
                          : 'border-black/10'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-black/10">
                        <button
                          type="button"
                          onClick={() => focusDayOnMap(day.day)}
                          className="cursor-pointer text-left group"
                        >
                          <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-prompt tabular-nums group-hover:underline">
                            Day {day.day}
                            {day.date ? ` · ${day.date}` : ''}
                          </span>
                          <h4 className="text-lg font-medium text-wandor-text group-hover:text-wandor-prompt transition-colors">
                            {day.theme}
                          </h4>
                        </button>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-wandor-muted">
                            Est. transit: {day.estimatedTravelTime}
                          </span>
                          <button
                            type="button"
                            onClick={() => focusDayOnMap(day.day)}
                            className={`cursor-pointer inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.04em] transition-colors ${
                              isDayFocused
                                ? 'bg-wandor-dark text-[#fafafa]'
                                : 'border border-black/15 text-wandor-text hover:bg-black/5'
                            }`}
                          >
                            <MapPin
                              className={`w-3 h-3 ${
                                isDayFocused ? 'text-[#fafafa]' : 'text-wandor-prompt'
                              }`}
                            />
                            Day {day.day} Map
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {day.schedule.map((slot, idx) => {
                          const slotStopId = buildScheduleStopId(day.day, idx);
                          const isHighlighted =
                            highlightedSlotId === slotStopId ||
                            selectedMapStopId === slotStopId;

                          return (
                            <div
                              key={slotStopId}
                              id={slotStopId}
                              className={`grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2 md:gap-6 py-2.5 px-2 -mx-2 rounded-xl border-b border-black/5 last:border-b-0 transition-colors ${
                                isHighlighted ? 'bg-wandor-prompt/[0.06]' : ''
                              }`}
                            >
                              <div className="text-xs font-semibold text-wandor-text tabular-nums">
                                <div>{slot.time}</div>
                                {slot.travelTimeFromPrev && (
                                  <div className="text-wandor-muted font-normal mt-0.5">
                                    {slot.travelTimeFromPrev}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <p className="text-sm font-medium text-wandor-text">
                                    {slot.activity}
                                  </p>
                                  <div className="flex items-center gap-2.5">
                                    {slot.estimatedCost > 0 && (
                                      <span className="text-xs font-medium text-wandor-muted tabular-nums">
                                        ~{formatMoney(slot.estimatedCost, activePlan.currency)}
                                      </span>
                                    )}
                                    {(slot.location || slot.activity) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMapDayTrigger(null);
                                          setSelectedMapDay(day.day);
                                          setSelectedMapStopId(slotStopId);
                                          setHighlightedSlotId(slotStopId);
                                          document
                                            .getElementById('itinerary-map')
                                            ?.scrollIntoView({
                                              behavior: 'smooth',
                                              block: 'start',
                                            });
                                        }}
                                        className="cursor-pointer inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.04em] text-wandor-prompt hover:underline"
                                      >
                                        <MapPin className="w-3 h-3" />
                                        Map
                                      </button>
                                    )}
                                  </div>
                                </div>
                              <p className="text-xs text-wandor-muted">
                                {slot.location}
                                {slot.visitingHours ? ` · Hours: ${slot.visitingHours}` : ''}
                              </p>
                              {slot.notes && (
                                <p className="text-xs text-wandor-muted leading-relaxed">
                                  {slot.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Attractions, Stays, Food */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="rounded-[24px] border border-black/10 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-wandor-prompt" />
                  <h3 className="text-base font-medium text-wandor-text">
                    Key Attractions
                  </h3>
                </div>
                <div className="space-y-5">
                  {activePlan.attractions.map((item, idx) => {
                    const attrPhoto = attractionPhotos[item.name] ?? null;
                    return (
                      <div key={`${item.name}-${idx}`} className="space-y-2">
                        {attrPhoto && (
                          <button
                            type="button"
                            onClick={() =>
                              setPhotoModalTarget({
                                name: item.name,
                                query: `${item.name} ${activePlan.destination}`,
                                subtitle: `Recommended in ${activePlan.destination}`,
                                category: 'landmarks',
                                initialPhotos: [attrPhoto],
                              })
                            }
                            className="cursor-pointer group block w-full rounded-xl overflow-hidden border border-black/10 text-left"
                          >
                            <ResponsivePhoto
                              photo={attrPhoto}
                              fallbackLabel={item.name}
                              aspectClassName="aspect-[16/10]"
                              sizes="(max-width: 1024px) 90vw, 340px"
                            />
                          </button>
                        )}
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-wandor-text">
                            {item.name}
                          </p>
                          <p className="text-xs text-wandor-muted">
                            Best time: {item.bestTimeToVisit} · {item.estimatedDuration}
                          </p>
                          <p className="text-xs text-wandor-muted leading-relaxed">
                            {item.description}
                          </p>
                          {attrPhoto && (
                            <p className="text-[11px] text-wandor-muted">
                              Photo by{' '}
                              <a
                                href={attrPhoto.attribution.photographerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-wandor-text"
                              >
                                {attrPhoto.attribution.photographerName}
                              </a>{' '}
                              on{' '}
                              <a
                                href={attrPhoto.attribution.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-wandor-text"
                              >
                                {attrPhoto.attribution.sourceName}
                              </a>
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[24px] border border-black/10 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-wandor-prompt" />
                  <h3 className="text-base font-medium text-wandor-text">
                    Stay Suggestions
                  </h3>
                </div>
                <div className="space-y-4">
                  {activePlan.accommodationSuggestions.map((stay, idx) => (
                    <div key={`${stay.name}-${idx}`} className="space-y-1">
                      <p className="text-sm font-medium text-wandor-text">
                        {stay.name}
                      </p>
                      <p className="text-xs text-wandor-muted">
                        {stay.area} · {stay.tier} · {stay.approximateNightlyRange}
                      </p>
                      <p className="text-xs text-wandor-muted leading-relaxed">
                        {stay.notes}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-black/10 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-wandor-prompt" />
                  <h3 className="text-base font-medium text-wandor-text">
                    Food Recommendations
                  </h3>
                </div>
                <div className="space-y-4">
                  {activePlan.foodRecommendations.map((food, idx) => (
                    <div key={`${food.dishOrSpot}-${idx}`} className="space-y-1">
                      <p className="text-sm font-medium text-wandor-text">
                        {food.dishOrSpot}
                      </p>
                      <p className="text-xs text-wandor-muted">
                        {food.type} · {food.area} · {food.approximateCostRange}
                      </p>
                      <p className="text-xs text-wandor-muted leading-relaxed">
                        {food.notes}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Travel Tips & Contextual Follow-up Chat */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-[24px] border border-black/10 p-6 space-y-3">
                <h3 className="text-base font-medium text-wandor-text">
                  Travel Tips
                </h3>
                <ul className="space-y-2 text-sm text-wandor-muted list-disc pl-5">
                  {activePlan.travelTips.map((tip, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-[24px] border border-black/10 p-6 space-y-4">
                <h3 className="text-base font-medium text-wandor-text">
                  Ask SAFAR AI Follow-Ups (English / മലയാളം)
                </h3>

                {chatHistory.length > 0 && (
                  <div className="max-h-[220px] space-y-2.5 overflow-y-auto pr-1">
                    {chatHistory.map((turn, idx) => (
                      <div
                        key={`${turn.role}-${idx}`}
                        className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                          turn.role === 'user'
                            ? 'bg-black/5 font-medium text-wandor-text'
                            : 'border border-black/10 bg-white text-wandor-text'
                        }`}
                      >
                        {turn.content}
                      </div>
                    ))}
                  </div>
                )}

                {activePlan.suggestedFollowUps.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {activePlan.suggestedFollowUps.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={followUpLoading}
                        onClick={() => void handleFollowUp(q)}
                        className="cursor-pointer rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs text-wandor-text hover:bg-black/5 disabled:opacity-50 text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleFollowUp(followUpText);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={followUpText}
                    onChange={(e) => setFollowUpText(e.target.value)}
                    placeholder="Ask a follow-up question..."
                    disabled={followUpLoading}
                    className="flex-1 rounded-full border border-black/15 px-4 py-2.5 text-sm text-wandor-text outline-none focus:border-black"
                  />
                  <button
                    type="submit"
                    disabled={followUpLoading || !followUpText.trim()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-wandor-dark px-5 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333] disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {followUpLoading ? 'Sending...' : 'Ask'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SAVED TRIPS (FIRESTORE) */}
        {activeTab === 'trips' && (
          <div className="mt-8">
            {!authReady || tripsLoading ? (
              <p className="py-12 text-center text-sm text-wandor-muted">
                Loading your trips...
              </p>
            ) : !user ? (
              <div className="rounded-[28px] border border-black/10 p-10 text-center space-y-4">
                <p className="text-base font-medium text-wandor-text">
                  Sign in to view and manage your saved trips
                </p>
                <p className="text-sm text-wandor-muted max-w-md mx-auto">
                  Your itineraries and budget plans are securely stored in your private Safar account.
                </p>
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => void signInWithGoogle()}
                  className="cursor-pointer rounded-full bg-wandor-dark px-6 py-3 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333] disabled:opacity-50"
                >
                  {authLoading ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </div>
            ) : savedTrips.length === 0 ? (
              <div className="rounded-[28px] border border-black/10 p-10 text-center space-y-4">
                <p className="text-base font-medium text-wandor-text">
                  No saved trips yet
                </p>
                <p className="text-sm text-wandor-muted">
                  Generate an itinerary in the Plan Trip tab and click Save Trip to store it here.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('plan')}
                  className="cursor-pointer rounded-full bg-wandor-dark px-6 py-3 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333]"
                >
                  Plan Your First Trip
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {savedTrips.map((trip) => (
                  <div
                    key={trip.id}
                    className="rounded-[24px] border border-black/10 p-6 flex flex-col justify-between gap-5"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.04em] text-wandor-muted">
                        <span className="text-wandor-prompt font-semibold">
                          {trip.destination}
                        </span>
                        <span className="tabular-nums">
                          {trip.durationDays}d · {trip.travelers} travelers ·{' '}
                          {trip.status}
                        </span>
                      </div>

                      <h3 className="text-xl font-medium text-wandor-text">
                        {trip.title}
                      </h3>

                      <p className="text-sm text-wandor-muted line-clamp-3 leading-relaxed">
                        {trip.tripSummary}
                      </p>

                      <p className="text-sm font-medium text-wandor-text tabular-nums pt-1">
                        Est. Budget:{' '}
                        {formatMoney(trip.totalEstimatedBudget, trip.currency)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-black/10">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleLoadTrip(trip, false)}
                          className="cursor-pointer rounded-full bg-wandor-dark px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333]"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoadTrip(trip, true)}
                          className="cursor-pointer inline-flex items-center gap-1 rounded-full border border-black/15 px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                      </div>

                      {confirmDeleteId === trip.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isDeletingId === trip.id}
                            onClick={() => void handleDeleteTrip(trip.id)}
                            className="cursor-pointer rounded-full bg-red-700 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.04em] text-white hover:bg-red-800 disabled:opacity-50"
                          >
                            {isDeletingId === trip.id ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="cursor-pointer text-xs text-wandor-muted hover:text-wandor-text"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(trip.id)}
                          aria-label={`Delete ${trip.title}`}
                          className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium uppercase tracking-[0.04em] text-wandor-muted hover:text-red-700"
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
          </div>
        )}
      </div>

      <DestinationDetailModal
        target={photoModalTarget}
        onClose={() => setPhotoModalTarget(null)}
      />
    </section>
  );
}
