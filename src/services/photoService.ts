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

function buildPhotoFailureDetails(params: {
  endpoint: string;
  status: number;
  code?: string;
  contentType?: string;
  isHtmlProxy?: boolean;
  serverMessage?: string;
  rawSnippet?: string;
  defaultMessage: string;
}): { code: string; message: string } {
  const {
    endpoint,
    status,
    code,
    contentType,
    isHtmlProxy,
    serverMessage,
    rawSnippet,
    defaultMessage,
  } = params;

  const resolvedCode =
    code ||
    (status === 404
      ? 'PHOTO_API_NOT_FOUND'
      : isHtmlProxy || status === 502 || status === 503 || status === 504
        ? 'PHOTO_GATEWAY_UNAVAILABLE'
        : 'PHOTO_API_ERROR');

  console.error('[SAFAR Photos] API error', {
    endpoint,
    status,
    code: resolvedCode,
    contentType: contentType || 'unknown',
    detail: serverMessage || rawSnippet || defaultMessage,
  });

  if (status === 404) {
    return {
      code: resolvedCode,
      message:
        'Destination photography API endpoint is unavailable (HTTP 404). Please ensure backend API routes are deployed and try again.',
    };
  }

  if (isHtmlProxy || status === 502 || status === 503 || status === 504) {
    return {
      code: resolvedCode,
      message:
        'Destination photography service is temporarily unavailable or timed out. Please retry in a moment.',
    };
  }

  if (status === 429) {
    return {
      code: resolvedCode,
      message:
        serverMessage ||
        'Too many destination photo requests right now. Please wait a moment and retry.',
    };
  }

  return {
    code: resolvedCode,
    message: serverMessage || defaultMessage,
  };
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PHOTO_CLIENT_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const endpoint = '/api/photos/search';
  try {
    const searchParams = new URLSearchParams({
      q: query,
      category,
      limit: String(limit),
    });
    if (context) {
      searchParams.set('context', context);
    }

    const response = await fetch(`${endpoint}?${searchParams.toString()}`, {
      method: 'GET',
      signal: controller.signal,
    });

    const { data, isHtmlProxy, contentType, rawSnippet } =
      await parseApiJsonSafely<
        Partial<DestinationPhotoResult> & { error?: string; code?: string }
      >(response);

    if (isHtmlProxy || !response.ok || !data || !Array.isArray(data.photos)) {
      const failure = buildPhotoFailureDetails({
        endpoint,
        status: response.status,
        code: data?.code,
        contentType,
        isHtmlProxy,
        serverMessage: data?.error,
        rawSnippet,
        defaultMessage:
          'Unable to load destination photos right now. Please try again.',
      });
      throw new PhotoClientError(response.status, failure.code, failure.message);
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
    if (timedOut) {
      console.error('[SAFAR Photos] Request timed out', {
        endpoint,
        timeoutMs: PHOTO_CLIENT_TIMEOUT_MS,
      });
      throw new PhotoClientError(
        408,
        'PHOTO_TIMEOUT',
        'Destination photography request timed out. Please retry.',
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    const message =
      error instanceof Error
        ? error.message
        : 'Network error loading destination photographs.';
    console.error('[SAFAR Photos] Network failure', { endpoint, message });
    throw new PhotoClientError(0, 'PHOTO_NETWORK_ERROR', `${message} Please retry.`);
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PHOTO_CLIENT_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const endpoint = '/api/photos/featured';
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
    });

    const { data, isHtmlProxy, contentType, rawSnippet } =
      await parseApiJsonSafely<{
        destinations?: FeaturedDestinationCard[];
        error?: string;
        code?: string;
      }>(response);

    if (
      isHtmlProxy ||
      !response.ok ||
      !data ||
      !Array.isArray(data.destinations)
    ) {
      const failure = buildPhotoFailureDetails({
        endpoint,
        status: response.status,
        code: data?.code,
        contentType,
        isHtmlProxy,
        serverMessage: data?.error,
        rawSnippet,
        defaultMessage:
          'Unable to load featured destinations right now. Please try again.',
      });
      throw new PhotoClientError(response.status, failure.code, failure.message);
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
    if (timedOut) {
      console.error('[SAFAR Photos] Request timed out', {
        endpoint,
        timeoutMs: PHOTO_CLIENT_TIMEOUT_MS,
      });
      throw new PhotoClientError(
        408,
        'PHOTO_TIMEOUT',
        'Featured destinations took too long to respond. Please retry.',
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    const message =
      error instanceof Error
        ? error.message
        : 'Network error loading featured destinations.';
    console.error('[SAFAR Photos] Network failure', { endpoint, message });
    throw new PhotoClientError(0, 'PHOTO_NETWORK_ERROR', `${message} Please retry.`);
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
