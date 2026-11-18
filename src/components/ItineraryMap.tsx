import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  LocateFixed,
  Navigation,
  Route as RouteIcon,
  X,
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

interface LatLngPoint {
  lat: number;
  lng: number;
}

interface ResolvedPlaceData {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  position: LatLngPoint;
}

interface DestinationAnchor {
  position: LatLngPoint;
  bounds: [[number, number], [number, number]] | null;
}

interface RouteLegMetric {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  durationMillis: number | null;
}

interface DayRouteData {
  day: number;
  polylines: LatLngPoint[][];
  legsByToStopId: Record<string, RouteLegMetric>;
  unavailableToStopIds: Record<string, true>;
  distanceMeters: number;
  durationMillis: number;
  hasDuration: boolean;
  routedSegments: number;
  totalSegments: number;
  unavailable: boolean;
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
const DEFAULT_MAP_CENTER: [number, number] = [10.0889, 77.0595];
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRouteDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  if (meters < 100000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters / 1000)} km`;
}

function formatRouteDuration(millis: number | null | undefined): string {
  if (typeof millis !== 'number' || !Number.isFinite(millis) || millis < 0) {
    return '';
  }
  if (millis === 0) {
    return '0 min';
  }
  const totalMinutes = Math.round(millis / 60000);
  if (totalMinutes < 1) {
    return '< 1 min';
  }
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
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

interface NominatimSearchItem {
  place_id?: number;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  boundingbox?: [string, string, string, string];
}

interface PhotonFeatureCollection {
  features?: Array<{
    geometry?: {
      coordinates?: [number, number];
    };
    properties?: {
      osm_id?: number;
      name?: string;
      street?: string;
      city?: string;
      state?: string;
      country?: string;
    };
  }>;
}

interface GeocodeOutcome {
  place: ResolvedPlaceData | null;
  bounds: [[number, number], [number, number]] | null;
  rateLimited: boolean;
}

async function fetchNominatimPlace(
  query: string,
  language: 'en' | 'ml',
  anchor: DestinationAnchor | null,
  signal: AbortSignal,
): Promise<GeocodeOutcome> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
  });
  if (anchor?.bounds) {
    const [[south, west], [north, east]] = anchor.bounds;
    params.set('viewbox', `${west},${north},${east},${south}`);
    params.set('bounded', '0');
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Accept-Language': language === 'ml' ? 'ml,en' : 'en',
      },
      signal,
    },
  );

  if (response.status === 429) {
    return { place: null, bounds: null, rateLimited: true };
  }
  if (!response.ok) {
    return { place: null, bounds: null, rateLimited: false };
  }

  const items = (await response.json()) as NominatimSearchItem[];
  const first = Array.isArray(items) ? items[0] : undefined;
  if (!first) {
    return { place: null, bounds: null, rateLimited: false };
  }

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { place: null, bounds: null, rateLimited: false };
  }

  let bounds: [[number, number], [number, number]] | null = null;
  if (Array.isArray(first.boundingbox) && first.boundingbox.length === 4) {
    const south = Number(first.boundingbox[0]);
    const north = Number(first.boundingbox[1]);
    const west = Number(first.boundingbox[2]);
    const east = Number(first.boundingbox[3]);
    if (
      Number.isFinite(south) &&
      Number.isFinite(north) &&
      Number.isFinite(west) &&
      Number.isFinite(east)
    ) {
      bounds = [
        [south, west],
        [north, east],
      ];
    }
  }

  const displayParts = (first.display_name || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const displayName = (first.name || displayParts[0] || query).trim();

  return {
    place: {
      placeId: String(first.place_id ?? first.osm_id ?? `${lat},${lng}`),
      displayName,
      formattedAddress: first.display_name || '',
      position: { lat, lng },
    },
    bounds,
    rateLimited: false,
  };
}

async function fetchPhotonPlace(
  query: string,
  anchor: DestinationAnchor | null,
  signal: AbortSignal,
): Promise<GeocodeOutcome> {
  const params = new URLSearchParams({
    q: query,
    limit: '1',
    lang: 'en',
  });
  if (anchor?.position) {
    params.set('lat', String(anchor.position.lat));
    params.set('lon', String(anchor.position.lng));
  }

  const response = await fetch(
    `https://photon.komoot.io/api/?${params.toString()}`,
    {
      method: 'GET',
      signal,
    },
  );

  if (response.status === 429) {
    return { place: null, bounds: null, rateLimited: true };
  }
  if (!response.ok) {
    return { place: null, bounds: null, rateLimited: false };
  }

  const payload = (await response.json()) as PhotonFeatureCollection;
  const feature = payload.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!feature || !coords || coords.length < 2) {
    return { place: null, bounds: null, rateLimited: false };
  }

  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { place: null, bounds: null, rateLimited: false };
  }

  const props = feature.properties ?? {};
  const addressParts = [
    props.name,
    props.street,
    props.city,
    props.state,
    props.country,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .filter((v, idx, arr) => arr.indexOf(v) === idx);

  return {
    place: {
      placeId: String(props.osm_id ?? `${lat},${lng}`),
      displayName: (props.name || addressParts[0] || query).trim(),
      formattedAddress: addressParts.join(', '),
      position: { lat, lng },
    },
    bounds: null,
    rateLimited: false,
  };
}

