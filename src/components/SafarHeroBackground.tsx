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

  // Unified center sky cleanup (headline, subtitle, and baked mockup prompt card)
  // Interpolates smoothly left-to-right across the natural sky horizon and stops above Taj Mahal spire (y=0.672)
  { x0: 0.271, y0: 0.268, x1: 0.728, y1: 0.672, mode: 'horizontal', feather: 3 },
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

  // Mark every pixel inside any cleanup region so edge sampling never pulls
  // uncleaned foreground pixels from an adjacent or overlapping region.
  const masked = new Uint8Array(w * h);
  const boundsList = SKY_CLEANUP_REGIONS.map((region) => {
    const xStart = Math.max(2, Math.floor(region.x0 * w));
    const yStart = Math.max(2, Math.floor(region.y0 * h));
    const xEnd = Math.min(w - 3, Math.ceil(region.x1 * w));
    const yEnd = Math.min(h - 3, Math.ceil(region.y1 * h));
    for (let y = yStart; y <= yEnd; y += 1) {
      const rowOffset = y * w;
      for (let x = xStart; x <= xEnd; x += 1) {
        masked[rowOffset + x] = 1;
      }
    }
    return { region, xStart, yStart, xEnd, yEnd };
  });

  // Sample a small sky-filtered neighborhood strictly outside the masked area
  const sampleUnmaskedBand = (
    cx: number,
    cy: number,
    dirX: number,
    dirY: number,
  ): [number, number, number] => {
    let px = Math.max(0, Math.min(w - 1, cx));
    let py = Math.max(0, Math.min(h - 1, cy));
    const maxSteps = Math.max(w, h);
    for (let step = 0; step < maxSteps; step += 1) {
      if (!masked[py * w + px]) break;
      const nx = px + dirX;
      const ny = py + dirY;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) break;
      px = nx;
      py = ny;
    }

    let rSky = 0;
    let gSky = 0;
    let bSky = 0;
    let skyCount = 0;
    let rAll = 0;
    let gAll = 0;
    let bAll = 0;
    let allCount = 0;

    // Average across a small outer strip; prefer bright sky pixels (>= 198 lum)
    // so nearby landmark finials or corner leaves never bleed into sky regions.
    for (let along = -10; along <= 10; along += 2) {
      for (let depth = 1; depth <= 9; depth += 2) {
        const sx = Math.max(0, Math.min(w - 1, px + dirX * depth + (dirY !== 0 ? along : 0)));
        const sy = Math.max(0, Math.min(h - 1, py + dirY * depth + (dirX !== 0 ? along : 0)));
        if (masked[sy * w + sx]) continue;
        const idx = (sy * w + sx) * 4;
        const r = out[idx];
        const g = out[idx + 1];
        const b = out[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        rAll += r;
        gAll += g;
        bAll += b;
        allCount += 1;
        if (lum >= 198) {
          rSky += r;
          gSky += g;
          bSky += b;
          skyCount += 1;
        }
      }
    }

    if (skyCount > 0) {
      return [rSky / skyCount, gSky / skyCount, bSky / skyCount];
    }
    if (allCount > 0) {
      return [rAll / allCount, gAll / allCount, bAll / allCount];
    }
    const fIdx = (py * w + px) * 4;
    return [out[fIdx], out[fIdx + 1], out[fIdx + 2]];
  };

  for (const { region, xStart, yStart, xEnd, yEnd } of boundsList) {
    const feather = region.feather ?? 14;
    const rw = Math.max(1, xEnd - xStart);
    const rh = Math.max(1, yEnd - yStart);

    // Precompute smoothed top/bottom boundary arrays and left/right boundary arrays
    const topEdge: [number, number, number][] = new Array(rw + 1);
    const botEdge: [number, number, number][] = new Array(rw + 1);
    for (let dx = 0; dx <= rw; dx += 1) {
      const x = xStart + dx;
      topEdge[dx] = sampleUnmaskedBand(x, yStart - 1, 0, -1);
      botEdge[dx] = sampleUnmaskedBand(x, yEnd + 1, 0, 1);
    }

    const leftEdge: [number, number, number][] = new Array(rh + 1);
    const rightEdge: [number, number, number][] = new Array(rh + 1);
    for (let dy = 0; dy <= rh; dy += 1) {
      const y = yStart + dy;
      leftEdge[dy] = sampleUnmaskedBand(xStart - 1, y, -1, 0);
      rightEdge[dy] = sampleUnmaskedBand(xEnd + 1, y, 1, 0);
    }

    for (let dy = 0; dy <= rh; dy += 1) {
      const y = yStart + dy;
      const ty = dy / rh;
      const fy = Math.min(
        smoothstep(0, feather, dy),
        smoothstep(0, feather, rh - dy),
      );
      const [lr, lg, lb] = leftEdge[dy];
      const [rr, rg, rb] = rightEdge[dy];

      for (let dx = 0; dx <= rw; dx += 1) {
        const x = xStart + dx;
        const tx = dx / rw;
        const fx = Math.min(
          smoothstep(0, feather, dx),
          smoothstep(0, feather, rw - dx),
        );
        const alpha = Math.min(fx, fy);
        if (alpha <= 0) continue;

        const [tr, tg, tb] = topEdge[dx];
        const [br, bg, bb] = botEdge[dx];
        const vr = tr * (1 - ty) + br * ty;
        const vg = tg * (1 - ty) + bg * ty;
        const vb = tb * (1 - ty) + bb * ty;

        let rFill = vr;
        let gFill = vg;
        let bFill = vb;

        if (region.mode === 'horizontal') {
          rFill = lr * (1 - tx) + rr * tx;
          gFill = lg * (1 - tx) + rg * tx;
          bFill = lb * (1 - tx) + rb * tx;
        } else if (region.mode === 'cloud-blend') {
          const hr = lr * (1 - tx) + rr * tx;
          const hg = lg * (1 - tx) + rg * tx;
          const hb = lb * (1 - tx) + rb * tx;
          // Smooth inverse-distance weight toward nearest edge
          const wx = Math.min(tx, 1 - tx) + 0.04;
          const wy = Math.min(ty, 1 - ty) + 0.04;
          const vWeight = wx / (wx + wy);
          const hWeight = 1 - vWeight;
          rFill = vr * vWeight + hr * hWeight;
          gFill = vg * vWeight + hg * hWeight;
          bFill = vb * vWeight + hb * hWeight;
        }

        const idx = (y * w + x) * 4;
        out[idx] = Math.round(out[idx] * (1 - alpha) + rFill * alpha);
        out[idx + 1] = Math.round(out[idx + 1] * (1 - alpha) + gFill * alpha);
        out[idx + 2] = Math.round(out[idx + 2] * (1 - alpha) + bFill * alpha);
      }
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

      {/* Gentle top atmospheric contrast veil for navbar & headline legibility */}
      <div
        className="absolute inset-x-0 top-0 h-[48%]"
        style={{
          background:
            'linear-gradient(180deg, rgba(226,243,255,0.42) 0%, rgba(255,255,255,0.22) 48%, rgba(255,255,255,0) 100%)',
        }}
      />
    </div>
  );
}
