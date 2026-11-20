import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, MapPin, RefreshCw, Search } from 'lucide-react';
import DestinationDetailModal from '@/components/DestinationDetailModal';
import type { DestinationDetailTarget } from '@/components/DestinationDetailModal';
import ResponsivePhoto from '@/components/ResponsivePhoto';
import {
  fetchFeaturedDestinations,
  searchDestinationPhotos,
} from '@/services/photoService';
import type {
  DestinationPhoto,
  DestinationPhotoResult,
  FeaturedDestinationCard,
  PhotoCategory,
} from '@/types/photo';

interface DestinationGalleryProps {
  onSelectDestinationForTrip: (destinationName: string) => void;
}

const CATEGORY_TABS: Array<{ id: PhotoCategory; label: string }> = [
  { id: 'all', label: 'All Destinations' },
  { id: 'mountains', label: 'Mountains' },
  { id: 'beaches', label: 'Beaches & Coast' },
  { id: 'cities', label: 'Cities' },
  { id: 'landmarks', label: 'Landmarks' },
  { id: 'hotels', label: 'Stays & Resorts' },
];

const QUICK_DESTINATIONS = ['Munnar', 'Alleppey', 'Goa', 'Paris', 'Dubai', 'Bali'];

export default function DestinationGallery({
  onSelectDestinationForTrip,
}: DestinationGalleryProps) {
  const [featured, setFeatured] = useState<FeaturedDestinationCard[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState<string | null>(null);
  const [featuredRetryNonce, setFeaturedRetryNonce] = useState(0);

  const [activeCategory, setActiveCategory] = useState<PhotoCategory>('all');
  const [searchInput, setSearchInput] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [searchResult, setSearchResult] =
    useState<DestinationPhotoResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [detailTarget, setDetailTarget] =
    useState<DestinationDetailTarget | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFeaturedLoading(true);
    setFeaturedError(null);

    fetchFeaturedDestinations(controller.signal)
      .then((cards) => {
        if (!controller.signal.aborted) {
          setFeatured(cards);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to load destination photography. Please retry.';
        console.error('[SAFAR Gallery] Featured destinations fetch failed:', {
          message,
        });
        setFeaturedError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setFeaturedLoading(false);
        }
      });

    return () => controller.abort();
  }, [featuredRetryNonce]);

  const runSearch = useCallback(
    async (queryText: string, category: PhotoCategory, signal?: AbortSignal) => {
      const cleaned = queryText.trim();
      if (!cleaned) {
        setActiveSearchQuery('');
        setSearchResult(null);
        setSearchError(null);
        return;
      }

      setActiveSearchQuery(cleaned);
      setSearchLoading(true);
      setSearchError(null);

      try {
        const res = await searchDestinationPhotos(
          {
            query: cleaned,
            category,
            limit: 8,
          },
          signal,
        );
        if (!signal?.aborted) {
          setSearchResult(res);
        }
      } catch (err) {
        if (signal?.aborted) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to fetch photographs for this destination. Please retry.';
        console.error('[SAFAR Gallery] Destination photo search failed:', {
          query: cleaned,
          category,
          message,
        });
        setSearchError(message);
      } finally {
        if (!signal?.aborted) {
          setSearchLoading(false);
        }
      }
    },
    [],
  );

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(searchInput, activeCategory);
  };

  const handleQuickPick = (name: string) => {
    setSearchInput(name);
    void runSearch(name, activeCategory);
  };

  const handleCategoryChange = (category: PhotoCategory) => {
    setActiveCategory(category);
    if (activeSearchQuery) {
      void runSearch(activeSearchQuery, category);
    }
  };

  const filteredFeatured = useMemo(() => {
    if (activeCategory === 'all') return featured;
    return featured.filter((card) => card.category === activeCategory);
  }, [featured, activeCategory]);

  const isSearchMode = Boolean(activeSearchQuery);

  return (
    <section
      id="destinations"
      data-print-hide="true"
      className="w-full bg-gradient-to-b from-safar-skySoft/85 via-white to-white text-safar-navy border-t border-safar-border"
    >
      <div className="max-w-[1200px] mx-auto px-6 py-16 md:py-20 space-y-8">
        {/* Header & Search Controls */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between pb-6 border-b border-safar-border">
          <div className="space-y-2 max-w-xl">
            <p className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange">
              Discover · SAFAR Destination Photography
            </p>
            <h2 className="font-sans text-[clamp(28px,3.6vw,42px)] font-semibold tracking-[-0.03em] text-safar-navy leading-tight">
              Explore places in real detail
            </h2>
            <p className="text-sm text-safar-slate leading-relaxed">
              Browse verified photographs of mountains, backwaters, beaches,
              stays, and landmarks before building your itinerary.
            </p>
          </div>

          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col sm:flex-row gap-2.5 w-full lg:w-auto lg:min-w-[420px] rounded-2xl sm:rounded-full bg-white p-1.5 border border-safar-border shadow-[0_6px_20px_rgba(15,37,68,0.05)]"
          >
            <div className="relative flex-1">
              <Search
                className="w-4 h-4 text-safar-orange absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search Munnar, Paris, Bali, Eiffel Tower..."
                aria-label="Search destination or attraction photography"
                maxLength={120}
                className="w-full rounded-full bg-transparent pl-10 pr-4 py-2 text-sm text-safar-navy placeholder:text-safar-slate/70 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={searchLoading}
              className="cursor-pointer rounded-full bg-safar-navy px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-safar-navyHover transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {searchLoading ? 'Searching...' : 'Search Photos'}
            </button>
          </form>
        </div>

        {/* Category Filter Tabs + Quick Destination Shortcuts */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div
            role="tablist"
            aria-label="Filter destination photography by category"
            className="flex flex-wrap items-center gap-2"
          >
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeCategory === tab.id}
                onClick={() => handleCategoryChange(tab.id)}
                className={`cursor-pointer rounded-full px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeCategory === tab.id
                    ? 'bg-safar-navy text-white shadow-xs'
                    : 'border border-safar-border bg-white text-safar-navy hover:bg-safar-skySoft'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-safar-slate">
            <span className="font-medium text-safar-navy">Popular:</span>
            {QUICK_DESTINATIONS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => handleQuickPick(name)}
                className={`cursor-pointer transition-colors hover:text-safar-orange ${
                  activeSearchQuery.toLowerCase() === name.toLowerCase()
                    ? 'font-semibold text-safar-orange underline underline-offset-4'
                    : 'underline decoration-safar-border underline-offset-4'
                }`}
              >
                {name}
              </button>
            ))}
            {isSearchMode && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setActiveSearchQuery('');
                    setSearchResult(null);
                    setSearchError(null);
                  }}
                  className="cursor-pointer font-semibold text-safar-navy hover:text-safar-orange transition-colors"
                >
                  Reset View
                </button>
              </>
            )}
          </div>
        </div>

        {/* SEARCH RESULTS VIEW */}
        {isSearchMode ? (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-safar-border bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,37,68,0.03)]">
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-safar-navy">
                  {searchResult?.resolvedLocation || activeSearchQuery}
                </h3>
                <p className="text-xs text-safar-slate">
                  {searchLoading
                    ? `Fetching real photographs for ${activeSearchQuery}...`
                    : searchResult
                      ? `${searchResult.photos.length} verified ${searchResult.photos.length === 1 ? 'photograph' : 'photographs'} via ${searchResult.provider === 'wikimedia' ? 'Wikimedia Commons' : searchResult.provider === 'unsplash' ? 'Unsplash' : 'Pexels'}`
                      : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {searchResult && searchResult.photos.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setDetailTarget({
                        name: activeSearchQuery,
                        query: activeSearchQuery,
                        category: activeCategory,
                        initialPhotos: searchResult.photos,
                      })
                    }
                    className="cursor-pointer rounded-full border border-safar-border bg-safar-skySoft px-4 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy hover:bg-safar-sky transition-colors whitespace-nowrap"
                  >
                    Open Full Gallery
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onSelectDestinationForTrip(activeSearchQuery)}
                  className="cursor-pointer rounded-full bg-safar-orange px-4 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-white hover:bg-safar-orangeHover transition-colors whitespace-nowrap"
                >
                  Plan Trip Here
                </button>
              </div>
            </div>

            {searchError && (
              <div
                role="alert"
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 text-sm text-red-800"
              >
                <span>{searchError}</span>
                <button
                  type="button"
                  onClick={() => void runSearch(activeSearchQuery, activeCategory)}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-red-800 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.04em] text-white hover:bg-red-900 self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              </div>
            )}

            {searchLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="rounded-[22px] border border-safar-border bg-white overflow-hidden"
                  >
                    <div className="aspect-[4/3] w-full animate-pulse bg-safar-sky" />
                    <div className="p-3.5 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-safar-sky animate-pulse" />
                      <div className="h-3 w-1/2 rounded bg-safar-skySoft animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : searchResult && searchResult.photos.length === 0 ? (
              <div className="rounded-[24px] border border-safar-border bg-white p-10 text-center space-y-3">
                <p className="text-base font-semibold text-safar-navy">
                  No verified photographs found for &ldquo;{activeSearchQuery}&rdquo;
                </p>
                <p className="text-sm text-safar-slate">
                  Try searching the main city, region, or landmark name.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {(searchResult?.photos ?? []).map((photo: DestinationPhoto, idx) => (
                  <article
                    key={photo.id}
                    className="group rounded-[22px] border border-safar-border bg-white overflow-hidden flex flex-col justify-between shadow-[0_6px_22px_rgba(15,37,68,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,37,68,0.09)]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setDetailTarget({
                          name: activeSearchQuery,
                          query: activeSearchQuery,
                          category: activeCategory,
                          initialPhotos: searchResult?.photos ?? [],
                          initialIndex: idx,
                        })
                      }
                      className="cursor-pointer block w-full text-left"
                    >
                      <ResponsivePhoto
                        photo={photo}
                        fallbackLabel={photo.title}
                        aspectClassName="aspect-[4/3]"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                      />
                    </button>

                    <div className="p-4 space-y-1.5">
                      <p className="text-xs font-semibold text-safar-navy line-clamp-1">
                        {photo.title}
                      </p>
                      <p className="text-[11px] text-safar-slate line-clamp-1">
                        Photo by{' '}
                        <a
                          href={photo.attribution.photographerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-safar-navy"
                        >
                          {photo.attribution.photographerName}
                        </a>{' '}
                        on{' '}
                        <a
                          href={photo.attribution.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-safar-navy"
                        >
                          {photo.attribution.sourceName}
                        </a>
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* FEATURED DESTINATIONS GRID */
          <>
            {featuredError && (
              <div
                role="alert"
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 text-sm text-red-800"
              >
                <span>{featuredError}</span>
                <button
                  type="button"
                  onClick={() => setFeaturedRetryNonce((n) => n + 1)}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-red-800 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.04em] text-white hover:bg-red-900 self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              </div>
            )}

            {featuredLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="rounded-[22px] border border-safar-border bg-white overflow-hidden"
                  >
                    <div className="aspect-[4/3] w-full animate-pulse bg-safar-sky" />
                    <div className="p-4 space-y-2">
                      <div className="h-4 w-1/2 rounded bg-safar-sky animate-pulse" />
                      <div className="h-3 w-full rounded bg-safar-skySoft animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filteredFeatured.map((card) => (
                  <article
                    key={card.id}
                    className="group rounded-[22px] border border-safar-border bg-white overflow-hidden flex flex-col justify-between shadow-[0_6px_22px_rgba(15,37,68,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,37,68,0.09)]"
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          setDetailTarget({
                            name: `${card.name}, ${card.country}`,
                            query: card.name,
                            subtitle: card.tagline,
                            category: 'all',
                            initialPhotos: card.photo ? [card.photo] : [],
                          })
                        }
                        className="cursor-pointer relative block w-full text-left"
                      >
                        <ResponsivePhoto
                          photo={card.photo}
                          fallbackLabel={`${card.name}, ${card.country}`}
                          aspectClassName="aspect-[4/3]"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                        />
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-safar-navy/85 via-safar-navy/35 to-transparent"
                        />
                        <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-2 text-white">
                          <div>
                            <p className="text-base font-semibold leading-tight">
                              {card.name}
                            </p>
                            <p className="text-xs text-blue-100">
                              {card.region} · {card.country}
                            </p>
                          </div>
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm text-white group-hover:bg-safar-orange group-hover:text-white transition-colors shrink-0">
                            <ArrowUpRight className="w-4 h-4" />
                          </span>
                        </div>
                      </button>

                      <div className="p-4 space-y-2">
                        <p className="text-xs text-safar-slate leading-relaxed line-clamp-2">
                          {card.tagline}
                        </p>
                        {card.photo && (
                          <p className="text-[11px] text-safar-slate/80 line-clamp-1">
                            Photo by{' '}
                            <a
                              href={card.photo.attribution.photographerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:text-safar-navy"
                            >
                              {card.photo.attribution.photographerName}
                            </a>{' '}
                            on{' '}
                            <a
                              href={card.photo.attribution.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:text-safar-navy"
                            >
                              {card.photo.attribution.sourceName}
                            </a>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="px-4 pb-4 pt-2.5 border-t border-safar-border/70 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDetailTarget({
                            name: `${card.name}, ${card.country}`,
                            query: card.name,
                            subtitle: card.tagline,
                            category: 'all',
                            initialPhotos: card.photo ? [card.photo] : [],
                          })
                        }
                        className="cursor-pointer text-xs font-semibold text-safar-navy hover:text-safar-navyHover hover:underline whitespace-nowrap"
                      >
                        View Gallery
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onSelectDestinationForTrip(`${card.name}, ${card.country}`)
                        }
                        className="cursor-pointer inline-flex items-center gap-1 rounded-full bg-safar-orangeSoft px-3 py-1.5 text-xs font-semibold text-safar-orange hover:bg-safar-orange hover:text-white transition-colors whitespace-nowrap"
                      >
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        Plan Trip
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <DestinationDetailModal
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
        onPlanDestination={onSelectDestinationForTrip}
      />
    </section>
  );
}
