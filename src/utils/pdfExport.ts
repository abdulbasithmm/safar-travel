import { jsPDF } from 'jspdf';
import type { CurrencyCode, StructuredTripPlan } from '@/types/trip';

export interface PdfExportMeta {
  title?: string;
  travelers?: number;
  travelStyle?: string;
  startingLocation?: string;
  departureDate?: string;
  returnDate?: string;
  notes?: string;
}

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

// 150 DPI A4 canvas dimensions for crisp Unicode/Malayalam rendering
const CANVAS_W = 1240;
const CANVAS_H = 1754;
const CANVAS_SCALE = CANVAS_W / A4_WIDTH_PT;

const COLOR_DARK: [number, number, number] = [10, 10, 10];
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_MUTED: [number, number, number] = [118, 118, 118];
const COLOR_ACCENT: [number, number, number] = [144, 88, 49];
const COLOR_BORDER: [number, number, number] = [225, 225, 225];
const COLOR_SURFACE: [number, number, number] = [248, 247, 245];

function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'safar-itinerary';
}

function formatMoneyAscii(amount: number, currency: CurrencyCode): string {
  const rounded = Math.round(amount || 0).toLocaleString('en-US');
  return `${currency} ${rounded}`;
}

function formatMoneyDisplay(amount: number, currency: CurrencyCode): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
  const rounded = Math.round(amount || 0).toLocaleString('en-US');
  return `${symbol}${rounded}`;
}

function normalizeLatinText(input: string): string {
  return (input || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u20B9/g, 'INR ')
    .replace(/\u00B7/g, ' | ')
    .replace(/\u2022/g, '-');
}

function containsNonWinAnsiScript(plan: StructuredTripPlan, meta: PdfExportMeta): boolean {
  if (plan.language === 'ml') return true;
  const serialized = JSON.stringify({ plan, meta });
  const normalized = normalizeLatinText(serialized);
  // Check for any characters outside standard Latin-1 / WinAnsi printable range
  return /[^\u0009\u000A\u000D\u0020-\u00FF]/.test(normalized);
}

function buildMetaLine(plan: StructuredTripPlan, meta: PdfExportMeta, ascii: boolean): string {
  const sep = ascii ? '  |  ' : '  ·  ';
  const parts: string[] = [
    plan.destination,
    `${plan.dailyItinerary.length} ${plan.dailyItinerary.length === 1 ? 'Day' : 'Days'}`,
  ];
  if (meta.travelers) {
    parts.push(`${meta.travelers} ${meta.travelers === 1 ? 'Traveler' : 'Travelers'}`);
  }
  if (meta.travelStyle) {
    parts.push(meta.travelStyle.charAt(0).toUpperCase() + meta.travelStyle.slice(1));
  }
  if (meta.startingLocation) {
    parts.push(`From ${meta.startingLocation}`);
  }
  if (meta.departureDate && meta.returnDate) {
    parts.push(`${meta.departureDate} to ${meta.returnDate}`);
  } else if (meta.departureDate) {
    parts.push(`Departs ${meta.departureDate}`);
  }
  return parts.join(sep);
}

