import { useEffect, useRef, useState } from 'react';

const HERO_ARTWORK_SRC = '/assets/aistudio/Dreamy_Global_Travel_Planning_Hero_6b1f1966.png';
const HERO_BALLOON_SRC =
  '/assets/aistudio/vecteezy_a-colorful-hot-air-balloon-flying-over-a-desert_70238708-Photoroom_39346163.png';

interface PatchRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  mode: 'vertical' | 'horizontal' | 'cloud-blend';
  feather?: number;
}

// Exact normalized coordinates (on 1672x941 source artwork) of baked-in mockup UI
// and static sky sprites replaced by live UI and independently animated layers.
// Stops cleanly above Taj Mahal center spire (y=0.6716), Eiffel top (x=0.763, y=0.4867),
// and corner leaves so all landmarks, foliage, clouds, sun, sailboat, and lake stay crisp.
const SKY_CLEANUP_REGIONS: PatchRegion[] = [
  // Baked-in top navbar text & CTA pill
  { x0: 0.114, y0: 0.018, x1: 0.25, y1: 0.098, mode: 'cloud-blend', feather: 10 },
  { x0: 0.378, y0: 0.044, x1: 0.588, y1: 0.092, mode: 'vertical', feather: 10 },
  { x0: 0.695, y0: 0.032, x1: 0.896, y1: 0.108, mode: 'vertical', feather: 8 },

  // Baked-in static hot air balloons (replaced by animated balloon overlays)
  { x0: 0.058, y0: 0.168, x1: 0.156, y1: 0.344, mode: 'vertical', feather: 10 },
  { x0: 0.156, y0: 0.298, x1: 0.2, y1: 0.376, mode: 'vertical', feather: 10 },

  // Baked-in static airplane & contrail (replaced by animated airplane)
  { x0: 0.752, y0: 0.146, x1: 0.914, y1: 0.252, mode: 'cloud-blend', feather: 10 },
  { x0: 0.495, y0: 0.214, x1: 0.77, y1: 0.278, mode: 'vertical', feather: 10 },

  // Baked-in static sky birds (replaced by animated bird flocks)
  { x0: 0.244, y0: 0.186, x1: 0.288, y1: 0.224, mode: 'cloud-blend', feather: 8 },
  { x0: 0.074, y0: 0.354, x1: 0.256, y1: 0.498, mode: 'cloud-blend', feather: 10 },
  { x0: 0.582, y0: 0.162, x1: 0.634, y1: 0.202, mode: 'cloud-blend', feather: 8 },
  { x0: 0.762, y0: 0.378, x1: 0.806, y1: 0.414, mode: 'cloud-blend', feather: 8 },

  // Tight patches strictly enclosing baked-in UI text and frosted card shadows.
  // Card bottom stops at y=0.684, cleanly above Taj Mahal spire tip (y=0.696).
  { x0: 0.270, y0: 0.274, x1: 0.728, y1: 0.356, mode: 'cloud-blend', feather: 14 },
  { x0: 0.322, y0: 0.368, x1: 0.676, y1: 0.470, mode: 'cloud-blend', feather: 14 },
  { x0: 0.281, y0: 0.488, x1: 0.719, y1: 0.681, mode: 'cloud-blend', feather: 6 },
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function applySkyCleanupToCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
): boolean {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return false;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  ctx.drawImage(img, 0, 0, w, h);
  const srcImage = ctx.getImageData(0, 0, w, h);
  const src = srcImage.data;
  const out = new Uint8ClampedArray(src);

  // Full-resolution alpha mask: 1.0 strictly across every dirty pixel,
  // smoothly feathering outward (1.0 -> 0.0) into surrounding clean sky.
  const blendAlpha = new Float32Array(w * h);
  const coreMask = new Uint8Array(w * h);

  for (const region of SKY_CLEANUP_REGIONS) {
    const x0 = Math.max(2, Math.floor(region.x0 * w));
    const y0 = Math.max(2, Math.floor(region.y0 * h));
    const x1 = Math.min(w - 3, Math.ceil(region.x1 * w));
    const y1 = Math.min(h - 3, Math.ceil(region.y1 * h));
    const pad = region.feather ?? 12;

    const ox0 = Math.max(1, x0 - pad);
    const oy0 = Math.max(1, y0 - pad);
    const ox1 = Math.min(w - 2, x1 + pad);
    // Keep bottom of central card region strictly above Taj spire
    const oy1 = Math.min(h - 2, y1 + (region.y1 > 0.67 ? 4 : pad));

    for (let y = oy0; y <= oy1; y += 1) {
      const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      const maxDy = y > y1 && region.y1 > 0.67 ? 4 : pad;
      const fy = dy === 0 ? 1 : 1 - smoothstep(0, maxDy, dy);
      if (fy <= 0) continue;

      const row = y * w;
      for (let x = ox0; x <= ox1; x += 1) {
        const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        const fx = dx === 0 ? 1 : 1 - smoothstep(0, pad, dx);
        const a = Math.min(fx, fy);
        if (a > blendAlpha[row + x]) {
          blendAlpha[row + x] = a;
        }
        if (dx === 0 && dy === 0) {
          coreMask[row + x] = 1;
        }
      }
    }
  }

  // Downsample 2x for fast, smooth 2D Laplace harmonic membrane inpainting
  const sw = Math.ceil(w / 2);
  const sh = Math.ceil(h / 2);
  const sMask = new Uint8Array(sw * sh);
  const gridR = new Float32Array(sw * sh);
  const gridG = new Float32Array(sw * sh);
  const gridB = new Float32Array(sw * sh);

  for (let sy = 0; sy < sh; sy += 1) {
    const y = Math.min(h - 1, sy * 2);
    for (let sx = 0; sx < sw; sx += 1) {
      const x = Math.min(w - 1, sx * 2);
      const sIdx = sy * sw + sx;
      const fIdx = y * w + x;
      const pIdx = fIdx * 4;
      sMask[sIdx] =
        coreMask[fIdx] ||
        coreMask[Math.min(w - 1, x + 1) + y * w] ||
        coreMask[x + Math.min(h - 1, y + 1) * w]
          ? 1
          : 0;
      gridR[sIdx] = src[pIdx];
      gridG[sIdx] = src[pIdx + 1];
      gridB[sIdx] = src[pIdx + 2];
    }
  }

  // Clamp any dark landmark edge (e.g. pagoda finial / distant ridge) just outside
  // the mask from bleeding dark pigment into the harmonic sky fill
  for (let sy = 2; sy < sh - 2; sy += 1) {
    for (let sx = 2; sx < sw - 2; sx += 1) {
      const idx = sy * sw + sx;
      if (sMask[idx]) continue;
      const touchesMask =
        sMask[idx - 1] || sMask[idx + 1] || sMask[idx - sw] || sMask[idx + sw];
      if (!touchesMask) continue;
      const lum = 0.299 * gridR[idx] + 0.587 * gridG[idx] + 0.114 * gridB[idx];
      if (lum < 190) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let cnt = 0;
        for (let dy = -6; dy <= 6; dy += 2) {
          for (let dx = -6; dx <= 6; dx += 2) {
            const ny = sy + dy;
            const nx = sx + dx;
            if (ny < 0 || ny >= sh || nx < 0 || nx >= sw) continue;
            const nIdx = ny * sw + nx;
            if (sMask[nIdx]) continue;
            const nLum = 0.299 * gridR[nIdx] + 0.587 * gridG[nIdx] + 0.114 * gridB[nIdx];
            if (nLum >= 195) {
              sumR += gridR[nIdx];
              sumG += gridG[nIdx];
              sumB += gridB[nIdx];
              cnt += 1;
            }
          }
        }
        if (cnt > 0) {
          gridR[idx] = sumR / cnt;
          gridG[idx] = sumG / cnt;
          gridB[idx] = sumB / cnt;
        }
      }
    }
  }

  // Initialize masked pixels with local clean horizontal blend before SOR relaxation
  for (let sy = 1; sy < sh - 1; sy += 1) {
    let sx = 1;
    while (sx < sw - 1) {
      if (!sMask[sy * sw + sx]) {
        sx += 1;
        continue;
      }
      const start = sx - 1;
      while (sx < sw - 1 && sMask[sy * sw + sx]) sx += 1;
      const end = sx;
      const lIdx = sy * sw + start;
      const rIdx = sy * sw + end;
      const span = Math.max(1, end - start);
      for (let x = start + 1; x < end; x += 1) {
        const t = (x - start) / span;
        const idx = sy * sw + x;
        gridR[idx] = gridR[lIdx] * (1 - t) + gridR[rIdx] * t;
        gridG[idx] = gridG[lIdx] * (1 - t) + gridG[rIdx] * t;
        gridB[idx] = gridB[lIdx] * (1 - t) + gridB[rIdx] * t;
      }
    }
  }

  // Collect masked pixel indices once for tight SOR Laplace relaxation (~12ms)
  const maskedIndices: number[] = [];
  for (let sy = 1; sy < sh - 1; sy += 1) {
    const row = sy * sw;
    for (let sx = 1; sx < sw - 1; sx += 1) {
      if (sMask[row + sx]) maskedIndices.push(row + sx);
    }
  }

  const omega = 1.72;
  for (let iter = 0; iter < 140; iter += 1) {
    for (let i = 0; i < maskedIndices.length; i += 1) {
      const idx = maskedIndices[i];
      const avgR = 0.25 * (gridR[idx - 1] + gridR[idx + 1] + gridR[idx - sw] + gridR[idx + sw]);
      const avgG = 0.25 * (gridG[idx - 1] + gridG[idx + 1] + gridG[idx - sw] + gridG[idx + sw]);
      const avgB = 0.25 * (gridB[idx - 1] + gridB[idx + 1] + gridB[idx - sw] + gridB[idx + sw]);
      gridR[idx] += omega * (avgR - gridR[idx]);
      gridG[idx] += omega * (avgG - gridG[idx]);
      gridB[idx] += omega * (avgB - gridB[idx]);
    }
  }

  // Bilinearly upsample solved harmonic sky + subtle anti-banding dither onto out
  for (let y = 0; y < h; y += 1) {
    const syf = Math.min(sh - 1.001, y * 0.5);
    const sy0 = Math.floor(syf);
    const wy = syf - sy0;
    const row = y * w;

    for (let x = 0; x < w; x += 1) {
      const alpha = blendAlpha[row + x];
      if (alpha <= 0) continue;

      const sxf = Math.min(sw - 1.001, x * 0.5);
      const sx0 = Math.floor(sxf);
      const wx = sxf - sx0;

      const i00 = sy0 * sw + sx0;
      const i10 = i00 + 1;
      const i01 = i00 + sw;
      const i11 = i01 + 1;

      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;

      // Deterministic lightweight sky micro-grain to eliminate flat banding
      const hash = ((x * 73856093) ^ (y * 19349663)) & 255;
      const grain = (hash / 255 - 0.5) * 1.4;

      const fillR = gridR[i00] * w00 + gridR[i10] * w10 + gridR[i01] * w01 + gridR[i11] * w11 + grain;
      const fillG = gridG[i00] * w00 + gridG[i10] * w10 + gridG[i01] * w01 + gridG[i11] * w11 + grain;
      const fillB = gridB[i00] * w00 + gridB[i10] * w10 + gridB[i01] * w01 + gridB[i11] * w11 + grain;

      const pIdx = (row + x) * 4;
      out[pIdx] = Math.max(0, Math.min(255, Math.round(out[pIdx] * (1 - alpha) + fillR * alpha)));
      out[pIdx + 1] = Math.max(0, Math.min(255, Math.round(out[pIdx + 1] * (1 - alpha) + fillG * alpha)));
      out[pIdx + 2] = Math.max(0, Math.min(255, Math.round(out[pIdx + 2] * (1 - alpha) + fillB * alpha)));
    }
  }

  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  return true;
}

