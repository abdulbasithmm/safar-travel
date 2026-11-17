import { getPexelsApiKey, getUnsplashAccessKey } from '../config/env.ts';

export type PhotoProviderId = 'unsplash' | 'pexels' | 'wikimedia';
export type PhotoCategory =
  | 'all'
  | 'mountains'
  | 'beaches'
  | 'cities'
  | 'hotels'
  | 'landmarks';

export interface PhotoAttribution {
  photographerName: string;
  photographerUrl: string;
  sourceName: 'Unsplash' | 'Pexels' | 'Wikimedia Commons';
  sourceUrl: string;
  license?: string;
}

export interface DestinationPhoto {
  id: string;
  title: string;
  url: string;
  srcSet: string;
  thumbUrl: string;
  alt: string;
  width: number;
  height: number;
  attribution: PhotoAttribution;
}

export interface DestinationPhotoResult {
  query: string;
  resolvedLocation: string;
  category: PhotoCategory;
  provider: PhotoProviderId;
  photos: DestinationPhoto[];
  totalAvailable: number;
  cached: boolean;
  fallbackUsed: boolean;
}

export interface FeaturedDestinationCard {
  id: string;
  name: string;
  region: string;
  country: string;
  category: Exclude<PhotoCategory, 'all'>;
  tagline: string;
  photo: DestinationPhoto | null;
  galleryCount: number;
  provider: PhotoProviderId | null;
}

export class PhotoServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'PhotoServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const PHOTO_FETCH_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const WIKIMEDIA_USER_AGENT =
  'SafarTravelPlanner/1.0 (https://safar.app; destination-photography)';

interface CacheEntry {
  expiresAt: number;
  result: DestinationPhotoResult;
}

const searchCache = new Map<string, CacheEntry>();
const inflightSearches = new Map<string, Promise<DestinationPhotoResult>>();
const featuredCardsCache = new Map<
  string,
  { expiresAt: number; cards: FeaturedDestinationCard[] }
>();
let inflightFeatured: Promise<FeaturedDestinationCard[]> | null = null;

