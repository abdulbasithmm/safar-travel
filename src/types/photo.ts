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
