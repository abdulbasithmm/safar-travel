import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BedDouble,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudSun,
  Compass,
  Download,
  Gem,
  Globe,
  Loader2,
  MapPin,
  MessageSquareText,
  Pencil,
  Printer,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
} from 'lucide-react';
import type { DestinationDetailTarget } from '@/components/DestinationDetailModal';
import ItineraryMap, { buildScheduleStopId } from '@/components/ItineraryMap';
import type { DayMapTrigger } from '@/components/ItineraryMap';
import ResponsivePhoto from '@/components/ResponsivePhoto';
import type { ChatTurn } from '@/services/aiService';
import type { DestinationPhoto } from '@/types/photo';
import type {
  BudgetBreakdown,
  CurrencyCode,
  StructuredTripPlan,
  TripPlanInput,
  TripStatus,
} from '@/types/trip';

interface ItineraryResultsViewProps {
  activePlan: StructuredTripPlan;
  activeInput: TripPlanInput | null;
  activeCountry: string;
  tripTitle: string;
  onTripTitleChange: (next: string) => void;
  tripStatus: TripStatus;
  onTripStatusChange: (next: TripStatus) => void;
  tripNotes: string;
  onTripNotesChange: (next: string) => void;
  travelers: number;
  travelStyle: TripPlanInput['travelStyle'];
  budgetAmount: number;
  editingTripId: string | null;
  isSaving: boolean;
  isExportingPdf: boolean;
  destPhotos: DestinationPhoto[];
  destPhotosLoading: boolean;
  attractionPhotos: Record<string, DestinationPhoto | null>;
  selectedMapDay: number | 'all';
  onSelectMapDay: (day: number | 'all') => void;
  selectedMapStopId: string | null;
  onSelectMapStopId: (stopId: string | null) => void;
  highlightedSlotId: string | null;
  onHighlightSlotId: (slotId: string | null) => void;
  mapDayTrigger: DayMapTrigger | null;
  onSetMapDayTrigger: (trigger: DayMapTrigger | null) => void;
  onFocusDayOnMap: (dayNumber: number) => void;
  onBudgetFieldChange: (
    field: keyof Pick<
      BudgetBreakdown,
      'accommodation' | 'food' | 'transportation' | 'activities'
    >,
    rawVal: string,
  ) => void;
  onSaveOrUpdateTrip: () => Promise<void>;
  onDownloadPdf: () => Promise<void>;
  onOpenShareModal: () => void;
  onPrintTrip: () => void;
  onEditTrip: () => void;
  onPlanAnotherTrip: () => void;
  onOpenPhotoModal: (target: DestinationDetailTarget) => void;
  chatHistory: ChatTurn[];
  followUpText: string;
  onFollowUpTextChange: (next: string) => void;
  followUpLoading: boolean;
  onFollowUp: (questionText: string) => Promise<void>;
  formatMoney: (amount: number, currency: CurrencyCode) => string;
}

const BUDGET_CATEGORIES: ReadonlyArray<{
  key: keyof Pick<
    BudgetBreakdown,
    'accommodation' | 'food' | 'transportation' | 'activities'
  >;
  label: string;
  color: string;
  dotClass: string;
}> = [
  {
    key: 'accommodation',
    label: 'Accommodation',
    color: '#0F2544',
    dotClass: 'bg-safar-navy',
  },
  {
    key: 'food',
    label: 'Food & Dining',
    color: '#F97316',
    dotClass: 'bg-safar-orange',
  },
  {
    key: 'transportation',
    label: 'Transportation',
    color: '#2B5B84',
    dotClass: 'bg-[#2B5B84]',
  },
  {
    key: 'activities',
    label: 'Activities',
    color: '#F59E0B',
    dotClass: 'bg-amber-500',
  },
];

function getTipMeta(tip: string, index: number) {
  const lower = tip.toLowerCase();
  if (/weather|rain|coat|pack|layer|shoes|umbrella|cold|sun/.test(lower)) {
    return { Icon: CloudSun, label: 'Weather & Packing' };
  }
  if (/cash|card|atm|currency|upi|tip|budget|ticket|fee/.test(lower)) {
    return { Icon: Wallet, label: 'Money & Tickets' };
  }
  if (/bus|train|taxi|auto|cab|drive|traffic|route|early|start/.test(lower)) {
    return { Icon: Compass, label: 'Getting Around' };
  }
  if (/food|water|eat|cafe|restaurant|local|spice|dish/.test(lower)) {
    return { Icon: Utensils, label: 'Dining & Local' };
  }
  if (/safe|respect|dress|temple|permit|book|advance|hours/.test(lower)) {
    return { Icon: ShieldCheck, label: 'Local Etiquette' };
  }
  const fallbackLabels = [
    'Travel Note',
    'Smart Planning',
    'Local Advice',
    'Timing Tip',
  ];
  return {
    Icon: Sparkles,
    label: fallbackLabels[index % fallbackLabels.length],
  };
}