function generateVectorPdf(
  plan: StructuredTripPlan,
  meta: PdfExportMeta,
  filename: string,
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  const marginX = 44;
  const contentW = A4_WIDTH_PT - marginX * 2;
  const topY = 48;
  const bottomLimit = A4_HEIGHT_PT - 52;
  let y = topY;

  const t = (val: string) => normalizeLatinText(val);

  const ensureSpace = (neededPt: number) => {
    if (y + neededPt > bottomLimit) {
      doc.addPage();
      y = topY;
    }
  };

  const drawWrapped = (
    text: string,
    x: number,
    maxWidth: number,
    lineHeight: number,
    options?: {
      size?: number;
      style?: 'normal' | 'bold' | 'italic';
      color?: [number, number, number];
    },
  ) => {
    const clean = t(text).trim();
    if (!clean) return;
    doc.setFont('helvetica', options?.style ?? 'normal');
    doc.setFontSize(options?.size ?? 10);
    doc.setTextColor(...(options?.color ?? COLOR_TEXT));
    const lines = doc.splitTextToSize(clean, maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, x, y);
      y += lineHeight;
    }
  };

  const drawSectionHeading = (label: string) => {
    ensureSpace(34);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...COLOR_ACCENT);
    doc.text(t(label).toUpperCase(), marginX, y);
    y += 6;
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.75);
    doc.line(marginX, y, A4_WIDTH_PT - marginX, y);
    y += 14;
  };

  // Editorial Brand Header
  doc.setFillColor(...COLOR_DARK);
  doc.rect(0, 0, A4_WIDTH_PT, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_ACCENT);
  doc.text('SAFAR  |  TRAVEL ITINERARY', marginX, y);
  y += 22;

  const title = t(meta.title?.trim() || `${plan.dailyItinerary.length}-Day ${plan.destination}`);
  drawWrapped(title, marginX, contentW, 24, {
    size: 20,
    style: 'bold',
    color: COLOR_DARK,
  });
  y += 2;

  drawWrapped(buildMetaLine(plan, meta, true), marginX, contentW, 14, {
    size: 9.5,
    style: 'normal',
    color: COLOR_MUTED,
  });
  y += 8;

  // Summary
  drawWrapped(plan.tripSummary, marginX, contentW, 15, {
    size: 10.5,
    style: 'normal',
    color: COLOR_TEXT,
  });

  if (meta.notes?.trim()) {
    y += 6;
    ensureSpace(36);
    doc.setFillColor(...COLOR_SURFACE);
    doc.setDrawColor(...COLOR_BORDER);
    const noteLines = doc.splitTextToSize(t(meta.notes.trim()), contentW - 24) as string[];
    const boxH = 26 + noteLines.length * 13;
    doc.roundedRect(marginX, y, contentW, boxH, 6, 6, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR_ACCENT);
    doc.text('PERSONAL NOTES', marginX + 12, y + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLOR_TEXT);
    doc.text(noteLines, marginX + 12, y + 30);
    y += boxH + 8;
  }

  // Budget Breakdown
  drawSectionHeading(`Estimated Budget (${plan.currency})`);
  ensureSpace(88);
  const b = plan.budgetBreakdown;
  const colW = contentW / 4;
  const categories: Array<[string, number]> = [
    ['Accommodation', b.accommodation],
    ['Food & Dining', b.food],
    ['Transportation', b.transportation],
    ['Activities', b.activities],
  ];

  doc.setFillColor(...COLOR_SURFACE);
  doc.setDrawColor(...COLOR_BORDER);
  doc.roundedRect(marginX, y, contentW, 52, 6, 6, 'FD');

  categories.forEach(([label, amount], idx) => {
    const cx = marginX + idx * colW + 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, cx, y + 19);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLOR_TEXT);
    doc.text(formatMoneyAscii(amount, plan.currency), cx, y + 37);
  });
  y += 64;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_DARK);
  doc.text(
    `Total Estimated Cost: ${formatMoneyAscii(plan.totalEstimatedBudget, plan.currency)}`,
    marginX,
    y,
  );
  y += 14;
  if (b.disclaimer) {
    drawWrapped(b.disclaimer, marginX, contentW, 12, {
      size: 8.5,
      color: COLOR_MUTED,
    });
  }

  // Day-by-Day Schedule
  drawSectionHeading('Day-by-Day Schedule');
  for (const day of plan.dailyItinerary) {
    ensureSpace(48);
    y += 4;
    doc.setFillColor(...COLOR_SURFACE);
    doc.roundedRect(marginX, y - 12, contentW, 24, 4, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLOR_DARK);
    const dayHeader = `Day ${day.day}${day.date ? ` (${day.date})` : ''} - ${t(day.theme)}`;
    const truncatedHeader =
      dayHeader.length > 72 ? `${dayHeader.slice(0, 69)}...` : dayHeader;
    doc.text(truncatedHeader, marginX + 10, y + 4);

    if (day.estimatedTravelTime) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...COLOR_MUTED);
      const transitTxt = `Transit: ${t(day.estimatedTravelTime)}`;
      doc.text(transitTxt, A4_WIDTH_PT - marginX - 10, y + 4, { align: 'right' });
    }
    y += 22;

    for (const slot of day.schedule) {
      ensureSpace(38);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...COLOR_ACCENT);
      doc.text(t(slot.time || '-'), marginX + 6, y);

      const detailX = marginX + 94;
      const detailW = contentW - 94;

      const activityTitle =
        slot.estimatedCost > 0
          ? `${t(slot.activity)} (~${formatMoneyAscii(slot.estimatedCost, plan.currency)})`
          : t(slot.activity);

      drawWrapped(activityTitle, detailX, detailW, 13.5, {
        size: 10,
        style: 'bold',
        color: COLOR_TEXT,
      });

      const subParts = [
        slot.location ? t(slot.location) : '',
        slot.visitingHours ? `Hours: ${t(slot.visitingHours)}` : '',
        slot.travelTimeFromPrev ? t(slot.travelTimeFromPrev) : '',
      ].filter(Boolean);
      if (subParts.length > 0) {
        drawWrapped(subParts.join('  |  '), detailX, detailW, 12.5, {
          size: 8.8,
          color: COLOR_MUTED,
        });
      }

      if (slot.notes) {
        drawWrapped(slot.notes, detailX, detailW, 12.5, {
          size: 8.8,
          color: COLOR_TEXT,
        });
      }
      y += 6;
    }
    y += 4;
  }

  // Key Attractions
  if (plan.attractions.length > 0) {
    drawSectionHeading('Key Attractions');
    for (const item of plan.attractions) {
      ensureSpace(32);
      drawWrapped(
        `${t(item.name)} (${t(item.bestTimeToVisit)}, ${t(item.estimatedDuration)})`,
        marginX,
        contentW,
        14,
        { size: 10, style: 'bold', color: COLOR_TEXT },
      );
      if (item.description) {
        drawWrapped(item.description, marginX + 10, contentW - 10, 13, {
          size: 9,
          color: COLOR_MUTED,
        });
      }
      y += 4;
    }
  }

  // Stay Suggestions
  if (plan.accommodationSuggestions.length > 0) {
    drawSectionHeading('Stay Suggestions');
    for (const stay of plan.accommodationSuggestions) {
      ensureSpace(30);
      drawWrapped(
        `${t(stay.name)} - ${t(stay.area)} (${t(stay.tier)}, ${t(stay.approximateNightlyRange)})`,
        marginX,
        contentW,
        14,
        { size: 10, style: 'bold', color: COLOR_TEXT },
      );
      if (stay.notes) {
        drawWrapped(stay.notes, marginX + 10, contentW - 10, 13, {
          size: 9,
          color: COLOR_MUTED,
        });
      }
      y += 4;
    }
  }

  // Food Recommendations
  if (plan.foodRecommendations.length > 0) {
    drawSectionHeading('Food Recommendations');
    for (const food of plan.foodRecommendations) {
      ensureSpace(30);
      drawWrapped(
        `${t(food.dishOrSpot)} - ${t(food.type)}, ${t(food.area)} (${t(food.approximateCostRange)})`,
        marginX,
        contentW,
        14,
        { size: 10, style: 'bold', color: COLOR_TEXT },
      );
      if (food.notes) {
        drawWrapped(food.notes, marginX + 10, contentW - 10, 13, {
          size: 9,
          color: COLOR_MUTED,
        });
      }
      y += 4;
    }
  }

  // Travel Tips
  if (plan.travelTips.length > 0) {
    drawSectionHeading('Travel Tips');
    for (const tip of plan.travelTips) {
      ensureSpace(18);
      drawWrapped(`- ${t(tip)}`, marginX + 4, contentW - 4, 13.5, {
        size: 9.5,
        color: COLOR_TEXT,
      });
    }
  }

  // Page numbers & footer
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...COLOR_BORDER);
    doc.setLineWidth(0.5);
    doc.line(marginX, A4_HEIGHT_PT - 34, A4_WIDTH_PT - marginX, A4_HEIGHT_PT - 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR_MUTED);
    doc.text('SAFAR · Your Journey, Your Story.', marginX, A4_HEIGHT_PT - 20);
    doc.text(`Page ${p} of ${totalPages}`, A4_WIDTH_PT - marginX, A4_HEIGHT_PT - 20, {
      align: 'right',
    });
  }

  doc.save(filename);
}

