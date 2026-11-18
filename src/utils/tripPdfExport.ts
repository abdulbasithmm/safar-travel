import { jsPDF } from 'jspdf';
import type { DestinationPhoto } from '@/types/photo';
import type {
  CurrencyCode,
  StructuredTripPlan,
  TravelStyle,
} from '@/types/trip';

export interface TripPdfExportOptions {
  plan: StructuredTripPlan;
  title?: string;
  country?: string;
  startingLocation?: string;
  departureDate?: string;
  returnDate?: string;
  travelers?: number;
  travelStyle?: TravelStyle;
  budgetAmount?: number;
  notes?: string;
  photos?: DestinationPhoto[];
}

export interface TripPdfExportResult {
  fileName: string;
  pageCount: number;
  includedPhotos: number;
}

const KNOWN_DESTINATION_COUNTRIES: Array<[RegExp, string]> = [
  [/\b(munnar|alleppey|alappuzha|kochi|cochin|kerala|goa|jaipur|delhi|mumbai|varanasi|udaipur|ladakh|manali|rishikesh|coorg|ooty|hampi|agra|india)\b/i, 'India'],
  [/\b(paris|nice|lyon|marseille|france)\b/i, 'France'],
  [/\b(dubai|abu dhabi|sharjah|uae|united arab emirates)\b/i, 'United Arab Emirates'],
  [/\b(bali|ubud|jakarta|indonesia)\b/i, 'Indonesia'],
  [/\b(kyoto|tokyo|osaka|japan)\b/i, 'Japan'],
  [/\b(santorini|athens|mykonos|greece)\b/i, 'Greece'],
  [/\b(london|edinburgh|uk|united kingdom)\b/i, 'United Kingdom'],
  [/\b(new york|los angeles|san francisco|chicago|usa|united states)\b/i, 'United States'],
  [/\b(rome|florence|venice|milan|amalfi|italy)\b/i, 'Italy'],
  [/\b(barcelona|madrid|seville|spain)\b/i, 'Spain'],
  [/\b(zurich|geneva|interlaken|switzerland)\b/i, 'Switzerland'],
  [/\b(bangkok|phuket|chiang mai|thailand)\b/i, 'Thailand'],
  [/\b(singapore)\b/i, 'Singapore'],
  [/\b(maldives|male)\b/i, 'Maldives'],
];

export function extractDestinationAndCountry(destination: string): {
  place: string;
  country: string;
} {
  const clean = destination.trim();
  if (!clean) {
    return { place: 'Planned Destination', country: '' };
  }

  const parts = clean
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    // Handle patterns like "Munnar, Kerala" -> Country India
    for (const [pattern, country] of KNOWN_DESTINATION_COUNTRIES) {
      if (pattern.test(last)) {
        return {
          place: clean,
          country: last.toLowerCase() === country.toLowerCase() ? last : country,
        };
      }
    }
    return { place: clean, country: last };
  }

  for (const [pattern, country] of KNOWN_DESTINATION_COUNTRIES) {
    if (pattern.test(clean)) {
      return { place: clean, country };
    }
  }

  return { place: clean, country: '' };
}

function formatMoney(amount: number, currency: CurrencyCode): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
  const rounded = Math.round(amount || 0);
  return `${symbol}${rounded.toLocaleString('en-US')}`;
}

