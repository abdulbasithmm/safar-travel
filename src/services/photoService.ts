import { parseApiJsonSafely } from '@/services/aiService';
import type {
  DestinationPhotoResult,
  FeaturedDestinationCard,
  PhotoCategory,
} from '@/types/photo';

const PHOTO_CLIENT_TIMEOUT_MS = 16_000;
const CLIENT_CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedSearchEntry {
  expiresAt: number;
  data: DestinationPhotoResult;
}

const clientPhotoCache = new Map<string, CachedSearchEntry>();
let featuredCache: { expiresAt: number; data: FeaturedDestinationCard[] } | null =
  null;

export class PhotoClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PhotoClientError';
    this.status = status;
    this.code = code;
  }
}

export async function searchDestinationPhotos(
  params: {
    query: string;
    context?: string;
    category?: PhotoCategory;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<DestinationPhotoResult> {
  const query = params.query.trim();
  const context = (params.context || '').trim();
  const category = params.category || 'all';
  const limit = Math.min(Math.max(Math.round(params.limit ?? 6), 1), 12);

  const cacheKey = `${category}::${limit}::${query.toLowerCase()}::${context.toLowerCase()}`;
  const cached = clientPhotoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHOTO_CLIENT_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const searchParams = new URLSearchParams({
      q: query,
      category,
      limit: String(limit),
    });
    if (context) {
      searchParams.set('context', context);
    }

    const response = await fetch(`/api/photos/search?${searchParams.toString()}`, {
      method: 'GET',
      signal: controller.signal,
    });

    const { data, isHtmlProxy } = await parseApiJsonSafely<
      Partial<DestinationPhotoResult> & { error?: string; code?: string }
    >(response);

    if (isHtmlProxy) {
      throw new PhotoClientError(
        503,
        'PROXY_UNAVAILABLE',
        'Destination photography service is temporarily unavailable. Please retry.',
      );
    }

    if (!response.ok || !data || !Array.isArray(data.photos)) {
      throw new PhotoClientError(
        response.status,
        data?.code || 'PHOTO_SEARCH_FAILED',
        data?.error || 'Unable to load destination photos right now.',
      );
    }

    const result = data as DestinationPhotoResult;
    if (result.photos.length > 0) {
      clientPhotoCache.set(cacheKey, {
        expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        data: result,
      });
    }

    return result;
  } catch (error) {
    if (error instanceof PhotoClientError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new PhotoClientError(
      0,
      'PHOTO_NETWORK_ERROR',
      error instanceof Error
        ? error.message
        : 'Network error loading destination photographs.',
    );
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function fetchFeaturedDestinations(
  signal?: AbortSignal,
): Promise<FeaturedDestinationCard[]> {
  if (featuredCache && featuredCache.expiresAt > Date.now()) {
    return featuredCache.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHOTO_CLIENT_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetch('/api/photos/featured', {
      method: 'GET',
      signal: controller.signal,
    });

    const { data, isHtmlProxy } = await parseApiJsonSafely<{
      destinations?: FeaturedDestinationCard[];
      error?: string;
      code?: string;
    }>(response);

    if (isHtmlProxy) {
      throw new PhotoClientError(
        503,
        'PROXY_UNAVAILABLE',
        'Destination gallery is warming up. Please retry.',
      );
    }

    if (!response.ok || !data || !Array.isArray(data.destinations)) {
      throw new PhotoClientError(
        response.status,
        data?.code || 'FEATURED_PHOTOS_FAILED',
        data?.error || 'Unable to load featured destinations.',
      );
    }

    featuredCache = {
      expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
      data: data.destinations,
    };

    return data.destinations;
  } catch (error) {
    if (error instanceof PhotoClientError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new PhotoClientError(
      0,
      'PHOTO_NETWORK_ERROR',
      error instanceof Error
        ? error.message
        : 'Network error loading featured destinations.',
    );
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
