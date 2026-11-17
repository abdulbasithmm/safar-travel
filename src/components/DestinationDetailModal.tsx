import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  RefreshCw,
  X,
} from 'lucide-react';
import ResponsivePhoto from '@/components/ResponsivePhoto';
import { searchDestinationPhotos } from '@/services/photoService';
import type { DestinationPhoto, PhotoCategory } from '@/types/photo';

export interface DestinationDetailTarget {
  name: string;
  query: string;
  subtitle?: string;
  category?: PhotoCategory;
  initialPhotos?: DestinationPhoto[];
  initialIndex?: number;
}

interface DestinationDetailModalProps {
  target: DestinationDetailTarget | null;
  onClose: () => void;
  onPlanDestination?: (destinationName: string) => void;
}

export default function DestinationDetailModal({
  target,
  onClose,
  onPlanDestination,
}: DestinationDetailModalProps) {
  const [photos, setPhotos] = useState<DestinationPhoto[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resolvedTitle, setResolvedTitle] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const loadGallery = useCallback(
    async (signal: AbortSignal) => {
      if (!target) return;
      setLoading(true);
      setErrorMsg(null);

      try {
        const result = await searchDestinationPhotos(
          {
            query: target.query,
            category: target.category ?? 'all',
            limit: 8,
          },
          signal,
        );

        if (signal.aborted) return;
        if (result.photos.length > 0) {
          setPhotos(result.photos);
          setResolvedTitle(result.resolvedLocation || target.name);
        } else if (target.initialPhotos && target.initialPhotos.length > 0) {
          setPhotos(target.initialPhotos);
        } else {
          setErrorMsg(`No photographs found for "${target.name}".`);
        }
      } catch (err) {
        if (signal.aborted) return;
        if (target.initialPhotos && target.initialPhotos.length > 0) {
          setPhotos(target.initialPhotos);
        } else {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Unable to load destination gallery.',
          );
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    },
    [target],
  );

  useEffect(() => {
    if (!target) return;

    const seeded = target.initialPhotos ?? [];
    setPhotos(seeded);
    setActiveIndex(
      Math.min(
        Math.max(target.initialIndex ?? 0, 0),
        Math.max(seeded.length - 1, 0),
      ),
    );
    setResolvedTitle(target.name);
    setErrorMsg(null);

    if (seeded.length >= 4 && reloadNonce === 0) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadGallery(controller.signal);

    return () => controller.abort();
  }, [target, reloadNonce, loadGallery]);

  useEffect(() => {
    if (!target) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowRight' && photos.length > 1) {
        setActiveIndex((prev) => (prev + 1) % photos.length);
      } else if (event.key === 'ArrowLeft' && photos.length > 1) {
        setActiveIndex((prev) => (prev - 1 + photos.length) % photos.length);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, photos.length, onClose]);

  if (!target) return null;

  const activePhoto = photos[activeIndex] ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${target.name} destination photography`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[980px] max-h-[92vh] overflow-y-auto rounded-[28px] bg-white text-wandor-text border border-black/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-black/10">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-wandor-muted">
              <span className="inline-flex items-center gap-1 font-medium text-wandor-prompt">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {resolvedTitle || target.name}
              </span>
              {photos.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    Photo {activeIndex + 1} of {photos.length}
                  </span>
                </>
              )}
            </div>
            <h3 className="text-xl md:text-2xl font-medium tracking-[-0.02em] text-wandor-text truncate">
              {target.name}
            </h3>
            {target.subtitle && (
              <p className="text-sm text-wandor-muted">{target.subtitle}</p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close destination details"
            className="cursor-pointer shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full border border-black/15 text-wandor-text hover:bg-black/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Gallery Viewer */}
        <div className="p-6 space-y-5">
          {errorMsg && photos.length === 0 ? (
            <div className="rounded-2xl border border-red-200 bg-red-50/70 p-8 text-center space-y-3">
              <p className="text-sm text-red-800">{errorMsg}</p>
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-red-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-white hover:bg-red-900"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden border border-black/10">
              <ResponsivePhoto
                photo={activePhoto}
                fallbackLabel={
                  loading ? `Loading photos for ${target.name}...` : target.name
                }
                aspectClassName="aspect-[16/10]"
                sizes="(max-width: 1024px) 92vw, 900px"
                priority={true}
                hoverZoom={false}
              />

              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous photograph"
                    onClick={() =>
                      setActiveIndex(
                        (prev) => (prev - 1 + photos.length) % photos.length,
                      )
                    }
                    className="cursor-pointer absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-wandor-text border border-black/10 shadow-md flex items-center justify-center hover:bg-white transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next photograph"
                    onClick={() =>
                      setActiveIndex((prev) => (prev + 1) % photos.length)
                    }
                    className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-wandor-text border border-black/10 shadow-md flex items-center justify-center hover:bg-white transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Attribution & Actions Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            {activePhoto ? (
              <div className="text-xs text-wandor-muted space-y-1">
                <p className="font-medium text-wandor-text">
                  {activePhoto.title}
                </p>
                <p className="flex flex-wrap items-center gap-1.5">
                  <span>Photo by</span>
                  <a
                    href={activePhoto.attribution.photographerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-wandor-text"
                  >
                    {activePhoto.attribution.photographerName}
                  </a>
                  <span>on</span>
                  <a
                    href={activePhoto.attribution.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline hover:text-wandor-text"
                  >
                    {activePhoto.attribution.sourceName}
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                  {activePhoto.attribution.license && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{activePhoto.attribution.license}</span>
                    </>
                  )}
                  {activePhoto.width > 0 && activePhoto.height > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {activePhoto.width}×{activePhoto.height}
                      </span>
                    </>
                  )}
                </p>
              </div>
            ) : (
              <span className="text-xs text-wandor-muted">
                {loading ? 'Fetching real destination photography...' : ''}
              </span>
            )}

            {onPlanDestination && (
              <button
                type="button"
                onClick={() => {
                  onPlanDestination(target.name);
                  onClose();
                }}
                className="cursor-pointer shrink-0 max-w-full text-center rounded-full bg-wandor-dark px-5 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333] transition-colors"
              >
                Plan a Trip to {target.name}
              </button>
            )}
          </div>

          {/* Multi-Photo Thumbnail Grid */}
          {photos.length > 1 && (
            <div className="space-y-2 pt-2 border-t border-black/10">
              <p className="text-xs font-medium text-wandor-muted">
                Destination Gallery ({photos.length})
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {photos.map((item, idx) => {
                  const selected = idx === activeIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveIndex(idx)}
                      aria-label={`View photo ${idx + 1}: ${item.title}`}
                      className={`cursor-pointer group rounded-xl overflow-hidden border transition-all ${
                        selected
                          ? 'border-wandor-prompt ring-2 ring-wandor-prompt/30'
                          : 'border-black/10 hover:border-black/30'
                      }`}
                    >
                      <ResponsivePhoto
                        photo={item}
                        fallbackLabel={item.title}
                        aspectClassName="aspect-[4/3]"
                        sizes="160px"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
