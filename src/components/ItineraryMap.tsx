import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  CollisionBehavior,
  InfoWindow,
  Map as GoogleMap,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  LocateFixed,
  MapPin,
  Navigation,
} from 'lucide-react';
import type { StructuredTripPlan } from '@/types/trip';

export interface ItineraryMapStop {
  id: string;
  day: number;
  order: number;
  time: string;
  activity: string;
  locationName: string;
  locationQuery: string;
  visitingHours: string;
  travelTimeFromPrev: string;
}

export interface DayMapTrigger {
  day: number;
  nonce: number;
}

interface ResolvedPlaceData {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  position: google.maps.LatLngLiteral;
}

interface DestinationAnchor {
  position: google.maps.LatLngLiteral;
  viewport: google.maps.LatLngBounds | null;
}

interface ItineraryMapProps {
  plan: StructuredTripPlan;
  selectedDay: number | 'all';
  onSelectDay: (day: number | 'all') => void;
  selectedStopId: string | null;
  onSelectStop: (stopId: string | null) => void;
  dayTrigger?: DayMapTrigger | null;
  onJumpToScheduleSlot?: (day: number, stopId: string) => void;
}

const MAX_AUTO_RESOLVE_STOPS = 14;

const DAY_ACCENT_COLORS = [
  '#0a0a0a',
  '#905831',
  '#1f4e5f',
  '#3f5e3a',
  '#6b3f69',
  '#7c4a21',
  '#2d3a54',
];

function getDayColor(day: number): string {
  const index = Math.max(0, day - 1) % DAY_ACCENT_COLORS.length;
  return DAY_ACCENT_COLORS[index];
}

export function buildScheduleStopId(dayNumber: number, slotIndex: number): string {
  return `day-${dayNumber}-slot-${slotIndex}`;
}

function normalizeQueryKey(destination: string, query: string): string {
  return `${destination.trim().toLowerCase()}::${query.trim().toLowerCase()}`;
}

function toLatLngLiteral(
  loc: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined,
): google.maps.LatLngLiteral | null {
  if (!loc) return null;
  if (typeof (loc as google.maps.LatLng).lat === 'function') {
    const latLng = loc as google.maps.LatLng;
    return { lat: latLng.lat(), lng: latLng.lng() };
  }
  const literal = loc as google.maps.LatLngLiteral;
  if (typeof literal.lat === 'number' && typeof literal.lng === 'number') {
    return { lat: literal.lat, lng: literal.lng };
  }
  return null;
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  const status = record.status ?? record.code;
  if (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    status === 'OVER_QUERY_LIMIT'
  ) {
    return true;
  }
  const msg = String(record.message ?? err).toUpperCase();
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('QUOTA') ||
    msg.includes('429')
  );
}

function extractItineraryStops(plan: StructuredTripPlan): ItineraryMapStop[] {
  const stops: ItineraryMapStop[] = [];
  let runningOrder = 0;

  for (const day of plan.dailyItinerary) {
    day.schedule.forEach((slot, slotIdx) => {
      const locationName = (slot.location || '').trim();
      const activity = (slot.activity || '').trim();
      const queryTarget = locationName || activity;
      if (!queryTarget) return;

      runningOrder += 1;
      stops.push({
        id: buildScheduleStopId(day.day, slotIdx),
        day: day.day,
        order: runningOrder,
        time: slot.time,
        activity: activity || locationName,
        locationName: locationName || activity,
        locationQuery: queryTarget,
        visitingHours: slot.visitingHours || '',
        travelTimeFromPrev: slot.travelTimeFromPrev || '',
      });
    });
  }

  return stops;
}