export default function ItineraryResultsView({
  activePlan,
  activeInput,
  activeCountry,
  tripTitle,
  onTripTitleChange,
  tripStatus,
  onTripStatusChange,
  tripNotes,
  onTripNotesChange,
  travelers,
  travelStyle,
  budgetAmount,
  editingTripId,
  isSaving,
  isExportingPdf,
  destPhotos,
  destPhotosLoading,
  attractionPhotos,
  selectedMapDay,
  onSelectMapDay,
  selectedMapStopId,
  onSelectMapStopId,
  highlightedSlotId,
  onHighlightSlotId,
  mapDayTrigger,
  onSetMapDayTrigger,
  onFocusDayOnMap,
  onBudgetFieldChange,
  onSaveOrUpdateTrip,
  onDownloadPdf,
  onOpenShareModal,
  onPrintTrip,
  onEditTrip,
  onPlanAnotherTrip,
  onOpenPhotoModal,
  chatHistory,
  followUpText,
  onFollowUpTextChange,
  followUpLoading,
  onFollowUp,
  formatMoney,
}: ItineraryResultsViewProps) {
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({});
  const [discoverFilter, setDiscoverFilter] = useState<
    'all' | 'attractions' | 'stays' | 'food' | 'gems'
  >('all');
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const initial: Record<number, boolean> = {};
    for (const d of activePlan.dailyItinerary) {
      initial[d.day] = true;
    }
    setExpandedDays(initial);
  }, [activePlan]);

  useEffect(() => {
    const el = titleInputRef.current;
    if (!el) return;
    const adjust = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    adjust();
    window.addEventListener('resize', adjust);
    return () => window.removeEventListener('resize', adjust);
  }, [tripTitle]);

  const effectiveTravelers = activeInput?.travelers ?? travelers;
  const effectiveStyle = activeInput?.travelStyle ?? travelStyle;
  const departureDate = activeInput?.departureDate ?? '';
  const returnDate = activeInput?.returnDate ?? '';
  const destQuery =
    activeInput?.destination?.trim() || activePlan.destination.trim();

  const heroPhoto = destPhotos[0] ?? null;
  const galleryPreviewPhotos = destPhotos.slice(1, 4);

  const toggleDay = (dayNumber: number) => {
    setExpandedDays((prev) => ({
      ...prev,
      [dayNumber]: !(prev[dayNumber] ?? true),
    }));
  };

  const areAllDaysExpanded = activePlan.dailyItinerary.every(
    (d) => expandedDays[d.day] ?? true,
  );

  const handleToggleAllDays = () => {
    const nextState = !areAllDaysExpanded;
    const updated: Record<number, boolean> = {};
    for (const d of activePlan.dailyItinerary) {
      updated[d.day] = nextState;
    }
    setExpandedDays(updated);
  };

  const budgetDifference =
    budgetAmount > 0 ? budgetAmount - activePlan.totalEstimatedBudget : null;
  const isOverBudget = budgetDifference !== null && budgetDifference < 0;
  const targetUtilizationPct =
    budgetAmount > 0
      ? Math.min(
          100,
          Math.round((activePlan.totalEstimatedBudget / budgetAmount) * 100),
        )
      : 0;

  // Build SVG donut chart slices cleanly from exact breakdown figures
  const donutSegments = useMemo(() => {
    const total = Math.max(0, activePlan.totalEstimatedBudget);
    const radius = 58;
    const circumference = 2 * Math.PI * radius;
    let cumulativeFraction = 0;

    return BUDGET_CATEGORIES.map((cat) => {
      const value = Math.max(0, activePlan.budgetBreakdown[cat.key] || 0);
      const fraction = total > 0 ? value / total : 0.25;
      const strokeLength = fraction * circumference;
      const dashOffset = -cumulativeFraction * circumference;
      cumulativeFraction += fraction;
      return {
        ...cat,
        value,
        percentage: total > 0 ? Math.round(fraction * 100) : 0,
        strokeLength,
        dashOffset,
        circumference,
      };
    });
  }, [activePlan.budgetBreakdown, activePlan.totalEstimatedBudget]);

  // Extract genuine Hidden Gems & Local Experiences directly from generated schedule slots
  // without inventing fake venues or ratings
  const { hiddenGems, localExperiences } = useMemo(() => {
    const topAttractionNames = new Set(
      activePlan.attractions.slice(0, 2).map((a) => a.name.toLowerCase()),
    );

    const allSlots = activePlan.dailyItinerary.flatMap((day) =>
      day.schedule.map((slot, idx) => ({
        day: day.day,
        stopId: buildScheduleStopId(day.day, idx),
        slot,
      })),
    );

    const gemRegex =
      /hidden|quiet|viewpoint|secret|village|trail|waterfall|tea|garden|sunset|sunrise|heritage|walk|lake|backwater|beach|cove/i;
    const expRegex =
      /cafe|market|spice|craft|cruise|boat|museum|cook|tasting|cultural|art|kayak|trek|festival|street/i;

    const gems: typeof allSlots = [];
    const experiences: typeof allSlots = [];
    const seenLocations = new Set<string>();

    for (const entry of allSlots) {
      const hay = `${entry.slot.activity} ${entry.slot.location} ${entry.slot.notes}`;
      const locKey = (entry.slot.location || entry.slot.activity).toLowerCase();
      if (seenLocations.has(locKey)) continue;

      const matchesTop = Array.from(topAttractionNames).some(
        (name) => name && locKey.includes(name),
      );

      if (gemRegex.test(hay) && !matchesTop && gems.length < 4) {
        gems.push(entry);
        seenLocations.add(locKey);
      } else if (expRegex.test(hay) && experiences.length < 4) {
        experiences.push(entry);
        seenLocations.add(locKey);
      }
    }

    // Fill gracefully from remaining authentic schedule items if regex matched fewer than 2
    for (const entry of allSlots) {
      const locKey = (entry.slot.location || entry.slot.activity).toLowerCase();
      if (seenLocations.has(locKey)) continue;
      if (gems.length < 2) {
        gems.push(entry);
        seenLocations.add(locKey);
      } else if (experiences.length < 2) {
        experiences.push(entry);
        seenLocations.add(locKey);
      }
      if (gems.length >= 2 && experiences.length >= 2) break;
    }

    return { hiddenGems: gems, localExperiences: experiences };
  }, [activePlan.attractions, activePlan.dailyItinerary]);

  const jumpToScheduleStop = (dayNum: number, stopId: string) => {
    onSetMapDayTrigger(null);
    onSelectMapDay(dayNum);
    onSelectMapStopId(stopId);
    onHighlightSlotId(stopId);
    document
      .getElementById('itinerary-map')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mt-8 space-y-10">
      {/* 1. TRIP OVERVIEW — LUXURY HERO */}
      <article className="rounded-[28px] border border-[#E7E1D6] bg-gradient-to-br from-[#FCF9F3] via-white to-[#F4F9FF]/60 p-6 md:p-8 shadow-[0_14px_40px_rgba(15,37,68,0.06)] safar-print-card">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Column: Destination Story, KPIs & Actions */}
          <div className="lg:col-span-7 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              {/* Quiet Editorial Metadata Line (No static pill clutter) */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-semibold uppercase tracking-[0.06em] text-safar-slate">
                <span className="inline-flex items-center gap-1.5 text-safar-orange">
                  <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {activePlan.destination}
                  {activeCountry &&
                  !activePlan.destination
                    .toLowerCase()
                    .includes(activeCountry.toLowerCase())
                    ? `, ${activeCountry}`
                    : ''}
                </span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{effectiveStyle} Escape</span>
                <span aria-hidden="true">·</span>
                <span>
                  {activePlan.language === 'ml' ? 'മലയാളം' : 'English'}
                </span>
                {(departureDate || returnDate) && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {departureDate || 'Flexible'}
                      {returnDate ? ` → ${returnDate}` : ''}
                    </span>
                  </>
                )}
              </div>

              {/* Editable Display Trip Title (auto-wraps cleanly on tablet/mobile) */}
              <div className="space-y-2">
                <textarea
                  ref={titleInputRef}
                  rows={1}
                  value={tripTitle}
                  onChange={(e) =>
                    onTripTitleChange(e.target.value.replace(/\r?\n/g, ' '))
                  }
                  maxLength={200}
                  aria-label="Trip title"
                  className="w-full resize-none overflow-hidden font-sans text-2xl sm:text-3xl md:text-4xl font-semibold tracking-[-0.03em] text-safar-navy bg-transparent border-b border-transparent focus:border-safar-navy/30 outline-none pb-1 leading-[1.15]"
                />
                <p className="text-base text-safar-slate leading-relaxed max-w-[65ch]">
                  {activePlan.tripSummary}
                </p>
              </div>
            </div>

            {/* 4-Metric Luxury Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="rounded-2xl border border-[#E7E1D6] bg-white px-4 py-3.5 space-y-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate">
                  <Clock className="w-3 h-3 text-safar-orange" aria-hidden="true" />
                  Duration
                </span>
                <p className="text-lg font-semibold text-safar-navy tabular-nums">
                  {activePlan.dailyItinerary.length}{' '}
                  {activePlan.dailyItinerary.length === 1 ? 'Day' : 'Days'}
                </p>
              </div>

              <div className="rounded-2xl border border-[#E7E1D6] bg-white px-4 py-3.5 space-y-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate">
                  <Users className="w-3 h-3 text-safar-orange" aria-hidden="true" />
                  Travelers
                </span>
                <p className="text-lg font-semibold text-safar-navy tabular-nums">
                  {effectiveTravelers}{' '}
                  {effectiveTravelers === 1 ? 'Guest' : 'Guests'}
                </p>
              </div>

              <div className="rounded-2xl border border-[#E7E1D6] bg-white px-4 py-3.5 space-y-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate">
                  <Compass className="w-3 h-3 text-safar-orange" aria-hidden="true" />
                  Style
                </span>
                <p className="text-lg font-semibold text-safar-navy capitalize truncate">
                  {effectiveStyle}
                </p>
              </div>

              <div className="rounded-2xl border border-[#E7E1D6] bg-[#FCF9F3] px-4 py-3.5 space-y-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate">
                  <Wallet className="w-3 h-3 text-safar-orange" aria-hidden="true" />
                  Est. Total
                </span>
                <p className="text-lg font-semibold text-safar-navy tabular-nums">
                  {formatMoney(
                    activePlan.totalEstimatedBudget,
                    activePlan.currency,
                  )}
                </p>
              </div>
            </div>

            {/* Action Bar + Personal Notes */}
            <div className="space-y-4">
              <div
                data-print-hide="true"
                className="flex flex-wrap items-center gap-2.5"
              >
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void onSaveOrUpdateTrip()}
                  className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-safar-navy px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[0_8px_20px_rgba(15,37,68,0.18)] transition-all duration-200 hover:bg-safar-navyHover disabled:opacity-60 whitespace-nowrap"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                  )}
                  {isSaving
                    ? 'Saving...'
                    : editingTripId
                      ? 'Save Changes'
                      : 'Save Trip'}
                </button>

                <button
                  type="button"
                  disabled={isExportingPdf}
                  onClick={() => void onDownloadPdf()}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-safar-orange px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[0_8px_18px_rgba(249,115,22,0.22)] transition-all duration-200 hover:bg-safar-orangeHover disabled:opacity-60 whitespace-nowrap"
                >
                  {isExportingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {isExportingPdf ? 'Exporting PDF...' : 'Download PDF'}
                </button>

                <button
                  type="button"
                  onClick={onOpenShareModal}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-[#DFD8CA] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy transition-colors duration-200 hover:bg-[#FCF9F3] whitespace-nowrap"
                >
                  <Share2 className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                  Share Trip
                </button>

                <button
                  type="button"
                  onClick={onEditTrip}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-[#DFD8CA] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy transition-colors duration-200 hover:bg-[#FCF9F3] whitespace-nowrap"
                >
                  <Pencil className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                  Edit Trip
                </button>

                <button
                  type="button"
                  onClick={onPrintTrip}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-[#DFD8CA] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy transition-colors duration-200 hover:bg-[#FCF9F3] whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5 text-safar-slate" aria-hidden="true" />
                  Print Trip
                </button>

                <select
                  aria-label="Trip status"
                  value={tripStatus}
                  onChange={(e) =>
                    onTripStatusChange(e.target.value as TripStatus)
                  }
                  className="rounded-full border border-[#DFD8CA] bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy outline-none"
                >
                  <option value="draft">Draft</option>
                  <option value="planned">Planned</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              <label
                data-print-hide={tripNotes.trim() ? undefined : 'true'}
                className="block"
              >
                <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate mb-1.5">
                  Personal Notes
                </span>
                <input
                  type="text"
                  maxLength={2000}
                  value={tripNotes}
                  onChange={(e) => onTripNotesChange(e.target.value)}
                  placeholder="Add flight references, packing notes, or custom edits..."
                  className="w-full rounded-xl border border-[#E7E1D6] bg-white px-4 py-2.5 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy"
                />
              </label>
            </div>
          </div>

          {/* Right Column: Large Destination Hero Photograph + Thumbnail Strip */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            {destPhotosLoading ? (
              <div className="flex-1 min-h-[280px] rounded-[22px] animate-pulse bg-[#EFECE5]" />
            ) : heroPhoto ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onOpenPhotoModal({
                      name: activePlan.destination,
                      query: destQuery,
                      initialPhotos: destPhotos,
                      initialIndex: 0,
                    })
                  }
                  className="cursor-pointer group relative flex-1 min-h-[260px] lg:min-h-[320px] rounded-[22px] overflow-hidden border border-[#E7E1D6] text-left shadow-sm"
                >
                  <img
                    src={heroPhoto.url}
                    alt={heroPhoto.title || activePlan.destination}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-safar-navy/85 via-safar-navy/20 to-transparent" />
                  <div className="relative h-full flex flex-col justify-end p-5 text-white">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-orange-300">
                      Featured Destination Photo
                    </p>
                    <p className="text-lg font-semibold leading-snug line-clamp-1">
                      {activePlan.destination}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-white/85">
                      <span className="truncate">
                        Photo by {heroPhoto.attribution.photographerName} on{' '}
                        {heroPhoto.attribution.sourceName}
                      </span>
                      <span
                        data-print-hide="true"
                        className="inline-flex items-center gap-1 font-semibold text-white shrink-0 group-hover:text-orange-200"
                      >
                        <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                        Gallery ({destPhotos.length})
                      </span>
                    </div>
                  </div>
                </button>

                {galleryPreviewPhotos.length > 0 && (
                  <div
                    data-print-hide="true"
                    className="grid grid-cols-3 gap-2.5"
                  >
                    {galleryPreviewPhotos.map((photo, idx) => (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() =>
                          onOpenPhotoModal({
                            name: activePlan.destination,
                            query: destQuery,
                            initialPhotos: destPhotos,
                            initialIndex: idx + 1,
                          })
                        }
                        className="cursor-pointer group rounded-xl overflow-hidden border border-[#E7E1D6] text-left"
                      >
                        <ResponsivePhoto
                          photo={photo}
                          fallbackLabel={photo.title}
                          aspectClassName="aspect-[16/10]"
                          sizes="(max-width: 1024px) 30vw, 150px"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 min-h-[280px] rounded-[22px] border border-[#E7E1D6] bg-gradient-to-br from-safar-sky via-[#FCF9F3] to-white p-8 flex flex-col justify-end">
                <Camera className="w-8 h-8 text-safar-orange mb-3" aria-hidden="true" />
                <p className="text-lg font-semibold text-safar-navy">
                  {activePlan.destination}
                </p>
                <p className="text-xs text-safar-slate mt-1">
                  {activePlan.dailyItinerary.length}-day curated SAFAR itinerary
                </p>
              </div>
            )}
          </div>
        </div>
      </article>

      {/* 2. DAY-BY-DAY EXPANDABLE TIMELINE */}
      <section aria-labelledby="safar-itinerary-days-heading" className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange">
              Curated Schedule
            </p>
            <h3
              id="safar-itinerary-days-heading"
              className="text-2xl md:text-3xl font-semibold tracking-[-0.02em] text-safar-navy flex items-center gap-2.5"
            >
              <Calendar className="w-6 h-6 text-safar-orange shrink-0" aria-hidden="true" />
              Day-by-Day Itinerary
            </h3>
          </div>

          <button
            type="button"
            data-print-hide="true"
            onClick={handleToggleAllDays}
            className="cursor-pointer inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full border border-[#DFD8CA] bg-[#FCF9F3] px-4 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy transition-colors hover:bg-safar-skySoft whitespace-nowrap"
          >
            {areAllDaysExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                Collapse All Days
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                Expand All Days
              </>
            )}
          </button>
        </div>

        <div className="space-y-4">
          {activePlan.dailyItinerary.map((day, dayIdx) => {
            const isExpanded = expandedDays[day.day] ?? true;
            const isDayFocused = selectedMapDay === day.day;
            const dayPhoto =
              destPhotos.length > 0
                ? destPhotos[dayIdx % destPhotos.length]
                : null;

            return (
              <div
                key={day.day}
                className={`rounded-[24px] border bg-white overflow-hidden transition-all duration-200 shadow-[0_8px_26px_rgba(15,37,68,0.04)] safar-print-card ${
                  isDayFocused
                    ? 'border-safar-orange/70 ring-1 ring-safar-orange/25'
                    : 'border-[#E7E1D6]'
                }`}
              >
                {/* Day Header Row */}
                <div className="px-5 sm:px-6 py-5 bg-[#FCF9F3]/80 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#EFEBE2]">
                  <div className="flex items-start sm:items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-safar-navy text-white flex flex-col items-center justify-center shrink-0 tabular-nums">
                      <span className="text-[10px] uppercase tracking-[0.06em] text-orange-300 leading-none">
                        Day
                      </span>
                      <span className="text-base font-semibold leading-tight">
                        {String(day.day).padStart(2, '0')}
                      </span>
                    </div>

                    {dayPhoto && (
                      <button
                        type="button"
                        data-print-hide="true"
                        onClick={() =>
                          onOpenPhotoModal({
                            name: `${activePlan.destination} · Day ${day.day}`,
                            query: destQuery,
                            initialPhotos: destPhotos,
                            initialIndex: dayIdx % destPhotos.length,
                          })
                        }
                        className="hidden sm:block cursor-pointer w-20 h-14 rounded-xl overflow-hidden border border-[#E7E1D6] shrink-0"
                        title={`View ${activePlan.destination} photo`}
                      >
                        <img
                          src={dayPhoto.thumbUrl || dayPhoto.url}
                          alt={dayPhoto.title || day.theme}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    )}

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-safar-slate tabular-nums">
                        {day.date && <span>{day.date}</span>}
                        {day.date && day.estimatedTravelTime && (
                          <span aria-hidden="true">·</span>
                        )}
                        {day.estimatedTravelTime && (
                          <span>Est. transit: {day.estimatedTravelTime}</span>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{day.schedule.length} stops</span>
                      </div>
                      <h4 className="text-lg md:text-xl font-semibold text-safar-navy leading-snug">
                        {day.theme}
                      </h4>
                    </div>
                  </div>

                  <div
                    data-print-hide="true"
                    className="flex items-center gap-2.5 shrink-0 self-end md:self-center"
                  >
                    <button
                      type="button"
                      onClick={() => onFocusDayOnMap(day.day)}
                      className={`cursor-pointer inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap ${
                        isDayFocused
                          ? 'bg-safar-navy text-white'
                          : 'border border-[#DFD8CA] bg-white text-safar-navy hover:bg-safar-skySoft'
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                      Day {day.day} Map
                    </button>

                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => toggleDay(day.day)}
                      aria-label={
                        isExpanded
                          ? `Collapse Day ${day.day} schedule`
                          : `Expand Day ${day.day} schedule`
                      }
                      className="cursor-pointer inline-flex items-center gap-1 rounded-full border border-[#DFD8CA] bg-white px-3.5 py-2 text-xs font-semibold text-safar-navy hover:bg-safar-skySoft transition-colors whitespace-nowrap"
                    >
                      {isExpanded ? 'Hide' : 'Show'}
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expandable Timeline Slots (always expanded in print via print:block + safar-print-expand) */}
                <div
                  className={`${
                    isExpanded ? 'block' : 'hidden print:block'
                  } p-5 sm:p-6 space-y-5 safar-print-expand`}
                >
                  {day.schedule.map((slot, idx) => {
                      const slotStopId = buildScheduleStopId(day.day, idx);
                      const isHighlighted =
                        highlightedSlotId === slotStopId ||
                        selectedMapStopId === slotStopId;
                      const isLast = idx === day.schedule.length - 1;

                      return (
                        <div
                          key={slotStopId}
                          id={slotStopId}
                          className={`relative grid grid-cols-1 md:grid-cols-[150px_1fr] gap-3 md:gap-6 rounded-2xl p-4 transition-colors ${
                            isHighlighted
                              ? 'bg-safar-orangeSoft ring-1 ring-safar-orange/35'
                              : 'bg-[#FCF9F3]/45 hover:bg-[#FCF9F3]'
                          }`}
                        >
                          {/* Left Time & Transit Rail */}
                          <div className="flex md:flex-col justify-between md:justify-start gap-1.5 border-b md:border-b-0 md:border-r border-[#EFEBE2] pb-2 md:pb-0 md:pr-4">
                            <span className="text-sm font-semibold text-safar-navy tabular-nums">
                              {slot.time}
                            </span>
                            {slot.travelTimeFromPrev && (
                              <span className="inline-flex items-center gap-1 text-xs text-safar-slate leading-snug">
                                <Clock className="w-3 h-3 text-safar-orange shrink-0" aria-hidden="true" />
                                {slot.travelTimeFromPrev}
                              </span>
                            )}
                          </div>

                          {/* Right Activity Content */}
                          <div className="space-y-2 min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-0.5 min-w-0">
                                <h5 className="text-base font-semibold text-safar-navy leading-snug">
                                  {slot.activity}
                                </h5>
                                {(slot.location || slot.visitingHours) && (
                                  <p className="text-xs font-medium text-safar-slate flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    {slot.location && (
                                      <span className="inline-flex items-center gap-1 text-safar-navy/85">
                                        <MapPin
                                          className="w-3 h-3 text-safar-orange shrink-0"
                                          aria-hidden="true"
                                        />
                                        {slot.location}
                                      </span>
                                    )}
                                    {slot.location && slot.visitingHours && (
                                      <span aria-hidden="true">·</span>
                                    )}
                                    {slot.visitingHours && (
                                      <span>Hours: {slot.visitingHours}</span>
                                    )}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                {slot.estimatedCost > 0 && (
                                  <span className="text-sm font-semibold text-safar-navy tabular-nums">
                                    ~{formatMoney(slot.estimatedCost, activePlan.currency)}
                                  </span>
                                )}
                                {(slot.location || slot.activity) && (
                                  <button
                                    type="button"
                                    data-print-hide="true"
                                    onClick={() =>
                                      jumpToScheduleStop(day.day, slotStopId)
                                    }
                                    className="cursor-pointer inline-flex items-center gap-1 rounded-full border border-[#DFD8CA] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-safar-orange hover:bg-safar-orangeSoft transition-colors whitespace-nowrap"
                                  >
                                    <MapPin className="w-3 h-3" aria-hidden="true" />
                                    Map
                                  </button>
                                )}
                              </div>
                            </div>

                            {slot.notes && (
                              <p className="text-sm text-safar-slate leading-relaxed">
                                {slot.notes}
                              </p>
                            )}

                            {!isLast && (
                              <span className="sr-only">Next stop follows</span>
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
      </section>

      {/* 3. INTERACTIVE TRAVEL MAP */}
      <ItineraryMap
        plan={activePlan}
        selectedDay={selectedMapDay}
        onSelectDay={onSelectMapDay}
        selectedStopId={selectedMapStopId}
        onSelectStop={onSelectMapStopId}
        dayTrigger={mapDayTrigger}
        onJumpToScheduleSlot={(_day, stopId) => {
          onHighlightSlotId(stopId);
          setExpandedDays((prev) => ({ ...prev, [_day]: true }));
          window.setTimeout(() => {
            document
              .getElementById(stopId)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 50);
        }}
      />

      {/* 4. BUDGET DASHBOARD */}
      <section
        aria-labelledby="safar-budget-dashboard-heading"
        className="rounded-[28px] border border-[#E7E1D6] bg-white p-6 md:p-8 space-y-6 shadow-[0_10px_32px_rgba(15,37,68,0.05)] safar-print-card"
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[#EFEBE2]">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange">
              Financial Plan · Editable Breakdown
            </p>
            <h3
              id="safar-budget-dashboard-heading"
              className="text-2xl md:text-3xl font-semibold tracking-[-0.02em] text-safar-navy flex items-center gap-2.5"
            >
              <Wallet className="w-6 h-6 text-safar-orange shrink-0" aria-hidden="true" />
              Budget Dashboard ({activePlan.currency})
            </h3>
          </div>
          <p className="text-xs text-safar-slate max-w-md leading-relaxed">
            Edit any category amount below to adjust your trip total live in{' '}
            {activePlan.currency}.
          </p>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[#E7E1D6] bg-[#FCF9F3] p-5 space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.05em] text-safar-slate">
              Total Estimated Cost
            </span>
            <p className="text-3xl font-semibold text-safar-navy tabular-nums">
              {formatMoney(activePlan.totalEstimatedBudget, activePlan.currency)}
            </p>
            <p className="text-xs text-safar-slate tabular-nums">
              ~
              {formatMoney(
                activePlan.totalEstimatedBudget /
                  Math.max(1, activePlan.dailyItinerary.length),
                activePlan.currency,
              )}{' '}
              per day
            </p>
          </div>

          <div className="rounded-2xl border border-[#E7E1D6] bg-white p-5 space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.05em] text-safar-slate">
              Target Budget
            </span>
            <p className="text-3xl font-semibold text-safar-navy tabular-nums">
              {budgetAmount > 0
                ? formatMoney(budgetAmount, activePlan.currency)
                : 'Flexible'}
            </p>
            {budgetAmount > 0 && (
              <div className="pt-1 space-y-1">
                <div className="h-1.5 w-full rounded-full bg-safar-sky overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isOverBudget ? 'bg-amber-600' : 'bg-safar-navy'
                    }`}
                    style={{ width: `${targetUtilizationPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-safar-slate tabular-nums">
                  {targetUtilizationPct}% of target allocated
                </p>
              </div>
            )}
          </div>

          <div
            className={`rounded-2xl border p-5 space-y-1 ${
              budgetDifference === null
                ? 'border-[#E7E1D6] bg-white'
                : isOverBudget
                  ? 'border-amber-200 bg-amber-50/70'
                  : 'border-emerald-200 bg-emerald-50/60'
            }`}
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-safar-slate">
              {budgetDifference === null ? (
                'Per Traveler Average'
              ) : isOverBudget ? (
                <>
                  <TrendingUp className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                  Over Target Budget
                </>
              ) : (
                <>
                  <TrendingDown className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                  Remaining Budget
                </>
              )}
            </span>
            <p
              className={`text-3xl font-semibold tabular-nums ${
                budgetDifference === null
                  ? 'text-safar-navy'
                  : isOverBudget
                    ? 'text-amber-900'
                    : 'text-emerald-900'
              }`}
            >
              {budgetDifference === null
                ? formatMoney(
                    activePlan.totalEstimatedBudget /
                      Math.max(1, effectiveTravelers),
                    activePlan.currency,
                  )
                : formatMoney(Math.abs(budgetDifference), activePlan.currency)}
            </p>
            <p className="text-xs text-safar-slate">
              {budgetDifference === null
                ? `Split across ${effectiveTravelers} ${
                    effectiveTravelers === 1 ? 'traveler' : 'travelers'
                  }`
                : isOverBudget
                  ? 'Above target — adjust category estimates or travel style'
                  : 'Headroom available within your planned budget'}
            </p>
          </div>
        </div>

        {/* Chart + Editable Category Allocation Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* SVG Donut Breakdown Chart */}
          <div className="lg:col-span-5 rounded-2xl border border-[#E7E1D6] bg-[#FCF9F3]/75 p-6 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-6">
            <div className="relative w-40 h-40 shrink-0">
              <svg viewBox="0 0 150 150" className="w-full h-full -rotate-90">
                <circle
                  cx="75"
                  cy="75"
                  r="58"
                  fill="none"
                  stroke="#E8EEF6"
                  strokeWidth="18"
                />
                {donutSegments.map((seg) => (
                  <circle
                    key={seg.key}
                    cx="75"
                    cy="75"
                    r="58"
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="18"
                    strokeDasharray={`${seg.strokeLength} ${seg.circumference}`}
                    strokeDashoffset={seg.dashOffset}
                    className="transition-all duration-300"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-safar-slate">
                  Estimated
                </span>
                <span className="text-base font-semibold text-safar-navy tabular-nums">
                  {formatMoney(
                    activePlan.totalEstimatedBudget,
                    activePlan.currency,
                  )}
                </span>
              </div>
            </div>

            <div className="flex-1 w-full space-y-2.5">
              {donutSegments.map((seg) => (
                <div
                  key={seg.key}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="inline-flex items-center gap-2 text-safar-navy font-medium">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${seg.dotClass}`}
                    />
                    {seg.label}
                  </span>
                  <span className="font-semibold text-safar-navy tabular-nums">
                    {seg.percentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 4 Live Editable Category Inputs */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {BUDGET_CATEGORIES.map((cat) => {
              const val = activePlan.budgetBreakdown[cat.key] || 0;
              const sharePct =
                activePlan.totalEstimatedBudget > 0
                  ? Math.min(
                      100,
                      Math.round((val / activePlan.totalEstimatedBudget) * 100),
                    )
                  : 0;
              return (
                <label
                  key={cat.key}
                  className="rounded-2xl border border-[#E7E1D6] bg-white p-4 flex flex-col gap-2 transition-colors focus-within:border-safar-navy"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                      <span className={`w-2 h-2 rounded-full ${cat.dotClass}`} />
                      {cat.label}
                    </span>
                    <span className="text-xs font-semibold text-safar-orange tabular-nums">
                      {sharePct}%
                    </span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={val}
                    onChange={(e) =>
                      onBudgetFieldChange(cat.key, e.target.value)
                    }
                    className="font-sans text-xl font-semibold text-safar-navy bg-transparent outline-none tabular-nums"
                  />
                  <div className="h-1.5 w-full rounded-full bg-[#EFEBE2] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{
                        width: `${sharePct}%`,
                        backgroundColor: cat.color,
                      }}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-safar-slate">
          {activePlan.budgetBreakdown.disclaimer}
        </p>
      </section>

      {/* 5. DISCOVER YOUR DESTINATION */}
      <section aria-labelledby="safar-discover-dest-heading" className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange">
              Curated Recommendations
            </p>
            <h3
              id="safar-discover-dest-heading"
              className="text-2xl md:text-3xl font-semibold tracking-[-0.02em] text-safar-navy"
            >
              Discover {activePlan.destination}
            </h3>
          </div>

          {/* Interactive Category Filter */}
          <div
            role="group"
            data-print-hide="true"
            aria-label="Filter destination recommendations"
            className="inline-flex flex-wrap items-center gap-1 rounded-2xl sm:rounded-full border border-[#E7E1D6] bg-[#FCF9F3] p-1 self-start md:self-auto"
          >
            {(
              [
                ['all', 'All Highlights'],
                ['attractions', 'Attractions'],
                ['stays', 'Stays'],
                ['food', 'Dining'],
                ['gems', 'Gems & Local'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDiscoverFilter(id)}
                className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  discoverFilter === id
                    ? 'bg-safar-navy text-white'
                    : 'text-safar-slate hover:text-safar-navy'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Key Attractions (with Real Photography) */}
        {(discoverFilter === 'all' || discoverFilter === 'attractions') &&
          activePlan.attractions.length > 0 && (
            <div className="space-y-4 safar-print-card">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.05em] text-safar-navy">
                <Compass className="w-4 h-4 text-safar-orange" aria-hidden="true" />
                Key Attractions
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {activePlan.attractions.map((item, idx) => {
                  const attrPhoto = attractionPhotos[item.name] ?? null;
                  return (
                    <article
                      key={`${item.name}-${idx}`}
                      className="rounded-[22px] border border-[#E7E1D6] bg-white overflow-hidden flex flex-col justify-between shadow-[0_6px_22px_rgba(15,37,68,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,37,68,0.08)]"
                    >
                      <div>
                        {attrPhoto ? (
                          <button
                            type="button"
                            data-print-hide="true"
                            onClick={() =>
                              onOpenPhotoModal({
                                name: item.name,
                                query: `${item.name} ${activePlan.destination}`,
                                subtitle: `Recommended in ${activePlan.destination}`,
                                category: 'landmarks',
                                initialPhotos: [attrPhoto],
                              })
                            }
                            className="cursor-pointer block w-full overflow-hidden border-b border-[#EFEBE2] text-left"
                          >
                            <ResponsivePhoto
                              photo={attrPhoto}
                              fallbackLabel={item.name}
                              aspectClassName="aspect-[16/10]"
                              sizes="(max-width: 1024px) 90vw, 360px"
                            />
                          </button>
                        ) : (
                          <div className="border-t-4 border-t-safar-orange/75 bg-[#FCF9F3] border-b border-[#EFEBE2] px-5 py-3 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-safar-orange">
                              Signature Stop
                            </span>
                            <span className="text-[11px] font-medium text-safar-slate">
                              {activePlan.destination}
                            </span>
                          </div>
                        )}

                        <div className="p-5 space-y-2">
                          <h4 className="text-base font-semibold text-safar-navy">
                            {item.name}
                          </h4>
                          <p className="text-xs font-medium text-safar-slate">
                            Best time: {item.bestTimeToVisit} · {item.estimatedDuration}
                          </p>
                          <p className="text-sm text-safar-slate leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      {attrPhoto && (
                        <p
                          data-print-hide="true"
                          className="px-5 pb-4 text-[11px] text-safar-slate/85"
                        >
                          Photo by{' '}
                          <a
                            href={attrPhoto.attribution.photographerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-safar-navy"
                          >
                            {attrPhoto.attribution.photographerName}
                          </a>{' '}
                          on{' '}
                          <a
                            href={attrPhoto.attribution.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-safar-navy"
                          >
                            {attrPhoto.attribution.sourceName}
                          </a>
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

        {/* Stay & Food Recommendations */}
        {(discoverFilter === 'all' ||
          discoverFilter === 'stays' ||
          discoverFilter === 'food') && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {(discoverFilter === 'all' || discoverFilter === 'stays') &&
              activePlan.accommodationSuggestions.length > 0 && (
                <div className="rounded-[24px] border border-[#E7E1D6] bg-[#FCF9F3]/60 p-6 space-y-4 safar-print-card">
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E7E1D6]">
                    <h4 className="text-lg font-semibold text-safar-navy flex items-center gap-2">
                      <BedDouble
                        className="w-5 h-5 text-safar-orange"
                        aria-hidden="true"
                      />
                      Stay Suggestions
                    </h4>
                    <span className="text-xs font-medium text-safar-slate">
                      AI estimates · verify before booking
                    </span>
                  </div>
                  <div className="space-y-3">
                    {activePlan.accommodationSuggestions.map((stay, idx) => (
                      <div
                        key={`${stay.name}-${idx}`}
                        className="rounded-2xl border border-[#E7E1D6] bg-white p-4 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-safar-navy">
                            {stay.name}
                          </p>
                          <span className="text-xs font-semibold text-safar-orange tabular-nums">
                            {stay.approximateNightlyRange}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-safar-slate">
                          {stay.area} · {stay.tier}
                        </p>
                        <p className="text-xs text-safar-slate leading-relaxed">
                          {stay.notes}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {(discoverFilter === 'all' || discoverFilter === 'food') &&
              activePlan.foodRecommendations.length > 0 && (
                <div className="rounded-[24px] border border-[#E7E1D6] bg-[#FCF9F3]/60 p-6 space-y-4 safar-print-card">
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E7E1D6]">
                    <h4 className="text-lg font-semibold text-safar-navy flex items-center gap-2">
                      <Utensils
                        className="w-5 h-5 text-safar-orange"
                        aria-hidden="true"
                      />
                      Food Recommendations
                    </h4>
                    <span className="text-xs font-medium text-safar-slate">
                      Local dishes &amp; spots
                    </span>
                  </div>
                  <div className="space-y-3">
                    {activePlan.foodRecommendations.map((food, idx) => (
                      <div
                        key={`${food.dishOrSpot}-${idx}`}
                        className="rounded-2xl border border-[#E7E1D6] bg-white p-4 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-safar-navy">
                            {food.dishOrSpot}
                          </p>
                          <span className="text-xs font-semibold text-safar-orange tabular-nums">
                            {food.approximateCostRange}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-safar-slate">
                          {food.type} · {food.area}
                        </p>
                        <p className="text-xs text-safar-slate leading-relaxed">
                          {food.notes}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Hidden Gems & Local Experiences (Grounded in actual generated itinerary) */}
        {(discoverFilter === 'all' || discoverFilter === 'gems') &&
          (hiddenGems.length > 0 || localExperiences.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {hiddenGems.length > 0 && (
                <div className="rounded-[24px] border border-[#E7E1D6] bg-white p-6 space-y-4 shadow-[0_6px_22px_rgba(15,37,68,0.03)] safar-print-card">
                  <h4 className="text-lg font-semibold text-safar-navy flex items-center gap-2 pb-3 border-b border-[#EFEBE2]">
                    <Gem className="w-5 h-5 text-safar-orange" aria-hidden="true" />
                    Hidden Gems in Your Route
                  </h4>
                  <div className="space-y-3">
                    {hiddenGems.map((entry) => (
                      <div
                        key={entry.stopId}
                        className="rounded-2xl border border-[#EFEBE2] bg-[#FCF9F3]/60 p-4 space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-safar-navy">
                            {entry.slot.activity}
                          </p>
                          <button
                            type="button"
                            data-print-hide="true"
                            onClick={() =>
                              jumpToScheduleStop(entry.day, entry.stopId)
                            }
                            className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.04em] text-safar-orange hover:underline shrink-0"
                          >
                            Day {entry.day} Map
                          </button>
                        </div>
                        <p className="text-xs font-medium text-safar-slate">
                          {entry.slot.location}
                          {entry.slot.estimatedCost > 0
                            ? ` · ~${formatMoney(
                                entry.slot.estimatedCost,
                                activePlan.currency,
                              )}`
                            : ''}
                        </p>
                        {entry.slot.notes && (
                          <p className="text-xs text-safar-slate leading-relaxed">
                            {entry.slot.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {localExperiences.length > 0 && (
                <div className="rounded-[24px] border border-[#E7E1D6] bg-white p-6 space-y-4 shadow-[0_6px_22px_rgba(15,37,68,0.03)] safar-print-card">
                  <h4 className="text-lg font-semibold text-safar-navy flex items-center gap-2 pb-3 border-b border-[#EFEBE2]">
                    <Globe className="w-5 h-5 text-safar-orange" aria-hidden="true" />
                    Local Experiences
                  </h4>
                  <div className="space-y-3">
                    {localExperiences.map((entry) => (
                      <div
                        key={entry.stopId}
                        className="rounded-2xl border border-[#EFEBE2] bg-[#FCF9F3]/60 p-4 space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-safar-navy">
                            {entry.slot.activity}
                          </p>
                          <button
                            type="button"
                            data-print-hide="true"
                            onClick={() =>
                              jumpToScheduleStop(entry.day, entry.stopId)
                            }
                            className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.04em] text-safar-orange hover:underline shrink-0"
                          >
                            Day {entry.day} Map
                          </button>
                        </div>
                        <p className="text-xs font-medium text-safar-slate">
                          {entry.slot.location} · {entry.slot.time}
                          {entry.slot.estimatedCost > 0
                            ? ` · ~${formatMoney(
                                entry.slot.estimatedCost,
                                activePlan.currency,
                              )}`
                            : ''}
                        </p>
                        {entry.slot.notes && (
                          <p className="text-xs text-safar-slate leading-relaxed">
                            {entry.slot.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
      </section>

      {/* 6. TRAVEL TIPS + 7. PERSONAL AI TRAVEL ASSISTANT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Travel Tips Cards */}
        <section
          aria-labelledby="safar-travel-tips-heading"
          className="lg:col-span-5 rounded-[28px] border border-[#E7E1D6] bg-[#FCF9F3] p-6 md:p-7 space-y-5 safar-print-card"
        >
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange">
              Before You Go
            </p>
            <h3
              id="safar-travel-tips-heading"
              className="text-xl font-semibold tracking-[-0.02em] text-safar-navy"
            >
              Practical Travel Tips
            </h3>
          </div>

          <div className="space-y-3">
            {activePlan.travelTips.map((tip, idx) => {
              const { Icon, label } = getTipMeta(tip, idx);
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-[#E7E1D6] bg-white p-4 flex items-start gap-3.5"
                >
                  <div className="w-9 h-9 rounded-xl bg-safar-orangeSoft flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-safar-orange" aria-hidden="true" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate">
                      {label}
                    </p>
                    <p className="text-sm text-safar-navy leading-relaxed">
                      {tip}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Upgraded AI Travel Assistant Chat */}
        <section
          data-print-hide="true"
          aria-labelledby="safar-ai-assistant-heading"
          className="lg:col-span-7 rounded-[28px] border border-[#E7E1D6] bg-white p-6 md:p-7 space-y-5 shadow-[0_10px_32px_rgba(15,37,68,0.05)]"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#EFEBE2]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-safar-navy text-white flex items-center justify-center shrink-0">
                <MessageSquareText
                  className="w-5 h-5 text-safar-orange"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3
                  id="safar-ai-assistant-heading"
                  className="text-xl font-semibold tracking-[-0.02em] text-safar-navy"
                >
                  SAFAR Travel Assistant
                </h3>
                <p className="text-xs text-safar-slate">
                  Refine pacing, swap meals, or ask local questions in English or മലയാളം
                </p>
              </div>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate">
              English / മലയാളം
            </span>
          </div>

          {/* Conversation History or Ready Prompt State */}
          {chatHistory.length > 0 ? (
            <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
              {chatHistory.map((turn, idx) => (
                <div
                  key={`${turn.role}-${idx}`}
                  className={`flex ${
                    turn.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      turn.role === 'user'
                        ? 'bg-safar-navy text-white font-medium'
                        : 'border border-[#E7E1D6] bg-[#FCF9F3] text-safar-navy'
                    }`}
                  >
                    {turn.content}
                  </div>
                </div>
              ))}
              {followUpLoading && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-[#E7E1D6] bg-[#FCF9F3] px-4 py-3 text-xs font-medium text-safar-slate">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-safar-orange" />
                    SAFAR Assistant is thinking...
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#EFEBE2] bg-[#FCF9F3]/70 p-4 text-sm text-safar-slate leading-relaxed">
              Ask about vegetarian restaurants, rainy-day backups, transit times, or local customs in{' '}
              <strong className="font-semibold text-safar-navy">
                {activePlan.destination}
              </strong>
              . Pick a suggested question below or type your own in English or Malayalam.
            </div>
          )}

          {activePlan.suggestedFollowUps.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-safar-slate">
                Suggested Follow-Up Questions
              </p>
              <div className="flex flex-wrap gap-2">
                {activePlan.suggestedFollowUps.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={followUpLoading}
                    onClick={() => void onFollowUp(q)}
                    className="cursor-pointer rounded-full border border-[#DFD8CA] bg-[#FCF9F3] px-3.5 py-1.5 text-xs font-medium text-safar-navy hover:bg-safar-skySoft disabled:opacity-50 text-left transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onFollowUp(followUpText);
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <input
              type="text"
              value={followUpText}
              onChange={(e) => onFollowUpTextChange(e.target.value)}
              placeholder="Ask about dining, kid-friendly pacing, or write in മലയാളം..."
              aria-label="Ask SAFAR Travel Assistant"
              disabled={followUpLoading}
              className="flex-1 rounded-full border border-[#DFD8CA] bg-[#FCF9F3]/50 px-5 py-3 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
            />
            <button
              type="submit"
              disabled={followUpLoading || !followUpText.trim()}
              className="cursor-pointer inline-flex items-center justify-center gap-2 rounded-full bg-safar-navy px-6 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-safar-navyHover disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {followUpLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
              )}
              {followUpLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
        </section>
      </div>

      {/* 8. CONVERSION-FOCUSED FINAL SECTION */}
      <section
        data-print-hide="true"
        aria-labelledby="safar-journey-cta-heading"
        className="rounded-[28px] bg-safar-navy px-6 py-10 md:px-12 md:py-12 text-white shadow-[0_18px_48px_rgba(15,37,68,0.22)]"
      >
        <div className="max-w-5xl mx-auto text-center space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-300">
            SAFAR · سفر
          </p>
          <h3
            id="safar-journey-cta-heading"
            className="text-3xl md:text-4xl font-semibold tracking-[-0.03em] text-white leading-tight"
          >
            Your Journey Starts Here
          </h3>
          <p className="text-base text-white/80 leading-relaxed max-w-xl mx-auto">
            Your personalized travel plan is ready. Save it, share it, and start making memories.
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void onSaveOrUpdateTrip()}
              className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-safar-orange px-6 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[0_8px_20px_rgba(249,115,22,0.28)] transition-all hover:bg-safar-orangeHover disabled:opacity-60 whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              {isSaving ? 'Saving Trip...' : 'Save This Trip'}
            </button>

            <button
              type="button"
              disabled={isExportingPdf}
              onClick={() => void onDownloadPdf()}
              className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy transition-colors hover:bg-[#FCF9F3] disabled:opacity-60 whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-safar-orange" aria-hidden="true" />
              {isExportingPdf ? 'Exporting...' : 'Download Your Itinerary'}
            </button>

            <button
              type="button"
              onClick={onOpenShareModal}
              className="cursor-pointer inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-6 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-white transition-colors hover:bg-white/20 whitespace-nowrap"
            >
              <Share2 className="w-4 h-4 text-orange-300" aria-hidden="true" />
              Share With Friends
            </button>

            <button
              type="button"
              onClick={onPlanAnotherTrip}
              className="cursor-pointer inline-flex items-center gap-2 rounded-full border border-white/25 bg-transparent px-6 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-white transition-colors hover:bg-white/10 whitespace-nowrap"
            >
              Plan Another Trip
              <ArrowRight className="w-4 h-4 text-orange-300" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