function capitalize(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildSafeFileName(title: string, destination: string): string {
  const base = (title || destination || 'safar-itinerary')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${base || 'safar-itinerary'}-safar.pdf`;
}

const FONT_STACK = "'Geist', 'Noto Sans Malayalam', 'Noto Sans', system-ui, -apple-system, sans-serif";
const DISPLAY_FONT_STACK = "'Special Elite', 'Geist', 'Noto Sans Malayalam', serif";

// A4 logical canvas coordinates (at 96 DPI base, rendered at 2x = 1588x2246 px)
const PAGE_W = 794;
const PAGE_H = 1123;
const CANVAS_SCALE = 2;
const MARGIN_X = 48;
const MARGIN_TOP = 46;
const FOOTER_HEIGHT = 40;
const MARGIN_BOTTOM = PAGE_H - FOOTER_HEIGHT - 16;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const COLOR_TEXT = '#0a0a0a';
const COLOR_MUTED = '#525252';
const COLOR_ACCENT = '#905831';
const COLOR_BORDER = 'rgba(10, 10, 10, 0.14)';
const COLOR_SURFACE = '#faf9f7';

function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const SegmenterCtor = (
      Intl as unknown as {
        Segmenter: new (
          locale?: string,
          opts?: { granularity: 'grapheme' },
        ) => { segment: (input: string) => Iterable<{ segment: string }> };
      }
    ).Segmenter;
    const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  ctx.font = font;
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      if (ctx.measureText(word).width <= maxWidth) {
        currentLine = word;
      } else {
        // Break oversized tokens cleanly along grapheme cluster boundaries (preserves Malayalam ligatures)
        let chunk = '';
        for (const grapheme of splitGraphemes(word)) {
          const nextChunk = chunk + grapheme;
          if (ctx.measureText(nextChunk).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = grapheme;
          } else {
            chunk = nextChunk;
          }
        }
        currentLine = chunk;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

interface LoadedPdfPhoto {
  photo: DestinationPhoto;
  image: HTMLImageElement;
}

async function loadImageForCanvas(
  photo: DestinationPhoto,
  timeoutMs = 4500,
): Promise<LoadedPdfPhoto | null> {
  const src = photo.thumbUrl || photo.url;
  if (!src) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ photo, image: img });
      } else {
        resolve(null);
      }
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(null);
    };

    img.src = src;
  });
}

class PdfPageComposer {
  private pages: HTMLCanvasElement[] = [];
  private currentCanvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private cursorY = MARGIN_TOP;

  constructor() {
    this.startNewPage();
  }

  private startNewPage() {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W * CANVAS_SCALE;
    canvas.height = PAGE_H * CANVAS_SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to initialize canvas rendering context for PDF export.');
    }
    ctx.scale(CANVAS_SCALE, CANVAS_SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    this.currentCanvas = canvas;
    this.ctx = ctx;
    this.pages.push(canvas);
    this.cursorY = MARGIN_TOP;
  }

  getMeasureContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  getRemainingHeight(): number {
    return MARGIN_BOTTOM - this.cursorY;
  }

  ensureSpace(requiredHeight: number) {
    if (
      this.cursorY > MARGIN_TOP &&
      this.cursorY + requiredHeight > MARGIN_BOTTOM
    ) {
      this.startNewPage();
    }
  }

  advance(delta: number) {
    this.cursorY += delta;
  }

  getY(): number {
    return this.cursorY;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  drawWrappedParagraph(params: {
    text: string;
    x: number;
    maxWidth: number;
    font: string;
    lineHeight: number;
    color: string;
    bottomGap?: number;
  }) {
    const lines = wrapTextLines(
      this.ctx,
      params.text,
      params.maxWidth,
      params.font,
    );
    for (const line of lines) {
      this.ensureSpace(params.lineHeight);
      this.ctx.font = params.font;
      this.ctx.fillStyle = params.color;
      this.ctx.textBaseline = 'top';
      if (line) {
        this.ctx.fillText(line, params.x, this.cursorY);
      }
      this.cursorY += params.lineHeight;
    }
    if (params.bottomGap) {
      this.cursorY += params.bottomGap;
    }
  }

  drawSectionHeading(title: string, subtitle?: string) {
    const blockH = subtitle ? 44 : 28;
    this.ensureSpace(blockH + 36);
    const ctx = this.ctx;
    ctx.fillStyle = COLOR_ACCENT;
    ctx.fillRect(MARGIN_X, this.cursorY + 4, 4, 16);

    ctx.font = `600 15px ${FONT_STACK}`;
    ctx.fillStyle = COLOR_TEXT;
    ctx.textBaseline = 'top';
    ctx.fillText(title, MARGIN_X + 12, this.cursorY + 2);
    this.cursorY += 24;

    if (subtitle) {
      ctx.font = `400 11px ${FONT_STACK}`;
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText(subtitle, MARGIN_X + 12, this.cursorY);
      this.cursorY += 16;
    }

    ctx.strokeStyle = COLOR_BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, this.cursorY + 2);
    ctx.lineTo(MARGIN_X + CONTENT_W, this.cursorY + 2);
    ctx.stroke();
    this.cursorY += 12;
  }

  drawCard(params: {
    paddingX?: number;
    paddingY?: number;
    bg?: string;
    borderColor?: string;
    accentStripe?: boolean;
    blocks: Array<{
      text: string;
      font: string;
      lineHeight: number;
      color: string;
      gapAfter?: number;
    }>;
  }) {
    const padX = params.paddingX ?? 16;
    const padY = params.paddingY ?? 12;
    const innerW = CONTENT_W - padX * 2;
    const ctx = this.ctx;

    const measuredBlocks = params.blocks
      .filter((b) => b.text.trim().length > 0)
      .map((b) => {
        const lines = wrapTextLines(ctx, b.text, innerW, b.font);
        return {
          ...b,
          lines,
          height: lines.length * b.lineHeight + (b.gapAfter ?? 0),
        };
      });

    if (measuredBlocks.length === 0) return;

    const totalTextHeight = measuredBlocks.reduce((sum, b) => sum + b.height, 0);
    const cardHeight = padY * 2 + totalTextHeight;

    // If card fits on a single page, keep it intact; otherwise stream lines with clean page breaks
    if (cardHeight <= MARGIN_BOTTOM - MARGIN_TOP) {
      this.ensureSpace(cardHeight + 10);
      const y0 = this.cursorY;
      const c = this.ctx;

      drawRoundedRectPath(c, MARGIN_X, y0, CONTENT_W, cardHeight, 12);
      c.fillStyle = params.bg ?? COLOR_SURFACE;
      c.fill();
      c.strokeStyle = params.borderColor ?? COLOR_BORDER;
      c.lineWidth = 1;
      c.stroke();

      if (params.accentStripe) {
        c.fillStyle = COLOR_ACCENT;
        drawRoundedRectPath(c, MARGIN_X, y0, 4, cardHeight, 4);
        c.fill();
      }

      let ty = y0 + padY;
      for (const b of measuredBlocks) {
        c.font = b.font;
        c.fillStyle = b.color;
        c.textBaseline = 'top';
        for (const line of b.lines) {
          if (line) {
            c.fillText(line, MARGIN_X + padX, ty);
          }
          ty += b.lineHeight;
        }
        ty += b.gapAfter ?? 0;
      }

      this.cursorY = y0 + cardHeight + 10;
    } else {
      // Multi-page stream for exceptionally long descriptions/notes so content is never truncated
      this.ensureSpace(44);
      for (const b of measuredBlocks) {
        for (const line of b.lines) {
          this.ensureSpace(b.lineHeight);
          const c = this.ctx;
          c.font = b.font;
          c.fillStyle = b.color;
          c.textBaseline = 'top';
          if (line) {
            c.fillText(line, MARGIN_X + padX, this.cursorY);
          }
          this.cursorY += b.lineHeight;
        }
        this.cursorY += b.gapAfter ?? 0;
      }
      this.cursorY += 10;
    }
  }

  finalizeToPdf(destinationTitle: string): { pdf: jsPDF; pageCount: number } {
    const totalPages = this.pages.length;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const a4WidthMm = pdf.internal.pageSize.getWidth();
    const a4HeightMm = pdf.internal.pageSize.getHeight();

    this.pages.forEach((canvas, idx) => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Draw page footer cleanly before exporting
        ctx.strokeStyle = COLOR_BORDER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(MARGIN_X, PAGE_H - FOOTER_HEIGHT);
        ctx.lineTo(MARGIN_X + CONTENT_W, PAGE_H - FOOTER_HEIGHT);
        ctx.stroke();

        ctx.font = `500 10px ${FONT_STACK}`;
        ctx.fillStyle = COLOR_MUTED;
        ctx.textBaseline = 'top';
        ctx.fillText(
          `SAFAR (سفر) · ${destinationTitle}`.slice(0, 72),
          MARGIN_X,
          PAGE_H - FOOTER_HEIGHT + 11,
        );

        const pageLabel = `Page ${idx + 1} of ${totalPages}`;
        const labelW = ctx.measureText(pageLabel).width;
        ctx.fillText(
          pageLabel,
          MARGIN_X + CONTENT_W - labelW,
          PAGE_H - FOOTER_HEIGHT + 11,
        );
      }

      if (idx > 0) {
        pdf.addPage('a4', 'portrait');
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(dataUrl, 'JPEG', 0, 0, a4WidthMm, a4HeightMm, undefined, 'FAST');
    });

    return { pdf, pageCount: totalPages };
  }
}

export async function buildTripPdfDocument(
  options: TripPdfExportOptions,
): Promise<{ pdf: jsPDF; fileName: string; pageCount: number; includedPhotos: number }> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed cleanly if FontFaceSet check fails
    }
  }

  const { plan } = options;
  const resolved = extractDestinationAndCountry(plan.destination);
  const countryLabel = (options.country || resolved.country).trim();
  const displayTitle = (
    options.title?.trim() ||
    `${plan.dailyItinerary.length}-Day ${plan.destination} Itinerary`
  ).trim();
  const fileName = buildSafeFileName(displayTitle, plan.destination);

  // Load up to 3 relevant destination photos safely (gracefully ignores CORS/network failures)
  const candidatePhotos = (options.photos ?? []).slice(0, 3);
  const loadedPhotos = (
    await Promise.all(candidatePhotos.map((p) => loadImageForCanvas(p)))
  ).filter((item): item is LoadedPdfPhoto => item !== null);

  const composer = new PdfPageComposer();
  const ctx = composer.getContext();

  // 1. Editorial Header Banner
  const titleLines = wrapTextLines(
    ctx,
    displayTitle,
    CONTENT_W - 40,
    `600 22px ${FONT_STACK}`,
  );
  const metaParts = [
    countryLabel ? `${plan.destination} (${countryLabel})` : plan.destination,
    `${plan.dailyItinerary.length} ${plan.dailyItinerary.length === 1 ? 'Day' : 'Days'}`,
    options.travelers ? `${options.travelers} ${options.travelers === 1 ? 'Traveler' : 'Travelers'}` : '',
    options.travelStyle ? `${capitalize(options.travelStyle)} Style` : '',
    plan.language === 'ml' ? 'Malayalam (മലയാളം)' : 'English',
  ].filter(Boolean);
  const routeMeta = [
    options.startingLocation ? `From: ${options.startingLocation}` : '',
    options.departureDate && options.returnDate
      ? `Dates: ${options.departureDate} to ${options.returnDate}`
      : options.departureDate
        ? `Departure: ${options.departureDate}`
        : '',
  ].filter(Boolean);

  const headerHeight =
    22 + // brand row
    16 +
    titleLines.length * 28 +
    10 +
    20 + // metaParts
    (routeMeta.length > 0 ? 18 : 0) +
    18;

  drawRoundedRectPath(ctx, MARGIN_X, composer.getY(), CONTENT_W, headerHeight, 16);
  ctx.fillStyle = '#0a0a0a';
  ctx.fill();

  let hy = composer.getY() + 20;
  ctx.font = `400 18px ${DISPLAY_FONT_STACK}`;
  ctx.fillStyle = '#fafafa';
  ctx.textBaseline = 'top';
  ctx.fillText('SAFAR', MARGIN_X + 20, hy);

  const safarWidth = ctx.measureText('SAFAR').width;
  ctx.font = `500 14px ${FONT_STACK}`;
  ctx.fillStyle = '#d4a37f';
  ctx.fillText('سفر  ·  Your Journey, Your Story.', MARGIN_X + 28 + safarWidth, hy + 2);

  const generatedStamp = `Generated ${new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
  ctx.font = `400 10px ${FONT_STACK}`;
  ctx.fillStyle = 'rgba(250,250,250,0.65)';
  const stampW = ctx.measureText(generatedStamp).width;
  ctx.fillText(generatedStamp, MARGIN_X + CONTENT_W - 20 - stampW, hy + 4);
  hy += 30;

  ctx.font = `600 22px ${FONT_STACK}`;
  ctx.fillStyle = '#ffffff';
  for (const line of titleLines) {
    ctx.fillText(line, MARGIN_X + 20, hy);
    hy += 28;
  }
  hy += 6;

  ctx.font = `500 11px ${FONT_STACK}`;
  ctx.fillStyle = '#e5e5e5';
  const metaWrapped = wrapTextLines(
    ctx,
    metaParts.join('  ·  '),
    CONTENT_W - 40,
    `500 11px ${FONT_STACK}`,
  );
  ctx.fillText(metaWrapped[0] || '', MARGIN_X + 20, hy);
  hy += 18;

  if (routeMeta.length > 0) {
    ctx.font = `400 11px ${FONT_STACK}`;
    ctx.fillStyle = '#cfcfcf';
    ctx.fillText(routeMeta.join('  ·  '), MARGIN_X + 20, hy);
  }

  composer.advance(headerHeight + 20);

  // 2. Trip Summary
  composer.drawSectionHeading('Trip Overview');
  composer.drawWrappedParagraph({
    text: plan.tripSummary,
    x: MARGIN_X,
    maxWidth: CONTENT_W,
    font: `400 12px ${FONT_STACK}`,
    lineHeight: 19,
    color: COLOR_TEXT,
    bottomGap: 16,
  });

  // 3. Destination Photographs (when loaded)
  if (loadedPhotos.length > 0) {
    const gap = 12;
    const cols = loadedPhotos.length;
    const tileW = (CONTENT_W - gap * (cols - 1)) / cols;
    const tileH = cols === 1 ? 170 : cols === 2 ? 135 : 112;
    composer.ensureSpace(tileH + 46);
    composer.drawSectionHeading(`Destination Views · ${plan.destination}`);

    const imgY = composer.getY();
    const imgCtx = composer.getContext();
    loadedPhotos.forEach((item, idx) => {
      const ix = MARGIN_X + idx * (tileW + gap);
      imgCtx.save();
      drawRoundedRectPath(imgCtx, ix, imgY, tileW, tileH, 10);
      imgCtx.clip();

      // Object-fit: cover crop
      const iw = item.image.naturalWidth;
      const ih = item.image.naturalHeight;
      const targetRatio = tileW / tileH;
      const srcRatio = iw / ih;
      let sx = 0;
      let sy = 0;
      let sw = iw;
      let sh = ih;
      if (srcRatio > targetRatio) {
        sw = ih * targetRatio;
        sx = (iw - sw) / 2;
      } else {
        sh = iw / targetRatio;
        sy = (ih - sh) / 2;
      }
      imgCtx.drawImage(item.image, sx, sy, sw, sh, ix, imgY, tileW, tileH);
      imgCtx.restore();

      drawRoundedRectPath(imgCtx, ix, imgY, tileW, tileH, 10);
      imgCtx.strokeStyle = COLOR_BORDER;
      imgCtx.lineWidth = 1;
      imgCtx.stroke();

      imgCtx.font = `400 9px ${FONT_STACK}`;
      imgCtx.fillStyle = COLOR_MUTED;
      imgCtx.textBaseline = 'top';
      const credit = `Photo: ${item.photo.attribution.photographerName} (${item.photo.attribution.sourceName})`;
      imgCtx.fillText(credit.slice(0, 42), ix, imgY + tileH + 5);
    });

    composer.advance(tileH + 28);
  }

  // 4. Personal Notes (when available)
  if (options.notes && options.notes.trim()) {
    composer.drawSectionHeading('Personal Notes');
    composer.drawCard({
      accentStripe: true,
      blocks: [
        {
          text: options.notes.trim(),
          font: `400 12px ${FONT_STACK}`,
          lineHeight: 18,
          color: COLOR_TEXT,
        },
      ],
    });
    composer.advance(6);
  }

  // 5. Budget Breakdown
  composer.drawSectionHeading(`Budget Breakdown (${plan.currency})`);
  const budgetRows: Array<[string, number]> = [
    ['Accommodation', plan.budgetBreakdown.accommodation],
    ['Food & Dining', plan.budgetBreakdown.food],
    ['Transportation', plan.budgetBreakdown.transportation],
    ['Activities', plan.budgetBreakdown.activities],
  ];
  const budgetCardH = 128;
  composer.ensureSpace(budgetCardH + 24);
  const by0 = composer.getY();
  const bCtx = composer.getContext();
  drawRoundedRectPath(bCtx, MARGIN_X, by0, CONTENT_W, budgetCardH, 12);
  bCtx.fillStyle = COLOR_SURFACE;
  bCtx.fill();
  bCtx.strokeStyle = COLOR_BORDER;
  bCtx.lineWidth = 1;
  bCtx.stroke();

  const colW = (CONTENT_W - 32) / 4;
  budgetRows.forEach(([label, amount], idx) => {
    const cx = MARGIN_X + 16 + idx * colW;
    bCtx.font = `600 10px ${FONT_STACK}`;
    bCtx.fillStyle = COLOR_MUTED;
    bCtx.textBaseline = 'top';
    bCtx.fillText(label.toUpperCase(), cx, by0 + 16);

    bCtx.font = `600 16px ${FONT_STACK}`;
    bCtx.fillStyle = COLOR_TEXT;
    bCtx.fillText(formatMoney(amount, plan.currency), cx, by0 + 34);
  });

  bCtx.strokeStyle = COLOR_BORDER;
  bCtx.beginPath();
  bCtx.moveTo(MARGIN_X + 16, by0 + 66);
  bCtx.lineTo(MARGIN_X + CONTENT_W - 16, by0 + 66);
  bCtx.stroke();

  bCtx.font = `600 12px ${FONT_STACK}`;
  bCtx.fillStyle = COLOR_ACCENT;
  bCtx.fillText(
    `Total Estimated Cost: ${formatMoney(plan.totalEstimatedBudget, plan.currency)}`,
    MARGIN_X + 16,
    by0 + 78,
  );
  if (options.budgetAmount && options.budgetAmount > 0) {
    const targetText = `Target Budget: ${formatMoney(options.budgetAmount, plan.currency)}`;
    const tw = bCtx.measureText(targetText).width;
    bCtx.fillStyle = COLOR_MUTED;
    bCtx.fillText(targetText, MARGIN_X + CONTENT_W - 16 - tw, by0 + 78);
  }

  bCtx.font = `400 10px ${FONT_STACK}`;
  bCtx.fillStyle = COLOR_MUTED;
  const disclaimerLines = wrapTextLines(
    bCtx,
    plan.budgetBreakdown.disclaimer || 'Approximate planning estimate only.',
    CONTENT_W - 32,
    `400 10px ${FONT_STACK}`,
  );
  bCtx.fillText(disclaimerLines[0] || '', MARGIN_X + 16, by0 + 100);
  composer.advance(budgetCardH + 18);

  // 6. Complete Day-by-Day Schedule (never truncated)
  composer.drawSectionHeading(
    'Day-by-Day Schedule',
    `${plan.dailyItinerary.length} days · complete itinerary`,
  );

  for (const day of plan.dailyItinerary) {
    const dayHeaderLabel = `DAY ${day.day}${day.date ? ` · ${day.date}` : ''}`;
    composer.ensureSpace(72);

    const dCtx = composer.getContext();
    dCtx.font = `700 11px ${FONT_STACK}`;
    dCtx.fillStyle = COLOR_ACCENT;
    dCtx.textBaseline = 'top';
    dCtx.fillText(dayHeaderLabel, MARGIN_X, composer.getY() + 4);

    if (day.estimatedTravelTime) {
      const transitLabel = `Est. transit: ${day.estimatedTravelTime}`;
      dCtx.font = `400 11px ${FONT_STACK}`;
      const transitW = dCtx.measureText(transitLabel).width;
      dCtx.fillStyle = COLOR_MUTED;
      dCtx.fillText(transitLabel, MARGIN_X + CONTENT_W - transitW, composer.getY() + 4);
    }
    composer.advance(20);

    composer.drawWrappedParagraph({
      text: day.theme,
      x: MARGIN_X,
      maxWidth: CONTENT_W,
      font: `600 14px ${FONT_STACK}`,
      lineHeight: 20,
      color: COLOR_TEXT,
      bottomGap: 8,
    });

    for (const slot of day.schedule) {
      const costText =
        slot.estimatedCost > 0
          ? `Est. Cost: ~${formatMoney(slot.estimatedCost, plan.currency)}`
          : '';
      const timeMeta = [
        slot.time,
        slot.travelTimeFromPrev ? `Travel: ${slot.travelTimeFromPrev}` : '',
        costText,
      ]
        .filter(Boolean)
        .join('  ·  ');

      const locationMeta = [
        slot.location,
        slot.visitingHours ? `Hours: ${slot.visitingHours}` : '',
      ]
        .filter(Boolean)
        .join('  ·  ');

      composer.drawCard({
        paddingX: 14,
        paddingY: 10,
        accentStripe: true,
        blocks: [
          {
            text: timeMeta,
            font: `600 10.5px ${FONT_STACK}`,
            lineHeight: 15,
            color: COLOR_ACCENT,
            gapAfter: 2,
          },
          {
            text: slot.activity,
            font: `600 12.5px ${FONT_STACK}`,
            lineHeight: 18,
            color: COLOR_TEXT,
            gapAfter: 2,
          },
          ...(locationMeta
            ? [
                {
                  text: locationMeta,
                  font: `500 11px ${FONT_STACK}`,
                  lineHeight: 16,
                  color: COLOR_MUTED,
                  gapAfter: slot.notes ? 3 : 0,
                },
              ]
            : []),
          ...(slot.notes
            ? [
                {
                  text: slot.notes,
                  font: `400 11px ${FONT_STACK}`,
                  lineHeight: 16,
                  color: COLOR_MUTED,
                },
              ]
            : []),
        ],
      });
    }

    composer.advance(6);
  }

  // 7. Key Attractions
  if (plan.attractions.length > 0) {
    composer.drawSectionHeading('Key Attractions');
    for (const item of plan.attractions) {
      const timing = [
        item.bestTimeToVisit ? `Best time: ${item.bestTimeToVisit}` : '',
        item.estimatedDuration ? `Duration: ${item.estimatedDuration}` : '',
      ]
        .filter(Boolean)
        .join('  ·  ');

      composer.drawCard({
        paddingX: 14,
        paddingY: 10,
        blocks: [
          {
            text: item.name,
            font: `600 12.5px ${FONT_STACK}`,
            lineHeight: 18,
            color: COLOR_TEXT,
            gapAfter: 2,
          },
          ...(timing
            ? [
                {
                  text: timing,
                  font: `500 10.5px ${FONT_STACK}`,
                  lineHeight: 15,
                  color: COLOR_ACCENT,
                  gapAfter: 3,
                },
              ]
            : []),
          {
            text: item.description,
            font: `400 11px ${FONT_STACK}`,
            lineHeight: 16,
            color: COLOR_MUTED,
          },
        ],
      });
    }
  }

  // 8. Accommodation Suggestions
  if (plan.accommodationSuggestions.length > 0) {
    composer.drawSectionHeading('Stay & Accommodation Suggestions');
    for (const stay of plan.accommodationSuggestions) {
      const stayMeta = [stay.area, stay.tier, stay.approximateNightlyRange]
        .filter(Boolean)
        .join('  ·  ');
      composer.drawCard({
        paddingX: 14,
        paddingY: 10,
        blocks: [
          {
            text: stay.name,
            font: `600 12.5px ${FONT_STACK}`,
            lineHeight: 18,
            color: COLOR_TEXT,
            gapAfter: 2,
          },
          ...(stayMeta
            ? [
                {
                  text: stayMeta,
                  font: `500 10.5px ${FONT_STACK}`,
                  lineHeight: 15,
                  color: COLOR_ACCENT,
                  gapAfter: 3,
                },
              ]
            : []),
          ...(stay.notes
            ? [
                {
                  text: stay.notes,
                  font: `400 11px ${FONT_STACK}`,
                  lineHeight: 16,
                  color: COLOR_MUTED,
                },
              ]
            : []),
        ],
      });
    }
  }

  // 9. Food Recommendations
  if (plan.foodRecommendations.length > 0) {
    composer.drawSectionHeading('Food Recommendations');
    for (const food of plan.foodRecommendations) {
      const foodMeta = [food.type, food.area, food.approximateCostRange]
        .filter(Boolean)
        .join('  ·  ');
      composer.drawCard({
        paddingX: 14,
        paddingY: 10,
        blocks: [
          {
            text: food.dishOrSpot,
            font: `600 12.5px ${FONT_STACK}`,
            lineHeight: 18,
            color: COLOR_TEXT,
            gapAfter: 2,
          },
          ...(foodMeta
            ? [
                {
                  text: foodMeta,
                  font: `500 10.5px ${FONT_STACK}`,
                  lineHeight: 15,
                  color: COLOR_ACCENT,
                  gapAfter: 3,
                },
              ]
            : []),
          ...(food.notes
            ? [
                {
                  text: food.notes,
                  font: `400 11px ${FONT_STACK}`,
                  lineHeight: 16,
                  color: COLOR_MUTED,
                },
              ]
            : []),
        ],
      });
    }
  }

  // 10. Travel Tips
  if (plan.travelTips.length > 0) {
    composer.drawSectionHeading('Travel Tips');
    plan.travelTips.forEach((tip, idx) => {
      composer.drawWrappedParagraph({
        text: `${idx + 1}. ${tip}`,
        x: MARGIN_X + 4,
        maxWidth: CONTENT_W - 8,
        font: `400 11.5px ${FONT_STACK}`,
        lineHeight: 17,
        color: COLOR_TEXT,
        bottomGap: 6,
      });
    });
  }

  const { pdf, pageCount } = composer.finalizeToPdf(displayTitle);
  return {
    pdf,
    fileName,
    pageCount,
    includedPhotos: loadedPhotos.length,
  };
}

export async function exportTripToPdf(
  options: TripPdfExportOptions,
): Promise<TripPdfExportResult> {
  const { pdf, fileName, pageCount, includedPhotos } =
    await buildTripPdfDocument(options);
  pdf.save(fileName);
  return { fileName, pageCount, includedPhotos };
}