/**
 * High-DPI Canvas 2D multi-page renderer for Indic/Malayalam scripts so
 * browser text shaping (HarfBuzz) preserves conjuncts and ligatures cleanly.
 */
function generateUnicodeCanvasPdf(
  plan: StructuredTripPlan,
  meta: PdfExportMeta,
  filename: string,
): void {
  const marginX = Math.round(44 * CANVAS_SCALE);
  const contentW = CANVAS_W - marginX * 2;
  const topY = Math.round(52 * CANVAS_SCALE);
  const bottomLimit = CANVAS_H - Math.round(56 * CANVAS_SCALE);

  const pages: HTMLCanvasElement[] = [];

  const createPageCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to initialize canvas context for PDF export.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CANVAS_W, Math.round(6 * CANVAS_SCALE));
    pages.push(canvas);
    return { canvas, ctx };
  };

  let { ctx } = createPageCanvas();
  let y = topY;

  const ensureSpace = (neededPx: number) => {
    if (y + neededPx > bottomLimit) {
      ({ ctx } = createPageCanvas());
      y = topY;
    }
  };

  const fontStr = (ptSize: number, weight: 'normal' | 'bold' = 'normal') =>
    `${weight === 'bold' ? '600' : '400'} ${Math.round(ptSize * CANVAS_SCALE)}px "Geist", "Noto Sans Malayalam", system-ui, sans-serif`;

  const wrapLines = (text: string, maxWidthPx: number, ptSize: number, weight: 'normal' | 'bold' = 'normal'): string[] => {
    const clean = (text || '').trim();
    if (!clean) return [];
    ctx.font = fontStr(ptSize, weight);
    const words = clean.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidthPx) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const drawTextBlock = (
    text: string,
    x: number,
    maxW: number,
    ptSize: number,
    lineHeightPt: number,
    color: string,
    weight: 'normal' | 'bold' = 'normal',
  ) => {
    const lines = wrapLines(text, maxW, ptSize, weight);
    const lhPx = Math.round(lineHeightPt * CANVAS_SCALE);
    ctx.fillStyle = color;
    ctx.font = fontStr(ptSize, weight);
    for (const line of lines) {
      ensureSpace(lhPx);
      ctx.fillStyle = color;
      ctx.font = fontStr(ptSize, weight);
      ctx.fillText(line, x, y);
      y += lhPx;
    }
  };

  const drawHeading = (label: string) => {
    ensureSpace(Math.round(34 * CANVAS_SCALE));
    y += Math.round(10 * CANVAS_SCALE);
    ctx.font = fontStr(12, 'bold');
    ctx.fillStyle = '#905831';
    ctx.fillText(label.toUpperCase(), marginX, y);
    y += Math.round(8 * CANVAS_SCALE);
    ctx.strokeStyle = '#e1e1e1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(CANVAS_W - marginX, y);
    ctx.stroke();
    y += Math.round(18 * CANVAS_SCALE);
  };

  ctx.font = fontStr(10, 'bold');
  ctx.fillStyle = '#905831';
  ctx.fillText('SAFAR  ·  TRAVEL ITINERARY', marginX, y);
  y += Math.round(24 * CANVAS_SCALE);

  const title = meta.title?.trim() || `${plan.dailyItinerary.length}-Day ${plan.destination}`;
  drawTextBlock(title, marginX, contentW, 20, 26, '#0a0a0a', 'bold');
  y += Math.round(3 * CANVAS_SCALE);
  drawTextBlock(buildMetaLine(plan, meta, false), marginX, contentW, 9.5, 14, '#767676', 'normal');
  y += Math.round(8 * CANVAS_SCALE);
  drawTextBlock(plan.tripSummary, marginX, contentW, 10.5, 16, '#1a1a1a', 'normal');

  if (meta.notes?.trim()) {
    y += Math.round(8 * CANVAS_SCALE);
    drawTextBlock(`Notes: ${meta.notes.trim()}`, marginX, contentW, 9.5, 14, '#1a1a1a', 'normal');
  }

  // Budget
  drawHeading(`Estimated Budget (${plan.currency})`);
  const b = plan.budgetBreakdown;
  const budgetItems = [
    `Accommodation: ${formatMoneyDisplay(b.accommodation, plan.currency)}`,
    `Food & Dining: ${formatMoneyDisplay(b.food, plan.currency)}`,
    `Transportation: ${formatMoneyDisplay(b.transportation, plan.currency)}`,
    `Activities: ${formatMoneyDisplay(b.activities, plan.currency)}`,
  ];
  drawTextBlock(budgetItems.join('   ·   '), marginX, contentW, 10, 16, '#1a1a1a', 'normal');
  y += Math.round(4 * CANVAS_SCALE);
  drawTextBlock(
    `Total Estimated Cost: ${formatMoneyDisplay(plan.totalEstimatedBudget, plan.currency)}`,
    marginX,
    contentW,
    11,
    16,
    '#0a0a0a',
    'bold',
  );
  if (b.disclaimer) {
    drawTextBlock(b.disclaimer, marginX, contentW, 8.5, 13, '#767676', 'normal');
  }

  // Daily Itinerary
  drawHeading('Day-by-Day Schedule');
  for (const day of plan.dailyItinerary) {
    ensureSpace(Math.round(46 * CANVAS_SCALE));
    y += Math.round(4 * CANVAS_SCALE);
    drawTextBlock(
      `Day ${day.day}${day.date ? ` (${day.date})` : ''} · ${day.theme}${day.estimatedTravelTime ? `  [${day.estimatedTravelTime}]` : ''}`,
      marginX,
      contentW,
      11.5,
      16,
      '#0a0a0a',
      'bold',
    );
    y += Math.round(4 * CANVAS_SCALE);

    for (const slot of day.schedule) {
      ensureSpace(Math.round(36 * CANVAS_SCALE));
      const costText =
        slot.estimatedCost > 0
          ? ` (~${formatMoneyDisplay(slot.estimatedCost, plan.currency)})`
          : '';
      drawTextBlock(
        `${slot.time || '·'}  —  ${slot.activity}${costText}`,
        marginX + Math.round(10 * CANVAS_SCALE),
        contentW - Math.round(10 * CANVAS_SCALE),
        10,
        15,
        '#1a1a1a',
        'bold',
      );
      const sub = [
        slot.location,
        slot.visitingHours ? `Hours: ${slot.visitingHours}` : '',
        slot.travelTimeFromPrev,
      ]
        .filter(Boolean)
        .join(' · ');
      if (sub) {
        drawTextBlock(
          sub,
          marginX + Math.round(20 * CANVAS_SCALE),
          contentW - Math.round(20 * CANVAS_SCALE),
          9,
          13.5,
          '#767676',
          'normal',
        );
      }
      if (slot.notes) {
        drawTextBlock(
          slot.notes,
          marginX + Math.round(20 * CANVAS_SCALE),
          contentW - Math.round(20 * CANVAS_SCALE),
          9,
          13.5,
          '#1a1a1a',
          'normal',
        );
      }
      y += Math.round(4 * CANVAS_SCALE);
    }
    y += Math.round(6 * CANVAS_SCALE);
  }

  if (plan.attractions.length > 0) {
    drawHeading('Key Attractions');
    for (const item of plan.attractions) {
      drawTextBlock(
        `${item.name} (${item.bestTimeToVisit} · ${item.estimatedDuration})`,
        marginX,
        contentW,
        10,
        15,
        '#1a1a1a',
        'bold',
      );
      if (item.description) {
        drawTextBlock(
          item.description,
          marginX + Math.round(10 * CANVAS_SCALE),
          contentW - Math.round(10 * CANVAS_SCALE),
          9,
          13.5,
          '#767676',
          'normal',
        );
      }
      y += Math.round(3 * CANVAS_SCALE);
    }
  }

  if (plan.accommodationSuggestions.length > 0) {
    drawHeading('Stay Suggestions');
    for (const stay of plan.accommodationSuggestions) {
      drawTextBlock(
        `${stay.name} · ${stay.area} (${stay.tier} · ${stay.approximateNightlyRange})`,
        marginX,
        contentW,
        10,
        15,
        '#1a1a1a',
        'bold',
      );
      if (stay.notes) {
        drawTextBlock(
          stay.notes,
          marginX + Math.round(10 * CANVAS_SCALE),
          contentW - Math.round(10 * CANVAS_SCALE),
          9,
          13.5,
          '#767676',
          'normal',
        );
      }
      y += Math.round(3 * CANVAS_SCALE);
    }
  }

  if (plan.foodRecommendations.length > 0) {
    drawHeading('Food Recommendations');
    for (const food of plan.foodRecommendations) {
      drawTextBlock(
        `${food.dishOrSpot} · ${food.type}, ${food.area} (${food.approximateCostRange})`,
        marginX,
        contentW,
        10,
        15,
        '#1a1a1a',
        'bold',
      );
      if (food.notes) {
        drawTextBlock(
          food.notes,
          marginX + Math.round(10 * CANVAS_SCALE),
          contentW - Math.round(10 * CANVAS_SCALE),
          9,
          13.5,
          '#767676',
          'normal',
        );
      }
      y += Math.round(3 * CANVAS_SCALE);
    }
  }

  if (plan.travelTips.length > 0) {
    drawHeading('Travel Tips');
    for (const tip of plan.travelTips) {
      drawTextBlock(`• ${tip}`, marginX, contentW, 9.5, 14.5, '#1a1a1a', 'normal');
    }
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  const totalPages = pages.length;
  pages.forEach((canvas, idx) => {
    const pageCtx = canvas.getContext('2d');
    if (pageCtx) {
      const footerY = CANVAS_H - Math.round(22 * CANVAS_SCALE);
      pageCtx.strokeStyle = '#e1e1e1';
      pageCtx.lineWidth = 1;
      pageCtx.beginPath();
      pageCtx.moveTo(marginX, CANVAS_H - Math.round(36 * CANVAS_SCALE));
      pageCtx.lineTo(CANVAS_W - marginX, CANVAS_H - Math.round(36 * CANVAS_SCALE));
      pageCtx.stroke();

      pageCtx.font = fontStr(8.5, 'normal');
      pageCtx.fillStyle = '#767676';
      pageCtx.fillText('SAFAR Travel Itinerary', marginX, footerY);
      const pageLabel = `Page ${idx + 1} of ${totalPages}`;
      const labelWidth = pageCtx.measureText(pageLabel).width;
      pageCtx.fillText(pageLabel, CANVAS_W - marginX - labelWidth, footerY);
    }

    if (idx > 0) {
      doc.addPage();
    }
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_PT, A4_HEIGHT_PT);
  });

  doc.save(filename);
}

export async function downloadItineraryPdf(
  plan: StructuredTripPlan,
  meta: PdfExportMeta = {},
): Promise<string> {
  const baseName = sanitizeFilename(
    meta.title?.trim() || `${plan.destination}-${plan.dailyItinerary.length}-days`,
  );
  const filename = `${baseName}.pdf`;

  if (containsNonWinAnsiScript(plan, meta)) {
    generateUnicodeCanvasPdf(plan, meta, filename);
  } else {
    generateVectorPdf(plan, meta, filename);
  }

  return filename;
}