async function geocodeWithOsm(
  query: string,
  language: 'en' | 'ml',
  anchor: DestinationAnchor | null,
  signal: AbortSignal,
): Promise<GeocodeOutcome> {
  try {
    const nominatim = await fetchNominatimPlace(query, language, anchor, signal);
    if (nominatim.place) {
      return nominatim;
    }
    const photon = await fetchPhotonPlace(query, anchor, signal);
    if (photon.place) {
      return photon;
    }
    return {
      place: null,
      bounds: null,
      rateLimited: nominatim.rateLimited || photon.rateLimited,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    try {
      return await fetchPhotonPlace(query, anchor, signal);
    } catch {
      return { place: null, bounds: null, rateLimited: false };
    }
  }
}

interface OsrmRouteResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      coordinates?: Array<[number, number]>;
    };
    legs?: Array<{
      distance?: number;
      duration?: number;
    }>;
  }>;
}

async function fetchOsrmDrivingRoute(
  points: LatLngPoint[],
  signal: AbortSignal,
): Promise<OsrmRouteResponse | null> {
  if (points.length < 2) return null;
  const coords = points
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  const response = await fetch(url, { method: 'GET', signal });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as OsrmRouteResponse;
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    return null;
  }
  return data;
}

function createStopMarkerIcon(params: {
  badgeText: string;
  labelText: string;
  dayColor: string;
  isSelected: boolean;
  isHovered: boolean;
}): L.DivIcon {
  const { badgeText, labelText, dayColor, isSelected, isHovered } = params;
  const safeBadge = escapeHtml(badgeText);
  const safeLabel = escapeHtml(labelText);

  const pillBg = isSelected ? '#905831' : isHovered ? '#0a0a0a' : 'rgba(255,255,255,0.96)';
  const pillText = isSelected || isHovered ? '#ffffff' : '#0a0a0a';
  const pillBorder = isSelected
    ? '#5c361c'
    : isHovered
      ? '#0a0a0a'
      : 'rgba(10,10,10,0.16)';
  const badgeBg = isSelected ? '#0a0a0a' : dayColor;
  const stemColor = isSelected ? '#905831' : '#0a0a0a';
  const scaleTransform = isSelected
    ? 'scale(1.06)'
    : isHovered
      ? 'scale(1.03)'
      : 'scale(1)';

  const html = `
    <div style="width: 168px; height: 46px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; transform: ${scaleTransform}; transform-origin: bottom center; user-select: none; cursor: pointer; transition: transform 150ms ease;">
      <div style="display: inline-flex; align-items: center; gap: 6px; max-width: 168px; border-radius: 9999px; padding: 4px 10px 4px 4px; background: ${pillBg}; color: ${pillText}; border: 1px solid ${pillBorder}; box-shadow: 0 4px 12px rgba(10,10,10,0.16); white-space: nowrap; font-family: 'Geist', sans-serif;">
        <span style="display: inline-flex; align-items: center; justify-content: center; border-radius: 9999px; padding: 0 6px; height: 20px; min-width: 20px; background: ${badgeBg}; color: #ffffff; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; flex-shrink: 0;">${safeBadge}</span>
        <span style="max-width: 112px; overflow: hidden; text-overflow: ellipsis; font-size: 11px; font-weight: 500; line-height: 1;">${safeLabel}</span>
      </div>
      <div style="width: 2px; height: 6px; background: ${stemColor};"></div>
      <div style="width: 10px; height: 10px; border-radius: 9999px; background: ${stemColor}; border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(10,10,10,0.25);"></div>
    </div>
  `;

  return L.divIcon({
    className: 'safar-leaflet-marker',
    html,
    iconSize: [168, 46],
    iconAnchor: [84, 46],
  });
}