export default function SafarHeroBackground() {
  const cleanCanvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = HERO_ARTWORK_SRC;
    img.onload = () => {
      if (cancelled || !cleanCanvasRef.current) return;
      const ok = applySkyCleanupToCanvas(cleanCanvasRef.current, img);
      if (ok) {
        setCanvasReady(true);
      }
    };
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="safar-hero-backdrop pointer-events-none select-none absolute inset-0 z-0 overflow-hidden bg-[#dcebf7]"
    >
      {/* 1. Aspect-Locked Scene Frame matching the exact 1672x941 illustration */}
      <div className="safar-scene-frame">
        {/* Base Artwork Layer with Subtle Background Parallax Drift */}
        <div className="safar-hero-anim safar-artwork-parallax absolute inset-0">
          <img
            src={HERO_ARTWORK_SRC}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <canvas
            ref={cleanCanvasRef}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              canvasReady ? 'opacity-100' : 'opacity-0'
            }`}
          />

          {/* 5. Sun: Atmospheric Glow & Gentle Sunlight Animation locked to the artwork sun (86.8%, 41.4%) */}
          <div
            className="safar-hero-anim safar-sun-aura absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: '86.8%',
              top: '41.4%',
              width: '21%',
              aspectRatio: '1 / 1',
              background:
                'radial-gradient(circle, rgba(255,244,210,0.72) 0%, rgba(254,226,166,0.38) 38%, rgba(254,214,158,0.12) 66%, rgba(254,214,158,0) 100%)',
            }}
          />
          <div
            className="safar-hero-anim safar-sun-rays absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: '86.8%',
              top: '41.4%',
              width: '32%',
              aspectRatio: '1 / 1',
              background:
                'radial-gradient(circle, rgba(255,235,190,0.28) 0%, rgba(255,220,168,0.08) 55%, rgba(255,220,168,0) 100%)',
            }}
          />

          {/* 6. Water: Subtle Animated Reflection Shimmer over the Lake (y = 82.5% to 100%) */}
          <div
            className="absolute inset-x-0 bottom-0 overflow-hidden"
            style={{ top: '82.5%' }}
          >
            <svg
              viewBox="0 0 1672 165"
              preserveAspectRatio="none"
              className="h-full w-full"
            >
              <g className="safar-hero-anim safar-water-shimmer-a">
                <rect x="190" y="24" width="140" height="2.4" rx="1.2" fill="#fff7e8" opacity="0.52" />
                <rect x="440" y="54" width="175" height="2.2" rx="1.1" fill="#ffffff" opacity="0.45" />
                <rect x="755" y="34" width="190" height="2.5" rx="1.25" fill="#ffe7c7" opacity="0.58" />
                <rect x="1095" y="42" width="135" height="2.2" rx="1.1" fill="#fff5df" opacity="0.48" />
                <rect x="1340" y="64" width="150" height="2" rx="1" fill="#ffffff" opacity="0.42" />
              </g>
              <g className="safar-hero-anim safar-water-shimmer-b">
                <rect x="260" y="72" width="120" height="2" rx="1" fill="#ffffff" opacity="0.4" />
                <rect x="615" y="88" width="160" height="2.2" rx="1.1" fill="#ffe9cc" opacity="0.46" />
                <rect x="815" y="64" width="155" height="2" rx="1" fill="#fff8eb" opacity="0.5" />
                <rect x="1115" y="96" width="125" height="2" rx="1" fill="#ffffff" opacity="0.4" />
                <rect x="1420" y="32" width="110" height="2" rx="1" fill="#ffe6c4" opacity="0.42" />
              </g>
            </svg>
          </div>
        </div>
      </div>

      {/* 4. Clouds: Slow Horizontal Cloud Movement across Sky */}
      <div className="safar-hero-anim safar-cloud-drift-slow absolute inset-x-0 top-[8%] h-44 opacity-55">
        <svg viewBox="0 0 1440 176" className="h-full w-[125%] max-w-none -ml-[12%]">
          <g fill="#fff8ef" fillOpacity="0.68">
            <path d="M130 98 C130 82 146 70 165 73 C176 54 203 50 223 63 C239 58 259 67 262 83 C276 85 286 96 284 108 L130 108 Z" />
            <path d="M620 74 C620 59 635 49 652 51 C663 35 688 31 706 43 C721 38 738 47 741 61 C754 63 762 72 760 82 L620 82 Z" />
            <path d="M1070 108 C1070 89 1090 77 1112 80 C1126 58 1158 53 1182 68 C1200 62 1223 72 1227 90 C1244 93 1255 104 1252 118 L1070 118 Z" />
          </g>
        </svg>
      </div>

      <div className="safar-hero-anim safar-cloud-drift-mid absolute inset-x-0 top-[21%] h-40 opacity-45">
        <svg viewBox="0 0 1440 160" className="h-full w-[130%] max-w-none -ml-[15%]">
          <g fill="#ffffff" fillOpacity="0.62">
            <path d="M310 102 C310 86 327 76 346 79 C358 62 384 58 403 70 C418 65 436 74 440 89 C454 91 463 101 461 112 L310 112 Z" />
            <path d="M895 82 C895 68 910 58 928 61 C939 45 963 41 981 53 C995 49 1011 57 1014 70 C1027 72 1035 81 1033 92 L895 92 Z" />
          </g>
        </svg>
      </div>

      {/* 2. Hot Air Balloons: Independent Floating with Distinct Speeds & Directions */}
      {/* Large foreground real hot air balloon PNG cutout (37.5% opaque width inside 2400x1345 canvas) */}
      <div className="safar-hero-anim safar-balloon-primary absolute left-[0.4%] max-md:left-[-2%] top-[16.5%] max-md:top-[7.5%] w-[340px] max-lg:w-[260px] max-md:w-[152px]">
        <img
          src={HERO_BALLOON_SRC}
          alt=""
          draggable={false}
          className="h-auto w-full drop-shadow-[0_10px_18px_rgba(74,98,125,0.18)]"
        />
      </div>

      {/* Smaller distant hot air balloon with different speed & opposite phase */}
      <div className="safar-hero-anim safar-balloon-secondary absolute left-[13.4%] max-md:left-[14%] top-[29.8%] max-md:top-[13%] w-[132px] max-lg:w-[106px] max-md:w-[74px] opacity-85">
        <img
          src={HERO_BALLOON_SRC}
          alt=""
          draggable={false}
          className="h-auto w-full brightness-[1.03] drop-shadow-[0_6px_12px_rgba(74,98,125,0.14)]"
        />
      </div>

      {/* 1. Airplane: Smooth Movement Across Sky with Vapor Contrail */}
      <div className="safar-hero-anim safar-plane-fly absolute top-[18%] max-md:top-[11%] left-0 w-[180px] max-md:w-[110px]">
        <svg viewBox="0 0 210 62" className="w-full h-auto overflow-visible">
          <defs>
            <linearGradient id="safar-jet-trail" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="65%" stopColor="#ffffff" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.88" />
            </linearGradient>
          </defs>
          <path
            d="M-190 48 L112 31 L112 35 L-190 54 Z"
            fill="url(#safar-jet-trail)"
          />
          <g transform="rotate(-10 148 28)">
            <path d="M132 25 L114 9 L123 9 L146 25 Z" fill="#253b54" opacity="0.82" />
            <path d="M104 26 L94 11 L103 11 L116 26 Z" fill="#1e324a" />
            <path d="M102 27 C124 23 162 22 184 26 C191 27.5 193 29.5 186 31 C166 34 128 33 102 30 Z" fill="#fbfcfd" />
            <path d="M104 28.5 C128 27 160 27 183 28.5 L182 30 C160 31.5 128 31 104 30 Z" fill="#294361" />
            <path d="M174 26 L181 26.8 L179 28.2 L173 27.8 Z" fill="#1e324a" />
            <path d="M136 30 L118 46 L128 46 L154 31 Z" fill="#3a4f67" />
            <ellipse cx="141" cy="37" rx="6" ry="2.6" fill="#1e324a" />
          </g>
        </svg>
      </div>

      {/* 3. Flying Birds: Natural Staggered Flight & Subtle Wing Movement */}
      {/* Flock A: Upper-left / high sky birds */}
      <div className="safar-hero-anim safar-bird-glide-a absolute top-[17%] left-0 w-36 max-md:w-28 opacity-80">
        <svg viewBox="0 0 150 64" className="w-full h-auto">
          <g fill="#5b4d44">
            <path
              className="safar-hero-anim safar-wing-flap"
              style={{ transformOrigin: '28px 24px', animationDelay: '0s' }}
              d="M14 25 Q22 16 28 23 Q34 16 42 25 Q35 20 28 26 Q21 20 14 25 Z"
            />
            <path
              className="safar-hero-anim safar-wing-flap"
              style={{ transformOrigin: '78px 16px', animationDelay: '-0.38s' }}
              d="M66 17 Q72 9 78 15 Q84 9 90 17 Q84 13 78 18 Q72 13 66 17 Z"
            />
            <path
              className="safar-hero-anim safar-wing-flap"
              style={{ transformOrigin: '122px 34px', animationDelay: '-0.72s' }}
              d="M112 35 Q117 29 122 33 Q127 29 132 35 Q127 32 122 36 Q117 32 112 35 Z"
            />
          </g>
        </svg>
      </div>

      {/* Flock B: Mid-sky coastal flock gliding right-to-left */}
      <div className="safar-hero-anim safar-bird-glide-b absolute top-[39%] right-0 w-44 max-md:w-32 opacity-75">
        <svg viewBox="0 0 180 72" className="w-full h-auto">
          <g fill="#5e4f46">
            <path
              className="safar-hero-anim safar-wing-flap-slow"
              style={{ transformOrigin: '34px 26px', animationDelay: '-0.15s' }}
              d="M18 28 Q26 17 34 25 Q42 17 50 28 Q42 22 34 29 Q26 22 18 28 Z"
            />
            <path
              className="safar-hero-anim safar-wing-flap-slow"
              style={{ transformOrigin: '92px 42px', animationDelay: '-0.6s' }}
              d="M80 43 Q86 35 92 41 Q98 35 104 43 Q98 39 92 44 Q86 39 80 43 Z"
            />
            <path
              className="safar-hero-anim safar-wing-flap"
              style={{ transformOrigin: '144px 24px', animationDelay: '-0.95s' }}
              d="M135 25 Q140 19 144 23 Q148 19 153 25 Q148 22 144 26 Q140 22 135 25 Z"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
