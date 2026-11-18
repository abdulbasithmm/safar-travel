import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Camera,
  Clock,
  Compass,
  Download,
  Loader2,
  MapPin,
  Printer,
  Users,
  Utensils,
  Wallet,
} from 'lucide-react';
import ItineraryMap, { buildScheduleStopId } from '@/components/ItineraryMap';
import ResponsivePhoto from '@/components/ResponsivePhoto';
import { searchDestinationPhotos } from '@/services/photoService';
import { getPublicSharedTrip } from '@/services/shareService';
import { exportTripToPdf } from '@/utils/tripPdfExport';
import type { DestinationPhoto } from '@/types/photo';
import type {
  CurrencyCode,
  SharedTripRecord,
  StructuredTripPlan,
} from '@/types/trip';

interface SharedTripViewProps {
  shareId: string;
  onPlanOwnTrip: () => void;
}

function formatMoney(amount: number, currency: CurrencyCode): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
  const rounded = Math.round(amount || 0);
  return `${symbol}${rounded.toLocaleString('en-US')}`;
}

export default function SharedTripView({
  shareId,
  onPlanOwnTrip,
}: SharedTripViewProps) {
  const [record, setRecord] = useState<SharedTripRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<DestinationPhoto[]>([]);
  const [selectedMapDay, setSelectedMapDay] = useState<number | 'all'>('all');
  const [selectedMapStopId, setSelectedMapStopId] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRecord(null);
    setPhotos([]);
    setExportStatus(null);
    setExportError(null);

    getPublicSharedTrip(shareId)
      .then((res) => {
        if (!cancelled) {
          setRecord(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecord(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  useEffect(() => {
    if (!record?.destination) return;
    const controller = new AbortController();

    searchDestinationPhotos(
      { query: record.destination, limit: 4 },
      controller.signal,
    )
      .then((res) => {
        if (!controller.signal.aborted) {
          setPhotos(res.photos);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPhotos([]);
        }
      });

    return () => controller.abort();
  }, [record?.destination]);

  const handleDownloadPdf = async () => {
    if (!record || pdfExporting) return;
    setPdfExporting(true);
    setExportStatus(null);
    setExportError(null);

    const plan: StructuredTripPlan = {
      destination: record.destination,
      tripSummary: record.tripSummary,
      totalEstimatedBudget: record.totalEstimatedBudget,
      currency: record.currency,
      budgetBreakdown: record.budgetBreakdown,
      dailyItinerary: record.dailyItinerary,
      attractions: record.attractions,
      accommodationSuggestions: record.accommodationSuggestions,
      foodRecommendations: record.foodRecommendations,
      travelTips: record.travelTips,
      suggestedFollowUps: [],
      language: record.language,
    };

    try {
      const result = await exportTripToPdf({
        plan,
        title: record.title,
        country: record.country,
        startingLocation: record.startingLocation,
        departureDate: record.departureDate,
        returnDate: record.returnDate,
        travelers: record.travelers,
        travelStyle: record.travelStyle,
        notes: record.notes,
        photos,
      });
      setExportStatus(
        `Downloaded ${result.fileName} (${result.pageCount} pages).`,
      );
    } catch {
      setExportError('Unable to generate PDF right now. Please try Print Trip.');
    } finally {
      setPdfExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-white text-wandor-text">
      {/* Header Bar */}
      <header
        data-print-hide="true"
        className="sticky top-0 z-40 border-b border-black/10 bg-white/95 backdrop-blur-xs"
      >
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={onPlanOwnTrip}
            className="cursor-pointer flex items-baseline gap-2.5 select-none hover:opacity-75 transition-opacity"
          >
            <span className="font-display text-3xl text-black leading-none">
              SAFAR
            </span>
            <span
              lang="ar"
              dir="rtl"
              className="font-sans text-base font-medium text-wandor-muted leading-none"
            >
              سفر
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            {record && (
              <>
                <button
                  type="button"
                  disabled={pdfExporting}
                  onClick={() => void handleDownloadPdf()}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5 disabled:opacity-60"
                >
                  {pdfExporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-wandor-prompt" />
                  )}
                  {pdfExporting ? 'Preparing PDF...' : 'Download PDF'}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5"
                >
                  <Printer className="w-3.5 h-3.5 text-wandor-prompt" />
                  Print Trip
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onPlanOwnTrip}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-wandor-dark px-5 py-2 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Plan Your Own Trip
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-6 py-12 md:py-16 safar-print-container">
        {loading ? (
          <div className="space-y-6">
            <div className="h-44 rounded-[28px] animate-pulse bg-black/[0.05]" />
            <div className="h-36 rounded-[28px] animate-pulse bg-black/[0.04]" />
            <div className="h-64 rounded-[28px] animate-pulse bg-black/[0.04]" />
          </div>
        ) : !record ? (
          <div className="rounded-[28px] border border-black/10 p-10 md:p-14 text-center space-y-4 max-w-xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-wandor-prompt">
              SAFAR · Shared Itinerary
            </p>
            <h1 className="text-2xl font-medium tracking-[-0.02em] text-wandor-text">
              This shared itinerary is unavailable
            </h1>
            <p className="text-sm text-wandor-muted leading-relaxed">
              The link may have expired, been revoked by its owner, or does not exist.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onPlanOwnTrip}
                className="cursor-pointer rounded-full bg-wandor-dark px-6 py-3 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333]"
              >
                Plan a New Trip with SAFAR
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {exportStatus && (
              <div
                data-print-hide="true"
                className="rounded-2xl border border-black/10 bg-black/[0.03] px-5 py-3 text-xs text-wandor-text"
              >
                {exportStatus}
              </div>
            )}
            {exportError && (
              <div
                data-print-hide="true"
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-3 text-xs text-red-800"
              >
                {exportError}
              </div>
            )}

            {/* Overview Card */}
            <div className="rounded-[28px] border border-black/10 p-6 md:p-8 space-y-5 safar-print-card">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.04em] text-wandor-muted">
                <span className="inline-flex items-center gap-1 text-wandor-prompt">
                  <MapPin className="w-3.5 h-3.5" />
                  {record.destination}
                  {record.country ? ` (${record.country})` : ''}
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  {record.dailyItinerary.length} Days
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Users className="w-3.5 h-3.5" />
                  {record.travelers} Travelers
                </span>
                <span aria-hidden="true">·</span>
                <span>{record.travelStyle}</span>
                <span aria-hidden="true">·</span>
                <span>{record.language === 'ml' ? 'മലയാളം' : 'English'}</span>
              </div>

              <h1 className="font-sans text-2xl md:text-4xl font-medium tracking-[-0.02em] text-wandor-text">
                {record.title}
              </h1>

              {(record.startingLocation || record.departureDate) && (
                <p className="text-xs text-wandor-muted">
                  {[
                    record.startingLocation
                      ? `From: ${record.startingLocation}`
                      : '',
                    record.departureDate && record.returnDate
                      ? `Dates: ${record.departureDate} to ${record.returnDate}`
                      : record.departureDate
                        ? `Departure: ${record.departureDate}`
                        : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}

              <p className="text-base text-wandor-muted leading-relaxed">
                {record.tripSummary}
              </p>

              {record.notes && record.notes.trim() && (
                <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-wandor-prompt">
                    Traveler Notes
                  </p>
                  <p className="text-sm text-wandor-text leading-relaxed whitespace-pre-wrap">
                    {record.notes}
                  </p>
                </div>
              )}

              {photos.length > 0 && (
                <div
                  data-print-hide="true"
                  className="pt-4 border-t border-black/10 space-y-3"
                >
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
                    <Camera className="w-3.5 h-3.5 text-wandor-prompt" />
                    Destination Photography · {record.destination}
                  </span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {photos.slice(0, 4).map((photo) => (
                      <div
                        key={photo.id}
                        className="rounded-xl overflow-hidden border border-black/10"
                      >
                        <ResponsivePhoto
                          photo={photo}
                          fallbackLabel={photo.title}
                          aspectClassName="aspect-[4/3]"
                          sizes="(max-width: 768px) 45vw, 240px"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Budget Breakdown */}
            <div className="rounded-[28px] border border-black/10 p-6 md:p-8 space-y-6 safar-print-card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <Wallet className="w-5 h-5 text-wandor-prompt" />
                  <h2 className="text-xl font-medium tracking-[-0.02em] text-wandor-text">
                    Estimated Budget ({record.currency})
                  </h2>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs uppercase tracking-[0.04em] text-wandor-muted">
                    Total Estimated Cost
                  </p>
                  <p className="text-2xl font-semibold text-wandor-text tabular-nums">
                    {formatMoney(record.totalEstimatedBudget, record.currency)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {(
                  [
                    ['Accommodation', record.budgetBreakdown.accommodation],
                    ['Food & Dining', record.budgetBreakdown.food],
                    ['Transportation', record.budgetBreakdown.transportation],
                    ['Activities', record.budgetBreakdown.activities],
                  ] as const
                ).map(([label, amount]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-black/10 p-4 flex flex-col gap-1.5"
                  >
                    <span className="text-xs font-medium uppercase tracking-[0.04em] text-wandor-muted">
                      {label}
                    </span>
                    <span className="font-sans text-lg font-medium text-wandor-text tabular-nums">
                      {formatMoney(amount, record.currency)}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-wandor-muted">
                {record.budgetBreakdown.disclaimer}
              </p>
            </div>

            {/* Interactive Map (hidden automatically in print view) */}
            <ItineraryMap
              plan={record}
              selectedDay={selectedMapDay}
              onSelectDay={setSelectedMapDay}
              selectedStopId={selectedMapStopId}
              onSelectStop={setSelectedMapStopId}
            />

            {/* Day-by-Day Schedule */}
            <div className="space-y-5">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-5 h-5 text-wandor-prompt" />
                <h2 className="text-xl font-medium tracking-[-0.02em] text-wandor-text">
                  Day-by-Day Schedule
                </h2>
              </div>

              <div className="space-y-4">
                {record.dailyItinerary.map((day) => (
                  <div
                    key={day.day}
                    className="rounded-[24px] border border-black/10 p-6 space-y-4 safar-print-card"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-black/10">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-prompt tabular-nums">
                          Day {day.day}
                          {day.date ? ` · ${day.date}` : ''}
                        </span>
                        <h3 className="text-lg font-medium text-wandor-text">
                          {day.theme}
                        </h3>
                      </div>
                      <span className="text-xs text-wandor-muted">
                        Est. transit: {day.estimatedTravelTime}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {day.schedule.map((slot, idx) => (
                        <div
                          key={buildScheduleStopId(day.day, idx)}
                          className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2 md:gap-6 py-2.5 border-b border-black/5 last:border-b-0"
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
                              {slot.estimatedCost > 0 && (
                                <span className="text-xs font-medium text-wandor-muted tabular-nums">
                                  ~{formatMoney(slot.estimatedCost, record.currency)}
                                </span>
                              )}
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
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Attractions, Stays, Food */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="rounded-[24px] border border-black/10 p-6 space-y-4 safar-print-card">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-wandor-prompt" />
                  <h2 className="text-base font-medium text-wandor-text">
                    Key Attractions
                  </h2>
                </div>
                <div className="space-y-4">
                  {record.attractions.map((item, idx) => (
                    <div key={`${item.name}-${idx}`} className="space-y-1">
                      <p className="text-sm font-medium text-wandor-text">
                        {item.name}
                      </p>
                      <p className="text-xs text-wandor-muted">
                        Best time: {item.bestTimeToVisit} · {item.estimatedDuration}
                      </p>
                      <p className="text-xs text-wandor-muted leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-black/10 p-6 space-y-4 safar-print-card">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-wandor-prompt" />
                  <h2 className="text-base font-medium text-wandor-text">
                    Stay Suggestions
                  </h2>
                </div>
                <div className="space-y-4">
                  {record.accommodationSuggestions.map((stay, idx) => (
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

              <div className="rounded-[24px] border border-black/10 p-6 space-y-4 safar-print-card">
                <div className="flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-wandor-prompt" />
                  <h2 className="text-base font-medium text-wandor-text">
                    Food Recommendations
                  </h2>
                </div>
                <div className="space-y-4">
                  {record.foodRecommendations.map((food, idx) => (
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

            {/* Travel Tips */}
            {record.travelTips.length > 0 && (
              <div className="rounded-[24px] border border-black/10 p-6 space-y-3 safar-print-card">
                <h2 className="text-base font-medium text-wandor-text">
                  Travel Tips
                </h2>
                <ul className="space-y-2 text-sm text-wandor-muted list-disc pl-5">
                  {record.travelTips.map((tip, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