interface ItineraryMarkerItemProps {
  stop: ItineraryMapStop;
  resolved: ResolvedPlaceData;
  displayOrder: number;
  showDayPrefix: boolean;
  isSelected: boolean;
  isHovered: boolean;
  zIndex: number;
  currentIndex: number;
  totalResolvedCount: number;
  onSelect: () => void;
  onSelectPrev?: () => void;
  onSelectNext?: () => void;
  onCloseInfo: () => void;
  onHover: (hovered: boolean) => void;
  onJumpToSchedule?: () => void;
}

function ItineraryMarkerItem({
  stop,
  resolved,
  displayOrder,
  showDayPrefix,
  isSelected,
  isHovered,
  zIndex,
  currentIndex,
  totalResolvedCount,
  onSelect,
  onSelectPrev,
  onSelectNext,
  onCloseInfo,
  onHover,
  onJumpToSchedule,
}: ItineraryMarkerItemProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const dayColor = getDayColor(stop.day);
  const badgeText = showDayPrefix ? `D${stop.day}·${displayOrder}` : String(displayOrder);
  const labelText = stop.locationName || resolved.displayName || stop.activity;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={resolved.position}
        title={`${labelText} (Day ${stop.day})`}
        anchorLeft="-50%"
        anchorTop="-100%"
        zIndex={zIndex}
        collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
        onClick={onSelect}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <div
          className={`flex flex-col items-center select-none cursor-pointer transition-transform duration-150 ${
            isSelected ? 'scale-105' : isHovered ? 'scale-[1.03]' : ''
          }`}
        >
          <div
            className={`flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 shadow-md border transition-colors ${
              isSelected
                ? 'bg-wandor-prompt text-white border-[#5c361c]'
                : isHovered
                  ? 'bg-wandor-dark text-white border-black'
                  : 'bg-white/95 text-wandor-text border-black/15'
            }`}
          >
            <span
              className="inline-flex items-center justify-center rounded-full px-1.5 h-5 min-w-[20px] text-[10px] font-semibold tracking-[0.02em] text-white tabular-nums shrink-0"
              style={{
                backgroundColor: isSelected ? '#0a0a0a' : dayColor,
              }}
            >
              {badgeText}
            </span>
            <span className="max-w-[132px] truncate text-[11px] font-medium leading-none">
              {labelText}
            </span>
          </div>
          <div
            className={`w-0.5 h-2 ${
              isSelected ? 'bg-wandor-prompt' : 'bg-wandor-dark'
            }`}
          />
          <div
            className={`w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm ${
              isSelected ? 'bg-wandor-prompt' : 'bg-wandor-dark'
            }`}
          />
        </div>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow
          anchor={marker}
          pixelOffset={[0, -44]}
          maxWidth={300}
          onCloseClick={onCloseInfo}
        >
          <div className="font-sans text-wandor-text space-y-2 pr-1">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-wandor-prompt">
              <span>
                Day {stop.day}
                {stop.time ? ` · ${stop.time}` : ''}
              </span>
              {totalResolvedCount > 1 && (
                <span className="text-wandor-muted font-medium tabular-nums">
                  {currentIndex + 1}/{totalResolvedCount}
                </span>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-wandor-text leading-snug">
                {resolved.displayName || stop.locationName}
              </p>
              {stop.activity && stop.activity !== resolved.displayName && (
                <p className="text-xs text-wandor-text/80 leading-snug mt-0.5">
                  {stop.activity}
                </p>
              )}
            </div>

            {resolved.formattedAddress && (
              <p className="text-[11px] text-wandor-muted leading-snug">
                {resolved.formattedAddress}
              </p>
            )}

            {(stop.visitingHours || stop.travelTimeFromPrev) && (
              <p className="text-[11px] text-wandor-muted">
                {stop.visitingHours ? `Hours: ${stop.visitingHours}` : ''}
                {stop.visitingHours && stop.travelTimeFromPrev ? ' · ' : ''}
                {stop.travelTimeFromPrev}
              </p>
            )}

            {(onJumpToSchedule || totalResolvedCount > 1) && (
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-black/10">
                {onJumpToSchedule ? (
                  <button
                    type="button"
                    onClick={onJumpToSchedule}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-wandor-prompt hover:underline cursor-pointer"
                  >
                    View in schedule
                  </button>
                ) : (
                  <span />
                )}

                {totalResolvedCount > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={onSelectPrev}
                      aria-label="Previous stop"
                      className="cursor-pointer inline-flex items-center justify-center w-6 h-6 rounded-full border border-black/15 text-wandor-text hover:bg-black/5"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={onSelectNext}
                      aria-label="Next stop"
                      className="cursor-pointer inline-flex items-center justify-center w-6 h-6 rounded-full border border-black/15 text-wandor-text hover:bg-black/5"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

interface ItineraryMapContentProps {
  plan: StructuredTripPlan;
  allStops: ItineraryMapStop[];
  selectedDay: number | 'all';
  selectedStopId: string | null;
  onSelectStop: (stopId: string | null) => void;
  autoOpenDayTarget: number | null;
  onClearAutoOpenDay: () => void;
  onJumpToScheduleSlot?: (day: number, stopId: string) => void;
}

function ItineraryMapContent({
  plan,
  allStops,
  selectedDay,
  selectedStopId,
  onSelectStop,
  autoOpenDayTarget,
  onClearAutoOpenDay,
  onJumpToScheduleSlot,
}: ItineraryMapContentProps) {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const coreLib = useMapsLibrary('core');
  const loadingStatus = useApiLoadingStatus();

  const [hoveredStopId, setHoveredStopId] = useState<string | null>(null);
  const [resolvedByQuery, setResolvedByQuery] = useState<
    Record<string, ResolvedPlaceData | null>
  >({});
  const [resolvingProgress, setResolvingProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const cacheRef = useRef<Record<string, ResolvedPlaceData | null>>({});
  const destAnchorRef = useRef<Record<string, DestinationAnchor | null>>({});
  const quotaBlockedRef = useRef(false);

  const visibleStops = useMemo(() => {
    const filtered =
      selectedDay === 'all'
        ? allStops
        : allStops.filter((s) => s.day === selectedDay);

    return filtered.map((stop, idx) => ({
      ...stop,
      displayOrder: idx + 1,
    }));
  }, [allStops, selectedDay]);

  const stopsToResolve = useMemo(() => {
    const seenQueries: Record<string, true> = {};
    const unique: ItineraryMapStop[] = [];
    for (const stop of visibleStops) {
      const key = normalizeQueryKey(plan.destination, stop.locationQuery);
      if (!seenQueries[key]) {
        seenQueries[key] = true;
        unique.push(stop);
      }
      if (selectedDay === 'all' && unique.length >= MAX_AUTO_RESOLVE_STOPS) {
        break;
      }
    }
    return unique;
  }, [visibleStops, plan.destination, selectedDay]);

  // Resolve destination center and visible stops using Google Places API (New)
  useEffect(() => {
    if (!placesLib || quotaBlockedRef.current) return;

    let cancelled = false;
    setLookupError(null);

    const destination = plan.destination.trim();
    const language = plan.language === 'ml' ? 'ml' : 'en';

    const resolveStops = async () => {
      let anchor = destAnchorRef.current[destination] ?? null;

      if (!anchor && destination) {
        try {
          const { places } = await placesLib.Place.searchByText({
            textQuery: destination,
            fields: ['id', 'displayName', 'location', 'viewport'],
            maxResultCount: 1,
            language,
            internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
          });

          if (cancelled) return;

          const first = places?.[0];
          const pos = toLatLngLiteral(first?.location);
          if (pos) {
            anchor = {
              position: pos,
              viewport: first?.viewport ?? null,
            };
            destAnchorRef.current[destination] = anchor;
            if (map) {
              if (anchor.viewport) {
                map.fitBounds(anchor.viewport);
              } else {
                map.setCenter(anchor.position);
                map.setZoom(11);
              }
            }
          }
        } catch (err) {
          if (cancelled) return;
          if (isQuotaError(err)) {
            quotaBlockedRef.current = true;
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
            setLookupError(
              'Unable to load place locations right now due to Maps quota limits.',
            );
            return;
          }
        }
      }

      const pending = stopsToResolve.filter((stop) => {
        const key = normalizeQueryKey(destination, stop.locationQuery);
        return !(key in cacheRef.current);
      });

      if (pending.length === 0) {
        setResolvingProgress(null);
        return;
      }

      setResolvingProgress({ done: 0, total: pending.length });

      const batchSize = 2;
      let completed = 0;

      for (let i = 0; i < pending.length; i += batchSize) {
        if (cancelled || quotaBlockedRef.current) break;
        const batch = pending.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (stop) => {
            const cacheKey = normalizeQueryKey(destination, stop.locationQuery);
            if (cacheKey in cacheRef.current) return;

            const destLower = destination.toLowerCase();
            const queryLower = stop.locationQuery.toLowerCase();
            const textQuery =
              destination && !queryLower.includes(destLower)
                ? `${stop.locationQuery}, ${destination}`
                : stop.locationQuery;

            try {
              const { places } = await placesLib.Place.searchByText({
                textQuery,
                fields: ['id', 'displayName', 'location', 'formattedAddress'],
                maxResultCount: 1,
                ...(anchor?.position ? { locationBias: anchor.position } : {}),
                language,
                internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
              });

              if (cancelled) return;

              const match = places?.[0];
              const position = toLatLngLiteral(match?.location);

              if (match && position) {
                cacheRef.current[cacheKey] = {
                  placeId: match.id,
                  displayName: match.displayName || stop.locationName,
                  formattedAddress: match.formattedAddress || '',
                  position,
                };
              } else {
                cacheRef.current[cacheKey] = null;
              }
            } catch (err) {
              if (cancelled) return;
              if (isQuotaError(err)) {
                quotaBlockedRef.current = true;
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                setLookupError(
                  'Unable to resolve remaining stops due to Maps quota limits.',
                );
              } else {
                cacheRef.current[cacheKey] = null;
              }
            }
          }),
        );

        if (cancelled) break;
        completed += batch.length;
        setResolvedByQuery({ ...cacheRef.current });
        setResolvingProgress({
          done: Math.min(completed, pending.length),
          total: pending.length,
        });
      }

      if (!cancelled) {
        setResolvingProgress(null);
      }
    };

    void resolveStops();

    return () => {
      cancelled = true;
    };
  }, [placesLib, map, plan.destination, plan.language, stopsToResolve]);

  const resolvedStops = useMemo(() => {
    const list: Array<{
      stop: ItineraryMapStop & { displayOrder: number };
      resolved: ResolvedPlaceData;
    }> = [];

    for (const stop of visibleStops) {
      const key = normalizeQueryKey(plan.destination, stop.locationQuery);
      const resolved = resolvedByQuery[key] ?? cacheRef.current[key] ?? null;
      if (resolved) {
        list.push({ stop, resolved });
      }
    }

    return list;
  }, [visibleStops, plan.destination, resolvedByQuery]);

  // Trigger InfoWindow automatically on the first resolved attraction when a Day is clicked
  useEffect(() => {
    if (autoOpenDayTarget === null || selectedDay !== autoOpenDayTarget) return;

    const firstResolvedForDay = resolvedStops.find(
      (item) => item.stop.day === autoOpenDayTarget,
    );
    if (firstResolvedForDay) {
      onSelectStop(firstResolvedForDay.stop.id);
      onClearAutoOpenDay();
    }
  }, [
    autoOpenDayTarget,
    selectedDay,
    resolvedStops,
    onSelectStop,
    onClearAutoOpenDay,
  ]);

  const fitVisibleBounds = useCallback(() => {
    if (!map || !coreLib || resolvedStops.length === 0) return;

    if (resolvedStops.length === 1) {
      map.panTo(resolvedStops[0].resolved.position);
      map.setZoom(13);
      return;
    }

    const bounds = new coreLib.LatLngBounds();
    for (const item of resolvedStops) {
      bounds.extend(item.resolved.position);
    }
    map.fitBounds(bounds, 56);
  }, [map, coreLib, resolvedStops]);

  // Fit bounds when day filter or destination changes and resolved markers settle
  const lastFitSignatureRef = useRef<string>('');
  useEffect(() => {
    if (!map || !coreLib || resolvedStops.length === 0) return;
    const sig = `${plan.destination}::${selectedDay}::${resolvedStops.length}`;
    if (lastFitSignatureRef.current === sig) return;
    lastFitSignatureRef.current = sig;
    fitVisibleBounds();
  }, [map, coreLib, plan.destination, selectedDay, resolvedStops, fitVisibleBounds]);

  // Pan to selected stop when selected externally (from stop list, day trigger, or schedule button)
  useEffect(() => {
    if (!map || !selectedStopId) return;
    const target = resolvedStops.find((item) => item.stop.id === selectedStopId);
    if (target) {
      map.panTo(target.resolved.position);
    }
  }, [map, selectedStopId, resolvedStops]);

  // Sort markers by latitude descending for consistent z-index overlap
  const sortedForRender = useMemo(() => {
    return [...resolvedStops]
      .sort((a, b) => b.resolved.position.lat - a.resolved.position.lat)
      .map((item, idx) => ({
        ...item,
        baseZIndex: idx + 1,
      }));
  }, [resolvedStops]);

  const apiFailed =
    loadingStatus === APILoadingStatus.FAILED ||
    loadingStatus === APILoadingStatus.AUTH_FAILURE;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] border-t border-black/10">
      {/* Interactive Google Map Surface */}
      <div className="relative w-full h-[380px] md:h-[440px] bg-black/[0.03]">
        {apiFailed ? (
          <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center space-y-2">
            <MapPin className="w-6 h-6 text-wandor-prompt" />
            <p className="text-sm font-medium text-wandor-text">
              Unable to load Google Maps
            </p>
            <p className="text-xs text-wandor-muted max-w-sm">
              Please verify your network connection or Google Maps API key configuration.
            </p>
          </div>
        ) : (
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={{ lat: 10.0889, lng: 77.0595 }}
            defaultZoom={11}
            gestureHandling="cooperative"
            mapTypeControl={false}
            streetViewControl={false}
            fullscreenControl={true}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            onClick={() => onSelectStop(null)}
            style={{ width: '100%', height: '100%' }}
          >
            {sortedForRender.map(({ stop, resolved, baseZIndex }) => {
              const isSelected = selectedStopId === stop.id;
              const isHovered = hoveredStopId === stop.id;
              const zIndex = isSelected ? 1000 : isHovered ? 999 : baseZIndex;
              const orderIndex = resolvedStops.findIndex(
                (item) => item.stop.id === stop.id,
              );

              return (
                <ItineraryMarkerItem
                  key={stop.id}
                  stop={stop}
                  resolved={resolved}
                  displayOrder={stop.displayOrder}
                  showDayPrefix={selectedDay === 'all'}
                  isSelected={isSelected}
                  isHovered={isHovered}
                  zIndex={zIndex}
                  currentIndex={orderIndex >= 0 ? orderIndex : 0}
                  totalResolvedCount={resolvedStops.length}
                  onSelect={() => onSelectStop(stop.id)}
                  onSelectPrev={() => {
                    if (resolvedStops.length <= 1) return;
                    const prevIdx =
                      (orderIndex - 1 + resolvedStops.length) %
                      resolvedStops.length;
                    onSelectStop(resolvedStops[prevIdx].stop.id);
                  }}
                  onSelectNext={() => {
                    if (resolvedStops.length <= 1) return;
                    const nextIdx = (orderIndex + 1) % resolvedStops.length;
                    onSelectStop(resolvedStops[nextIdx].stop.id);
                  }}
                  onCloseInfo={() => onSelectStop(null)}
                  onHover={(hovered) =>
                    setHoveredStopId(hovered ? stop.id : null)
                  }
                  onJumpToSchedule={
                    onJumpToScheduleSlot
                      ? () => onJumpToScheduleSlot(stop.day, stop.id)
                      : undefined
                  }
                />
              );
            })}
          </GoogleMap>
        )}

        {/* Map Overlay Controls */}
        <div className="absolute top-3 left-3 right-14 flex flex-wrap items-center gap-2 pointer-events-none">
          {resolvingProgress && (
            <div className="pointer-events-auto rounded-full bg-white/95 backdrop-blur-sm border border-black/10 px-3.5 py-1.5 text-xs font-medium text-wandor-text shadow-sm">
              Locating stops ({resolvingProgress.done}/{resolvingProgress.total})...
            </div>
          )}
          {!resolvingProgress && resolvedStops.length > 0 && (
            <button
              type="button"
              onClick={fitVisibleBounds}
              className="pointer-events-auto cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur-sm border border-black/10 px-3.5 py-1.5 text-xs font-medium text-wandor-text shadow-sm hover:bg-white transition-colors"
            >
              <LocateFixed className="w-3.5 h-3.5 text-wandor-prompt" />
              Fit All Pins
            </button>
          )}
        </div>

        {lookupError && (
          <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-amber-50/95 border border-amber-200 px-3.5 py-2 text-xs text-amber-900 shadow-sm">
            {lookupError}
          </div>
        )}
      </div>

      {/* Synchronized Stop List Sidebar */}
      <div className="border-t lg:border-t-0 lg:border-l border-black/10 bg-white flex flex-col max-h-[380px] md:max-h-[440px]">
        <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.04em] text-wandor-muted">
            {selectedDay === 'all' ? 'All Itinerary Stops' : `Day ${selectedDay} Stops`}
          </span>
          <span className="text-xs text-wandor-muted tabular-nums">
            {resolvedStops.length}/{visibleStops.length} mapped
          </span>
        </div>

        <div className="overflow-y-auto divide-y divide-black/5 flex-1">
          {visibleStops.length === 0 ? (
            <div className="p-6 text-center text-xs text-wandor-muted">
              No scheduled locations for this selection.
            </div>
          ) : (
            visibleStops.map((stop) => {
              const key = normalizeQueryKey(plan.destination, stop.locationQuery);
              const resolved =
                resolvedByQuery[key] ?? cacheRef.current[key] ?? undefined;
              const isSelected = selectedStopId === stop.id;
              const isUnresolved = resolved === null;

              return (
                <button
                  key={stop.id}
                  type="button"
                  disabled={isUnresolved}
                  onClick={() => {
                    if (!resolved) return;
                    onSelectStop(stop.id);
                  }}
                  onMouseEnter={() => resolved && setHoveredStopId(stop.id)}
                  onMouseLeave={() => setHoveredStopId(null)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                    isSelected
                      ? 'bg-wandor-prompt/[0.08]'
                      : resolved
                        ? 'hover:bg-black/[0.03] cursor-pointer'
                        : 'opacity-55 cursor-default'
                  }`}
                >
                  <span
                    className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums ${
                      isSelected
                        ? 'bg-wandor-prompt text-white'
                        : resolved
                          ? 'text-white'
                          : 'bg-black/10 text-wandor-muted'
                    }`}
                    style={
                      resolved && !isSelected
                        ? { backgroundColor: getDayColor(stop.day) }
                        : undefined
                    }
                  >
                    {stop.displayOrder}
                  </span>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-wandor-muted tabular-nums">
                      <span>
                        Day {stop.day}
                        {stop.time ? ` · ${stop.time}` : ''}
                      </span>
                      {resolved && (
                        <Navigation className="w-3 h-3 text-wandor-prompt shrink-0" />
                      )}
                    </div>
                    <p className="text-xs font-medium text-wandor-text truncate">
                      {stop.locationName}
                    </p>
                    <p className="text-[11px] text-wandor-muted line-clamp-1">
                      {resolved
                        ? resolved.formattedAddress || stop.activity
                        : isUnresolved
                          ? 'Location not found on map'
                          : stop.activity}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function ItineraryMap({
  plan,
  selectedDay,
  onSelectDay,
  selectedStopId,
  onSelectStop,
  dayTrigger,
  onJumpToScheduleSlot,
}: ItineraryMapProps) {
  const mapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  const allStops = useMemo(() => extractItineraryStops(plan), [plan]);
  const [autoOpenDayTarget, setAutoOpenDayTarget] = useState<number | null>(null);

  useEffect(() => {
    if (!dayTrigger) return;
    setAutoOpenDayTarget(dayTrigger.day);
  }, [dayTrigger]);

  const handleClearAutoOpenDay = useCallback(() => {
    setAutoOpenDayTarget(null);
  }, []);

  return (
    <div
      id="itinerary-map"
      className="rounded-[28px] border border-black/10 bg-white overflow-hidden"
    >
      {/* Map Header & Day Filter Bar */}
      <div className="px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Compass className="w-5 h-5 text-wandor-prompt shrink-0" />
          <div>
            <h3 className="text-xl font-medium tracking-[-0.02em] text-wandor-text">
              Interactive Itinerary Map
            </h3>
            <p className="text-xs text-wandor-muted">
              Click any labeled marker, stop, or itinerary day to inspect attractions in{' '}
              {plan.destination}
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter map by day"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => {
              setAutoOpenDayTarget(null);
              onSelectDay('all');
              onSelectStop(null);
            }}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.04em] transition-colors ${
              selectedDay === 'all'
                ? 'bg-wandor-dark text-[#fafafa]'
                : 'border border-black/15 bg-white text-wandor-text hover:bg-black/5'
            }`}
          >
            All Days
          </button>
          {plan.dailyItinerary.map((day) => (
            <button
              key={day.day}
              type="button"
              onClick={() => {
                onSelectDay(day.day);
                onSelectStop(null);
                setAutoOpenDayTarget(day.day);
              }}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.04em] transition-colors tabular-nums ${
                selectedDay === day.day
                  ? 'bg-wandor-dark text-[#fafafa]'
                  : 'border border-black/15 bg-white text-wandor-text hover:bg-black/5'
              }`}
            >
              Day {day.day}
            </button>
          ))}
        </div>
      </div>

      {!mapsApiKey ? (
        <div className="border-t border-black/10 p-10 text-center space-y-2 bg-black/[0.02]">
          <MapPin className="w-6 h-6 text-wandor-prompt mx-auto" />
          <p className="text-sm font-medium text-wandor-text">
            Google Maps API key is not configured
          </p>
          <p className="text-xs text-wandor-muted max-w-md mx-auto">
            Set VITE_GOOGLE_MAPS_API_KEY in your environment to visualize daily itinerary stops on an interactive map.
          </p>
        </div>
      ) : (
        <APIProvider
          apiKey={mapsApiKey}
          libraries={['places', 'marker', 'core']}
        >
          <ItineraryMapContent
            plan={plan}
            allStops={allStops}
            selectedDay={selectedDay}
            selectedStopId={selectedStopId}
            onSelectStop={onSelectStop}
            autoOpenDayTarget={autoOpenDayTarget}
            onClearAutoOpenDay={handleClearAutoOpenDay}
            onJumpToScheduleSlot={onJumpToScheduleSlot}
          />
        </APIProvider>
      )}
    </div>
  );
}