interface LeafletMapControllerProps {
  mapRef: React.MutableRefObject<L.Map | null>;
  anchor: DestinationAnchor | null;
  resolvedStops: Array<{
    stop: ItineraryMapStop & { displayOrder: number };
    resolved: ResolvedPlaceData;
  }>;
  selectedDay: number | 'all';
  selectedStopId: string | null;
  destination: string;
  onMapClick: () => void;
}

function LeafletMapController({
  mapRef,
  anchor,
  resolvedStops,
  selectedDay,
  selectedStopId,
  destination,
  onMapClick,
}: LeafletMapControllerProps) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) {
        mapRef.current = null;
      }
    };
  }, [map, mapRef]);

  useMapEvents({
    click: (e) => {
      const target = e.originalEvent?.target;
      if (
        target instanceof Element &&
        target.closest('.leaflet-popup, .leaflet-marker-icon, .leaflet-control')
      ) {
        return;
      }
      onMapClick();
    },
  });

  // Fit initial destination anchor while individual stops are still resolving
  const lastAnchorDestRef = useRef<string>('');
  useEffect(() => {
    if (!anchor || resolvedStops.length > 0) return;
    if (lastAnchorDestRef.current === destination) return;
    lastAnchorDestRef.current = destination;

    if (anchor.bounds) {
      map.fitBounds(anchor.bounds, { padding: [36, 36], maxZoom: 13 });
    } else {
      map.setView([anchor.position.lat, anchor.position.lng], 11);
    }
  }, [map, anchor, resolvedStops.length, destination]);

  // Fit bounds when day filter or destination changes and resolved markers settle
  const lastFitSignatureRef = useRef<string>('');
  useEffect(() => {
    if (resolvedStops.length === 0) return;
    const sig = `${destination}::${selectedDay}::${resolvedStops.length}`;
    if (lastFitSignatureRef.current === sig) return;
    lastFitSignatureRef.current = sig;

    if (resolvedStops.length === 1) {
      const pos = resolvedStops[0].resolved.position;
      map.setView([pos.lat, pos.lng], 13, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(
      resolvedStops.map((item) => [
        item.resolved.position.lat,
        item.resolved.position.lng,
      ]),
    );
    map.fitBounds(bounds, { padding: [52, 52], maxZoom: 14 });
  }, [map, destination, selectedDay, resolvedStops]);

  // Pan to selected stop when selected externally (sidebar click, day trigger, prev/next)
  useEffect(() => {
    if (!selectedStopId) return;
    const target = resolvedStops.find((item) => item.stop.id === selectedStopId);
    if (target) {
      map.panTo([target.resolved.position.lat, target.resolved.position.lng], {
        animate: true,
      });
    }
  }, [map, selectedStopId, resolvedStops]);

  return null;
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
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [hoveredStopId, setHoveredStopId] = useState<string | null>(null);
  const [resolvedByQuery, setResolvedByQuery] = useState<
    Record<string, ResolvedPlaceData | null>
  >({});
  const [destinationAnchor, setDestinationAnchor] =
    useState<DestinationAnchor | null>(null);
  const [resolvingProgress, setResolvingProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [dayRoutesByKey, setDayRoutesByKey] = useState<
    Record<string, DayRouteData>
  >({});
  const [routesLoading, setRoutesLoading] = useState(false);

  const cacheRef = useRef<Record<string, ResolvedPlaceData | null>>({});
  const destAnchorRef = useRef<Record<string, DestinationAnchor | null>>({});
  const routeCacheRef = useRef<Record<string, DayRouteData>>({});

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

  // Resolve destination center and visible stops using free OpenStreetMap Nominatim + Photon geocoding
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLookupError(null);

    const destination = plan.destination.trim();
    const language: 'en' | 'ml' = plan.language === 'ml' ? 'ml' : 'en';

    const resolveStops = async () => {
      let anchor = destAnchorRef.current[destination] ?? null;

      if (!anchor && destination) {
        try {
          const outcome = await geocodeWithOsm(
            destination,
            language,
            null,
            controller.signal,
          );
          if (cancelled) return;
          if (outcome.place) {
            anchor = {
              position: outcome.place.position,
              bounds: outcome.bounds,
            };
            destAnchorRef.current[destination] = anchor;
            setDestinationAnchor(anchor);
          }
        } catch (err) {
          if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
            return;
          }
        }
      } else if (anchor) {
        setDestinationAnchor(anchor);
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
      let completed = 0;
      let hitRateLimit = false;

      // Batch gently (2 concurrent requests) to respect free public OpenStreetMap geocoding limits
      const batchSize = 2;
      for (let i = 0; i < pending.length; i += batchSize) {
        if (cancelled) break;
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
              let outcome = await geocodeWithOsm(
                textQuery,
                language,
                anchor,
                controller.signal,
              );

              if (
                !outcome.place &&
                !outcome.rateLimited &&
                stop.locationName &&
                stop.locationName !== textQuery
              ) {
                const simpleQuery = destination
                  ? `${stop.locationName}, ${destination.split(',')[0].trim()}`
                  : stop.locationName;
                outcome = await geocodeWithOsm(
                  simpleQuery,
                  language,
                  anchor,
                  controller.signal,
                );
              }

              if (cancelled) return;
              if (outcome.rateLimited && !outcome.place) {
                hitRateLimit = true;
              }
              cacheRef.current[cacheKey] = outcome.place;
            } catch (err) {
              if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
                return;
              }
              cacheRef.current[cacheKey] = null;
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
        if (hitRateLimit) {
          setLookupError(
            'OpenStreetMap geocoding rate limit was reached for some stops. Please try filtering by a single day.',
          );
        }
      }
    };

    void resolveStops();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [plan.destination, plan.language, stopsToResolve]);

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

  // Group resolved stops by day and build stable cache keys for OSRM routing
  const dayRouteGroups = useMemo(() => {
    const groupsByDay: Record<
      number,
      Array<{
        stop: ItineraryMapStop & { displayOrder: number };
        resolved: ResolvedPlaceData;
      }>
    > = {};

    for (const item of resolvedStops) {
      if (!groupsByDay[item.stop.day]) {
        groupsByDay[item.stop.day] = [];
      }
      groupsByDay[item.stop.day].push(item);
    }

    const orderedDays = Object.keys(groupsByDay)
      .map(Number)
      .sort((a, b) => a - b);

    return orderedDays
      .filter((day) => groupsByDay[day].length >= 2)
      .map((day) => {
        const items = groupsByDay[day];
        const stopsSignature = items
          .map(
            (item) =>
              `${item.stop.id}@${item.resolved.position.lat.toFixed(5)},${item.resolved.position.lng.toFixed(5)}`,
          )
          .join('|');
        const cacheKey = `${plan.destination.trim().toLowerCase()}::day-${day}::${stopsSignature}`;
        return { day, items, cacheKey };
      });
  }, [resolvedStops, plan.destination]);

  // Compute driving routes using free OSRM public routing API
  useEffect(() => {
    if (resolvingProgress !== null || dayRouteGroups.length === 0) {
      setRoutesLoading(false);
      return;
    }

    const pendingGroups = dayRouteGroups.filter(
      (group) => !(group.cacheKey in routeCacheRef.current),
    );

    if (pendingGroups.length === 0) {
      setRoutesLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setRoutesLoading(true);

    const computePairwiseFallback = async (
      group: (typeof dayRouteGroups)[number],
    ): Promise<DayRouteData> => {
      const polylines: LatLngPoint[][] = [];
      const legsByToStopId: Record<string, RouteLegMetric> = {};
      const unavailableToStopIds: Record<string, true> = {};
      let distanceMeters = 0;
      let durationMillis = 0;
      let hasDuration = false;
      let routedSegments = 0;
      const totalSegments = group.items.length - 1;

      for (let i = 0; i < totalSegments; i += 1) {
        if (cancelled) break;
        const fromItem = group.items[i];
        const toItem = group.items[i + 1];

        try {
          const data = await fetchOsrmDrivingRoute(
            [fromItem.resolved.position, toItem.resolved.position],
            controller.signal,
          );
          if (cancelled) break;

          const segRoute = data?.routes?.[0];
          const coords = segRoute?.geometry?.coordinates;
          if (segRoute && coords && coords.length >= 2) {
            const line = coords.map(([lng, lat]) => ({ lat, lng }));
            const segDistance =
              typeof segRoute.distance === 'number' ? segRoute.distance : 0;
            const segDuration =
              typeof segRoute.duration === 'number'
                ? segRoute.duration * 1000
                : null;

            polylines.push(line);
            distanceMeters += segDistance;
            if (segDuration !== null) {
              durationMillis += segDuration;
              hasDuration = true;
            }
            routedSegments += 1;
            legsByToStopId[toItem.stop.id] = {
              fromStopId: fromItem.stop.id,
              toStopId: toItem.stop.id,
              distanceMeters: segDistance,
              durationMillis: segDuration,
            };
          } else {
            unavailableToStopIds[toItem.stop.id] = true;
          }
        } catch (err) {
          if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
            break;
          }
          unavailableToStopIds[toItem.stop.id] = true;
        }
      }

      return {
        day: group.day,
        polylines,
        legsByToStopId,
        unavailableToStopIds,
        distanceMeters,
        durationMillis,
        hasDuration,
        routedSegments,
        totalSegments,
        unavailable: routedSegments === 0,
      };
    };

    const runComputeRoutes = async () => {
      for (const group of pendingGroups) {
        if (cancelled) break;

        const cappedItems = group.items.slice(0, 25);
        const totalSegments = group.items.length - 1;

        try {
          const data = await fetchOsrmDrivingRoute(
            cappedItems.map((item) => item.resolved.position),
            controller.signal,
          );
          if (cancelled) return;

          const primaryRoute = data?.routes?.[0];
          const coords = primaryRoute?.geometry?.coordinates;
          const legs = primaryRoute?.legs ?? [];

          if (
            primaryRoute &&
            coords &&
            coords.length >= 2 &&
            legs.length >= cappedItems.length - 1
          ) {
            const line = coords.map(([lng, lat]) => ({ lat, lng }));
            const legsByToStopId: Record<string, RouteLegMetric> = {};
            const unavailableToStopIds: Record<string, true> = {};
            let summedDistance = 0;
            let summedDuration = 0;
            let hasDuration = false;

            for (let i = 0; i < cappedItems.length - 1; i += 1) {
              const fromItem = cappedItems[i];
              const toItem = cappedItems[i + 1];
              const leg = legs[i];
              const legDistance =
                typeof leg?.distance === 'number' ? leg.distance : 0;
              const legDuration =
                typeof leg?.duration === 'number' ? leg.duration * 1000 : null;

              summedDistance += legDistance;
              if (legDuration !== null) {
                summedDuration += legDuration;
                hasDuration = true;
              }
              legsByToStopId[toItem.stop.id] = {
                fromStopId: fromItem.stop.id,
                toStopId: toItem.stop.id,
                distanceMeters: legDistance,
                durationMillis: legDuration,
              };
            }

            for (let i = cappedItems.length; i < group.items.length; i += 1) {
              unavailableToStopIds[group.items[i].stop.id] = true;
            }

            const totalDistance =
              typeof primaryRoute.distance === 'number'
                ? primaryRoute.distance
                : summedDistance;
            const totalDuration =
              typeof primaryRoute.duration === 'number'
                ? primaryRoute.duration * 1000
                : summedDuration;
            if (typeof primaryRoute.duration === 'number') {
              hasDuration = true;
            }

            routeCacheRef.current[group.cacheKey] = {
              day: group.day,
              polylines: [line],
              legsByToStopId,
              unavailableToStopIds,
              distanceMeters: totalDistance,
              durationMillis: totalDuration,
              hasDuration,
              routedSegments: cappedItems.length - 1,
              totalSegments,
              unavailable: false,
            };
          } else {
            const fallbackResult = await computePairwiseFallback(group);
            if (!cancelled) {
              routeCacheRef.current[group.cacheKey] = fallbackResult;
            }
          }
        } catch (err) {
          if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
            return;
          }
          if (group.items.length > 2) {
            const fallbackResult = await computePairwiseFallback(group);
            if (!cancelled) {
              routeCacheRef.current[group.cacheKey] = fallbackResult;
            }
          } else {
            const unavailableToStopIds: Record<string, true> = {};
            if (group.items[1]) {
              unavailableToStopIds[group.items[1].stop.id] = true;
            }
            routeCacheRef.current[group.cacheKey] = {
              day: group.day,
              polylines: [],
              legsByToStopId: {},
              unavailableToStopIds,
              distanceMeters: 0,
              durationMillis: 0,
              hasDuration: false,
              routedSegments: 0,
              totalSegments,
              unavailable: true,
            };
          }
        }

        if (!cancelled) {
          setDayRoutesByKey({ ...routeCacheRef.current });
        }
      }

      if (!cancelled) {
        setRoutesLoading(false);
      }
    };

    void runComputeRoutes();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [resolvingProgress, dayRouteGroups]);

  // Aggregate route summary & per-stop leg lookup across visible days
  const routeSummary = useMemo(() => {
    const legsByToStopId: Record<string, RouteLegMetric> = {};
    const unavailableToStopIds: Record<string, true> = {};
    let totalDistanceMeters = 0;
    let totalDurationMillis = 0;
    let hasDuration = false;
    let routedSegments = 0;
    let totalSegments = 0;
    let computedGroupCount = 0;

    for (const group of dayRouteGroups) {
      totalSegments += group.items.length - 1;
      const data =
        dayRoutesByKey[group.cacheKey] ?? routeCacheRef.current[group.cacheKey];
      if (!data) continue;

      computedGroupCount += 1;
      totalDistanceMeters += data.distanceMeters;
      if (data.hasDuration) {
        totalDurationMillis += data.durationMillis;
        hasDuration = true;
      }
      routedSegments += data.routedSegments;
      Object.assign(legsByToStopId, data.legsByToStopId);
      Object.assign(unavailableToStopIds, data.unavailableToStopIds);
    }

    const allGroupsComputed =
      dayRouteGroups.length > 0 && computedGroupCount === dayRouteGroups.length;

    return {
      hasRoutablePairs: dayRouteGroups.length > 0,
      allGroupsComputed,
      totalDistanceMeters,
      totalDurationMillis,
      hasDuration,
      routedSegments,
      totalSegments,
      legsByToStopId,
      unavailableToStopIds,
    };
  }, [dayRouteGroups, dayRoutesByKey]);

  // Trigger Popup automatically on the first resolved attraction when a Day is clicked
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
    const map = mapInstanceRef.current;
    if (!map || resolvedStops.length === 0) return;

    if (resolvedStops.length === 1) {
      const pos = resolvedStops[0].resolved.position;
      map.setView([pos.lat, pos.lng], 13, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(
      resolvedStops.map((item) => [
        item.resolved.position.lat,
        item.resolved.position.lng,
      ]),
    );
    map.fitBounds(bounds, { padding: [52, 52], maxZoom: 14 });
  }, [resolvedStops]);

  const sortedForRender = useMemo(() => {
    return [...resolvedStops]
      .sort((a, b) => b.resolved.position.lat - a.resolved.position.lat)
      .map((item, idx) => ({
        ...item,
        baseZIndex: idx + 1,
      }));
  }, [resolvedStops]);

  const selectedIndex = useMemo(() => {
    if (!selectedStopId) return -1;
    return resolvedStops.findIndex((item) => item.stop.id === selectedStopId);
  }, [resolvedStops, selectedStopId]);

  const selectedEntry =
    selectedIndex >= 0 ? resolvedStops[selectedIndex] : null;

  const selectedLat = selectedEntry?.resolved.position.lat ?? null;
  const selectedLng = selectedEntry?.resolved.position.lng ?? null;
  const selectedPopupPosition = useMemo<[number, number] | null>(
    () =>
      selectedLat !== null && selectedLng !== null
        ? [selectedLat, selectedLng]
        : null,
    [selectedLat, selectedLng],
  );

  const renderedPolylines = useMemo(() => {
    const isSingleDay = selectedDay !== 'all';
    const items: Array<{
      key: string;
      positions: [number, number][];
      color: string;
      opacity: number;
      weight: number;
    }> = [];

    for (const group of dayRouteGroups) {
      const routeData =
        dayRoutesByKey[group.cacheKey] ?? routeCacheRef.current[group.cacheKey];
      if (!routeData || routeData.polylines.length === 0) continue;

      const dayColor = getDayColor(group.day);
      routeData.polylines.forEach((line, idx) => {
        if (line.length < 2) return;
        items.push({
          key: `${group.cacheKey}::line-${idx}`,
          positions: line.map((p) => [p.lat, p.lng]),
          color: dayColor,
          opacity: isSingleDay ? 0.9 : 0.75,
          weight: isSingleDay ? 5 : 4,
        });
      });
    }

    return items;
  }, [dayRouteGroups, dayRoutesByKey, selectedDay]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] border-t border-black/10">
      {/* Interactive OpenStreetMap Surface (Leaflet) */}
      <div className="relative w-full h-[380px] md:h-[440px] bg-black/[0.03] z-0">
        <MapContainer
          center={DEFAULT_MAP_CENTER}
          zoom={11}
          scrollWheelZoom={true}
          zoomControl={true}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />

          <LeafletMapController
            mapRef={mapInstanceRef}
            anchor={destinationAnchor}
            resolvedStops={resolvedStops}
            selectedDay={selectedDay}
            selectedStopId={selectedStopId}
            destination={plan.destination}
            onMapClick={() => onSelectStop(null)}
          />

          {renderedPolylines.map((line) => (
            <Polyline
              key={line.key}
              positions={line.positions}
              pathOptions={{
                color: line.color,
                opacity: line.opacity,
                weight: line.weight,
              }}
            />
          ))}

          {sortedForRender.map(({ stop, resolved, baseZIndex }) => {
            const isSelected = selectedStopId === stop.id;
            const isHovered = hoveredStopId === stop.id;
            const zIndexOffset = isSelected ? 1000 : isHovered ? 900 : baseZIndex;
            const badgeText =
              selectedDay === 'all'
                ? `D${stop.day}·${stop.displayOrder}`
                : String(stop.displayOrder);
            const labelText =
              stop.locationName || resolved.displayName || stop.activity;

            const icon = createStopMarkerIcon({
              badgeText,
              labelText,
              dayColor: getDayColor(stop.day),
              isSelected,
              isHovered,
            });

            return (
              <Marker
                key={stop.id}
                position={[resolved.position.lat, resolved.position.lng]}
                icon={icon}
                zIndexOffset={zIndexOffset}
                title={`${labelText} (Day ${stop.day})`}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    onSelectStop(stop.id);
                  },
                  mouseover: () => setHoveredStopId(stop.id),
                  mouseout: () => setHoveredStopId(null),
                }}
              />
            );
          })}

          {selectedEntry && selectedPopupPosition && (
            <Popup
              position={selectedPopupPosition}
              offset={[0, -40]}
              maxWidth={300}
              closeButton={false}
              closeOnClick={false}
              autoPan={true}
              className="safar-leaflet-popup"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="font-sans text-wandor-text space-y-2 min-w-[220px] max-w-[270px]"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-wandor-prompt">
                  <span>
                    Day {selectedEntry.stop.day}
                    {selectedEntry.stop.time
                      ? ` · ${selectedEntry.stop.time}`
                      : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    {resolvedStops.length > 1 && (
                      <span className="text-wandor-muted font-medium tabular-nums">
                        {selectedIndex + 1}/{resolvedStops.length}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectStop(null)}
                      aria-label="Close stop details"
                      className="cursor-pointer inline-flex items-center justify-center w-5 h-5 rounded-full text-wandor-muted hover:text-wandor-text hover:bg-black/5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-wandor-text leading-snug !m-0">
                    {selectedEntry.resolved.displayName ||
                      selectedEntry.stop.locationName}
                  </p>
                  {selectedEntry.stop.activity &&
                    selectedEntry.stop.activity !==
                      selectedEntry.resolved.displayName && (
                      <p className="text-xs text-wandor-text/80 leading-snug !mt-0.5 !mb-0">
                        {selectedEntry.stop.activity}
                      </p>
                    )}
                </div>

                {selectedEntry.resolved.formattedAddress && (
                  <p className="text-[11px] text-wandor-muted leading-snug !m-0">
                    {selectedEntry.resolved.formattedAddress}
                  </p>
                )}

                {(selectedEntry.stop.visitingHours ||
                  selectedEntry.stop.travelTimeFromPrev) && (
                  <p className="text-[11px] text-wandor-muted !m-0">
                    {selectedEntry.stop.visitingHours
                      ? `Hours: ${selectedEntry.stop.visitingHours}`
                      : ''}
                    {selectedEntry.stop.visitingHours &&
                    selectedEntry.stop.travelTimeFromPrev
                      ? ' · '
                      : ''}
                    {selectedEntry.stop.travelTimeFromPrev}
                  </p>
                )}

                {routeSummary.legsByToStopId[selectedEntry.stop.id] && (
                  <div className="inline-flex items-center gap-1.5 rounded-lg bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-wandor-text tabular-nums">
                    <RouteIcon className="w-3 h-3 text-wandor-prompt shrink-0" />
                    <span>
                      Drive from previous:{' '}
                      {formatRouteDistance(
                        routeSummary.legsByToStopId[selectedEntry.stop.id]
                          .distanceMeters,
                      )}
                      {formatRouteDuration(
                        routeSummary.legsByToStopId[selectedEntry.stop.id]
                          .durationMillis,
                      )
                        ? ` · ${formatRouteDuration(
                            routeSummary.legsByToStopId[selectedEntry.stop.id]
                              .durationMillis,
                          )}`
                        : ''}
                    </span>
                  </div>
                )}

                {!routeSummary.legsByToStopId[selectedEntry.stop.id] &&
                  routeSummary.unavailableToStopIds[selectedEntry.stop.id] && (
                    <p className="text-[11px] text-wandor-muted italic !m-0">
                      Driving route unavailable from previous stop
                    </p>
                  )}

                {(onJumpToScheduleSlot || resolvedStops.length > 1) && (
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-black/10">
                    {onJumpToScheduleSlot ? (
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToScheduleSlot(
                            selectedEntry.stop.day,
                            selectedEntry.stop.id,
                          )
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-wandor-prompt hover:underline cursor-pointer"
                      >
                        View in schedule
                      </button>
                    ) : (
                      <span />
                    )}

                    {resolvedStops.length > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const prevIdx =
                              (selectedIndex - 1 + resolvedStops.length) %
                              resolvedStops.length;
                            onSelectStop(resolvedStops[prevIdx].stop.id);
                          }}
                          aria-label="Previous stop"
                          className="cursor-pointer inline-flex items-center justify-center w-6 h-6 rounded-full border border-black/15 text-wandor-text hover:bg-black/5"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextIdx =
                              (selectedIndex + 1) % resolvedStops.length;
                            onSelectStop(resolvedStops[nextIdx].stop.id);
                          }}
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
            </Popup>
          )}
        </MapContainer>

        {/* Map Overlay Controls */}
        <div className="absolute top-3 left-14 right-3 z-[400] flex flex-wrap items-center gap-2 pointer-events-none">
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
          {!resolvingProgress && routeSummary.hasRoutablePairs && routesLoading && (
            <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur-sm border border-black/10 px-3.5 py-1.5 text-xs font-medium text-wandor-muted shadow-sm">
              <RouteIcon className="w-3.5 h-3.5 text-wandor-prompt" />
              Calculating route...
            </div>
          )}
          {!resolvingProgress &&
            !routesLoading &&
            routeSummary.routedSegments > 0 && (
              <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur-sm border border-black/10 px-3.5 py-1.5 text-xs font-medium text-wandor-text shadow-sm tabular-nums">
                <RouteIcon className="w-3.5 h-3.5 text-wandor-prompt shrink-0" />
                <span>
                  {formatRouteDistance(routeSummary.totalDistanceMeters)}
                </span>
                {routeSummary.hasDuration && (
                  <>
                    <span className="text-wandor-muted">·</span>
                    <Clock className="w-3 h-3 text-wandor-muted shrink-0" />
                    <span>
                      {formatRouteDuration(routeSummary.totalDurationMillis)}
                    </span>
                  </>
                )}
              </div>
            )}
          {!resolvingProgress &&
            !routesLoading &&
            routeSummary.allGroupsComputed &&
            routeSummary.routedSegments === 0 && (
              <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur-sm border border-black/10 px-3.5 py-1.5 text-xs font-medium text-wandor-muted shadow-sm">
                <RouteIcon className="w-3.5 h-3.5 text-wandor-muted shrink-0" />
                Route unavailable between stops
              </div>
            )}
        </div>

        {lookupError && (
          <div className="absolute bottom-7 left-3 right-3 z-[400] rounded-xl bg-amber-50/95 border border-amber-200 px-3.5 py-2 text-xs text-amber-900 shadow-sm">
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

        {!resolvingProgress && routeSummary.hasRoutablePairs && (
          <div className="px-4 py-2 border-b border-black/10 bg-black/[0.02] flex items-center justify-between gap-2 text-[11px] text-wandor-muted tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-medium text-wandor-text">
              <RouteIcon className="w-3.5 h-3.5 text-wandor-prompt shrink-0" />
              {routesLoading
                ? 'Calculating driving route...'
                : routeSummary.routedSegments > 0
                  ? `${formatRouteDistance(routeSummary.totalDistanceMeters)}${
                      routeSummary.hasDuration
                        ? ` · ${formatRouteDuration(routeSummary.totalDurationMillis)}`
                        : ''
                    }`
                  : 'Driving route unavailable'}
            </span>
            {!routesLoading &&
              routeSummary.routedSegments > 0 &&
              routeSummary.routedSegments < routeSummary.totalSegments && (
                <span>
                  {routeSummary.routedSegments}/{routeSummary.totalSegments} legs
                </span>
              )}
          </div>
        )}

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
              const legFromPrev = routeSummary.legsByToStopId[stop.id];
              const legUnavailable = Boolean(
                routeSummary.unavailableToStopIds[stop.id],
              );

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
                    {legFromPrev && (
                      <p className="text-[11px] font-medium text-wandor-prompt tabular-nums pt-0.5">
                        +{formatRouteDistance(legFromPrev.distanceMeters)}
                        {formatRouteDuration(legFromPrev.durationMillis)
                          ? ` · ${formatRouteDuration(legFromPrev.durationMillis)}`
                          : ''}
                      </p>
                    )}
                    {!legFromPrev && legUnavailable && (
                      <p className="text-[11px] text-wandor-muted/80 italic pt-0.5">
                        Route segment unavailable
                      </p>
                    )}
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
      data-print-hide="true"
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
    </div>
  );
}