function pruneCacheIfNeeded(): void {
  const now = Date.now();
  for (const [key, entry] of searchCache.entries()) {
    if (entry.expiresAt <= now) {
      searchCache.delete(key);
    }
  }
  while (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
}

export function normalizePhotoQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validatePhotoQuery(raw: unknown): string {
  const cleaned = normalizePhotoQuery(raw);
  if (cleaned.length < 2) {
    throw new PhotoServiceError(
      400,
      'INVALID_PHOTO_QUERY',
      'Please enter a destination or attraction name (at least 2 characters).',
    );
  }
  if (cleaned.length > 120) {
    throw new PhotoServiceError(
      400,
      'PHOTO_QUERY_TOO_LONG',
      'Destination search query must be 120 characters or fewer.',
    );
  }
  if (/^https?:\/\//i.test(cleaned) || /[{}<>]/.test(cleaned)) {
    throw new PhotoServiceError(
      400,
      'INVALID_PHOTO_QUERY',
      'Please enter a valid destination or landmark name.',
    );
  }
  return cleaned;
}

export function normalizeCategory(raw: unknown): PhotoCategory {
  if (
    raw === 'mountains' ||
    raw === 'beaches' ||
    raw === 'cities' ||
    raw === 'hotels' ||
    raw === 'landmarks'
  ) {
    return raw;
  }
  return 'all';
}

function stripHtmlTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildEffectiveQuery(
  query: string,
  context: string,
  category: PhotoCategory,
): string {
  const parts = [query];
  const lowerQ = query.toLowerCase();
  if (context && !lowerQ.includes(context.toLowerCase())) {
    parts.push(context);
  }
  if (category === 'hotels' && !/hotel|resort|stay|villa/i.test(lowerQ)) {
    parts.push('hotel resort');
  } else if (category === 'beaches' && !/beach|coast|island/i.test(lowerQ)) {
    parts.push('beach coast');
  } else if (category === 'mountains' && !/mountain|hill|peak|valley/i.test(lowerQ)) {
    parts.push('mountains landscape');
  } else if (category === 'landmarks' && !/landmark|monument|temple|palace/i.test(lowerQ)) {
    parts.push('landmark');
  }
  return parts.join(' ').trim();
}

function buildWikimediaSizedThumb(
  thumbUrl: string,
  originalUrl: string,
  naturalWidth: number,
  targetWidth: number,
): string {
  if (naturalWidth > 0 && targetWidth >= naturalWidth) {
    return originalUrl || thumbUrl;
  }
  const candidate = thumbUrl || originalUrl;
  if (!candidate) return '';
  const httpsUrl = candidate.startsWith('//') ? `https:${candidate}` : candidate;
  if (/\/(\d+)px-([^/?#]+)/.test(httpsUrl)) {
    return httpsUrl.replace(/\/(\d+)px-([^/?#]+)/, `/${targetWidth}px-$2`);
  }
  return httpsUrl;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; data: T | null; retryAfter?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    const retryHeader = response.headers.get('retry-after');
    const retryAfter = retryHeader ? Number(retryHeader) || undefined : undefined;

    if (!response.ok) {
      return { status: response.status, data: null, retryAfter };
    }

    const data = (await response.json()) as T;
    return { status: response.status, data, retryAfter };
  } finally {
    clearTimeout(timer);
  }
}

interface UnsplashSearchResponse {
  total: number;
  results: Array<{
    id: string;
    width: number;
    height: number;
    alt_description: string | null;
    description: string | null;
    urls: {
      raw: string;
      regular: string;
      small: string;
    };
    links: {
      html: string;
    };
    user: {
      name: string;
      links: {
        html: string;
      };
    };
  }>;
}

const UNSPLASH_UTM_SOURCE = 'safar';
const UNSPLASH_UTM_MEDIUM = 'referral';

function buildUnsplashReferralUrl(rawUrl?: string): string {
  const candidate = rawUrl?.trim() || 'https://unsplash.com';
  try {
    const parsed = new URL(candidate);
    parsed.searchParams.set('utm_source', UNSPLASH_UTM_SOURCE);
    parsed.searchParams.set('utm_medium', UNSPLASH_UTM_MEDIUM);
    return parsed.toString();
  } catch {
    const sep = candidate.includes('?') ? '&' : '?';
    return `${candidate}${sep}utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=${UNSPLASH_UTM_MEDIUM}`;
  }
}

async function fetchFromUnsplash(
  effectiveQuery: string,
  displayQuery: string,
  category: PhotoCategory,
  limit: number,
  accessKey: string,
): Promise<DestinationPhotoResult | null> {
  const url =
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(effectiveQuery)}` +
    `&per_page=${limit}&orientation=landscape&content_filter=high`;

  const { status, data, retryAfter } = await fetchJsonWithTimeout<UnsplashSearchResponse>(
    url,
    {
      Authorization: `Client-ID ${accessKey}`,
      'Accept-Version': 'v1',
    },
  );

  if (status === 429) {
    console.warn('[PhotoProvider:unsplash] Rate limited by Unsplash API');
    throw new PhotoServiceError(
      429,
      'PHOTO_RATE_LIMITED',
      'Destination photography rate limit reached. Falling back or retry shortly.',
      retryAfter ?? 30,
    );
  }

  if (status !== 200 || !data || !Array.isArray(data.results)) {
    console.warn('[PhotoProvider:unsplash] Non-200 response', { status });
    return null;
  }

  const photos: DestinationPhoto[] = data.results
    .filter((item) => item.urls?.raw && item.width >= 400 && item.height >= 250)
    .slice(0, limit)
    .map((item) => {
      const base = item.urls.raw;
      const sep = base.includes('?') ? '&' : '?';
      const w480 = `${base}${sep}auto=format&fit=crop&w=480&q=75`;
      const w900 = `${base}${sep}auto=format&fit=crop&w=900&q=80`;
      const w1400 = `${base}${sep}auto=format&fit=crop&w=1400&q=82`;

      const title =
        (item.alt_description || item.description || displayQuery).trim().slice(0, 140);

      return {
        id: `unsplash-${item.id}`,
        title,
        url: w900,
        thumbUrl: w480,
        srcSet: `${w480} 480w, ${w900} 900w, ${w1400} 1400w`,
        alt: title || `${displayQuery} travel photograph`,
        width: item.width,
        height: item.height,
        attribution: {
          photographerName: item.user?.name || 'Unsplash Contributor',
          photographerUrl: buildUnsplashReferralUrl(item.user?.links?.html),
          sourceName: 'Unsplash',
          sourceUrl: buildUnsplashReferralUrl(item.links?.html),
        },
      };
    });

  if (photos.length === 0) return null;

  return {
    query: displayQuery,
    resolvedLocation: displayQuery,
    category,
    provider: 'unsplash',
    photos,
    totalAvailable: data.total || photos.length,
    cached: false,
    fallbackUsed: false,
  };
}

interface PexelsSearchResponse {
  total_results: number;
  photos: Array<{
    id: number;
    width: number;
    height: number;
    url: string;
    photographer: string;
    photographer_url: string;
    alt: string;
    src: {
      original: string;
      large2x: string;
      large: string;
      medium: string;
      landscape: string;
    };
  }>;
}

async function fetchFromPexels(
  effectiveQuery: string,
  displayQuery: string,
  category: PhotoCategory,
  limit: number,
  apiKey: string,
): Promise<DestinationPhotoResult | null> {
  const url =
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(effectiveQuery)}` +
    `&per_page=${limit}&orientation=landscape`;

  const { status, data, retryAfter } = await fetchJsonWithTimeout<PexelsSearchResponse>(
    url,
    {
      Authorization: apiKey,
    },
  );

  if (status === 429) {
    console.warn('[PhotoProvider:pexels] Rate limited by Pexels API');
    throw new PhotoServiceError(
      429,
      'PHOTO_RATE_LIMITED',
      'Destination photography rate limit reached.',
      retryAfter ?? 30,
    );
  }

  if (status !== 200 || !data || !Array.isArray(data.photos)) {
    console.warn('[PhotoProvider:pexels] Non-200 response', { status });
    return null;
  }

  const photos: DestinationPhoto[] = data.photos
    .filter((item) => item.src?.large && item.width >= 400 && item.height >= 250)
    .slice(0, limit)
    .map((item) => {
      const w480 = item.src.medium || item.src.large;
      const w940 = item.src.large || item.src.landscape;
      const w1400 = item.src.large2x || item.src.large;
      const title = (item.alt || displayQuery).trim().slice(0, 140);

      return {
        id: `pexels-${item.id}`,
        title,
        url: w940,
        thumbUrl: w480,
        srcSet: `${w480} 480w, ${w940} 940w, ${w1400} 1400w`,
        alt: title || `${displayQuery} travel photograph`,
        width: item.width,
        height: item.height,
        attribution: {
          photographerName: item.photographer || 'Pexels Contributor',
          photographerUrl: item.photographer_url || 'https://www.pexels.com',
          sourceName: 'Pexels',
          sourceUrl: item.url || 'https://www.pexels.com',
        },
      };
    });

  if (photos.length === 0) return null;

  return {
    query: displayQuery,
    resolvedLocation: displayQuery,
    category,
    provider: 'pexels',
    photos,
    totalAvailable: data.total_results || photos.length,
    cached: false,
    fallbackUsed: false,
  };
}

interface WikiSearchResponse {
  query?: {
    search?: Array<{
      title: string;
      snippet?: string;
    }>;
  };
}

interface WikiMediaListResponse {
  items?: Array<{
    type?: string;
    title?: string;
    caption?: { text?: string };
  }>;
}

interface CommonsPageInfo {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: {
      Artist?: { value?: string };
      LicenseShortName?: { value?: string };
      ImageDescription?: { value?: string };
    };
  }>;
}

interface CommonsImageInfoResponse {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    pages?: Record<string, CommonsPageInfo>;
  };
}

const NON_PHOTO_TITLE_PATTERN =
  /(\.svg$|\.png$|\.pdf$|\.djvu$|\.gif$|\.tiff?$|map|plan_de_|locator|location_in|blank|flag|seal|coat_of_arms|emblem|logo|diagram|chart|graph|stamp|daguerre|symbol|icon|signature|passport|crest|arms_of|relief_location|administrative_divisions|districts_of|sketch|engraving|lithograph|woodcut|postcard|currency|banknote|coin|navigo|ticket|prise_de_la_bastille|palais_de_la_cite|limbourg|banner|monument_in_|1906_|memorial|portrait)/i;

function pickBestWikiArticleTitle(
  results: Array<{ title: string; snippet?: string }>,
  query: string,
): string | null {
  if (results.length === 0) return null;
  const qLower = query.toLowerCase();

  for (const r of results) {
    const t = r.title;
    const tLower = t.toLowerCase();
    if (
      /\((disambiguation|surname|given name|film|movie|song|album|novel|band|tv series)\)/i.test(
        t,
      )
    ) {
      continue;
    }
    if (tLower === qLower || tLower.startsWith(`${qLower},`) || tLower.startsWith(`${qLower} `)) {
      return t;
    }
  }

  for (const r of results) {
    if (
      !/\((disambiguation|surname|given name|film|movie|song|album|novel)\)/i.test(
        r.title,
      )
    ) {
      return r.title;
    }
  }

  return results[0].title;
}

function buildCommonsPhotoObject(
  page: CommonsPageInfo,
  displayQuery: string,
): DestinationPhoto | null {
  const title = page.title || '';
  const info = page.imageinfo?.[0];
  if (!info) return null;
  if (NON_PHOTO_TITLE_PATTERN.test(title)) return null;

  const mime = (info.mime || '').toLowerCase();
  if (mime !== 'image/jpeg' && mime !== 'image/webp') {
    return null;
  }

  const width = Number(info.width) || 0;
  const height = Number(info.height) || 0;
  if (width < 700 || height < 400) return null;

  const ratio = width / height;
  if (ratio < 0.8 || ratio > 2.6) return null;

  const thumb = info.thumburl || '';
  const original = info.url || thumb;
  if (!thumb && !original) return null;

  // Use only standard Wikimedia thumbnail step widths (500, 960, 1280) never exceeding naturalWidth
  const w500 = buildWikimediaSizedThumb(thumb, original, width, 500);
  const w960 = buildWikimediaSizedThumb(thumb, original, width, 960);
  const srcSetParts = [`${w500} 500w`];
  if (width >= 960) {
    srcSetParts.push(`${w960} 960w`);
  }
  if (width >= 1280) {
    const w1280 = buildWikimediaSizedThumb(thumb, original, width, 1280);
    srcSetParts.push(`${w1280} 1280w`);
  }

  const rawArtist = info.extmetadata?.Artist?.value || '';
  const artist = stripHtmlTags(rawArtist).slice(0, 80) || 'Wikimedia Commons contributor';
  const license = stripHtmlTags(info.extmetadata?.LicenseShortName?.value || '');
  const desc = stripHtmlTags(info.extmetadata?.ImageDescription?.value || '');
  const cleanFileName = title
    .replace(/^File:/i, '')
    .replace(/\.(jpe?g|png|webp)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  const photoTitle = (desc || cleanFileName || displayQuery).slice(0, 120);

  return {
    id: `wikimedia-${page.pageid ?? cleanFileName.slice(0, 24)}`,
    title: cleanFileName || displayQuery,
    url: w960,
    thumbUrl: w500,
    srcSet: srcSetParts.join(', '),
    alt: `${displayQuery}: ${photoTitle}`,
    width,
    height,
    attribution: {
      photographerName: artist,
      photographerUrl: info.descriptionurl || 'https://commons.wikimedia.org',
      sourceName: 'Wikimedia Commons',
      sourceUrl: info.descriptionurl || 'https://commons.wikimedia.org',
      ...(license ? { license } : {}),
    },
  };
}

async function fetchCommonsImageMetadata(
  fileTitles: string[],
  displayQuery: string,
  limit: number,
): Promise<DestinationPhoto[]> {
  if (fileTitles.length === 0) return [];

  const uniqueTitles = Array.from(new Set(fileTitles)).slice(0, 24);
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query` +
    `&titles=${encodeURIComponent(uniqueTitles.join('|'))}` +
    `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=960&format=json&origin=*`;

  const { status, data } = await fetchJsonWithTimeout<CommonsImageInfoResponse>(url, {
    'User-Agent': WIKIMEDIA_USER_AGENT,
  });

  if (status !== 200 || !data?.query?.pages) {
    return [];
  }

  // Reconstruct relevance order matching uniqueTitles (API returns pages keyed by numeric pageid)
  const normalizedFromTo = new Map<string, string>();
  for (const n of data.query.normalized || []) {
    normalizedFromTo.set(n.from, n.to);
  }

  const pageByTitle = new Map<string, CommonsPageInfo>();
  for (const page of Object.values(data.query.pages)) {
    if (page.title) {
      pageByTitle.set(page.title, page);
    }
  }

  const photos: DestinationPhoto[] = [];
  const seenIds = new Set<string>();

  for (const requestedTitle of uniqueTitles) {
    const canonical = normalizedFromTo.get(requestedTitle) || requestedTitle.replace(/_/g, ' ');
    const page = pageByTitle.get(canonical) || pageByTitle.get(requestedTitle);
    if (!page) continue;

    const photo = buildCommonsPhotoObject(page, displayQuery);
    if (photo && !seenIds.has(photo.id)) {
      photos.push(photo);
      seenIds.add(photo.id);
    }
    if (photos.length >= limit) break;
  }

  return photos;
}

async function collectArticleMediaTitles(
  wikiOrigin: string,
  queries: string[],
  maxTitles: number,
): Promise<{ resolvedTitle: string | null; titles: string[] }> {
  let resolvedTitle: string | null = null;
  const titles: string[] = [];

  for (const wQuery of queries) {
    if (titles.length >= maxTitles) break;
    try {
      const searchUrl =
        `${wikiOrigin}/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(wQuery)}&srlimit=6&format=json&origin=*`;
      const searchResp = await fetchJsonWithTimeout<WikiSearchResponse>(searchUrl, {
        'User-Agent': WIKIMEDIA_USER_AGENT,
      });

      const bestTitle = pickBestWikiArticleTitle(
        searchResp.data?.query?.search || [],
        wQuery,
      );

      if (bestTitle) {
        if (!resolvedTitle) resolvedTitle = bestTitle;
        const mediaUrl = `${wikiOrigin}/api/rest_v1/page/media-list/${encodeURIComponent(bestTitle)}`;
        const mediaResp = await fetchJsonWithTimeout<WikiMediaListResponse>(
          mediaUrl,
          { 'User-Agent': WIKIMEDIA_USER_AGENT },
        );

        for (const item of mediaResp.data?.items || []) {
          if (item.type !== 'image' || !item.title) continue;
          if (NON_PHOTO_TITLE_PATTERN.test(item.title)) continue;
          if (!titles.includes(item.title)) {
            titles.push(item.title);
          }
          if (titles.length >= maxTitles) break;
        }
      }
    } catch (err) {
      console.warn('[PhotoProvider:wiki] Lookup warning:', {
        wikiOrigin,
        query: wQuery,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { resolvedTitle, titles };
}

function scoreScenicTravelPhoto(photo: DestinationPhoto, category: PhotoCategory): number {
  const hay = `${photo.title} ${photo.alt}`.toLowerCase();
  let score = 0;

  // Prefer high-resolution wide landscape photographs for destination cards
  const ratio = photo.height > 0 ? photo.width / photo.height : 1.33;
  if (ratio >= 1.2 && ratio <= 1.9) score += 2;
  if (photo.width >= 1600) score += 1;

  if (
    /(hill|tea|mountain|valley|peak|matterhorn|backwater|houseboat|boat|beach|coast|bay|sunset|seine|eiffel|notre|temple|tanah lot|rice|paddies|palace|cathedral|church|fort|kiyomizu|santorini|caldera|falls|waterfall|park|panorama|view|river|lake|harbour|harbor|skyline)/i.test(
      hay,
    )
  ) {
    score += 5;
  }

  if (
    category === 'hotels' &&
    /(hotel|resort|villa|stay|terrace|pool|caldera)/i.test(hay)
  ) {
    score += 4;
  } else if (
    category === 'beaches' &&
    /(beach|coast|bay|sunset|lagoon|boat|backwater|ocean|sea)/i.test(hay)
  ) {
    score += 4;
  } else if (
    category === 'mountains' &&
    /(mountain|hill|peak|tea|valley|falls|alp|matterhorn)/i.test(hay)
  ) {
    score += 4;
  }

  // Push local dishes, traffic, or station/train plates behind scenic landmarks
  if (/(curry|fish|food|serradura|traffic|station|gare|rer|train|odalan|moto|sidecar)/i.test(hay)) {
    score -= 4;
  }

  return score;
}

async function fetchFromWikimedia(
  displayQuery: string,
  context: string,
  category: PhotoCategory,
  limit: number,
): Promise<DestinationPhotoResult> {
  const searchCandidate =
    context && !displayQuery.toLowerCase().includes(context.toLowerCase())
      ? `${displayQuery} ${context}`
      : displayQuery;

  let resolvedLocation = displayQuery;
  const combinedTitles: string[] = [];

  if (context) {
    // Attraction / specific landmark search: resolve the exact attraction on Wikipedia first
    const wikipedia = await collectArticleMediaTitles(
      'https://en.wikipedia.org',
      [displayQuery, searchCandidate],
      16,
    );
    if (wikipedia.resolvedTitle) {
      resolvedLocation = wikipedia.resolvedTitle;
    }
    combinedTitles.push(...wikipedia.titles);

    if (combinedTitles.length < limit) {
      const wikivoyage = await collectArticleMediaTitles(
        'https://en.wikivoyage.org',
        [displayQuery],
        10,
      );
      for (const title of wikivoyage.titles) {
        if (!combinedTitles.includes(title)) {
          combinedTitles.push(title);
        }
      }
    }
  } else {
    // City / region / destination search: Wikivoyage travel guides first, then Wikipedia
    const wikivoyage = await collectArticleMediaTitles(
      'https://en.wikivoyage.org',
      [displayQuery],
      20,
    );
    if (wikivoyage.resolvedTitle) {
      resolvedLocation = wikivoyage.resolvedTitle;
    }
    combinedTitles.push(...wikivoyage.titles);

    if (combinedTitles.length < limit + 6) {
      const wikipediaQueries =
        category === 'all'
          ? [displayQuery]
          : [displayQuery, buildEffectiveQuery(displayQuery, '', category)];
      const wikipedia = await collectArticleMediaTitles(
        'https://en.wikipedia.org',
        wikipediaQueries,
        16,
      );
      if (!wikivoyage.resolvedTitle && wikipedia.resolvedTitle) {
        resolvedLocation = wikipedia.resolvedTitle;
      }
      for (const title of wikipedia.titles) {
        if (!combinedTitles.includes(title)) {
          combinedTitles.push(title);
        }
      }
    }
  }

  const candidateLimit = Math.min(Math.max(limit * 2, 10), 18);
  const candidatePhotos = await fetchCommonsImageMetadata(
    combinedTitles,
    displayQuery,
    candidateLimit,
  );

  // 3. Supplement via Wikimedia Commons photographic bitmap search preserving search relevance
  if (candidatePhotos.length < limit) {
    const commonsQuery = buildEffectiveQuery(displayQuery, context, category);
    try {
      const commonsSearchUrl =
        `https://commons.wikimedia.org/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(`${commonsQuery} filetype:bitmap`)}` +
        `&srnamespace=6&srlimit=16&format=json&origin=*`;

      const commonsResp = await fetchJsonWithTimeout<WikiSearchResponse>(
        commonsSearchUrl,
        { 'User-Agent': WIKIMEDIA_USER_AGENT },
      );

      const extraTitles: string[] = [];
      for (const hit of commonsResp.data?.query?.search || []) {
        if (hit.title && !NON_PHOTO_TITLE_PATTERN.test(hit.title)) {
          extraTitles.push(hit.title);
        }
      }

      if (extraTitles.length > 0) {
        const extraPhotos = await fetchCommonsImageMetadata(
          extraTitles,
          displayQuery,
          limit,
        );
        const existingIds = new Set(candidatePhotos.map((p) => p.id));
        for (const p of extraPhotos) {
          if (!existingIds.has(p.id)) {
            candidatePhotos.push(p);
            existingIds.add(p.id);
          }
          if (candidatePhotos.length >= candidateLimit) break;
        }
      }
    } catch (err) {
      console.warn('[PhotoProvider:commons] Search warning:', {
        query: commonsQuery,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const rankedPhotos = [...candidatePhotos].sort(
    (a, b) => scoreScenicTravelPhoto(b, category) - scoreScenicTravelPhoto(a, category),
  );

  return {
    query: displayQuery,
    resolvedLocation,
    category,
    provider: 'wikimedia',
    photos: rankedPhotos.slice(0, limit),
    totalAvailable: rankedPhotos.length,
    cached: false,
    fallbackUsed: true,
  };
}

export async function searchDestinationPhotography(params: {
  query: string;
  context?: string;
  category?: PhotoCategory;
  limit?: number;
}): Promise<DestinationPhotoResult> {
  const query = validatePhotoQuery(params.query);
  const context = normalizePhotoQuery(params.context || '').slice(0, 120);
  const category = normalizeCategory(params.category);
  const limit = Math.min(Math.max(Math.round(params.limit ?? 6), 1), 12);

  const unsplashKey = getUnsplashAccessKey();
  const pexelsKey = getPexelsApiKey();
  const keySig = `${unsplashKey ? 'u' : ''}${pexelsKey ? 'p' : ''}w`;
  const baseCacheKey = `${keySig}::${category}::${query.toLowerCase()}::${context.toLowerCase()}`;

  const existing = searchCache.get(baseCacheKey);
  if (
    existing &&
    existing.expiresAt > Date.now() &&
    existing.result.photos.length >= Math.min(limit, existing.result.totalAvailable || limit)
  ) {
    return {
      ...existing.result,
      photos: existing.result.photos.slice(0, limit),
      cached: true,
    };
  }

  const inflight = inflightSearches.get(baseCacheKey);
  if (inflight) {
    const shared = await inflight;
    return {
      ...shared,
      photos: shared.photos.slice(0, limit),
    };
  }

  const fetchLimit = Math.max(limit, 8);
  const effectiveQuery = buildEffectiveQuery(query, context, category);

  const task = (async (): Promise<DestinationPhotoResult> => {
    let rateLimitedError: PhotoServiceError | null = null;

    // 1. Primary provider: Unsplash API (active whenever UNSPLASH_ACCESS_KEY is configured)
    if (unsplashKey) {
      try {
        const result = await fetchFromUnsplash(
          effectiveQuery,
          query,
          category,
          fetchLimit,
          unsplashKey,
        );
        if (result && result.photos.length > 0) {
          pruneCacheIfNeeded();
          searchCache.set(baseCacheKey, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            result,
          });
          return result;
        }
      } catch (err) {
        if (err instanceof PhotoServiceError && err.statusCode === 429) {
          rateLimitedError = err;
        } else {
          console.warn('[PhotoProvider:unsplash] Falling back after error:', {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 2. Optional secondary provider: Pexels API (skipped gracefully when PEXELS_API_KEY is unset)
    if (pexelsKey) {
      try {
        const result = await fetchFromPexels(
          effectiveQuery,
          query,
          category,
          fetchLimit,
          pexelsKey,
        );
        if (result && result.photos.length > 0) {
          const finalResult = {
            ...result,
            fallbackUsed: Boolean(unsplashKey),
          };
          pruneCacheIfNeeded();
          searchCache.set(baseCacheKey, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            result: finalResult,
          });
          return finalResult;
        }
      } catch (err) {
        if (err instanceof PhotoServiceError && err.statusCode === 429) {
          rateLimitedError = err;
        } else {
          console.warn('[PhotoProvider:pexels] Falling back after error:', {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 3. Open fallback: Wikimedia Commons / Wikivoyage curated destination photography
    try {
      const wikiResult = await fetchFromWikimedia(query, context, category, fetchLimit);
      if (wikiResult.photos.length === 0 && rateLimitedError) {
        throw rateLimitedError;
      }

      const finalResult: DestinationPhotoResult = {
        ...wikiResult,
        fallbackUsed: Boolean(unsplashKey || pexelsKey),
      };

      if (finalResult.photos.length > 0) {
        pruneCacheIfNeeded();
        searchCache.set(baseCacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          result: finalResult,
        });
      }

      return finalResult;
    } catch (err) {
      if (err instanceof PhotoServiceError) {
        throw err;
      }
      console.error('[PhotoProvider] All providers failed:', {
        query,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new PhotoServiceError(
        424,
        'PHOTO_PROVIDER_UNAVAILABLE',
        'Unable to fetch destination photography right now. Please try again.',
      );
    }
  })();

  inflightSearches.set(baseCacheKey, task);
  try {
    const resolved = await task;
    return {
      ...resolved,
      photos: resolved.photos.slice(0, limit),
    };
  } finally {
    inflightSearches.delete(baseCacheKey);
  }
}

const CURATED_DESTINATIONS: Array<{
  id: string;
  name: string;
  query: string;
  region: string;
  country: string;
  category: Exclude<PhotoCategory, 'all'>;
  tagline: string;
}> = [
  {
    id: 'munnar',
    name: 'Munnar',
    query: 'Munnar',
    region: 'Kerala',
    country: 'India',
    category: 'mountains',
    tagline: 'Misty tea estates, shola forests & Western Ghats viewpoints',
  },
  {
    id: 'alleppey',
    name: 'Alleppey',
    query: 'Alleppey',
    region: 'Kerala',
    country: 'India',
    category: 'beaches',
    tagline: 'Palm-fringed backwaters, kettuvallam houseboats & coastal lagoons',
  },
  {
    id: 'goa',
    name: 'Goa',
    query: 'Goa',
    region: 'Konkan Coast',
    country: 'India',
    category: 'beaches',
    tagline: 'Golden Arabian Sea beaches, Latin quarters & coastal forts',
  },
  {
    id: 'paris',
    name: 'Paris',
    query: 'Paris',
    region: 'Île-de-France',
    country: 'France',
    category: 'cities',
    tagline: 'River Seine promenades, iconic landmarks & timeless cafés',
  },
  {
    id: 'dubai',
    name: 'Dubai',
    query: 'Dubai',
    region: 'Emirate of Dubai',
    country: 'UAE',
    category: 'cities',
    tagline: 'Futuristic skyline, desert dunes & waterfront promenades',
  },
  {
    id: 'bali',
    name: 'Bali',
    query: 'Bali',
    region: 'Lesser Sunda Islands',
    country: 'Indonesia',
    category: 'beaches',
    tagline: 'Emerald rice terraces, cliffside temples & coral coves',
  },
  {
    id: 'kyoto',
    name: 'Kyoto',
    query: 'Kyoto',
    region: 'Kansai',
    country: 'Japan',
    category: 'landmarks',
    tagline: 'Bamboo groves, historic shrines & tranquil wooden machiya stays',
  },
  {
    id: 'santorini',
    name: 'Santorini',
    query: 'Santorini',
    region: 'Cyclades',
    country: 'Greece',
    category: 'hotels',
    tagline: 'Caldera cliffside stays, whitewashed terraces & Aegean sunsets',
  },
];

export async function getFeaturedDestinationCards(): Promise<FeaturedDestinationCard[]> {
  const keySig = `${getUnsplashAccessKey() ? 'u' : ''}${getPexelsApiKey() ? 'p' : ''}w`;
  const cached = featuredCardsCache.get(keySig);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.cards;
  }

  if (inflightFeatured) {
    return inflightFeatured;
  }

  inflightFeatured = Promise.all(
    CURATED_DESTINATIONS.map(async (item): Promise<FeaturedDestinationCard> => {
      try {
        const res = await searchDestinationPhotography({
          query: item.query,
          category: 'all',
          limit: 8,
        });
        return {
          id: item.id,
          name: item.name,
          region: item.region,
          country: item.country,
          category: item.category,
          tagline: item.tagline,
          photo: res.photos[0] ?? null,
          galleryCount: res.photos.length,
          provider: res.provider,
        };
      } catch (err) {
        console.warn('[PhotoProvider:featured] Item failed:', {
          id: item.id,
          message: err instanceof Error ? err.message : String(err),
        });
        return {
          id: item.id,
          name: item.name,
          region: item.region,
          country: item.country,
          category: item.category,
          tagline: item.tagline,
          photo: null,
          galleryCount: 0,
          provider: null,
        };
      }
    }),
  );

  try {
    const cards = await inflightFeatured;
    if (cards.some((c) => c.photo !== null)) {
      featuredCardsCache.set(keySig, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        cards,
      });
    }
    return cards;
  } finally {
    inflightFeatured = null;
  }
}
