import { useEffect, useState } from 'react';
import { CameraOff } from 'lucide-react';
import type { DestinationPhoto } from '@/types/photo';

interface ResponsivePhotoProps {
  photo: DestinationPhoto | null;
  fallbackLabel: string;
  aspectClassName?: string;
  sizes?: string;
  priority?: boolean;
  hoverZoom?: boolean;
  className?: string;
}

export default function ResponsivePhoto({
  photo,
  fallbackLabel,
  aspectClassName = 'aspect-[4/3]',
  sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw',
  priority = false,
  hoverZoom = true,
  className = '',
}: ResponsivePhotoProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [photo?.url, photo?.id]);

  const showFallback = !photo || !photo.url || failed;

  return (
    <div
      className={`relative w-full overflow-hidden bg-safar-skySoft ${aspectClassName} ${className}`}
    >
      {!showFallback && !loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-gradient-to-br from-safar-sky via-safar-skySoft to-safar-skyMid"
        />
      )}

      {showFallback ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center bg-gradient-to-br from-safar-skySoft to-safar-sky">
          <CameraOff className="w-5 h-5 text-safar-slate" aria-hidden="true" />
          <span className="text-xs font-medium text-safar-slate line-clamp-2">
            {fallbackLabel}
          </span>
        </div>
      ) : (
        <img
          src={photo.url}
          srcSet={photo.srcSet || undefined}
          sizes={sizes}
          alt={photo.alt || fallbackLabel}
          width={photo.width || undefined}
          height={photo.height || undefined}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(true);
          }}
          className={`w-full h-full object-cover transition-all duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${hoverZoom ? 'group-hover:scale-[1.03]' : ''}`}
        />
      )}
    </div>
  );
}
